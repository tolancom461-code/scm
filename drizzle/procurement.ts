import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
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
import {
  branches,
  items,
  units,
  sites,
  warehouses,
  costCenters,
} from "./master-data";
import { projects, wbsNodes, budgets } from "./projects";
import { workflowInstances } from "./workflows";
const monetary = (name: string) => decimal(name, { precision: 18, scale: 2 });
const quantity = (name: string) => decimal(name, { precision: 18, scale: 6 });
export const requisitions = mysqlTable(
  "scm_requisitions",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    department: varchar("department", { length: 100 }).notNull(),
    branchId: int("branch_id")
      .notNull()
      .references(() => branches.id),
    currency: varchar("currency", { length: 3 }).notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high", "urgent"])
      .notNull()
      .default("normal"),
    reason: text("reason").notNull(),
    requiredDate: date("required_date", { mode: "string" }).notNull(),
    total: monetary("total").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "pending",
      "approved",
      "rejected",
      "returned",
      "cancelled",
      "closed",
    ])
      .notNull()
      .default("draft"),
    version: int("version").notNull().default(1),
    workflowId: int("workflow_id").references(() => workflowInstances.id),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => [index("requisition_status_date").on(t.status, t.requiredDate)]
);
export const requisitionLines = mysqlTable(
  "scm_requisition_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    requisitionId: int("requisition_id")
      .notNull()
      .references(() => requisitions.id),
    position: int("position").notNull(),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    description: text("description").notNull(),
    specification: text("specification"),
    quantity: quantity("quantity").notNull(),
    uomId: int("uom_id")
      .notNull()
      .references(() => units.id),
    unitPrice: monetary("unit_price").notNull(),
    amount: monetary("amount").notNull(),
    requiredDate: date("required_date", { mode: "string" }).notNull(),
    siteId: int("site_id")
      .notNull()
      .references(() => sites.id),
    warehouseId: int("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    wbsId: int("wbs_id")
      .notNull()
      .references(() => wbsNodes.id),
    costCenterId: int("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    budgetId: int("budget_id")
      .notNull()
      .references(() => budgets.id),
  },
  t => [
    uniqueIndex("requisition_line_position").on(t.requisitionId, t.position),
    check(
      "requisition_line_values",
      sql`${t.quantity}>0 AND ${t.unitPrice}>=0 AND ${t.amount}>=0`
    ),
  ]
);
export const sourcingRfqs = mysqlTable(
  "scm_rfqs",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    opensAt: date("opens_at", { mode: "string" }).notNull(),
    closesAt: date("closes_at", { mode: "string" }).notNull(),
    terms: text("terms").notNull(),
    status: mysqlEnum("status", ["draft", "open", "closed", "cancelled"])
      .notNull()
      .default("draft"),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [check("rfq_date_range", sql`${t.closesAt}>=${t.opensAt}`)]
);
export const rfqLines = mysqlTable(
  "scm_rfq_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    rfqId: int("rfq_id")
      .notNull()
      .references(() => sourcingRfqs.id),
    requisitionLineId: int("requisition_line_id")
      .notNull()
      .references(() => requisitionLines.id),
    quantity: quantity("quantity").notNull(),
  },
  t => [
    uniqueIndex("rfq_source_line").on(t.rfqId, t.requisitionLineId),
    check("rfq_line_quantity", sql`${t.quantity}>0`),
  ]
);
export const rfqSuppliers = mysqlTable(
  "scm_rfq_suppliers",
  {
    id: int("id").autoincrement().primaryKey(),
    rfqId: int("rfq_id")
      .notNull()
      .references(() => sourcingRfqs.id),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
  },
  t => [uniqueIndex("rfq_supplier_invitation").on(t.rfqId, t.supplierId)]
);
export const supplierQuotations = mysqlTable(
  "scm_quotations",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    supplierReference: varchar("supplier_reference", { length: 100 }).notNull(),
    rfqId: int("rfq_id")
      .notNull()
      .references(() => sourcingRfqs.id),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    paymentTerms: text("payment_terms").notNull(),
    deliveryTerms: text("delivery_terms").notNull(),
    total: monetary("total").notNull(),
    status: mysqlEnum("status", ["received", "evaluated", "disqualified"])
      .notNull()
      .default("received"),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("quotation_supplier_reference").on(
      t.supplierId,
      t.supplierReference
    ),
    index("quotation_rfq").on(t.rfqId),
  ]
);
export const quotationLines = mysqlTable(
  "scm_quotation_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    quotationId: int("quotation_id")
      .notNull()
      .references(() => supplierQuotations.id),
    rfqLineId: int("rfq_line_id")
      .notNull()
      .references(() => rfqLines.id),
    quantity: quantity("quantity").notNull(),
    unitPrice: monetary("unit_price").notNull(),
    discountPercent: decimal("discount_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    taxPercent: decimal("tax_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    subtotal: monetary("subtotal").notNull(),
    taxAmount: monetary("tax_amount").notNull(),
    total: monetary("total").notNull(),
    brand: varchar("brand", { length: 100 }),
    model: varchar("model", { length: 100 }),
    deliveryDays: int("delivery_days").notNull(),
    warranty: text("warranty"),
    notes: text("notes"),
  },
  t => [
    uniqueIndex("quotation_rfq_line").on(t.quotationId, t.rfqLineId),
    check(
      "quotation_line_values",
      sql`${t.quantity}>0 AND ${t.unitPrice}>=0 AND ${t.discountPercent} BETWEEN 0 AND 100 AND ${t.taxPercent} BETWEEN 0 AND 100 AND ${t.deliveryDays}>=0`
    ),
  ]
);
export const quotationEvaluations = mysqlTable(
  "scm_quotation_evaluations",
  {
    id: int("id").autoincrement().primaryKey(),
    quotationId: int("quotation_id")
      .notNull()
      .references(() => supplierQuotations.id),
    technical: int("technical").notNull(),
    commercial: int("commercial").notNull(),
    delivery: int("delivery").notNull(),
    overall: decimal("overall", { precision: 7, scale: 2 }).notNull(),
    eligible: mysqlEnum("eligible", ["yes", "no"]).notNull(),
    reason: text("reason").notNull(),
    evaluatedBy: int("evaluated_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("quotation_evaluation").on(t.quotationId),
    check(
      "quotation_scores",
      sql`${t.technical} BETWEEN 0 AND 100 AND ${t.commercial} BETWEEN 0 AND 100 AND ${t.delivery} BETWEEN 0 AND 100`
    ),
  ]
);
export const sourcingAwards = mysqlTable("scm_awards", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  rfqId: int("rfq_id")
    .notNull()
    .references(() => sourcingRfqs.id),
  currency: varchar("currency", { length: 3 }).notNull(),
  department: varchar("department", { length: 100 }).notNull(),
  reason: text("reason").notNull(),
  total: monetary("total").notNull(),
  status: mysqlEnum("status", [
    "draft",
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
});
export const awardLines = mysqlTable(
  "scm_award_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    awardId: int("award_id")
      .notNull()
      .references(() => sourcingAwards.id),
    quotationLineId: int("quotation_line_id")
      .notNull()
      .references(() => quotationLines.id),
    quantity: quantity("quantity").notNull(),
    total: monetary("total").notNull(),
  },
  t => [
    uniqueIndex("award_quotation_line").on(t.awardId, t.quotationLineId),
    check("award_line_positive", sql`${t.quantity}>0`),
  ]
);
export const orders = mysqlTable(
  "scm_orders",
  {
    execution: mysqlEnum("execution", ["goods", "works"]).notNull().default("goods"),
    title: varchar("title", { length: 255 }).notNull().default(""),
    contractReference: varchar("contract_reference", { length: 100 }),
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    currency: varchar("currency", { length: 3 }).notNull(),
    department: varchar("department", { length: 100 }).notNull(),
    paymentTerms: text("payment_terms").notNull(),
    deliveryTerms: text("delivery_terms").notNull(),
    total: monetary("total").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "pending",
      "approved",
      "rejected",
      "returned",
      "cancelled",
      "closed",
    ])
      .default("draft")
      .notNull(),
    workflowId: int("workflow_id").references(() => workflowInstances.id),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("order_supplier_status").on(t.supplierId, t.status)]
);
export const orderLines = mysqlTable(
  "scm_order_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("order_id")
      .notNull()
      .references(() => orders.id),
    awardLineId: int("award_line_id")
      .references(() => awardLines.id),
    itemId: int("item_id")
      .notNull()
      .references(() => items.id),
    uomId: int("uom_id")
      .notNull()
      .references(() => units.id),
    description: text("description").notNull(),
    quantity: quantity("quantity").notNull(),
    unitPrice: monetary("unit_price").notNull(),
    discountPercent: decimal("discount_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    taxPercent: decimal("tax_percent", { precision: 7, scale: 4 }).notNull(),
    subtotal: monetary("subtotal").notNull(),
    taxAmount: monetary("tax_amount").notNull(),
    total: monetary("total").notNull(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    wbsId: int("wbs_id")
      .notNull()
      .references(() => wbsNodes.id),
    costCenterId: int("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    budgetId: int("budget_id")
      .notNull()
      .references(() => budgets.id),
  },
  t => [
    uniqueIndex("order_award_line").on(t.orderId, t.awardLineId),
    check("order_line_positive", sql`${t.quantity}>0`),
  ]
);
export const orderSchedules = mysqlTable(
  "scm_order_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    orderLineId: int("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    quantity: quantity("quantity").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    warehouseId: int("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    siteId: int("site_id")
      .notNull()
      .references(() => sites.id),
  },
  t => [
    index("order_schedule_line_date").on(t.orderLineId, t.dueDate),
    check("order_schedule_positive", sql`${t.quantity}>0`),
  ]
);
