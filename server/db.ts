import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { createHash } from "crypto";
import {
  auditLogs, certificates, contractAmendments, contracts, deliveries, documents, financialOperations, notifications, permissions,
  purchaseOrders, purchasePackages, purchaseRequestItems, purchaseRequests, quotations, requestApprovals, rfqs, awards, sessions, suppliers,
  userPermissions, users, type InsertUser,
} from "../drizzle/schema";
import { ATOMIC_PERMISSIONS } from "./permissions";
import { accessProfiles } from "../drizzle/policy";
import { importLegacyPermissions } from "../shared/policy";
import { hashSessionToken } from "./localAuth";
import { calculateContractEndDate } from "./contracts";
import { applyReportFilters, filtersForReportModule, REPORT_STATUS_OPTIONS, type ReportFilters } from "./reportFilters";
import { documentSequences } from "../drizzle/foundation";
import { DomainError } from "./core/errors";
import type { Transaction } from "./core/database";

let _db: MySql2Database | null = null;
let _pool: Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    _pool = createPool({ host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)), connectionLimit: 10,
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } });
    _db = drizzle(_pool);
  }
  return _db;
}
export async function closeDb() { await _pool?.end(); _pool = null; _db = null; }

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حالياً.");
  return db;
}

export async function countUsers() {
  const db = await requireDb();
  return (await db.select({ id: users.id }).from(users)).length;
}

export async function seedPermissions() {
  const db = await requireDb();
  for (const permission of ATOMIC_PERMISSIONS) {
    await db.insert(permissions).values({
      code: permission.code, module: permission.module, action: permission.action,
      labelAr: permission.ar, labelEn: permission.en, labelUr: permission.ur,
    }).onDuplicateKeyUpdate({ set: { labelAr: permission.ar, labelEn: permission.en, labelUr: permission.ur } });
  }
}

type CreateLocalUserInput = { username: string; passwordHash: string; name: string; email?: string; role?: "admin" | "user"; locale?: "ar" | "en" | "ur"; permissionCodes?: string[] };
export async function insertLocalUser(tx: Transaction, input: CreateLocalUserInput) {
  const role = input.role ?? "user";
  const allPermissions = await tx.select().from(permissions);
  if ((input.permissionCodes ?? []).some(code => !allPermissions.some(p => p.code === code))) throw new DomainError("INVALID_INPUT");
  const [created] = await tx.insert(users).values({
    openId: `local:${input.username}`, username: input.username, passwordHash: input.passwordHash,
    name: input.name, email: input.email ?? null, loginMethod: "local", role,
    preferredLocale: input.locale ?? "ar", active: true, lastSignedIn: new Date(),
  }).$returningId();
  if (!created) throw new Error("تعذر إنشاء المستخدم.");
  const codes = role === "admin" ? allPermissions.map(item => item.code) : importLegacyPermissions(input.permissionCodes ?? []);
  const selected = allPermissions.filter(item => codes.includes(item.code));
  if (selected.length) await tx.insert(userPermissions).values(selected.map(item => ({ userId: created.id, permissionId: item.id })));
  await tx.insert(accessProfiles).values({ userId: created.id, allProjects: role === "admin", legacyAccess: role === "admin" });
  return created.id;
}
export async function createLocalUser(input: CreateLocalUserInput) {
  return (await requireDb()).transaction(tx => insertLocalUser(tx, input));
}
export async function createFirstAdministrator(input: CreateLocalUserInput) {
  return (await requireDb()).transaction(async tx => {
    await tx.insert(documentSequences).values({ prefix: "BOOTSTRAP", year: 0 }).onDuplicateKeyUpdate({ set: { prefix: "BOOTSTRAP" } });
    await tx.select().from(documentSequences).where(and(eq(documentSequences.prefix, "BOOTSTRAP"), eq(documentSequences.year, 0))).for("update");
    if ((await tx.select({ id: users.id }).from(users).limit(1)).length) throw new DomainError("CONFLICT");
    return insertLocalUser(tx, { ...input, role: "admin" });
  });
}

export async function getUserByUsername(username: string) {
  const db = await requireDb();
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0] ?? null;
}

export async function getUserBySessionToken(rawToken: string) {
  const db = await requireDb();
  const tokenHash = hashSessionToken(rawToken);
  const sessionRows = await db.select().from(sessions).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()))).limit(1);
  const session = sessionRows[0];
  if (!session) return null;
  const user = (await db.select().from(users).where(eq(users.id, session.userId)).limit(1))[0];
  if (!user || !user.active) return null;
  const grants = await db.select({ code: permissions.code }).from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id)).where(eq(userPermissions.userId, user.id));
  return { ...user, permissionCodes: grants.map(grant => grant.code) };
}

