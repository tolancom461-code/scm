import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import { calculateCertificateNetDue } from "../../contracts";

const numberSchema = z.coerce.number().finite().nonnegative();

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
import { transitionAmendment } from "./service";
export const contractsRouter = router({
  list: requiring("contracts.view").query(() => db.listContracts()),
  create: requiring("contracts.create")
    .input(
      z.object({
        title: z.string().trim().min(3).max(255),
        supplierId: z.number().int().positive(),
        type: z.string().trim().min(3).max(50).default("supply"),
        originalValue: numberSchema.positive(),
        currency: z.string().trim().min(3).max(8).default("SAR"),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        scope: z.string().trim().max(5000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = await db.createContract({
        contractNumber: await nextDocumentNumber("CTR"),
        title: input.title,
        supplierId: input.supplierId,
        contractType: input.type,
        originalValue: input.originalValue.toFixed(2),
        currentValue: input.originalValue.toFixed(2),
        currency: input.currency,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        scope: input.scope ?? null,
        createdBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "contract.create",
        "contract",
        id ?? null,
        input
      );
      if (id)
        await db.createNotificationForPermission("contracts.view", {
          type: "contract_created",
          titleAr: "تم إنشاء عقد جديد",
          titleEn: "New contract created",
          titleUr: "نیا معاہدہ تشکیل دیا گیا",
          messageAr: `تم إنشاء العقد ${input.title}.`,
          messageEn: `The contract ${input.title} was created.`,
          messageUr: `معاہدہ ${input.title} تشکیل دیا گیا ہے۔`,
          entityType: "contract",
          entityId: id,
        });
      return { id };
    }),
  amendments: router({
    submit: requiring("contracts.amend")
      .input(
        z.object({
          id: z.number().int().positive(),
          reason: z.string().trim().min(3).max(1000),
        })
      )
      .mutation(({ input, ctx }) =>
        transitionAmendment(input.id, "submitted", ctx.user.id, input.reason)
      ),
    approve: requiring("contracts.approve")
      .input(
        z.object({
          id: z.number().int().positive(),
          to: z.enum(["reviewed", "effective"]),
          reason: z.string().trim().min(3).max(1000),
        })
      )
      .mutation(({ input, ctx }) =>
        transitionAmendment(input.id, input.to, ctx.user.id, input.reason)
      ),
    list: requiring("contracts.view").query(() => db.listContractAmendments()),
    create: requiring("contracts.amend")
      .input(
        z.object({
          contractId: z.number().int().positive(),
          type: z.string().trim().min(2).max(50),
          valueChange: numberSchema.default(0),
          extensionDays: z.number().int().nonnegative().default(0),
          reason: z.string().trim().min(3).max(3000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await db.createContractAmendment({
          contractId: input.contractId,
          amendmentNumber: await nextDocumentNumber("AMD"),
          amendmentType: input.type,
          valueChange: input.valueChange.toFixed(2),
          extensionDays: input.extensionDays,
          reason: input.reason,
          createdBy: ctx.user.id,
        });
        await db.createAuditLog(
          ctx.user.id,
          "contract.amendment.create",
          "contract_amendment",
          id ?? null,
          input
        );
        return { id };
      }),
  }),
  certificates: router({
    list: requiring("contracts.view").query(() => db.listCertificates()),
    create: requiring("certificates.create")
      .input(
        z.object({
          contractId: z.number().int().positive(),
          currentValue: numberSchema.default(0),
          previousValue: numberSchema.default(0),
          deductions: numberSchema.default(0),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const netDue = calculateCertificateNetDue(
          input.currentValue,
          input.previousValue,
          input.deductions
        );
        if (netDue < 0)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "صافي المستخلص لا يمكن أن يكون سالباً.",
          });
        const id = await db.createCertificate({
          certificateNumber: await nextDocumentNumber("CERT"),
          contractId: input.contractId,
          currentValue: input.currentValue.toFixed(2),
          previousValue: input.previousValue.toFixed(2),
          deductions: input.deductions.toFixed(2),
          netDue: netDue.toFixed(2),
          createdBy: ctx.user.id,
        });
        await db.createAuditLog(
          ctx.user.id,
          "certificate.create",
          "certificate",
          id ?? null,
          input
        );
        return { id };
      }),
  }),
  financial: router({
    list: requiring("contracts.view").query(() => db.listFinancialOperations()),
    create: requiring("financial.create")
      .input(
        z.object({
          supplierId: z.number().int().positive(),
          contractId: z.number().int().positive().optional(),
          certificateId: z.number().int().positive().optional(),
          operationType: z.string().trim().min(2).max(50),
          amount: numberSchema.positive(),
          notes: z.string().trim().max(3000).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await db.createFinancialOperation({
          operationNumber: await nextDocumentNumber("FIN"),
          supplierId: input.supplierId,
          contractId: input.contractId ?? null,
          certificateId: input.certificateId ?? null,
          operationType: input.operationType,
          amount: input.amount.toFixed(2),
          operationDate: new Date(),
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        });
        await db.createAuditLog(
          ctx.user.id,
          "financial_operation.create",
          "financial_operation",
          id ?? null,
          input
        );
        return { id };
      }),
  }),
});
