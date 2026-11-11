import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, notExists, notInArray, or } from "drizzle-orm";
import type { z } from "zod";
import * as s from "../../../drizzle/construction";
import {
  analyzeGantt,
  GanttCalendar,
  ganttBaselineInput,
  ganttDate,
  ganttLinkInput,
  ganttProgress,
  ganttScheduleInput,
  ganttSettingsInput,
  ganttStudioStateInput,
  ganttProjectScheduleInput,
  ganttSharedGroupInput,
  type GanttHoliday,
  type GanttLink,
  type GanttTask,
} from "../../../shared/gantt";
import { database, type Transaction } from "../../core/database";
import { projectTransition } from "../../../shared/construction";
import { once } from "../../core/idempotency";
import {
  assertConstructionAccess,
  canAccess,
  constructionScope,
  type AccessContext,
} from "../../core/policy";
import { recordChange } from "../../core/audit";
import { DomainError } from "../../core/errors";
import {
  assertApprovedRequisitionDates,
  assertTasksWithoutRequisitions,
  lockRequisitionSourceProjects,
} from "../material-requisitions/schedule-guards";
import {
  calendarDays,
  enforceProjectBounds,
  ensureTaskSettings,
  propagateScheduleChanges,
  shiftIso,
} from "./scheduling";
import { touchGanttStudioStates } from "./studio-state";

const MAX_STUDIO_STATE_BYTES = 8 * 1024 * 1024;