export async function createSession(userId: number, rawToken: string, expiresAt: Date, expectedPasswordHash?: string | null) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user?.active || (expectedPasswordHash !== undefined && user.passwordHash !== expectedPasswordHash)) return false;
    await tx.insert(sessions).values({ userId, tokenHash: hashSessionToken(rawToken), expiresAt });
    await tx.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
    return true;
  });
}

export async function deleteSession(rawToken: string) {
  const db = await requireDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(rawToken)));
}

export async function listPermissions() { const db = await requireDb(); return db.select().from(permissions); }
export async function listUsers() { const db = await requireDb(); return db.select({ id: users.id, username: users.username, name: users.name, email: users.email, active: users.active, preferredLocale: users.preferredLocale, role: users.role, template: accessProfiles.template }).from(users).leftJoin(accessProfiles, eq(users.id, accessProfiles.userId)); }

export async function setUserPermissions(userId: number, codes: string[]) {
  const db = await requireDb();
  await db.transaction(async tx => {
    if (!(await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")).length) throw new DomainError("NOT_FOUND");
    const available = await tx.select().from(permissions);
    if (codes.some(code => !available.some(p => p.code === code))) throw new DomainError("INVALID_INPUT");
    const chosen = available.filter(item => codes.includes(item.code));
    await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
    if (chosen.length) await tx.insert(userPermissions).values(chosen.map(item => ({ userId, permissionId: item.id })));
  });
}

export async function getUserPermissionCodes(userId: number) {
  const db = await requireDb();
  const rows = await db.select({ code: permissions.code }).from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id)).where(eq(userPermissions.userId, userId));
  return rows.map(row => row.code);
}

export async function createAuditLog(userId: number | null, action: string, entityType: string, entityId: number | null, newValue?: unknown) {
  const db = await requireDb();
  await db.insert(auditLogs).values({ userId, action, entityType, entityId, newValue: newValue ? JSON.stringify(newValue) : null });
}

export async function listSuppliers() { const db = await requireDb(); return db.select().from(suppliers).orderBy(desc(suppliers.createdAt)); }
export async function createSupplier(input: typeof suppliers.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(suppliers).values(input).$returningId(); return result?.id; }

export async function listPurchaseRequests() {
  const db = await requireDb();
  const headers = await db.select().from(purchaseRequests).orderBy(desc(purchaseRequests.createdAt));
  const items = await db.select().from(purchaseRequestItems);
  return headers.map(header => ({ ...header, items: items.filter(item => item.requestId === header.id) }));
}

export async function createPurchaseRequest(input: { header: typeof purchaseRequests.$inferInsert; items: Array<Omit<typeof purchaseRequestItems.$inferInsert, "requestId">> }) {
  const db = await requireDb();
  const [created] = await db.insert(purchaseRequests).values(input.header).$returningId();
  if (!created) throw new Error("تعذر إنشاء طلب الشراء.");
  if (input.items.length) await db.insert(purchaseRequestItems).values(input.items.map(item => ({ ...item, requestId: created.id })));
  await db.insert(requestApprovals).values({ requestId: created.id, action: "submitted", actedBy: input.header.createdBy, comment: "تم إنشاء الطلب" });
  return created.id;
}

export async function updateRequestStatus(requestId: number, status: "draft" | "submitted" | "approved" | "rejected" | "cancelled", actorId: number, comment?: string) {
  const db = await requireDb();
  await db.update(purchaseRequests).set({ status }).where(eq(purchaseRequests.id, requestId));
  const action = status === "draft" ? "revised" : status;
  await db.insert(requestApprovals).values({ requestId, action, actedBy: actorId, comment: comment ?? null });
}

export async function listRequestApprovals(requestId: number) {
  const db = await requireDb();
  return db.select().from(requestApprovals).where(eq(requestApprovals.requestId, requestId)).orderBy(desc(requestApprovals.createdAt));
}

export async function getPurchaseRequestById(requestId: number) {
  const db = await requireDb();
  return (await db.select().from(purchaseRequests).where(eq(purchaseRequests.id, requestId)).limit(1))[0] ?? null;
}

