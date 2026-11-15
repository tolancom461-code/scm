import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { materialRequisitions as requisitions } from "../../../drizzle/construction";
import { database, type Database } from "../../core/database";
import {
  cmmsPurchasePayload,
  cmmsPurchaseSettings,
  sendCmmsPurchase,
  type CmmsPurchaseResponse,
  type CmmsPurchaseSettings,
} from "./purchase-client";

const leaseMilliseconds = 60_000;
const dueStatuses = ["pending_send", "send_failed", "sending"];
const due = (now: Date) => and(
  eq(requisitions.status, "approved"),
  isNull(requisitions.externalPurchaseRequestNumber),
  lte(requisitions.cmmsDispatchNextAt, now),
  inArray(requisitions.externalStatus, dueStatuses)
);

async function claim(db: Database, id: number, now: Date, configuredSourceId: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select({
      id: requisitions.id,
      number: requisitions.number,
      approvedAt: requisitions.approvedAt,
      approvedSnapshot: requisitions.approvedSnapshot,
      attempts: requisitions.cmmsDispatchAttempts,
      sourceId: requisitions.cmmsDispatchSourceId,
    }).from(requisitions).where(and(eq(requisitions.id, id), due(now))).for("update");
    if (!row) return null;
    const leaseId = randomUUID();
    const sourceId = row.sourceId ?? configuredSourceId;
    await tx.update(requisitions).set({
      externalStatus: "sending",
      externalMessage: "",
      externalUpdatedAt: now,
      cmmsDispatchNextAt: new Date(now.getTime() + leaseMilliseconds),
      cmmsDispatchLeaseId: leaseId,
      cmmsDispatchSourceId: sourceId,
      cmmsDispatchAttempts: row.attempts + 1,
    }).where(eq(requisitions.id, id));
    return { ...row, leaseId, sourceId, attempts: row.attempts + 1 };
  });
}

function retryDate(now: Date, attempts: number) {
  const delay = Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 6));
  return new Date(now.getTime() + delay);
}

async function finish(db: Database, id: number, lease: string, attempts: number, result: CmmsPurchaseResponse) {
  const now = new Date();
  const fields = result.ok ? {
    externalStatus: "purchase_request_created",
    externalPurchaseRequestNumber: result.number,
    externalReferenceUrl: result.referenceUrl,
    externalMessage: "",
    cmmsDispatchNextAt: null,
  } : {
    externalStatus: "send_failed",
    externalMessage: result.message,
    cmmsDispatchNextAt: result.retryable ? retryDate(now, attempts) : null,
  };
  await db.update(requisitions).set({
    ...fields,
    cmmsDispatchLeaseId: null,
    externalUpdatedAt: now,
    updatedAt: now,
    version: sql`${requisitions.version} + 1`,
  }).where(and(
    eq(requisitions.id, id),
    eq(requisitions.cmmsDispatchLeaseId, lease),
    eq(requisitions.externalStatus, "sending"),
    isNull(requisitions.externalPurchaseRequestNumber)
  ));
}

async function deliver(db: Database, settings: CmmsPurchaseSettings, id: number) {
  const row = await claim(db, id, new Date(), settings.instanceId);
  if (!row) return;
  const payload = cmmsPurchasePayload(row, row.sourceId);
  const result: CmmsPurchaseResponse = payload
    ? await sendCmmsPurchase(settings, payload)
    : { ok: false, retryable: false, message: "بيانات الربط في طلب الاحتياج المعتمد غير مكتملة." };
  await finish(db, id, row.leaseId, row.attempts, result);
}

export async function dispatchApprovedCmmsRequisition(id: number) {
  const settings = cmmsPurchaseSettings();
  if (settings) await deliver(await database(), settings, id);
}

export function startCmmsPurchaseDelivery() {
  if (!cmmsPurchaseSettings()) return;
  let running = false;
  const sweep = async () => {
    const settings = cmmsPurchaseSettings();
    if (!settings || running) return;
    running = true;
    try {
      const db = await database();
      const waiting = await db.select({ id: requisitions.id }).from(requisitions)
        .where(due(new Date())).orderBy(asc(requisitions.cmmsDispatchNextAt), asc(requisitions.id)).limit(10);
      for (const row of waiting) await deliver(db, settings, row.id);
    } catch {
      console.error("[CMMS purchase delivery] Sweep failed; pending requests remain queued.");
    } finally {
      running = false;
    }
  };
  void sweep();
  setInterval(() => void sweep(), 30_000).unref();
}
