import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  projects,
  wbsNodes,
  budgets,
  budgetLedger,
} from "../../../drizzle/projects";
import { branches, costCenters } from "../../../drizzle/master-data";
import { users } from "../../../drizzle/schema";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { decimal, formatDecimal } from "../../../shared/decimal";
import { projectInput, wbsInput, budgetInput } from "../../../shared/projects";
import type { z } from "zod";
import { orders, orderLines } from "../../../drizzle/procurement";

export async function lockProject(tx: Transaction, id: number) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .for("update");
  if (!project) throw new DomainError("INVALID_REFERENCE");
  return project;
}
export async function createProject(
  data: z.infer<typeof projectInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "project.create", key, data, async () => {
      const [branch] = await tx
        .select()
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .for("update");
      const [manager] = await tx
        .select()
        .from(users)
        .where(eq(users.id, data.managerId))
        .for("update");
      if (!branch?.active || !manager?.active)
        throw new DomainError("INVALID_REFERENCE");
      const [record] = await tx
        .insert(projects)
        .values({ ...data, createdBy: actorId })
        .$returningId();
      await recordChange(tx, {
        actorId,
        action: "project.created",
        entityType: "project",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function createWbs(
  data: z.infer<typeof wbsInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "wbs.create", key, data, async () => {
      const project = await lockProject(tx, data.projectId);
      if (!["planning", "active"].includes(project.status))
        throw new DomainError("INVALID_TRANSITION");
      if (data.parentId) {
        const [parent] = await tx
          .select()
          .from(wbsNodes)
          .where(eq(wbsNodes.id, data.parentId))
          .for("update");
        if (!parent || parent.projectId !== project.id)
          throw new DomainError("INVALID_REFERENCE");
      }
      if (
        (project.startsAt &&
          data.startsAt &&
          data.startsAt < project.startsAt) ||
        (project.endsAt && data.endsAt && data.endsAt > project.endsAt)
      )
        throw new DomainError("INVALID_INPUT");
      const [record] = await tx
        .insert(wbsNodes)
        .values({ ...data, createdBy: actorId })
        .$returningId();
      await recordChange(tx, {
        actorId,
        action: "wbs.created",
        entityType: "wbs",
        entityId: record.id,
        after: data,
      });
      return record;
    })
  );
}
export async function createBudget(
  data: z.infer<typeof budgetInput>,
  actorId: number,
  key: string
) {
  return (await database()).transaction(tx =>
    once(tx, actorId, "budget.create", key, data, async () => {
      const project = await lockProject(tx, data.projectId);
      if (!["planning", "active"].includes(project.status))
        throw new DomainError("INVALID_TRANSITION");
      const [wbs] = await tx
        .select()
        .from(wbsNodes)
        .where(eq(wbsNodes.id, data.wbsId))
        .for("update");
      const [center] = await tx
        .select()
        .from(costCenters)
        .where(eq(costCenters.id, data.costCenterId))
        .for("update");
      if (
        !wbs ||
        wbs.projectId !== project.id ||
        !center?.active ||
        center.branchId !== project.branchId
      )
        throw new DomainError("INVALID_REFERENCE");
      const current = await tx
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.projectId, data.projectId),
            eq(budgets.wbsId, data.wbsId),
            eq(budgets.costCenterId, data.costCenterId),
            inArray(budgets.status, ["draft", "approved"])
          )
        )
        .for("update");
      if (
        current.some(b => b.status === "draft") ||
        (current.find(b => b.status === "approved")?.id ?? null) !==
          data.replacesId
      )
        throw new DomainError("CONFLICT");
      const [record] = await tx
        .insert(budgets)
        .values({ ...data, createdBy: actorId })
        .$returningId();
      await recordChange(tx, {
        actorId,
        action: "budget.created",
        entityType: "budget",
        entityId: record.id,
        after: data,
        reason: data.reason,
      });
      return record;
    })
  );
}
export async function totals(tx: Transaction, budgetIds: number[]) {
  if (!budgetIds.length)
    return {
      commitment: "0.00",
      received: "0.00",
      actual: "0.00",
      paid: "0.00",
    };
  const rows = await tx
    .select({
      metric: budgetLedger.metric,
      amount: sql<string>`COALESCE(SUM(${budgetLedger.amount}), 0)`,
    })
    .from(budgetLedger)
    .where(inArray(budgetLedger.budgetId, budgetIds))
    .groupBy(budgetLedger.metric);
  const result = {
    commitment: "0.00",
    received: "0.00",
    actual: "0.00",
    paid: "0.00",
  };
  for (const row of rows)
    result[row.metric] = formatDecimal(decimal(row.amount));
  return result;
}
async function lineage(tx: Transaction, id: number) {
  const ids: number[] = [];
  let cursor: number | null = id;
  while (cursor !== null) {
    if (ids.includes(cursor)) throw new DomainError("INVALID_REFERENCE");
    ids.push(cursor);
    const [row] = await tx.select().from(budgets).where(eq(budgets.id, cursor));
    if (!row) throw new DomainError("INVALID_REFERENCE");
    cursor = row.replacesId;
  }
  return ids;
}
export async function approveBudget(
  id: number,
  actorId: number,
  action: "approve" | "reject",
  reason: string
) {
  return (await database()).transaction(async tx => {
    // Lock project before budget consistently with all commitment mutations.
    const [reference] = await tx
      .select()
      .from(budgets)
      .where(eq(budgets.id, id));
    if (!reference) throw new DomainError("NOT_FOUND");
    const project = await lockProject(tx, reference.projectId);
    if (!["planning", "active"].includes(project.status))
      throw new DomainError("INVALID_TRANSITION");
    const [budget] = await tx
      .select()
      .from(budgets)
      .where(eq(budgets.id, id))
      .for("update");
    if (budget.status !== "draft") throw new DomainError("INVALID_TRANSITION");
    if (budget.createdBy === actorId) throw new DomainError("DUTY_CONFLICT");
    if (action === "approve" && budget.replacesId) {
      const [previous] = await tx
        .select()
        .from(budgets)
        .where(eq(budgets.id, budget.replacesId))
        .for("update");
      if (previous?.status !== "approved") throw new DomainError("CONFLICT");
      const used = await totals(tx, await lineage(tx, previous.id));
      if (decimal(budget.amount) < decimal(used.commitment))
        throw new DomainError("BUDGET_EXCEEDED");
      await tx
        .update(budgets)
        .set({ status: "superseded" })
        .where(eq(budgets.id, previous.id));
    }
    await tx
      .update(budgets)
      .set({
        status: action === "approve" ? "approved" : "rejected",
        approvedBy: actorId,
      })
      .where(eq(budgets.id, id));
    await recordChange(tx, {
      actorId,
      action: `budget.${action}`,
      entityType: "budget",
      entityId: id,
      before: { status: "draft" },
      after: { status: action },
      reason,
    });
    return { id };
  });
}
export async function postBudget(
  tx: Transaction,
  input: typeof budgetLedger.$inferInsert,
  currency: string
) {
  const [reference] = await tx
    .select()
    .from(budgets)
    .where(eq(budgets.id, input.budgetId));
  if (!reference) throw new DomainError("INVALID_REFERENCE");
  const project = await lockProject(tx, reference.projectId);
  if (project.currency !== currency || project.status !== "active")
    throw new DomainError("INVALID_REFERENCE");
  const [current] = await tx
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.projectId, reference.projectId),
        eq(budgets.wbsId, reference.wbsId),
        eq(budgets.costCenterId, reference.costCenterId),
        eq(budgets.status, "approved")
      )
    )
    .for("update");
  if (!current) throw new DomainError("INVALID_REFERENCE");
  const ids = await lineage(tx, current.id);
  if (!ids.includes(reference.id)) throw new DomainError("INVALID_REFERENCE");
  const values = await totals(tx, ids);
  const next = decimal(values[input.metric]) + decimal(input.amount);
  if (next < 0n) throw new DomainError("INVALID_INPUT");
  if (input.metric === "commitment" && next > decimal(current.amount))
    throw new DomainError("BUDGET_EXCEEDED");
  await tx.insert(budgetLedger).values(input);
}
export async function setStatus(
  id: number,
  version: number,
  status: "active" | "on_hold" | "completed" | "cancelled",
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const project = await lockProject(tx, id);
    if (project.version !== version) throw new DomainError("CONFLICT");
    const allowed: Record<string, string[]> = {
      planning: ["active", "cancelled"],
      active: ["on_hold", "completed"],
      on_hold: ["active", "cancelled"],
    };
    if (!allowed[project.status]?.includes(status))
      throw new DomainError("INVALID_TRANSITION");
    if (status === "cancelled" || status === "completed") {
      const [open] = await tx
        .select({ id: orders.id })
        .from(orders)
        .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
        .where(
          and(
            eq(orderLines.projectId, id),
            inArray(orders.status, ["draft", "pending", "approved", "returned"])
          )
        )
        .limit(1);
      if (open) throw new DomainError("INVALID_TRANSITION");
      const scope = await tx
        .select()
        .from(budgets)
        .where(eq(budgets.projectId, id));
      const values = await totals(
        tx,
        scope.map(b => b.id)
      );
      if (
        decimal(values.commitment) !== decimal(values.actual) ||
        decimal(values.actual) !== decimal(values.paid)
      )
        throw new DomainError("INVALID_TRANSITION");
    }
    await tx
      .update(projects)
      .set({ status, version: version + 1 })
      .where(eq(projects.id, id));
    await recordChange(tx, {
      actorId,
      action: "project.status",
      entityType: "project",
      entityId: id,
      before: { status: project.status },
      after: { status },
      reason,
    });
    return { id };
  });
}
export async function detail(id: number) {
  return (await database()).transaction(async tx => {
    const project = await lockProject(tx, id);
    const wbs = await tx
      .select()
      .from(wbsNodes)
      .where(eq(wbsNodes.projectId, id))
      .orderBy(asc(wbsNodes.code));
    const scope = await tx
      .select()
      .from(budgets)
      .where(eq(budgets.projectId, id));
    const values = await totals(
      tx,
      scope.map(b => b.id)
    );
    const budget = scope
      .filter(b => b.status === "approved")
      .reduce((sum, b) => sum + decimal(b.amount), 0n);
    const phaseMetrics = [];
    for (const node of wbs) {
      const nodeBudgets = scope.filter(b => b.wbsId === node.id),
        amount = nodeBudgets
          .filter(b => b.status === "approved")
          .reduce((n, b) => n + decimal(b.amount), 0n);
      phaseMetrics.push({
        node,
        metrics: {
          ...(await totals(
            tx,
            nodeBudgets.map(b => b.id)
          )),
          budget: formatDecimal(amount),
        },
      });
    }
    return {
      project,
      wbs,
      phaseMetrics,
      budgets: scope,
      metrics: {
        ...values,
        budget: formatDecimal(budget),
        available: formatDecimal(budget - decimal(values.commitment)),
        outstanding: formatDecimal(
          decimal(values.actual) > decimal(values.paid)
            ? decimal(values.actual) - decimal(values.paid)
            : 0n
        ),
        prepaid: formatDecimal(
          decimal(values.paid) > decimal(values.actual)
            ? decimal(values.paid) - decimal(values.actual)
            : 0n
        ),
      },
    };
  });
}
export async function progress(
  id: number,
  version: number,
  progress: number,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [ref] = await tx.select().from(wbsNodes).where(eq(wbsNodes.id, id));
    if (!ref) throw new DomainError("NOT_FOUND");
    const project = await lockProject(tx, ref.projectId);
    const [node] = await tx
      .select()
      .from(wbsNodes)
      .where(eq(wbsNodes.id, id))
      .for("update");
    if (project.status !== "active" || node.progress !== version)
      throw new DomainError("CONFLICT");
    await tx.update(wbsNodes).set({ progress }).where(eq(wbsNodes.id, id));
    await recordChange(tx, {
      actorId,
      action: "project.progress",
      entityType: "wbs",
      entityId: id,
      before: { progress: node.progress },
      after: { progress },
      reason,
    });
    return { id };
  });
}
