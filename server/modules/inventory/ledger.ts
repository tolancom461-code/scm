import { and, eq, sql } from "drizzle-orm";
import {
  stockBalances,
  stockMovements,
  type stockStatuses,
} from "../../../drizzle/inventory";
import { items, warehouseLocations } from "../../../drizzle/master-data";
import { stockBatches } from "../../../drizzle/receiving";
import type { Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { decimal, formatDecimal, roundedDivide } from "../../../shared/decimal";
type Status = (typeof stockStatuses)[number];
export async function balance(
  tx: Transaction,
  itemId: number,
  locationId: number,
  batchId: number,
  status: Status
) {
  const filter = and(
    eq(stockBalances.itemId, itemId),
    eq(stockBalances.locationId, locationId),
    eq(stockBalances.batchId, batchId),
    eq(stockBalances.status, status)
  );
  await tx
    .insert(stockBalances)
    .values({ itemId, locationId, batchId, status })
    .onDuplicateKeyUpdate({ set: { batchId } });
  const [row] = await tx
    .select()
    .from(stockBalances)
    .where(filter)
    .for("update");
  return row;
}
export async function postStock(
  tx: Transaction,
  input: Omit<typeof stockMovements.$inferInsert, "value"> & { value?: string }
) {
  const [batch] = await tx
    .select()
    .from(stockBatches)
    .where(eq(stockBatches.id, input.batchId))
    .for("update");
  const [item] = await tx
    .select()
    .from(items)
    .where(eq(items.id, input.itemId));
  const [location] = await tx
    .select()
    .from(warehouseLocations)
    .where(eq(warehouseLocations.id, input.locationId));
  if (
    !batch ||
    batch.itemId !== input.itemId ||
    !item?.trackInventory ||
    !location?.active
  )
    throw new DomainError("INVALID_REFERENCE");
  if (input.status === "available" || input.status === "reserved") {
    if (location.type !== "storage") throw new DomainError("INVALID_REFERENCE");
    if (
      batch.expiresAt &&
      batch.expiresAt <= new Date().toISOString().slice(0, 10)
    )
      throw new DomainError("STOCK_EXPIRED");
  }
  if (
    input.status === "quarantine" ||
    input.status === "rejected" ||
    input.status === "damaged"
  ) {
    if (location.type !== "quarantine")
      throw new DomainError("INVALID_REFERENCE");
  }
  if (
    input.status === "inspection" &&
    !["receiving", "inspection"].includes(location.type)
  )
    throw new DomainError("INVALID_REFERENCE");
  const current = await balance(
      tx,
      input.itemId,
      input.locationId,
      input.batchId,
      input.status
    ),
    quantity = decimal(input.quantity);
  if (
    decimal(current.quantity) > 0n &&
    current.currency !== (input.currency ?? "SAR")
  )
    throw new DomainError("INVALID_REFERENCE");
  if (quantity === 0n) throw new DomainError("INVALID_INPUT");
  const next = decimal(current.quantity) + quantity;
  if (next < 0n) throw new DomainError("INSUFFICIENT_STOCK");
  let value: bigint;
  if (quantity < 0n) {
    value =
      next === 0n
        ? -decimal(current.value)
        : -roundedDivide(
            decimal(current.value) * -quantity,
            decimal(current.quantity)
          );
  } else {
    if (input.value === undefined) throw new DomainError("INVALID_INPUT");
    value = decimal(input.value);
    if (value < 0n) throw new DomainError("INVALID_INPUT");
  }
  if (item.serialTracking) {
    if (
      quantity % 1000000n !== 0n ||
      quantity > 1000000n ||
      quantity < -1000000n
    )
      throw new DomainError("INVALID_INPUT");
    const [aggregate] = await tx
      .select({
        quantity: sql<string>`COALESCE(SUM(${stockBalances.quantity}),0)`,
      })
      .from(stockBalances)
      .where(eq(stockBalances.batchId, batch.id));
    if (decimal(aggregate.quantity) + quantity > 1000000n)
      throw new DomainError("QUANTITY_EXCEEDED");
  }
  await tx
    .insert(stockMovements)
    .values({ ...input, value: formatDecimal(value, 6) });
  await tx
    .update(stockBalances)
    .set({
      quantity: formatDecimal(next, 6),
      value: formatDecimal(decimal(current.value) + value, 6),
      version: current.version + 1,
      currency: input.currency ?? "SAR",
    })
    .where(eq(stockBalances.id, current.id));
  return formatDecimal(value < 0n ? -value : value, 6);
}
