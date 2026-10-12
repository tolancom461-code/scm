import { and, eq, inArray, sql, asc } from "drizzle-orm";
import * as f from "../../../drizzle/finance";
import { businessDate } from "../../../shared/date";
import { orders, orderLines } from "../../../drizzle/procurement";
import {
  receiptLines,
  receiptAllocations,
  goodsReceipts,
  supplierReturns,
} from "../../../drizzle/receiving";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { allocateDocumentNumber } from "../../core/numbering";
import {
  decimal,
  formatDecimal,
  multiply,
  roundedDivide,
  lineAmounts,
} from "../../../shared/decimal";
import {
  invoiceInput,
  scheduleInput,
  paymentInput,
  creditInput,
  certificateInput,
} from "../../../shared/finance";
import type { z } from "zod";
import * as workflow from "../workflows/service";
import { postBudget } from "../projects/service";
import { activeSupplier } from "../procurement/scm-service";
export async function resubmit(
  kind: "payment" | "acceptance" | "credit" | "retention",
  id: number,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const table =
      kind === "payment"
        ? f.payments
        : kind === "acceptance"
          ? f.workCertificates
          : kind === "credit"
            ? f.creditNotes
            : f.retentionReleases;
    const [ref] = await tx.select().from(table).where(eq(table.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const [invoice] =
      "invoiceId" in ref && ref.invoiceId
        ? await tx
            .select()
            .from(f.invoices)
            .where(eq(f.invoices.id, ref.invoiceId))
        : [];
    const order = await lockOrder(
      tx,
      "orderId" in ref ? ref.orderId : invoice!.orderId
    );
    const [current] = await tx
      .select()
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (
      current.createdBy !== actorId ||
      !["returned", "rejected"].includes(current.status)
    )
      throw new DomainError("INVALID_TRANSITION");
    let amount = "amount" in current ? current.amount : current.total;
    const blockedActorIds: number[] = [];
    if (kind === "payment")
      await checkPayment(tx, current as typeof f.payments.$inferSelect);
    if (kind === "acceptance") {
      if (order.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
      blockedActorIds.push(order.createdBy);
      const lines = await tx
        .select()
        .from(f.workCertificateLines)
        .where(eq(f.workCertificateLines.certificateId, id));
      for (const line of lines) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        const [allocated] = await tx
          .select({
            q: sql<string>`COALESCE(SUM(${f.workCertificateLines.quantity}),0)`,
          })
          .from(f.workCertificateLines)
          .innerJoin(
            f.workCertificates,
            eq(f.workCertificateLines.certificateId, f.workCertificates.id)
          )
          .where(
            and(
              eq(f.workCertificateLines.orderLineId, line.orderLineId),
              inArray(f.workCertificates.status, ["pending", "approved"])
            )
          );
        if (
          decimal(allocated.q) + decimal(line.quantity) >
          decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
      }
    }
    if (kind === "credit") {
      const lines = await tx
        .select()
        .from(f.creditLines)
        .where(eq(f.creditLines.creditId, id));
      for (const line of lines) {
        const [source] = await tx
          .select()
          .from(f.invoiceLines)
          .where(eq(f.invoiceLines.id, line.invoiceLineId));
        const [allocated] = await tx
          .select({
            q: sql<string>`COALESCE(SUM(${f.creditLines.quantity}),0)`,
          })
          .from(f.creditLines)
          .innerJoin(
            f.creditNotes,
            eq(f.creditLines.creditId, f.creditNotes.id)
          )
          .where(
            and(
              eq(f.creditLines.invoiceLineId, line.invoiceLineId),
              inArray(f.creditNotes.status, ["pending", "approved"])
            )
          );
        if (
          decimal(allocated.q) + decimal(line.quantity) >
          decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
      }
    }
    if (kind === "retention") {
      amount = (await invoiceBalance(tx, invoice!.id)).retained;
      if (decimal(amount) <= 0n) throw new DomainError("INVALID_TRANSITION");
      await tx
        .update(f.retentionReleases)
        .set({ amount })
        .where(eq(f.retentionReleases.id, id));
    }
    if (invoice) blockedActorIds.push(invoice.createdBy);
    const workflowId = await workflow.start(
      tx,
      {
        entityType: kind,
        entityId: id,
        amount,
        currency: order.currency,
        department: order.department,
        requesterId: actorId,
        blockedActorIds,
      },
      actorId
    );
    await tx
      .update(table)
      .set({ status: "pending", workflowId })
      .where(eq(table.id, id));
    await recordChange(tx, {
      actorId,
      action: kind + ".resubmitted",
      entityType: kind,
      entityId: id,
      before: { status: current.status },
      after: { status: "pending", workflowId },
      reason,
    });
    return { id };
  });
}
export async function acceptedQuantity(tx: Transaction, orderLineId: number) {
  const [goods] = await tx
    .select({
      q: sql<string>`CAST(COALESCE(SUM((${receiptAllocations.accepted}-${receiptAllocations.returnedAccepted})/${receiptLines.factor}),0) AS DECIMAL(18,6))`,
    })
    .from(receiptAllocations)
    .innerJoin(
      receiptLines,
      eq(receiptAllocations.receiptLineId, receiptLines.id)
    )
    .where(eq(receiptLines.orderLineId, orderLineId));
  const [work] = await tx
    .select({
      q: sql<string>`COALESCE(SUM(${f.workCertificateLines.quantity}),0)`,
    })
    .from(f.workCertificateLines)
    .innerJoin(
      f.workCertificates,
      eq(f.workCertificateLines.certificateId, f.workCertificates.id)
    )
    .where(
      and(
        eq(f.workCertificateLines.orderLineId, orderLineId),
        eq(f.workCertificates.status, "approved")
      )
    );
  return formatDecimal(decimal(goods.q) + decimal(work.q), 6);
}
export async function closeOrder(id: number, actorId: number, reason: string) {
  return (await database()).transaction(async tx => {
    const order = await lockOrder(tx, id),
      lines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, id));
    for (const line of lines)
      if (
        decimal(await acceptedQuantity(tx, line.id)) !== decimal(line.quantity)
      )
        throw new DomainError("INVALID_TRANSITION");
    const invoices = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.orderId, id));
    let actual = 0n;
    for (const invoice of invoices) {
      if (
        ["draft", "matched", "pending", "blocked", "returned"].includes(
          invoice.status
        )
      )
        throw new DomainError("INVALID_TRANSITION");
      if (invoice.status === "approved") {
        const balance = await invoiceBalance(tx, invoice.id);
        if (
          decimal(balance.outstanding) !== 0n ||
          decimal(balance.retained) !== 0n
        )
          throw new DomainError("INVALID_TRANSITION");
        actual += decimal(balance.total) - decimal(balance.credited);
      }
    }
    const payments = await tx
      .select()
      .from(f.payments)
      .where(eq(f.payments.orderId, id));
    if (
      payments.some(p => p.status === "pending") ||
      actual !== decimal(order.total)
    )
      throw new DomainError("INVALID_TRANSITION");
    const cash = payments
      .filter(p => p.status === "posted" && p.kind !== "recovery")
      .reduce((n, p) => n + decimal(p.amount), 0n);
    const advance = payments
        .filter(p => p.status === "posted" && p.kind === "advance")
        .reduce((n, p) => n + decimal(p.amount), 0n),
      recovery = payments
        .filter(p => p.status === "posted" && p.kind === "recovery")
        .reduce((n, p) => n + decimal(p.amount), 0n);
    if (cash !== decimal(order.total) || advance !== recovery)
      throw new DomainError("INVALID_TRANSITION");
    await tx.update(orders).set({ status: "closed" }).where(eq(orders.id, id));
    await recordChange(tx, {
      actorId,
      action: "order.closed",
      entityType: "order",
      entityId: id,
      before: { status: order.status },
      after: { status: "closed" },
      reason,
    });
    return { id };
  });
}
export async function createCertificate(
  data: z.infer<typeof certificateInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "work.certificate", key, data, async () => {
      const order = await lockOrder(tx, data.orderId);
      if (order.execution !== "works" || order.createdBy === actorId)
        throw new DomainError("DUTY_CONFLICT");
      unique(data.lines.map(l => l.orderLineId));
      const computed = [];
      for (const line of data.lines) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        if (!source || source.orderId !== order.id)
          throw new DomainError("INVALID_REFERENCE");
        const [allocated] = await tx
          .select({
            q: sql<string>`COALESCE(SUM(${f.workCertificateLines.quantity}),0)`,
          })
          .from(f.workCertificateLines)
          .innerJoin(
            f.workCertificates,
            eq(f.workCertificateLines.certificateId, f.workCertificates.id)
          )
          .where(
            and(
              eq(f.workCertificateLines.orderLineId, line.orderLineId),
              inArray(f.workCertificates.status, ["pending", "approved"])
            )
          );
        if (
          decimal(allocated.q) + decimal(line.quantity) >
          decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        computed.push({
          ...line,
          total: lineAmounts(
            line.quantity,
            source.unitPrice,
            source.discountPercent,
            source.taxPercent
          ).total,
        });
      }
      const total = sum(computed.map(l => l.total));
      const [record] = await tx
        .insert(f.workCertificates)
        .values({
          orderId: order.id,
          certificateDate: data.certificateDate,
          evidence: data.evidence,
          total,
          number: await allocateDocumentNumber(tx, "CERT"),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(f.workCertificateLines)
        .values(computed.map(l => ({ ...l, certificateId: record.id })));
      const workflowId = await workflow.start(
        tx,
        {
          entityType: "acceptance",
          entityId: record.id,
          amount: total,
          currency: order.currency,
          department: order.department,
          requesterId: actorId,
          blockedActorIds: [order.createdBy],
        },
        actorId
      );
      await tx
        .update(f.workCertificates)
        .set({ workflowId })
        .where(eq(f.workCertificates.id, record.id));
      await recordChange(tx, {
        actorId,
        action: "work.certificate.created",
        entityType: "acceptance",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function decideCertificate(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.workCertificates)
      .where(eq(f.workCertificates.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const order = await lockOrder(tx, ref.orderId);
    const [certificate] = await tx
      .select()
      .from(f.workCertificates)
      .where(eq(f.workCertificates.id, id))
      .for("update");
    if (
      certificate.status !== "pending" ||
      certificate.workflowId !== instanceId
    )
      throw new DomainError("INVALID_TRANSITION");
    if (order.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "acceptance",
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (status === "approved") {
      const lines = await tx
        .select({ work: f.workCertificateLines, line: orderLines })
        .from(f.workCertificateLines)
        .innerJoin(
          orderLines,
          eq(f.workCertificateLines.orderLineId, orderLines.id)
        )
        .where(eq(f.workCertificateLines.certificateId, id));
      for (const { work, line } of lines)
        await postBudget(
          tx,
          {
            budgetId: line.budgetId,
            metric: "received",
            amount: work.total,
            sourceType: "acceptance",
            sourceId: id,
            sourceLineId: work.id,
            eventKey: "CERT:" + work.id,
            actorId,
          },
          order.currency
        );
    }
    await tx
      .update(f.workCertificates)
      .set({ status })
      .where(eq(f.workCertificates.id, id));
    await recordChange(tx, {
      actorId,
      action: "work.certificate." + action,
      entityType: "acceptance",
      entityId: id,
      after: { status },
      reason,
    });
    return { id };
  });
}
export async function cancelInvoice(
  id: number,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    await lockOrder(tx, ref.orderId);
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id))
      .for("update");
    if (
      invoice.createdBy !== actorId ||
      !["draft", "blocked", "matched", "returned", "rejected"].includes(
        invoice.status
      )
    )
      throw new DomainError("INVALID_TRANSITION");
    await tx
      .update(f.invoices)
      .set({ status: "cancelled" })
      .where(eq(f.invoices.id, id));
    await recordChange(tx, {
      actorId,
      action: "invoice.cancelled",
      entityType: "invoice",
      entityId: id,
      before: { status: invoice.status },
      after: { status: "cancelled" },
      reason,
    });
    return { id };
  });
}
export async function createCredit(
  data: z.infer<typeof creditInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "credit.create", key, data, async () => {
      const [invoice] = await tx
        .select()
        .from(f.invoices)
        .where(eq(f.invoices.id, data.invoiceId));
      if (!invoice || invoice.status !== "approved")
        throw new DomainError("INVALID_REFERENCE");
      const order = await lockOrder(tx, invoice.orderId);
      if (data.returnId) {
        const [returned] = await tx
          .select()
          .from(supplierReturns)
          .where(eq(supplierReturns.id, data.returnId));
        const [receipt] = returned
          ? await tx
              .select()
              .from(goodsReceipts)
              .where(eq(goodsReceipts.id, returned.receiptId))
          : [];
        if (!returned || receipt?.orderId !== order.id)
          throw new DomainError("INVALID_REFERENCE");
      }
      unique(data.lines.map(l => l.invoiceLineId));
      const computed = [];
      for (const line of data.lines) {
        const [source] = await tx
          .select()
          .from(f.invoiceLines)
          .where(eq(f.invoiceLines.id, line.invoiceLineId));
        if (!source || source.invoiceId !== invoice.id)
          throw new DomainError("INVALID_REFERENCE");
        const prior = await tx
          .select({ line: f.creditLines })
          .from(f.creditLines)
          .innerJoin(
            f.creditNotes,
            eq(f.creditLines.creditId, f.creditNotes.id)
          )
          .where(
            and(
              eq(f.creditLines.invoiceLineId, line.invoiceLineId),
              inArray(f.creditNotes.status, ["pending", "approved"])
            )
          );
        const allocated = prior.reduce(
          (n, r) => n + decimal(r.line.quantity),
          0n
        );
        if (allocated + decimal(line.quantity) > decimal(source.quantity))
          throw new DomainError("QUANTITY_EXCEEDED");
        const total =
          allocated + decimal(line.quantity) === decimal(source.quantity)
            ? formatDecimal(
                decimal(source.total) -
                  prior.reduce((n, r) => n + decimal(r.line.total), 0n)
              )
            : lineAmounts(
                line.quantity,
                source.unitPrice,
                source.discountPercent,
                source.taxPercent
              ).total;
        computed.push({ ...line, total });
      }
      const total = sum(computed.map(l => l.total)),
        retentionCredit = formatDecimal(
          roundedDivide(
            multiply(decimal(total), decimal(invoice.retentionPercent)),
            100n
          )
        );
      const [record] = await tx
        .insert(f.creditNotes)
        .values({
          ...data,
          supplierId: invoice.supplierId,
          total,
          retentionCredit,
          number: await allocateDocumentNumber(tx, "CR"),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(f.creditLines)
        .values(computed.map(l => ({ ...l, creditId: record.id })));
      const workflowId = await workflow.start(
        tx,
        {
          entityType: "credit",
          entityId: record.id,
          amount: total,
          currency: order.currency,
          department: order.department,
          requesterId: actorId,
          blockedActorIds: [invoice.createdBy],
        },
        actorId
      );
      await tx
        .update(f.creditNotes)
        .set({ workflowId })
        .where(eq(f.creditNotes.id, record.id));
      await recordChange(tx, {
        actorId,
        action: "credit.created",
        entityType: "credit",
        entityId: record.id,
        after: data,
        reason: data.reason,
      });
      return record;
    })
  );
}
export async function decideCredit(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [credit] = await tx
      .select()
      .from(f.creditNotes)
      .where(eq(f.creditNotes.id, id));
    if (!credit) throw new DomainError("NOT_FOUND");
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, credit.invoiceId));
    const order = await lockOrder(tx, invoice.orderId);
    const [current] = await tx
      .select()
      .from(f.creditNotes)
      .where(eq(f.creditNotes.id, id))
      .for("update");
    if (current.status !== "pending" || current.workflowId !== instanceId)
      throw new DomainError("INVALID_TRANSITION");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "credit",
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (status === "approved") {
      const lines = await tx
        .select({
          credit: f.creditLines,
          invoice: f.invoiceLines,
          line: orderLines,
        })
        .from(f.creditLines)
        .innerJoin(
          f.invoiceLines,
          eq(f.creditLines.invoiceLineId, f.invoiceLines.id)
        )
        .innerJoin(orderLines, eq(f.invoiceLines.orderLineId, orderLines.id))
        .where(eq(f.creditLines.creditId, id));
      for (const row of lines)
        await postBudget(
          tx,
          {
            budgetId: row.line.budgetId,
            metric: "actual",
            amount: formatDecimal(-decimal(row.credit.total)),
            sourceType: "credit",
            sourceId: id,
            sourceLineId: row.credit.id,
            eventKey: "CR:" + row.credit.id,
            actorId,
          },
          order.currency
        );
    }
    await tx
      .update(f.creditNotes)
      .set({ status })
      .where(eq(f.creditNotes.id, id));
    await recordChange(tx, {
      actorId,
      action: "credit." + action,
      entityType: "credit",
      entityId: id,
      after: { status },
      reason,
    });
    return { id };
  });
}
export async function releaseRetention(
  invoiceId: number,
  evidence: string,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      actorId,
      "retention.release",
      key,
      { invoiceId, evidence },
      async () => {
        const [invoice] = await tx
          .select()
          .from(f.invoices)
          .where(eq(f.invoices.id, invoiceId));
        if (!invoice || invoice.status !== "approved")
          throw new DomainError("INVALID_REFERENCE");
        const order = await lockOrder(tx, invoice.orderId),
          balance = await invoiceBalance(tx, invoiceId);
        if (decimal(balance.retained) <= 0n)
          throw new DomainError("INVALID_TRANSITION");
        const [record] = await tx
          .insert(f.retentionReleases)
          .values({
            invoiceId,
            amount: balance.retained,
            evidence,
            createdBy: actorId,
          })
          .$returningId();
        const workflowId = await workflow.start(
          tx,
          {
            entityType: "retention",
            entityId: record.id,
            amount: balance.retained,
            currency: order.currency,
            department: order.department,
            requesterId: actorId,
            blockedActorIds: [invoice.createdBy],
          },
          actorId
        );
        await tx
          .update(f.retentionReleases)
          .set({ workflowId })
          .where(eq(f.retentionReleases.id, record.id));
        await recordChange(tx, {
          actorId,
          action: "retention.requested",
          entityType: "retention",
          entityId: record.id,
          after: { invoiceId, amount: balance.retained, evidence },
        });
        return record;
      }
    )
  );
}
export async function decideRetention(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.retentionReleases)
      .where(eq(f.retentionReleases.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, ref.invoiceId));
    await lockOrder(tx, invoice.orderId);
    const [release] = await tx
      .select()
      .from(f.retentionReleases)
      .where(eq(f.retentionReleases.id, id))
      .for("update");
    if (release.status !== "pending" || release.workflowId !== instanceId)
      throw new DomainError("INVALID_TRANSITION");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "retention",
      entityId: id,
      actorId,
      action,
      reason,
    });
    await tx
      .update(f.retentionReleases)
      .set({ status: status === "approved" ? "posted" : status })
      .where(eq(f.retentionReleases.id, id));
    await recordChange(tx, {
      actorId,
      action: "retention." + action,
      entityType: "retention",
      entityId: id,
      after: { status },
      reason,
    });
    return { id };
  });
}
const sum = (amounts: string[]) =>
  formatDecimal(amounts.reduce((a, b) => a + decimal(b), 0n));