export async function listContracts() { const db = await requireDb(); return db.select().from(contracts).orderBy(desc(contracts.createdAt)); }
export async function createContract(input: typeof contracts.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(contracts).values(input).$returningId(); return result?.id; }
export async function listContractAmendments() { const db = await requireDb(); return db.select().from(contractAmendments).orderBy(desc(contractAmendments.createdAt)); }
export async function createContractAmendment(input: typeof contractAmendments.$inferInsert) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [contract] = await tx.select().from(contracts).where(eq(contracts.id, input.contractId)).for("update");
    if (!contract || ["cancelled", "closed", "terminated"].includes(contract.status)) throw new Error("العقد غير موجود أو مغلق.");
    const [result] = await tx.insert(contractAmendments).values({ ...input, status: "draft" }).$returningId();
    return result?.id;
  });
}
export async function listCertificates() { const db = await requireDb(); return db.select().from(certificates).orderBy(desc(certificates.createdAt)); }
export async function createCertificate(input: typeof certificates.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(certificates).values(input).$returningId(); return result?.id; }
export async function listFinancialOperations() { const db = await requireDb(); return db.select().from(financialOperations).orderBy(desc(financialOperations.createdAt)); }
export async function createFinancialOperation(input: typeof financialOperations.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(financialOperations).values(input).$returningId(); return result?.id; }
export async function listRfqs() { const db = await requireDb(); return db.select().from(rfqs).orderBy(desc(rfqs.createdAt)); }
export async function createRfq(input: typeof rfqs.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(rfqs).values(input).$returningId(); return result?.id; }
export async function listPurchasePackages() { const db = await requireDb(); return db.select().from(purchasePackages).orderBy(desc(purchasePackages.createdAt)); }
export async function createPurchasePackage(input: typeof purchasePackages.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(purchasePackages).values(input).$returningId(); return result?.id; }
export async function listQuotations() { const db = await requireDb(); return db.select().from(quotations).orderBy(desc(quotations.createdAt)); }
export async function createQuotation(input: typeof quotations.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(quotations).values(input).$returningId(); return result?.id; }
export async function listAwards() { const db = await requireDb(); return db.select().from(awards).orderBy(desc(awards.createdAt)); }
export async function createAward(input: typeof awards.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(awards).values(input).$returningId(); return result?.id; }
export async function listOrders() {
  const db = await requireDb();
  const [orders, deliveryRows] = await Promise.all([db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)), db.select().from(deliveries)]);
  return orders.map(order => {
    const deliveredValue = deliveryRows.filter(item => item.poId === order.id).reduce((sum, item) => sum + Number(item.deliveredValue), 0);
    return { ...order, deliveredValue: deliveredValue.toFixed(2), remainingValue: Math.max(Number(order.totalAmount) - deliveredValue, 0).toFixed(2) };
  });
}
export async function getPurchaseOrderRemaining(poId: number) {
  const db = await requireDb();
  const order = (await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1))[0];
  if (!order) return null;
  const deliveryRows = await db.select({ deliveredValue: deliveries.deliveredValue }).from(deliveries).where(eq(deliveries.poId, poId));
  const deliveredValue = deliveryRows.reduce((sum, item) => sum + Number(item.deliveredValue), 0);
  return { totalValue: Number(order.totalAmount), deliveredValue, remainingValue: Math.max(Number(order.totalAmount) - deliveredValue, 0) };
}
export async function createPurchaseOrder(input: typeof purchaseOrders.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(purchaseOrders).values(input).$returningId(); return result?.id; }
export async function listDeliveries() { const db = await requireDb(); return db.select().from(deliveries).orderBy(desc(deliveries.createdAt)); }
export async function createDelivery(input: typeof deliveries.$inferInsert) { const db = await requireDb(); const [result] = await db.insert(deliveries).values(input).$returningId(); return result?.id; }

export type ReportModule = "requests" | "rfqs" | "contracts" | "orders" | "deliveries";
export async function getReportData(module: ReportModule, rawFilters?: ReportFilters) {
  const filters = filtersForReportModule(module, rawFilters);
  const cap = <T>(rows: T[]) => rows.slice(0, 10000);
  switch (module) {
    case "requests": return { module, rows: cap(applyReportFilters(await listPurchaseRequests(), filters)) };
    case "rfqs": {
      const [rfqRows, packageRows, quotationRows, awardRows] = await Promise.all([listRfqs(), listPurchasePackages(), listQuotations(), listAwards()]);
      const filteredRows = applyReportFilters(rfqRows, { ...filters, supplierId: undefined }).filter(rfq => !filters.supplierId || quotationRows.some(quotation => quotation.rfqId === rfq.id && quotation.supplierId === filters.supplierId));
      return { module, rows: cap(filteredRows), related: { packages: cap(packageRows), quotations: cap(quotationRows), awards: cap(awardRows) } };
    }
    case "contracts": {
      const [contractRows, amendmentRows, certificateRows, financialRows] = await Promise.all([listContracts(), listContractAmendments(), listCertificates(), listFinancialOperations()]);
      return { module, rows: cap(applyReportFilters(contractRows, filters)), related: { amendments: cap(amendmentRows), certificates: cap(certificateRows), financial: cap(financialRows) } };
    }
    case "orders": return { module, rows: cap(applyReportFilters(await listOrders(), filters)) };
    case "deliveries": return { module, rows: cap(applyReportFilters(await listDeliveries(), filters, ["deliveredAt", "createdAt"])) };
  }
}