function invalid(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function studioTaskEnd(
  calendar: GanttCalendar,
  start: string,
  duration: number
) {
  if (!duration) return start;
  try {
    return calendar.finish(start, duration);
  } catch {
    invalid("تعذر حساب نهاية المهمة وفق تقويم العمل");
  }
}

function assertTaskDateLocks(
  old: { startDate: string; endDate: string; name: string },
  next: { startDate: string; endDate: string },
  settings: { startLocked: boolean; endLocked: boolean } | null | undefined
) {
  if (settings?.startLocked && old.startDate !== next.startDate)
    invalid(`بداية المهمة «${old.name}» مقفلة. افتح القفل أولًا.`);
  if (settings?.endLocked && old.endDate !== next.endDate)
    invalid(`نهاية المهمة «${old.name}» مقفلة. افتح القفل أولًا.`);
}

function assertAcyclicLinks(
  links: readonly { fromTaskId: number; toTaskId: number }[]
) {
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, number[]>();
  for (const { fromTaskId, toTaskId } of links) {
    if (!incoming.has(fromTaskId)) incoming.set(fromTaskId, 0);
    incoming.set(toTaskId, (incoming.get(toTaskId) ?? 0) + 1);
    if (!outgoing.has(fromTaskId)) outgoing.set(fromTaskId, []);
    outgoing.get(fromTaskId)!.push(toTaskId);
  }
  const queue = [...incoming]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  for (let i = 0; i < queue.length; i++) {
    for (const target of outgoing.get(queue[i]) ?? []) {
      const count = incoming.get(target)! - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (queue.length !== incoming.size)
    invalid("العلاقات تُنشئ دورة مغلقة في الجدول الزمني");
}

function remapBaselineTaskIds(
  baseline: z.infer<typeof ganttStudioStateInput>["state"]["baseline"],
  ids: ReadonlyMap<string, number>
) {
  if (!baseline) return baseline;
  return {
    ...baseline,
    tasks: baseline.tasks.map(task => {
      const id = ids.get(task.id);
      return id ? { ...task, id: `T${id}` } : task;
    }),
  };
}

function studioStatusCode(value: unknown) {
  return value === "completed"
    ? "done"
    : value === "in_progress"
      ? "working"
      : "not_started";
}

function projectStatusToStudio(code: string) {
  return code === "done"
    ? "completed"
    : code === "working"
      ? "in_progress"
      : "not_started";
}

export async function projects(a: AccessContext) {
  return (await database())
    .select({
      id: s.constructionProjects.id,
      number: s.constructionProjects.number,
      name: s.constructionProjects.name,
      status: s.constructionProjects.status,
    })
    .from(s.constructionProjects)
    .where(constructionScope(a, s.constructionProjects.id))
    .orderBy(desc(s.constructionProjects.id));
}

export async function detail(projectId: number, a: AccessContext) {
  return (await database()).transaction(tx => readDetail(projectId, a, tx), {
    isolationLevel: "repeatable read",
  });
}

async function readDetail(
  projectId: number,
  a: AccessContext,
  db: Transaction
) {
  const project = await assertConstructionAccess(a, projectId, db);
  const [
    rows,
    assignees,
    links,
    settingRows,
    baselineRows,
    studioRows,
    sharedRows,
  ] = await Promise.all([
    db
      .select({
        id: s.projectTasks.id,
        parentId: s.projectTasks.parentId,
        name: s.projectTasks.name,
        statusId: s.projectTasks.statusId,
        statusCode: s.taskStatuses.code,
        statusName: s.taskStatuses.name,
        startDate: s.projectTasks.startDate,
        endDate: s.projectTasks.endDate,
        priority: s.projectTasks.priority,
        level: s.projectTasks.level,
        version: s.projectTasks.version,
        notBefore: s.ganttTaskSettings.notBefore,
        isMilestone: s.ganttTaskSettings.isMilestone,
        plannedStartDate: s.ganttTaskSettings.plannedStartDate,
        plannedEndDate: s.ganttTaskSettings.plannedEndDate,
        actualStartDate: s.ganttTaskSettings.actualStartDate,
        actualEndDate: s.ganttTaskSettings.actualEndDate,
        startLocked: s.ganttTaskSettings.startLocked,
        endLocked: s.ganttTaskSettings.endLocked,
      })
      .from(s.projectTasks)
      .innerJoin(s.taskStatuses, eq(s.projectTasks.statusId, s.taskStatuses.id))
      .leftJoin(
        s.ganttTaskSettings,
        eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
      )
      .where(eq(s.projectTasks.projectId, projectId))
      .orderBy(s.projectTasks.id),
    db
      .select({
        taskId: s.taskAssignees.taskId,
        employeeId: s.employees.id,
        employeeName: s.employees.name,
      })
      .from(s.taskAssignees)
      .innerJoin(s.projectTasks, eq(s.taskAssignees.taskId, s.projectTasks.id))
      .innerJoin(s.employees, eq(s.taskAssignees.employeeId, s.employees.id))
      .where(eq(s.projectTasks.projectId, projectId)),
    db
      .select()
      .from(s.ganttTaskLinks)
      .where(eq(s.ganttTaskLinks.projectId, projectId)),
    db
      .select()
      .from(s.ganttProjectSettings)
      .where(eq(s.ganttProjectSettings.projectId, projectId)),
    db
      .select()
      .from(s.ganttBaselines)
      .where(eq(s.ganttBaselines.projectId, projectId))
      .orderBy(desc(s.ganttBaselines.id))
      .limit(20),
    db
      .select()
      .from(s.ganttStudioStates)
      .where(eq(s.ganttStudioStates.projectId, projectId)),
    db
      .select({
        taskId: s.ganttSharedTaskMembers.taskId,
        groupId: s.ganttSharedTaskGroups.id,
        groupName: s.ganttSharedTaskGroups.name,
      })
      .from(s.ganttSharedTaskMembers)
      .innerJoin(
        s.ganttSharedTaskGroups,
        eq(s.ganttSharedTaskMembers.groupId, s.ganttSharedTaskGroups.id)
      )
      .innerJoin(
        s.projectTasks,
        eq(s.ganttSharedTaskMembers.taskId, s.projectTasks.id)
      )
      .where(eq(s.projectTasks.projectId, projectId)),
  ]);
  const settingsRow = settingRows[0];
  const settings = {
    workingDays: parseJson<number[]>(settingsRow?.workingDays, [0, 1, 2, 3, 4]),
    hoursPerDay: settingsRow?.hoursPerDay ?? 8,
    holidays: parseJson<GanttHoliday[]>(settingsRow?.holidays, []),
    mode: (settingsRow?.mode ?? "smart") as "smart" | "free",
    statusDate: settingsRow?.statusDate ?? null,
    deadline: settingsRow?.deadline ?? null,
    version: settingsRow?.version ?? 0,
  };
  const tasks: GanttTask[] = rows.map(row => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    notBefore: row.notBefore ?? null,
    isMilestone: row.isMilestone ?? false,
    statusCode: row.statusCode,
    level: row.level,
    version: row.version,
  }));
  const rowIds = new Set(rows.map(row => row.id));
  const internalLinks = links.filter(
    link => rowIds.has(link.fromTaskId) && rowIds.has(link.toTaskId)
  );
  const ganttLinks: GanttLink[] = internalLinks.map(link => ({
    id: link.id,
    fromTaskId: link.fromTaskId,
    toTaskId: link.toTaskId,
    type: link.type as GanttLink["type"],
    lagDays: link.lagDays,
  }));
  let analysis;
  try {
    analysis = analyzeGantt(tasks, ganttLinks, settings);
  } catch (error) {
    analysis = {
      finish: null,
      metrics: {},
      criticalTaskIds: [],
      criticalLinkIds: [],
      issues: [],
      error: error instanceof Error ? error.message : "Invalid schedule",
    };
  }
  return {
    project,
    settings,
    tasks: rows.map(row => ({
      ...row,
      notBefore: row.notBefore ?? null,
      isMilestone: row.isMilestone ?? false,
      assignees: assignees
        .filter(a => a.taskId === row.id)
        .map(a => a.employeeName),
      employeeIds: assignees
        .filter(a => a.taskId === row.id)
        .map(a => a.employeeId),
      sharedGroup: sharedRows.find(item => item.taskId === row.id) ?? null,
    })),
    links: internalLinks,
    crossProjectLinks: links.filter(
      link => !rowIds.has(link.fromTaskId) || !rowIds.has(link.toTaskId)
    ),
    baselines: baselineRows,
    progress: ganttProgress(tasks),
    analysis,
    studio: studioRows[0]
      ? {
          state: parseJson<unknown>(studioRows[0].stateJson, null),
          version: studioRows[0].version,
          updatedAt: studioRows[0].updatedAt,
        }
      : null,
  };
}

export async function sharedDirectory(a: AccessContext) {
  const visibleProjects = await projects(a);
  const ids = visibleProjects.map(project => project.id);
  if (!ids.length) return { projects: visibleProjects, tasks: [], groups: [] };
  const db = await database();
  const [tasks, groups] = await Promise.all([
    db
      .select({
        id: s.projectTasks.id,
        projectId: s.projectTasks.projectId,
        name: s.projectTasks.name,
        startDate: s.projectTasks.startDate,
        endDate: s.projectTasks.endDate,
        groupId: s.ganttSharedTaskMembers.groupId,
      })
      .from(s.projectTasks)
      .leftJoin(
        s.ganttSharedTaskMembers,
        eq(s.projectTasks.id, s.ganttSharedTaskMembers.taskId)
      )
      .where(inArray(s.projectTasks.projectId, ids)),
    db
      .select()
      .from(s.ganttSharedTaskGroups)
      .where(
        notExists(
          db
            .select({ taskId: s.ganttSharedTaskMembers.taskId })
            .from(s.ganttSharedTaskMembers)
            .innerJoin(
              s.projectTasks,
              eq(s.ganttSharedTaskMembers.taskId, s.projectTasks.id)
            )
            .where(
              and(
                eq(
                  s.ganttSharedTaskMembers.groupId,
                  s.ganttSharedTaskGroups.id
                ),
                notInArray(s.projectTasks.projectId, ids)
              )
            )
        )
      ),
  ]);
  const groupIds = new Set(tasks.map(task => task.groupId));
  return {
    projects: visibleProjects,
    tasks,
    groups: groups.filter(group => groupIds.has(group.id)),
  };
}

export async function saveProjectSchedule(
  input: z.infer<typeof ganttProjectScheduleInput>,
  a: AccessContext
) {
  if (input.action === "start" && !canAccess(a, "pm.start"))
    throw new TRPCError({ code: "FORBIDDEN" });
  return (await database()).transaction(tx =>
    once(
      tx,
      a.user.id,
      "gantt.project.schedule",
      input.key,
      input,
      async () => {
        const [project] = await tx
          .select()
          .from(s.constructionProjects)
          .where(eq(s.constructionProjects.id, input.projectId))
          .for("update");
        if (!project) throw new DomainError("NOT_FOUND");
        await assertConstructionAccess(a, project.id, tx);
        if (project.version !== input.version)
          throw new DomainError("CONFLICT");
        if (input.action === "start" && project.status !== "active") {
          try {
            projectTransition(project.status, "start");
          } catch {
            throw new DomainError("INVALID_TRANSITION");
          }
        }
        const tasks = await tx
          .select({
            task: s.projectTasks,
            statusCode: s.taskStatuses.code,
            settings: s.ganttTaskSettings,
          })
          .from(s.projectTasks)
          .innerJoin(
            s.taskStatuses,
            eq(s.projectTasks.statusId, s.taskStatuses.id)
          )
          .leftJoin(
            s.ganttTaskSettings,
            eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
          )
          .where(eq(s.projectTasks.projectId, project.id))
          .for("update");
        await ensureTaskSettings(
          tx,
          tasks.map(row => row.task.id)
        );
        const update: Partial<typeof s.constructionProjects.$inferInsert> = {
          version: project.version + 1,
          updatedAt: new Date(),
        };
        const movedTasks: number[] = [];
        if (input.action === "configure") {
          if (
            project.startLocked &&
            input.plannedStartDate &&
            input.plannedStartDate !== project.plannedStartDate
          )
            invalid("بداية المشروع مقفلة. افتح القفل أولًا.");
          if (
            project.endLocked &&
            input.plannedEndDate &&
            input.plannedEndDate !== project.plannedEndDate
          )
            invalid("نهاية المشروع مقفلة. افتح القفل أولًا.");
          const plannedStart =
            input.plannedStartDate ?? project.plannedStartDate;
          const plannedEnd = input.plannedEndDate ?? project.plannedEndDate;
          if (plannedStart && plannedEnd && plannedStart > plannedEnd)
            invalid("تاريخ نهاية المشروع يجب ألا يسبق البداية");
          update.plannedStartDate =
            input.plannedStartDate ?? project.plannedStartDate;
          update.plannedEndDate =
            input.plannedEndDate ?? project.plannedEndDate;
          update.forecastEndDate =
            project.forecastEndDate ??
            input.plannedEndDate ??
            project.plannedEndDate;
        }
        if (input.action === "start") {
          if (project.actualStartDate)
            invalid("تم تسجيل البدء الفعلي لهذا المشروع مسبقًا");
          const actual = input.actualStartDate!;
          const planned =
            project.plannedStartDate ??
            tasks.map(row => row.task.startDate).sort()[0] ??
            actual;
          const delta = calendarDays(planned, actual);
          if (project.startLocked && planned !== actual)
            invalid("بداية المشروع مقفلة. افتح القفل أولًا.");
          const conflicts = tasks.filter(
            row =>
              row.statusCode === "not_started" &&
              delta !== 0 &&
              (row.settings?.startLocked || row.settings?.endLocked)
          );
          if (conflicts.length)
            invalid(
              "تعذر إزاحة الجدول لأن تواريخ المهام التالية مقفلة: " +
                conflicts.map(row => row.task.name).join("، ")
            );
          for (const row of tasks) {
            if (row.statusCode !== "not_started" || delta === 0) continue;
            movedTasks.push(row.task.id);
            await tx
              .update(s.projectTasks)
              .set({
                startDate: shiftIso(row.task.startDate, delta),
                endDate: shiftIso(row.task.endDate, delta),
                version: row.task.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(s.projectTasks.id, row.task.id));
            await tx
              .update(s.ganttTaskSettings)
              .set({
                plannedStartDate:
                  row.settings?.plannedStartDate ?? row.task.startDate,
                plannedEndDate:
                  row.settings?.plannedEndDate ?? row.task.endDate,
                version: (row.settings?.version ?? 0) + 1,
              })
              .where(eq(s.ganttTaskSettings.taskId, row.task.id));
          }
          update.actualStartDate = actual;
          update.startedAt = new Date(`${actual}T00:00:00Z`);
          const previousEnd =
            project.forecastEndDate ??
            project.plannedEndDate ??
            tasks
              .map(row => row.task.endDate)
              .sort()
              .at(-1);
          if (project.endLocked && delta !== 0)
            invalid("نهاية المشروع مقفلة. افتح القفل أولًا.");
          update.forecastEndDate = previousEnd
            ? shiftIso(previousEnd, delta)
            : actual;
          if (
            !ganttDate(update.forecastEndDate) ||
            update.forecastEndDate < actual
          )
            invalid("تاريخ نهاية المشروع خارج نطاق الجدولة");
          update.status = "active";
        }
        if (input.action === "extend") {
          if (project.endLocked)
            invalid("نهاية المشروع مقفلة. افتح قفل النهاية قبل التمديد.");
          const currentEnd = project.forecastEndDate ?? project.plannedEndDate;
          if (!currentEnd) invalid("حدد تاريخ نهاية المشروع المخطط أولًا");
          const nextEnd =
            input.extensionEndDate && input.extensionEndDate !== currentEnd
              ? input.extensionEndDate
              : shiftIso(currentEnd, input.extensionDays ?? 0);
          if (!ganttDate(nextEnd))
            invalid("تاريخ نهاية المشروع خارج نطاق الجدولة");
          if (nextEnd < currentEnd)
            invalid("تاريخ التمديد الجديد يجب ألا يسبق نهاية المشروع الحالية");
          update.forecastEndDate = nextEnd;
          update.extensionDays = calendarDays(
            project.plannedEndDate ?? currentEnd,
            nextEnd
          );
          update.extensionReason = input.reason || project.extensionReason;
        }
        if (input.action === "lock") {
          update.startLocked = input.startLocked ?? project.startLocked;
          update.endLocked = input.endLocked ?? project.endLocked;
        }
        await tx
          .update(s.constructionProjects)
          .set(update)
          .where(eq(s.constructionProjects.id, project.id));
        const affected = await propagateScheduleChanges(
          tx,
          { sharedTaskIds: movedTasks, dependencyTaskIds: movedTasks },
          a
        );
        if (input.action === "start")
          await enforceProjectBounds(tx, project.id, a);
        else await assertApprovedRequisitionDates(tx, [project.id]);
        if (input.action === "start" && project.status !== "active") {
          await tx.insert(s.projectEvents).values({
            projectId: project.id,
            action: "start",
            actorId: a.user.id,
            comment: input.reason,
          });
        }
        await touchGanttStudioStates(tx, [project.id, ...affected], a.user.id);
        await recordChange(tx, {
          actorId: a.user.id,
          action: `gantt.project.${input.action}`,
          entityType: "pm_project",
          entityId: project.id,
          before: project,
          after: update,
          reason: input.reason,
        });
        return { id: project.id };
      }
    )
  );
}

export async function saveSharedGroup(
  input: z.infer<typeof ganttSharedGroupInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "gantt.shared.group", input.key, input, async () => {
      if (input.action === "delete" && !input.id)
        invalid("مجموعة المهمة المشتركة غير محددة");
      let oldProjects: number[] = [];
      if (input.id) {
        const [current] = await tx
          .select()
          .from(s.ganttSharedTaskGroups)
          .where(eq(s.ganttSharedTaskGroups.id, input.id))
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND");
        const members = await tx
          .select({ projectId: s.projectTasks.projectId })
          .from(s.ganttSharedTaskMembers)
          .innerJoin(
            s.projectTasks,
            eq(s.projectTasks.id, s.ganttSharedTaskMembers.taskId)
          )
          .where(eq(s.ganttSharedTaskMembers.groupId, current.id))
          .for("update");
        oldProjects = [...new Set(members.map(row => row.projectId))];
        if (!oldProjects.length && !a.scope.allProjects)
          throw new TRPCError({ code: "FORBIDDEN" });
        for (const projectId of oldProjects)
          await assertConstructionAccess(a, projectId, tx);
        if (current.version !== input.version)
          throw new DomainError("CONFLICT");
        if (input.action === "delete") {
          await tx
            .delete(s.ganttSharedTaskMembers)
            .where(eq(s.ganttSharedTaskMembers.groupId, current.id));
          await tx
            .delete(s.ganttSharedTaskGroups)
            .where(eq(s.ganttSharedTaskGroups.id, current.id));
          await touchGanttStudioStates(tx, oldProjects, a.user.id);
          return { id: current.id };
        }
      }
      const sourceProjects = await tx
        .select({ projectId: s.projectTasks.projectId })
        .from(s.projectTasks)
        .where(inArray(s.projectTasks.id, input.taskIds));
      for (const source of sourceProjects)
        await assertConstructionAccess(a, source.projectId, tx);
      await lockRequisitionSourceProjects(tx, [
        ...oldProjects,
        ...sourceProjects.map(source => source.projectId),
      ]);
      const tasks = await tx
        .select()
        .from(s.projectTasks)
        .where(inArray(s.projectTasks.id, input.taskIds))
        .for("update");
      if (tasks.length !== input.taskIds.length)
        invalid("إحدى المهام المختارة غير موجودة");
      for (const projectId of new Set(tasks.map(task => task.projectId)))
        await assertConstructionAccess(a, projectId, tx);
      const projects = new Set(tasks.map(task => task.projectId));
      if (projects.size < 2)
        invalid("اختر مهامًا من مشروعين مختلفين على الأقل");
      const occupied = await tx
        .select()
        .from(s.ganttSharedTaskMembers)
        .where(inArray(s.ganttSharedTaskMembers.taskId, input.taskIds));
      if (occupied.some(row => row.groupId !== input.id))
        invalid("إحدى المهام مرتبطة مسبقًا بمجموعة مشتركة أخرى");
      let id = input.id;
      const values = {
        name: input.name,
        syncDates: input.syncDates,
        syncStatus: input.syncStatus,
        syncAssignees: input.syncAssignees,
        updatedAt: new Date(),
      };
      if (id) {
        await tx
          .update(s.ganttSharedTaskGroups)
          .set({ ...values, version: input.version + 1 })
          .where(eq(s.ganttSharedTaskGroups.id, id));
        await tx
          .delete(s.ganttSharedTaskMembers)
          .where(eq(s.ganttSharedTaskMembers.groupId, id));
      } else {
        const [result] = await tx
          .insert(s.ganttSharedTaskGroups)
          .values({ ...values, createdBy: a.user.id });
        id = Number(result.insertId);
      }
      await tx
        .insert(s.ganttSharedTaskMembers)
        .values(input.taskIds.map(taskId => ({ groupId: id!, taskId })));
      await ensureTaskSettings(tx, input.taskIds);
      const affected = await propagateScheduleChanges(
        tx,
        { sharedTaskIds: [input.taskIds[0]], dependencyTaskIds: [] },
        a
      );
      await touchGanttStudioStates(
        tx,
        [...oldProjects, ...projects, ...affected],
        a.user.id
      );
      await recordChange(tx, {
        actorId: a.user.id,
        action: "gantt.shared.saved",
        entityType: "pm_gantt_shared_task_group",
        entityId: id!,
        after: input,
      });
      return { id: id! };
    })
  );
}

