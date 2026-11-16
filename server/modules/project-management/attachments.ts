import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { documents } from "../../../drizzle/schema";
import { validateProjectFile } from "../../../shared/construction";
import {
  deleteStoredDocument,
  storeDocument,
  storeDocumentFromFile,
} from "../../storage";
import { database, type Transaction } from "../../core/database";
import { allocateDocumentNumber } from "../../core/numbering";
import { recordChange } from "../../core/audit";
import {
  assertConstructionAccess,
  canAccess,
  type AccessContext,
} from "../../core/policy";
import { lockedProject, assertEditable } from "./service";
import { projectTasks } from "../../../drizzle/construction";

export type ProjectAttachmentTarget = {
  entityType: "pm_project" | "pm_task";
  entityId: number;
};

type ProjectAttachmentDetails = ProjectAttachmentTarget & {
  fileName: string;
  mimeType: string;
  title: string;
  classification:
    | "normal"
    | "internal"
    | "confidential"
    | "highly_confidential";
};

export async function assertProjectAttachmentUpload(
  target: ProjectAttachmentTarget,
  a: AccessContext,
  tx?: Transaction
) {
  let projectId = target.entityId;
  if (target.entityType === "pm_task") {
    if (!canAccess(a, "pm.tasks.manage"))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "لا تملك صلاحية تعديل المهام / Access denied",
      });
    const query = (tx ?? (await database()))
      .select({ projectId: projectTasks.projectId })
      .from(projectTasks)
      .where(eq(projectTasks.id, target.entityId));
    const [task] = await (tx ? query.for("update") : query);
    if (!task)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "المهمة غير موجودة / Task not found",
      });
    projectId = task.projectId;
  }
  const project = tx
    ? await lockedProject(tx, projectId, a)
    : await assertConstructionAccess(a, projectId);
  if (target.entityType === "pm_project") assertEditable(project, a);
  else if (project.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "مرفقات المهام متاحة أثناء تنفيذ المشروع / Task attachments are available while the project is active",
    });
}

export async function uploadProjectManagementDocument(
  input: ProjectAttachmentDetails & { base64: string },
  a: AccessContext
) {
  const content = Buffer.from(input.base64, "base64");
  if (
    !content.length ||
    content.length > 20_000_000 ||
    !validateProjectFile(input.fileName, content)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "يقبل المرفق صورة PNG/JPG/WEBP/GIF أو PDF أو DWG صالحًا بحد أقصى 20 ميغابايت / Upload a valid image, PDF or DWG, up to 20 MB",
    });
  const checksum = createHash("sha256").update(content).digest("hex");
  return persistProjectManagementDocument(
    input,
    content.length,
    checksum,
    a,
    () => storeDocument(content)
  );
}

export function uploadStagedProjectManagementDocument(
  input: ProjectAttachmentTarget & {
    filePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  },
  a: AccessContext
) {
  return persistProjectManagementDocument(
    { ...input, title: input.fileName, classification: "internal" },
    input.sizeBytes,
    input.checksum,
    a,
    () => storeDocumentFromFile(input.filePath, input.sizeBytes)
  );
}

async function persistProjectManagementDocument(
  input: ProjectAttachmentDetails,
  sizeBytes: number,
  checksum: string,
  a: AccessContext,
  store: () => Promise<{ key: string; url: string }>
) {
  const stored = await store();
  try {
    const result = await (
      await database()
    ).transaction(async tx => {
      await assertProjectAttachmentUpload(input, a, tx);
      const [existing] = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.entityType, input.entityType),
            eq(documents.entityId, input.entityId),
            eq(documents.checksum, checksum),
            eq(documents.fileName, input.fileName)
          )
        );
      if (existing)
        return { id: existing.id, url: existing.url, key: existing.storageKey };
      const [r] = await tx.insert(documents).values({
        documentNumber: await allocateDocumentNumber(tx, "DOC"),
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        fileName: input.fileName,
        mimeType: input.mimeType,
        classification: input.classification,
        storageKey: stored.key,
        url: stored.url,
        sizeBytes,
        checksum,
        uploadedBy: a.user.id,
      });
      const id = Number(r.insertId);
      await recordChange(tx, {
        actorId: a.user.id,
        action:
          input.entityType === "pm_task"
            ? "pm.task.attachment"
            : "pm.project.attachment",
        entityType: input.entityType,
        entityId: input.entityId,
        after: { documentId: id, fileName: input.fileName },
      });
      return { id, url: stored.url, key: stored.key };
    });
    if (result.key !== stored.key)
      await deleteStoredDocument(stored.key).catch(() => {});
    return { id: result.id, url: result.url };
  } catch (error) {
    await deleteStoredDocument(stored.key).catch(() => {});
    throw error;
  }
}
