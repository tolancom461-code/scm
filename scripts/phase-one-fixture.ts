import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import * as db from "../server/db";
import { hashPassword } from "../server/localAuth";
import { database } from "../server/core/database";
import * as s from "../drizzle/phase-one";
import { accessProjects, accessProfiles } from "../drizzle/policy";
import { roleTemplates } from "../shared/policy";
import {
  suppliers,
  users,
  userPermissions,
  sessions,
  auditLogs,
  documents,
  notifications,
} from "../drizzle/schema";
import {
  operationKeys,
  scmAuditEvents,
  scmOutbox,
} from "../drizzle/foundation";
import * as service from "../server/modules/phase-one/service";
import { simpleContractInput } from "../shared/phase-one";
import { unlink } from "node:fs/promises";
import { localDocumentPath } from "../server/storage";
export async function setupPhaseOne(warrantyDays = 0) {
  const code = "P1TEST-" + randomUUID().slice(0, 8),
    password = "P1-Test-" + randomUUID(),
    actors: number[] = [],
    accounts: { role: string; username: string }[] = [];
  await db.seedPermissions();
  for (const [role, permissions] of Object.entries({
    engineer: [...roleTemplates.preparer.permissions, "p1.company.manage"],
    approver: [
      ...roleTemplates.approver.permissions,
      "p1.payments.view",
      "p1.retention.release",
    ],
    accountant: [...roleTemplates.accountant.permissions],
  })) {
    const username = code.toLowerCase() + "-" + role;
    actors.push(
      await db.createLocalUser({
        username,
        passwordHash: await hashPassword(password),
        name: code + " " + role,
        permissionCodes: permissions,
        locale: "ar",
      })
    );
    accounts.push({ role, username });
    await (
      await database()
    )
      .update(accessProfiles)
      .set({ template: role === "engineer" ? "preparer" : role })
      .where(eq(accessProfiles.userId, actors.at(-1)!));
  }
  const supplierId = (await db.createSupplier({
    nameAr: code + " مورد",
    supplierNumber: code,
    createdBy: actors[0],
  }))!;
  const projectKey = randomUUID();
  const projectId = (
    await service.createProject(
      { name: code + " مشروع", site: "QA" },
      actors[0],
      projectKey
    )
  ).id;
  await (await database())
    .insert(accessProjects)
    .values(actors.slice(1).map(userId => ({ userId, projectId })));
  const date = "2026-01-01";
  const contractId = (
    await service.createContract(
      simpleContractInput.parse({
        projectId,
        supplierId,
        title: code + " Epoxy",
        reference: code,
        contractDate: date,
        siteDate: date,
        durationDays: 5,
        warrantyDays,
        retentionPercent: "20",
        dailyPenalty: "200",
        items: [
          {
            description: "أعمال إيبوكسي",
            quantity: "141",
            unit: "م²",
            unitPrice: "24",
          },
        ],
        milestones: [
          { name: "الأولى", percent: "25", dueDate: date, minProgress: "25" },
          { name: "الثانية", percent: "25", dueDate: date, minProgress: "50" },
          {
            name: "الختامية",
            percent: "50",
            dueDate: date,
            minProgress: "100",
          },
        ],
      }),
      actors[0],
      randomUUID()
    )
  ).id;
  return {
    code,
    password,
    actors,
    accounts,
    supplierId,
    projectId,
    projectKey,
    contractId,
    date,
  };
}
export type PhaseFixture = Awaited<ReturnType<typeof setupPhaseOne>>;
export async function cleanupPhaseOne(f: PhaseFixture) {
  const connection = await database();
  const extra = await connection
    .select({ id: users.id })
    .from(users)
    .where(like(users.username, f.code.toLowerCase() + "%"));
  f.actors = [...new Set([...f.actors, ...extra.map(u => u.id)])];
  const files = await connection
    .select({ id: documents.id, storageKey: documents.storageKey })
    .from(documents)
    .where(inArray(documents.uploadedBy, f.actors));
  await connection.transaction(async tx => {
    if (files.length)
      await tx.delete(notifications).where(
        and(
          eq(notifications.entityType, "document"),
          inArray(
            notifications.entityId,
            files.map(f => f.id)
          )
        )
      );
    await tx
      .delete(notifications)
      .where(inArray(notifications.userId, f.actors));
    const contracts = await tx
      .select({ id: s.simpleContracts.id })
      .from(s.simpleContracts)
      .where(eq(s.simpleContracts.supplierId, f.supplierId));
    const ids = contracts.map(c => c.id);
    const certs = ids.length
      ? await tx
          .select({ id: s.simpleCertificates.id })
          .from(s.simpleCertificates)
          .where(inArray(s.simpleCertificates.contractId, ids))
      : [];
    const payments = ids.length
      ? await tx
          .select({ id: s.simplePayments.id })
          .from(s.simplePayments)
          .where(inArray(s.simplePayments.contractId, ids))
      : [];
    for (const [type, values] of [
      ["p1_contract", ids],
      ["p1_certificate", certs.map(c => c.id)],
      ["p1_payment", payments.map(c => c.id)],
    ] as const)
      if (values.length)
        await tx
          .delete(documents)
          .where(
            and(
              eq(documents.entityType, type),
              inArray(documents.entityId, [...values])
            )
          );
    if (ids.length) {
      if (payments.length)
        await tx.delete(s.paymentReversals).where(
          inArray(
            s.paymentReversals.paymentId,
            payments.map(p => p.id)
          )
        );
      await tx
        .update(s.simplePayments)
        .set({ replacesPaymentId: null })
        .where(inArray(s.simplePayments.contractId, ids));
      await tx
        .delete(s.simplePayments)
        .where(inArray(s.simplePayments.contractId, ids));
      await tx
        .delete(s.certificateInstallments)
        .where(inArray(s.certificateInstallments.contractId, ids));
      await tx
        .delete(s.simpleCertificates)
        .where(inArray(s.simpleCertificates.contractId, ids));
      await tx
        .delete(s.simpleMilestones)
        .where(inArray(s.simpleMilestones.contractId, ids));
      await tx
        .delete(s.simpleContracts)
        .where(inArray(s.simpleContracts.id, ids));
    }
    await tx
      .delete(s.simpleProjects)
      .where(inArray(s.simpleProjects.createdBy, f.actors));
    await tx.delete(suppliers).where(eq(suppliers.id, f.supplierId));
    // Only the dedicated fixture users' events are removed, never real users' history.
    const events = await tx
      .select({
        entityId: scmAuditEvents.entityId,
        entityType: scmAuditEvents.entityType,
        action: scmAuditEvents.action,
      })
      .from(scmAuditEvents)
      .where(inArray(scmAuditEvents.actorId, f.actors));
    for (const e of events)
      await tx
        .delete(scmOutbox)
        .where(
          and(
            eq(scmOutbox.entityId, e.entityId),
            eq(scmOutbox.entityType, e.entityType),
            eq(scmOutbox.type, e.action)
          )
        );
    await tx
      .delete(scmAuditEvents)
      .where(inArray(scmAuditEvents.actorId, f.actors));
    await tx
      .delete(operationKeys)
      .where(inArray(operationKeys.actorId, f.actors));
    await tx.delete(auditLogs).where(inArray(auditLogs.userId, f.actors));
    await tx.delete(sessions).where(inArray(sessions.userId, f.actors));
    await tx
      .delete(userPermissions)
      .where(inArray(userPermissions.userId, f.actors));
    await tx.delete(users).where(inArray(users.id, f.actors));
  });
  for (const file of files)
    if (file.storageKey.startsWith("local/"))
      await unlink(localDocumentPath(file.storageKey)).catch(() => {});
}
