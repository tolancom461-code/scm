import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { z } from "zod";
import * as s from "../../../drizzle/construction";
import type { GanttLink } from "../../../shared/gantt";
import {
  ganttColorInput,
  ganttPaletteInput,
} from "../../../shared/gantt-colors";
import { recordChange } from "../../core/audit";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import {
  assertConstructionAccess,
  constructionScope,
  type AccessContext,
} from "../../core/policy";
import { lockRequisitionSourceProjects } from "../material-requisitions/schedule-guards";
import { readGanttCalendarSettings } from "./calendar";
import { touchGanttStudioStates } from "./studio-state";

const projectIdInput = z.number().int().positive();
export const portfolioInput = z.object({ projectIds: z.array(projectIdInput) });
const appearanceInput = z.object({
  key: z.string().uuid(),
  projectId: projectIdInput,
  version: z.number().int().nonnegative(),
});
export const projectColorInput = appearanceInput.extend({
  ganttPalette: ganttPaletteInput.nullable(),
  ganttColor: ganttColorInput.nullable(),
});
export const taskColorInput = appearanceInput.extend({
  taskId: z.number().int().positive(),
  color: ganttColorInput.nullable(),
});

type ProjectReader = Pick<Transaction, "select">;
const project = s.constructionProjects;
const task = s.projectTasks;
const status = s.taskStatuses;
const leaf = alias(task, "portfolio_leaf");
const child = alias(task, "portfolio_child");

function eligibleProjects(db: ProjectReader, a: AccessContext) {
  const anyTask = db
    .select({ id: task.id })
    .from(task)
    .where(eq(task.projectId, project.id));
  const unfinishedLeaf = db
    .select({ id: leaf.id })
    .from(leaf)
    .innerJoin(status, eq(status.id, leaf.statusId))
    .where(
      and(
        eq(leaf.projectId, project.id),
        ne(status.code, "done"),
        notExists(
          db
            .select({ id: child.id })
            .from(child)
            .where(eq(child.parentId, leaf.id))
        )
      )
    );
  return and(
    constructionScope(a, project.id),
    isNull(project.actualEndDate),
    // Gantt counts project completion from execution leaves, excluding summaries.
    or(
      notInArray(project.status, ["active", "approved"]),
      notExists(anyTask),
      exists(unfinishedLeaf)
    )
  );
}

function portfolioProjects(
  db: ProjectReader,
  a: AccessContext,
  projectIds?: number[]
) {
  return db
    .select({
      id: project.id,
      number: project.number,
      name: project.name,
      status: project.status,
      plannedStartDate: project.plannedStartDate,
      plannedEndDate: project.plannedEndDate,
      actualStartDate: project.actualStartDate,
      forecastEndDate: project.forecastEndDate,
      ganttPalette: project.ganttPalette,
      ganttColor: project.ganttColor,
      version: project.version,
    })
    .from(project)
    .where(
      and(
        eligibleProjects(db, a),
        projectIds ? inArray(project.id, projectIds) : undefined
      )
    )
    .orderBy(
      asc(sql`${project.plannedStartDate} IS NULL`),
      asc(project.plannedStartDate),
      asc(project.id)
    );
}

export async function portfolioDirectory(a: AccessContext) {
  return portfolioProjects(await database(), a);
}

export async function assertPortfolioProjects(
  db: Transaction,
  a: AccessContext,
  projectIds: number[]
) {
  const ids = [...new Set(projectIds)];
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(inArray(project.id, ids), eligibleProjects(db, a)))
    .orderBy(project.id);
  if (rows.length !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "أحد المشاريع لم يعد متاحًا في مخطط جانت.",
    });
}

