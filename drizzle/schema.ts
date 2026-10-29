import {
  boolean,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 80 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  active: boolean("active").default(true).notNull(),
  preferredLocale: mysqlEnum("preferredLocale", ["ar", "en", "ur"])
    .default("ar")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const sessions = mysqlTable(
  "sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: datetime("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("sessions_user_idx").on(table.userId)]
);

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 120 }).notNull().unique(),
  module: varchar("module", { length: 60 }).notNull(),
  action: varchar("action", { length: 60 }).notNull(),
  labelAr: varchar("labelAr", { length: 255 }).notNull(),
  labelEn: varchar("labelEn", { length: 255 }).notNull(),
  labelUr: varchar("labelUr", { length: 255 }).notNull(),
});

export const userPermissions = mysqlTable(
  "userPermissions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    permissionId: int("permissionId").notNull(),
    scopeType: varchar("scopeType", { length: 40 }).default("global").notNull(),
    scopeValue: varchar("scopeValue", { length: 120 }),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("user_permission_scope_unique").on(
      table.userId,
      table.permissionId,
      table.scopeType
    ),
  ]
);

export const suppliers = mysqlTable("suppliers", {
  id: int("id").autoincrement().primaryKey(),
  supplierNumber: varchar("supplierNumber", { length: 40 }).notNull().unique(),
  nameAr: varchar("nameAr", { length: 255 }).notNull(),
  nameEn: varchar("nameEn", { length: 255 }),
  nameUr: varchar("nameUr", { length: 255 }),
  commercialRegistration: varchar("commercialRegistration", { length: 100 }),
  taxNumber: varchar("taxNumber", { length: 100 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 60 }),
  country: varchar("country", { length: 120 }),
  category: varchar("category", { length: 120 }),
  status: mysqlEnum("supplierStatus", ["active", "suspended", "blocked"])
    .default("active")
    .notNull(),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const documents = mysqlTable(
  "documents",
  {
    id: int("id").autoincrement().primaryKey(),
    documentNumber: varchar("documentNumber", { length: 50 })
      .notNull()
      .unique(),
    entityType: varchar("entityType", { length: 60 }).notNull(),
    entityId: int("entityId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    storageKey: varchar("storageKey", { length: 500 }).notNull(),
    url: varchar("url", { length: 700 }).notNull(),
    mimeType: varchar("mimeType", { length: 120 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    classification: mysqlEnum("documentClassification", [
      "normal",
      "internal",
      "confidential",
      "highly_confidential",
    ])
      .default("internal")
      .notNull(),
    version: int("version").default(1).notNull(),
    uploadedBy: int("uploadedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("documents_entity_idx").on(table.entityType, table.entityId)]
);
export type User = typeof users.$inferSelect;