export async function saveStudioState(
  input: z.infer<typeof ganttStudioStateInput>,
  a: AccessContext
) {
  if (
    Buffer.byteLength(JSON.stringify(input.state), "utf8") >
    MAX_STUDIO_STATE_BYTES
  )
    invalid("حجم مخطط Gantt أكبر من الحد المسموح");
  return (await database()).transaction(async tx => {
    await assertConstructionAccess(a, input.projectId, tx);
    return once(
      tx,
      a.user.id,
      "gantt.studio.save",
      input.key,
      input,
      async () => {
        const [project] = await tx
          .select()
          .from(s.constructionProjects)
          .where(eq(s.constructionProjects.id, input.projectId))
          .for("update");
        if (!project) throw new DomainError("NOT_FOUND");
        const taskIds = new Set(input.state.tasks.map(task => task.id));
        if (taskIds.size !== input.state.tasks.length)
          invalid("معرفات المهام مكررة");
        for (const task of input.state.tasks) {
          if (task.parentId && !taskIds.has(task.parentId))
            invalid("المهمة الرئيسية غير موجودة");
          if (task.parentId === task.id)
            invalid("لا يمكن جعل المهمة فرعية لنفسها");
        }
        const linkIds = new Set<string>();
        const linkKeys = new Set<string>();
        for (const link of input.state.links) {
          if (
            linkIds.has(link.id) ||
            !taskIds.has(link.from) ||
            !taskIds.has(link.to) ||
            link.from === link.to
          )
            invalid("علاقة مهام غير صالحة");
          const unique = `${link.from}|${link.to}|${link.type}`;
          if (linkKeys.has(unique)) invalid("علاقة مهام مكررة");
          linkIds.add(link.id);
          linkKeys.add(unique);
        }
        const incoming = new Map(input.state.tasks.map(task => [task.id, 0]));
        const outgoing = new Map(
          input.state.tasks.map(task => [task.id, [] as string[]])
        );
        for (const link of input.state.links) {
          incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
          outgoing.get(link.from)!.push(link.to);
        }
        const dependencyQueue = [...incoming]
          .filter(([, count]) => count === 0)
          .map(([id]) => id);
        let dependencyCount = 0;
        while (dependencyQueue.length) {
          const id = dependencyQueue.shift()!;
          dependencyCount++;
          for (const next of outgoing.get(id) ?? []) {
            incoming.set(next, incoming.get(next)! - 1);
            if (incoming.get(next) === 0) dependencyQueue.push(next);
          }
        }
        if (dependencyCount !== input.state.tasks.length)
          invalid("العلاقات تُنشئ دورة مغلقة في الجدول الزمني");
        const [current] = await tx
          .select()
          .from(s.ganttStudioStates)
          .where(eq(s.ganttStudioStates.projectId, input.projectId))
          .for("update");
        if ((current?.version ?? 0) !== input.version)
          throw new DomainError("CONFLICT");

        const existingTasks = await tx
          .select()
          .from(s.projectTasks)
          .where(eq(s.projectTasks.projectId, input.projectId))
          .for("update");
        if (
          project.status !== "active" &&
          (existingTasks.length || input.state.tasks.length)
        )
          invalid(
            "يجب أن يكون المشروع في مرحلة التنفيذ قبل تعديل مهامه من مخطط Gantt"
          );
        const [employees, statuses, currentAssignees, currentTaskSettings] =
          await Promise.all([
            tx.select().from(s.employees),
            tx.select().from(s.taskStatuses),
            tx
              .select({
                taskId: s.taskAssignees.taskId,
                employeeId: s.taskAssignees.employeeId,
              })
              .from(s.taskAssignees)
              .innerJoin(
                s.projectTasks,
                eq(s.taskAssignees.taskId, s.projectTasks.id)
              )
              .where(eq(s.projectTasks.projectId, input.projectId))
              .for("update"),
            tx
              .select({ settings: s.ganttTaskSettings })
              .from(s.ganttTaskSettings)
              .innerJoin(
                s.projectTasks,
                eq(s.ganttTaskSettings.taskId, s.projectTasks.id)
              )
              .where(eq(s.projectTasks.projectId, input.projectId))
              .for("update"),
          ]);
        const existingById = new Map(
          existingTasks.map(task => [task.id, task])
        );
        const employeeById = new Map(
          employees.map(employee => [employee.id, employee])
        );
        const employeeByName = new Map(
          employees.map(employee => [
            employee.name.trim().toLocaleLowerCase("ar"),
            employee,
          ])
        );
        const statusByCode = new Map(
          statuses.map(status => [status.code, status])
        );
        const statusById = new Map(statuses.map(status => [status.id, status]));
        const taskSettingsById = new Map(
          currentTaskSettings.map(row => [row.settings.taskId, row.settings])
        );
        const inputById = new Map(
          input.state.tasks.map(task => [task.id, task])
        );
        const ganttCalendar = new GanttCalendar(
          input.state.project.start,
          input.state.calendar
        );
        const dbIdByStudio = new Map<string, number>();
        const studioByDbId = new Map<number, string>();
        for (const task of input.state.tasks) {
          const fromCode = /^T(\d+)$/.exec(task.id)?.[1];
          const candidate =
            task.pmTaskId ?? (fromCode ? Number(fromCode) : undefined);
          if (!candidate || !existingById.has(candidate)) continue;
          if (studioByDbId.has(candidate))
            invalid("المهمة مرتبطة أكثر من مرة بسجل المشروع");
          dbIdByStudio.set(task.id, candidate);
          studioByDbId.set(candidate, task.id);
          if (
            task.pmVersion !== undefined &&
            task.pmVersion !== existingById.get(candidate)!.version
          )
            throw new DomainError("CONFLICT");
        }

        const depthCache = new Map<string, number>();
        const depthOf = (id: string, visiting = new Set<string>()): number => {
          if (depthCache.has(id)) return depthCache.get(id)!;
          if (visiting.has(id)) invalid("تسلسل المهام يحتوي على حلقة دائرية");
          visiting.add(id);
          const task = inputById.get(id)!;
          const depth = task.parentId
            ? depthOf(task.parentId, visiting) + 1
            : 1;
          visiting.delete(id);
          if (depth > 5)
            invalid("الحد الأقصى مهمة رئيسية وأربعة مستويات فرعية");
          depthCache.set(id, depth);
          return depth;
        };
        for (const task of input.state.tasks) depthOf(task.id);

        const parents = new Set(input.state.tasks.map(task => task.parentId));
        const parentsWithStatusChanges = new Set<string>();
        const markParents = (parentId: string | null) => {
          while (parentId && !parentsWithStatusChanges.has(parentId)) {
            parentsWithStatusChanges.add(parentId);
            parentId = inputById.get(parentId)?.parentId ?? null;
          }
        };
        for (const task of input.state.tasks) {
          const id = dbIdByStudio.get(task.id);
          const old = id ? existingById.get(id) : undefined;
          const newParent = task.parentId
            ? dbIdByStudio.get(task.parentId)
            : null;
          if (
            !old ||
            old.parentId !== newParent ||
            (!parents.has(task.id) &&
              projectStatusToStudio(
                statusById.get(old.statusId)?.code ?? "not_started"
              ) !== (task.status ?? task.executionStatus))
          ) {
            markParents(task.parentId);
          }
          if (old?.parentId && old.parentId !== newParent)
            markParents(studioByDbId.get(old.parentId) ?? null);
        }
        for (const task of existingTasks) {
          if (task.parentId && !studioByDbId.has(task.id))
            markParents(studioByDbId.get(task.parentId) ?? null);
        }

        const desired = new Map<
          string,
          {
            task: (typeof input.state.tasks)[number];
            startDate: string;
            endDate: string;
            statusId: number;
            statusCode: string;
            employeeIds: number[];
            level: number;
          }
        >();
        for (const task of input.state.tasks) {
          const mappedExistingId = dbIdByStudio.get(task.id);
          const existingTask = mappedExistingId
            ? existingById.get(mappedExistingId)
            : undefined;
          const existingSettings = mappedExistingId
            ? taskSettingsById.get(mappedExistingId)
            : undefined;
          const currentStatusCode = mappedExistingId
            ? statusById.get(existingById.get(mappedExistingId)!.statusId)?.code
            : undefined;
          // The iframe derives display status for summaries from their children.
          // A note-only save should keep a status set in Project Management.
          const preserveParentStatus =
            currentStatusCode &&
            parents.has(task.id) &&
            !parentsWithStatusChanges.has(task.id);
          const requestedStudioStatus = preserveParentStatus
            ? projectStatusToStudio(currentStatusCode)
            : (task.status ?? task.executionStatus);
          const preservedStatusCode = preserveParentStatus
            ? currentStatusCode
            : (task.pmStatusCode ?? currentStatusCode);
          const statusCode =
            preservedStatusCode &&
            projectStatusToStudio(preservedStatusCode) ===
              requestedStudioStatus &&
            statusByCode.has(preservedStatusCode)
              ? preservedStatusCode
              : studioStatusCode(requestedStudioStatus);
          const status = statusByCode.get(statusCode);
          if (!status) invalid(`حالة المهمة القياسية غير مهيأة: ${statusCode}`);
          const names = task.owner
            .split(/[،,]/)
            .map(name => name.trim())
            .filter(Boolean);
          let employeeIds = names.map(
            name => employeeByName.get(name.toLocaleLowerCase("ar"))?.id ?? 0
          );
          if (!names.length && task.pmEmployeeIds?.length)
            employeeIds = [...new Set(task.pmEmployeeIds)];
          employeeIds = [...new Set(employeeIds)];
          if (
            !employeeIds.length ||
            employeeIds.some(id => !id || !employeeById.get(id)?.active)
          )
            invalid(`اختر موظفًا متاحًا للمهمة «${task.name}»`);
          desired.set(task.id, {
            task,
            startDate: task.start,
            // A persisted finish may fall on a nonworking day. Keep it when
            // the editor round-trips the same start and working-day duration.
            endDate:
              existingTask &&
              task.start === existingTask.startDate &&
              task.duration ===
                ganttCalendar.duration(
                  existingTask.startDate,
                  existingTask.endDate,
                  existingSettings?.isMilestone
                )
                ? existingTask.endDate
                : studioTaskEnd(ganttCalendar, task.start, task.duration),
            statusId: status.id,
            statusCode,
            employeeIds,
            level: depthOf(task.id),
          });
        }
        for (const item of desired.values()) {
          if (!item.task.parentId) continue;
          const parent = desired.get(item.task.parentId)!;
          if (
            item.statusCode !== "not_started" &&
            parent.statusCode === "not_started"
          )
            invalid(
              `حدّث حالة المهمة الأم «${parent.task.name}» قبل بدء «${item.task.name}»`
            );
        }
        for (const task of [...input.state.tasks].sort(
          (left, right) => depthOf(right.id) - depthOf(left.id)
        )) {
          if (!task.parentId) continue;
          const child = desired.get(task.id)!;
          const parent = desired.get(task.parentId)!;
          const parentDbId = dbIdByStudio.get(task.parentId);
          const lock = parentDbId
            ? taskSettingsById.get(parentDbId)
            : undefined;
          if (child.startDate < parent.startDate) {
            if (lock?.startLocked)
              invalid(
                `لا يمكن تقديم بداية المهمة الأم «${parent.task.name}» لأنها مقفلة`
              );
            parent.startDate = child.startDate;
          }
          if (child.endDate > parent.endDate) {
            if (lock?.endLocked)
              invalid(
                `لا يمكن تمديد نهاية المهمة الأم «${parent.task.name}» لأنها مقفلة`
              );
            parent.endDate = child.endDate;
          }
        }
        const desiredRows = [...desired.values()];
        for (const item of desiredRows) {
          const id = dbIdByStudio.get(item.task.id);
          const existing = id ? existingById.get(id) : undefined;
          if (existing)
            assertTaskDateLocks(
              existing,
              item,
              taskSettingsById.get(existing.id)
            );
        }
        const earliest = desiredRows.map(item => item.startDate).sort()[0];
        const latest = desiredRows
          .map(item => item.endDate)
          .sort()
          .at(-1);
        const projectStart =
          project.actualStartDate ?? project.plannedStartDate;
        const projectEnd = project.forecastEndDate ?? project.plannedEndDate;
        const projectUpdate: Partial<
          typeof s.constructionProjects.$inferInsert
        > = {};
        if (earliest && projectStart && earliest < projectStart) {
          if (project.startLocked || project.actualStartDate)
            invalid(
              `المهمة تبدأ في ${earliest} قبل بداية المشروع المقفلة ${projectStart}`
            );
          projectUpdate.plannedStartDate = earliest;
        }
        if (latest && (!projectEnd || latest > projectEnd)) {
          if (project.endLocked)
            invalid(
              `المهمة تنتهي في ${latest} بعد نهاية المشروع المقفلة ${projectEnd}`
            );
          projectUpdate.forecastEndDate = latest;
          projectUpdate.extensionDays = project.plannedEndDate
            ? calendarDays(project.plannedEndDate, latest)
            : project.extensionDays;
        }
        if (Object.keys(projectUpdate).length)
          await tx
            .update(s.constructionProjects)
            .set({
              ...projectUpdate,
              version: project.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(s.constructionProjects.id, project.id));

        const deleted = existingTasks.filter(
          task => !studioByDbId.has(task.id)
        );
        if (deleted.length) {
          await assertTasksWithoutRequisitions(
            tx,
            deleted.map(task => task.id)
          );
          const sharedDeleted = await tx
            .select({ taskId: s.ganttSharedTaskMembers.taskId })
            .from(s.ganttSharedTaskMembers)
            .where(
              inArray(
                s.ganttSharedTaskMembers.taskId,
                deleted.map(task => task.id)
              )
            );
          if (sharedDeleted.length)
            invalid(
              "لا يمكن حذف مهمة مشتركة مباشرة. فك ارتباطها من «مهمة مشتركة» أولًا."
            );
        }
        const storedLinks = await tx
          .select()
          .from(s.ganttTaskLinks)
          .where(eq(s.ganttTaskLinks.projectId, input.projectId))
          .for("update");
        const internalLinks = storedLinks.filter(
          link =>
            existingById.has(link.fromTaskId) && existingById.has(link.toTaskId)
        );
        const internalByKey = new Map(
          internalLinks.map(link => [
            `${link.fromTaskId}|${link.toTaskId}|${link.type}`,
            link,
          ])
        );
        const retainedKeys = new Set(
          input.state.links.map(
            link =>
              `${dbIdByStudio.get(link.from)}|${dbIdByStudio.get(link.to)}|${link.type}`
          )
        );
        const removedLinkIds = internalLinks
          .filter(
            link =>
              !retainedKeys.has(
                `${link.fromTaskId}|${link.toTaskId}|${link.type}`
              )
          )
          .map(link => link.id);
        if (removedLinkIds.length) {
          await tx
            .delete(s.ganttTaskLinks)
            .where(inArray(s.ganttTaskLinks.id, removedLinkIds));
        }
        if (deleted.length) {
          const deletedIds = deleted.map(task => task.id);
          const crossLinks = await tx
            .select({ id: s.ganttTaskLinks.id })
            .from(s.ganttTaskLinks)
            .where(
              or(
                inArray(s.ganttTaskLinks.fromTaskId, deletedIds),
                inArray(s.ganttTaskLinks.toTaskId, deletedIds)
              )
            );
          if (crossLinks.length)
            invalid(
              "لا يمكن حذف مهمة مرتبطة بمشروع آخر. احذف العلاقة بين المشروعين أولًا."
            );
          await tx
            .delete(s.taskAssignees)
            .where(inArray(s.taskAssignees.taskId, deletedIds));
          await tx
            .delete(s.ganttTaskSettings)
            .where(inArray(s.ganttTaskSettings.taskId, deletedIds));
          for (const task of deleted.sort(
            (left, right) => right.level - left.level
          ))
            await tx
              .delete(s.projectTasks)
              .where(eq(s.projectTasks.id, task.id));
        }

        const ordered = [...input.state.tasks].sort(
          (left, right) => depthOf(left.id) - depthOf(right.id)
        );
        let created = 0,
          updated = 0;
        const sharedTaskIds: number[] = [];
        const dependencyTaskIds: number[] = [];
        for (const task of ordered) {
          const item = desired.get(task.id)!;
          const parentId = task.parentId
            ? dbIdByStudio.get(task.parentId)
            : null;
          if (task.parentId && !parentId)
            invalid("تعذر ربط المهمة الفرعية بالمهمة الأم");
          const existingId = dbIdByStudio.get(task.id);
          const existing = existingId
            ? existingById.get(existingId)
            : undefined;
          const currentSetting = existing
            ? taskSettingsById.get(existing.id)
            : undefined;
          const taskSettingValues = {
            notBefore: task.notBefore,
            isMilestone: task.duration === 0,
            plannedStartDate:
              currentSetting?.plannedStartDate ??
              task.plannedStart ??
              item.startDate,
            plannedEndDate:
              currentSetting?.plannedEndDate ?? task.plannedEnd ?? item.endDate,
            actualStartDate:
              task.actualStart ?? currentSetting?.actualStartDate ?? null,
            actualEndDate:
              task.actualEnd ?? currentSetting?.actualEndDate ?? null,
            startLocked:
              task.startLocked ?? currentSetting?.startLocked ?? false,
            endLocked: task.endLocked ?? currentSetting?.endLocked ?? false,
          };
          const scheduleChanged =
            !currentSetting ||
            Object.entries(taskSettingValues).some(
              ([key, value]) =>
                currentSetting[key as keyof typeof taskSettingValues] !== value
            );
          let writeAssignees = !existing;
          const priority = task.pmPriority ?? existing?.priority ?? "medium";
          const data = {
            projectId: input.projectId,
            parentId,
            name: task.name,
            statusId: item.statusId,
            startDate: item.startDate,
            endDate: item.endDate,
            priority,
            level: item.level,
            updatedAt: new Date(),
          };
          let dbId = existingId;
          if (!existing) {
            const [result] = await tx
              .insert(s.projectTasks)
              .values({ ...data, createdBy: a.user.id });
            dbId = Number(result.insertId);
            created++;
            dbIdByStudio.set(task.id, dbId);
            sharedTaskIds.push(dbId);
            dependencyTaskIds.push(dbId);
          } else {
            const oldEmployees = currentAssignees
              .filter(row => row.taskId === existing.id)
              .map(row => row.employeeId)
              .sort((a, b) => a - b);
            const nextEmployees = [...item.employeeIds].sort((a, b) => a - b);
            const datesChanged =
              existing.startDate !== data.startDate ||
              existing.endDate !== data.endDate;
            const assigneesChanged =
              JSON.stringify(oldEmployees) !== JSON.stringify(nextEmployees);
            if (
              datesChanged ||
              currentSetting?.isMilestone !== taskSettingValues.isMilestone
            )
              dependencyTaskIds.push(existing.id);
            writeAssignees = assigneesChanged;
            if (
              datesChanged ||
              existing.statusId !== data.statusId ||
              assigneesChanged
            )
              sharedTaskIds.push(existing.id);
            const changed =
              existing.parentId !== parentId ||
              existing.name !== data.name ||
              existing.statusId !== data.statusId ||
              datesChanged ||
              existing.priority !== data.priority ||
              existing.level !== data.level ||
              assigneesChanged ||
              scheduleChanged;
            if (changed) {
              await tx
                .update(s.projectTasks)
                .set({ ...data, version: existing.version + 1 })
                .where(eq(s.projectTasks.id, existing.id));
              updated++;
            }
          }
          if (writeAssignees) {
            await tx
              .delete(s.taskAssignees)
              .where(eq(s.taskAssignees.taskId, dbId!));
            await tx
              .insert(s.taskAssignees)
              .values(
                item.employeeIds.map(employeeId => ({
                  taskId: dbId!,
                  employeeId,
                }))
              );
          }
          if (scheduleChanged) {
            const values = {
              ...taskSettingValues,
              version: (currentSetting?.version ?? 0) + 1,
            };
            await tx
              .insert(s.ganttTaskSettings)
              .values({ taskId: dbId!, ...values })
              .onDuplicateKeyUpdate({ set: values });
          }
        }

        const normalizedLinks: typeof input.state.links = [];
        const dependencyLinkIds: number[] = [];
        for (const link of input.state.links) {
          const fromTaskId = dbIdByStudio.get(link.from),
            toTaskId = dbIdByStudio.get(link.to);
          if (!fromTaskId || !toTaskId)
            invalid("تعذر ربط العلاقة بمهام المشروع");
          const original = internalByKey.get(
            `${fromTaskId}|${toTaskId}|${link.type}`
          );
          let id: number;
          if (original) {
            id = original.id;
            if (original.lagDays !== link.lag) {
              await tx
                .update(s.ganttTaskLinks)
                .set({ lagDays: link.lag, version: original.version + 1 })
                .where(eq(s.ganttTaskLinks.id, id));
              dependencyLinkIds.push(id);
            }
          } else {
            const [result] = await tx.insert(s.ganttTaskLinks).values({
              projectId: input.projectId,
              fromTaskId,
              toTaskId,
              type: link.type,
              lagDays: link.lag,
              createdBy: a.user.id,
            });
            id = Number(result.insertId);
            dependencyLinkIds.push(id);
          }
          normalizedLinks.push({
            ...link,
            id: `L${id}`,
            from: `T${fromTaskId}`,
            to: `T${toTaskId}`,
            pmLinkId: id,
          });
        }
        const [settingsRow] = await tx
          .select()
          .from(s.ganttProjectSettings)
          .where(eq(s.ganttProjectSettings.projectId, input.projectId))
          .for("update");
        const settingValues = {
          workingDays: JSON.stringify(input.state.calendar.workingDays),
          hoursPerDay: input.state.calendar.hoursPerDay,
          holidays: JSON.stringify(input.state.calendar.holidays),
          mode: input.state.project.mode,
          statusDate: input.state.project.statusDate,
          deadline: input.state.project.deadline,
          version: (settingsRow?.version ?? 0) + 1,
          updatedAt: new Date(),
        };
        await tx
          .insert(s.ganttProjectSettings)
          .values({ projectId: input.projectId, ...settingValues })
          .onDuplicateKeyUpdate({ set: settingValues });

        if (dependencyLinkIds.length) {
          const graph = await tx
            .select({
              fromTaskId: s.ganttTaskLinks.fromTaskId,
              toTaskId: s.ganttTaskLinks.toTaskId,
            })
            .from(s.ganttTaskLinks)
            .for("update");
          assertAcyclicLinks(graph);
        }
        const affectedProjects = await propagateScheduleChanges(
          tx,
          {
            sharedTaskIds,
            dependencyTaskIds,
            dependencyLinkIds,
            editorCalendar: {
              projectId: input.projectId,
              mode: input.state.project.mode,
              calendar: ganttCalendar,
            },
          },
          a
        );
        await touchGanttStudioStates(
          tx,
          affectedProjects.filter(id => id !== input.projectId),
          a.user.id
        );
        const freshTasks = await tx
          .select()
          .from(s.projectTasks)
          .where(eq(s.projectTasks.projectId, input.projectId));
        const freshById = new Map(freshTasks.map(task => [task.id, task]));
        const freshAssignees = await tx
          .select({
            taskId: s.taskAssignees.taskId,
            employeeId: s.taskAssignees.employeeId,
          })
          .from(s.taskAssignees)
          .innerJoin(
            s.projectTasks,
            eq(s.projectTasks.id, s.taskAssignees.taskId)
          )
          .where(eq(s.projectTasks.projectId, input.projectId));
        const assigneesByTask = new Map<number, number[]>();
        for (const { taskId, employeeId } of freshAssignees) {
          const list = assigneesByTask.get(taskId) ?? [];
          list.push(employeeId);
          assigneesByTask.set(taskId, list);
        }
        const normalizedTasks = input.state.tasks.map(task => {
          const dbId = dbIdByStudio.get(task.id)!;
          const row = freshById.get(dbId)!;
          const employeeIds = assigneesByTask.get(dbId) ?? [];
          const statusCode =
            statusById.get(row.statusId)?.code ?? "not_started";
          const status = projectStatusToStudio(statusCode);
          return {
            ...task,
            id: `T${dbId}`,
            parentId: task.parentId
              ? `T${dbIdByStudio.get(task.parentId)!}`
              : null,
            phase:
              row.level === 1 ? "مهمة رئيسية" : `مستوى فرعي ${row.level - 1}`,
            owner: employeeIds.map(id => employeeById.get(id)!.name).join("، "),
            start: row.startDate,
            duration: ganttCalendar.duration(
              row.startDate,
              row.endDate,
              task.duration === 0
            ),
            pmTaskId: dbId,
            pmVersion: row.version,
            pmStatusId: row.statusId,
            pmStatusCode: statusCode,
            executionStatus: status,
            status,
            progress: status === "completed" ? 100 : 0,
            pmPriority: row.priority as "critical" | "high" | "medium" | "low",
            pmEmployeeIds: employeeIds,
            startLocked:
              task.startLocked ??
              taskSettingsById.get(dbId)?.startLocked ??
              false,
            endLocked:
              task.endLocked ?? taskSettingsById.get(dbId)?.endLocked ?? false,
          };
        });
        const normalizedState = {
          ...input.state,
          project: {
            ...input.state.project,
            id: project.number,
            name: project.name,
            description: project.description,
          },
          tasks: normalizedTasks,
          links: normalizedLinks,
          baseline: remapBaselineTaskIds(input.state.baseline, dbIdByStudio),
        };
        const values = {
          stateJson: JSON.stringify(normalizedState),
          version: input.version + 1,
          updatedBy: a.user.id,
          updatedAt: new Date(),
        };
        if (
          Buffer.byteLength(values.stateJson, "utf8") > MAX_STUDIO_STATE_BYTES
        )
          invalid("حجم مخطط Gantt أكبر من الحد المسموح");
        await tx
          .insert(s.ganttStudioStates)
          .values({ projectId: input.projectId, ...values })
          .onDuplicateKeyUpdate({ set: values });
        await assertApprovedRequisitionDates(tx, [
          input.projectId,
          ...affectedProjects,
        ]);
        await recordChange(tx, {
          actorId: a.user.id,
          action: "gantt.studio.saved",
          entityType: "pm_project",
          entityId: input.projectId,
          before: current ? { version: current.version } : undefined,
          after: {
            version: values.version,
            tasks: normalizedTasks.length,
            links: normalizedLinks.length,
            created,
            updated,
            deleted: deleted.length,
          },
        });
        return {
          id: input.projectId,
          version: values.version,
          state: normalizedState,
          remapped: [...dbIdByStudio].some(
            ([studioId, dbId]) => studioId !== `T${dbId}`
          ),
        };
      }
    );
  });
}

export async function saveSettings(
  input: z.infer<typeof ganttSettingsInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "gantt.settings.save", input.key, input, async () => {
      await assertConstructionAccess(a, input.projectId, tx);
      const [current] = await tx
        .select()
        .from(s.ganttProjectSettings)
        .where(eq(s.ganttProjectSettings.projectId, input.projectId))
        .for("update");
      if ((current?.version ?? 0) !== input.version)
        throw new DomainError("CONFLICT");
      const values = {
        workingDays: JSON.stringify(input.workingDays),
        hoursPerDay: input.hoursPerDay,
        holidays: JSON.stringify(input.holidays),
        mode: input.mode,
        statusDate: input.statusDate,
        deadline: input.deadline,
        version: input.version + 1,
        updatedAt: new Date(),
      };
      await tx
        .insert(s.ganttProjectSettings)
        .values({ projectId: input.projectId, ...values })
        .onDuplicateKeyUpdate({ set: values });
      await touchGanttStudioStates(tx, [input.projectId], a.user.id);
      await recordChange(tx, {
        actorId: a.user.id,
        action: "gantt.settings.saved",
        entityType: "pm_project",
        entityId: input.projectId,
        before: current,
        after: values,
      });
      return { id: input.projectId };
    })
  );
}

