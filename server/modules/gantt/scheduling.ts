import { eq, inArray } from "drizzle-orm";
import * as s from "../../../drizzle/construction";
import { ganttDate, type GanttCalendar } from "../../../shared/gantt";
import type { Transaction } from "../../core/database";
import {
  assertConstructionAccess,
  type AccessContext,
} from "../../core/policy";
import { TRPCError } from "@trpc/server";
import {
  assertApprovedRequisitionDates,
  lockRequisitionSourceProjects,
} from "../material-requisitions/schedule-guards";

const DAY = 86_400_000;
export function shiftIso(date: string, days: number) {
  const result = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
  if (!ganttDate(result)) blocked("التاريخ خارج نطاق الجدولة المدعوم");
  return result;
}
export function calendarDays(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY
  );
}

function blocked(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

type TaskDates = Pick<
  typeof s.projectTasks.$inferSelect,
  "startDate" | "endDate"
>;
type TaskLocks = Pick<
  typeof s.ganttTaskSettings.$inferSelect,
  "startLocked" | "endLocked"
>;

export function lockedTaskDateChanged(
  current: TaskDates,
  next: TaskDates,
  locks: TaskLocks | null | undefined
) {
  return Boolean(
    (locks?.startLocked && current.startDate !== next.startDate) ||
      (locks?.endLocked && current.endDate !== next.endDate)
  );
}

type ScheduleEffects = { dateTaskIds: number[]; projectIds: number[] };
const noChanges: ScheduleEffects = { dateTaskIds: [], projectIds: [] };

/** Propagate the synchronized fields of one shared task to every linked copy atomically. */
async function synchronizeSharedTask(
  tx: Transaction,
  sourceTaskId: number,
  a: AccessContext,
  includeStatusAndAssignees: boolean
): Promise<ScheduleEffects> {
  const [membership] = await tx
    .select()
    .from(s.ganttSharedTaskMembers)
    .where(eq(s.ganttSharedTaskMembers.taskId, sourceTaskId))
    .for("update");
  if (!membership) return noChanges;
  const [group] = await tx
    .select()
    .from(s.ganttSharedTaskGroups)
    .where(eq(s.ganttSharedTaskGroups.id, membership.groupId))
    .for("update");
  if (
    !group ||
    (!group.syncDates &&
      !(includeStatusAndAssignees && (group.syncStatus || group.syncAssignees)))
  )
    return noChanges;
  const memberProjects = await tx
    .select({ projectId: s.projectTasks.projectId })
    .from(s.ganttSharedTaskMembers)
    .innerJoin(
      s.projectTasks,
      eq(s.ganttSharedTaskMembers.taskId, s.projectTasks.id)
    )
    .where(eq(s.ganttSharedTaskMembers.groupId, group.id));
  const projectIds = [
    ...new Set(memberProjects.map(member => member.projectId)),
  ];
  for (const projectId of projectIds)
    await assertConstructionAccess(a, projectId, tx);
  await lockRequisitionSourceProjects(tx, projectIds);
  const members = await tx
    .select({ task: s.projectTasks, settings: s.ganttTaskSettings })
    .from(s.ganttSharedTaskMembers)
    .innerJoin(
      s.projectTasks,
      eq(s.ganttSharedTaskMembers.taskId, s.projectTasks.id)
    )
    .leftJoin(
      s.ganttTaskSettings,
      eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
    )
    .where(eq(s.ganttSharedTaskMembers.groupId, group.id))
    .for("update");
  const source = members.find(row => row.task.id === sourceTaskId);
  if (!source) return noChanges;
  const newProjects = [
    ...new Set(members.map(member => member.task.projectId)),
  ].filter(projectId => !projectIds.includes(projectId));
  for (const projectId of newProjects)
    await assertConstructionAccess(a, projectId, tx);
  await lockRequisitionSourceProjects(tx, newProjects);

  const syncAssignees = includeStatusAndAssignees && group.syncAssignees;
  const assigneesByTask = new Map<number, number[]>();
  if (syncAssignees) {
    const assignees = await tx
      .select()
      .from(s.taskAssignees)
      .where(
        inArray(
          s.taskAssignees.taskId,
          members.map(member => member.task.id)
        )
      )
      .orderBy(s.taskAssignees.employeeId)
      .for("update");
    for (const assignee of assignees) {
      const ids = assigneesByTask.get(assignee.taskId) ?? [];
      ids.push(assignee.employeeId);
      assigneesByTask.set(assignee.taskId, ids);
    }
  }
  const sourcePeople = assigneesByTask.get(sourceTaskId) ?? [];
  const affectedProjects = new Set<number>();
  const dateTaskIds: number[] = [];
  for (const member of members) {
    if (member.task.id === sourceTaskId) continue;
    const datesChanged =
      group.syncDates &&
      (member.task.startDate !== source.task.startDate ||
        member.task.endDate !== source.task.endDate);
    const statusChanged =
      includeStatusAndAssignees &&
      group.syncStatus &&
      member.task.statusId !== source.task.statusId;
    const memberPeople = assigneesByTask.get(member.task.id) ?? [];
    const assigneesChanged =
      syncAssignees &&
      (memberPeople.length !== sourcePeople.length ||
        memberPeople.some((id, index) => id !== sourcePeople[index]));
    if (
      datesChanged &&
      lockedTaskDateChanged(member.task, source.task, member.settings)
    )
      blocked(
        `تعذر مزامنة المهمة «${member.task.name}» في مشروع آخر لأن تاريخها مقفل. افتح القفل أو فك ارتباط المهمة المشتركة.`
      );
    if (!datesChanged && !statusChanged && !assigneesChanged) continue;
    const update = {
      ...(datesChanged
        ? { startDate: source.task.startDate, endDate: source.task.endDate }
        : {}),
      ...(statusChanged ? { statusId: source.task.statusId } : {}),
      version: member.task.version + 1,
      updatedAt: new Date(),
    };
    await tx
      .update(s.projectTasks)
      .set(update)
      .where(eq(s.projectTasks.id, member.task.id));
    if (assigneesChanged) {
      await tx
        .delete(s.taskAssignees)
        .where(eq(s.taskAssignees.taskId, member.task.id));
      if (sourcePeople.length)
        await tx.insert(s.taskAssignees).values(
          sourcePeople.map(employeeId => ({
            taskId: member.task.id,
            employeeId,
          }))
        );
    }
    affectedProjects.add(member.task.projectId);
    if (datesChanged) dateTaskIds.push(member.task.id);
  }
  const rolledUp = new Set(dateTaskIds);
  for (const taskId of dateTaskIds)
    for (const parentId of await rollUpAncestors(tx, taskId, a, true))
      rolledUp.add(parentId);
  return { dateTaskIds: [...rolledUp], projectIds: [...affectedProjects] };
}

export async function rollUpAncestors(
  tx: Transaction,
  taskId: number,
  a: AccessContext,
  includeTask = false
) {
  const [source] = await tx
    .select({
      projectId: s.projectTasks.projectId,
      parentId: s.projectTasks.parentId,
    })
    .from(s.projectTasks)
    .where(eq(s.projectTasks.id, taskId))
    .for("update");
  if (!source || (!includeTask && !source.parentId)) return [];
  await assertConstructionAccess(a, source.projectId, tx);
  const all = await tx
    .select({ task: s.projectTasks, settings: s.ganttTaskSettings })
    .from(s.projectTasks)
    .leftJoin(
      s.ganttTaskSettings,
      eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
    )
    .where(eq(s.projectTasks.projectId, source.projectId))
    .for("update");
  const byId = new Map(all.map(row => [row.task.id, row]));
  const childrenByParent = new Map<number, (typeof all)[number]["task"][]>();
  for (const { task } of all) {
    if (task.parentId === null) continue;
    const siblings = childrenByParent.get(task.parentId) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parentId, siblings);
  }
  const changed: number[] = [];
  const visited = new Set<number>();
  let parentId = includeTask ? taskId : source.parentId;
  while (parentId !== null) {
    const parentRow = byId.get(parentId);
    if (!parentRow || visited.has(parentId)) blocked("تسلسل المهام غير صالح");
    visited.add(parentId);
    const children = childrenByParent.get(parentId) ?? [];
    const nextStart = children.reduce(
      (value, child) => (child.startDate < value ? child.startDate : value),
      parentRow.task.startDate
    );
    const nextEnd = children.reduce(
      (value, child) => (child.endDate > value ? child.endDate : value),
      parentRow.task.endDate
    );
    if (
      nextStart !== parentRow.task.startDate &&
      parentRow.settings?.startLocked
    )
      blocked(
        `لا يمكن تمديد المهمة الأم «${parentRow.task.name}» من البداية لأنها مقفلة.`
      );
    if (nextEnd !== parentRow.task.endDate && parentRow.settings?.endLocked)
      blocked(
        `لا يمكن تمديد المهمة الأم «${parentRow.task.name}» حتى ${nextEnd} لأن نهايتها مقفلة.`
      );
    if (
      nextStart !== parentRow.task.startDate ||
      nextEnd !== parentRow.task.endDate
    ) {
      await tx
        .update(s.projectTasks)
        .set({
          startDate: nextStart,
          endDate: nextEnd,
          version: parentRow.task.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.projectTasks.id, parentRow.task.id));
      parentRow.task.startDate = nextStart;
      parentRow.task.endDate = nextEnd;
      changed.push(parentId);
    }
    parentId = parentRow.task.parentId;
  }
  return changed;
}

