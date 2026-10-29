import { taskStatuses } from "../drizzle/construction";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import { createHash } from "node:crypto";
import {
  documents,
  permissions,
  sessions,
  suppliers,
  userPermissions,
  users,
} from "../drizzle/schema";
import { ATOMIC_PERMISSIONS } from "../shared/permissions";
import { accessProfiles } from "../drizzle/policy";
import { documentSequences } from "../drizzle/foundation";
import { hashSessionToken } from "./localAuth";
import { DomainError } from "./core/errors";
import { recordChange } from "./core/audit";
import type { Transaction } from "./core/database";
let _db: MySql2Database | null = null;

let _pool: Pool | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    _pool = createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      connectionLimit: 10,
      ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
    _db = drizzle(_pool);
  }
  return _db;
}

export async function closeDb() {
  await _pool?.end();
  _pool = null;
  _db = null;
}

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
  await db
    .insert(permissions)
    .values(
      ATOMIC_PERMISSIONS.map(p => ({
        code: p.code,
        module: p.module,
        action: p.action,
        labelAr: p.ar,
        labelEn: p.en,
        labelUr: p.ur,
      }))
    )
    .onDuplicateKeyUpdate({
      set: {
        module: sql`VALUES(module)`,
        action: sql`VALUES(action)`,
        labelAr: sql`VALUES(labelAr)`,
        labelEn: sql`VALUES(labelEn)`,
        labelUr: sql`VALUES(labelUr)`,
      },
    });
  await db
    .insert(taskStatuses)
    .values([
      { code: "not_started", name: "لم يتم البدء" },
      { code: "working", name: "جاري العمل" },
      { code: "paused", name: "متوقفة" },
      { code: "done", name: "منتهية" },
    ])
    .onDuplicateKeyUpdate({ set: { code: sql`VALUES(code)` } });
}

type CreateLocalUserInput = {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  role?: "admin" | "user";
  locale?: "ar" | "en" | "ur";
  permissionCodes?: string[];
};

export async function insertLocalUser(
  tx: Transaction,
  input: CreateLocalUserInput
) {
  const role = input.role ?? "user";
  const allPermissions = await tx.select().from(permissions);
  if (
    (input.permissionCodes ?? []).some(
      code => !allPermissions.some(p => p.code === code)
    )
  )
    throw new DomainError("INVALID_INPUT");
  const [created] = await tx
    .insert(users)
    .values({
      username: input.username,
      passwordHash: input.passwordHash,
      name: input.name,
      email: input.email ?? null,
      role,
      preferredLocale: input.locale ?? "ar",
      active: true,
      lastSignedIn: new Date(),
    })
    .$returningId();
  if (!created) throw new Error("تعذر إنشاء المستخدم.");
  const codes =
    role === "admin"
      ? allPermissions.map(item => item.code)
      : (input.permissionCodes ?? []);
  const selected = allPermissions.filter(item => codes.includes(item.code));
  if (selected.length)
    await tx
      .insert(userPermissions)
      .values(
        selected.map(item => ({ userId: created.id, permissionId: item.id }))
      );
  await tx
    .insert(accessProfiles)
    .values({ userId: created.id, allProjects: role === "admin" });
  return created.id;
}

export async function createLocalUser(input: CreateLocalUserInput) {
  return (await requireDb()).transaction(tx => insertLocalUser(tx, input));
}

export async function createFirstAdministrator(input: CreateLocalUserInput) {
  return (await requireDb()).transaction(async tx => {
    await tx
      .insert(documentSequences)
      .values({ prefix: "BOOTSTRAP", year: 0 })
      .onDuplicateKeyUpdate({ set: { prefix: "BOOTSTRAP" } });
    await tx
      .select()
      .from(documentSequences)
      .where(
        and(
          eq(documentSequences.prefix, "BOOTSTRAP"),
          eq(documentSequences.year, 0)
        )
      )
      .for("update");
    if ((await tx.select({ id: users.id }).from(users).limit(1)).length)
      throw new DomainError("CONFLICT");
    return insertLocalUser(tx, { ...input, role: "admin" });
  });
}

export async function getUserByUsername(username: string) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return result[0] ?? null;
}

export async function getUserBySessionToken(rawToken: string) {
  const db = await requireDb();
  const tokenHash = hashSessionToken(rawToken);
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()))
    )
    .limit(1);
  const session = sessionRows[0];
  if (!session) return null;
  const user = (
    await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  )[0];
  if (!user || !user.active) return null;
  const grants = await db
    .select({ code: permissions.code })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, user.id));
  return { ...user, permissionCodes: grants.map(grant => grant.code) };
}

export async function createSession(
  userId: number,
  rawToken: string,
  expiresAt: Date,
  expectedPasswordHash?: string | null
) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (
      !user?.active ||
      (expectedPasswordHash !== undefined &&
        user.passwordHash !== expectedPasswordHash)
    )
      return false;
    await tx
      .insert(sessions)
      .values({ userId, tokenHash: hashSessionToken(rawToken), expiresAt });
    await tx
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, userId));
    return true;
  });
}

export async function deleteSession(rawToken: string) {
  const db = await requireDb();
  await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(rawToken)));
}

export async function listUsers() {
  const db = await requireDb();
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      active: users.active,
      preferredLocale: users.preferredLocale,
      role: users.role,
      template: accessProfiles.template,
    })
    .from(users)
    .leftJoin(accessProfiles, eq(users.id, accessProfiles.userId));
}

export async function listSuppliers() {
  const db = await requireDb();
  return db.select().from(suppliers).orderBy(desc(suppliers.createdAt));
}

export async function createSupplier(input: typeof suppliers.$inferInsert) {
  const db = await requireDb();
  const [result] = await db.insert(suppliers).values(input).$returningId();
  return result?.id;
}

export async function createDocument(input: typeof documents.$inferInsert) {
  const db = await requireDb();
  const prior = await db
    .select({ version: documents.version })
    .from(documents)
    .where(
      and(
        eq(documents.entityType, input.entityType),
        eq(documents.entityId, input.entityId),
        eq(documents.title, input.title)
      )
    )
    .orderBy(desc(documents.version))
    .limit(1);
  const [result] = await db
    .insert(documents)
    .values({ ...input, version: (prior[0]?.version ?? 0) + 1 })
    .$returningId();
  return result?.id;
}

export async function getDocumentByStorageKey(key: string) {
  const db = await requireDb();
  return (
    (
      await db
        .select()
        .from(documents)
        .where(eq(documents.storageKey, key))
        .limit(1)
    )[0] ?? null
  );
}

export async function checksum(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}
export async function createAuditLog(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  newValue?: unknown
) {
  if (userId === null || entityId === null)
    throw new DomainError("INVALID_REFERENCE");
  return (await requireDb()).transaction(tx =>
    recordChange(tx, {
      actorId: userId,
      action,
      entityType,
      entityId,
      after: newValue,
    })
  );
}
