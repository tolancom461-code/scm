import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  users,
  permissions,
  userPermissions,
  auditLogs,
} from "../../../drizzle/schema";
import {
  accessProfiles,
  accessProjects,
  accessDenials,
} from "../../../drizzle/policy";
import { simpleProjects } from "../../../drizzle/phase-one";
import { ATOMIC_PERMISSIONS } from "../../../shared/permissions";
import {
  accessProfileInput,
  completePermissions,
  roleTemplates,
  type AccessTemplate,
} from "../../../shared/policy";
import {
  canAccess,
  loadAccess,
  projectScope,
  type AccessContext,
} from "../../core/policy";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import type { z } from "zod";

export async function catalog(access: AccessContext) {
  const db = await database();
  return {
    templates: Object.entries(roleTemplates).map(([code, t]) => ({
      code: code as AccessTemplate,
      ...t,
    })),
    permissions: ATOMIC_PERMISSIONS.filter(p => canAccess(access, p.code)),
    users: await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: users.role,
        active: users.active,
        template: accessProfiles.template,
        allProjects: accessProfiles.allProjects,
      })
      .from(users)
      .leftJoin(accessProfiles, eq(users.id, accessProfiles.userId)),
    projects: await db
      .select({
        id: simpleProjects.id,
        name: simpleProjects.name,
        number: simpleProjects.number,
      })
      .from(simpleProjects)
      .where(projectScope(access, simpleProjects.id)),
    canManage: canAccess(access, "policy.manage"),
    canDelegateAll: access.scope.allProjects,
    canDelegateLegacy: access.scope.legacyAccess && access.scope.allProjects,
  };
}
export async function userPolicy(userId: number, access: AccessContext) {
  const target = await loadAccess(userId);
  if (!target) {
    // Inactive accounts still need editable policy settings; load their row directly.
    const [row] = await (await database())
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) throw new DomainError("NOT_FOUND");
    if (row.role === "admin" && access.user.role !== "admin")
      throw new DomainError("USER_ADMIN_REQUIRED");
  } else if (target.user.role === "admin" && access.user.role !== "admin")
    throw new DomainError("USER_ADMIN_REQUIRED");
  const db = await database();
  const [profile] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, userId));
  const grants = await db
    .select({ code: permissions.code })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.scopeType, "global")
      )
    );
  const projects = await db
    .select({ id: accessProjects.projectId })
    .from(accessProjects)
    .where(eq(accessProjects.userId, userId));
  if (
    access.user.role !== "admin" &&
    (grants.some(g => !canAccess(access, g.code)) ||
      (!access.scope.allProjects &&
        (profile?.allProjects ||
          projects.some(p => !access.scope.projectIds.includes(p.id)))) ||
      (profile?.legacyAccess && !access.scope.legacyAccess))
  )
    throw new DomainError("USER_ADMIN_REQUIRED");
  return {
    userId,
    version: profile?.version ?? 0,
    template: (profile?.template ?? "custom") as AccessTemplate,
    allProjects: profile?.allProjects ?? false,
    legacyAccess: profile?.legacyAccess ?? false,
    projectIds: projects.map(p => p.id),
    permissions: grants.map(p => p.code),
  };
}
export async function savePolicyInside(
  tx: Transaction,
  data: z.infer<typeof accessProfileInput>,
  access: AccessContext
) {
  if (!canAccess(access, "policy.manage"))
    throw new DomainError("USER_ADMIN_REQUIRED");
  const rows = await tx
    .select()
    .from(users)
    .where(inArray(users.id, [...new Set([access.user.id, data.userId])]))
    .orderBy(users.id)
    .for("update");
  const actor = rows.find(u => u.id === access.user.id),
    target = rows.find(u => u.id === data.userId);
  if (!actor?.active || !target) throw new DomainError("USER_ADMIN_REQUIRED");
  if (target.role === "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "مدير النظام كامل الصلاحيات. لإيقاف وصوله استخدم تعطيل المستخدم.",
    });
  // Templates seed the editor; the stored grants are the user's final selection.
  const codes = completePermissions(data.permissions);
  if (
    codes.some(code => !canAccess(access, code)) ||
    (data.allProjects && !access.scope.allProjects) ||
    (data.legacyAccess && (!data.allProjects || !access.scope.legacyAccess)) ||
    (!access.scope.allProjects &&
      data.projectIds.some(id => !access.scope.projectIds.includes(id)))
  )
    throw new DomainError("USER_ADMIN_REQUIRED");
  if (data.projectIds.length) {
    const found = await tx
      .select({ id: simpleProjects.id })
      .from(simpleProjects)
      .where(inArray(simpleProjects.id, data.projectIds));
    if (found.length !== data.projectIds.length)
      throw new DomainError("INVALID_REFERENCE");
  }
  const [before] = await tx
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, data.userId))
    .for("update");
  if ((before?.version ?? 0) !== data.version)
    throw new DomainError("CONFLICT");
  const available = await tx.select().from(permissions);
  if (codes.some(code => !available.some(p => p.code === code)))
    throw new DomainError("INVALID_INPUT");
  const oldGrants = await tx
    .select({ code: permissions.code })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, data.userId));
  const oldProjects = await tx
    .select({ id: accessProjects.projectId })
    .from(accessProjects)
    .where(eq(accessProjects.userId, data.userId));
  if (
    access.user.role !== "admin" &&
    (oldGrants.some(g => !canAccess(access, g.code)) ||
      (!access.scope.allProjects &&
        (before?.allProjects ||
          oldProjects.some(p => !access.scope.projectIds.includes(p.id)))) ||
      (before?.legacyAccess && !access.scope.legacyAccess))
  )
    throw new DomainError("USER_ADMIN_REQUIRED");
  const next = {
    userId: data.userId,
    template: data.template,
    allProjects: data.allProjects,
    legacyAccess: data.legacyAccess,
    version: data.version + 1,
  };
  await tx
    .insert(accessProfiles)
    .values(next)
    .onDuplicateKeyUpdate({ set: next });
  await tx.delete(accessProjects).where(eq(accessProjects.userId, data.userId));
  if (!data.allProjects && data.projectIds.length)
    await tx
      .insert(accessProjects)
      .values(
        data.projectIds.map(projectId => ({ userId: data.userId, projectId }))
      );
  await tx
    .delete(userPermissions)
    .where(eq(userPermissions.userId, data.userId));
  const selected = available.filter(p => codes.includes(p.code));
  if (selected.length)
    await tx
      .insert(userPermissions)
      .values(selected.map(p => ({ userId: data.userId, permissionId: p.id })));
  await tx.insert(auditLogs).values({
    userId: access.user.id,
    action: "policy.updated",
    entityType: "user",
    entityId: data.userId,
    oldValue: JSON.stringify({
      profile: before,
      permissions: oldGrants.map(p => p.code),
      projectIds: oldProjects.map(p => p.id),
    }),
    newValue: JSON.stringify({
      ...next,
      permissions: codes,
      projectIds: data.allProjects ? [] : data.projectIds,
    }),
  });
  return { success: true, version: next.version };
}
export async function savePolicy(
  data: z.infer<typeof accessProfileInput>,
  access: AccessContext
) {
  if (!canAccess(access, "policy.manage"))
    throw new DomainError("USER_ADMIN_REQUIRED");
  return (await database()).transaction(tx =>
    savePolicyInside(tx, data, access)
  );
}
/** Existing grant editor also uses the same center and preserves the project scope. */
export async function saveCustomGrants(
  userId: number,
  codes: string[],
  access: AccessContext
) {
  const profile = await userPolicy(userId, access);
  return savePolicy(
    accessProfileInput.parse({
      ...profile,
      template: "custom",
      permissions: codes,
    }),
    access
  );
}
export async function denials(access: AccessContext) {
  return (await database())
    .select({
      id: accessDenials.id,
      actorId: accessDenials.actorId,
      path: accessDenials.path,
      reason: accessDenials.reason,
      createdAt: accessDenials.createdAt,
      username: users.username,
    })
    .from(accessDenials)
    .innerJoin(users, eq(users.id, accessDenials.actorId))
    .orderBy(desc(accessDenials.id))
    .limit(100);
}
