import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import { storagePut } from "../../storage";

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
import { orders } from "../../../drizzle/procurement";
import {
  invoices,
  payments,
  workCertificates,
  creditNotes,
} from "../../../drizzle/finance";
import { projects } from "../../../drizzle/projects";
import { and, desc, eq } from "drizzle-orm";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { documents } from "../../../drizzle/schema";
import { documentScope } from "../../core/policy";
import {
  simpleContracts,
  simpleCertificates,
  simplePayments,
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
        entityType: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .regex(/^[a-z][a-z0-9_]+$/),
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
        base64: z.string().min(1).max(8_000_000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const references = {
        scm_order: orders,
        scm_invoice: invoices,
        scm_certificate: workCertificates,
        scm_payment: payments,
        scm_credit: creditNotes,
        scm_project: projects,
      };
      if (input.entityType.startsWith("p1_")) {
        const refs = {
          p1_contract: simpleContracts,
          p1_certificate: simpleCertificates,
          p1_payment: simplePayments,
        };
        const table = refs[input.entityType as keyof typeof refs];
        if (!table) throw new DomainError("INVALID_REFERENCE");
        const [row] = await (await database())
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, input.entityId));
        if (!row) throw new DomainError("INVALID_REFERENCE");
      }
      if (input.entityType.startsWith("scm_")) {
        const table = references[input.entityType as keyof typeof references];
        if (!table) throw new DomainError("INVALID_REFERENCE");
        const [record] = await (await database())
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, input.entityId));
        if (!record) throw new DomainError("INVALID_REFERENCE");
      }
      const content = Buffer.from(input.base64, "base64");
      if (content.byteLength === 0 || content.byteLength > 6_000_000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "الملف غير صالح أو يتجاوز حد 6 ميغابايت.",
        });
      const stored = await storagePut(
        `documents/${input.entityType}/${input.entityId}/${input.fileName}`,
        content,
        input.mimeType
      );
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
      if (documentId && !input.entityType.startsWith("p1_"))
        await db.createNotificationForPermission("documents.view", {
          type: "document_uploaded",
          titleAr: "تم رفع وثيقة جديدة",
          titleEn: "New document uploaded",
          titleUr: "نئی دستاویز اپ لوڈ ہوئی",
          messageAr: `تم رفع الوثيقة ${input.title}.`,
          messageEn: `The document ${input.title} was uploaded.`,
          messageUr: `دستاویز ${input.title} اپ لوڈ کر دی گئی ہے۔`,
          entityType: "document",
          entityId: documentId,
        });
      return { id: documentId, url: stored.url };
    }),
});
