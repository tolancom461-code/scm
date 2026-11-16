import { createHash } from "node:crypto";
import { mkdtemp, open, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express, Request, Response } from "express";
import { parse } from "cookie";
import { TRPCError } from "@trpc/server";
import {
  projectAttachmentMaxBytes,
  projectFileExtensions,
  validateProjectFile,
} from "../../../shared/construction";
import { DomainError, domainMessages } from "../../core/errors";
import { authorizeRequest } from "../../core/policy";
import { getUserBySessionToken } from "../../db";
import { LOCAL_SESSION_COOKIE } from "../../localAuth";
import {
  assertProjectAttachmentUpload,
  uploadStagedProjectManagementDocument,
  type ProjectAttachmentTarget,
} from "./attachments";

const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  dwg: "image/vnd.dwg",
};
const invalidFile =
  "اختر ملف صورة أو PDF أو DWG صالحًا / Choose a valid image, PDF or DWG";
const invalidSize = "حجم المرفق غير صالح / The attachment size is invalid";
const maxSizeMessage =
  "الحد الأقصى لحجم المرفق 150 ميغابايت / The attachment limit is 150 MB";

class AttachmentRequestError extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    message: string
  ) {
    super(message);
  }
}

function uploadTarget(req: Request): ProjectAttachmentTarget {
  const entityType = req.params.entityType;
  const rawId = req.params.entityId;
  const entityId = Number(rawId);
  if (
    (entityType !== "pm_project" && entityType !== "pm_task") ||
    !/^[1-9]\d*$/.test(rawId) ||
    !Number.isSafeInteger(entityId) ||
    entityId > 2_147_483_647
  )
    throw new AttachmentRequestError(400, domainMessages.INVALID_INPUT.ar);
  return { entityType, entityId };
}

function uploadHeaders(req: Request) {
  const mediaType = req
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const encoding = req.get("Content-Encoding")?.trim().toLowerCase();
  if (
    mediaType !== "application/octet-stream" ||
    (encoding && encoding !== "identity")
  )
    throw new AttachmentRequestError(415, invalidFile);
  let fileName: string;
  try {
    fileName = decodeURIComponent(req.get("X-File-Name") ?? "").trim();
  } catch {
    throw new AttachmentRequestError(400, domainMessages.INVALID_INPUT.ar);
  }
  if (
    !fileName.length ||
    fileName.length > 255 ||
    /[\\/\x00-\x1f\x7f]/.test(fileName)
  )
    throw new AttachmentRequestError(400, domainMessages.INVALID_INPUT.ar);
  const extension = projectFileExtensions.exec(fileName)?.[1]?.toLowerCase();
  const mimeType = extension ? mimeTypes[extension] : undefined;
  if (!mimeType) throw new AttachmentRequestError(415, invalidFile);

  const rawLength = req.get("Content-Length");
  const declaredLength =
    rawLength === undefined ? undefined : Number(rawLength);
  if (rawLength !== undefined && (!/^\d+$/.test(rawLength) || !declaredLength))
    throw new AttachmentRequestError(400, invalidSize);
  if (
    declaredLength !== undefined &&
    declaredLength > projectAttachmentMaxBytes
  )
    throw new AttachmentRequestError(413, maxSizeMessage);
  return { fileName, mimeType, declaredLength };
}

async function attachmentAccess(req: Request, target: ProjectAttachmentTarget) {
  const token = parse(req.headers.cookie ?? "")[LOCAL_SESSION_COOKIE];
  const user = token ? await getUserBySessionToken(token) : null;
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "سجّل الدخول لرفع مرفق / Sign in to upload an attachment",
    });
  return authorizeRequest(user.id, "documents.upload", target);
}

async function stageAttachment(
  req: Request,
  filePath: string,
  fileName: string,
  declaredLength?: number
) {
  const file = await open(filePath, "wx", 0o600);
  const hash = createHash("sha256");
  const header = Buffer.alloc(12);
  let headerLength = 0;
  let sizeBytes = 0;
  try {
    // Check the bytes independently of Content-Length and keep the HTTP stream
    // open on early rejection so the client can receive an error response.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.length;
      if (sizeBytes > projectAttachmentMaxBytes)
        throw new AttachmentRequestError(413, maxSizeMessage);
      if (headerLength < header.length) {
        headerLength += bytes.copy(header, headerLength);
        if (
          headerLength === header.length &&
          !validateProjectFile(fileName, header)
        )
          throw new AttachmentRequestError(415, invalidFile);
      }
      hash.update(bytes);
      await file.writeFile(bytes);
    }
    if (
      !sizeBytes ||
      (declaredLength !== undefined && sizeBytes !== declaredLength)
    )
      throw new AttachmentRequestError(400, invalidSize);
    if (
      headerLength < header.length &&
      !validateProjectFile(fileName, header.subarray(0, headerLength))
    )
      throw new AttachmentRequestError(415, invalidFile);
    return { sizeBytes, checksum: hash.digest("hex") };
  } finally {
    await file.close();
  }
}

function sendUploadError(req: Request, res: Response, error: unknown) {
  if (res.destroyed || res.headersSent) return;
  if (!req.readableEnded) res.set("Connection", "close");
  if (error instanceof AttachmentRequestError)
    return res.status(error.status).json({ message: error.message });
  if (error instanceof TRPCError) {
    const status: Partial<Record<TRPCError["code"], number>> = {
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      BAD_REQUEST: 400,
    };
    const code = status[error.code];
    if (code) return res.status(code).json({ message: error.message });
  }
  if (error instanceof DomainError) {
    const status =
      error.domainCode === "NOT_FOUND"
        ? 404
        : error.domainCode === "SERVICE_UNAVAILABLE"
          ? 503
          : 400;
    return res
      .status(status)
      .json({ message: domainMessages[error.domainCode].ar });
  }
  return res
    .status(503)
    .json({ message: domainMessages.SERVICE_UNAVAILABLE.ar });
}

export function registerProjectAttachmentUploads(app: Express) {
  app.post(
    "/api/project-attachments/:entityType/:entityId",
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        const target = uploadTarget(req);
        const { fileName, mimeType, declaredLength } = uploadHeaders(req);
        const access = await attachmentAccess(req, target);
        await assertProjectAttachmentUpload(target, access);
        if (res.destroyed) return;
        const directory = await mkdtemp(join(tmpdir(), "pscm-attachment-"));
        const filePath = join(directory, "upload");
        let result;
        try {
          const staged = await stageAttachment(
            req,
            filePath,
            fileName,
            declaredLength
          );
          if (res.destroyed) return;
          // The session or grants may change while a large request is streaming.
          const currentAccess = await attachmentAccess(req, target);
          if (res.destroyed) return;
          result = await uploadStagedProjectManagementDocument(
            { ...target, filePath, fileName, mimeType, ...staged },
            currentAccess
          );
        } finally {
          await rm(filePath, { force: true }).catch(() => {});
          await rmdir(directory).catch(() => {});
        }
        if (!res.destroyed) res.json(result);
      } catch (error) {
        sendUploadError(req, res, error);
      }
    }
  );
}
