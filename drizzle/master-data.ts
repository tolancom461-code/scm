import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";

function base() {
  return {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    nameAr: varchar("name_ar", { length: 200 }).notNull(),
    nameEn: varchar("name_en", { length: 200 }).notNull(),
    nameUr: varchar("name_ur", { length: 200 }).notNull(),
    active: boolean("active").default(true).notNull(),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  };
}
export const categories = mysqlTable(
  "scm_categories",
  {
    ...base(),
    parentId: int("parent_id").references((): AnyMySqlColumn => categories.id),
  },
  t => [
    index("category_parent").on(t.parentId),
    check(
      "category_not_self",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`
    ),
  ]
);
export const units = mysqlTable("scm_units", {
  ...base(),
  dimension: mysqlEnum("dimension", [
    "count",
    "mass",
    "length",
    "area",
    "volume",
    "time",
  ]).notNull(),
});
export const branches = mysqlTable("scm_branches", {
  ...base(),
  address: text("address"),
});
export const sites = mysqlTable(
  "scm_sites",
  {
    ...base(),
    branchId: int("branch_id")
      .notNull()
      .references(() => branches.id),
    address: text("address"),
  },
  t => [index("site_branch").on(t.branchId)]
);
export const costCenters = mysqlTable(
  "scm_cost_centers",
  {
    ...base(),
    branchId: int("branch_id")
      .notNull()
      .references(() => branches.id),
  },
  t => [index("cost_center_branch").on(t.branchId)]
);
export const warehouses = mysqlTable(
  "scm_warehouses",
  {
    ...base(),
    siteId: int("site_id")
      .notNull()
      .references(() => sites.id),
  },
  t => [index("warehouse_site").on(t.siteId)]
);
export const warehouseLocations = mysqlTable(
  "scm_warehouse_locations",
  {
    ...base(),
    warehouseId: int("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    type: mysqlEnum("type", [
      "receiving",
      "inspection",
      "quarantine",
      "storage",
    ]).notNull(),
  },
  t => [index("location_warehouse").on(t.warehouseId)]
);
export const items = mysqlTable(
  "scm_items",
  {
    ...base(),
    type: mysqlEnum("type", [
      "inventory",
      "consumable",
      "service",
      "asset",
      "non_stock",
    ]).notNull(),
    categoryId: int("category_id")
      .notNull()
      .references(() => categories.id),
    baseUomId: int("base_uom_id")
      .notNull()
      .references(() => units.id),
    purchasingUomId: int("purchasing_uom_id")
      .notNull()
      .references(() => units.id),
    description: text("description"),
    barcode: varchar("barcode", { length: 100 }).unique(),
    trackInventory: boolean("track_inventory").default(false).notNull(),
    inspectionRequired: boolean("inspection_required").default(false).notNull(),
    lotTracking: boolean("lot_tracking").default(false).notNull(),
    serialTracking: boolean("serial_tracking").default(false).notNull(),
    expiryTracking: boolean("expiry_tracking").default(false).notNull(),
  },
  t => [
    index("item_category").on(t.categoryId),
    index("item_base_uom").on(t.baseUomId),
    index("item_purchase_uom").on(t.purchasingUomId),
    check(
      "service_non_inventory",
      sql`${t.type} <> 'service' OR ${t.trackInventory} = 0`
    ),
    check(
      "tracking_requires_inventory",
      sql`${t.trackInventory} = 1 OR (${t.lotTracking} = 0 AND ${t.serialTracking} = 0 AND ${t.expiryTracking} = 0)`
    ),
    check(
      "expiry_requires_lot",
      sql`${t.expiryTracking} = 0 OR ${t.lotTracking} = 1`
    ),
  ]
);
export const uomConversions = mysqlTable(
  "scm_uom_conversions",
  {
    ...base(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    fromUomId: int("from_uom_id")
      .notNull()
      .references(() => units.id),
    toUomId: int("to_uom_id")
      .notNull()
      .references(() => units.id),
    factor: decimal("factor", { precision: 18, scale: 6 }).notNull(),
  },
  t => [
    uniqueIndex("item_conversion_pair").on(t.itemId, t.fromUomId, t.toUomId),
    index("conversion_to_uom").on(t.toUomId),
    check("conversion_positive", sql`${t.factor} > 0`),
    check("conversion_distinct", sql`${t.fromUomId} <> ${t.toUomId}`),
  ]
);
