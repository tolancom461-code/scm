import { boolean, datetime, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 80 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }).default("local"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  active: boolean("active").default(true).notNull(),
  preferredLocale: mysqlEnum("preferredLocale", ["ar", "en", "ur"]).default("ar").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: datetime("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("sessions_user_idx").on(table.userId)]);

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 120 }).notNull().unique(),
  module: varchar("module", { length: 60 }).notNull(),
  action: varchar("action", { length: 60 }).notNull(),
  labelAr: varchar("labelAr", { length: 255 }).notNull(),
  labelEn: varchar("labelEn", { length: 255 }).notNull(),
  labelUr: varchar("labelUr", { length: 255 }).notNull(),
});

export const userPermissions = mysqlTable("userPermissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  permissionId: int("permissionId").notNull(),
  scopeType: varchar("scopeType", { length: 40 }).default("global").notNull(),
  scopeValue: varchar("scopeValue", { length: 120 }),
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
}, table => [uniqueIndex("user_permission_scope_unique").on(table.userId, table.permissionId, table.scopeType)]);

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
  status: mysqlEnum("supplierStatus", ["active", "suspended", "blocked"]).default("active").notNull(),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const purchaseRequests = mysqlTable("purchaseRequests", {
  id: int("id").autoincrement().primaryKey(),
  requestNumber: varchar("requestNumber", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  department: varchar("department", { length: 120 }),
  site: varchar("site", { length: 120 }),
  supplierId: int("supplierId"),
  source: varchar("source", { length: 80 }).default("internal").notNull(),
  priority: mysqlEnum("requestPriority", ["low", "normal", "high", "urgent"]).default("normal").notNull(),
  budgetCode: varchar("budgetCode", { length: 80 }),
  budgetLimit: decimal("budgetLimit", { precision: 14, scale: 2 }),
  estimatedValue: decimal("estimatedValue", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
  neededBy: datetime("neededBy"),
  status: mysqlEnum("requestStatus", ["draft", "submitted", "approved", "rejected", "cancelled"]).default("draft").notNull(),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const purchaseRequestItems = mysqlTable("purchaseRequestItems", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 14, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 30 }).notNull(),
  estimatedUnitPrice: decimal("estimatedUnitPrice", { precision: 14, scale: 2 }).default("0").notNull(),
  specifications: text("specifications"),
}, table => [index("request_items_request_idx").on(table.requestId)]);

export const requestApprovals = mysqlTable("requestApprovals", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull(),
  action: mysqlEnum("approvalAction", ["submitted", "approved", "rejected", "cancelled", "revised"]).notNull(),
  comment: text("comment"),
  actedBy: int("actedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("approvals_request_idx").on(table.requestId)]);

export const purchasePackages = mysqlTable("purchasePackages", {
  id: int("id").autoincrement().primaryKey(),
  packageNumber: varchar("packageNumber", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("packageStatus", { length: 40 }).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const rfqs = mysqlTable("rfqs", {
  id: int("id").autoincrement().primaryKey(),
  packageId: int("packageId"),
  rfqNumber: varchar("rfqNumber", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  closingAt: datetime("closingAt"),
  status: varchar("rfqStatus", { length: 40 }).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const quotations = mysqlTable("quotations", {
  id: int("id").autoincrement().primaryKey(),
  rfqId: int("rfqId").notNull(),
  supplierId: int("supplierId").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
  deliveryDays: int("deliveryDays"),
  paymentTerms: varchar("paymentTerms", { length: 255 }),
  technicalCompliance: varchar("technicalCompliance", { length: 60 }),
  status: varchar("quotationStatus", { length: 40 }).default("received").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const awards = mysqlTable("awards", {
  id: int("id").autoincrement().primaryKey(),
  awardNumber: varchar("awardNumber", { length: 50 }).notNull().unique(),
  quotationId: int("quotationId").notNull(),
  supplierId: int("supplierId").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("awardStatus", { length: 40 }).default("pending").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const contracts = mysqlTable("contracts", {
  id: int("id").autoincrement().primaryKey(),
  contractNumber: varchar("contractNumber", { length: 50 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  supplierId: int("supplierId").notNull(),
  contractType: varchar("contractType", { length: 50 }).default("supply").notNull(),
  startDate: datetime("startDate"),
  endDate: datetime("endDate"),
  originalValue: decimal("originalValue", { precision: 14, scale: 2 }).notNull(),
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
  status: varchar("contractStatus", { length: 40 }).default("draft").notNull(),
  scope: text("scope"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const contractAmendments = mysqlTable("contractAmendments", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(),
  amendmentNumber: varchar("amendmentNumber", { length: 50 }).notNull().unique(),
  amendmentType: varchar("amendmentType", { length: 50 }).notNull(),
  valueChange: decimal("valueChange", { precision: 14, scale: 2 }).default("0").notNull(),
  extensionDays: int("extensionDays").default(0).notNull(),
  reason: text("reason").notNull(),
  status: varchar("amendmentStatus", { length: 40 }).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const purchaseOrders = mysqlTable("purchaseOrders", {
  id: int("id").autoincrement().primaryKey(),
  poNumber: varchar("poNumber", { length: 50 }).notNull().unique(),
  supplierId: int("supplierId").notNull(),
  contractId: int("contractId"),
  requestId: int("requestId"),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
  deliveryDate: datetime("deliveryDate"),
  deliveryLocation: varchar("deliveryLocation", { length: 255 }),
  status: varchar("poStatus", { length: 40 }).default("draft").notNull(),
  terms: text("terms"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const deliveries = mysqlTable("deliveries", {
  id: int("id").autoincrement().primaryKey(),
  deliveryNumber: varchar("deliveryNumber", { length: 50 }).notNull().unique(),
  poId: int("poId").notNull(),
  supplierId: int("supplierId").notNull(),
  deliveredAt: datetime("deliveredAt").notNull(),
  deliveredValue: decimal("deliveredValue", { precision: 14, scale: 2 }).default("0").notNull(),
  acceptedValue: decimal("acceptedValue", { precision: 14, scale: 2 }).default("0").notNull(),
  rejectedValue: decimal("rejectedValue", { precision: 14, scale: 2 }).default("0").notNull(),
  status: varchar("deliveryStatus", { length: 40 }).default("delivered").notNull(),
  reference: varchar("reference", { length: 120 }),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const certificates = mysqlTable("certificates", {
  id: int("id").autoincrement().primaryKey(),
  certificateNumber: varchar("certificateNumber", { length: 50 }).notNull().unique(),
  contractId: int("contractId").notNull(),
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).default("0").notNull(),
  previousValue: decimal("previousValue", { precision: 14, scale: 2 }).default("0").notNull(),
  deductions: decimal("deductions", { precision: 14, scale: 2 }).default("0").notNull(),
  netDue: decimal("netDue", { precision: 14, scale: 2 }).default("0").notNull(),
  status: varchar("certificateStatus", { length: 40 }).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const financialOperations = mysqlTable("financialOperations", {
  id: int("id").autoincrement().primaryKey(),
  operationNumber: varchar("operationNumber", { length: 50 }).notNull().unique(),
  supplierId: int("supplierId").notNull(),
  contractId: int("contractId"),
  certificateId: int("certificateId"),
  operationType: varchar("operationType", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("SAR").notNull(),
  operationDate: datetime("operationDate").notNull(),
  status: varchar("financialOperationStatus", { length: 40 }).default("recorded").notNull(),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  documentNumber: varchar("documentNumber", { length: 50 }).notNull().unique(),
  entityType: varchar("entityType", { length: 60 }).notNull(),
  entityId: int("entityId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 500 }).notNull(),
  url: varchar("url", { length: 700 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  checksum: varchar("checksum", { length: 128 }).notNull(),
  classification: mysqlEnum("documentClassification", ["normal", "internal", "confidential", "highly_confidential"]).default("internal").notNull(),
  version: int("version").default(1).notNull(),
  uploadedBy: int("uploadedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("documents_entity_idx").on(table.entityType, table.entityId)]);

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("notificationType", { length: 80 }).notNull(),
  titleAr: varchar("titleAr", { length: 255 }).notNull(),
  titleEn: varchar("titleEn", { length: 255 }).notNull(),
  titleUr: varchar("titleUr", { length: 255 }).notNull(),
  messageAr: text("messageAr"),
  messageEn: text("messageEn"),
  messageUr: text("messageUr"),
  entityType: varchar("entityType", { length: 60 }),
  entityId: int("entityId"),
  readAt: datetime("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("notifications_user_idx").on(table.userId)]);

export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 60 }).notNull(),
  entityId: int("entityId"),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("audit_entity_idx").on(table.entityType, table.entityId)]);

export const integrationEvents = mysqlTable("integrationEvents", {
  id: int("id").autoincrement().primaryKey(),
  sourceSystem: varchar("sourceSystem", { length: 80 }).notNull(),
  destinationSystem: varchar("destinationSystem", { length: 80 }).notNull(),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 60 }).notNull(),
  entityId: int("entityId"),
  correlationId: varchar("correlationId", { length: 100 }).notNull().unique(),
  status: varchar("integrationStatus", { length: 40 }).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: text("lastError"),
  nextRetryAt: datetime("nextRetryAt"),
  completedAt: datetime("completedAt"),
  payloadMeta: text("payloadMeta"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
