import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

const numberSchema = z.coerce.number().finite().nonnegative();

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
export const rfqsRouter = router({
  list: requiring("rfqs.view").query(() => db.listRfqs()),
  packages: router({
    list: requiring("rfqs.view").query(() => db.listPurchasePackages()),
    create: requiring("packages.create")
      .input(z.object({ title: z.string().trim().min(3).max(255) }))
      .mutation(async ({ input, ctx }) => {
        const id = await db.createPurchasePackage({
          packageNumber: await nextDocumentNumber("PKG"),
          title: input.title,
          createdBy: ctx.user.id,
        });
        await db.createAuditLog(
          ctx.user.id,
          "purchase_package.create",
          "purchase_package",
          id ?? null,
          input
        );
        return { id };
      }),
  }),
  create: requiring("rfqs.create")
    .input(
      z.object({
        title: z.string().trim().min(3).max(255),
        packageId: z.number().int().positive().optional(),
        closingAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = await db.createRfq({
        rfqNumber: await nextDocumentNumber("RFQ"),
        packageId: input.packageId ?? null,
        title: input.title,
        closingAt: input.closingAt ? new Date(input.closingAt) : null,
        createdBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "rfq.create",
        "rfq",
        id ?? null,
        input
      );
      if (id)
        await db.createNotificationForPermission("rfqs.view", {
          type: "rfq_created",
          titleAr: "تم إنشاء طلب عرض سعر",
          titleEn: "RFQ created",
          titleUr: "قیمت کی درخواست تشکیل دی گئی",
          messageAr: `تم إنشاء طلب عرض السعر ${input.title}.`,
          messageEn: `The RFQ ${input.title} was created.`,
          messageUr: `قیمت کی درخواست ${input.title} تشکیل دی گئی ہے۔`,
          entityType: "rfq",
          entityId: id,
        });
      return { id };
    }),
  quotations: router({
    list: requiring("rfqs.view").query(() => db.listQuotations()),
    create: requiring("quotations.create")
      .input(
        z.object({
          rfqId: z.number().int().positive(),
          supplierId: z.number().int().positive(),
          totalAmount: numberSchema.positive(),
          deliveryDays: z.number().int().nonnegative().optional(),
          paymentTerms: z.string().trim().max(255).optional(),
          technicalCompliance: z.string().trim().max(60).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await db.createQuotation({
          rfqId: input.rfqId,
          supplierId: input.supplierId,
          totalAmount: input.totalAmount.toFixed(2),
          deliveryDays: input.deliveryDays ?? null,
          paymentTerms: input.paymentTerms ?? null,
          technicalCompliance: input.technicalCompliance ?? null,
        });
        await db.createAuditLog(
          ctx.user.id,
          "quotation.create",
          "quotation",
          id ?? null,
          input
        );
        if (id)
          await db.createNotificationForPermission("awards.create", {
            type: "quotation_recorded",
            titleAr: "تم تسجيل عرض مورد",
            titleEn: "Supplier quotation recorded",
            titleUr: "سپلائر کی پیشکش درج کی گئی",
            messageAr: "تم تسجيل عرض مورد جديد للمقارنة والترسية.",
            messageEn:
              "A supplier quotation was recorded for evaluation and award.",
            messageUr:
              "تشخیص اور ایوارڈ کے لیے سپلائر کی پیشکش درج کر دی گئی ہے۔",
            entityType: "quotation",
            entityId: id,
          });
        return { id };
      }),
  }),
  awards: router({
    list: requiring("rfqs.view").query(() => db.listAwards()),
    create: requiring("awards.create")
      .input(
        z.object({
          quotationId: z.number().int().positive(),
          supplierId: z.number().int().positive(),
          amount: numberSchema.positive(),
          reason: z.string().trim().min(3).max(3000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const id = await db.createAward({
          awardNumber: await nextDocumentNumber("AWD"),
          quotationId: input.quotationId,
          supplierId: input.supplierId,
          amount: input.amount.toFixed(2),
          reason: input.reason,
          createdBy: ctx.user.id,
        });
        await db.createAuditLog(
          ctx.user.id,
          "award.create",
          "award",
          id ?? null,
          input
        );
        if (id)
          await db.createNotificationForPermission("rfqs.view", {
            type: "award_created",
            titleAr: "تم إنشاء قرار ترسية",
            titleEn: "Award decision created",
            titleUr: "ایوارڈ فیصلہ تشکیل دیا گیا",
            messageAr: "تم تسجيل قرار ترسية جديد.",
            messageEn: "A new award decision was recorded.",
            messageUr: "نیا ایوارڈ فیصلہ درج کیا گیا ہے۔",
            entityType: "award",
            entityId: id,
          });
        return { id };
      }),
  }),
});
