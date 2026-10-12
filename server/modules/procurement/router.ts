import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import { canTransitionRequest, type RequestStatus } from "../../workflow";

const numberSchema = z.coerce.number().finite().nonnegative();

import { requiring } from "../../core/permissions";
import { nextDocumentNumber } from "../../core/numbering";
export const purchaseRequestsRouter = router({
  list: requiring("requests.view").query(() => db.listPurchaseRequests()),
  history: requiring("requests.view")
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(({ input }) => db.listRequestApprovals(input.requestId)),
  create: requiring("requests.create")
    .input(
      z.object({
        title: z.string().trim().min(3).max(255),
        department: z.string().trim().max(120).optional(),
        site: z.string().trim().max(120).optional(),
        supplierId: z.number().int().positive().optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        budgetCode: z.string().trim().max(80).optional(),
        budgetLimit: numberSchema.optional(),
        estimatedValue: numberSchema.default(0),
        currency: z.string().trim().min(3).max(8).default("SAR"),
        neededBy: z.string().datetime().optional(),
        notes: z.string().trim().max(5000).optional(),
        items: z
          .array(
            z.object({
              description: z.string().trim().min(2).max(500),
              quantity: numberSchema.positive(),
              unit: z.string().trim().min(1).max(30),
              estimatedUnitPrice: numberSchema.default(0),
              specifications: z.string().trim().max(2000).optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (
        input.budgetLimit !== undefined &&
        input.estimatedValue > input.budgetLimit
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "القيمة التقديرية تتجاوز حد الميزانية المحدد.",
        });
      const id = await db.createPurchaseRequest({
        header: {
          requestNumber: await nextDocumentNumber("PR"),
          title: input.title,
          department: input.department ?? null,
          site: input.site ?? null,
          supplierId: input.supplierId ?? null,
          priority: input.priority,
          budgetCode: input.budgetCode ?? null,
          budgetLimit: input.budgetLimit?.toFixed(2) ?? null,
          estimatedValue: input.estimatedValue.toFixed(2),
          currency: input.currency,
          neededBy: input.neededBy ? new Date(input.neededBy) : null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
        },
        items: input.items.map(item => ({
          ...item,
          quantity: item.quantity.toFixed(3),
          estimatedUnitPrice: item.estimatedUnitPrice.toFixed(2),
          specifications: item.specifications ?? null,
        })),
      });
      await db.createAuditLog(
        ctx.user.id,
        "purchase_request.create",
        "purchase_request",
        id,
        { title: input.title }
      );
      return { id };
    }),
  transition: requiring("requests.submit")
    .input(
      z.object({
        requestId: z.number().int().positive(),
        from: z.enum([
          "draft",
          "submitted",
          "approved",
          "rejected",
          "cancelled",
        ]),
        to: z.enum(["draft", "submitted", "approved", "rejected", "cancelled"]),
        comment: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const currentRequest = await db.getPurchaseRequestById(input.requestId);
      if (!currentRequest)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "طلب الشراء غير موجود.",
        });
      if (currentRequest.status !== input.from)
        throw new TRPCError({
          code: "CONFLICT",
          message: "تغيّرت حالة طلب الشراء؛ حدّث الصفحة قبل تنفيذ انتقال جديد.",
        });
      if (
        !canTransitionRequest(
          input.from as RequestStatus,
          input.to as RequestStatus
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "انتقال الحالة غير مسموح به.",
        });
      const permission =
        input.to === "approved"
          ? "requests.approve"
          : input.to === "rejected"
            ? "requests.reject"
            : "requests.submit";
      if (!ctx.user.permissionCodes.includes(permission))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "لا تملك صلاحية هذا الإجراء.",
        });
      await db.updateRequestStatus(
        input.requestId,
        input.to,
        ctx.user.id,
        input.comment
      );
      await db.createAuditLog(
        ctx.user.id,
        `purchase_request.${input.to}`,
        "purchase_request",
        input.requestId,
        { comment: input.comment }
      );
      if (input.to === "submitted")
        await db.createNotificationForPermission("requests.approve", {
          type: "purchase_request_submitted",
          titleAr: "طلب شراء بانتظار الاعتماد",
          titleEn: "Purchase request awaiting approval",
          titleUr: "خرید کی درخواست منظوری کی منتظر ہے",
          messageAr: `تم تقديم طلب شراء جديد.`,
          messageEn: "A new purchase request has been submitted.",
          messageUr: "نئی خرید کی درخواست جمع کر دی گئی ہے۔",
          entityType: "purchase_request",
          entityId: input.requestId,
        });
      if (input.to === "approved" || input.to === "rejected") {
        const request = await db.getPurchaseRequestById(input.requestId);
        if (request)
          await db.createNotification(request.createdBy, {
            type: `purchase_request_${input.to}`,
            titleAr:
              input.to === "approved"
                ? "تم اعتماد طلب الشراء"
                : "تم رفض طلب الشراء",
            titleEn:
              input.to === "approved"
                ? "Purchase request approved"
                : "Purchase request rejected",
            titleUr:
              input.to === "approved"
                ? "خرید کی درخواست منظور ہو گئی"
                : "خرید کی درخواست مسترد ہو گئی",
            messageAr: `تم تحديث حالة الطلب ${request.requestNumber}.`,
            messageEn: `The status of request ${request.requestNumber} was updated.`,
            messageUr: `درخواست ${request.requestNumber} کی حالت تبدیل کر دی گئی ہے۔`,
            entityType: "purchase_request",
            entityId: input.requestId,
          });
      }
      return { success: true };
    }),
});
