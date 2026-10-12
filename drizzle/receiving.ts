import { sql } from "drizzle-orm";
import {
  check,
  date,
  datetime,
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
import { users, suppliers } from "./schema";
import { items, units, warehouses, warehouseLocations } from "./master-data";
import { orders, orderLines, orderSchedules } from "./procurement";
const qty = (name: string) => decimal(name, { precision: 18, scale: 6 });
export const shipments = mysqlTable(
  "scm_shipments",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    carrier: varchar("carrier", { length: 150 }).notNull(),
    trackingNumber: varchar("tracking_number", { length: 150 }),
    shipDate: date("ship_date", { mode: "string" }).notNull(),
    expectedArrival: date("expected_arrival", { mode: "string" }).notNull(),
    actualArrival: date("actual_arrival", { mode: "string" }),
    freight: decimal("freight", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    insurance: decimal("insurance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    customs: decimal("customs", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    status: mysqlEnum("status", ["in_transit", "arrived", "cancelled"])
      .notNull()
      .default("in_transit"),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [check("shipment_dates", sql`${t.expectedArrival}>=${t.shipDate}`)]
);
export const shipmentLines = mysqlTable(
  "scm_shipment_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    shipmentId: int("shipment_id")
      .notNull()
      .references(() => shipments.id),
    orderLineId: int("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: qty("quantity").notNull(),
  },
  t => [
    uniqueIndex("shipment_order_line").on(t.shipmentId, t.orderLineId),
    check("shipment_quantity_positive", sql`${t.quantity}>0`),
  ]
);
export const stockBatches = mysqlTable(
  "scm_stock_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    code: varchar("code", { length: 150 }).notNull(),
    lotCode: varchar("lot_code", { length: 100 }),
    serialCode: varchar("serial_code", { length: 100 }).unique(),
    expiresAt: date("expires_at", { mode: "string" }),
  },
  t => [uniqueIndex("stock_batch_item_code").on(t.itemId, t.code)]
);
export const goodsReceipts = mysqlTable("scm_goods_receipts", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  orderId: int("order_id")
    .notNull()
    .references(() => orders.id),
  shipmentId: int("shipment_id").references(() => shipments.id),
  warehouseId: int("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  receivedAt: datetime("received_at").notNull(),
  status: mysqlEnum("status", ["under_inspection", "inspected"])
    .default("under_inspection")
    .notNull(),
  receivedBy: int("received_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const receiptLines = mysqlTable(
  "scm_receipt_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    receiptId: int("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id),
    orderLineId: int("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    scheduleId: int("schedule_id")
      .notNull()
      .references(() => orderSchedules.id),
    quantity: qty("quantity").notNull(),
    baseQuantity: qty("base_quantity").notNull(),
    uomId: int("uom_id")
      .notNull()
      .references(() => units.id),
    baseUomId: int("base_uom_id")
      .notNull()
      .references(() => units.id),
    factor: qty("factor").notNull(),
    unitCost: decimal("unit_cost", { precision: 18, scale: 6 }).notNull(),
    receivedLocationId: int("received_location_id").notNull(),
  },
  t => [
    uniqueIndex("receipt_schedule_line").on(t.receiptId, t.scheduleId),
    foreignKey({
      name: "receipt_location_fk",
      columns: [t.receivedLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
    check(
      "receipt_line_positive",
      sql`${t.quantity}>0 AND ${t.baseQuantity}>0 AND ${t.factor}>0`
    ),
  ]
);
export const receiptAllocations = mysqlTable(
  "scm_receipt_allocations",
  {
    id: int("id").autoincrement().primaryKey(),
    receiptLineId: int("receipt_line_id")
      .notNull()
      .references(() => receiptLines.id),
    batchId: int("batch_id")
      .notNull()
      .references(() => stockBatches.id),
    quantity: qty("quantity").notNull(),
    accepted: qty("accepted").notNull().default("0"),
    rejected: qty("rejected").notNull().default("0"),
    quarantine: qty("quarantine").notNull().default("0"),
    returnedAccepted: qty("returned_accepted").notNull().default("0"),
    returnedRejected: qty("returned_rejected").notNull().default("0"),
    returnedQuarantine: qty("returned_quarantine").notNull().default("0"),
    inspectedBy: int("inspected_by").references(() => users.id),
    inspectedAt: datetime("inspected_at"),
  },
  t => [
    uniqueIndex("receipt_batch_allocation").on(t.receiptLineId, t.batchId),
    check(
      "inspection_quantities",
      sql`${t.quantity}>0 AND ${t.accepted}>=0 AND ${t.rejected}>=0 AND ${t.quarantine}>=0 AND ${t.accepted}+${t.rejected}+${t.quarantine}<=${t.quantity}`
    ),
  ]
);
export const inspections = mysqlTable("scm_inspections", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  receiptId: int("receipt_id")
    .notNull()
    .references(() => goodsReceipts.id),
  inspectedBy: int("inspected_by")
    .notNull()
    .references(() => users.id),
  notes: text("notes").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const inspectionResults = mysqlTable(
  "scm_inspection_results",
  {
    id: int("id").autoincrement().primaryKey(),
    inspectionId: int("inspection_id")
      .notNull()
      .references(() => inspections.id),
    allocationId: int("allocation_id").notNull(),
    accepted: qty("accepted").notNull(),
    rejected: qty("rejected").notNull(),
    quarantine: qty("quarantine").notNull(),
    defects: text("defects"),
    storageLocationId: int("storage_location_id").notNull(),
    rejectedLocationId: int("rejected_location_id").notNull(),
    quarantineLocationId: int("quarantine_location_id").notNull(),
  },
  t => [
    uniqueIndex("inspection_result_allocation").on(
      t.inspectionId,
      t.allocationId
    ),
    foreignKey({
      name: "inspection_allocation_fk",
      columns: [t.allocationId],
      foreignColumns: [receiptAllocations.id],
    }),
    foreignKey({
      name: "inspection_storage_fk",
      columns: [t.storageLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
    foreignKey({
      name: "inspection_rejected_fk",
      columns: [t.rejectedLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
    foreignKey({
      name: "inspection_quarantine_fk",
      columns: [t.quarantineLocationId],
      foreignColumns: [warehouseLocations.id],
    }),
  ]
);
export const supplierReturns = mysqlTable("scm_supplier_returns", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  receiptId: int("receipt_id")
    .notNull()
    .references(() => goodsReceipts.id),
  reason: text("reason").notNull(),
  resolution: mysqlEnum("resolution", ["replacement", "credit"]).notNull(),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const supplierReturnLines = mysqlTable(
  "scm_return_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    returnId: int("return_id")
      .notNull()
      .references(() => supplierReturns.id),
    allocationId: int("allocation_id")
      .notNull()
      .references(() => receiptAllocations.id),
    locationId: int("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    quantity: qty("quantity").notNull(),
    sourceStatus: mysqlEnum("source_status", [
      "available",
      "rejected",
      "quarantine",
    ]).notNull(),
  },
  t => [check("supplier_return_positive", sql`${t.quantity}>0`)]
);
