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
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import { users, suppliers } from "./schema";
import { orders, orderLines } from "./procurement";
import { workflowInstances } from "./workflows";
import { supplierReturns } from "./receiving";
const money = (name: string) => decimal(name, { precision: 18, scale: 2 });
export const workCertificates = mysqlTable("scm_work_certificates", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  orderId: int("order_id")
    .notNull()
    .references(() => orders.id),
  certificateDate: date("certificate_date", { mode: "string" }).notNull(),
  evidence: text("evidence").notNull(),
  total: money("total").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "returned"])
    .notNull()
    .default("pending"),
  workflowId: int("workflow_id").references(() => workflowInstances.id),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const workCertificateLines = mysqlTable(
  "scm_work_certificate_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    certificateId: int("certificate_id").notNull(),
    orderLineId: int("order_line_id").notNull(),
    quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
    total: money("total").notNull(),
  },
  t => [
    foreignKey({
      name: "work_line_certificate_fk",
      columns: [t.certificateId],
      foreignColumns: [workCertificates.id],
    }),
    foreignKey({
      name: "work_line_order_fk",
      columns: [t.orderLineId],
      foreignColumns: [orderLines.id],
    }),
    uniqueIndex("work_certificate_line").on(t.certificateId, t.orderLineId),
    check("work_quantity_positive", sql`${t.quantity}>0`),
  ]
);
export const invoices = mysqlTable(
  "scm_invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    supplierReference: varchar("supplier_reference", { length: 100 }).notNull(),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id),
    currency: varchar("currency", { length: 3 }).notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    total: money("total").notNull(),
    retentionPercent: decimal("retention_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    retentionAmount: money("retention_amount").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "blocked",
      "matched",
      "pending",
      "approved",
      "rejected",
      "returned",
      "cancelled",
    ])
      .default("draft")
      .notNull(),
    workflowId: int("workflow_id").references(() => workflowInstances.id),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("invoice_supplier_reference").on(
      t.supplierId,
      t.supplierReference
    ),
    index("invoice_order_status").on(t.orderId, t.status),
    check(
      "invoice_retention",
      sql`${t.retentionPercent} BETWEEN 0 AND 100 AND ${t.retentionAmount}>=0 AND ${t.retentionAmount}<=${t.total}`
    ),
  ]
);
export const invoiceLines = mysqlTable(
  "scm_invoice_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoice_id")
      .notNull()
      .references(() => invoices.id),
    orderLineId: int("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    discountPercent: decimal("discount_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    taxPercent: decimal("tax_percent", { precision: 7, scale: 4 }).notNull(),
    subtotal: money("subtotal").notNull(),
    taxAmount: money("tax_amount").notNull(),
    total: money("total").notNull(),
  },
  t => [
    uniqueIndex("invoice_order_line").on(t.invoiceId, t.orderLineId),
    check("invoice_line_positive", sql`${t.quantity}>0 AND ${t.unitPrice}>=0`),
  ]
);
export const invoiceMatches = mysqlTable(
  "scm_invoice_matches",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoice_id")
      .notNull()
      .references(() => invoices.id),
    invoiceLineId: int("invoice_line_id")
      .notNull()
      .references(() => invoiceLines.id),
    eligibleQuantity: decimal("eligible_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    result: mysqlEnum("result", [
      "matched",
      "quantity_exceeded",
      "price_mismatch",
      "invalid_order",
    ]).notNull(),
    matchedBy: int("matched_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("invoice_match_history").on(t.invoiceId, t.id)]
);
export const creditNotes = mysqlTable(
  "scm_credit_notes",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    supplierReference: varchar("supplier_reference", { length: 100 }).notNull(),
    invoiceId: int("invoice_id")
      .notNull()
      .references(() => invoices.id),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    returnId: int("return_id").references(() => supplierReturns.id),
    reason: text("reason").notNull(),
    total: money("total").notNull(),
    retentionCredit: money("retention_credit").notNull(),
    status: mysqlEnum("status", ["pending", "approved", "rejected", "returned"])
      .default("pending")
      .notNull(),
    workflowId: int("workflow_id").references(() => workflowInstances.id),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("credit_supplier_reference").on(
      t.supplierId,
      t.supplierReference
    ),
  ]
);
export const creditLines = mysqlTable(
  "scm_credit_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    creditId: int("credit_id")
      .notNull()
      .references(() => creditNotes.id),
    invoiceLineId: int("invoice_line_id")
      .notNull()
      .references(() => invoiceLines.id),
    quantity: decimal("quantity", { precision: 18, scale: 6 }).notNull(),
    total: money("total").notNull(),
  },
  t => [
    uniqueIndex("credit_invoice_line").on(t.creditId, t.invoiceLineId),
    check("credit_quantity_positive", sql`${t.quantity}>0`),
  ]
);
export const paymentSchedules = mysqlTable("scm_payment_schedules", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("order_id")
    .notNull()
    .references(() => orders.id)
    .unique(),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const paymentMilestones = mysqlTable(
  "scm_payment_milestones",
  {
    id: int("id").autoincrement().primaryKey(),
    scheduleId: int("schedule_id")
      .notNull()
      .references(() => paymentSchedules.id),
    position: int("position").notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull(),
    nameEn: varchar("name_en", { length: 255 }).notNull(),
    nameUr: varchar("name_ur", { length: 255 }).notNull(),
    percent: decimal("percent", { precision: 7, scale: 4 }).notNull(),
    amount: money("amount").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    condition: mysqlEnum("condition", [
      "advance",
      "accepted",
      "planting",
      "warranty",
      "manual",
    ]).notNull(),
    status: mysqlEnum("status", ["planned", "eligible"])
      .default("planned")
      .notNull(),
    evidence: text("evidence"),
    conditionMetBy: int("condition_met_by").references(() => users.id),
  },
  t => [
    uniqueIndex("payment_schedule_position").on(t.scheduleId, t.position),
    check(
      "milestone_values",
      sql`${t.percent}>0 AND ${t.percent}<=100 AND ${t.amount}>=0`
    ),
  ]
);
export const payments = mysqlTable(
  "scm_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id),
    invoiceId: int("invoice_id").references(() => invoices.id),
    milestoneId: int("milestone_id").references(() => paymentMilestones.id),
    sourceAdvanceId: int("source_advance_id").references(
      (): AnyMySqlColumn => payments.id
    ),
    kind: mysqlEnum("kind", ["advance", "invoice", "recovery"]).notNull(),
    amount: money("amount").notNull(),
    reference: varchar("reference", { length: 150 }).notNull().unique(),
    status: mysqlEnum("status", ["pending", "posted", "rejected", "returned"])
      .default("pending")
      .notNull(),
    workflowId: int("workflow_id").references(() => workflowInstances.id),
    reason: text("reason").notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    index("payment_invoice_status").on(t.invoiceId, t.status),
    index("payment_advance_status").on(t.sourceAdvanceId, t.status),
    check("payment_positive", sql`${t.amount}>0`),
  ]
);
export const retentionReleases = mysqlTable("scm_retention_releases", {
  id: int("id").autoincrement().primaryKey(),
  invoiceId: int("invoice_id")
    .notNull()
    .references(() => invoices.id)
    .unique(),
  amount: money("amount").notNull(),
  evidence: text("evidence").notNull(),
  status: mysqlEnum("status", ["pending", "posted", "rejected", "returned"])
    .default("pending")
    .notNull(),
  workflowId: int("workflow_id").references(() => workflowInstances.id),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
