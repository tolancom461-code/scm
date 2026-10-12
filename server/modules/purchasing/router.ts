import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";

const numberSchema = z.coerce.number().finite().nonnegative();

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
export const ordersRouter = router({
  list: requiring("orders.view").query(() => db.listOrders()),
  create: requiring("orders.create")
    .input(
      z.object({
        supplierId: z.number().int().positive(),
        contractId: z.number().int().positive().optional(),
        requestId: z.number().int().positive().optional(),
        totalAmount: numberSchema.positive(),
        deliveryDate: z.string().datetime().optional(),
        deliveryLocation: z.string().trim().max(255).optional(),
        terms: z.string().trim().max(3000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = await db.createPurchaseOrder({
        poNumber: await nextDocumentNumber("PO"),
        supplierId: input.supplierId,
        contractId: input.contractId ?? null,
        requestId: input.requestId ?? null,
        totalAmount: input.totalAmount.toFixed(2),
        deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
        deliveryLocation: input.deliveryLocation ?? null,
        terms: input.terms ?? null,
        createdBy: ctx.user.id,
      });
      await db.createAuditLog(
        ctx.user.id,
        "purchase_order.create",
        "purchase_order",
        id ?? null,
        input
      );
      if (id)
        await db.createNotificationForPermission("deliveries.create", {
          type: "purchase_order_created",
          titleAr: "تم إنشاء أمر شراء جديد",
          titleEn: "New purchase order created",
          titleUr: "نیا خریداری آرڈر تشکیل دیا گیا",
          messageAr: "يتطلب أمر الشراء متابعة التوريد.",
          messageEn: "The purchase order requires delivery follow-up.",
          messageUr: "خریداری آرڈر کے لیے ڈیلیوری فالو اپ درکار ہے۔",
          entityType: "purchase_order",
          entityId: id,
        });
      return { id };
    }),
});
