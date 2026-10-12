import { sql } from "drizzle-orm";
import {
  check,
  datetime,
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

export const documentSequences = mysqlTable(
  "document_sequences",
  {
    id: int("id").autoincrement().primaryKey(),
    prefix: varchar("prefix", { length: 12 }).notNull(),
    year: int("year").notNull(),
    nextValue: int("next_value").default(1).notNull(),
  },
  t => [
    uniqueIndex("sequence_prefix_year").on(t.prefix, t.year),
    check("sequence_positive", sql`${t.nextValue} > 0`),
  ]
);

export const operationKeys = mysqlTable(
  "operation_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    operation: varchar("operation", { length: 80 }).notNull(),
    key: varchar("request_key", { length: 100 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    result: json("result").$type<{ id: number }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [uniqueIndex("operation_actor_key").on(t.actorId, t.operation, t.key)]
);

export const scmAuditEvents = mysqlTable(
  "scm_audit_events",
  {
    id: int("id").autoincrement().primaryKey(),
    actorId: int("actor_id")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: int("entity_id").notNull(),
    before: json("before_value").$type<unknown>(),
    after: json("after_value").$type<unknown>(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    index("scm_audit_entity").on(t.entityType, t.entityId),
    index("scm_audit_actor_time").on(t.actorId, t.createdAt),
  ]
);

export const scmOutbox = mysqlTable(
  "scm_outbox",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: varchar("event_id", { length: 36 }).notNull().unique(),
    type: varchar("event_type", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: int("entity_id").notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", ["pending", "processing", "sent", "failed"])
      .default("pending")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    nextAttemptAt: datetime("next_attempt_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [index("outbox_dispatch").on(t.status, t.nextAttemptAt)]
);
