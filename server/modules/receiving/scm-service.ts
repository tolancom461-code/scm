import { and, eq, inArray, sql, asc } from "drizzle-orm";
import * as r from "../../../drizzle/receiving";
import {
  orders,
  orderLines,
  orderSchedules,
} from "../../../drizzle/procurement";
import {
  items,
  uomConversions,
  warehouseLocations,
  warehouses,
} from "../../../drizzle/master-data";
import { stockMovements } from "../../../drizzle/inventory";
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
  shipmentInput,
  receiptInput,
  inspectionInput,
  returnInput,
} from "../../../shared/receiving";
import type { z } from "zod";
import { activeSupplier } from "../procurement/scm-service";
import { postStock } from "../inventory/ledger";
import { postBudget } from "../projects/service";
import { eligibleQuantity } from "../finance-control/service";
function unique(ids: number[]) {
  if (new Set(ids).size !== ids.length) throw new DomainError("INVALID_INPUT");
}
async function lockOrder(tx: Transaction, id: number) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .for("update");
  if (!order || order.status !== "approved" || order.execution !== "goods")
    throw new DomainError("INVALID_TRANSITION");
  return order;
}
async function returnedForLine(tx: Transaction, id: number) {
  const [returned] = await tx
    .select({
      value: sql<string>`CAST(COALESCE(SUM((${r.receiptAllocations.returnedAccepted}+${r.receiptAllocations.returnedRejected}+${r.receiptAllocations.returnedQuarantine})/${r.receiptLines.factor}),0) AS DECIMAL(18,6))`,
    })
    .from(r.receiptAllocations)
    .innerJoin(
      r.receiptLines,
      eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
    )
    .where(eq(r.receiptLines.orderLineId, id));
  return decimal(returned.value);
}
async function location(
  tx: Transaction,
  id: number,
  warehouseId: number,
  type: string | string[]
) {
  const [row] = await tx
    .select()
    .from(warehouseLocations)
    .where(eq(warehouseLocations.id, id));
  if (
    !row?.active ||
    row.warehouseId !== warehouseId ||
    !(Array.isArray(type) ? type : [type]).includes(row.type)
  )
    throw new DomainError("INVALID_REFERENCE");
  return row;
}
export async function createShipment(
  data: z.infer<typeof shipmentInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.shipment.create", key, data, async () => {
      const order = await lockOrder(tx, data.orderId);
      await activeSupplier(tx, order.supplierId);
      unique(data.lines.map(l => l.orderLineId));
      for (const line of data.lines) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        if (!source || source.orderId !== order.id)
          throw new DomainError("INVALID_REFERENCE");
        const [prior] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${r.shipmentLines.quantity}),0)`,
          })
          .from(r.shipmentLines)
          .innerJoin(
            r.shipments,
            eq(r.shipmentLines.shipmentId, r.shipments.id)
          )
          .where(
            and(
              eq(r.shipmentLines.orderLineId, source.id),
              inArray(r.shipments.status, ["in_transit", "arrived"])
            )
          );
        if (
          decimal(prior.value) + decimal(line.quantity) >
          decimal(source.quantity) + (await returnedForLine(tx, source.id))
        )
          throw new DomainError("QUANTITY_EXCEEDED");
      }
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(r.shipments)
        .values({
          ...header,
          supplierId: order.supplierId,
          number: await allocateDocumentNumber(tx, "SHP"),
          createdBy: actorId,
        })
        .$returningId();
      await tx
        .insert(r.shipmentLines)
        .values(lines.map(l => ({ ...l, shipmentId: record.id })));
      await recordChange(tx, {
        actorId,
        action: "shipment.created",
        entityType: "shipment",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function shipmentStatus(
  id: number,
  status: "arrived" | "cancelled",
  actualArrival: string | null,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [shipment] = await tx
      .select()
      .from(r.shipments)
      .where(eq(r.shipments.id, id))
      .for("update");
    if (!shipment || shipment.status !== "in_transit")
      throw new DomainError("INVALID_TRANSITION");
    if (
      status === "arrived" &&
      (!actualArrival || actualArrival < shipment.shipDate)
    )
      throw new DomainError("INVALID_INPUT");
    const [receipt] = await tx
      .select()
      .from(r.goodsReceipts)
      .where(eq(r.goodsReceipts.shipmentId, id));
    if (status === "cancelled" && receipt)
      throw new DomainError("INVALID_TRANSITION");
    await tx
      .update(r.shipments)
      .set({
        status,
        actualArrival: status === "arrived" ? actualArrival : null,
      })
      .where(eq(r.shipments.id, id));
    await recordChange(tx, {
      actorId,
      action: "shipment.status",
      entityType: "shipment",
      entityId: id,
      before: { status: shipment.status },
      after: { status, actualArrival },
      reason,
    });
    return { id };
  });
}
async function batch(
  tx: Transaction,
  item: typeof items.$inferSelect,
  allocation: z.infer<
    typeof receiptInput
  >["lines"][number]["allocations"][number]
) {
  if (
    (item.lotTracking && !allocation.lotCode) ||
    (item.serialTracking && !allocation.serialCode) ||
    (item.expiryTracking && !allocation.expiresAt) ||
    (!item.lotTracking && allocation.lotCode) ||
    (!item.serialTracking && allocation.serialCode) ||
    (!item.expiryTracking && allocation.expiresAt)
  )
    throw new DomainError("INVALID_INPUT");
  if (item.serialTracking && decimal(allocation.baseQuantity) !== 1000000n)
    throw new DomainError("INVALID_INPUT");
  const code = allocation.serialCode
    ? "SER:" + allocation.serialCode
    : allocation.lotCode
      ? "LOT:" + allocation.lotCode
      : "DEFAULT";
  await tx
    .insert(r.stockBatches)
    .values({
      itemId: item.id,
      code,
      lotCode: allocation.lotCode,
      serialCode: allocation.serialCode,
      expiresAt: allocation.expiresAt,
    })
    .onDuplicateKeyUpdate({ set: { code } });
  const [record] = await tx
    .select()
    .from(r.stockBatches)
    .where(
      and(eq(r.stockBatches.itemId, item.id), eq(r.stockBatches.code, code))
    )
    .for("update");
  if (
    !record ||
    record.lotCode !== allocation.lotCode ||
    record.serialCode !== allocation.serialCode ||
    record.expiresAt !== allocation.expiresAt
  )
    throw new DomainError("CONFLICT");
  if (item.serialTracking) {
    const [existing] = await tx
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.batchId, record.id),
          eq(stockMovements.type, "receipt")
        )
      );
    if (existing) throw new DomainError("CONFLICT");
  }
  return record.id;
}
export async function createReceipt(
  data: z.infer<typeof receiptInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.receipt.create", key, data, async () => {
      const order = await lockOrder(tx, data.orderId);
      if (order.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.id, data.warehouseId));
      if (!warehouse?.active) throw new DomainError("INVALID_REFERENCE");
      unique(data.lines.map(l => l.scheduleId));
      if (data.receivedAt > new Date(Date.now() + 60000))
        throw new DomainError("INVALID_INPUT");
      if (data.shipmentId) {
        const [shipment] = await tx
          .select()
          .from(r.shipments)
          .where(eq(r.shipments.id, data.shipmentId))
          .for("update");
        if (
          !shipment ||
          shipment.orderId !== order.id ||
          shipment.status === "cancelled"
        )
          throw new DomainError("INVALID_REFERENCE");
      }
      const [record] = await tx
        .insert(r.goodsReceipts)
        .values({
          number: await allocateDocumentNumber(tx, "GRN"),
          orderId: order.id,
          shipmentId: data.shipmentId,
          warehouseId: data.warehouseId,
          receivedAt: data.receivedAt,
          receivedBy: actorId,
        })
        .$returningId();
      for (const line of [...data.lines].sort(
        (a, b) => a.orderLineId - b.orderLineId
      )) {
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId))
          .for("update");
        if (!source || source.orderId !== order.id)
          throw new DomainError("INVALID_REFERENCE");
        const [schedule] = await tx
          .select()
          .from(orderSchedules)
          .where(eq(orderSchedules.id, line.scheduleId));
        if (
          !schedule ||
          schedule.orderLineId !== source.id ||
          schedule.warehouseId !== warehouse.id
        )
          throw new DomainError("INVALID_REFERENCE");
        await location(tx, line.receivedLocationId, warehouse.id, [
          "receiving",
          "inspection",
        ]);
        const [received] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${r.receiptLines.quantity}),0)`,
          })
          .from(r.receiptLines)
          .where(eq(r.receiptLines.orderLineId, source.id));
        if (
          decimal(received.value) +
            decimal(line.quantity) -
            (await returnedForLine(tx, source.id)) >
          decimal(source.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        const [schedReceived] = await tx
          .select({
            value: sql<string>`COALESCE(SUM(${r.receiptLines.quantity}),0)`,
          })
          .from(r.receiptLines)
          .where(eq(r.receiptLines.scheduleId, schedule.id));
        const [schReturn] = await tx
          .select({
            value: sql<string>`CAST(COALESCE(SUM((${r.receiptAllocations.returnedAccepted}+${r.receiptAllocations.returnedRejected}+${r.receiptAllocations.returnedQuarantine})/${r.receiptLines.factor}),0) AS DECIMAL(18,6))`,
          })
          .from(r.receiptAllocations)
          .innerJoin(
            r.receiptLines,
            eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
          )
          .where(eq(r.receiptLines.scheduleId, schedule.id));
        if (
          decimal(schedReceived.value) +
            decimal(line.quantity) -
            decimal(schReturn.value) >
          decimal(schedule.quantity)
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        if (data.shipmentId) {
          const [shipped] = await tx
            .select()
            .from(r.shipmentLines)
            .where(
              and(
                eq(r.shipmentLines.shipmentId, data.shipmentId),
                eq(r.shipmentLines.orderLineId, source.id)
              )
            );
          const [prior] = await tx
            .select({
              value: sql<string>`COALESCE(SUM(${r.receiptLines.quantity}),0)`,
            })
            .from(r.receiptLines)
            .innerJoin(
              r.goodsReceipts,
              eq(r.receiptLines.receiptId, r.goodsReceipts.id)
            )
            .where(
              and(
                eq(r.goodsReceipts.shipmentId, data.shipmentId),
                eq(r.receiptLines.orderLineId, source.id)
              )
            );
          if (
            !shipped ||
            decimal(prior.value) + decimal(line.quantity) >
              decimal(shipped.quantity)
          )
            throw new DomainError("QUANTITY_EXCEEDED");
        }
        const [item] = await tx
          .select()
          .from(items)
          .where(eq(items.id, source.itemId))
          .for("update");
        if (!item?.active) throw new DomainError("INVALID_REFERENCE");
        let factor = "1";
        if (source.uomId !== item.baseUomId) {
          const [conversion] = await tx
            .select()
            .from(uomConversions)
            .where(
              and(
                eq(uomConversions.itemId, item.id),
                eq(uomConversions.fromUomId, source.uomId),
                eq(uomConversions.toUomId, item.baseUomId)
              )
            );
          if (!conversion) throw new DomainError("INVALID_REFERENCE");
          factor = conversion.factor;
        }
        const baseQuantity = multiply(decimal(line.quantity), decimal(factor));
        if (
          line.allocations.reduce((n, a) => n + decimal(a.baseQuantity), 0n) !==
          baseQuantity
        )
          throw new DomainError("INVALID_INPUT");
        const unitCost = formatDecimal(
          roundedDivide(
            decimal(source.subtotal) * 1000000n,
            multiply(decimal(source.quantity), decimal(factor))
          ),
          6
        );
        const [stored] = await tx
          .insert(r.receiptLines)
          .values({
            receiptId: record.id,
            orderLineId: source.id,
            scheduleId: schedule.id,
            quantity: line.quantity,
            baseQuantity: formatDecimal(baseQuantity, 6),
            uomId: source.uomId,
            baseUomId: item.baseUomId,
            factor,
            unitCost,
            receivedLocationId: line.receivedLocationId,
          })
          .$returningId();
        const seen = new Set<number>();
        for (const allocation of line.allocations) {
          const batchId = await batch(tx, item, allocation);
          if (seen.has(batchId)) throw new DomainError("INVALID_INPUT");
          seen.add(batchId);
          const [a] = await tx
            .insert(r.receiptAllocations)
            .values({
              receiptLineId: stored.id,
              batchId,
              quantity: allocation.baseQuantity,
            })
            .$returningId();
          if (item.trackInventory)
            await postStock(tx, {
              itemId: item.id,
              batchId,
              locationId: line.receivedLocationId,
              status: "inspection",
              quantity: allocation.baseQuantity,
              value: formatDecimal(
                multiply(decimal(allocation.baseQuantity), decimal(unitCost)),
                6
              ),
              type: "receipt",
              sourceType: "receipt",
              sourceId: record.id,
              sourceLineId: a.id,
              eventKey: "GRN:" + a.id,
              currency: order.currency,
              actorId,
            });
        }
      }
      await recordChange(tx, {
        actorId,
        action: "receipt.created",
        entityType: "receipt",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function inspect(
  data: z.infer<typeof inspectionInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.inspection.create", key, data, async () => {
      const [receipt] = await tx
        .select()
        .from(r.goodsReceipts)
        .where(eq(r.goodsReceipts.id, data.receiptId))
        .for("update");
      if (!receipt || receipt.status !== "under_inspection")
        throw new DomainError("INVALID_TRANSITION");
      const order = await lockOrder(tx, receipt.orderId);
      if (order.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
      unique(data.lines.map(l => l.allocationId));
      const all = await tx
        .select({ allocation: r.receiptAllocations, line: r.receiptLines })
        .from(r.receiptAllocations)
        .innerJoin(
          r.receiptLines,
          eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
        )
        .where(eq(r.receiptLines.receiptId, receipt.id));
      if (all.length !== data.lines.length)
        throw new DomainError("INVALID_INPUT");
      const [record] = await tx
        .insert(r.inspections)
        .values({
          number: await allocateDocumentNumber(tx, "INSP"),
          receiptId: receipt.id,
          inspectedBy: actorId,
          notes: data.notes,
        })
        .$returningId();
      const acceptedByLine = new Map<number, bigint>();
      for (const result of data.lines) {
        const found = all.find(a => a.allocation.id === result.allocationId);
        if (!found || found.allocation.inspectedAt)
          throw new DomainError("INVALID_REFERENCE");
        const { allocation, line } = found;
        if (
          decimal(result.accepted) +
            decimal(result.rejected) +
            decimal(result.quarantine) !==
          decimal(allocation.quantity)
        )
          throw new DomainError("INVALID_INPUT");
        await location(
          tx,
          result.storageLocationId,
          receipt.warehouseId,
          "storage"
        );
        await location(
          tx,
          result.rejectedLocationId,
          receipt.warehouseId,
          "quarantine"
        );
        await location(
          tx,
          result.quarantineLocationId,
          receipt.warehouseId,
          "quarantine"
        );
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        const [item] = await tx
          .select()
          .from(items)
          .where(eq(items.id, source.itemId));
        const [stored] = await tx
          .insert(r.inspectionResults)
          .values({ ...result, inspectionId: record.id })
          .$returningId();
        if (item.trackInventory) {
          const value = await postStock(tx, {
            itemId: item.id,
            batchId: allocation.batchId,
            locationId: line.receivedLocationId,
            status: "inspection",
            quantity: formatDecimal(-decimal(allocation.quantity), 6),
            type: "inspection_out",
            sourceType: "inspection",
            sourceId: record.id,
            sourceLineId: stored.id,
            eventKey: "INSP:" + stored.id + ":OUT",
            currency: order.currency,
            actorId,
          });
          const portions = [
            {
              q: result.accepted,
              status: "available" as const,
              locationId: result.storageLocationId,
            },
            {
              q: result.rejected,
              status: "rejected" as const,
              locationId: result.rejectedLocationId,
            },
            {
              q: result.quarantine,
              status: "quarantine" as const,
              locationId: result.quarantineLocationId,
            },
          ];
          let allocated = 0n;
          const nonzero = portions.filter(x => decimal(x.q) > 0n);
          for (const [index, portion] of nonzero.entries()) {
            const cost =
              index === nonzero.length - 1
                ? decimal(value) - allocated
                : roundedDivide(
                    decimal(value) * decimal(portion.q),
                    decimal(allocation.quantity)
                  );
            allocated += cost;
            await postStock(tx, {
              itemId: item.id,
              batchId: allocation.batchId,
              locationId: portion.locationId,
              status: portion.status,
              quantity: portion.q,
              value: formatDecimal(cost, 6),
              type: "inspection_in",
              sourceType: "inspection",
              sourceId: record.id,
              sourceLineId: stored.id,
              eventKey: "INSP:" + stored.id + ":" + portion.status,
              currency: order.currency,
              actorId,
            });
          }
        }
        await tx
          .update(r.receiptAllocations)
          .set({
            accepted: result.accepted,
            rejected: result.rejected,
            quarantine: result.quarantine,
            inspectedBy: actorId,
            inspectedAt: new Date(),
          })
          .where(eq(r.receiptAllocations.id, allocation.id));
        acceptedByLine.set(
          line.id,
          (acceptedByLine.get(line.id) ?? 0n) + decimal(result.accepted)
        );
      }
      for (const [lineId, accepted] of acceptedByLine) {
        if (accepted === 0n) continue;
        const line = all.find(a => a.line.id === lineId)!.line;
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId));
        const quantity = formatDecimal(
          roundedDivide(accepted * 1000000n, decimal(line.factor)),
          6
        );
        await postBudget(
          tx,
          {
            budgetId: source.budgetId,
            metric: "received",
            amount: lineAmounts(
              quantity,
              source.unitPrice,
              source.discountPercent,
              source.taxPercent
            ).total,
            sourceType: "inspection",
            sourceId: record.id,
            sourceLineId: line.id,
            eventKey: "INSP:" + line.id + ":RECEIVED",
            actorId,
          },
          order.currency
        );
      }
      await tx
        .update(r.goodsReceipts)
        .set({ status: "inspected" })
        .where(eq(r.goodsReceipts.id, receipt.id));
      await recordChange(tx, {
        actorId,
        action: "receipt.inspected",
        entityType: "receipt",
        entityId: receipt.id,
        after: data,
        reason: data.notes,
      });
      return record;
    })
  );
}
export async function returnToSupplier(
  data: z.infer<typeof returnInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "scm.return.create", key, data, async () => {
      const [receipt] = await tx
        .select()
        .from(r.goodsReceipts)
        .where(eq(r.goodsReceipts.id, data.receiptId))
        .for("update");
      if (!receipt || receipt.status !== "inspected")
        throw new DomainError("INVALID_TRANSITION");
      const order = await lockOrder(tx, receipt.orderId);
      unique(data.lines.map(l => l.allocationId));
      const [record] = await tx
        .insert(r.supplierReturns)
        .values({
          number: await allocateDocumentNumber(tx, "RTV"),
          receiptId: receipt.id,
          reason: data.reason,
          resolution: data.resolution,
          createdBy: actorId,
        })
        .$returningId();
      for (const input of data.lines) {
        const [allocation] = await tx
          .select()
          .from(r.receiptAllocations)
          .where(eq(r.receiptAllocations.id, input.allocationId))
          .for("update");
        if (!allocation) throw new DomainError("INVALID_REFERENCE");
        const [line] = await tx
          .select()
          .from(r.receiptLines)
          .where(eq(r.receiptLines.id, allocation.receiptLineId));
        if (line.receiptId !== receipt.id)
          throw new DomainError("INVALID_REFERENCE");
        const [source] = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.id, line.orderLineId))
          .for("update");
        const [item] = await tx
          .select()
          .from(items)
          .where(eq(items.id, source.itemId));
        const qtyField =
          input.sourceStatus === "available"
            ? "accepted"
            : input.sourceStatus === "rejected"
              ? "rejected"
              : "quarantine";
        const returnedField =
          input.sourceStatus === "available"
            ? "returnedAccepted"
            : input.sourceStatus === "rejected"
              ? "returnedRejected"
              : "returnedQuarantine";
        if (
          decimal(input.quantity) >
          decimal(allocation[qtyField]) - decimal(allocation[returnedField])
        )
          throw new DomainError("QUANTITY_EXCEEDED");
        if (input.sourceStatus === "available") {
          const returnQuantity = formatDecimal(
            roundedDivide(
              decimal(input.quantity) * 1000000n,
              decimal(line.factor)
            ),
            6
          );
          if (
            decimal(returnQuantity) >
            decimal(await eligibleQuantity(tx, line.orderLineId))
          )
            throw new DomainError("MATCHING_FAILED");
          const amounts = lineAmounts(
            returnQuantity,
            source.unitPrice,
            source.discountPercent,
            source.taxPercent
          );
          await postBudget(
            tx,
            {
              budgetId: source.budgetId,
              metric: "received",
              amount: formatDecimal(-decimal(amounts.total)),
              sourceType: "supplier_return",
              sourceId: record.id,
              sourceLineId: allocation.id,
              eventKey: "RTV:" + record.id + ":" + allocation.id + ":RECEIVED",
              actorId,
            },
            order.currency
          );
        }
        const [stored] = await tx
          .insert(r.supplierReturnLines)
          .values({ ...input, returnId: record.id })
          .$returningId();
        if (item.trackInventory)
          await postStock(tx, {
            itemId: item.id,
            batchId: allocation.batchId,
            locationId: input.locationId,
            status: input.sourceStatus,
            quantity: formatDecimal(-decimal(input.quantity), 6),
            type: "supplier_return",
            sourceType: "supplier_return",
            sourceId: record.id,
            sourceLineId: stored.id,
            eventKey: "RTV:" + stored.id,
            currency: order.currency,
            actorId,
          });
        await tx
          .update(r.receiptAllocations)
          .set({
            [returnedField]: formatDecimal(
              decimal(allocation[returnedField]) + decimal(input.quantity),
              6
            ),
          })
          .where(eq(r.receiptAllocations.id, allocation.id));
      }
      await recordChange(tx, {
        actorId,
        action: "supplier_return.created",
        entityType: "supplier_return",
        entityId: record.id,
        after: data,
        reason: data.reason,
      });
      return record;
    })
  );
}