export async function ensureTaskSettings(tx: Transaction, taskIds: number[]) {
  if (!taskIds.length) return;
  const rows = await tx
    .select()
    .from(s.ganttTaskSettings)
    .where(inArray(s.ganttTaskSettings.taskId, taskIds));
  const existing = new Set(rows.map(row => row.taskId));
  const missing = taskIds.filter(id => !existing.has(id));
  if (missing.length)
    await tx
      .insert(s.ganttTaskSettings)
      .values(missing.map(taskId => ({ taskId, version: 0 })));
}

export async function enforceProjectBounds(
  tx: Transaction,
  projectId: number,
  a: AccessContext
) {
  await assertConstructionAccess(a, projectId, tx);
  const [project] = await tx
    .select()
    .from(s.constructionProjects)
    .where(eq(s.constructionProjects.id, projectId))
    .for("update");
  if (!project) return;
  const tasks = await tx
    .select()
    .from(s.projectTasks)
    .where(eq(s.projectTasks.projectId, projectId))
    .for("update");
  if (!tasks.length) {
    await assertApprovedRequisitionDates(tx, [projectId]);
    return;
  }
  const earliest = tasks.map(task => task.startDate).sort()[0];
  const latest = tasks
    .map(task => task.endDate)
    .sort()
    .at(-1)!;
  const start = project.actualStartDate ?? project.plannedStartDate;
  const end = project.forecastEndDate ?? project.plannedEndDate;
  if (
    start &&
    earliest < start &&
    (project.startLocked || project.actualStartDate)
  )
    blocked(
      `المهام تبدأ في ${earliest} قبل بداية المشروع المقفلة ${start}. افتح القفل أو عدّل المهمة.`
    );
  if (end && latest > end && project.endLocked)
    blocked(
      `المهام تنتهي في ${latest} بعد نهاية المشروع المقفلة ${end}. مدّد المشروع أو افتح القفل.`
    );
  const update: Partial<typeof s.constructionProjects.$inferInsert> = {};
  if (start && earliest < start && !project.actualStartDate)
    update.plannedStartDate = earliest;
  if (!end || latest > end) {
    update.forecastEndDate = latest;
    update.extensionDays = project.plannedEndDate
      ? calendarDays(project.plannedEndDate, latest)
      : project.extensionDays;
  }
  if (Object.keys(update).length)
    await tx
      .update(s.constructionProjects)
      .set({ ...update, version: project.version + 1, updatedAt: new Date() })
      .where(eq(s.constructionProjects.id, project.id));
  await assertApprovedRequisitionDates(tx, [projectId]);
}

