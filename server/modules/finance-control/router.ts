import { z } from "zod";
import { businessDate } from "../../../shared/date";
import { and, asc, desc, count, eq, inArray, like, sql } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring, hasPermission } from "../../core/permissions";
import { TRPCError } from "@trpc/server";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { listInput, idInput, reasonInput } from "../../../shared/list";
import {
  invoiceInput,
  scheduleInput,
  paymentInput,
  creditInput,
  certificateInput,
} from "../../../shared/finance";
import { workflowDecisionInput } from "../../../shared/workflows";
import * as f from "../../../drizzle/finance";
import {
  orders,
  orderLines,
  orderSchedules,
} from "../../../drizzle/procurement";
import { items } from "../../../drizzle/master-data";
import { decimal, formatDecimal } from "../../../shared/decimal";
import * as service from "./service";
const creation = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, key: z.string().uuid() });
const financialTables = {
  invoices: f.invoices,
  payments: f.payments,
  certificates: f.workCertificates,
  credits: f.creditNotes,
};
export const financeRouter = router({
  projectOverview: requiring("finance.view")
    .input(listInput.extend({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await database(),
        today = businessDate();
      const records = await db
        .select({
          order: orders,
          line: orderLines,
          acceptedQuantity: sql<string>`CAST(CASE WHEN ${orders.execution}='works' THEN COALESCE((SELECT SUM(wl.quantity) FROM scm_work_certificate_lines wl JOIN scm_work_certificates wc ON wc.id=wl.certificate_id WHERE wl.order_line_id=${orderLines.id} AND wc.status='approved'),0) ELSE COALESCE((SELECT SUM((ra.accepted-ra.returned_accepted)/rl.factor) FROM scm_receipt_allocations ra JOIN scm_receipt_lines rl ON rl.id=ra.receipt_line_id WHERE rl.order_line_id=${orderLines.id}),0) END AS DECIMAL(18,6))`,
          dueQuantity: sql<string>`CAST(COALESCE((SELECT SUM(ds.quantity) FROM scm_order_schedules ds WHERE ds.order_line_id=${orderLines.id} AND ds.due_date<${today}),0) AS DECIMAL(18,6))`,
          cashPaid: sql<string>`COALESCE((SELECT SUM(p.amount) FROM scm_payments p WHERE p.order_id=${orders.id} AND p.status='posted' AND p.kind IN ('advance','invoice')),0)`,
          paymentOverdue: sql<number>`EXISTS (SELECT 1 FROM scm_invoices i WHERE i.order_id=${orders.id} AND i.status='approved' AND i.due_date<${today} AND i.total - COALESCE((SELECT SUM(c.total) FROM scm_credit_notes c WHERE c.invoice_id=i.id AND c.status='approved'),0) - COALESCE((SELECT SUM(p.amount) FROM scm_payments p WHERE p.invoice_id=i.id AND p.status='posted'),0) - CASE WHEN EXISTS (SELECT 1 FROM scm_retention_releases r WHERE r.invoice_id=i.id AND r.status='posted') THEN 0 ELSE i.retention_amount-COALESCE((SELECT SUM(c.retention_credit) FROM scm_credit_notes c WHERE c.invoice_id=i.id AND c.status='approved'),0) END > 0)`,
        })
        .from(orderLines)
        .innerJoin(orders, eq(orderLines.orderId, orders.id))
        .where(eq(orderLines.projectId, input.projectId))
        .orderBy(desc(orders.id), asc(orderLines.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(orderLines)
        .where(eq(orderLines.projectId, input.projectId));
      return {
        records: records.map(r => ({
          ...r,
          deliveryOverdue:
            r.order.status === "approved" &&
            decimal(r.acceptedQuantity) < decimal(r.dueQuantity),
          paymentOverdue: Boolean(r.paymentOverdue),
        })),
        total: total.value,
      };
    }),
  resubmit: requiring("finance.view")
    .input(
      reasonInput.extend({
        kind: z.enum(["payment", "acceptance", "credit", "retention"]),
      })
    )
    .mutation(({ input, ctx }) => {
      const permission =
        input.kind === "payment"
          ? "payments.create"
          : input.kind === "acceptance"
            ? "receiving.create"
            : "finance.create";
      if (!hasPermission(ctx.user, permission))
        throw new TRPCError({ code: "FORBIDDEN" });
      return service.resubmit(input.kind, input.id, ctx.user.id, input.reason);
    }),
  closeOrder: requiring("orders.approve")
    .input(reasonInput)
    .mutation(({ input, ctx }) =>
      service.closeOrder(input.id, ctx.user.id, input.reason)
    ),
  list: requiring("finance.view")
    .input(
      listInput.extend({
        kind: z.enum(["invoices", "payments", "certificates", "credits"]),
        orderId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await database(),
        table = financialTables[input.kind],
        search = "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%";
      const filter = and(
        input.search ? like(table.number, search) : undefined,
        input.orderId && "orderId" in table
          ? eq(table.orderId, input.orderId)
          : undefined
      );
      const records = await db
        .select({
          id: table.id,
          number: table.number,
          status: table.status,
          createdBy: table.createdBy,
          createdAt: table.createdAt,
        })
        .from(table)
        .where(filter)
        .orderBy(desc(table.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(table)
        .where(filter);
      return { records, total: total.value };
    }),
  orderSummary: requiring("finance.view")
    .input(idInput)
    .query(async ({ input }) =>
      (await database()).transaction(async tx => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, input.id));
        if (!order) throw new DomainError("NOT_FOUND");
        const lines = await tx
          .select({ line: orderLines, item: items })
          .from(orderLines)
          .innerJoin(items, eq(orderLines.itemId, items.id))
          .where(eq(orderLines.orderId, order.id));
        const eligible = [];
        for (const row of lines)
          eligible.push({
            ...row,
            eligibleQuantity: await service.eligibleQuantity(tx, row.line.id),
            acceptedQuantity: await service.acceptedQuantity(tx, row.line.id),
          });
        const [schedule] = await tx
          .select()
          .from(f.paymentSchedules)
          .where(eq(f.paymentSchedules.orderId, order.id));
        const milestones = schedule
          ? await tx
              .select()
              .from(f.paymentMilestones)
              .where(eq(f.paymentMilestones.scheduleId, schedule.id))
              .orderBy(asc(f.paymentMilestones.position))
          : [];
        const payments = await tx
          .select()
          .from(f.payments)
          .where(eq(f.payments.orderId, order.id));
        const invoices = await tx
          .select()
          .from(f.invoices)
          .where(eq(f.invoices.orderId, order.id));
        const invoiceBalances = [];
        for (const invoice of invoices)
          invoiceBalances.push({
            invoice,
            balance: await service.invoiceBalance(tx, invoice.id),
          });
        const cash = payments
            .filter(p => p.status === "posted" && p.kind !== "recovery")
            .reduce((n, p) => n + decimal(p.amount), 0n),
          advance = payments
            .filter(p => p.status === "posted" && p.kind === "advance")
            .reduce((n, p) => n + decimal(p.amount), 0n),
          recovery = payments
            .filter(p => p.status === "posted" && p.kind === "recovery")
            .reduce((n, p) => n + decimal(p.amount), 0n);
        return {
          order,
          lines: eligible,
          schedule: schedule ?? null,
          milestones: milestones.map(m => ({
            ...m,
            paid: formatDecimal(
              payments
                .filter(p => p.status === "posted" && p.milestoneId === m.id)
                .reduce((n, p) => n + decimal(p.amount), 0n)
            ),
          })),
          payments,
          invoiceBalances,
          metrics: {
            cashPaid: formatDecimal(cash),
            remaining: formatDecimal(decimal(order.total) - cash),
            unallocatedAdvance: formatDecimal(advance - recovery),
          },
        };
      })
    ),
  invoiceDetail: requiring("finance.view")
    .input(idInput)
    .query(async ({ input }) =>
      (await database()).transaction(async tx => {
        const [header] = await tx
          .select()
          .from(f.invoices)
          .where(eq(f.invoices.id, input.id));
        if (!header) throw new DomainError("NOT_FOUND");
        const lines = await tx
          .select({ line: f.invoiceLines, source: orderLines })
          .from(f.invoiceLines)
          .innerJoin(orderLines, eq(f.invoiceLines.orderLineId, orderLines.id))
          .where(eq(f.invoiceLines.invoiceId, input.id));
        const matches = await tx
          .select()
          .from(f.invoiceMatches)
          .where(eq(f.invoiceMatches.invoiceId, input.id))
          .orderBy(desc(f.invoiceMatches.id));
        const releases = await tx
          .select()
          .from(f.retentionReleases)
          .where(eq(f.retentionReleases.invoiceId, input.id));
        return {
          header,
          lines,
          matches,
          releases,
          balance: await service.invoiceBalance(tx, input.id),
        };
      })
    ),
  paymentDetail: requiring("finance.view")
    .input(idInput)
    .query(async ({ input }) => {
      const [header] = await (await database())
        .select()
        .from(f.payments)
        .where(eq(f.payments.id, input.id));
      if (!header) throw new DomainError("NOT_FOUND");
      return { header };
    }),
  certificateDetail: requiring("receiving.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [header] = await db
        .select()
        .from(f.workCertificates)
        .where(eq(f.workCertificates.id, input.id));
      if (!header) throw new DomainError("NOT_FOUND");
      const lines = await db
        .select({ line: f.workCertificateLines, source: orderLines })
        .from(f.workCertificateLines)
        .innerJoin(
          orderLines,
          eq(f.workCertificateLines.orderLineId, orderLines.id)
        )
        .where(eq(f.workCertificateLines.certificateId, input.id));
      return { header, lines };
    }),
  creditDetail: requiring("finance.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [header] = await db
        .select()
        .from(f.creditNotes)
        .where(eq(f.creditNotes.id, input.id));
      if (!header) throw new DomainError("NOT_FOUND");
      const lines = await db
        .select()
        .from(f.creditLines)
        .where(eq(f.creditLines.creditId, input.id));
      return { header, lines };
    }),
  createInvoice: requiring("finance.create")
    .input(creation(invoiceInput))
    .mutation(({ input, ctx }) =>
      service.createInvoice(input.data, ctx.user.id, input.key)
    ),
  matchInvoice: requiring("finance.create")
    .input(idInput.extend({ submit: z.boolean().default(false) }))
    .mutation(({ input, ctx }) =>
      service.matchInvoice(input.id, ctx.user.id, input.submit)
    ),
  cancelInvoice: requiring("finance.create")
    .input(reasonInput)
    .mutation(({ input, ctx }) =>
      service.cancelInvoice(input.id, ctx.user.id, input.reason)
    ),
  createSchedule: requiring("finance.create")
    .input(creation(scheduleInput))
    .mutation(({ input, ctx }) =>
      service.createSchedule(input.data, ctx.user.id, input.key)
    ),
  certify: requiring("receiving.inspect")
    .input(idInput.extend({ evidence: z.string().trim().min(3).max(4000) }))
    .mutation(({ input, ctx }) =>
      service.certifyMilestone(input.id, ctx.user.id, input.evidence)
    ),
  requestPayment: requiring("payments.create")
    .input(creation(paymentInput))
    .mutation(({ input, ctx }) =>
      service.requestPayment(input.data, ctx.user.id, input.key)
    ),
  createCertificate: requiring("receiving.create")
    .input(creation(certificateInput))
    .mutation(({ input, ctx }) =>
      service.createCertificate(input.data, ctx.user.id, input.key)
    ),
  createCredit: requiring("finance.create")
    .input(creation(creditInput))
    .mutation(({ input, ctx }) =>
      service.createCredit(input.data, ctx.user.id, input.key)
    ),
  releaseRetention: requiring("finance.create")
    .input(
      idInput.extend({
        key: z.string().uuid(),
        evidence: z.string().trim().min(3).max(4000),
      })
    )
    .mutation(({ input, ctx }) =>
      service.releaseRetention(input.id, input.evidence, ctx.user.id, input.key)
    ),
  decideInvoice: requiring("finance.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decideInvoice(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
  decidePayment: requiring("payments.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decidePayment(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
  decideCertificate: requiring("receiving.inspect")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decideCertificate(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
  decideCredit: requiring("finance.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decideCredit(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
  decideRetention: requiring("finance.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decideRetention(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
});
