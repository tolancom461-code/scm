import { eq, inArray } from "drizzle-orm";
import * as s from "../../../drizzle/construction";
import type { Transaction } from "../../core/database";

type ExecutionDates = {
  actualStartDate: string | null;
  actualEndDate: string | null;
};

type ExecutionTask = ExecutionDates & {
  id: number;
  parentId: number | null;
  statusCode: string;
};

type ExecutionSummary = ExecutionDates & { hasWork: boolean };

const empty: ExecutionSummary = {
  hasWork: false,
  actualStartDate: null,
  actualEndDate: null,
};

export function projectScheduleStart(project: {
  startedAt: Date | null;
  plannedStartDate: string | null;
}) {
  return (
    project.startedAt?.toISOString().slice(0, 10) ?? project.plannedStartDate
  );
}

function combine(summaries: ExecutionSummary[]): ExecutionSummary {
  const work = summaries.filter(summary => summary.hasWork);
  if (!work.length) return empty;
  const starts = work.flatMap(task => task.actualStartDate ?? []).sort();
  const ends = work.flatMap(task => task.actualEndDate ?? []).sort();
  return {
    hasWork: true,
    actualStartDate: starts[0] ?? null,
    actualEndDate: ends.length === work.length ? ends.at(-1)! : null,
  };
}

export function deriveExecutionDates(tasks: ExecutionTask[]) {
  const children = new Map<number | null, ExecutionTask[]>();
  for (const task of tasks) {
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }

  const parentDates = new Map<number, ExecutionDates>();
  function summarize(task: ExecutionTask): ExecutionSummary {
    const branches = children.get(task.id);
    if (!branches)
      return task.statusCode === "cancelled"
        ? empty
        : {
            hasWork: true,
            actualStartDate: task.actualStartDate,
            actualEndDate:
              task.statusCode === "done" ? task.actualEndDate : null,
          };

    const summary = combine(branches.map(summarize));
    const { actualStartDate, actualEndDate } =
      task.statusCode === "cancelled" ? empty : summary;
    parentDates.set(task.id, { actualStartDate, actualEndDate });
    return task.statusCode === "cancelled" ? empty : summary;
  }

  const { actualStartDate, actualEndDate } = combine(
    (children.get(null) ?? []).map(summarize)
  );
  return { projectDates: { actualStartDate, actualEndDate }, parentDates };
}

function datesChanged(current: ExecutionDates, next: ExecutionDates) {
  return (
    current.actualStartDate !== next.actualStartDate ||
    current.actualEndDate !== next.actualEndDate
  );
}

export async function rollUpExecutionDates(
  tx: Transaction,
  projectIds: number[]
) {
  const ids = [...new Set(projectIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  const projects = await tx
    .select({
      id: s.constructionProjects.id,
      version: s.constructionProjects.version,
      actualStartDate: s.constructionProjects.actualStartDate,
      actualEndDate: s.constructionProjects.actualEndDate,
    })
    .from(s.constructionProjects)
    .where(inArray(s.constructionProjects.id, ids))
    .orderBy(s.constructionProjects.id)
    .for("update");
  const tasks = await tx
    .select({
      id: s.projectTasks.id,
      projectId: s.projectTasks.projectId,
      parentId: s.projectTasks.parentId,
      statusCode: s.taskStatuses.code,
      actualStartDate: s.ganttTaskSettings.actualStartDate,
      actualEndDate: s.ganttTaskSettings.actualEndDate,
      settingsVersion: s.ganttTaskSettings.version,
    })
    .from(s.projectTasks)
    .innerJoin(s.taskStatuses, eq(s.projectTasks.statusId, s.taskStatuses.id))
    .leftJoin(
      s.ganttTaskSettings,
      eq(s.ganttTaskSettings.taskId, s.projectTasks.id)
    )
    .where(inArray(s.projectTasks.projectId, ids))
    .for("update");
  const tasksByProject = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const projectTasks = tasksByProject.get(task.projectId) ?? [];
    projectTasks.push(task);
    tasksByProject.set(task.projectId, projectTasks);
  }
  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    const { projectDates, parentDates } = deriveExecutionDates(projectTasks);
    for (const task of projectTasks) {
      const dates = parentDates.get(task.id);
      if (!dates || !datesChanged(task, dates)) continue;
      const settings = { ...dates, version: (task.settingsVersion ?? 0) + 1 };
      await tx
        .insert(s.ganttTaskSettings)
        .values({ taskId: task.id, ...settings })
        .onDuplicateKeyUpdate({ set: settings });
    }
    if (datesChanged(project, projectDates))
      await tx
        .update(s.constructionProjects)
        .set({
          ...projectDates,
          version: project.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.constructionProjects.id, project.id));
  }
}
