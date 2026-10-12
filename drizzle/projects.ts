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
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";
import { branches, costCenters } from "./master-data";
export const projects = mysqlTable(
  "scm_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    nameAr: varchar("name_ar", { length: 255 }).notNull(),
    nameEn: varchar("name_en", { length: 255 }).notNull(),
    nameUr: varchar("name_ur", { length: 255 }).notNull(),
    branchId: int("branch_id")
      .notNull()
      .references(() => branches.id),
    managerId: int("manager_id")
      .notNull()
      .references(() => users.id),
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),
    startsAt: date("starts_at", { mode: "string" }),
    endsAt: date("ends_at", { mode: "string" }),
    status: mysqlEnum("status", [
      "planning",
      "active",
      "on_hold",
      "completed",
      "cancelled",
    ])
      .default("planning")
      .notNull(),
    version: int("version").default(1).notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    index("project_branch_status").on(t.branchId, t.status),
    check(
      "project_dates",
      sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`
    ),
  ]
);
export const wbsNodes = mysqlTable(
  "scm_wbs_nodes",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    parentId: int("parent_id").references((): AnyMySqlColumn => wbsNodes.id),
    code: varchar("code", { length: 40 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull(),
    nameEn: varchar("name_en", { length: 255 }).notNull(),
    nameUr: varchar("name_ur", { length: 255 }).notNull(),
    startsAt: date("starts_at", { mode: "string" }),
    endsAt: date("ends_at", { mode: "string" }),
    progress: int("progress").default(0).notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
  },
  t => [
    uniqueIndex("wbs_project_code").on(t.projectId, t.code),
    check("wbs_progress", sql`${t.progress} BETWEEN 0 AND 100`),
    check(
      "wbs_dates",
      sql`${t.endsAt} IS NULL OR ${t.startsAt} IS NULL OR ${t.endsAt} >= ${t.startsAt}`
    ),
  ]
);
export const budgets = mysqlTable(
  "scm_budgets",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id")
      .notNull()
      .references(() => projects.id),
    wbsId: int("wbs_id")
      .notNull()
      .references(() => wbsNodes.id),
    costCenterId: int("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["draft", "approved", "rejected", "superseded"])
      .default("draft")
      .notNull(),
    replacesId: int("replaces_id").references((): AnyMySqlColumn => budgets.id),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: int("approved_by").references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    index("budget_scope_status").on(
      t.projectId,
      t.wbsId,
      t.costCenterId,
      t.status
    ),
    check("budget_nonnegative", sql`${t.amount} >= 0`),
  ]
);
export const budgetLedger = mysqlTable(
  "scm_budget_ledger",
  {
    id: int("id").autoincrement().primaryKey(),
    budgetId: int("budget_id")
      .notNull()
      .references(() => budgets.id),
    metric: mysqlEnum("metric", [
      "commitment",
      "received",
      "actual",
      "paid",
    ]).notNull(),
    amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: int("source_id").notNull(),
    sourceLineId: int("source_line_id").notNull(),
    eventKey: varchar("event_key", { length: 100 }).notNull().unique(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("budget_ledger_scope").on(t.budgetId, t.metric)]
);
