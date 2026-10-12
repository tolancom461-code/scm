import { and, eq, inArray, sql, asc } from "drizzle-orm";
import * as s from "../../../drizzle/procurement";
import {
  items,
  units,
  branches,
  sites,
  warehouses,
  costCenters,
  uomConversions,
} from "../../../drizzle/master-data";
import { suppliers } from "../../../drizzle/schema";
import { budgets, wbsNodes } from "../../../drizzle/projects";
import { workflowInstances } from "../../../drizzle/workflows";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { allocateDocumentNumber } from "../../core/numbering";
import { recordChange } from "../../core/audit";
import {
  decimal,
  formatDecimal,
  lineAmounts,
  roundedDivide,
} from "../../../shared/decimal";
import {
  requisitionInput,
  rfqInput,
  quotationInput,
  evaluationInput,
  awardInput,
  orderInput,
  directOrderInput,
} from "../../../shared/procurement";
import type { z } from "zod";
import * as workflow from "../workflows/service";
import { lockProject, postBudget } from "../projects/service";
const today = () => new Date().toISOString().slice(0, 10);
const sum = (values: string[]) =>
  formatDecimal(values.reduce((v, n) => v + decimal(n), 0n));
function unique(ids: number[]) {
  if (new Set(ids).size !== ids.length) throw new DomainError("INVALID_INPUT");
}
export async function activeSupplier(tx: Transaction, id: number) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .for("update");
  if (!supplier || supplier.status !== "active")
    throw new DomainError("INVALID_REFERENCE");
  return supplier;
}
export async function validateLine(
  tx: Transaction,
  line: z.infer<typeof requisitionInput>["lines"][number],
  branchId: number,
  currency: string
) {
  const project = await lockProject(tx, line.projectId);
  const [wbs] = await tx
    .select()
    .from(wbsNodes)
    .where(eq(wbsNodes.id, line.wbsId));
  const [budget] = await tx
    .select()
    .from(budgets)
    .where(eq(budgets.id, line.budgetId));
  const [item] = await tx
    .select()
    .from(items)
    .where(eq(items.id, line.itemId))
    .for("update");
  const [unit] = await tx
    .select()
    .from(units)
    .where(eq(units.id, line.uomId))
    .for("update");
  const [site] = await tx
    .select()
    .from(sites)
    .where(eq(sites.id, line.siteId))
    .for("update");
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(eq(warehouses.id, line.warehouseId))
    .for("update");
  const [center] = await tx
    .select()
    .from(costCenters)
    .where(eq(costCenters.id, line.costCenterId))
    .for("update");
  if (
    project.status !== "active" ||
    project.branchId !== branchId ||
    project.currency !== currency ||
    !wbs ||
    wbs.projectId !== project.id ||
    !budget ||
    budget.status !== "approved" ||
    budget.projectId !== project.id ||
    budget.wbsId !== wbs.id ||
    budget.costCenterId !== line.costCenterId ||
    !item?.active ||
    !unit?.active ||
    ![item.baseUomId, item.purchasingUomId].includes(unit.id) ||
    !site?.active ||
    site.branchId !== branchId ||
    !warehouse?.active ||
    warehouse.siteId !== site.id ||
    !center?.active ||
    center.branchId !== branchId
  )
    throw new DomainError("INVALID_REFERENCE");
  if (unit.id !== item.baseUomId) {
    const [conversion] = await tx
      .select()
      .from(uomConversions)
      .where(
        and(
          eq(uomConversions.itemId, item.id),
          eq(uomConversions.fromUomId, unit.id),
          eq(uomConversions.toUomId, item.baseUomId),
          eq(uomConversions.active, true)
        )
      );
    if (!conversion) throw new DomainError("INVALID_REFERENCE");
  }
}
export async function createRequisition(
  data: z.infer<typeof requisitionInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.requisition.create", key, data, async () => {
      const [branch] = await tx
        .select()
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .for("update");
      if (!branch?.active) throw new DomainError("INVALID_REFERENCE");
      for (const line of [...data.lines].sort(
        (a, b) => a.projectId - b.projectId
      ))
        await validateLine(tx, line, data.branchId, data.currency);
      const computed = data.lines.map((l, i) => ({
        ...l,
        position: i + 1,
        amount: lineAmounts(l.quantity, l.unitPrice).total,
      }));
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(s.requisitions)
        .values({
          ...header,
          number: await allocateDocumentNumber(tx, "PR"),
          total: sum(computed.map(l => l.amount)),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(s.requisitionLines)
        .values(computed.map(l => ({ ...l, requisitionId: record.id })));
      await recordChange(tx, {
        actorId,
        action: "requisition.created",
        entityType: "requisition",
        entityId: record.id,
        after: { ...data, total: sum(computed.map(l => l.amount)) },
      });
      return record;
    })
  );
}
export async function reviseRequisition(
  id: number,
  data: z.infer<typeof requisitionInput>,
  version: number,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [record] = await tx
      .select()
      .from(s.requisitions)
      .where(eq(s.requisitions.id, id))
      .for("update");
    if (!record) throw new DomainError("NOT_FOUND");
    if (record.createdBy !== actorId) throw new DomainError("DUTY_CONFLICT");
    if (!["draft", "returned", "rejected"].includes(record.status))
      throw new DomainError("INVALID_TRANSITION");
    if (record.version !== version) throw new DomainError("CONFLICT");
    for (const line of [...data.lines].sort(
      (a, b) => a.projectId - b.projectId
    ))
      await validateLine(tx, line, data.branchId, data.currency);
    const old = await tx
      .select()
      .from(s.requisitionLines)
      .where(eq(s.requisitionLines.requisitionId, id));
    const { lines, ...header } = data;
    const computed = lines.map((l, i) => ({
      ...l,
      position: i + 1,
      amount: lineAmounts(l.quantity, l.unitPrice).total,
    }));
    await tx
      .delete(s.requisitionLines)
      .where(eq(s.requisitionLines.requisitionId, id));
    await tx
      .insert(s.requisitionLines)
      .values(computed.map(l => ({ ...l, requisitionId: id })));
    await tx
      .update(s.requisitions)
      .set({
        ...header,
        total: sum(computed.map(l => l.amount)),
        status: "draft",
        version: version + 1,
      })
      .where(eq(s.requisitions.id, id));
    await recordChange(tx, {
      actorId,
      action: "requisition.revised",
      entityType: "requisition",
      entityId: id,
      before: { ...record, lines: old },
      after: data,
      reason,
    });
    return { id };
  });
}
export async function createRfq(
  data: z.infer<typeof rfqInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.rfq.create", key, data, async () => {
      unique(data.supplierIds);
      unique(data.lines.map(l => l.requisitionLineId));
      for (const id of [...data.supplierIds].sort((a, b) => a - b))
        await activeSupplier(tx, id);
      for (const line of [...data.lines].sort(
        (a, b) => a.requisitionLineId - b.requisitionLineId
      )) {
        const [source] = await tx
          .select()
          .from(s.requisitionLines)
          .where(eq(s.requisitionLines.id, line.requisitionLineId))
          .for("update");
        if (!source) throw new DomainError("INVALID_REFERENCE");
        const [request] = await tx
          .select()
          .from(s.requisitions)
          .where(eq(s.requisitions.id, source.requisitionId));
        if (
          request?.status !== "approved" ||
          request.currency !== data.currency
        )
          throw new DomainError("INVALID_REFERENCE");
        const [allocated] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${s.rfqLines.quantity}),0)`,
          })
          .from(s.rfqLines)
          .innerJoin(s.sourcingRfqs, eq(s.rfqLines.rfqId, s.sourcingRfqs.id))
          .where(
            and(
              eq(s.rfqLines.requisitionLineId, source.id),
              inArray(s.sourcingRfqs.status, ["draft", "open", "closed"])
            )
          );
        if (
          decimal(allocated.value) + decimal(line.quantity) >
          decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
      }
      const { lines, supplierIds, ...header } = data;
      const [record] = await tx
        .insert(s.sourcingRfqs)
        .values({
          ...header,
          number: await allocateDocumentNumber(tx, "RFQ"),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(s.rfqLines)
        .values(lines.map(l => ({ ...l, rfqId: record.id })));
      await tx
        .insert(s.rfqSuppliers)
        .values(
          supplierIds.map(supplierId => ({ supplierId, rfqId: record.id }))
        );
      await recordChange(tx, {
        actorId,
        action: "rfq.created",
        entityType: "rfq",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function rfqStatus(
  id: number,
  status: "open" | "closed" | "cancelled",
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [record] = await tx
      .select()
      .from(s.sourcingRfqs)
      .where(eq(s.sourcingRfqs.id, id))
      .for("update");
    if (!record) throw new DomainError("NOT_FOUND");
    const allowed: Record<string, string[]> = {
      draft: ["open", "cancelled"],
      open: ["closed", "cancelled"],
    };
    if (!allowed[record.status]?.includes(status))
      throw new DomainError("INVALID_TRANSITION");
    if (status === "cancelled") {
      const [a] = await tx
        .select()
        .from(s.sourcingAwards)
        .where(
          and(
            eq(s.sourcingAwards.rfqId, id),
            inArray(s.sourcingAwards.status, ["draft", "pending", "approved"])
          )
        );
      if (a) throw new DomainError("INVALID_TRANSITION");
    }
    await tx
      .update(s.sourcingRfqs)
      .set({ status })
      .where(eq(s.sourcingRfqs.id, id));
    await recordChange(tx, {
      actorId,
      action: "rfq.status",
      entityType: "rfq",
      entityId: id,
      before: { status: record.status },
      after: { status },
      reason,
    });
    return { id };
  });
}
export async function createQuotation(
  data: z.infer<typeof quotationInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.quotation.create", key, data, async () => {
      const [rfq] = await tx
        .select()
        .from(s.sourcingRfqs)
        .where(eq(s.sourcingRfqs.id, data.rfqId))
        .for("update");
      if (
        !rfq ||
        rfq.status !== "open" ||
        rfq.currency !== data.currency ||
        today() < rfq.opensAt ||
        today() > rfq.closesAt ||
        data.validUntil < today()
      )
        throw new DomainError("INVALID_TRANSITION");
      await activeSupplier(tx, data.supplierId);
      const [invited] = await tx
        .select()
        .from(s.rfqSuppliers)
        .where(
          and(
            eq(s.rfqSuppliers.rfqId, rfq.id),
            eq(s.rfqSuppliers.supplierId, data.supplierId)
          )
        );
      if (!invited) throw new DomainError("INVALID_REFERENCE");
      unique(data.lines.map(l => l.rfqLineId));
      for (const line of data.lines) {
        const [source] = await tx
          .select()
          .from(s.rfqLines)
          .where(eq(s.rfqLines.id, line.rfqLineId));
        if (!source || source.rfqId !== rfq.id)
          throw new DomainError("INVALID_REFERENCE");
        if (decimal(line.quantity) > decimal(source.quantity))
          throw new DomainError("QUANTITY_EXCEEDED");
      }
      const computed = data.lines.map(l => {
        const amounts = lineAmounts(
          l.quantity,
          l.unitPrice,
          l.discountPercent,
          l.taxPercent
        );
        return {
          ...l,
          subtotal: amounts.subtotal,
          taxAmount: amounts.tax,
          total: amounts.total,
        };
      });
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(s.supplierQuotations)
        .values({
          ...header,
          number: await allocateDocumentNumber(tx, "QUO"),
          total: sum(computed.map(l => l.total)),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(s.quotationLines)
        .values(computed.map(l => ({ ...l, quotationId: record.id })));
      await recordChange(tx, {
        actorId,
        action: "quotation.created",
        entityType: "quotation",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function evaluate(
  data: z.infer<typeof evaluationInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const [quote] = await tx
      .select()
      .from(s.supplierQuotations)
      .where(eq(s.supplierQuotations.id, data.quotationId))
      .for("update");
    if (!quote || quote.status !== "received")
      throw new DomainError("INVALID_TRANSITION");
    if (quote.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    const overall = formatDecimal(
      roundedDivide(
        BigInt(
          data.technical * 50 + data.commercial * 30 + data.delivery * 20
        ) * 1000000n,
        100n
      )
    );
    const [record] = await tx
      .insert(s.quotationEvaluations)
      .values({ ...data, overall, evaluatedBy: actorId })
      .$returningId();
    await tx
      .update(s.supplierQuotations)
      .set({ status: data.eligible === "yes" ? "evaluated" : "disqualified" })
      .where(eq(s.supplierQuotations.id, quote.id));
    await recordChange(tx, {
      actorId,
      action: "quotation.evaluated",
      entityType: "quotation",
      entityId: quote.id,
      after: { ...data, overall },
      reason: data.reason,
    });
    return record;
  });
}
export async function createAward(
  data: z.infer<typeof awardInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.award.create", key, data, async () => {
      const [rfq] = await tx
        .select()
        .from(s.sourcingRfqs)
        .where(eq(s.sourcingRfqs.id, data.rfqId))
        .for("update");
      if (!rfq || rfq.status !== "closed")
        throw new DomainError("INVALID_TRANSITION");
      unique(data.lines.map(l => l.quotationLineId));
      const computed = [];
      const proposed = new Map<number, bigint>();
      for (const line of data.lines) {
        const [qline] = await tx
          .select()
          .from(s.quotationLines)
          .where(eq(s.quotationLines.id, line.quotationLineId));
        if (!qline) throw new DomainError("INVALID_REFERENCE");
        const [quote] = await tx
          .select()
          .from(s.supplierQuotations)
          .where(eq(s.supplierQuotations.id, qline.quotationId));
        if (
          !quote ||
          quote.rfqId !== rfq.id ||
          quote.status !== "evaluated" ||
          quote.validUntil < today()
        )
          throw new DomainError("INVALID_REFERENCE");
        await activeSupplier(tx, quote.supplierId);
        const [source] = await tx
          .select()
          .from(s.rfqLines)
          .where(eq(s.rfqLines.id, qline.rfqLineId))
          .for("update");
        const [allocated] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${s.awardLines.quantity}),0)`,
          })
          .from(s.awardLines)
          .innerJoin(
            s.sourcingAwards,
            eq(s.awardLines.awardId, s.sourcingAwards.id)
          )
          .innerJoin(
            s.quotationLines,
            eq(s.awardLines.quotationLineId, s.quotationLines.id)
          )
          .where(
            and(
              eq(s.quotationLines.rfqLineId, source.id),
              inArray(s.sourcingAwards.status, [
                "draft",
                "pending",
                "approved",
                "returned",
              ])
            )
          );
        const used = (proposed.get(source.id) ?? 0n) + decimal(line.quantity);
        if (
          decimal(line.quantity) > decimal(qline.quantity) ||
          decimal(allocated.value) + used > decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        proposed.set(source.id, used);
        computed.push({
          ...line,
          total: lineAmounts(
            line.quantity,
            qline.unitPrice,
            qline.discountPercent,
            qline.taxPercent
          ).total,
        });
      }
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(s.sourcingAwards)
        .values({
          ...header,
          currency: rfq.currency,
          number: await allocateDocumentNumber(tx, "AWD"),
          total: sum(computed.map(l => l.total)),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(s.awardLines)
        .values(computed.map(l => ({ ...l, awardId: record.id })));
      await recordChange(tx, {
        actorId,
        action: "award.created",
        entityType: "award",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function createOrder(
  data: z.infer<typeof orderInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.order.create", key, data, async () => {
      await activeSupplier(tx, data.supplierId);
      unique(data.lines.map(l => l.awardLineId));
      let currency: string | undefined;
      const computed = [];
      for (const line of [...data.lines].sort(
        (a, b) => a.awardLineId - b.awardLineId
      )) {
        const [awardLine] = await tx
          .select()
          .from(s.awardLines)
          .where(eq(s.awardLines.id, line.awardLineId))
          .for("update");
        if (!awardLine) throw new DomainError("INVALID_REFERENCE");
        const [award] = await tx
          .select()
          .from(s.sourcingAwards)
          .where(eq(s.sourcingAwards.id, awardLine.awardId));
        if (award?.status !== "approved")
          throw new DomainError("INVALID_TRANSITION");
        const [quoteLine] = await tx
          .select()
          .from(s.quotationLines)
          .where(eq(s.quotationLines.id, awardLine.quotationLineId));
        const [quote] = await tx
          .select()
          .from(s.supplierQuotations)
          .where(eq(s.supplierQuotations.id, quoteLine.quotationId));
        if (quote.supplierId !== data.supplierId)
          throw new DomainError("INVALID_REFERENCE");
        if (currency && currency !== award.currency)
          throw new DomainError("INVALID_REFERENCE");
        currency = award.currency;
        const [rfqLine] = await tx
          .select()
          .from(s.rfqLines)
          .where(eq(s.rfqLines.id, quoteLine.rfqLineId));
        const [requestLine] = await tx
          .select()
          .from(s.requisitionLines)
          .where(eq(s.requisitionLines.id, rfqLine.requisitionLineId));
        const [allocated] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${s.orderLines.quantity}),0)`,
          })
          .from(s.orderLines)
          .innerJoin(s.orders, eq(s.orderLines.orderId, s.orders.id))
          .where(
            and(
              eq(s.orderLines.awardLineId, awardLine.id),
              inArray(s.orders.status, [
                "draft",
                "pending",
                "approved",
                "returned",
                "closed",
              ])
            )
          );
        if (
          decimal(allocated.value) + decimal(line.quantity) >
          decimal(awardLine.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        if (
          line.schedules.reduce((n, x) => n + decimal(x.quantity), 0n) !==
          decimal(line.quantity)
        )
          throw new DomainError("INVALID_INPUT");
        for (const schedule of line.schedules) {
          const [warehouse] = await tx
            .select()
            .from(warehouses)
            .where(eq(warehouses.id, schedule.warehouseId));
          const [site] = await tx
            .select()
            .from(sites)
            .where(eq(sites.id, schedule.siteId));
          const project = await lockProject(tx, requestLine.projectId);
          if (
            !warehouse?.active ||
            warehouse.siteId !== schedule.siteId ||
            !site?.active ||
            site.branchId !== project.branchId
          )
            throw new DomainError("INVALID_REFERENCE");
        }
        const amounts = lineAmounts(
          line.quantity,
          quoteLine.unitPrice,
          quoteLine.discountPercent,
          quoteLine.taxPercent
        );
        computed.push({
          awardLineId: awardLine.id,
          itemId: requestLine.itemId,
          uomId: requestLine.uomId,
          description: requestLine.description,
          quantity: line.quantity,
          unitPrice: quoteLine.unitPrice,
          discountPercent: quoteLine.discountPercent,
          taxPercent: quoteLine.taxPercent,
          subtotal: amounts.subtotal,
          taxAmount: amounts.tax,
          total: amounts.total,
          projectId: requestLine.projectId,
          wbsId: requestLine.wbsId,
          costCenterId: requestLine.costCenterId,
          budgetId: requestLine.budgetId,
          schedules: line.schedules,
        });
      }
      if (!currency) throw new DomainError("INVALID_INPUT");
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(s.orders)
        .values({
          ...header,
          currency,
          number: await allocateDocumentNumber(tx, "PO"),
          total: sum(computed.map(l => l.total)),
          createdBy: actorId,
        })
        .$returningId();
      for (const line of computed) {
        const { schedules, ...values } = line;
        const [stored] = await tx
          .insert(s.orderLines)
          .values({ ...values, orderId: record.id })
          .$returningId();
        await tx
          .insert(s.orderSchedules)
          .values(
            schedules.map(schedule => ({ ...schedule, orderLineId: stored.id }))
          );
      }
      await recordChange(tx, {
        actorId,
        action: "order.created",
        entityType: "order",
        entityId: record.id,
        after: { ...data, total: sum(computed.map(l => l.total)) },
      });
      return record;
    })
  );
}
export const approvalTables = {
  requisition: s.requisitions,
  award: s.sourcingAwards,
  order: s.orders,
};
export async function cancelOrder(id: number, actorId: number, reason: string) {
  return (await database()).transaction(async tx => {
    const [order] = await tx
      .select()
      .from(s.orders)
      .where(eq(s.orders.id, id))
      .for("update");
    if (!order) throw new DomainError("NOT_FOUND");
    if (
      order.createdBy !== actorId ||
      !["draft", "returned", "rejected"].includes(order.status)
    )
      throw new DomainError("INVALID_TRANSITION");
    await tx
      .update(s.orders)
      .set({ status: "cancelled" })
      .where(eq(s.orders.id, id));
    await recordChange(tx, {
      actorId,
      action: "order.cancelled",
      entityType: "order",
      entityId: id,
      before: { status: order.status },
      after: { status: "cancelled" },
      reason,
    });
    return { id };
  });
}
export async function createDirectOrder(
  data: z.infer<typeof directOrderInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "order.direct", key, data, async () => {
      await activeSupplier(tx, data.supplierId);
      const computed = [];
      for (const line of [...data.lines].sort(
        (a, b) => a.projectId - b.projectId
      )) {
        await validateLine(tx, line, data.branchId, data.currency);
        const [item] = await tx
          .select()
          .from(items)
          .where(eq(items.id, line.itemId));
        if ((data.execution === "works") !== (item.type === "service"))
          throw new DomainError("INVALID_REFERENCE");
        const amounts = lineAmounts(
          line.quantity,
          line.unitPrice,
          line.discountPercent,
          line.taxPercent
        );
        computed.push({ line, amounts });
      }
      const [record] = await tx
        .insert(s.orders)
        .values({
          title: data.title,
          execution: data.execution,
          contractReference: data.contractReference || null,
          supplierId: data.supplierId,
          currency: data.currency,
          department: data.department,
          paymentTerms: data.paymentTerms,
          deliveryTerms: data.deliveryTerms,
          total: sum(computed.map(l => l.amounts.total)),
          number: await allocateDocumentNumber(
            tx,
            data.execution === "works" ? "WO" : "PO"
          ),
          createdBy: actorId,
        })
        .$returningId();
      for (const { line, amounts } of computed) {
        const { id } = (
          await tx
            .insert(s.orderLines)
            .values({
              orderId: record.id,
              itemId: line.itemId,
              uomId: line.uomId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              taxPercent: line.taxPercent,
              subtotal: amounts.subtotal,
              taxAmount: amounts.tax,
              total: amounts.total,
              projectId: line.projectId,
              wbsId: line.wbsId,
              costCenterId: line.costCenterId,
              budgetId: line.budgetId,
            })
            .$returningId()
        )[0];
        await tx.insert(s.orderSchedules).values({
          orderLineId: id,
          quantity: line.quantity,
          dueDate: line.requiredDate,
          siteId: line.siteId,
          warehouseId: line.warehouseId,
        });
      }
      await recordChange(tx, {
        actorId,
        action: "order.direct.created",
        entityType: "order",
        entityId: record.id,
        after: data,
        reason: data.reason,
      });
      return record;
    })
  );
}
export async function submit(
  type: keyof typeof approvalTables,
  id: number,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const table = approvalTables[type];
    const [record] = await tx
      .select()
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!record) throw new DomainError("NOT_FOUND");
    if (record.createdBy !== actorId) throw new DomainError("DUTY_CONFLICT");
    if (!["draft", "returned"].includes(record.status))
      throw new DomainError("INVALID_TRANSITION");
    if (type === "requisition") {
      const req = record as typeof s.requisitions.$inferSelect;
      const lines = await tx
        .select()
        .from(s.requisitionLines)
        .where(eq(s.requisitionLines.requisitionId, id));
      for (const line of [...lines].sort((a, b) => a.projectId - b.projectId))
        await validateLine(
          tx,
          { ...line, specification: line.specification ?? "" },
          req.branchId,
          req.currency
        );
    }
    const workflowId = await workflow.start(
      tx,
      {
        entityType: type,
        entityId: id,
        amount: record.total,
        currency: record.currency,
        department: record.department,
        requesterId: record.createdBy,
      },
      actorId
    );
    await tx
      .update(table)
      .set({ status: "pending", workflowId })
      .where(eq(table.id, id));
    await recordChange(tx, {
      actorId,
      action: type + ".submitted",
      entityType: type,
      entityId: id,
      before: { status: record.status },
      after: { status: "pending", workflowId },
    });
    return { id };
  });
}
export async function decide(
  type: keyof typeof approvalTables,
  id: number,
  instanceId: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string,
  expectedPosition: number = 1
) {
  return (await database()).transaction(async tx => {
    const table = approvalTables[type];
    const [record] = await tx
      .select()
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!record || record.workflowId !== instanceId)
      throw new DomainError("INVALID_REFERENCE");
    if (record.status !== "pending")
      throw new DomainError("INVALID_TRANSITION");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: type,
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (type === "order" && status === "approved") {
      await activeSupplier(
        tx,
        (record as typeof s.orders.$inferSelect).supplierId
      );
      const lines = await tx
        .select()
        .from(s.orderLines)
        .where(eq(s.orderLines.orderId, id))
        .orderBy(asc(s.orderLines.projectId), asc(s.orderLines.id));
      for (const line of lines)
        await postBudget(
          tx,
          {
            budgetId: line.budgetId,
            metric: "commitment",
            amount: line.total,
            sourceType: "order",
            sourceId: id,
            sourceLineId: line.id,
            eventKey: "PO:" + line.id + ":COMMIT",
            actorId,
          },
          record.currency
        );
    }
    await tx.update(table).set({ status }).where(eq(table.id, id));
    await recordChange(tx, {
      actorId,
      action: type + "." + action,
      entityType: type,
      entityId: id,
      before: { status: record.status },
      after: { status },
      reason,
    });
    return { id };
  });
}
