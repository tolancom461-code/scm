import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as s from "../../../drizzle/phase-one";
import { suppliers, users } from "../../../drizzle/schema";
import { scmAuditEvents } from "../../../drizzle/foundation";
import {
  decimal,
  formatDecimal,
  multiply,
  roundedDivide,
} from "../../../shared/decimal";
import { businessDate, addCalendarDays } from "../../../shared/date";
import {
  calculateSimpleCertificate,
  companyInput,
  contractCorrectionInput,
  percentOf,
  projectInput,
  simpleCertificateInput,
  simpleContractInput,
  simplePaymentInput,
  totalItems,
  voucherKey,
  certificateScheduleInput,
  handoverInput,
} from "../../../shared/phase-one";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { allocateRecordNumber } from "../../core/numbering";
import { recordChange } from "../../core/audit";
import { once } from "../../core/idempotency";
import { canAccess, projectScope, type AccessContext } from "../../core/policy";
import { accessProfiles, accessProjects } from "../../../drizzle/policy";
import { allocateInspections, inspectionState } from "./inspections";

type Contract = typeof s.simpleContracts.$inferSelect;
type Certificate = typeof s.simpleCertificates.$inferSelect;
type Milestone = typeof s.simpleMilestones.$inferSelect;
type Payment = typeof s.simplePayments.$inferSelect;
type Installment = typeof s.certificateInstallments.$inferSelect;
const sum = (values: string[]) =>
  values.reduce((total, v) => total + decimal(v), 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const moneyLimit = decimal("999999999999.99");
async function writeSchedule(
  tx: Transaction,
  certificateId: number,
  contractId: number,
  net: string,
  date: string,
  version: number,
  plan: z.infer<typeof certificateScheduleInput>["installments"]
) {
  let allocated = 0n;
  const result: Installment[] = [];
  for (let n = 0; n < plan.length; n++) {
    const row = plan[n];
    const amount =
      n === plan.length - 1
        ? formatDecimal(decimal(net) - allocated)
        : percentOf(net, row.percent);
    if (row.dueDate < date || decimal(amount) <= 0n)
      throw new DomainError("INVALID_INPUT");
    allocated += decimal(amount);
    const values = {
      ...row,
      amount,
      certificateId,
      contractId,
      version,
      position: n + 1,
    };
    const [created] = await tx
      .insert(s.certificateInstallments)
      .values(values)
      .$returningId();
    result.push({ ...values, id: created.id });
  }
  return result;
}
export async function schedulePreview(id: number) {
  return (await database()).transaction(async tx => {
    const [cert] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, id));
    if (!cert) throw new DomainError("NOT_FOUND");
    await lockedContract(tx, cert.contractId);
    return tx
      .select()
      .from(s.simplePayments)
      .where(
        and(
          eq(s.simplePayments.certificateId, id),
          eq(s.simplePayments.status, "active"),
          eq(s.simplePayments.kind, "normal")
        )
      );
  });
}
export async function configureSchedule(
  data: z.infer<typeof certificateScheduleInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, data.id));
    if (!ref) throw new DomainError("NOT_FOUND");
    await lockedContract(tx, ref.contractId);
    const rows = await related(tx, ref.contractId),
      cert = rows.certificates.find(c => c.id === data.id)!;
    if (cert.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    if (cert.status !== "approved") throw new DomainError("INVALID_TRANSITION");
    if (cert.scheduleVersion !== data.version)
      throw new DomainError("CONFLICT");
    const payments = rows.payments.filter(
      p =>
        p.certificateId === cert.id &&
        p.kind === "normal" &&
        p.status === "active"
    );
    if (
      data.assignments.length !== payments.length ||
      new Set(data.assignments.map(a => a.paymentId)).size !==
        payments.length ||
      data.assignments.some(a => !payments.some(p => p.id === a.paymentId))
    )
      throw new DomainError("INVALID_INPUT");
    const plan = await writeSchedule(
      tx,
      cert.id,
      cert.contractId,
      cert.net,
      cert.certificateDate,
      cert.scheduleVersion + 1,
      data.installments
    );
    for (const row of plan) {
      const assigned = payments.filter(
        p =>
          data.assignments.find(a => a.paymentId === p.id)?.position ===
          row.position
      );
      if (
        sum(assigned.map(p => p.amount)) > decimal(row.amount) ||
        assigned.some(p => p.paymentDate < row.dueDate)
      )
        throw new DomainError("PAYMENT_EXCEEDED");
    }
    for (const p of payments) {
      const row = plan.find(
        i =>
          i.position ===
          data.assignments.find(a => a.paymentId === p.id)!.position
      );
      if (!row) throw new DomainError("INVALID_INPUT");
      await tx
        .update(s.simplePayments)
        .set({ installmentId: row.id, milestoneId: null })
        .where(eq(s.simplePayments.id, p.id));
    }
    await tx
      .update(s.simpleCertificates)
      .set({
        scheduleVersion: cert.scheduleVersion + 1,
        scheduleReason: data.reason,
      })
      .where(eq(s.simpleCertificates.id, cert.id));
    await recordChange(tx, {
      actorId,
      action: "p1.certificate.schedule",
      entityType: "p1_certificate",
      entityId: cert.id,
      before: {
        version: cert.scheduleVersion,
        installments: rows.installments.filter(
          i => i.certificateId === cert.id
        ),
        payments,
      },
      after: {
        version: cert.scheduleVersion + 1,
        plan,
        assignments: data.assignments,
      },
      reason: data.reason,
    });
    return { id: cert.id };
  });
}
export async function acceptHandover(
  data: z.infer<typeof handoverInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const c = await lockedContract(tx, data.id),
      rows = await related(tx, c.id);
    const final = rows.certificates.filter(i => i.status === "approved").at(-1);
    if (c.revision !== data.revision) throw new DomainError("CONFLICT");
    const selfHandover =
      c.createdBy === actorId || final?.createdBy === actorId;
    if (selfHandover) {
      const [actor] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actorId));
      const [profile] = await tx
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.userId, actorId));
      if (
        !actor?.active ||
        (actor.role !== "admin" && profile?.template !== "project_manager")
      )
        throw new DomainError("DUTY_CONFLICT");
      if (data.reason.trim().length < 3) throw new DomainError("INVALID_INPUT");
    }
    if (
      !final ||
      decimal(final.progress) !== decimal("100") ||
      rows.certificates.some(i => decimal(i.releasedAmount) > 0n)
    )
      throw new DomainError("INVALID_TRANSITION");
    if (
      data.handoverDate < final.certificateDate ||
      data.handoverDate > businessDate()
    )
      throw new DomainError("INVALID_INPUT");
    const changes = {
      handoverDate: data.handoverDate,
      handoverBy: actorId,
      handoverReason: data.reason,
      revision: c.revision + 1,
    };
    await tx
      .update(s.simpleContracts)
      .set(changes)
      .where(eq(s.simpleContracts.id, c.id));
    await recordChange(tx, {
      actorId,
      action: "p1.contract.handover",
      entityType: "p1_contract",
      entityId: c.id,
      before: c,
      after: { ...c, ...changes, selfHandoverOverride: selfHandover },
      reason: data.reason,
    });
    return { id: c.id };
  });
}
export async function requestReversal(
  paymentId: number,
  reason: string,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      actorId,
      "p1.payment.reversal.request",
      key,
      { paymentId, reason },
      async () => {
        const [ref] = await tx
          .select()
          .from(s.simplePayments)
          .where(eq(s.simplePayments.id, paymentId));
        if (!ref) throw new DomainError("NOT_FOUND");
        await lockedContract(tx, ref.contractId);
        const [payment] = await tx
          .select()
          .from(s.simplePayments)
          .where(eq(s.simplePayments.id, paymentId))
          .for("update");
        if (payment.status !== "active")
          throw new DomainError("INVALID_TRANSITION");
        if (
          (
            await tx
              .select()
              .from(s.paymentReversals)
              .where(eq(s.paymentReversals.pendingPaymentId, paymentId))
          ).length
        )
          throw new DomainError("CONFLICT");
        const [request] = await tx
          .insert(s.paymentReversals)
          .values({
            paymentId,
            pendingPaymentId: paymentId,
            reason,
            createdBy: actorId,
          })
          .$returningId();
        await recordChange(tx, {
          actorId,
          action: "p1.payment.reversal.request",
          entityType: "p1_payment",
          entityId: paymentId,
          after: { requestId: request.id, payment },
          reason,
        });
        return request;
      }
    )
  );
}
export async function decideReversal(
  id: number,
  action: "approve" | "reject",
  reason: string,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(s.paymentReversals)
      .where(eq(s.paymentReversals.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const [payment] = await tx
      .select()
      .from(s.simplePayments)
      .where(eq(s.simplePayments.id, ref.paymentId));
    await lockedContract(tx, payment.contractId);
    const [r] = await tx
      .select()
      .from(s.paymentReversals)
      .where(eq(s.paymentReversals.id, id))
      .for("update");
    const [p] = await tx
      .select()
      .from(s.simplePayments)
      .where(eq(s.simplePayments.id, r.paymentId))
      .for("update");
    if (r.status !== "pending" || p.status !== "active")
      throw new DomainError("INVALID_TRANSITION");
    if (r.createdBy === actorId || p.createdBy === actorId)
      throw new DomainError("DUTY_CONFLICT");
    if (action === "approve")
      await tx
        .update(s.simplePayments)
        .set({
          status: "reversed",
          voucherKey: null,
          reversedBy: actorId,
          reversedAt: new Date(),
          reversalReason: r.reason,
        })
        .where(eq(s.simplePayments.id, p.id));
    const changes = {
      status: action === "approve" ? "approved" : "rejected",
      pendingPaymentId: null,
      decidedBy: actorId,
      decidedAt: new Date(),
      decisionReason: reason,
    };
    await tx
      .update(s.paymentReversals)
      .set(changes)
      .where(eq(s.paymentReversals.id, id));
    await recordChange(tx, {
      actorId,
      action: "p1.payment.reversal." + changes.status,
      entityType: "p1_payment",
      entityId: p.id,
      before: { payment: p, request: r },
      after: {
        payment: { ...p, status: action === "approve" ? "reversed" : "active" },
        request: { ...r, ...changes },
      },
      reason,
    });
    return { id };
  });
}
async function lockedContract(tx: Transaction, id: number) {
  const [contract] = await tx
    .select()
    .from(s.simpleContracts)
    .where(eq(s.simpleContracts.id, id))
    .for("update");
  if (!contract) throw new DomainError("NOT_FOUND");
  if (contract.status !== "active") throw new DomainError("INVALID_TRANSITION");
  return contract;
}
async function related(tx: Transaction, id: number) {
  return {
    installments: await tx
      .select()
      .from(s.certificateInstallments)
      .where(eq(s.certificateInstallments.contractId, id))
      .orderBy(asc(s.certificateInstallments.position))
      .for("update"),
    certificates: await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.contractId, id))
      .orderBy(asc(s.simpleCertificates.id))
      .for("update"),
    payments: await tx
      .select()
      .from(s.simplePayments)
      .where(eq(s.simplePayments.contractId, id))
      .for("update"),
    milestones: await tx
      .select()
      .from(s.simpleMilestones)
      .where(eq(s.simpleMilestones.contractId, id))
      .orderBy(asc(s.simpleMilestones.position))
      .for("update"),
  };
}
export function contractBalance(
  contract: Contract,
  certificates: Certificate[],
  payments: Payment[],
  milestones: Milestone[],
  asOf = businessDate(),
  installments: Installment[] = []
) {
  certificates = certificates.filter(c => c.certificateDate <= asOf);
  payments = payments.filter(
    p => p.paymentDate <= asOf && p.status !== "reversed"
  );
  const approved = certificates.filter(c => c.status === "approved"),
    last = approved.at(-1);
  const normalPaid = sum(
    payments.filter(p => p.kind === "normal").map(p => p.amount)
  );
  const retentionPaid = sum(
    payments.filter(p => p.kind === "retention").map(p => p.amount)
  );
  const approvedNet = sum(approved.map(c => c.net)),
    releasedAsOf = (c: Certificate) =>
      c.releaseDate
        ? c.releaseDate <= asOf
          ? c.releasedAmount
          : "0"
        : asOf >= businessDate()
          ? c.releasedAmount
          : "0",
    released = sum(approved.map(releasedAsOf)),
    retained = sum(approved.map(c => c.retention)) - released;
  const normalOutstanding = approvedNet - normalPaid;
  const stages = milestones.map(m => {
    const paid = sum(
      payments.filter(p => p.milestoneId === m.id).map(p => p.amount)
    );
    const remaining = decimal(m.amount) - paid;
    return {
      ...m,
      paid: formatDecimal(paid),
      remaining: formatDecimal(remaining),
    };
  });
  const upcoming =
    approved.some(
      c =>
        !c.scheduleVersion &&
        decimal(c.net) >
          sum(
            payments
              .filter(p => p.certificateId === c.id && p.kind === "normal")
              .map(p => p.amount)
          )
    ) ||
    !last ||
    decimal(last.progress) < decimal("100")
      ? stages.find(m => decimal(m.remaining) > 0n)
      : undefined;
  const datedAvailable =
    sum(approved.filter(c => c.certificateDate <= asOf).map(c => c.net)) -
    normalPaid;
  const ready =
    !!upcoming &&
    upcoming.dueDate <= asOf &&
    decimal(upcoming.minProgress) <= decimal(last?.progress ?? "0") &&
    datedAvailable > 0n;
  const readyAmount = ready
    ? min(decimal(upcoming!.remaining), datedAvailable)
    : 0n;
  return {
    contractId: contract.id,
    currency: contract.currency,
    paid: formatDecimal(normalPaid + retentionPaid),
    approvedNet: formatDecimal(approvedNet),
    outstanding: formatDecimal(normalOutstanding + released - retentionPaid),
    retained: formatDecimal(retained),
    releasedOutstanding: formatDecimal(released - retentionPaid),
    progress: last?.progress ?? "0.0000",
    stages,
    upcoming: upcoming
      ? { ...upcoming, ready, readyAmount: formatDecimal(readyAmount) }
      : null,
    certificates: certificates.map(c => ({
      ...c,
      installments: installments
        .filter(
          i => i.certificateId === c.id && i.version === c.scheduleVersion
        )
        .map(i => {
          const paid = sum(
            payments.filter(p => p.installmentId === i.id).map(p => p.amount)
          );
          return {
            ...i,
            paid: formatDecimal(paid),
            remaining: formatDecimal(decimal(i.amount) - paid),
          };
        }),
      paid: formatDecimal(
        sum(
          payments
            .filter(p => p.certificateId === c.id && p.kind === "normal")
            .map(p => p.amount)
        )
      ),
      outstanding: formatDecimal(
        decimal(c.net) -
          sum(
            payments
              .filter(p => p.certificateId === c.id && p.kind === "normal")
              .map(p => p.amount)
          )
      ),
      releasedOutstanding: formatDecimal(
        decimal(releasedAsOf(c)) -
          sum(
            payments
              .filter(p => p.certificateId === c.id && p.kind === "retention")
              .map(p => p.amount)
          )
      ),
    })),
  };
}
// Historical availability and lifetime limits must both hold. A backdated
// voucher must not consume capacity already used by a later voucher.
export function paymentCapacity(
  contract: Contract,
  certificates: Certificate[],
  payments: Payment[],
  milestones: Milestone[],
  asOf: string,
  installments: Installment[] = []
) {
  payments = payments.filter(p => p.status !== "reversed");
  const historical = contractBalance(
    contract,
    certificates,
    payments,
    milestones,
    asOf,
    installments
  );
  const lifetime = contractBalance(
    contract,
    certificates,
    payments,
    milestones,
    "9999-12-31",
    installments
  );
  const dates = [
    ...new Set([
      asOf,
      ...payments.map(p => p.paymentDate),
      ...certificates
        .filter(c => c.status === "approved")
        .map(c => c.certificateDate),
    ]),
  ].filter(d => d >= asOf);
  const capacity = dates.reduce(
    (available, date) =>
      min(
        available,
        sum(
          certificates
            .filter(c => c.status === "approved" && c.certificateDate <= date)
            .map(c => c.net)
        ) -
          sum(
            payments
              .filter(p => p.kind === "normal" && p.paymentDate <= date)
              .map(p => p.amount)
          )
      ),
    moneyLimit
  );
  const stage = lifetime.stages.find(m => m.id === historical.upcoming?.id);
  const readyAmount =
    historical.upcoming?.ready && stage
      ? min(
          decimal(historical.upcoming.readyAmount),
          min(decimal(stage.remaining), capacity)
        )
      : 0n;
  return {
    ...historical,
    upcoming: historical.upcoming
      ? {
          ...historical.upcoming,
          ready: readyAmount > 0n,
          readyAmount: formatDecimal(readyAmount > 0n ? readyAmount : 0n),
        }
      : null,
    certificates: historical.certificates.map(c => {
      const current = lifetime.certificates.find(x => x.id === c.id)!;
      return {
        ...c,
        installments: c.installments.map(i => {
          const currentStage = current.installments.find(x => x.id === i.id)!;
          const remaining = min(
            decimal(i.remaining),
            decimal(currentStage.remaining)
          );
          return { ...i, remaining: formatDecimal(remaining) };
        }),
        nextInstallment: (() => {
          const i = c.installments.find(
            x =>
              decimal(
                current.installments.find(y => y.id === x.id)!.remaining
              ) > 0n
          );
          if (!i) return null;
          const cap = min(
            capacity,
            min(
              decimal(current.installments.find(x => x.id === i.id)!.remaining),
              min(decimal(c.outstanding), decimal(current.outstanding))
            )
          );
          const ready = i.dueDate <= asOf && cap > 0n;
          return { ...i, ready, readyAmount: formatDecimal(ready ? cap : 0n) };
        })(),
        outstanding: formatDecimal(
          min(decimal(c.outstanding), decimal(current.outstanding))
        ),
        releasedOutstanding: formatDecimal(
          min(
            decimal(c.releasedOutstanding),
            decimal(current.releasedOutstanding)
          )
        ),
      };
    }),
  };
}
export async function paymentPreview(contractId: number, paymentDate: string) {
  if (paymentDate > businessDate()) throw new DomainError("INVALID_INPUT");
  return (await database()).transaction(async tx => {
    const contract = await lockedContract(tx, contractId),
      rows = await related(tx, contractId);
    return paymentCapacity(
      contract,
      rows.certificates,
      rows.payments,
      rows.milestones,
      paymentDate,
      rows.installments
    );
  });
}
export async function correctContract(
  data: z.infer<typeof contractCorrectionInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    const [contract] = await tx
      .select()
      .from(s.simpleContracts)
      .where(eq(s.simpleContracts.id, data.id))
      .for("update");
    if (!contract) throw new DomainError("NOT_FOUND");
    if (contract.revision !== data.revision) throw new DomainError("CONFLICT");
    if (data.action === "terms" && contract.status !== "active")
      throw new DomainError("INVALID_TRANSITION");
    if (data.action !== "terms") {
      const rows = await related(tx, data.id);
      if (
        rows.certificates.length ||
        rows.payments.length ||
        contract.status !== (data.action === "cancel" ? "active" : "cancelled")
      )
        throw new DomainError("INVALID_TRANSITION");
    }
    const changes = {
      ...(data.action === "terms"
        ? { terms: data.terms! }
        : { status: data.action === "cancel" ? "cancelled" : "active" }),
      revision: contract.revision + 1,
      correctionReason: data.reason,
      correctedBy: actorId,
      correctedAt: new Date(),
    };
    await tx
      .update(s.simpleContracts)
      .set(changes)
      .where(eq(s.simpleContracts.id, data.id));
    await recordChange(tx, {
      actorId,
      action: "p1.contract." + data.action,
      entityType: "p1_contract",
      entityId: data.id,
      before: contract,
      after: { ...contract, ...changes },
      reason: data.reason,
    });
    return { id: data.id };
  });
}
export async function state(access: AccessContext) {
  if (!access) throw new DomainError("USER_ADMIN_REQUIRED");
  return (await database()).transaction(async tx => {
    const financial = canAccess(access, "p1.payments.view");
    const readContracts = canAccess(access, "p1.contracts.view");
    const readCertificates = canAccess(access, "p1.certificates.view");
    const scope = projectScope(access, s.simpleContracts.projectId);
    const projects = canAccess(access, "p1.projects.view")
      ? await tx
          .select()
          .from(s.simpleProjects)
          .where(projectScope(access, s.simpleProjects.id))
          .orderBy(desc(s.simpleProjects.id))
      : [];
    const allContracts = readContracts
      ? await tx
          .select()
          .from(s.simpleContracts)
          .where(scope)
          .orderBy(desc(s.simpleContracts.id))
      : [];
    const contracts = allContracts.filter(c => c.status === "active");
    const vendors = await tx
      .select({
        id: suppliers.id,
        nameAr: suppliers.nameAr,
        status: suppliers.status,
      })
      .from(suppliers)
      .where(
        canAccess(access, "suppliers.view")
          ? undefined
          : allContracts.length
            ? inArray(
                suppliers.id,
                allContracts.map(c => c.supplierId)
              )
            : sql`FALSE`
      )
      .orderBy(asc(suppliers.nameAr));
    const certificates = readCertificates
      ? await tx
          .select({
            ...getTableColumns(s.simpleCertificates),
            releasedAmount: financial
              ? s.simpleCertificates.releasedAmount
              : sql<string | null>`NULL`,
            releasedBy: financial
              ? s.simpleCertificates.releasedBy
              : sql<number | null>`NULL`,
            releaseReason: financial
              ? s.simpleCertificates.releaseReason
              : sql<string | null>`NULL`,
            releaseDate: financial
              ? s.simpleCertificates.releaseDate
              : sql<string | null>`NULL`,
          })
          .from(s.simpleCertificates)
          .innerJoin(
            s.simpleContracts,
            eq(s.simpleCertificates.contractId, s.simpleContracts.id)
          )
          .where(scope)
          .orderBy(asc(s.simpleCertificates.id))
      : [];
    const payments = financial
      ? await tx
          .select(getTableColumns(s.simplePayments))
          .from(s.simplePayments)
          .innerJoin(
            s.simpleContracts,
            eq(s.simplePayments.contractId, s.simpleContracts.id)
          )
          .where(scope)
          .orderBy(desc(s.simplePayments.id))
      : [];
    const milestones = readContracts
      ? await tx
          .select(getTableColumns(s.simpleMilestones))
          .from(s.simpleMilestones)
          .innerJoin(
            s.simpleContracts,
            eq(s.simpleMilestones.contractId, s.simpleContracts.id)
          )
          .where(scope)
          .orderBy(asc(s.simpleMilestones.position))
      : [];
    const installments = readCertificates
      ? await tx
          .select(getTableColumns(s.certificateInstallments))
          .from(s.certificateInstallments)
          .innerJoin(
            s.simpleContracts,
            eq(s.certificateInstallments.contractId, s.simpleContracts.id)
          )
          .where(scope)
          .orderBy(asc(s.certificateInstallments.position))
      : [];
    const reversals =
      financial || canAccess(access, "p1.payments.reverse.approve")
        ? await tx
            .select({
              ...getTableColumns(s.paymentReversals),
              payment: getTableColumns(s.simplePayments),
            })
            .from(s.paymentReversals)
            .innerJoin(
              s.simplePayments,
              eq(s.paymentReversals.paymentId, s.simplePayments.id)
            )
            .innerJoin(
              s.simpleContracts,
              eq(s.simplePayments.contractId, s.simpleContracts.id)
            )
            .where(scope)
            .orderBy(desc(s.paymentReversals.id))
        : [];
    const [company] = await tx
      .select()
      .from(s.simpleCompany)
      .where(eq(s.simpleCompany.id, 1));
    const corrections =
      readContracts && allContracts.length
        ? await tx
            .select({
              id: scmAuditEvents.id,
              contractId: scmAuditEvents.entityId,
              actorId: scmAuditEvents.actorId,
              action: scmAuditEvents.action,
              reason: scmAuditEvents.reason,
              createdAt: scmAuditEvents.createdAt,
              before: scmAuditEvents.before,
              after: scmAuditEvents.after,
            })
            .from(scmAuditEvents)
            .where(
              and(
                eq(scmAuditEvents.entityType, "p1_contract"),
                inArray(
                  scmAuditEvents.entityId,
                  allContracts.map(c => c.id)
                ),
                inArray(scmAuditEvents.action, [
                  "p1.contract.terms",
                  "p1.contract.cancel",
                  "p1.contract.restore",
                ])
              )
            )
            .orderBy(asc(scmAuditEvents.id))
        : [];
    const balances = financial
      ? contracts.map(c =>
          paymentCapacity(
            c,
            certificates.filter(x => x.contractId === c.id) as Certificate[],
            payments.filter(x => x.contractId === c.id),
            milestones.filter(x => x.contractId === c.id),
            businessDate(),
            installments.filter(x => x.contractId === c.id)
          )
        )
      : [];
    // Each currency remains a separate balance; currencies are never added together.
    const accounts = financial
      ? vendors.flatMap(v =>
          [
            ...new Set(
              contracts.filter(c => c.supplierId === v.id).map(c => c.currency)
            ),
          ].map(currency => {
            const ids = new Set(
              contracts
                .filter(c => c.supplierId === v.id && c.currency === currency)
                .map(c => c.id)
            );
            const rows = balances.filter(b => ids.has(b.contractId));
            return {
              supplierId: v.id,
              currency,
              name: v.nameAr,
              paid: formatDecimal(sum(rows.map(r => r.paid))),
              outstanding: formatDecimal(sum(rows.map(r => r.outstanding))),
              retained: formatDecimal(sum(rows.map(r => r.retained))),
            };
          })
        )
      : [];
    return {
      projects,
      inspections: await inspectionState(tx, access),
      suppliers: vendors,
      contracts,
      cancelledContracts: allContracts.filter(c => c.status === "cancelled"),
      corrections,
      certificates,
      payments,
      installments,
      reversals,
      balances,
      schedules: allContracts.map(c => ({
        contractId: c.id,
        stages: milestones.filter(m => m.contractId === c.id),
      })),
      accounts,
      company: company?.data ?? null,
    };
  });
}
export async function createProject(
  data: z.infer<typeof projectInput>,
  actorId: number,
  key: string = randomUUID()
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "p1.project", key, data, async () => {
      const number = await allocateRecordNumber(tx, "project");
      const [row] = await tx
        .insert(s.simpleProjects)
        .values({ ...data, number, createdBy: actorId })
        .$returningId();
      await tx
        .insert(accessProfiles)
        .values({ userId: actorId })
        .onDuplicateKeyUpdate({ set: { userId: actorId } });
      const [profile] = await tx
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.userId, actorId))
        .for("update");
      if (!profile.allProjects)
        await tx
          .insert(accessProjects)
          .values({ userId: actorId, projectId: row.id });
      await recordChange(tx, {
        actorId,
        action: "p1.project.created",
        entityType: "p1_project",
        entityId: row.id,
        after: { ...data, number },
      });
      return row;
    })
  );
}
export async function saveCompany(
  data: z.infer<typeof companyInput>,
  actorId: number
) {
  return (await database()).transaction(async tx => {
    await tx
      .insert(s.simpleCompany)
      .values({ id: 1, data })
      .onDuplicateKeyUpdate({ set: { data } });
    await recordChange(tx, {
      actorId,
      action: "p1.company.saved",
      entityType: "p1_company",
      entityId: 1,
      after: { ...data, logo: !!data.logo },
    });
    return { id: 1 };
  });
}
export async function createContract(
  data: z.infer<typeof simpleContractInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "p1.contract", key, data, async () => {
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, data.supplierId));
      const [project] = await tx
        .select()
        .from(s.simpleProjects)
        .where(eq(s.simpleProjects.id, data.projectId));
      if (!supplier || supplier.status !== "active" || !project)
        throw new DomainError("INVALID_REFERENCE");
      const subtotal = totalItems(data.items),
        total = formatDecimal(
          decimal(subtotal) + decimal(percentOf(subtotal, data.taxPercent))
        );
      if (decimal(total) > moneyLimit || decimal(total) <= 0n)
        throw new DomainError("INVALID_INPUT");
      const { milestones, ...fields } = data;
      const [contract] = await tx
        .insert(s.simpleContracts)
        .values({
          ...fields,
          inspectionRequired: true,
          subtotal,
          total,
          number: await allocateRecordNumber(tx, "contract"),
          createdBy: actorId,
        })
        .$returningId();
      let allocated = 0n;
      for (let i = 0; i < milestones.length; i++) {
        const m = milestones[i],
          amount =
            i === milestones.length - 1
              ? formatDecimal(decimal(total) - allocated)
              : percentOf(total, m.percent);
        if (decimal(amount) <= 0n) throw new DomainError("INVALID_INPUT");
        allocated += decimal(amount);
        await tx
          .insert(s.simpleMilestones)
          .values({ ...m, amount, contractId: contract.id, position: i + 1 });
      }
      await recordChange(tx, {
        actorId,
        action: "p1.contract.created",
        entityType: "p1_contract",
        entityId: contract.id,
        after: data,
      });
      return contract;
    })
  );
}
export async function createCertificate(
  data: z.infer<typeof simpleCertificateInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "p1.certificate", key, data, async () => {
      const contract = await lockedContract(tx, data.contractId),
        rows = await related(tx, contract.id);
      if (rows.certificates.some(c => c.status === "pending"))
        throw new DomainError("CONFLICT");
      const approved = rows.certificates.filter(c => c.status === "approved"),
        last = approved.at(-1);
      if (
        data.certificateDate > businessDate() ||
        data.certificateDate < (last?.certificateDate ?? contract.siteDate)
      )
        throw new DomainError("INVALID_INPUT");
      const inspectionResult = contract.inspectionRequired
        ? await allocateInspections(
            tx,
            contract.id,
            data.certificateDate,
            data.inspectionAllocations,
            last?.quantities ?? contract.items.map(() => "0")
          )
        : null;
      if (!contract.inspectionRequired && data.inspectionAllocations.length)
        throw new DomainError("INVALID_INPUT");
      const quantities =
        inspectionResult?.quantities ??
        (data.mode === "quantity"
          ? data.quantities
          : contract.items.map(i =>
              formatDecimal(
                roundedDivide(
                  multiply(decimal(i.quantity), decimal(data.progress)),
                  100n
                ),
                4
              )
            ));
      let computed;
      try {
        computed = calculateSimpleCertificate({
          items: contract.items,
          quantities,
          previousQuantities: last?.quantities ?? contract.items.map(() => "0"),
          retentionPercent: contract.retentionPercent,
          taxPercent: contract.taxPercent,
          dailyPenalty: contract.dailyPenalty,
          delayDays: data.delayDays,
          previousDelayDays: last?.delayDays ?? 0,
          previousPenalty: formatDecimal(sum(approved.map(c => c.penalty))),
          otherDeduction: data.otherDeduction,
        });
      } catch (e) {
        throw new DomainError(
          e instanceof Error && e.message === "QUANTITY_EXCEEDED"
            ? "QUANTITY_EXCEEDED"
            : "INVALID_INPUT"
        );
      }
      const [certificate] = await tx
        .insert(s.simpleCertificates)
        .values({
          ...computed,
          contractId: contract.id,
          quantities,
          certificateDate: data.certificateDate,
          inspectionAllocations:
            inspectionResult?.inspectionAllocations ?? null,
          delayDays: data.delayDays,
          otherDeduction: data.otherDeduction,
          deductionReason: data.deductionReason,
          notes: data.notes,
          number: await allocateRecordNumber(tx, "certificate"),
          createdBy: actorId,
        })
        .$returningId();
      if (data.installments) {
        await writeSchedule(
          tx,
          certificate.id,
          contract.id,
          computed.net,
          data.certificateDate,
          1,
          data.installments
        );
        await tx
          .update(s.simpleCertificates)
          .set({
            scheduleVersion: 1,
            scheduleReason: "Initial certificate plan",
          })
          .where(eq(s.simpleCertificates.id, certificate.id));
      }
      await recordChange(tx, {
        actorId,
        action: "p1.certificate.created",
        entityType: "p1_certificate",
        entityId: certificate.id,
        after: { ...data, ...computed },
      });
      return certificate;
    })
  );
}
export async function decideCertificate(
  id: number,
  actorId: number,
  action: "approve" | "reject",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    await lockedContract(tx, ref.contractId);
    const [c] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, id))
      .for("update");
    if (c.status !== "pending") throw new DomainError("INVALID_TRANSITION");
    const selfApproval = c.createdBy === actorId;
    if (selfApproval) {
      const [actor] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actorId));
      if (action !== "approve" || actor?.role !== "admin" || !actor.active)
        throw new DomainError("DUTY_CONFLICT");
      if (reason.trim().length < 3) throw new DomainError("INVALID_REFERENCE");
    }
    const status = action === "approve" ? "approved" : "rejected";
    await tx
      .update(s.simpleCertificates)
      .set({
        status,
        decidedBy: actorId,
        decidedAt: new Date(),
        decisionReason: reason,
      })
      .where(eq(s.simpleCertificates.id, id));
    await recordChange(tx, {
      actorId,
      action: "p1.certificate." + status,
      entityType: "p1_certificate",
      entityId: id,
      before: { status: c.status },
      after: { status, selfApprovalOverride: selfApproval },
      reason,
    });
    return { id };
  });
}
export async function releaseRetention(
  id: number,
  actorId: number,
  reason: string,
  releaseDate = businessDate()
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const contract = await lockedContract(tx, ref.contractId);
    const [c] = await tx
      .select()
      .from(s.simpleCertificates)
      .where(eq(s.simpleCertificates.id, id))
      .for("update");
    if (
      c.status !== "approved" ||
      decimal(c.retention) <= 0n ||
      (decimal(c.releasedAmount) !== 0n && !!c.releaseDate)
    )
      throw new DomainError("INVALID_TRANSITION");
    if (c.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    if (releaseDate > businessDate() || releaseDate < c.certificateDate)
      throw new DomainError("INVALID_INPUT");
    if (
      !contract.handoverDate ||
      releaseDate <
        addCalendarDays(contract.handoverDate, contract.warrantyDays)
    )
      throw new DomainError("RETENTION_NOT_DUE");
    await tx
      .update(s.simpleCertificates)
      .set({
        releasedAmount: c.retention,
        releasedBy: actorId,
        releaseReason: reason,
        releaseDate,
      })
      .where(eq(s.simpleCertificates.id, id));
    await recordChange(tx, {
      actorId,
      action: "p1.retention.released",
      entityType: "p1_certificate",
      entityId: id,
      before: { releasedAmount: c.releasedAmount, releaseDate: c.releaseDate },
      after: { releasedAmount: c.retention, releaseDate },
      reason,
    });
    return { id };
  });
}
export async function recordPayment(
  data: z.infer<typeof simplePaymentInput>,
  actorId: number,
  key: string
) {
  try {
    return await (
      await database()
    ).transaction(tx =>
      once(tx, actorId, "p1.payment", key, data, async () => {
        const contract = await lockedContract(tx, data.contractId),
          rows = await related(tx, contract.id);
        const certificate = rows.certificates.find(
          c => c.id === data.certificateId
        );
        if (!certificate || certificate.status !== "approved")
          throw new DomainError("INVALID_REFERENCE");
        if (
          data.paymentDate > businessDate() ||
          data.paymentDate < certificate.certificateDate
        )
          throw new DomainError("INVALID_INPUT");
        if (
          data.kind === "retention" &&
          (!certificate.releaseDate ||
            data.paymentDate < certificate.releaseDate)
        )
          throw new DomainError("INVALID_INPUT");
        const metrics = paymentCapacity(
          contract,
          rows.certificates,
          rows.payments,
          rows.milestones,
          data.paymentDate,
          rows.installments
        );
        const entry = metrics.certificates.find(c => c.id === certificate.id)!;
        const amount = decimal(data.amount);
        if (data.kind === "normal") {
          if (
            (certificate.scheduleVersion > 0
              ? !entry.nextInstallment?.ready ||
                entry.nextInstallment.id !== data.installmentId ||
                data.milestoneId !== null ||
                amount > decimal(entry.nextInstallment.readyAmount)
              : !metrics.upcoming?.ready ||
                metrics.upcoming.id !== data.milestoneId ||
                data.installmentId !== null ||
                amount > decimal(metrics.upcoming.readyAmount)) ||
            amount > decimal(entry.outstanding)
          )
            throw new DomainError("PAYMENT_EXCEEDED");
        } else if (
          data.milestoneId !== null ||
          data.installmentId !== null ||
          amount > decimal(entry.releasedOutstanding)
        )
          throw new DomainError("PAYMENT_EXCEEDED");
        const normalized = voucherKey(data.voucher, data.paymentDate);
        if (data.replacesPaymentId) {
          const old = rows.payments.find(p => p.id === data.replacesPaymentId);
          if (
            !old ||
            old.status !== "reversed" ||
            old.certificateId !== certificate.id ||
            old.kind !== data.kind ||
            rows.payments.some(p => p.replacesPaymentId === old.id)
          )
            throw new DomainError("INVALID_REFERENCE");
        } else if (
          rows.payments.some(
            p =>
              p.status === "reversed" &&
              voucherKey(p.voucher, p.paymentDate) === normalized
          )
        ) {
          throw new DomainError("INVALID_REFERENCE");
        }
        if (
          (
            await tx
              .select({ id: s.simplePayments.id })
              .from(s.simplePayments)
              .where(eq(s.simplePayments.voucherKey, normalized))
          ).length
        )
          throw new DomainError("CONFLICT");
        const [row] = await tx
          .insert(s.simplePayments)
          .values({ ...data, voucherKey: normalized, createdBy: actorId })
          .$returningId();
        await recordChange(tx, {
          actorId,
          action: "p1.payment.recorded",
          entityType: "p1_payment",
          entityId: row.id,
          after: data,
        });
        return row;
      })
    );
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if (err.code === "ER_DUP_ENTRY" || err.cause?.code === "ER_DUP_ENTRY")
      throw new DomainError("CONFLICT");
    throw e;
  }
}