type ScheduleDependency = Pick<
  typeof s.ganttTaskLinks.$inferSelect,
  "id" | "fromTaskId" | "toTaskId" | "type" | "lagDays"
>;

type EditorCalendar = {
  projectId: number;
  mode: "smart" | "free";
  calendar: GanttCalendar;
};
type DependencyTask = TaskDates & { projectId: number; isMilestone: boolean };

export function dependencyDateMovement(
  { type, lagDays }: Pick<ScheduleDependency, "type" | "lagDays">,
  from: DependencyTask,
  to: DependencyTask,
  editor?: EditorCalendar
) {
  if (
    editor &&
    from.projectId === editor.projectId &&
    to.projectId === editor.projectId
  ) {
    if (editor.mode === "free") return null;
    const { calendar } = editor;
    const fromFinish = type.startsWith("F")
      ? calendar.duration(from.startDate, from.endDate, from.isMilestone)
      : 0;
    const toFinish = type.endsWith("F")
      ? calendar.duration(to.startDate, to.endDate, to.isMilestone)
      : 0;
    const shift =
      calendar.index(from.startDate) +
      lagDays +
      fromFinish -
      toFinish -
      calendar.index(to.startDate);
    if (shift <= 0) return null;
    return (task: TaskDates, isMilestone: boolean) => {
      const startDate = calendar.shift(task.startDate, shift);
      const duration = calendar.duration(
        task.startDate,
        task.endDate,
        isMilestone
      );
      return { startDate, endDate: calendar.finish(startDate, duration) };
    };
  }

  const required = shiftIso(
    type.startsWith("F") ? from.endDate : from.startDate,
    lagDays + (type === "FS" ? 1 : 0)
  );
  const shift = calendarDays(
    type.endsWith("S") ? to.startDate : to.endDate,
    required
  );
  if (shift <= 0) return null;
  return (task: TaskDates) => ({
    startDate: shiftIso(task.startDate, shift),
    endDate: shiftIso(task.endDate, shift),
  });
}

