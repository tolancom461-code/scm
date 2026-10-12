import { sql } from "drizzle-orm";
import {
  check,
  datetime,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";

export const workflowDefinitions = mysqlTable(
  "scm_workflow_definitions",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull(),
    version: int("version").notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull(),
    nameEn: varchar("name_en", { length: 255 }).notNull(),
    nameUr: varchar("name_ur", { length: 255 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    department: varchar("department", { length: 100 }).notNull().default("*"),
    minAmount: decimal("min_amount", { precision: 18, scale: 2 }).notNull(),
    maxAmount: decimal("max_amount", { precision: 18, scale: 2 }),
    active: mysqlEnum("active", ["yes", "no"]).default("yes").notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    uniqueIndex("workflow_code_version").on(t.code, t.version),
    index("workflow_selection").on(
      t.entityType,
      t.currency,
      t.department,
      t.active
    ),
    check(
      "workflow_amount_range",
      sql`${t.minAmount} >= 0 AND (${t.maxAmount} IS NULL OR ${t.maxAmount} > ${t.minAmount})`
    ),
  ]
);
export const workflowSteps = mysqlTable(
  "scm_workflow_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    definitionId: int("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id),
    position: int("position").notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull(),
    nameEn: varchar("name_en", { length: 255 }).notNull(),
    nameUr: varchar("name_ur", { length: 255 }).notNull(),
  },
  t => [
    uniqueIndex("workflow_step_position").on(t.definitionId, t.position),
    check("workflow_step_positive", sql`${t.position} > 0`),
  ]
);
export const workflowApprovers = mysqlTable(
  "scm_workflow_approvers",
  {
    id: int("id").autoincrement().primaryKey(),
    stepId: int("step_id")
      .notNull()
      .references(() => workflowSteps.id),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    limit: decimal("approval_limit", { precision: 18, scale: 2 }).notNull(),
  },
  t => [
    uniqueIndex("workflow_step_user").on(t.stepId, t.userId),
    check("workflow_limit_nonnegative", sql`${t.limit} >= 0`),
  ]
);
export const workflowInstances = mysqlTable(
  "scm_workflow_instances",
  {
    id: int("id").autoincrement().primaryKey(),
    definitionId: int("definition_id").notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: int("entity_id").notNull(),
    cycle: int("cycle").notNull(),
    amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    department: varchar("department", { length: 100 }).notNull(),
    requesterId: int("requester_id")
      .notNull()
      .references(() => users.id),
    blockedActorIds: json("blocked_actor_ids").$type<number[]>().notNull(),
    currentPosition: int("current_position").notNull().default(1),
    status: mysqlEnum("status", [
      "pending",
      "approved",
      "rejected",
      "returned",
      "cancelled",
    ])
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    foreignKey({
      name: "workflow_instance_definition_fk",
      columns: [t.definitionId],
      foreignColumns: [workflowDefinitions.id],
    }),
    uniqueIndex("workflow_entity_cycle").on(t.entityType, t.entityId, t.cycle),
    index("workflow_pending").on(t.status, t.definitionId),
  ]
);
export const workflowDelegations = mysqlTable(
  "scm_workflow_delegations",
  {
    id: int("id").autoincrement().primaryKey(),
    fromUserId: int("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: int("to_user_id")
      .notNull()
      .references(() => users.id),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    startsAt: datetime("starts_at").notNull(),
    endsAt: datetime("ends_at").notNull(),
    revokedAt: datetime("revoked_at"),
    reason: text("reason").notNull(),
    createdBy: int("created_by")
      .notNull()
      .references(() => users.id),
  },
  t => [
    index("delegation_eligibility").on(t.fromUserId, t.toUserId, t.entityType),
    check(
      "delegation_valid",
      sql`${t.fromUserId} <> ${t.toUserId} AND ${t.endsAt} > ${t.startsAt}`
    ),
  ]
);
export const workflowDecisions = mysqlTable(
  "scm_workflow_decisions",
  {
    id: int("id").autoincrement().primaryKey(),
    instanceId: int("instance_id")
      .notNull()
      .references(() => workflowInstances.id),
    stepId: int("step_id")
      .notNull()
      .references(() => workflowSteps.id),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    onBehalfOf: int("on_behalf_of")
      .notNull()
      .references(() => users.id),
    delegationId: int("delegation_id"),
    action: mysqlEnum("action", ["approve", "reject", "return"]).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    foreignKey({
      name: "workflow_decision_delegation_fk",
      columns: [t.delegationId],
      foreignColumns: [workflowDelegations.id],
    }),
    uniqueIndex("workflow_decision_once").on(t.instanceId, t.stepId),
  ]
);