function unique(ids: number[]) {
  if (new Set(ids).size !== ids.length) throw new DomainError("INVALID_INPUT");
}
async function lockOrder(tx: Transaction, id: number) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .for("update");
  if (!order || order.status !== "approved")
    throw new DomainError("INVALID_TRANSITION");
  return order;
}
export async function eligibleQuantity(
  tx: Transaction,
  orderLineId: number,
  excludeInvoiceId?: number
) {
  const [accepted] = await tx
    .select({
      q: sql<string>`CAST(COALESCE(SUM((${receiptAllocations.accepted}-${receiptAllocations.returnedAccepted})/${receiptLines.factor}),0) AS DECIMAL(18,6))`,
    })
    .from(receiptAllocations)
    .innerJoin(
      receiptLines,
      eq(receiptAllocations.receiptLineId, receiptLines.id)
    )
    .where(eq(receiptLines.orderLineId, orderLineId));
  const invoiceRows = await tx
    .select({ line: f.invoiceLines, invoiceId: f.invoices.id })
    .from(f.invoiceLines)
    .innerJoin(f.invoices, eq(f.invoiceLines.invoiceId, f.invoices.id))
    .where(
      and(
        eq(f.invoiceLines.orderLineId, orderLineId),
        inArray(f.invoices.status, ["matched", "pending", "approved"])
      )
    );
  let invoiced = 0n;
  for (const row of invoiceRows) {
    if (row.invoiceId === excludeInvoiceId) continue;
    invoiced += decimal(row.line.quantity);
    const [credited] = await tx
      .select({ q: sql<string>`COALESCE(SUM(${f.creditLines.quantity}),0)` })
      .from(f.creditLines)
      .innerJoin(f.creditNotes, eq(f.creditLines.creditId, f.creditNotes.id))
      .where(
        and(
          eq(f.creditLines.invoiceLineId, row.line.id),
          eq(f.creditNotes.status, "approved")
        )
      );
    invoiced -= decimal(credited.q);
  }
  const [work] = await tx
    .select({
      q: sql<string>`COALESCE(SUM(${f.workCertificateLines.quantity}),0)`,
    })
    .from(f.workCertificateLines)
    .innerJoin(
      f.workCertificates,
      eq(f.workCertificateLines.certificateId, f.workCertificates.id)
    )
    .where(
      and(
        eq(f.workCertificateLines.orderLineId, orderLineId),
        eq(f.workCertificates.status, "approved")
      )
    );
  return formatDecimal(decimal(accepted.q) + decimal(work.q) - invoiced, 6);
}
async function matchLocked(
  tx: Transaction,
  invoice: typeof f.invoices.$inferSelect,
  actorId: number,
  saveHistory = true
) {
  const lines = await tx
    .select()
    .from(f.invoiceLines)
    .where(eq(f.invoiceLines.invoiceId, invoice.id));
  const issues: Array<{
    lineId: number;
    result:
      | "matched"
      | "quantity_exceeded"
      | "price_mismatch"
      | "invalid_order";
    eligibleQuantity: string;
  }> = [];
  for (const line of lines) {
    const [source] = await tx
      .select()
      .from(orderLines)
      .where(eq(orderLines.id, line.orderLineId))
      .for("update");
    const eligible = await eligibleQuantity(tx, line.orderLineId, invoice.id);
    const result: (typeof issues)[number]["result"] =
      !source || source.orderId !== invoice.orderId
        ? "invalid_order"
        : decimal(line.quantity) > decimal(eligible)
          ? "quantity_exceeded"
          : decimal(line.unitPrice) !== decimal(source.unitPrice) ||
              decimal(line.discountPercent) !==
                decimal(source.discountPercent) ||
              decimal(line.taxPercent) !== decimal(source.taxPercent)
            ? "price_mismatch"
            : "matched";
    const row = { lineId: line.id, result, eligibleQuantity: eligible };
    issues.push(row);
    if (saveHistory)
      await tx.insert(f.invoiceMatches).values({
        invoiceId: invoice.id,
        invoiceLineId: line.id,
        eligibleQuantity: eligible,
        result,
        matchedBy: actorId,
      });
  }
  return {
    matched: issues.length > 0 && issues.every(i => i.result === "matched"),
    issues,
  };
}
async function invoiceActors(
  tx: Transaction,
  invoice: typeof f.invoices.$inferSelect
) {
  const rows = await tx
    .select({
      receiver: goodsReceipts.receivedBy,
      inspector: receiptAllocations.inspectedBy,
    })
    .from(f.invoiceLines)
    .innerJoin(
      receiptLines,
      eq(f.invoiceLines.orderLineId, receiptLines.orderLineId)
    )
    .innerJoin(goodsReceipts, eq(receiptLines.receiptId, goodsReceipts.id))
    .innerJoin(
      receiptAllocations,
      eq(receiptAllocations.receiptLineId, receiptLines.id)
    )
    .where(eq(f.invoiceLines.invoiceId, invoice.id));
  const works = await tx
    .select({ creator: f.workCertificates.createdBy })
    .from(f.invoiceLines)
    .innerJoin(
      f.workCertificateLines,
      eq(f.invoiceLines.orderLineId, f.workCertificateLines.orderLineId)
    )
    .innerJoin(
      f.workCertificates,
      eq(f.workCertificateLines.certificateId, f.workCertificates.id)
    )
    .where(
      and(
        eq(f.invoiceLines.invoiceId, invoice.id),
        eq(f.workCertificates.status, "approved")
      )
    );
  return [
    ...new Set([
      invoice.createdBy,
      ...works.map(w => w.creator),
      ...rows.flatMap(r => [r.receiver, ...(r.inspector ? [r.inspector] : [])]),
    ]),
  ];
}
export async function createInvoice(
  data: z.infer<typeof invoiceInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "invoice.create", key, data, async () => {
      const order = await lockOrder(tx, data.orderId);
      await activeSupplier(tx, order.supplierId);
      unique(data.lines.map(l => l.orderLineId));
      const computed = [];
      for (const line of data.lines) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        if (!source || source.orderId !== order.id)
          throw new DomainError("INVALID_REFERENCE");
        const amounts = lineAmounts(
          line.quantity,
          line.unitPrice,
          line.discountPercent,
          line.taxPercent
        );
        computed.push({
          ...line,
          subtotal: amounts.subtotal,
          taxAmount: amounts.tax,
          total: amounts.total,
        });
      }
      const { lines, ...header } = data;
      const total = sum(computed.map(l => l.total));
      const retentionAmount = formatDecimal(
        roundedDivide(
          multiply(decimal(total), decimal(data.retentionPercent)),
          100n
        )
      );
      const [record] = await tx
        .insert(f.invoices)
        .values({
          ...header,
          number: await allocateDocumentNumber(tx, "INV"),
          supplierId: order.supplierId,
          currency: order.currency,
          total,
          retentionAmount,
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(f.invoiceLines)
        .values(computed.map(l => ({ ...l, invoiceId: record.id })));
      await recordChange(tx, {
        actorId,
        action: "invoice.created",
        entityType: "invoice",
        entityId: record.id,
        after: { ...data, total, retentionAmount },
      });
      return record;
    })
  );
}
export async function matchInvoice(
  id: number,
  actorId: number,
  submit = false
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const order = await lockOrder(tx, ref.orderId);
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id))
      .for("update");
    if (
      !["draft", "blocked", "matched", "returned", "rejected"].includes(
        invoice.status
      )
    )
      throw new DomainError("INVALID_TRANSITION");
    if (submit && invoice.createdBy !== actorId)
      throw new DomainError("DUTY_CONFLICT");
    const result = await matchLocked(tx, invoice, actorId);
    let workflowId = invoice.workflowId;
    if (submit && result.matched)
      workflowId = await workflow.start(
        tx,
        {
          entityType: "invoice",
          entityId: id,
          amount: invoice.total,
          currency: invoice.currency,
          department: order.department,
          requesterId: invoice.createdBy,
          blockedActorIds: await invoiceActors(tx, invoice),
        },
        actorId
      );
    const status = result.matched
      ? submit
        ? "pending"
        : "matched"
      : "blocked";
    await tx
      .update(f.invoices)
      .set({ status, workflowId })
      .where(eq(f.invoices.id, id));
    await recordChange(tx, {
      actorId,
      action: submit ? "invoice.submitted" : "invoice.matched",
      entityType: "invoice",
      entityId: id,
      before: { status: invoice.status },
      after: { status, ...result },
    });
    return { id, status, ...result };
  });
}
export async function decideInvoice(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const order = await lockOrder(tx, ref.orderId);
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, id))
      .for("update");
    if (invoice.status !== "pending" || invoice.workflowId !== instanceId)
      throw new DomainError("INVALID_TRANSITION");
    if ((await invoiceActors(tx, invoice)).includes(actorId))
      throw new DomainError("DUTY_CONFLICT");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "invoice",
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (status === "approved") {
      if (!(await matchLocked(tx, invoice, actorId)).matched)
        throw new DomainError("MATCHING_FAILED");
      const lines = await tx
        .select()
        .from(f.invoiceLines)
        .where(eq(f.invoiceLines.invoiceId, id));
      for (const line of lines) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        await postBudget(
          tx,
          {
            budgetId: source.budgetId,
            metric: "actual",
            amount: line.total,
            sourceType: "invoice",
            sourceId: id,
            sourceLineId: line.id,
            eventKey: "INV:" + line.id + ":ACTUAL",
            actorId,
          },
          invoice.currency
        );
      }
    }
    await tx.update(f.invoices).set({ status }).where(eq(f.invoices.id, id));
    await recordChange(tx, {
      actorId,
      action: "invoice." + action,
      entityType: "invoice",
      entityId: id,
      before: { status: invoice.status },
      after: { status },
      reason,
    });
    return { id };
  });
}
export async function invoiceBalance(tx: Transaction, id: number) {
  const [invoice] = await tx
    .select()
    .from(f.invoices)
    .where(eq(f.invoices.id, id));
  if (!invoice) throw new DomainError("NOT_FOUND");
  const [credits] = await tx
    .select({
      amount: sql<string>`COALESCE(SUM(${f.creditNotes.total}),0)`,
      retention: sql<string>`COALESCE(SUM(${f.creditNotes.retentionCredit}),0)`,
    })
    .from(f.creditNotes)
    .where(
      and(eq(f.creditNotes.invoiceId, id), eq(f.creditNotes.status, "approved"))
    );
  const [paid] = await tx
    .select({ amount: sql<string>`COALESCE(SUM(${f.payments.amount}),0)` })
    .from(f.payments)
    .where(and(eq(f.payments.invoiceId, id), eq(f.payments.status, "posted")));
  const [release] = await tx
    .select()
    .from(f.retentionReleases)
    .where(
      and(
        eq(f.retentionReleases.invoiceId, id),
        eq(f.retentionReleases.status, "posted")
      )
    );
  const retention = release
    ? 0n
    : decimal(invoice.retentionAmount) - decimal(credits.retention);
  const outstanding =
    decimal(invoice.total) - decimal(credits.amount) - decimal(paid.amount);
  const due = outstanding - retention;
  return {
    total: invoice.total,
    credited: credits.amount,
    settled: paid.amount,
    retained: formatDecimal(retention),
    outstanding: formatDecimal(outstanding),
    due: formatDecimal(due > 0n ? due : 0n),
    supplierCredit: formatDecimal(outstanding < 0n ? -outstanding : 0n),
  };
}
export async function createSchedule(
  data: z.infer<typeof scheduleInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "payment.schedule", key, data, async () => {
      const order = await lockOrder(tx, data.orderId);
      if (
        data.milestones.reduce((n, m) => n + decimal(m.percent), 0n) !==
        100000000n
      )
        throw new DomainError("INVALID_INPUT");
      const [record] = await tx
        .insert(f.paymentSchedules)
        .values({ orderId: order.id, createdBy: actorId })
        .$returningId();
      let assigned = 0n;
      for (const [index, m] of data.milestones.entries()) {
        const amount =
          index === data.milestones.length - 1
            ? decimal(order.total) - assigned
            : decimal(
                formatDecimal(
                  roundedDivide(
                    multiply(decimal(order.total), decimal(m.percent)),
                    100n
                  )
                )
              );
        assigned += amount;
        await tx.insert(f.paymentMilestones).values({
          ...m,
          scheduleId: record.id,
          position: index + 1,
          amount: formatDecimal(amount),
          status: m.condition === "advance" ? "eligible" : "planned",
          conditionMetBy: m.condition === "advance" ? actorId : null,
        });
      }
      await recordChange(tx, {
        actorId,
        action: "payment.schedule.created",
        entityType: "payment_schedule",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function certifyMilestone(
  id: number,
  actorId: number,
  evidence: string
) {
  return (await database()).transaction(async tx => {
    const [m] = await tx
      .select()
      .from(f.paymentMilestones)
      .where(eq(f.paymentMilestones.id, id));
    if (!m) throw new DomainError("NOT_FOUND");
    const [schedule] = await tx
      .select()
      .from(f.paymentSchedules)
      .where(eq(f.paymentSchedules.id, m.scheduleId));
    await lockOrder(tx, schedule.orderId);
    const [milestone] = await tx
      .select()
      .from(f.paymentMilestones)
      .where(eq(f.paymentMilestones.id, id))
      .for("update");
    if (milestone.status !== "planned")
      throw new DomainError("INVALID_TRANSITION");
    if (schedule.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    if (milestone.condition === "accepted") {
      const lines = await tx
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, schedule.orderId));
      let value = 0n;
      for (const line of lines) {
        const [accepted] = await tx
          .select({
            q: sql<string>`CAST(COALESCE(SUM((${receiptAllocations.accepted}-${receiptAllocations.returnedAccepted})/${receiptLines.factor}),0) AS DECIMAL(18,6))`,
          })
          .from(receiptAllocations)
          .innerJoin(
            receiptLines,
            eq(receiptAllocations.receiptLineId, receiptLines.id)
          )
          .where(eq(receiptLines.orderLineId, line.id));
        const [work] = await tx
          .select({
            q: sql<string>`COALESCE(SUM(${f.workCertificateLines.quantity}),0)`,
          })
          .from(f.workCertificateLines)
          .innerJoin(
            f.workCertificates,
            eq(f.workCertificateLines.certificateId, f.workCertificates.id)
          )
          .where(
            and(
              eq(f.workCertificateLines.orderLineId, line.id),
              eq(f.workCertificates.status, "approved")
            )
          );
        accepted.q = formatDecimal(decimal(accepted.q) + decimal(work.q), 6);
        if (decimal(accepted.q) > 0n)
          value += decimal(
            lineAmounts(
              accepted.q,
              line.unitPrice,
              line.discountPercent,
              line.taxPercent
            ).total
          );
      }
      if (value < decimal(milestone.amount))
        throw new DomainError("MATCHING_FAILED");
    }
    await tx
      .update(f.paymentMilestones)
      .set({ status: "eligible", evidence, conditionMetBy: actorId })
      .where(eq(f.paymentMilestones.id, id));
    await recordChange(tx, {
      actorId,
      action: "payment.milestone.certified",
      entityType: "payment_milestone",
      entityId: id,
      before: { status: "planned" },
      after: { status: "eligible", evidence },
      reason: evidence,
    });
    return { id };
  });
}
async function checkPayment(
  tx: Transaction,
  payment: Pick<
    typeof f.payments.$inferSelect,
    | "id"
    | "orderId"
    | "invoiceId"
    | "milestoneId"
    | "sourceAdvanceId"
    | "kind"
    | "amount"
  >
) {
  if (decimal(payment.amount) <= 0n) throw new DomainError("INVALID_INPUT");
  const order = await lockOrder(tx, payment.orderId);
  if (payment.kind !== "recovery") {
    const cash = await tx
      .select()
      .from(f.payments)
      .where(
        and(
          eq(f.payments.orderId, order.id),
          inArray(f.payments.kind, ["advance", "invoice"]),
          inArray(f.payments.status, ["pending", "posted"])
        )
      );
    if (
      cash
        .filter(p => p.id !== payment.id)
        .reduce((n, p) => n + decimal(p.amount), 0n) +
        decimal(payment.amount) >
      decimal(order.total)
    )
      throw new DomainError("PAYMENT_EXCEEDED");
  }
  if (payment.kind === "advance") {
    if (payment.invoiceId || payment.sourceAdvanceId || !payment.milestoneId)
      throw new DomainError("INVALID_REFERENCE");
  } else {
    if (!payment.invoiceId) throw new DomainError("INVALID_REFERENCE");
    const [invoice] = await tx
      .select()
      .from(f.invoices)
      .where(eq(f.invoices.id, payment.invoiceId))
      .for("update");
    if (invoice?.status !== "approved" || invoice.orderId !== order.id)
      throw new DomainError("INVALID_REFERENCE");
    const due = await invoiceBalance(tx, invoice.id);
    const pending = await tx
      .select()
      .from(f.payments)
      .where(
        and(
          eq(f.payments.invoiceId, invoice.id),
          eq(f.payments.status, "pending")
        )
      );
    const reserved = pending
      .filter(p => p.id !== payment.id)
      .reduce((n, p) => n + decimal(p.amount), 0n);
    if (decimal(payment.amount) + reserved > decimal(due.due))
      throw new DomainError("PAYMENT_EXCEEDED");
  }
  if (payment.kind === "recovery") {
    if (!payment.sourceAdvanceId || payment.milestoneId)
      throw new DomainError("INVALID_REFERENCE");
    const [advance] = await tx
      .select()
      .from(f.payments)
      .where(eq(f.payments.id, payment.sourceAdvanceId))
      .for("update");
    if (
      !advance ||
      advance.kind !== "advance" ||
      advance.status !== "posted" ||
      advance.orderId !== order.id
    )
      throw new DomainError("INVALID_REFERENCE");
    const allocations = await tx
      .select()
      .from(f.payments)
      .where(
        and(
          eq(f.payments.sourceAdvanceId, advance.id),
          inArray(f.payments.status, ["pending", "posted"])
        )
      );
    if (
      allocations
        .filter(p => p.id !== payment.id)
        .reduce((n, p) => n + decimal(p.amount), 0n) +
        decimal(payment.amount) >
      decimal(advance.amount)
    )
      throw new DomainError("PAYMENT_EXCEEDED");
  } else {
    if (payment.sourceAdvanceId || !payment.milestoneId)
      throw new DomainError("INVALID_REFERENCE");
    const [m] = await tx
      .select()
      .from(f.paymentMilestones)
      .where(eq(f.paymentMilestones.id, payment.milestoneId))
      .for("update");
    if (
      !m ||
      m.status !== "eligible" ||
      m.dueDate > businessDate() ||
      (payment.kind === "advance") !== (m.condition === "advance")
    )
      throw new DomainError("INVALID_TRANSITION");
    const [schedule] = await tx
      .select()
      .from(f.paymentSchedules)
      .where(eq(f.paymentSchedules.id, m.scheduleId));
    if (schedule.orderId !== order.id)
      throw new DomainError("INVALID_REFERENCE");
    const allocated = await tx
      .select()
      .from(f.payments)
      .where(
        and(
          eq(f.payments.milestoneId, m.id),
          inArray(f.payments.status, ["pending", "posted"])
        )
      );
    if (
      allocated
        .filter(p => p.id !== payment.id)
        .reduce((n, p) => n + decimal(p.amount), 0n) +
        decimal(payment.amount) >
      decimal(m.amount)
    )
      throw new DomainError("PAYMENT_EXCEEDED");
  }
  return order;
}
export async function requestPayment(
  data: z.infer<typeof paymentInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "payment.request", key, data, async () => {
      const order = await checkPayment(tx, { ...data, id: 0 });
      const blockedActorIds: number[] = [];
      if (data.invoiceId) {
        const [invoice] = await tx
          .select()
          .from(f.invoices)
          .where(eq(f.invoices.id, data.invoiceId));
        blockedActorIds.push(invoice.createdBy);
      }
      const [record] = await tx
        .insert(f.payments)
        .values({
          ...data,
          number: await allocateDocumentNumber(tx, "PAY"),
          createdBy: actorId,
        })
        .$returningId();
      const workflowId = await workflow.start(
        tx,
        {
          entityType: "payment",
          entityId: record.id,
          amount: data.amount,
          currency: order.currency,
          department: order.department,
          requesterId: actorId,
          blockedActorIds,
        },
        actorId
      );
      await tx
        .update(f.payments)
        .set({ workflowId })
        .where(eq(f.payments.id, record.id));
      await recordChange(tx, {
        actorId,
        action: "payment.requested",
        entityType: "payment",
        entityId: record.id,
        after: { ...data, workflowId },
        reason: data.reason,
      });
      return record;
    })
  );
}
export async function decidePayment(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(f.payments)
      .where(eq(f.payments.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const order = await lockOrder(tx, ref.orderId);
    const [payment] = await tx
      .select()
      .from(f.payments)
      .where(eq(f.payments.id, id))
      .for("update");
    if (payment.status !== "pending" || payment.workflowId !== instanceId)
      throw new DomainError("INVALID_TRANSITION");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "payment",
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (status === "approved") {
      await checkPayment(tx, payment);
      if (payment.kind !== "recovery") {
        let distribution: Array<{
          line: typeof orderLines.$inferSelect;
          amount: string;
        }> = [];
        if (payment.invoiceId) {
          const lines = await tx
            .select({ invoice: f.invoiceLines, line: orderLines })
            .from(f.invoiceLines)
            .innerJoin(
              orderLines,
              eq(f.invoiceLines.orderLineId, orderLines.id)
            )
            .where(eq(f.invoiceLines.invoiceId, payment.invoiceId));
          distribution = lines.map(r => ({
            line: r.line,
            amount: r.invoice.total,
          }));
        } else
          distribution = (
            await tx
              .select()
              .from(orderLines)
              .where(eq(orderLines.orderId, order.id))
          ).map(line => ({ line, amount: line.total }));
        const total = distribution.reduce((n, l) => n + decimal(l.amount), 0n);
        if (total <= 0n) throw new DomainError("INVALID_INPUT");
        let allocated = 0n;
        for (const [index, row] of distribution.entries()) {
          const amount =
            index === distribution.length - 1
              ? decimal(payment.amount) - allocated
              : decimal(
                  formatDecimal(
                    roundedDivide(
                      decimal(payment.amount) * decimal(row.amount),
                      total
                    )
                  )
                );
          allocated += amount;
          await postBudget(
            tx,
            {
              budgetId: row.line.budgetId,
              metric: "paid",
              amount: formatDecimal(amount),
              sourceType: "payment",
              sourceId: id,
              sourceLineId: row.line.id,
              eventKey: "PAY:" + id + ":" + row.line.id,
              actorId,
            },
            order.currency
          );
        }
      }
    }
    await tx
      .update(f.payments)
      .set({ status: status === "approved" ? "posted" : status })
      .where(eq(f.payments.id, id));
    await recordChange(tx, {
      actorId,
      action: "payment." + action,
      entityType: "payment",
      entityId: id,
      before: { status: payment.status },
      after: { status: status === "approved" ? "posted" : status },
      reason,
    });
    return { id };
  });
}
