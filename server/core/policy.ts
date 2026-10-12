import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  users,
  permissions,
  userPermissions,
  documents,
} from "../../drizzle/schema";
import {
  accessProfiles,
  accessProjects,
  accessDenials,
} from "../../drizzle/policy";
import {
  simpleProjects,
  simpleContracts,
  simpleCertificates,
  simplePayments,
  paymentReversals,
} from "../../drizzle/phase-one";
import { ATOMIC_PERMISSIONS } from "../../shared/permissions";
import {
  permissionAllowed,
  importLegacyPermissions,
  roleTemplates,
  scopeAllows,
  type AccessScope,
  type AccessTemplate,
} from "../../shared/policy";
import type { LocalUser } from "../_core/context";
import { database, type Transaction } from "./database";
import { routePolicies } from "./policy-registry";

export type AccessContext = { user: LocalUser; scope: AccessScope };
export const canAccess = (access: AccessContext, code: string) =>
  permissionAllowed(access.user, code);
function forbidden(reason = "PERMISSION_DENIED"): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "لا تملك صلاحية الوصول أو تنفيذ هذا الإجراء / Access denied / رسائی کی اجازت نہیں۔",
    cause: new Error(reason),
  });
}
export async function loadAccess(
  userId: number
): Promise<AccessContext | null> {
  const db = await database();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.active) return null;
  const [profile] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, userId));
  const owner = user.role === "admin";
  const grants = owner
    ? []
    : await db
        .select({ code: permissions.code })
        .from(userPermissions)
        .innerJoin(
          permissions,
          eq(userPermissions.permissionId, permissions.id)
        )
        .where(
          and(
            eq(userPermissions.userId, userId),
            eq(userPermissions.scopeType, "global")
          )
        );
  const projects =
    !owner && !profile?.allProjects
      ? await db
          .select({ id: accessProjects.projectId })
          .from(accessProjects)
          .where(eq(accessProjects.userId, userId))
      : [];
  return {
    user: {
      ...user,
      permissionCodes: owner
        ? ATOMIC_PERMISSIONS.map(p => p.code)
        : grants.map(g => g.code),
    },
    scope: {
      allProjects: owner || (profile?.allProjects ?? false),
      legacyAccess: owner || (profile?.legacyAccess ?? false),
      projectIds: projects.map(p => p.id),
      template:
        profile && profile.template in roleTemplates
          ? (profile.template as AccessTemplate)
          : "custom",
      version: profile?.version ?? 0,
    },
  };
}
export function projectScope(
  access: AccessContext,
  column: AnyMySqlColumn
): SQL | undefined {
  return access.scope.allProjects
    ? undefined
    : access.scope.projectIds.length
      ? inArray(column, access.scope.projectIds)
      : sql`FALSE`;
}
export async function assertProjectAccess(
  access: AccessContext,
  projectId: number,
  tx?: Transaction
) {
  if (!Number.isSafeInteger(projectId) || projectId < 1)
    throw new TRPCError({ code: "BAD_REQUEST" });
  if (!scopeAllows(access.scope, projectId)) forbidden("PROJECT_SCOPE");
  const db = tx ?? (await database());
  const [project] = await db
    .select({ id: simpleProjects.id })
    .from(simpleProjects)
    .where(eq(simpleProjects.id, projectId));
  if (!project) forbidden("PROJECT_SCOPE");
}
export async function assertContractAccess(access: AccessContext, id: number) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new TRPCError({ code: "BAD_REQUEST" });
  const [row] = await (
    await database()
  )
    .select({ id: simpleContracts.id, projectId: simpleContracts.projectId })
    .from(simpleContracts)
    .where(
      and(
        eq(simpleContracts.id, id),
        projectScope(access, simpleContracts.projectId)
      )
    );
  if (!row) forbidden("PROJECT_SCOPE");
  return row;
}
export async function assertCertificateAccess(
  access: AccessContext,
  id: number
) {
  if (!Number.isSafeInteger(id) || id < 1)
    throw new TRPCError({ code: "BAD_REQUEST" });
  const [row] = await (
    await database()
  )
    .select({
      id: simpleCertificates.id,
      contractId: simpleCertificates.contractId,
      createdBy: simpleCertificates.createdBy,
    })
    .from(simpleCertificates)
    .innerJoin(
      simpleContracts,
      eq(simpleCertificates.contractId, simpleContracts.id)
    )
    .where(
      and(
        eq(simpleCertificates.id, id),
        projectScope(access, simpleContracts.projectId)
      )
    );
  if (!row) forbidden("PROJECT_SCOPE");
  return row;
}
export async function assertDocumentTarget(
  access: AccessContext,
  entityType: string,
  entityId: number
) {
  if (
    typeof entityType !== "string" ||
    !Number.isSafeInteger(entityId) ||
    entityId < 1
  )
    throw new TRPCError({ code: "BAD_REQUEST" });
  if (entityType === "p1_contract") {
    if (!canAccess(access, "p1.contracts.view")) forbidden("DOCUMENT_TARGET");
    await assertContractAccess(access, entityId);
    return;
  }
  if (entityType === "p1_certificate") {
    if (!canAccess(access, "p1.certificates.view"))
      forbidden("DOCUMENT_TARGET");
    await assertCertificateAccess(access, entityId);
    return;
  }
  if (entityType === "p1_payment") {
    if (!canAccess(access, "p1.payments.view")) forbidden("DOCUMENT_TARGET");
    const [row] = await (
      await database()
    )
      .select({ id: simplePayments.id })
      .from(simplePayments)
      .innerJoin(
        simpleContracts,
        eq(simplePayments.contractId, simpleContracts.id)
      )
      .where(
        and(
          eq(simplePayments.id, entityId),
          projectScope(access, simpleContracts.projectId)
        )
      );
    if (!row) forbidden("DOCUMENT_TARGET");
    return;
  }
  if (
    entityType.startsWith("p1_") ||
    !access.scope.legacyAccess ||
    !access.scope.allProjects
  )
    forbidden("DOCUMENT_TARGET");
}
/** Used at SQL read time for attachment lists, including unfiltered list requests. */
export function documentScope(access: AccessContext): SQL {
  const clauses: SQL[] = [];
  const scope = projectScope(access, simpleContracts.projectId);
  if (canAccess(access, "p1.contracts.view"))
    clauses.push(
      sql`${documents.entityType}='p1_contract' AND EXISTS (SELECT 1 FROM ${simpleContracts} WHERE ${simpleContracts.id}=${documents.entityId} AND ${scope ?? sql`TRUE`})`
    );
  if (canAccess(access, "p1.certificates.view"))
    clauses.push(
      sql`${documents.entityType}='p1_certificate' AND EXISTS (SELECT 1 FROM ${simpleCertificates} INNER JOIN ${simpleContracts} ON ${simpleContracts.id}=${simpleCertificates.contractId} WHERE ${simpleCertificates.id}=${documents.entityId} AND ${scope ?? sql`TRUE`})`
    );
  if (canAccess(access, "p1.payments.view"))
    clauses.push(
      sql`${documents.entityType}='p1_payment' AND EXISTS (SELECT 1 FROM ${simplePayments} INNER JOIN ${simpleContracts} ON ${simpleContracts.id}=${simplePayments.contractId} WHERE ${simplePayments.id}=${documents.entityId} AND ${scope ?? sql`TRUE`})`
    );
  if (access.scope.legacyAccess && access.scope.allProjects)
    clauses.push(sql`LEFT(${documents.entityType},3) <> 'p1_'`);
  const classification = canAccess(access, "documents.view_confidential")
    ? undefined
    : inArray(documents.classification, ["normal", "internal"]);
  return and(clauses.length ? or(...clauses)! : sql`FALSE`, classification)!;
}
export async function logAccessDenied(
  actorId: number,
  path: string,
  reason: string
) {
  try {
    await (await database()).insert(accessDenials).values({
      actorId,
      path: path.slice(0, 160),
      reason: reason.slice(0, 60),
    });
  } catch {
    console.warn("[Policy] Could not persist a denied access event");
  }
}
/** Account administration must not let a limited administrator take over a broader account. */
async function assertManageableUser(access: AccessContext, userId: number) {
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new TRPCError({ code: "BAD_REQUEST" });
  if (access.user.role === "admin") return;
  const db = await database();
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  if (!target || target.role === "admin") forbidden("GRANT_AUTHORITY");
  const [profile] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.userId, userId));
  const grants = await db
    .select({ code: permissions.code })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, userId));
  const projects = await db
    .select({ id: accessProjects.projectId })
    .from(accessProjects)
    .where(eq(accessProjects.userId, userId));
  if (
    grants.some(g => !canAccess(access, g.code)) ||
    (!access.scope.allProjects &&
      (profile?.allProjects ||
        projects.some(p => !access.scope.projectIds.includes(p.id)))) ||
    (profile?.legacyAccess && !access.scope.legacyAccess)
  )
    forbidden("GRANT_AUTHORITY");
}
export async function authorizeRequest(
  userId: number,
  path: string,
  input: unknown
) {
  const access = await loadAccess(userId);
  if (!access) throw new TRPCError({ code: "UNAUTHORIZED" });
  try {
    const rule = routePolicies[path];
    if (!rule || rule.public) forbidden("UNREGISTERED_ACTION");
    if (
      rule.legacy &&
      (!access.scope.legacyAccess || !access.scope.allProjects)
    )
      forbidden("LEGACY_SCOPE");
    if (!rule.session && !rule.any?.some(code => canAccess(access, code)))
      forbidden();
    const raw = input as any;
    if (path === "phaseOne.acceptHandover")
      await assertContractAccess(access, raw?.id);
    if (
      ["phaseOne.configureSchedule", "phaseOne.schedulePreview"].includes(path)
    ) {
      const c = await assertCertificateAccess(access, raw?.id);
      if (path === "phaseOne.configureSchedule" && c.createdBy === userId)
        forbidden("SELF_APPROVAL");
    }
    if (
      path === "phaseOne.requestReversal" ||
      path === "phaseOne.decideReversal"
    ) {
      let paymentId = raw?.paymentId;
      if (path === "phaseOne.decideReversal") {
        const [r] = await (await database())
          .select()
          .from(paymentReversals)
          .where(eq(paymentReversals.id, raw?.id));
        if (!r) forbidden("PROJECT_SCOPE");
        if (r.createdBy === userId) forbidden("SELF_APPROVAL");
        paymentId = r.paymentId;
      }
      if (!Number.isSafeInteger(paymentId) || paymentId < 1)
        throw new TRPCError({ code: "BAD_REQUEST" });
      const [p] = await (await database())
        .select()
        .from(simplePayments)
        .where(eq(simplePayments.id, paymentId));
      if (!p) forbidden("PROJECT_SCOPE");
      await assertContractAccess(access, p.contractId);
      if (path === "phaseOne.decideReversal" && p.createdBy === userId)
        forbidden("SELF_APPROVAL");
      if (
        path === "phaseOne.requestReversal" &&
        !canAccess(access, "p1.payments.view")
      )
        forbidden();
    }
    if (
      ["users.create", "users.update"].includes(path) &&
      raw?.accessPolicy &&
      !canAccess(access, "policy.manage")
    )
      forbidden("GRANT_AUTHORITY");
    if (
      [
        "users.update",
        "users.resetPassword",
        "users.setActive",
        "users.setPermissions",
        "policy.user",
        "policy.save",
      ].includes(path)
    )
      await assertManageableUser(access, raw?.userId);
    if (path === "phaseOne.createContract")
      await assertProjectAccess(access, raw?.data?.projectId);
    if (path === "phaseOne.createCertificate")
      await assertContractAccess(access, raw?.data?.contractId);
    if (path === "phaseOne.correctContract")
      await assertContractAccess(access, raw?.id);
    if (path === "phaseOne.paymentPreview") {
      if (!canAccess(access, "p1.payments.view")) forbidden();
      await assertContractAccess(access, raw?.contractId);
    }
    if (
      ["phaseOne.decideCertificate", "phaseOne.releaseRetention"].includes(path)
    ) {
      const certificate = await assertCertificateAccess(access, raw?.id);
      if (certificate.createdBy === userId) forbidden("SELF_APPROVAL");
    }
    if (path === "phaseOne.recordPayment") {
      if (!canAccess(access, "p1.payments.view")) forbidden();
      const contract = await assertContractAccess(
        access,
        raw?.data?.contractId
      );
      const certificate = await assertCertificateAccess(
        access,
        raw?.data?.certificateId
      );
      if (certificate.contractId !== contract.id) forbidden("PROJECT_SCOPE");
    }
    if (path === "documents.list" || path === "documents.upload") {
      if (raw?.entityType && raw?.entityId)
        await assertDocumentTarget(access, raw.entityType, raw.entityId);
    }
    if (
      path === "users.setPermissions" ||
      (path === "users.create" &&
        Array.isArray(raw?.permissions) &&
        raw.permissions.length)
    ) {
      if (!canAccess(access, "policy.manage")) forbidden("GRANT_AUTHORITY");
      if (
        Array.isArray(raw?.permissions) &&
        (path === "users.create"
          ? importLegacyPermissions(raw.permissions)
          : raw.permissions
        ).some((p: string) => !canAccess(access, p))
      )
        forbidden("GRANT_AUTHORITY");
      if (raw?.userId) {
        const [target] = await (await database())
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, raw.userId));
        if (target?.role === "admin" && access.user.role !== "admin")
          forbidden("OWNER_ACCOUNT");
      }
    }
    return access;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN")
      await logAccessDenied(
        userId,
        path,
        error.cause?.message ?? "PERMISSION_DENIED"
      );
    throw error;
  }
}
