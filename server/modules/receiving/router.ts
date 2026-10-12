import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

const numberSchema = z.coerce.number().finite().nonnegative();

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
export const deliveriesRouter = router({
  list: requiring("deliveries.view").query(() => db.listDeliveries()),
  create: requiring("deliveries.create")
    .input(
      z.object({
        poId: z.number().int().positive(),
        supplierId: z.number().int().positive(),
        deliveredValue: numberSchema.positive(),
        acceptedValue: numberSchema.default(0),
        rejectedValue: numberSchema.default(0),
        reference: z.string().trim().max(120).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.acceptedValue + input.rejectedValue > input.deliveredValue)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "لا يمكن أن تتجاوز القيم المقبولة والمرفوضة قيمة التوريد.",
        });
      const remaining = await db.getPurchaseOrderRemaining(input.poId);
      if (!remaining)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "أمر الشراء غير موجود.",
        });
      if (input.deliveredValue > remaining.remainingValue)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "قيمة التوريد تتجاوز الرصيد المتبقي لأمر الشراء.",
        });
      const id = await db.createDelivery({
        deliveryNumber: await nextDocumentNumber("DEL"),
        poId: input.poId,
        supplierId: input.supplierId,
        deliveredAt: new Date(),
        deliveredValue: input.deliveredValue.toFixed(2),
        acceptedValue: input.acceptedValue.toFixed(2),
        rejectedValue: input.rejectedValue.toFixed(2),
        reference: input.reference ?? null,
        createdBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "delivery.create",
        "delivery",
        id ?? null,
        input
      );
      if (id)
        await db.createNotificationForPermission("deliveries.view", {
          type: "delivery_recorded",
          titleAr: "تم تسجيل توريد جديد",
          titleEn: "New delivery recorded",
          titleUr: "نئی ڈیلیوری درج کی گئی",
          messageAr: "تم تسجيل توريد جديد لمتابعة الاستلام.",
          messageEn: "A new delivery was recorded for receiving follow-up.",
          messageUr: "وصول کی پیروی کے لیے نئی ڈیلیوری درج کر دی گئی ہے۔",
          entityType: "delivery",
          entityId: id,
        });
      return { id };
    }),
});