export async function saveLink(
  input: z.infer<typeof ganttLinkInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "gantt.link.save", input.key, input, async () => {
      const affected = new Set<number>();
      const [current] = input.id
        ? await tx
            .select()
            .from(s.ganttTaskLinks)
            .where(eq(s.ganttTaskLinks.id, input.id))
            .for("update")
        : [];
      if (input.id && !current) throw new DomainError("NOT_FOUND");
      if (current) {
        const originalTasks = await tx
          .select({ projectId: s.projectTasks.projectId })
          .from(s.projectTasks)
          .where(
            inArray(s.projectTasks.id, [current.fromTaskId, current.toTaskId])
          )
          .for("update");
        if (originalTasks.length !== 2) throw new DomainError("NOT_FOUND");
        affected.add(current.projectId);
        for (const task of originalTasks) affected.add(task.projectId);
        for (const projectId of affected)
          await assertConstructionAccess(a, projectId, tx);
        if (current.version !== input.version)
          throw new DomainError("CONFLICT");
      }
      if (input.action === "delete") {
        if (!current) invalid("معرّف العلاقة مطلوب");
        await tx
          .delete(s.ganttTaskLinks)
          .where(eq(s.ganttTaskLinks.id, current.id));
        await touchGanttStudioStates(tx, affected, a.user.id);
        return { id: current.id };
      }

      if (input.fromTaskId === input.toTaskId)
        invalid("لا يمكن ربط المهمة بنفسها");
      const taskRows = await tx
        .select()
        .from(s.projectTasks)
        .where(inArray(s.projectTasks.id, [input.fromTaskId, input.toTaskId]))
        .for("update");
      if (taskRows.length !== 2) invalid("إحدى المهمتين غير موجودة");
      for (const projectId of new Set(taskRows.map(task => task.projectId))) {
        await assertConstructionAccess(a, projectId, tx);
        affected.add(projectId);
      }
      const target = taskRows.find(task => task.id === input.toTaskId)!;
      const currentLinks = await tx
        .select()
        .from(s.ganttTaskLinks)
        .for("update");
      const otherLinks = currentLinks.filter(link => link.id !== current?.id);
      if (
        otherLinks.some(
          link =>
            link.fromTaskId === input.fromTaskId &&
            link.toTaskId === input.toTaskId &&
            link.type === input.type
        )
      )
        invalid("هذه العلاقة مسجلة مسبقًا");
      const fields = {
        projectId: target.projectId,
        fromTaskId: input.fromTaskId,
        toTaskId: input.toTaskId,
        type: input.type,
        lagDays: input.lagDays,
      };
      assertAcyclicLinks([...otherLinks, fields]);
      let id: number;
      if (current) {
        await tx
          .update(s.ganttTaskLinks)
          .set({ ...fields, version: current.version + 1 })
          .where(eq(s.ganttTaskLinks.id, current.id));
        id = current.id;
      } else {
        const [result] = await tx.insert(s.ganttTaskLinks).values({
          ...fields,
          createdBy: a.user.id,
        });
        id = Number(result.insertId);
      }
      for (const projectId of await propagateScheduleChanges(
        tx,
        { sharedTaskIds: [], dependencyTaskIds: [], dependencyLinkIds: [id] },
        a
      ))
        affected.add(projectId);
      await touchGanttStudioStates(tx, affected, a.user.id);
      return { id };
    })
  );
}

