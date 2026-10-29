import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import * as db from "../server/db";
import { database } from "../server/core/database";
import { hashPassword } from "../server/localAuth";
import { scmAuditEvents } from "../drizzle/foundation";
import { users, sessions, userPermissions } from "../drizzle/schema";

export async function setupUsersFixture() {
  const code = "utest_" + randomUUID().slice(0, 8),
    password = "Users-Test-" + randomUUID();
  const accounts: { id: number; username: string; kind: string }[] = [];
  await db.seedPermissions();
  const permissions = [
    "users.view",
    "users.edit",
    "users.password.reset",
    "users.status.manage",
  ];
  for (const kind of ["adminA", "adminB", "manager", "target", "viewer"]) {
    const username = `${code}_${kind}`.toLowerCase();
    const id = await db.createLocalUser({
      username,
      passwordHash: await hashPassword(password),
      name: `${code} ${kind}`,
      role: kind.startsWith("admin") ? "admin" : "user",
      locale: "ar",
      permissionCodes: kind === "manager" ? permissions : ["users.view"],
    });
    accounts.push({ id, username, kind });
  }
  return { code, password, accounts };
}
export type UsersFixture = Awaited<ReturnType<typeof setupUsersFixture>>;
export async function cleanupUsersFixture(f: UsersFixture) {
  await (
    await database()
  ).transaction(async tx => {
    const extra = await tx
      .select({ id: users.id })
      .from(users)
      .where(like(users.username, f.code + "%"));
    const ids = [
      ...new Set([...f.accounts.map(a => a.id), ...extra.map(a => a.id)]),
    ];
    await tx.delete(sessions).where(inArray(sessions.userId, ids));
    await tx
      .delete(userPermissions)
      .where(inArray(userPermissions.userId, ids));
    await tx
      .delete(scmAuditEvents)
      .where(
        or(
          inArray(scmAuditEvents.actorId, ids),
          and(
            eq(scmAuditEvents.entityType, "user"),
            inArray(scmAuditEvents.entityId, ids)
          )
        )
      );
    await tx.delete(users).where(inArray(users.id, ids));
  });
}
