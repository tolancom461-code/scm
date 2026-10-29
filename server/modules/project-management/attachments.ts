import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { documents } from "../../../drizzle/schema";
import { validateProjectFile } from "../../../shared/construction";
import { storeDocument, localDocumentPath } from "../../storage";
import { database } from "../../core/database";
import { allocateDocumentNumber } from "../../core/numbering";
import { recordChange } from "../../core/audit";
import { canAccess, type AccessContext } from "../../core/policy";
import { lockedProject, assertEditable } from "./service";
import { projectTasks } from "../../../drizzle/construction";
export async function uploadProjectManagementDocument(
  input: {
    entityType: "pm_project" | "pm_task";
    entityId: number;
    fileName: string;
    mimeType: string;
    title: string;
    classification:
      | "normal"
      | "internal"
      | "confidential"
      | "highly_confidential";
    base64: string;
  },
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
  const checksum = createHash("sha256").update(content).digest("hex"),
    stored = await storeDocument(content);
  try {
    const result = await (
      await database()
    ).transaction(async tx => {
      let projectId = input.entityId;
      if (input.entityType === "pm_task") {
        if (!canAccess(a, "pm.tasks.manage"))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "لا تملك صلاحية تعديل المهام / Access denied",
          });
        const [task] = await tx
          .select({ projectId: projectTasks.projectId })
          .from(projectTasks)
          .where(eq(projectTasks.id, input.entityId))
          .for("update");
        if (!task)
          throw new TRPCError({ code: "BAD_REQUEST", message: "المهمة غير موجودة / Task not found" });
        projectId = task.projectId;
      }
      const project = await lockedProject(tx, projectId, a);
      if (input.entityType === "pm_project") assertEditable(project, a);
      else if (project.status !== "active")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "مرفقات المهام متاحة أثناء تنفيذ المشروع / Task attachments are available while the project is active",
        });
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
        sizeBytes: content.length,
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
      await unlink(localDocumentPath(stored.key)).catch(() => {});
    return { id: result.id, url: result.url };
  } catch (error) {
    await unlink(localDocumentPath(stored.key)).catch(() => {});
    throw error;
  }
}
