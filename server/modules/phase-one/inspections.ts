import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../drizzle/phase-one";
import { suppliers } from "../../../drizzle/schema";
import { scmAuditEvents } from "../../../drizzle/foundation";
import {
  inspectionInput,
  inspectionRemaining,
  type InspectionAllocation,
} from "../../../shared/inspections";
import { decimal, formatDecimal } from "../../../shared/decimal";
import { businessDate } from "../../../shared/date";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { allocateRecordNumber } from "../../core/numbering";
import { canAccess, projectScope, type AccessContext } from "../../core/policy";

async function locked(tx: Transaction, contractId: number) {
  const [c] = await tx
    .select()
    .from(s.simpleContracts)
    .where(eq(s.simpleContracts.id, contractId))
    .for("update");
  if (!c || c.status !== "active" || c.handoverDate)
    throw new DomainError("INVALID_TRANSITION");
  return c;
}
export async function enableInspections(contractId: number, actorId: number) {
  return (await database()).transaction(async tx => {
    const c = await locked(tx, contractId);
    if (c.inspectionRequired) return { id: c.id };
    const certs = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.contractId, c.id))
      .orderBy(asc(s.simpleCertificates.id));
    if (certs.some(c => c.status === "pending"))
      throw new DomainError("CONFLICT");
    const baseline =
      certs.filter(c => c.status === "approved").at(-1)?.quantities ??
      c.items.map(() => "0");
    await tx
      .update(s.simpleContracts)
      .set({ inspectionRequired: true, inspectionBaseline: baseline })
      .where(eq(s.simpleContracts.id, c.id));
    await recordChange(tx, {
      actorId,
      action: "p1.contract.inspections.enabled",
      entityType: "p1_contract",
      entityId: c.id,
      before: { inspectionRequired: false },
      after: { inspectionRequired: true, baseline },
    });
    return { id: c.id };
  });
}
export async function saveInspection(
  data: z.infer<typeof inspectionInput>,
  actorId: number,
  key: string,
  id?: number,
  revision = 0
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      actorId,
      "p1.inspection",
      key,
      { data, id, revision },
      async () => {
        const c = await locked(tx, data.contractId);
        const item = c.items[data.itemIndex];
        if (
          !c.inspectionRequired ||
          !item ||
          data.inspectionDate < c.siteDate ||
          data.inspectionDate > businessDate() ||
          decimal(data.executed) > decimal(item.quantity)
        )
          throw new DomainError("INVALID_INPUT");
        const records = await tx
          .select()
          .from(s.workInspections)
          .where(eq(s.workInspections.contractId, c.id));
        const before = id ? records.find(r => r.id === id) : undefined;
        if (
          id &&
          (!before ||
            before.revision !== revision ||
            before.itemIndex !== data.itemIndex)
        )
          throw new DomainError("CONFLICT");
        const certificates = await tx
          .select()
          .from(s.simpleCertificates)
          .where(eq(s.simpleCertificates.contractId, c.id));
        if (
          before &&
          (certificates.some(c =>
            c.inspectionAllocations?.some(a => a.inspectionId === id)
          ) ||
            records.some(r => r.previousInspectionId === id))
        )
          throw new DomainError("INSPECTION_LOCKED");
        if (data.previousInspectionId) {
          const previous = records.find(
            r => r.id === data.previousInspectionId
          );
          if (
            !previous ||
            !["rejected", "accepted_noted", "accepted"].includes(
              previous.status
            ) ||
            decimal(previous.accepted) >= decimal(previous.executed) ||
            previous.itemIndex !== data.itemIndex ||
            previous.id === id ||
            data.inspectionDate < previous.inspectionDate
          )
            throw new DomainError("INVALID_REFERENCE");
          const remaining =
            decimal(previous.executed) -
            decimal(previous.accepted) -
            records
              .filter(
                r => r.previousInspectionId === previous.id && r.id !== id
              )
              .reduce((n, r) => n + decimal(r.accepted), 0n);
          if (decimal(data.executed) > remaining)
            throw new DomainError("QUANTITY_EXCEEDED");
        }
        const accepted = records
          .filter(r => r.id !== id && r.itemIndex === data.itemIndex)
          .reduce(
            (n, r) => n + decimal(r.accepted),
            decimal(c.inspectionBaseline?.[data.itemIndex] ?? "0")
          );
        if (accepted + decimal(data.accepted) > decimal(item.quantity))
          throw new DomainError("QUANTITY_EXCEEDED");
        const [vendor] = await tx
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, c.supplierId));
        const [company] = await tx
          .select()
          .from(s.simpleCompany)
          .where(eq(s.simpleCompany.id, 1));
        const fields = {
          ...data,
          supplierName: vendor?.nameAr ?? "",
          representative: company?.data.representative ?? "",
          updatedBy: actorId,
          updatedAt: new Date(),
        };
        let inspectionId = id;
        if (id)
          await tx
            .update(s.workInspections)
            .set({ ...fields, revision: revision + 1 })
            .where(eq(s.workInspections.id, id));
        else
          inspectionId = (
            await tx
              .insert(s.workInspections)
              .values({
                ...fields,
                number: await allocateRecordNumber(tx, "inspection"),
                createdBy: actorId,
              })
              .$returningId()
          )[0].id;
        await recordChange(tx, {
          actorId,
          action: before ? "p1.inspection.updated" : "p1.inspection.created",
          entityType: "p1_inspection",
          entityId: inspectionId!,
          before: before ?? null,
          after: { ...fields, revision: before ? revision + 1 : 0 },
        });
        return { id: inspectionId! };
      }
    )
  );
}
/** Caller holds the contract lock, serializing inspections and certificate reservations. */
export async function allocateInspections(
  tx: Transaction,
  contractId: number,
  date: string,
  allocations: { inspectionId: number; quantity: string }[],
  previousQuantities: string[]
) {
  if (!allocations.length) throw new DomainError("INSPECTION_REQUIRED");
  if (new Set(allocations.map(a => a.inspectionId)).size !== allocations.length)
    throw new DomainError("INVALID_INPUT");
  const inspections = await tx
    .select()
    .from(s.workInspections)
    .where(eq(s.workInspections.contractId, contractId));
  const certs = await tx
    .select()
    .from(s.simpleCertificates)
    .where(eq(s.simpleCertificates.contractId, contractId));
  const quantities = previousQuantities.map(decimal),
    snapshots: InspectionAllocation[] = [];
  for (const allocation of allocations) {
    const r = inspections.find(r => r.id === allocation.inspectionId);
    if (
      !r ||
      !["accepted", "accepted_noted"].includes(r.status) ||
      r.inspectionDate > date
    )
      throw new DomainError("INVALID_REFERENCE");
    if (
      decimal(allocation.quantity) >
      decimal(inspectionRemaining(r.id, r.accepted, certs))
    )
      throw new DomainError("QUANTITY_EXCEEDED");
    if (quantities[r.itemIndex] === undefined)
      throw new DomainError("INVALID_REFERENCE");
    quantities[r.itemIndex] += decimal(allocation.quantity);
    snapshots.push({
      ...allocation,
      number: r.number,
      itemIndex: r.itemIndex,
      revision: r.revision,
    });
  }
  return {
    quantities: quantities.map(q => formatDecimal(q, 4)),
    inspectionAllocations: snapshots,
  };
}
export async function inspectionState(tx: Transaction, access: AccessContext) {
  if (!canAccess(access, "p1.inspections.view")) return [];
  const rows = await tx
    .select(getTableColumns(s.workInspections))
    .from(s.workInspections)
    .innerJoin(
      s.simpleContracts,
      eq(s.workInspections.contractId, s.simpleContracts.id)
    )
    .where(projectScope(access, s.simpleContracts.projectId))
    .orderBy(asc(s.workInspections.id));
  const certs = await tx
    .select(getTableColumns(s.simpleCertificates))
    .from(s.simpleCertificates)
    .innerJoin(
      s.simpleContracts,
      eq(s.simpleCertificates.contractId, s.simpleContracts.id)
    )
    .where(projectScope(access, s.simpleContracts.projectId));
  const history = rows.length
    ? await tx
        .select({
          id: scmAuditEvents.id,
          inspectionId: scmAuditEvents.entityId,
          actorId: scmAuditEvents.actorId,
          createdAt: scmAuditEvents.createdAt,
          action: scmAuditEvents.action,
          before: scmAuditEvents.before,
          after: scmAuditEvents.after,
        })
        .from(scmAuditEvents)
        .where(
          and(
            eq(scmAuditEvents.entityType, "p1_inspection"),
            inArray(
              scmAuditEvents.entityId,
              rows.map(r => r.id)
            )
          )
        )
        .orderBy(asc(scmAuditEvents.id))
    : [];
  return rows.map(r => ({
    ...r,
    history: history.filter(h => h.inspectionId === r.id),
    remaining: inspectionRemaining(r.id, r.accepted, certs),
    locked:
      certs.some(c =>
        c.inspectionAllocations?.some(a => a.inspectionId === r.id)
      ) || rows.some(child => child.previousInspectionId === r.id),
  }));
}