async function applyDependencyConstraint(
  tx: Transaction,
  link: ScheduleDependency,
  a: AccessContext,
  editor?: EditorCalendar
): Promise<ScheduleEffects> {
  const { fromTaskId, toTaskId } = link;
  const sources = await tx
    .select({ projectId: s.projectTasks.projectId })
    .from(s.projectTasks)
    .where(inArray(s.projectTasks.id, [fromTaskId, toTaskId]));
  for (const source of sources)
    await assertConstructionAccess(a, source.projectId, tx);
  await lockRequisitionSourceProjects(
    tx,
    sources.map(source => source.projectId)
  );
  const rows = await tx
    .select({
      task: s.projectTasks,
      status: s.taskStatuses.code,
      settings: s.ganttTaskSettings,
    })
    .from(s.projectTasks)
    .innerJoin(s.taskStatuses, eq(s.projectTasks.statusId, s.taskStatuses.id))
    .leftJoin(
      s.ganttTaskSettings,
      eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
    )
    .where(inArray(s.projectTasks.id, [fromTaskId, toTaskId]))
    .for("update");
  const from = rows.find(row => row.task.id === fromTaskId);
  const to = rows.find(row => row.task.id === toTaskId);
  if (!from || !to) blocked("إحدى مهام العلاقة غير موجودة");
  await assertConstructionAccess(a, from.task.projectId, tx);
  await assertConstructionAccess(a, to.task.projectId, tx);
  const sourceProjects = new Set(sources.map(source => source.projectId));
  await lockRequisitionSourceProjects(
    tx,
    [from.task.projectId, to.task.projectId].filter(
      projectId => !sourceProjects.has(projectId)
    )
  );
  const move = dependencyDateMovement(
    link,
    { ...from.task, isMilestone: from.settings?.isMilestone ?? false },
    { ...to.task, isMilestone: to.settings?.isMilestone ?? false },
    editor
  );
  if (!move) return noChanges;
  if (to.status !== "not_started")
    blocked(
      `لا يمكن إزاحة المهمة «${to.task.name}» لأنها بدأت فعليًا. عدّل العلاقة أو فكّها.`
    );
  const projectTasks = await tx
    .select({
      task: s.projectTasks,
      status: s.taskStatuses.code,
      settings: s.ganttTaskSettings,
    })
    .from(s.projectTasks)
    .innerJoin(s.taskStatuses, eq(s.projectTasks.statusId, s.taskStatuses.id))
    .leftJoin(
      s.ganttTaskSettings,
      eq(s.projectTasks.id, s.ganttTaskSettings.taskId)
    )
    .where(eq(s.projectTasks.projectId, to.task.projectId))
    .for("update");
  const childrenByParent = new Map<number, number[]>();
  for (const { task } of projectTasks) {
    if (task.parentId === null) continue;
    const children = childrenByParent.get(task.parentId) ?? [];
    children.push(task.id);
    childrenByParent.set(task.parentId, children);
  }
  const moving = new Set<number>([toTaskId]);
  for (const taskId of moving)
    for (const childId of childrenByParent.get(taskId) ?? [])
      moving.add(childId);
  const movingTasks = projectTasks
    .filter(row => moving.has(row.task.id))
    .map(row => ({
      ...row,
      dates: move(row.task, row.settings?.isMilestone ?? false),
    }));
  const blockedTasks = movingTasks.filter(
    row =>
      row.status !== "not_started" ||
      lockedTaskDateChanged(row.task, row.dates, row.settings)
  );
  if (blockedTasks.length)
    blocked(
      `تعذر تطبيق العلاقة لأن المهام التالية بدأت أو تواريخها مقفلة: ${blockedTasks.map(row => row.task.name).join("، ")}`
    );
  for (const row of movingTasks)
    await tx
      .update(s.projectTasks)
      .set({
        ...row.dates,
        version: row.task.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(s.projectTasks.id, row.task.id));
  const ancestors = await rollUpAncestors(tx, toTaskId, a);
  return {
    dateTaskIds: [...moving, ...ancestors],
    projectIds: [to.task.projectId],
  };
}

type ScheduleChanges = {
  sharedTaskIds: number[];
  dependencyTaskIds: number[];
  dependencyLinkIds?: number[];
  editorCalendar?: EditorCalendar;
};

export async function propagateTaskChanges(
  changes: ScheduleChanges,
  links: ScheduleDependency[],
  synchronize: (
    taskId: number,
    includeStatusAndAssignees: boolean
  ) => Promise<ScheduleEffects>,
  applyDependency: (link: ScheduleDependency) => Promise<ScheduleEffects>
) {
  const outgoing = new Map<number, ScheduleDependency[]>();
  for (const link of links) {
    const successors = outgoing.get(link.fromTaskId) ?? [];
    successors.push(link);
    outgoing.set(link.fromTaskId, successors);
  }
  // The value marks dates changed by propagation that may need sharing.
  const pending = new Map<number, boolean>();
  const affected = new Set<number>();
  const collect = ({ dateTaskIds, projectIds }: ScheduleEffects) => {
    for (const taskId of dateTaskIds) pending.set(taskId, true);
    for (const projectId of projectIds) affected.add(projectId);
  };
  let steps = 0;
  const visits = new Map<number, number>();
  const cannotConverge = () =>
    blocked(
      "تعذر تثبيت الجدول الزمني. راجع علاقات المهام والمجموعات المشتركة."
    );
  const countStep = () => {
    if (++steps > 25_000) cannotConverge();
  };

  for (const taskId of new Set(changes.sharedTaskIds)) {
    countStep();
    collect(await synchronize(taskId, true));
  }
  for (const taskId of changes.dependencyTaskIds)
    if (!pending.has(taskId)) pending.set(taskId, false);
  const seededLinks = new Set(changes.dependencyLinkIds);
  for (const link of links) {
    if (!seededLinks.has(link.id)) continue;
    countStep();
    collect(await applyDependency(link));
  }

  while (pending.size) {
    const [taskId, syncSharedDates] = pending.entries().next().value!;
    pending.delete(taskId);
    const visit = (visits.get(taskId) ?? 0) + 1;
    if (visit > 64) cannotConverge();
    visits.set(taskId, visit);
    if (syncSharedDates) {
      countStep();
      collect(await synchronize(taskId, false));
    }
    for (const link of outgoing.get(taskId) ?? []) {
      countStep();
      collect(await applyDependency(link));
    }
  }
  return [...affected];
}

export async function propagateScheduleChanges(
  tx: Transaction,
  changes: ScheduleChanges,
  a: AccessContext
) {
  if (
    !changes.sharedTaskIds.length &&
    !changes.dependencyTaskIds.length &&
    !changes.dependencyLinkIds?.length
  )
    return [];
  const links = await tx
    .select()
    .from(s.ganttTaskLinks)
    .orderBy(s.ganttTaskLinks.id)
    .for("update");
  const projects = await propagateTaskChanges(
    changes,
    links,
    (taskId, includeStatusAndAssignees) =>
      synchronizeSharedTask(tx, taskId, a, includeStatusAndAssignees),
    link => applyDependencyConstraint(tx, link, a, changes.editorCalendar)
  );
  for (const projectId of projects)
    await enforceProjectBounds(tx, projectId, a);
  return projects;
}
