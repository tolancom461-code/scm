import { and, asc, desc, eq, isNull, lte, gte, inArray } from "drizzle-orm";
import {
  workflowDefinitions as definitions,
  workflowSteps as steps,
  workflowApprovers as approvers,
  workflowInstances as instances,
  workflowDelegations as delegations,
  workflowDecisions as decisions,
} from "../../../drizzle/workflows";
import { users } from "../../../drizzle/schema";
import { database, type Transaction } from "../../core/database";
import { allocateDocumentNumber } from "../../core/numbering";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { DomainError } from "../../core/errors";
import { decimal } from "../../../shared/decimal";
import { definitionInput, delegationInput } from "../../../shared/workflows";
import type { z } from "zod";

export function containsAmount(
  min: string,
  max: string | null,
  amount: string
) {
  return (
    decimal(amount) >= decimal(min) &&
    (max === null || decimal(amount) < decimal(max))
  );
}
export function rangesOverlap(
  a: { minAmount: string; maxAmount: string | null },
  b: { minAmount: string; maxAmount: string | null }
) {
  return (
    (b.maxAmount === null || decimal(a.minAmount) < decimal(b.maxAmount)) &&
    (a.maxAmount === null || decimal(b.minAmount) < decimal(a.maxAmount))
  );
}
async function activeUsers(tx: Transaction, ids: number[]) {
  const unique = [...new Set(ids)];
  const found = await tx
    .select()
    .from(users)
    .where(inArray(users.id, unique))
    .for("update");
  if (found.length !== unique.length || found.some(u => !u.active))
    throw new DomainError("INVALID_REFERENCE");
}
export async function createDefinition(
  data: z.infer<typeof definitionInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "workflow.definition", key, data, async () => {
      await allocateDocumentNumber(tx, "WORKFLOW", 0);
      if (
        data.maxAmount !== null &&
        decimal(data.maxAmount) <= decimal(data.minAmount)
      )
        throw new DomainError("INVALID_INPUT");
      const active = await tx
        .select()
        .from(definitions)
        .where(
          and(
            eq(definitions.entityType, data.entityType),
            eq(definitions.currency, data.currency),
            eq(definitions.department, data.department),
            eq(definitions.active, "yes")
          )
        );
      if (active.some(d => rangesOverlap(d, data)))
        throw new DomainError("CONFLICT");
      const previous = await tx
        .select()
        .from(definitions)
        .where(eq(definitions.code, data.code))
        .orderBy(desc(definitions.version))
        .limit(1);
      await activeUsers(
        tx,
        data.steps.flatMap(s => s.approvers.map(a => a.userId))
      );
      for (const step of data.steps)
        if (
          new Set(step.approvers.map(a => a.userId)).size !==
          step.approvers.length
        )
          throw new DomainError("INVALID_INPUT");
      const { steps: inputSteps, ...header } = data;
      const [record] = await tx
        .insert(definitions)
        .values({
          ...header,
          version: (previous[0]?.version ?? 0) + 1,
          createdBy: actorId,
        })
        .$returningId();
      for (const [index, step] of inputSteps.entries()) {
        const { approvers: assigned, ...names } = step;
        const [s] = await tx
          .insert(steps)
          .values({ ...names, definitionId: record.id, position: index + 1 })
          .$returningId();
        await tx
          .insert(approvers)
          .values(assigned.map(a => ({ ...a, stepId: s.id })));
      }
      await recordChange(tx, {
        actorId,
        action: "workflow.created",
        entityType: "workflow_definition",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function deactivateDefinition(
  id: number,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    await allocateDocumentNumber(tx, "WORKFLOW", 0);
    const [record] = await tx
      .select()
      .from(definitions)
      .where(eq(definitions.id, id))
      .for("update");
    if (!record) throw new DomainError("NOT_FOUND");
    if (record.active !== "yes") throw new DomainError("INVALID_TRANSITION");
    await tx
      .update(definitions)
      .set({ active: "no" })
      .where(eq(definitions.id, id));
    await recordChange(tx, {
      actorId,
      action: "workflow.deactivated",
      entityType: "workflow_definition",
      entityId: id,
      reason,
      before: { active: "yes" },
      after: { active: "no" },
    });
    return { id };
  });
}
export async function start(
  tx: Transaction,
  input: {
    entityType: string;
    entityId: number;
    amount: string;
    currency: string;
    department: string;
    requesterId: number;
    blockedActorIds?: number[];
  },
  actorId: number
) {
  // Serializes activation/selection and pins the immutable version to this cycle.
  await allocateDocumentNumber(tx, "WORKFLOW", 0);
  const candidates = await tx
    .select()
    .from(definitions)
    .where(
      and(
        eq(definitions.entityType, input.entityType),
        eq(definitions.currency, input.currency),
        eq(definitions.active, "yes")
      )
    );
  const exact = candidates.filter(
    d =>
      d.department === input.department &&
      containsAmount(d.minAmount, d.maxAmount, input.amount)
  );
  const matches = exact.length
    ? exact
    : candidates.filter(
        d =>
          d.department === "*" &&
          containsAmount(d.minAmount, d.maxAmount, input.amount)
      );
  if (matches.length !== 1) throw new DomainError("WORKFLOW_UNAVAILABLE");
  const previous = await tx
    .select()
    .from(instances)
    .where(
      and(
        eq(instances.entityType, input.entityType),
        eq(instances.entityId, input.entityId)
      )
    )
    .orderBy(desc(instances.cycle))
    .limit(1)
    .for("update");
  if (previous[0]?.status === "pending" || previous[0]?.status === "approved")
    throw new DomainError("INVALID_TRANSITION");
  const blocked = [
    ...new Set([input.requesterId, ...(input.blockedActorIds ?? [])]),
  ];
  const selectedSteps = await tx
    .select()
    .from(steps)
    .where(eq(steps.definitionId, matches[0].id));
  for (const step of selectedSteps) {
    const assigned = await tx
      .select({
        userId: approvers.userId,
        limit: approvers.limit,
        active: users.active,
      })
      .from(approvers)
      .innerJoin(users, eq(approvers.userId, users.id))
      .where(eq(approvers.stepId, step.id));
    if (
      !assigned.some(
        a =>
          a.active &&
          !blocked.includes(a.userId) &&
          decimal(a.limit) >= decimal(input.amount)
      )
    )
      throw new DomainError("WORKFLOW_UNAVAILABLE");
  }
  const [instance] = await tx
    .insert(instances)
    .values({
      ...input,
      blockedActorIds: blocked,
      definitionId: matches[0].id,
      cycle: (previous[0]?.cycle ?? 0) + 1,
    })
    .$returningId();
  await recordChange(tx, {
    actorId,
    action: "workflow.started",
    entityType: "workflow_instance",
    entityId: instance.id,
    after: {
      entityType: input.entityType,
      entityId: input.entityId,
      definitionId: matches[0].id,
    },
  });
  return instance.id;
}
export async function decide(
  tx: Transaction,
  input: {
    instanceId: number;
    expectedPosition: number;
    entityType: string;
    entityId: number;
    actorId: number;
    action: "approve" | "reject" | "return";
    reason: string;
  }
) {
  const [instance] = await tx
    .select()
    .from(instances)
    .where(eq(instances.id, input.instanceId))
    .for("update");
  if (
    !instance ||
    instance.entityType !== input.entityType ||
    instance.entityId !== input.entityId
  )
    throw new DomainError("INVALID_REFERENCE");
  if (instance.status !== "pending")
    throw new DomainError("INVALID_TRANSITION");
  if (instance.currentPosition !== input.expectedPosition)
    throw new DomainError("CONFLICT");
  if (instance.blockedActorIds.includes(input.actorId))
    throw new DomainError("DUTY_CONFLICT");
  await activeUsers(tx, [input.actorId]);
  const allSteps = await tx
    .select()
    .from(steps)
    .where(eq(steps.definitionId, instance.definitionId))
    .orderBy(asc(steps.position));
  const step = allSteps.find(s => s.position === instance.currentPosition);
  if (!step) throw new DomainError("INVALID_TRANSITION");
  const assigned = await tx
    .select({
      userId: approvers.userId,
      limit: approvers.limit,
      active: users.active,
    })
    .from(approvers)
    .innerJoin(users, eq(approvers.userId, users.id))
    .where(eq(approvers.stepId, step.id));
  const eligible = assigned.filter(
    a =>
      a.active &&
      !instance.blockedActorIds.includes(a.userId) &&
      decimal(a.limit) >= decimal(instance.amount)
  );
  let principal = eligible.find(a => a.userId === input.actorId),
    delegationId: number | undefined;
  if (!principal && eligible.length) {
    const now = new Date();
    const delegated = await tx
      .select()
      .from(delegations)
      .where(
        and(
          inArray(
            delegations.fromUserId,
            eligible.map(a => a.userId)
          ),
          eq(delegations.toUserId, input.actorId),
          eq(delegations.entityType, instance.entityType),
          lte(delegations.startsAt, now),
          gte(delegations.endsAt, now),
          isNull(delegations.revokedAt)
        )
      )
      .orderBy(asc(delegations.id))
      .for("update");
    if (delegated[0]) {
      principal = eligible.find(a => a.userId === delegated[0].fromUserId);
      delegationId = delegated[0].id;
    }
  }
  if (!principal) throw new DomainError("APPROVER_INELIGIBLE");
  const status =
    input.action === "approve"
      ? instance.currentPosition === allSteps.length
        ? "approved"
        : "pending"
      : input.action === "reject"
        ? "rejected"
        : "returned";
  await tx
    .insert(decisions)
    .values({
      instanceId: instance.id,
      stepId: step.id,
      actorId: input.actorId,
      onBehalfOf: principal.userId,
      delegationId,
      action: input.action,
      reason: input.reason,
    });
  await tx
    .update(instances)
    .set({
      status,
      currentPosition:
        status === "pending"
          ? instance.currentPosition + 1
          : instance.currentPosition,
    })
    .where(eq(instances.id, instance.id));
  await recordChange(tx, {
    actorId: input.actorId,
    action: `workflow.${input.action}`,
    entityType: "workflow_instance",
    entityId: instance.id,
    before: { status: instance.status, position: instance.currentPosition },
    after: { status, onBehalfOf: principal.userId },
    reason: input.reason,
  });
  return status;
}
export async function delegate(
  data: z.infer<typeof delegationInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "workflow.delegate", key, data, async () => {
      await activeUsers(tx, [data.fromUserId, data.toUserId]);
      const [record] = await tx
        .insert(delegations)
        .values({ ...data, createdBy: actorId })
        .$returningId();
      await recordChange(tx, {
        actorId,
        action: "workflow.delegated",
        entityType: "workflow_delegation",
        entityId: record.id,
        after: data,
        reason: data.reason,
      });
      return record;
    })
  );
}
export async function revoke(id: number, actorId: number, reason: string) {
  return (await database()).transaction(async tx => {
    const [record] = await tx
      .select()
      .from(delegations)
      .where(eq(delegations.id, id))
      .for("update");
    if (!record) throw new DomainError("NOT_FOUND");
    if (record.revokedAt) throw new DomainError("INVALID_TRANSITION");
    await tx
      .update(delegations)
      .set({ revokedAt: new Date() })
      .where(eq(delegations.id, id));
    await recordChange(tx, {
      actorId,
      action: "workflow.delegation.revoked",
      entityType: "workflow_delegation",
      entityId: id,
      reason,
    });
    return { id };
  });
}
