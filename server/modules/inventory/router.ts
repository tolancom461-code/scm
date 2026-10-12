import { z } from "zod";
import { and, asc, count, eq, like, or, gt } from "drizzle-orm";
import { router } from "../../_core/trpc";
import { requiring } from "../../core/permissions";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { listInput, idInput } from "../../../shared/list";
import { stockOperationInput } from "../../../shared/inventory";
import { workflowDecisionInput } from "../../../shared/workflows";
import * as s from "../../../drizzle/inventory";
import { stockBatches } from "../../../drizzle/receiving";
import {
  items,
  warehouseLocations,
  warehouses,
} from "../../../drizzle/master-data";
import * as service from "./service";
export const inventoryRouter = router({
  balances: requiring("inventory.view")
    .input(
      listInput.extend({
        itemId: z.number().int().positive().optional(),
        warehouseId: z.number().int().positive().optional(),
        status: z.enum(s.stockStatuses).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await database(),
        q = "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%";
      const filter = and(
        gt(s.stockBalances.quantity, "0"),
        input.itemId ? eq(s.stockBalances.itemId, input.itemId) : undefined,
        input.warehouseId
          ? eq(warehouseLocations.warehouseId, input.warehouseId)
          : undefined,
        input.status ? eq(s.stockBalances.status, input.status) : undefined,
        input.search
          ? or(
              like(items.code, q),
              like(items.nameAr, q),
              like(items.nameEn, q),
              like(stockBatches.code, q)
            )
          : undefined
      );
      const records = await db
        .select({
          balance: s.stockBalances,
          item: items,
          location: warehouseLocations,
          batch: stockBatches,
          warehouse: warehouses,
        })
        .from(s.stockBalances)
        .innerJoin(items, eq(s.stockBalances.itemId, items.id))
        .innerJoin(
          warehouseLocations,
          eq(s.stockBalances.locationId, warehouseLocations.id)
        )
        .innerJoin(
          warehouses,
          eq(warehouseLocations.warehouseId, warehouses.id)
        )
        .innerJoin(stockBatches, eq(s.stockBalances.batchId, stockBatches.id))
        .where(filter)
        .orderBy(asc(items.code), asc(s.stockBalances.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(s.stockBalances)
        .innerJoin(items, eq(s.stockBalances.itemId, items.id))
        .innerJoin(
          warehouseLocations,
          eq(s.stockBalances.locationId, warehouseLocations.id)
        )
        .innerJoin(stockBatches, eq(s.stockBalances.batchId, stockBatches.id))
        .where(filter);
      return { records, total: total.value };
    }),
  ledger: requiring("inventory.view")
    .input(listInput.extend({ itemId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = await database();
      const filter = input.itemId
        ? eq(s.stockMovements.itemId, input.itemId)
        : undefined;
      const records = await db
        .select({
          movement: s.stockMovements,
          item: items,
          location: warehouseLocations,
        })
        .from(s.stockMovements)
        .innerJoin(items, eq(s.stockMovements.itemId, items.id))
        .innerJoin(
          warehouseLocations,
          eq(s.stockMovements.locationId, warehouseLocations.id)
        )
        .where(filter)
        .orderBy(asc(s.stockMovements.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(s.stockMovements)
        .where(filter);
      return { records, total: total.value };
    }),
  operations: requiring("inventory.view")
    .input(listInput)
    .query(async ({ input }) => {
      const db = await database(),
        filter = input.search
          ? like(
              s.stockOperations.number,
              "%" + input.search.replace(/[\\%_]/g, "\\$&") + "%"
            )
          : undefined;
      const records = await db
        .select()
        .from(s.stockOperations)
        .where(filter)
        .orderBy(asc(s.stockOperations.id))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await db
        .select({ value: count() })
        .from(s.stockOperations)
        .where(filter);
      return { records, total: total.value };
    }),
  detail: requiring("inventory.view")
    .input(idInput)
    .query(async ({ input }) => {
      const db = await database();
      const [header] = await db
        .select()
        .from(s.stockOperations)
        .where(eq(s.stockOperations.id, input.id));
      if (!header) throw new DomainError("NOT_FOUND");
      return {
        header,
        lines: await db
          .select()
          .from(s.stockOperationLines)
          .where(eq(s.stockOperationLines.operationId, input.id)),
      };
    }),
  create: requiring("inventory.operate")
    .input(z.object({ data: stockOperationInput, key: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      service.create(input.data, ctx.user.id, input.key)
    ),
  decide: requiring("inventory.approve")
    .input(workflowDecisionInput)
    .mutation(({ input, ctx }) =>
      service.decide(
        input.id,
        input.instanceId,
        input.expectedPosition,
        ctx.user.id,
        input.action,
        input.reason
      )
    ),
});
