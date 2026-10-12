import { and, asc, count, desc, eq, like, or } from "drizzle-orm";
import * as schema from "../../../drizzle/master-data";
import type { MasterInput, MasterKind } from "../../../shared/master-data";
import { masterListInput } from "../../../shared/master-data";
import type { z } from "zod";
import { database, type Transaction } from "../../core/database";

export const tables = {
  items: schema.items,
  categories: schema.categories,
  units: schema.units,
  conversions: schema.uomConversions,
  branches: schema.branches,
  sites: schema.sites,
  costCenters: schema.costCenters,
  warehouses: schema.warehouses,
  locations: schema.warehouseLocations,
};
export async function list(input: z.infer<typeof masterListInput>) {
  const db = await database(),
    table = tables[input.kind];
  const escaped = input.search.replace(/[\\%_]/g, "\\$&");
  const filter = and(
    input.active === undefined ? undefined : eq(table.active, input.active),
    input.search
      ? or(
          ...[table.code, table.nameAr, table.nameEn, table.nameUr].map(c =>
            like(c, `%${escaped}%`)
          )
        )
      : undefined
  );
  const [records, totals] = await Promise.all([
    db
      .select()
      .from(table)
      .where(filter)
      .orderBy(
        input.direction === "asc"
          ? asc(table[input.sort])
          : desc(table[input.sort]),
        asc(table.id)
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(table).where(filter),
  ]);
  return {
    records,
    total: totals[0]?.total ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}
export async function find(
  tx: Transaction,
  kind: MasterKind,
  id: number,
  lock = false
) {
  const table = tables[kind];
  const query = tx.select().from(table).where(eq(table.id, id)).limit(1);
  const rows = lock ? await query.for("update") : await query;
  return rows[0] ?? null;
}
export async function insert(tx: Transaction, input: MasterInput) {
  // Narrow each discriminant so Drizzle retains the exact table contract.
  switch (input.kind) {
    case "categories":
      return tx.insert(schema.categories).values(input).$returningId();
    case "units":
      return tx.insert(schema.units).values(input).$returningId();
    case "branches":
      return tx.insert(schema.branches).values(input).$returningId();
    case "sites":
      return tx.insert(schema.sites).values(input).$returningId();
    case "costCenters":
      return tx.insert(schema.costCenters).values(input).$returningId();
    case "warehouses":
      return tx.insert(schema.warehouses).values(input).$returningId();
    case "locations":
      return tx.insert(schema.warehouseLocations).values(input).$returningId();
    case "items":
      return tx.insert(schema.items).values(input).$returningId();
    case "conversions":
      return tx.insert(schema.uomConversions).values(input).$returningId();
  }
}
export async function update(
  tx: Transaction,
  id: number,
  version: number,
  input: MasterInput
) {
  const { kind, ...values } = input;
  const table = tables[kind];
  // Structural columns are shared; additional values were validated against the kind.
  await tx
    .update(table)
    .set({ ...values, version: version + 1 })
    .where(and(eq(table.id, id), eq(table.version, version)));
}
