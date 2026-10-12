import { and, eq, asc } from "drizzle-orm";
import {
  stockOperations,
  stockOperationLines,
} from "../../../drizzle/inventory";
import { stockBatches } from "../../../drizzle/receiving";
import { items, warehouseLocations } from "../../../drizzle/master-data";
import { wbsNodes } from "../../../drizzle/projects";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { allocateDocumentNumber } from "../../core/numbering";
import {
  decimal,
  formatDecimal,
  multiply,
  roundedDivide,
} from "../../../shared/decimal";
import { stockOperationInput } from "../../../shared/inventory";
import type { z } from "zod";
import { balance, postStock } from "./ledger";
import * as workflow from "../workflows/service";
import { lockProject } from "../projects/service";

async function checkProject(
  tx: Transaction,
  projectId: number | null,
  wbsId: number | null,
  type: string
) {
  if (!projectId || !wbsId) {
    if (projectId || wbsId || ["issue", "reserve"].includes(type))
      throw new DomainError("INVALID_REFERENCE");
    return;
  }
  const project = await lockProject(tx, projectId);
  const [wbs] = await tx.select().from(wbsNodes).where(eq(wbsNodes.id, wbsId));
  if (project.status !== "active" || wbs?.projectId !== project.id)
    throw new DomainError("INVALID_REFERENCE");
}
async function apply(
  tx: Transaction,
  op: typeof stockOperations.$inferSelect,
  actorId: number
) {
  await checkProject(tx, op.projectId, op.wbsId, op.type);
  const lines = await tx
    .select()
    .from(stockOperationLines)
    .where(eq(stockOperationLines.operationId, op.id))
    .orderBy(
      asc(stockOperationLines.batchId),
      asc(stockOperationLines.fromLocationId)
    );
  for (const line of lines) {
    const [batch] = await tx
      .select()
      .from(stockBatches)
      .where(eq(stockBatches.id, line.batchId))
      .for("update");
    if (!batch || batch.itemId !== line.itemId)
      throw new DomainError("INVALID_REFERENCE");
    let status: "available" | "reserved" = "available";
    if (line.reservationLineId) {
      const [reserved] = await tx
        .select()
        .from(stockOperationLines)
        .where(eq(stockOperationLines.id, line.reservationLineId))
        .for("update");
      if (!reserved) throw new DomainError("INVALID_REFERENCE");
      const [parent] = await tx
        .select()
        .from(stockOperations)
        .where(eq(stockOperations.id, reserved.operationId));
      if (
        !parent ||
        parent.type !== "reserve" ||
        parent.status !== "posted" ||
        parent.projectId !== op.projectId ||
        parent.wbsId !== op.wbsId ||
        reserved.itemId !== line.itemId ||
        reserved.batchId !== line.batchId ||
        reserved.fromLocationId !== line.fromLocationId ||
        decimal(reserved.quantity) - decimal(reserved.releasedQuantity) <
          decimal(line.quantity)
      )
        throw new DomainError("INVALID_REFERENCE");
      await tx
        .update(stockOperationLines)
        .set({
          releasedQuantity: formatDecimal(
            decimal(reserved.releasedQuantity) + decimal(line.quantity),
            6
          ),
        })
        .where(eq(stockOperationLines.id, reserved.id));
      status = "reserved";
    } else if (op.type === "release")
      throw new DomainError("INVALID_REFERENCE");
    const common = {
      itemId: line.itemId,
      batchId: line.batchId,
      sourceType: "stock_operation",
      sourceId: op.id,
      sourceLineId: line.id,
      actorId,
      currency: op.currency,
    };
    const event = "STK:" + line.id;
    if (op.type === "adjustment" || op.type === "count") {
      const current = await balance(
        tx,
        line.itemId,
        line.fromLocationId,
        line.batchId,
        "available"
      );
      if (op.type === "count" && current.version !== line.balanceVersion)
        throw new DomainError("CONFLICT");
      if (decimal(line.quantity) !== 0n)
        await postStock(tx, {
          ...common,
          locationId: line.fromLocationId,
          status: "available",
          quantity: line.quantity,
          value:
            decimal(line.quantity) > 0n
              ? formatDecimal(
                  multiply(
                    decimal(line.quantity),
                    decimal(line.unitCost ?? "0")
                  ),
                  6
                )
              : undefined,
          type: op.type,
          eventKey: event,
        });
    } else {
      if (decimal(line.quantity) <= 0n) throw new DomainError("INVALID_INPUT");
      const sourceStatus = op.type === "release" ? "reserved" : status;
      const value = await postStock(tx, {
        ...common,
        locationId: line.fromLocationId,
        status: sourceStatus,
        quantity: formatDecimal(-decimal(line.quantity), 6),
        type: op.type + "_out",
        eventKey: event + ":OUT",
      });
      if (op.type !== "issue") {
        const target =
          op.type === "transfer" ? line.toLocationId : line.fromLocationId;
        if (
          !target ||
          (op.type === "transfer" && target === line.fromLocationId)
        )
          throw new DomainError("INVALID_REFERENCE");
        await postStock(tx, {
          ...common,
          locationId: target,
          status: op.type === "reserve" ? "reserved" : "available",
          quantity: line.quantity,
          value,
          type: op.type + "_in",
          eventKey: event + ":IN",
        });
      }
    }
  }
  await tx
    .update(stockOperations)
    .set({ status: "posted" })
    .where(eq(stockOperations.id, op.id));
  await recordChange(tx, {
    actorId,
    action: "stock." + op.type + ".posted",
    entityType: "stock_operation",
    entityId: op.id,
    after: { status: "posted" },
    reason: op.reason,
  });
}
export async function create(
  data: z.infer<typeof stockOperationInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "stock.operation.create", key, data, async () => {
      await checkProject(tx, data.projectId, data.wbsId, data.type);
      const composite = data.lines.map(l =>
        [l.itemId, l.batchId, l.fromLocationId, l.reservationLineId].join(":")
      );
      if (new Set(composite).size !== composite.length)
        throw new DomainError("INVALID_INPUT");
      const { lines, ...header } = data;
      const [record] = await tx
        .insert(stockOperations)
        .values({
          ...header,
          number: await allocateDocumentNumber(tx, "STK"),
          createdBy: actorId,
        })
        .$returningId();
      let approvalAmount = 0n;
      for (const line of [...lines].sort((a, b) => a.batchId - b.batchId)) {
        const [item] = await tx
          .select()
          .from(items)
          .where(eq(items.id, line.itemId));
        const [batch] = await tx
          .select()
          .from(stockBatches)
          .where(eq(stockBatches.id, line.batchId))
          .for("update");
        const [location] = await tx
          .select()
          .from(warehouseLocations)
          .where(eq(warehouseLocations.id, line.fromLocationId));
        if (
          !item?.active ||
          !item.trackInventory ||
          batch?.itemId !== item.id ||
          !location?.active ||
          location.type !== "storage"
        )
          throw new DomainError("INVALID_REFERENCE");
        const current = await balance(
          tx,
          item.id,
          location.id,
          batch.id,
          "available"
        );
        if (
          decimal(current.quantity) > 0n &&
          current.currency !== data.currency
        )
          throw new DomainError("INVALID_REFERENCE");
        let quantity = line.quantity;
        const cost =
          decimal(current.quantity) > 0n
            ? formatDecimal(
                roundedDivide(
                  decimal(current.value) * 1000000n,
                  decimal(current.quantity)
                ),
                6
              )
            : line.unitCost;
        if (data.type === "count") {
          if (
            line.countedQuantity === null ||
            line.balanceVersion !== current.version
          )
            throw new DomainError("CONFLICT");
          quantity = formatDecimal(
            decimal(line.countedQuantity) - decimal(current.quantity),
            6
          );
        } else if (
          decimal(quantity) === 0n ||
          (data.type !== "adjustment" && decimal(quantity) < 0n)
        )
          throw new DomainError("INVALID_INPUT");
        if (
          (data.type === "adjustment" || data.type === "count") &&
          decimal(quantity) > 0n &&
          cost === null
        )
          throw new DomainError("INVALID_INPUT");
        if (data.type === "transfer") {
          const [target] = await tx
            .select()
            .from(warehouseLocations)
            .where(eq(warehouseLocations.id, line.toLocationId ?? 0));
          if (
            !target?.active ||
            target.type !== "storage" ||
            target.id === location.id
          )
            throw new DomainError("INVALID_REFERENCE");
        }
        const absolute =
          decimal(quantity) < 0n ? -decimal(quantity) : decimal(quantity);
        approvalAmount += multiply(absolute, decimal(cost ?? "0"));
        await tx.insert(stockOperationLines).values({
          ...line,
          operationId: record.id,
          quantity,
          unitCost: cost,
        });
      }
      const [op] = await tx
        .select()
        .from(stockOperations)
        .where(eq(stockOperations.id, record.id));
      if (data.type === "adjustment" || data.type === "count") {
        const workflowId = await workflow.start(
          tx,
          {
            entityType: "adjustment",
            entityId: op.id,
            amount: formatDecimal(approvalAmount),
            currency: data.currency,
            department: data.department,
            requesterId: actorId,
          },
          actorId
        );
        await tx
          .update(stockOperations)
          .set({ workflowId, status: "pending" })
          .where(eq(stockOperations.id, op.id));
        await recordChange(tx, {
          actorId,
          action: "stock.adjustment.submitted",
          entityType: "stock_operation",
          entityId: op.id,
          after: { ...data, workflowId },
        });
      } else await apply(tx, op, actorId);
      return record;
    })
  );
}
export async function decide(
  id: number,
  instanceId: number,
  expectedPosition: number,
  actorId: number,
  action: "approve" | "reject" | "return",
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [op] = await tx
      .select()
      .from(stockOperations)
      .where(eq(stockOperations.id, id))
      .for("update");
    if (!op || op.workflowId !== instanceId)
      throw new DomainError("INVALID_REFERENCE");
    if (op.status !== "pending") throw new DomainError("INVALID_TRANSITION");
    const status = await workflow.decide(tx, {
      instanceId,
      expectedPosition,
      entityType: "adjustment",
      entityId: id,
      actorId,
      action,
      reason,
    });
    if (status === "approved") await apply(tx, op, actorId);
    else {
      await tx
        .update(stockOperations)
        .set({ status })
        .where(eq(stockOperations.id, id));
      await recordChange(tx, {
        actorId,
        action: "stock.adjustment." + action,
        entityType: "stock_operation",
        entityId: id,
        after: { status },
        reason,
      });
    }
    return { id };
  });
}