export async function portfolio(
  input: z.infer<typeof portfolioInput>,
  a: AccessContext
) {
  const requested = [...new Set(input.projectIds)];
  if (!requested.length) return { projects: [], tasks: [], links: [] };
  return (await database()).transaction(
    async tx => {
      const projects = await portfolioProjects(tx, a, requested);
      const ids = projects.map(row => row.id);
      if (!ids.length) return { projects: [], tasks: [], links: [] };
      const settings = s.ganttTaskSettings;
      const link = s.ganttTaskLinks;
      const source = alias(task, "portfolio_source");
      const target = alias(task, "portfolio_target");
      const [tasks, owners, calendars, links] = await Promise.all([
        tx
          .select({
            id: task.id,
            projectId: task.projectId,
            parentId: task.parentId,
            name: task.name,
            statusCode: status.code,
            statusName: status.name,
            startDate: task.startDate,
            endDate: task.endDate,
            actualStartDate: settings.actualStartDate,
            actualEndDate: settings.actualEndDate,
            priority: task.priority,
            level: task.level,
            isMilestone: settings.isMilestone,
            version: task.version,
            color: task.ganttColor,
          })
          .from(task)
          .innerJoin(status, eq(task.statusId, status.id))
          .leftJoin(settings, eq(task.id, settings.taskId))
          .where(inArray(task.projectId, ids))
          .orderBy(task.id),
        tx
          .select({ taskId: s.taskAssignees.taskId, name: s.employees.name })
          .from(task)
          .innerJoin(s.taskAssignees, eq(s.taskAssignees.taskId, task.id))
          .innerJoin(
            s.employees,
            eq(s.employees.id, s.taskAssignees.employeeId)
          )
          .where(inArray(task.projectId, ids))
          .orderBy(s.employees.name, s.employees.id),
        tx
          .select()
          .from(s.ganttProjectSettings)
          .where(inArray(s.ganttProjectSettings.projectId, ids)),
        tx
          .select({
            id: link.id,
            fromTaskId: link.fromTaskId,
            toTaskId: link.toTaskId,
            type: link.type,
            lagDays: link.lagDays,
          })
          .from(link)
          .innerJoin(source, eq(source.id, link.fromTaskId))
          .innerJoin(target, eq(target.id, link.toTaskId))
          .where(
            and(
              inArray(link.projectId, ids),
              inArray(source.projectId, ids),
              inArray(target.projectId, ids)
            )
          )
          .orderBy(link.id),
      ]);
      const calendarByProject = new Map(
        calendars.map(row => [row.projectId, row])
      );
      const assigneesByTask = new Map<number, string[]>();
      for (const { taskId, name } of owners) {
        const names = assigneesByTask.get(taskId);
        if (names) names.push(name);
        else assigneesByTask.set(taskId, [name]);
      }
      return {
        projects: projects.map(row => ({
          ...row,
          settings: readGanttCalendarSettings(calendarByProject.get(row.id)),
        })),
        tasks: tasks.map(row => ({
          ...row,
          isMilestone: row.isMilestone ?? false,
          assignees: assigneesByTask.get(row.id) ?? [],
        })),
        links: links.map(row => ({
          ...row,
          type: row.type as GanttLink["type"],
        })),
      };
    },
    { isolationLevel: "repeatable read" }
  );
}

export async function saveProjectColor(
  input: z.infer<typeof projectColorInput>,
  a: AccessContext
) {
  return (await database()).transaction(async tx => {
    await assertConstructionAccess(a, input.projectId, tx);
    return once(
      tx,
      a.user.id,
      "gantt.project.color",
      input.key,
      input,
      async () => {
        const [current] = await tx
          .select({
            ganttPalette: project.ganttPalette,
            ganttColor: project.ganttColor,
            version: project.version,
          })
          .from(project)
          .where(eq(project.id, input.projectId))
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND");
        if (current.version !== input.version)
          throw new DomainError("CONFLICT");
        const { ganttPalette, ganttColor } = input;
        if (
          current.ganttPalette === ganttPalette &&
          current.ganttColor === ganttColor
        )
          return { id: input.projectId };

        const values = { ganttPalette, ganttColor };
        await tx
          .update(project)
          .set({
            ...values,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(project.id, input.projectId));
        await touchGanttStudioStates(tx, [input.projectId], a.user.id);
        await recordChange(tx, {
          actorId: a.user.id,
          action: "gantt.project.color",
          entityType: "pm_project",
          entityId: input.projectId,
          before: {
            ganttPalette: current.ganttPalette,
            ganttColor: current.ganttColor,
          },
          after: values,
        });
        return { id: input.projectId };
      }
    );
  });
}

export async function saveTaskColor(
  input: z.infer<typeof taskColorInput>,
  a: AccessContext
) {
  return (await database()).transaction(async tx => {
    await assertConstructionAccess(a, input.projectId, tx);
    return once(
      tx,
      a.user.id,
      "gantt.task.color",
      input.key,
      input,
      async () => {
        await lockRequisitionSourceProjects(tx, [input.projectId]);
        const filter = and(
          eq(task.id, input.taskId),
          eq(task.projectId, input.projectId)
        );
        const [current] = await tx
          .select({
            color: task.ganttColor,
            version: task.version,
          })
          .from(task)
          .where(filter)
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND");
        if (current.version !== input.version)
          throw new DomainError("CONFLICT");
        if (current.color === input.color) return { id: input.taskId };

        await tx
          .update(task)
          .set({
            ganttColor: input.color,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(filter);
        await touchGanttStudioStates(tx, [input.projectId], a.user.id);
        await recordChange(tx, {
          actorId: a.user.id,
          action: "gantt.task.color",
          entityType: "pm_task",
          entityId: input.taskId,
          before: { color: current.color },
          after: { color: input.color },
        });
        return { id: input.taskId };
      }
    );
  });
}
