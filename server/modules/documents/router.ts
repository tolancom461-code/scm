import { uploadProjectManagementDocument } from "../project-management/attachments";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import { storeDocument } from "../../storage";

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
import { and, desc, eq } from "drizzle-orm";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { documents } from "../../../drizzle/schema";
import { documentScope } from "../../core/policy";
import {
  simpleContracts,
  simpleCertificates,
  simplePayments,
  workInspections,
} from "../../../drizzle/phase-one";
export const documentsRouter = router({
  list: requiring("documents.view")
    .input(
      z
        .object({
          entityType: z.string().max(60).optional(),
          entityId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) =>
      (await database())
        .select()
        .from(documents)
        .where(
          and(
            documentScope(ctx.access!),
            input?.entityType
              ? eq(documents.entityType, input.entityType)
              : undefined,
            input?.entityId ? eq(documents.entityId, input.entityId) : undefined
          )
        )
        .orderBy(desc(documents.id))
    ),
  upload: requiring("documents.upload")
    .input(
      z.object({
        entityType: z.enum([
          "pm_project",
          "pm_task",
          "p1_contract",
          "p1_certificate",
          "p1_payment",
          "p1_inspection",
        ]),
        entityId: z.number().int().positive(),
        title: z.string().trim().min(2).max(255),
        fileName: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[^\\/\u0000]+$/),
        mimeType: z.string().trim().min(3).max(120),
        classification: z
          .enum(["normal", "internal", "confidential", "highly_confidential"])
          .default("internal"),
        base64: z.string().min(1).max(28_000_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.entityType === "pm_project" || input.entityType === "pm_task")
        return uploadProjectManagementDocument(
          { ...input, entityType: input.entityType },
          ctx.access!
        );
      if (input.entityType.startsWith("p1_")) {
        const refs = {
          p1_contract: simpleContracts,
          p1_certificate: simpleCertificates,
          p1_payment: simplePayments,
          p1_inspection: workInspections,
        };
        const table = refs[input.entityType as keyof typeof refs];
        if (!table) throw new DomainError("INVALID_REFERENCE");
        const [row] = await (await database())
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, input.entityId));
        if (!row) throw new DomainError("INVALID_REFERENCE");
      }
      const content = Buffer.from(input.base64, "base64");
      if (content.byteLength === 0 || content.byteLength > 6_000_000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الملف غير صالح أو يتجاوز حد 6 ميغابايت.",
        });
      const stored = await storeDocument(content);
      const documentId = await db.createDocument({
        documentNumber: await nextDocumentNumber("DOC"),
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        fileName: input.fileName,
        storageKey: stored.key,
        url: stored.url,
        mimeType: input.mimeType,
        sizeBytes: content.byteLength,
        checksum: await db.checksum(content),
        classification: input.classification,
        uploadedBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "document.upload",
        "document",
        documentId ?? null,
        {
          entityType: input.entityType,
          entityId: input.entityId,
          classification: input.classification,
        }
      );
      return { id: documentId, url: stored.url };
    }),
});