export async function saveSchedule(
  input: z.infer<typeof ganttScheduleInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "gantt.schedule.save", input.key, input, async () => {
      await assertConstructionAccess(a, input.projectId, tx);
      await lockRequisitionSourceProjects(tx, [input.projectId]);
      const existing = await tx
        .select()
        .from(s.projectTasks)
        .where(eq(s.projectTasks.projectId, input.projectId))
        .for("update");
      const byId = new Map(existing.map(task => [task.id, task]));
      const settings = await tx
        .select()
        .from(s.ganttTaskSettings)
        .where(
          inArray(
            s.ganttTaskSettings.taskId,
            input.updates.map(update => update.taskId)
          )
        )
        .for("update");
      const settingsByTask = new Map(settings.map(row => [row.taskId, row]));
      const movedTasks: number[] = [];
      const seenTasks = new Set<number>();
      const nextDates = new Map(
        existing.map(task => [
          task.id,
          { startDate: task.startDate, endDate: task.endDate },
        ])
      );
      for (const update of input.updates) {
        const task = byId.get(update.taskId);
        if (!task) invalid("مهمة غير موجودة في المشروع");
        if (task.version !== update.version) throw new DomainError("CONFLICT");
        if (update.startDate > update.endDate)
          invalid("تاريخ بداية المهمة يجب ألا يتجاوز تاريخ نهايتها");
        assertTaskDateLocks(task, update, settingsByTask.get(task.id));
        if (seenTasks.has(task.id)) invalid("تحديثات المهمة مكررة");
        seenTasks.add(task.id);
        if (
          update.startDate !== task.startDate ||
          update.endDate !== task.endDate
        )
          movedTasks.push(task.id);
        nextDates.set(task.id, {
          startDate: update.startDate,
          endDate: update.endDate,
        });
      }
      for (const task of existing) {
        if (!task.parentId) continue;
        const child = nextDates.get(task.id)!;
        const parent = nextDates.get(task.parentId);
        if (
          !parent ||
          child.startDate < parent.startDate ||
          child.endDate > parent.endDate
        )
          invalid(
            `تواريخ المهمة «${task.name}» يجب أن تقع داخل مدة المهمة الأم`
          );
      }
      for (const update of input.updates) {
        const task = byId.get(update.taskId)!;
        await tx
          .update(s.projectTasks)
          .set({
            startDate: update.startDate,
            endDate: update.endDate,
            version: task.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(s.projectTasks.id, task.id));
        await tx
          .insert(s.ganttTaskSettings)
          .values({
            taskId: task.id,
            notBefore: update.notBefore,
            isMilestone: update.isMilestone,
            version: 1,
          })
          .onDuplicateKeyUpdate({
            set: {
              notBefore: update.notBefore,
              isMilestone: update.isMilestone,
              version: (settingsByTask.get(task.id)?.version ?? 0) + 1,
            },
          });
      }
      await recordChange(tx, {
        actorId: a.user.id,
        action: "gantt.schedule.saved",
        entityType: "pm_project",
        entityId: input.projectId,
        after: input.updates,
      });
      const affected = await propagateScheduleChanges(
        tx,
        { sharedTaskIds: movedTasks, dependencyTaskIds: movedTasks },
        a
      );
      await enforceProjectBounds(tx, input.projectId, a);
      await touchGanttStudioStates(
        tx,
        [input.projectId, ...affected],
        a.user.id
      );
      return { id: input.projectId };
    })
  );
}

