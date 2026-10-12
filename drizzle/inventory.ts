import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";
import { items, warehouseLocations } from "./master-data";
import { stockBatches } from "./receiving";
import { projects, wbsNodes } from "./projects";
import { workflowInstances } from "./workflows";
export const stockStatuses = [
  "available",
  "reserved",
  "inspection",
  "quarantine",
  "rejected",
  "damaged",
] as const;
export const stockBalances = mysqlTable(
  "scm_stock_balances",
  {
    id: int("id").autoincrement().primaryKey(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    locationId: int("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    batchId: int("batch_id")
      .notNull()
      .references(() => stockBatches.id),
    status: mysqlEnum("status", stockStatuses).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
    quantity: decimal("quantity", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    value: decimal("value", { precision: 18, scale: 6 }).notNull().default("0"),
    version: int("version").default(1).notNull(),
  },
  t => [
    uniqueIndex("stock_balance_key").on(
      t.itemId,
      t.locationId,
      t.batchId,
      t.status
    ),
    check("stock_nonnegative", sql`${t.quantity}>=0 AND ${t.value}>=0`),
  ]
);
export const stockMovements = mysqlTable(
  "scm_stock_movements",
  {
    id: int("id").autoincrement().primaryKey(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    locationId: int("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    batchId: int("batch_id")
      .notNull()
      .references(() => stockBatches.id),
    status: mysqlEnum("status", stockStatuses).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("SAR"),
    quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
    value: decimal("value", { precision: 18, scale: 6 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: int("source_id").notNull(),
    sourceLineId: int("source_line_id").notNull(),
    eventKey: varchar("event_key", { length: 120 }).notNull().unique(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [
    index("stock_movement_item_time").on(t.itemId, t.createdAt),
    index("stock_movement_source").on(t.sourceType, t.sourceId),
  ]
);
export const stockOperations = mysqlTable("scm_stock_operations", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  type: mysqlEnum("type", [
    "issue",
    "transfer",
    "reserve",
    "release",
    "adjustment",
    "count",
  ]).notNull(),
  projectId: int("project_id").references(() => projects.id),
  wbsId: int("wbs_id").references(() => wbsNodes.id),
  reason: text("reason").notNull(),
  status: mysqlEnum("status", [
    "draft",
    "pending",
    "approved",
    "rejected",
    "returned",
    "posted",
  ])
    .notNull()
    .default("draft"),
  workflowId: int("workflow_id").references(() => workflowInstances.id),
  currency: varchar("currency", { length: 3 }).notNull(),
  department: varchar("department", { length: 100 }).notNull(),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const stockOperationLines = mysqlTable(
  "scm_stock_operation_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    operationId: int("operation_id").notNull(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    batchId: int("batch_id")
      .notNull()
      .references(() => stockBatches.id),
    fromLocationId: int("from_location_id").notNull(),
    toLocationId: int("to_location_id"),
    quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
    countedQuantity: decimal("counted_quantity", { precision: 18, scale: 6 }),
    balanceVersion: int("balance_version"),
    reservationLineId: int("reservation_line_id"),
    releasedQuantity: decimal("released_quantity", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    unitCost: decimal("unit_cost", { precision: 18, scale: 6 }),
  },
  t => [
    index("stock_operation_lines_operation").on(t.operationId),
    foreignKey({
      name: "stock_op_line_operation_fk",
      columns: [t.operationId],
      foreignColumns: [stockOperations.id],
    }),
    foreignKey({
      name: "stock_op_from_location_fk",
      columns: [t.fromLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
    foreignKey({
      name: "stock_op_to_location_fk",
      columns: [t.toLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
  ]
);
