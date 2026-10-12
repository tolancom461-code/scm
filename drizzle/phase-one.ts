import {
  int,
  varchar,
  text,
  decimal,
  timestamp,
  json,
  mysqlTable,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";
import { suppliers, users } from "./schema";
import type { ContractItem } from "../shared/phase-one";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
const money = (name: string) =>
  decimal(name, { precision: 18, scale: 2 }).notNull();
export const simpleCompany = mysqlTable("p1_company", {
  id: int("id").primaryKey(),
  data: json("data")
    .$type<{
      name: string;
      address: string;
      registration: string;
      taxNumber: string;
      representative: string;
      logo: string;
    }>()
    .notNull(),
});
export const simpleProjects = mysqlTable("p1_projects", {
  id: int("id").autoincrement().primaryKey(),
  number: varchar("number", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  site: varchar("site", { length: 255 }).notNull(),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const simpleContracts = mysqlTable(
  "p1_contracts",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    projectId: int("project_id")
      .notNull()
      .references(() => simpleProjects.id),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    title: varchar("title", { length: 255 }).notNull(),
    reference: varchar("reference", { length: 100 }).notNull(),
    contractDate: varchar("contract_date", { length: 10 }).notNull(),
    siteDate: varchar("site_date", { length: 10 }).notNull(),
    durationDays: int("duration_days").notNull(),
    warrantyDays: int("warranty_days").notNull().default(0),
    warrantyMonths: int("warranty_months").notNull().default(0),
    handoverDate: varchar("handover_date", { length: 10 }),
    handoverBy: int("handover_by").references(() => users.id),
    handoverReason: text("handover_reason"),
    scope: text("scope").notNull(),
    terms: text("terms").notNull(),
    revision: int("revision").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    correctionReason: text("correction_reason"),
    correctedBy: int("corrected_by").references(() => users.id),
    correctedAt: timestamp("corrected_at"),
    items: json("items").$type<ContractItem[]>().notNull(),
    subtotal: money("subtotal"),
    total: money("total"),
    retentionPercent: decimal("retention_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    taxPercent: decimal("tax_percent", { precision: 7, scale: 4 }).notNull(),
    dailyPenalty: money("daily_penalty"),
    currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("p1_contract_supplier_idx").on(t.supplierId)]
);
export const simpleMilestones = mysqlTable(
  "p1_milestones",
  {
    id: int("id").autoincrement().primaryKey(),
    contractId: int("contract_id")
      .notNull()
      .references(() => simpleContracts.id),
    position: int("position").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    percent: decimal("percent", { precision: 7, scale: 4 }).notNull(),
    amount: money("amount"),
    dueDate: varchar("due_date", { length: 10 }).notNull(),
    minProgress: decimal("min_progress", { precision: 7, scale: 4 }).notNull(),
  },
  t => [
    uniqueIndex("p1_milestone_position_unique").on(t.contractId, t.position),
  ]
);
export const simpleCertificates = mysqlTable(
  "p1_certificates",
  {
    id: int("id").autoincrement().primaryKey(),
    number: varchar("number", { length: 50 }).notNull().unique(),
    contractId: int("contract_id")
      .notNull()
      .references(() => simpleContracts.id),
    certificateDate: varchar("certificate_date", { length: 10 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    quantities: json("quantities").$type<string[]>().notNull(),
    progress: decimal("progress", { precision: 7, scale: 4 }).notNull(),
    cumulativeGross: money("cumulative_gross"),
    previousGross: money("previous_gross"),
    gross: money("gross"),
    tax: money("tax"),
    retention: money("retention"),
    penalty: money("penalty"),
    delayDays: int("delay_days").notNull(),
    otherDeduction: money("other_deduction"),
    deductionReason: text("deduction_reason").notNull(),
    net: money("net"),
    notes: text("notes").notNull(),
    decisionReason: text("decision_reason"),
    decidedBy: int("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at"),
    releasedAmount: money("released_amount").default("0"),
    releasedBy: int("released_by").references(() => users.id),
    releaseReason: text("release_reason"),
    releaseDate: varchar("release_date", { length: 10 }),
    scheduleVersion: int("schedule_version").default(0).notNull(),
    scheduleReason: text("schedule_reason"),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("p1_certificate_contract_idx").on(t.contractId)]
);
export const certificateInstallments = mysqlTable(
  "p1_certificate_installments",
  {
    id: int("id").autoincrement().primaryKey(),
    contractId: int("contract_id")
      .notNull()
      .references(() => simpleContracts.id),
    certificateId: int("certificate_id").notNull(),
    version: int("version").notNull(),
    position: int("position").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    percent: decimal("percent", { precision: 7, scale: 4 }).notNull(),
    amount: money("amount"),
    dueDate: varchar("due_date", { length: 10 }).notNull(),
  },
  t => [
    foreignKey({
      name: "p1_installment_certificate_fk",
      columns: [t.certificateId],
      foreignColumns: [simpleCertificates.id],
    }),
    uniqueIndex("p1_cert_installment_version_position").on(
      t.certificateId,
      t.version,
      t.position
    ),
  ]
);
export const simplePayments = mysqlTable(
  "p1_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    contractId: int("contract_id")
      .notNull()
      .references(() => simpleContracts.id),
    certificateId: int("certificate_id")
      .notNull()
      .references(() => simpleCertificates.id),
    milestoneId: int("milestone_id").references(() => simpleMilestones.id),
    installmentId: int("installment_id").references(
      () => certificateInstallments.id
    ),
    replacesPaymentId: int("replaces_payment_id")
      .unique()
      .references((): AnyMySqlColumn => simplePayments.id),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    reversedBy: int("reversed_by").references(() => users.id),
    reversedAt: timestamp("reversed_at"),
    reversalReason: text("reversal_reason"),
    kind: varchar("kind", { length: 20 }).notNull(),
    amount: money("amount"),
    paymentDate: varchar("payment_date", { length: 10 }).notNull(),
    voucher: varchar("voucher", { length: 100 }).notNull(),
    voucherKey: varchar("voucher_key", { length: 110 }).unique(),
    notes: text("notes").notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("p1_payment_contract_idx").on(t.contractId)]
);
export const paymentReversals = mysqlTable("p1_payment_reversals", {
  id: int("id").autoincrement().primaryKey(),
  paymentId: int("payment_id")
    .notNull()
    .references(() => simplePayments.id),
  pendingPaymentId: int("pending_payment_id").unique(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  reason: text("reason").notNull(),
  createdBy: int("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedBy: int("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at"),
  decisionReason: text("decision_reason"),
});