export async function captureBaseline(
  input: z.infer<typeof ganttBaselineInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      a.user.id,
      "gantt.baseline.capture",
      input.key,
      input,
      async () => {
        await assertConstructionAccess(a, input.projectId, tx);
        const tasks = await tx
          .select()
          .from(s.projectTasks)
          .where(eq(s.projectTasks.projectId, input.projectId));
        if (!tasks.length) invalid("لا توجد مهام لحفظ خط أساس");
        const [result] = await tx.insert(s.ganttBaselines).values({
          projectId: input.projectId,
          name: input.name,
          createdBy: a.user.id,
        });
        const id = Number(result.insertId);
        await tx.insert(s.ganttBaselineTasks).values(
          tasks.map(task => ({
            baselineId: id,
            taskId: task.id,
            taskName: task.name,
            startDate: task.startDate,
            endDate: task.endDate,
            durationDays: Math.max(
              1,
              Math.round(
                (Date.parse(task.endDate) - Date.parse(task.startDate)) /
                  86400000
              ) + 1
            ),
          }))
        );
        await recordChange(tx, {
          actorId: a.user.id,
          action: "gantt.baseline.captured",
          entityType: "pm_gantt_baseline",
          entityId: id,
          after: { projectId: input.projectId, name: input.name },
        });
        return { id };
      }
    )
  );
}