export async function getReportFilterOptions(module: ReportModule) {
  const db = await requireDb();
  const [departmentRows, supplierRows] = await Promise.all([
    db.select({ department: purchaseRequests.department }).from(purchaseRequests),
    db.select({ id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn, nameUr: suppliers.nameUr }).from(suppliers).orderBy(suppliers.nameAr),
  ]);
  const departments = module === "requests" ? Array.from(new Set(departmentRows.map(row => row.department).filter((department): department is string => Boolean(department)))).sort() : [];
  return { departments, suppliers: supplierRows, statuses: REPORT_STATUS_OPTIONS[module] };
}
export async function listDocuments(entityType?: string, entityId?: number, includeConfidential = false) {
  const db = await requireDb();
  const rows = entityType && entityId ? await db.select().from(documents).where(and(eq(documents.entityType, entityType), eq(documents.entityId, entityId))).orderBy(desc(documents.createdAt)) : await db.select().from(documents).orderBy(desc(documents.createdAt));
  return includeConfidential ? rows : rows.filter(item => item.classification !== "confidential" && item.classification !== "highly_confidential");
}
export async function createDocument(input: typeof documents.$inferInsert) {
  const db = await requireDb();
  const prior = await db.select({ version: documents.version }).from(documents).where(and(eq(documents.entityType, input.entityType), eq(documents.entityId, input.entityId), eq(documents.title, input.title))).orderBy(desc(documents.version)).limit(1);
  const [result] = await db.insert(documents).values({ ...input, version: (prior[0]?.version ?? 0) + 1 }).$returningId();
  return result?.id;
}

export async function getDocumentByStorageKey(key: string) {
  const db = await requireDb();
  return (await db.select().from(documents).where(eq(documents.storageKey, key)).limit(1))[0] ?? null;
}

export async function createNotificationForPermission(permissionCode: string, notification: Omit<typeof notifications.$inferInsert, "userId">) {
  const db = await requireDb();
  const matched = await db.select({ userId: userPermissions.userId }).from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id)).where(eq(permissions.code, permissionCode));
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  const recipientIds = Array.from(new Set([...matched.map(item => item.userId), ...admins.map(item => item.id)]));
  if (recipientIds.length) await db.insert(notifications).values(recipientIds.map(userId => ({ ...notification, userId })));
}

export async function createNotification(userId: number, notification: Omit<typeof notifications.$inferInsert, "userId">) {
  const db = await requireDb();
  await db.insert(notifications).values({ ...notification, userId });
}

export async function listNotifications(userId: number) { const db = await requireDb(); return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(40); }
export async function markNotificationRead(id: number, userId: number) { const db = await requireDb(); await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId))); }

export async function dashboardOverview() {
  const db = await requireDb();
  const [requestRows, supplierRows, contractRows, orderRows, deliveryRows, notificationRows] = await Promise.all([
    db.select().from(purchaseRequests), db.select().from(suppliers), db.select().from(contracts),
    db.select().from(purchaseOrders), db.select().from(deliveries), db.select().from(notifications),
  ]);
  const totalContractValue = contractRows.reduce((sum, item) => sum + Number(item.currentValue), 0);
  const deliveredValue = deliveryRows.reduce((sum, item) => sum + Number(item.deliveredValue), 0);
  return {
    purchaseRequests: requestRows.length,
    pendingApprovals: requestRows.filter(item => item.status === "submitted").length,
    suppliers: supplierRows.length,
    activeContracts: contractRows.filter(item => item.status === "active").length,
    purchaseOrders: orderRows.length,
    lateDeliveries: deliveryRows.filter(item => item.status === "late").length,
    totalContractValue, deliveredValue, unreadNotifications: notificationRows.filter(item => !item.readAt).length,
  };
}

export async function checksum(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }

export async function upsertUser(user: InsertUser): Promise<void> { void user; }
export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; return (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0]; }
