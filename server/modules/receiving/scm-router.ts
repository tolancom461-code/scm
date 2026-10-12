import { z } from "zod";
import { and, asc, count, eq, like, sql } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { listInput, idInput, reasonInput } from "../../../shared/list";
import { dateInput } from "../../../shared/projects";
import {
  shipmentInput,
  receiptInput,
  inspectionInput,
  returnInput,
} from "../../../shared/receiving";
import * as r from "../../../drizzle/receiving";
import {
  orders,
  orderLines,
  orderSchedules,
} from "../../../drizzle/procurement";
import { items, uomConversions } from "../../../drizzle/master-data";
import * as service from "./scm-service";
export const receivingRouter = router({
  orderPlan: requiring("receiving.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, input.id));
      if (!order) throw new DomainError("NOT_FOUND");
      const lines = await db
        .select({ line: orderLines, item: items })
        .from(orderLines)
        .innerJoin(items, eq(orderLines.itemId, items.id))
        .where(eq(orderLines.orderId, input.id));
      return {
        order,
        lines: await Promise.all(
          lines.map(async row => {
            const schedules = await db
              .select()
              .from(orderSchedules)
              .where(eq(orderSchedules.orderLineId, row.line.id));
            let factor = "1";
            if (row.line.uomId !== row.item.baseUomId) {
              const [c] = await db
                .select()
                .from(uomConversions)
                .where(
                  and(
                    eq(uomConversions.itemId, row.item.id),
                    eq(uomConversions.fromUomId, row.line.uomId),
                    eq(uomConversions.toUomId, row.item.baseUomId)
                  )
                );
              if (!c) throw new DomainError("INVALID_REFERENCE");
              factor = c.factor;
            }
            const [received] = await db
              .select({
                value: sql<string>`COALESCE(SUM(${r.receiptLines.quantity}),0)`,
              })
              .from(r.receiptLines)
              .where(eq(r.receiptLines.orderLineId, row.line.id));
            const [quantities] = await db
              .select({
                accepted: sql<string>`CAST(COALESCE(SUM((${r.receiptAllocations.accepted}-${r.receiptAllocations.returnedAccepted})/${r.receiptLines.factor}),0) AS DECIMAL(18,6))`,
                rejected: sql<string>`CAST(COALESCE(SUM(${r.receiptAllocations.rejected}/${r.receiptLines.factor}),0) AS DECIMAL(18,6))`,
                returned: sql<string>`CAST(COALESCE(SUM((${r.receiptAllocations.returnedAccepted}+${r.receiptAllocations.returnedRejected}+${r.receiptAllocations.returnedQuarantine})/${r.receiptLines.factor}),0) AS DECIMAL(18,6))`,
              })
              .from(r.receiptAllocations)
              .innerJoin(
                r.receiptLines,
                eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
              )
              .where(eq(r.receiptLines.orderLineId, row.line.id));
            return {
              ...row,
              schedules,
              factor,
              received: received.value,
              ...quantities,
            };
          })
        ),
      };
    }),
  list: requiring("receiving.view")
    .input(
      listInput.extend({
        kind: z.enum(["shipments", "receipts", "returns"]),
        orderId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const table =
        input.kind === "shipments"
          ? r.shipments
          : input.kind === "receipts"
            ? r.goodsReceipts
            : r.supplierReturns;
      const db = await database();
      const searchFilter = input.search
        ? like(
            table.number,
            "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%"
          )
        : undefined;
      const filter=and(searchFilter,input.orderId?("orderId"in table?eq(table.orderId,input.orderId):sql`EXISTS (SELECT 1 FROM ${r.goodsReceipts} WHERE ${r.goodsReceipts.id}=${r.supplierReturns.receiptId} AND ${r.goodsReceipts.orderId}=${input.orderId})`):undefined);
      const records = await db
        .select({
          id: table.id,
          number: table.number,
          createdAt: table.createdAt,
        })
        .from(table)
        .where(filter)
        .orderBy(asc(table.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(table)
        .where(filter);
      return { records, total: total.value };
    }),
  detail: requiring("receiving.view")
    .input(
      idInput.extend({ kind: z.enum(["shipments", "receipts", "returns"]) })
    )
    .query(async ({ input }) => {
      const db = await database();
      if (input.kind === "shipments") {
        const [header] = await db
          .select()
          .from(r.shipments)
          .where(eq(r.shipments.id, input.id));
        if (!header) throw new DomainError("NOT_FOUND");
        const lines = await db
          .select({ line: r.shipmentLines, source: orderLines, item: items })
          .from(r.shipmentLines)
          .innerJoin(orderLines, eq(r.shipmentLines.orderLineId, orderLines.id))
          .innerJoin(items, eq(orderLines.itemId, items.id))
          .where(eq(r.shipmentLines.shipmentId, input.id));
        return { kind: "shipments" as const, header, lines };
      }
      if (input.kind === "receipts") {
        const [header] = await db
          .select()
          .from(r.goodsReceipts)
          .where(eq(r.goodsReceipts.id, input.id));
        if (!header) throw new DomainError("NOT_FOUND");
        const lines = await db
          .select({ line: r.receiptLines, source: orderLines, item: items })
          .from(r.receiptLines)
          .innerJoin(orderLines, eq(r.receiptLines.orderLineId, orderLines.id))
          .innerJoin(items, eq(orderLines.itemId, items.id))
          .where(eq(r.receiptLines.receiptId, input.id));
        const allocations = await db
          .select({
            allocation: r.receiptAllocations,
            batch: r.stockBatches,
            line: r.receiptLines,
          })
          .from(r.receiptAllocations)
          .innerJoin(
            r.receiptLines,
            eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
          )
          .innerJoin(
            r.stockBatches,
            eq(r.receiptAllocations.batchId, r.stockBatches.id)
          )
          .where(eq(r.receiptLines.receiptId, input.id));
        return { kind: "receipts" as const, header, lines, allocations };
      }
      const [header] = await db
        .select()
        .from(r.supplierReturns)
        .where(eq(r.supplierReturns.id, input.id));
      if (!header) throw new DomainError("NOT_FOUND");
      const lines = await db
        .select()
        .from(r.supplierReturnLines)
        .where(eq(r.supplierReturnLines.returnId, input.id));
      return { kind: "returns" as const, header, lines };
    }),
  shipment: createShipmentProcedure(),
  receipt: requiring("receiving.create")
    .input(z.object({ data: receiptInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createReceipt(input.data, ctx.user.id, input.key)
    ),
  inspect: requiring("receiving.inspect")
    .input(z.object({ data: inspectionInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.inspect(input.data, ctx.user.id, input.key)
    ),
  return: requiring("receiving.return")
    .input(z.object({ data: returnInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.returnToSupplier(input.data, ctx.user.id, input.key)
    ),
  shipmentStatus: requiring("receiving.create")
    .input(
      reasonInput.extend({
        status: z.enum(["arrived", "cancelled"]),
        actualArrival: dateInput.nullable(),
      })
    )
    .mutation(({ input, ctx }) =>
      service.shipmentStatus(
        input.id,
        input.status,
        input.actualArrival,
        ctx.user.id,
        input.reason
      )
    ),
});
function createShipmentProcedure() {
  return requiring("receiving.create")
    .input(z.object({ data: shipmentInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.createShipment(input.data, ctx.user.id, input.key)
    );
}
