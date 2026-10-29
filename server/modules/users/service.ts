import { recordChange } from "../../core/audit";
import { asc, eq, inArray } from "drizzle-orm";
import { users, sessions } from "../../../drizzle/schema";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { hashPassword } from "../../localAuth";
import {
  userProfileInput,
  userPasswordInput,
  userStatusInput,
  userCreateInput,
} from "../../../shared/users";
import type { z } from "zod";
import { insertLocalUser } from "../../db";
import { savePolicyInside } from "../policy/service";
import type { AccessContext } from "../../core/policy";

async function lockAccounts(tx: Transaction, actorId: number, userId: number) {
  // A consistent lock order also serializes two administrators disabling each other.
  const rows = await tx
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set([actorId, userId])]))
    .orderBy(asc(users.id))
    .for("update");
  const actor = rows.find(u => u.id === actorId),
    target = rows.find(u => u.id === userId);
  if (!actor?.active) throw new DomainError("USER_ADMIN_REQUIRED");
  if (!target) throw new DomainError("NOT_FOUND");
  if (target.role === "admin" && actor.role !== "admin")
    throw new DomainError("USER_ADMIN_REQUIRED");
  return target;
}
async function audit(
  tx: Transaction,
  actorId: number,
  userId: number,
  action: string,
  before: unknown,
  after: unknown
) {
  await recordChange(tx, {
    actorId,
    action,
    entityType: "user",
    entityId: userId,
    before,
    after,
  });
}
function duplicateUsername(error: unknown) {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const value = error as { code?: string; errno?: number; cause?: unknown };
    if (value.code === "ER_DUP_ENTRY" || value.errno === 1062) return true;
    error = value.cause;
  }
  return false;
}
export async function updateProfile(
  data: z.infer<typeof userProfileInput>,
  actorId: number,
  access?: AccessContext
) {
  try {
    return await (
      await database()
    ).transaction(async tx => {
      const target = await lockAccounts(tx, actorId, data.userId);
      if (data.accessPolicy) {
        if (!access) throw new DomainError("USER_ADMIN_REQUIRED");
        await savePolicyInside(
          tx,
          { ...data.accessPolicy, userId: target.id },
          access
        );
      }
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, data.username));
      if (existing && existing.id !== target.id)
        throw new DomainError("USERNAME_TAKEN");
      const after = {
        username: data.username,
        name: data.name,
        email: data.email || null,
        preferredLocale: data.locale,
      };
      await tx.update(users).set(after).where(eq(users.id, target.id));
      await audit(
        tx,
        actorId,
        target.id,
        "user.profile.update",
        {
          username: target.username,
          name: target.name,
          email: target.email,
          preferredLocale: target.preferredLocale,
        },
        after
      );
      return { success: true };
    });
  } catch (error) {
    if (duplicateUsername(error)) throw new DomainError("USERNAME_TAKEN");
    throw error;
  }
}
export async function createUser(
  data: z.infer<typeof userCreateInput>,
  access: AccessContext
) {
  const passwordHash = await hashPassword(data.password);
  try {
    return await (
      await database()
    ).transaction(async tx => {
      // Lock the actor before inserting the account and its policy in one transaction.
      const [actor] = await tx
        .select()
        .from(users)
        .where(eq(users.id, access.user.id))
        .for("update");
      if (!actor?.active) throw new DomainError("USER_ADMIN_REQUIRED");
      const id = await insertLocalUser(tx, {
        username: data.username,
        passwordHash,
        name: data.name,
        email: data.email,
        locale: data.locale,
        permissionCodes: data.accessPolicy ? [] : data.permissions,
      });
      if (data.accessPolicy)
        await savePolicyInside(
          tx,
          { ...data.accessPolicy, userId: id, version: 1 },
          access
        );
      await audit(tx, access.user.id, id, "user.create", undefined, {
        username: data.username,
        template: data.accessPolicy?.template ?? "custom",
      });
      return { id };
    });
  } catch (error) {
    if (duplicateUsername(error)) throw new DomainError("USERNAME_TAKEN");
    throw error;
  }
}
export async function resetPassword(
  data: z.infer<typeof userPasswordInput>,
  actorId: number
) {
  const passwordHash = await hashPassword(data.password);
  return (await database()).transaction(async tx => {
    const target = await lockAccounts(tx, actorId, data.userId);
    await tx.update(users).set({ passwordHash }).where(eq(users.id, target.id));
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    // Neither the password nor its hash is included in audit payloads.
    await audit(tx, actorId, target.id, "user.password.reset", undefined, {
      passwordChanged: true,
      sessionsRevoked: true,
    });
    return { success: true, requiresLogin: actorId === target.id };
  });
}
export async function setActive(
  data: z.infer<typeof userStatusInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const target = await lockAccounts(tx, actorId, data.userId);
    if (!data.active && target.id === actorId)
      throw new DomainError("SELF_DEACTIVATION");
    if (target.active !== data.active) {
      await tx
        .update(users)
        .set({ active: data.active })
        .where(eq(users.id, target.id));
      if (!data.active)
        await tx.delete(sessions).where(eq(sessions.userId, target.id));
      await audit(
        tx,
        actorId,
        target.id,
        data.active ? "user.activate" : "user.deactivate",
        { active: target.active },
        { active: data.active }
      );
    }
    return { success: true };
  });
}
