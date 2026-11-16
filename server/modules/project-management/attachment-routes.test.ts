import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { Readable } from "node:stream";
import express from "express";
import { TRPCError } from "@trpc/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { projectAttachmentMaxBytes } from "../../../shared/construction";
import { LOCAL_SESSION_COOKIE } from "../../localAuth";
import { registerProjectAttachmentUploads } from "./attachment-routes";

const mocks = vi.hoisted(() => ({
  getUserBySessionToken: vi.fn(),
  authorizeRequest: vi.fn(),
  assertProjectAttachmentUpload: vi.fn(),
  uploadStagedProjectManagementDocument: vi.fn(),
  mkdtemp: vi.fn(),
}));
vi.mock("../../db", () => ({
  getUserBySessionToken: mocks.getUserBySessionToken,
}));
vi.mock("../../core/policy", () => ({
  authorizeRequest: mocks.authorizeRequest,
}));
vi.mock("./attachments", () => ({
  assertProjectAttachmentUpload: mocks.assertProjectAttachmentUpload,
  uploadStagedProjectManagementDocument:
    mocks.uploadStagedProjectManagementDocument,
}));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    mkdtemp: async (path: string) => {
      const directory = await fs.mkdtemp(path);
      mocks.mkdtemp(directory);
      return directory;
    },
  };
});

const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
const attachment = { id: 7, url: "/documents/files/local/test" };
const defaultHeaders = {
  Cookie: LOCAL_SESSION_COOKIE + "=valid-session",
  "Content-Type": "application/octet-stream",
  "X-File-Name": encodeURIComponent("مخطط.pdf"),
};
let server: Server;
let port: number;

function post(
  body: Iterable<Buffer>,
  options: {
    headers?: Record<string, string>;
    path?: string;
  } = {}
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: options.path ?? "/api/project-attachments/pm_project/83",
        headers: { ...defaultHeaders, ...options.headers },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode!,
              json: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    Readable.from(body, { objectMode: false }).pipe(req);
  });
}

function* pdfChunks(size: number) {
  yield pdf;
  let remaining = size - pdf.length;
  const chunk = Buffer.alloc(512 * 1024);
  while (remaining > 0) {
    const length = Math.min(chunk.length, remaining);
    yield chunk.subarray(0, length);
    remaining -= length;
  }
}

async function expectCleanTemp() {
  const directory = mocks.mkdtemp.mock.lastCall?.[0];
  expect(directory).toBeTypeOf("string");
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("Raw project and task attachments", () => {
  beforeAll(async () => {
    const app = express();
    registerProjectAttachmentUploads(app);
    app.use(express.json({ limit: "50mb" }));
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    port = address.port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUserBySessionToken.mockResolvedValue({ id: 2 });
    mocks.authorizeRequest.mockResolvedValue({ user: { id: 2 } });
    mocks.assertProjectAttachmentUpload.mockResolvedValue(undefined);
    mocks.uploadStagedProjectManagementDocument.mockResolvedValue(attachment);
  });

  it("authenticates and checks permissions and upload state before creating a temporary file", async () => {
    mocks.getUserBySessionToken.mockResolvedValueOnce(null);
    expect((await post([pdf])).status).toBe(401);
    expect(mocks.authorizeRequest).not.toHaveBeenCalled();

    mocks.authorizeRequest.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    expect((await post([pdf])).status).toBe(403);
    expect(mocks.assertProjectAttachmentUpload).not.toHaveBeenCalled();

    mocks.assertProjectAttachmentUpload.mockRejectedValueOnce(
      new TRPCError({ code: "BAD_REQUEST" })
    );
    expect((await post([pdf])).status).toBe(400);
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.uploadStagedProjectManagementDocument).not.toHaveBeenCalled();
  });

  it("rejects oversize Content-Length before receiving the body", async () => {
    expect(
      await post([], {
        headers: { "Content-Length": String(projectAttachmentMaxBytes + 1) },
      })
    ).toMatchObject({
      status: 413,
      json: { message: expect.stringContaining("150 MB") },
    });
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.getUserBySessionToken).not.toHaveBeenCalled();
  });

  it("stages, hashes and persists exactly 150 MB sent as a raw stream", async () => {
    const hash = createHash("sha256");
    for (const chunk of pdfChunks(projectAttachmentMaxBytes))
      hash.update(chunk);
    const checksum = hash.digest("hex");
    mocks.uploadStagedProjectManagementDocument.mockImplementation(
      async ({ filePath, sizeBytes, ...details }) => {
        expect((await stat(filePath)).size).toBe(projectAttachmentMaxBytes);
        expect(sizeBytes).toBe(projectAttachmentMaxBytes);
        expect(details).toMatchObject({
          checksum,
          entityId: 83,
          entityType: "pm_project",
          fileName: "مخطط.pdf",
          mimeType: "application/pdf",
        });
        return attachment;
      }
    );
    expect(await post(pdfChunks(projectAttachmentMaxBytes))).toEqual({
      status: 200,
      json: attachment,
    });
    await expectCleanTemp();
  }, 30_000);

  it("rejects a body above 150 MB even without Content-Length and cleans the temporary file", async () => {
    expect(await post(pdfChunks(projectAttachmentMaxBytes + 1))).toMatchObject({
      status: 413,
      json: { message: expect.stringContaining("150 MB") },
    });
    expect(mocks.uploadStagedProjectManagementDocument).not.toHaveBeenCalled();
    await expectCleanTemp();
  }, 30_000);

  it("checks stream bytes for the supplied extension and cleans the temporary file", async () => {
    expect(await post([Buffer.from("<html>not a PDF</html>")])).toMatchObject({
      status: 415,
      json: { message: expect.any(String) },
    });
    expect(mocks.uploadStagedProjectManagementDocument).not.toHaveBeenCalled();
    await expectCleanTemp();
  });

  it("decodes task file metadata and rechecks the upload session after staging", async () => {
    const firstAccess = { user: { id: 2 } };
    const secondAccess = { user: { id: 2 }, updated: true };
    mocks.authorizeRequest
      .mockResolvedValueOnce(firstAccess)
      .mockResolvedValueOnce(secondAccess);
    mocks.uploadStagedProjectManagementDocument.mockImplementation(
      async ({ filePath }, accessContext) => {
        expect(await readFile(filePath)).toEqual(pdf);
        expect(accessContext).toEqual(secondAccess);
        return attachment;
      }
    );
    expect(
      await post([pdf.subarray(0, 3), pdf.subarray(3)], {
        path: "/api/project-attachments/pm_task/8",
      })
    ).toEqual({ status: 200, json: attachment });
    expect(mocks.authorizeRequest).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeRequest).toHaveBeenLastCalledWith(
      2,
      "documents.upload",
      {
        entityType: "pm_task",
        entityId: 8,
      }
    );
    expect(mocks.assertProjectAttachmentUpload).toHaveBeenCalledWith(
      { entityType: "pm_task", entityId: 8 },
      firstAccess
    );
    await expectCleanTemp();
  });

  it("removes the temporary file when the client disconnects during upload", async () => {
    const req = request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/project-attachments/pm_project/83",
      headers: defaultHeaders,
    });
    req.on("error", () => {});
    req.write(pdf);
    try {
      await vi.waitFor(() => expect(mocks.mkdtemp).toHaveBeenCalled());
    } finally {
      req.destroy();
    }
    await vi.waitFor(expectCleanTemp);
    expect(mocks.uploadStagedProjectManagementDocument).not.toHaveBeenCalled();
  });
});
