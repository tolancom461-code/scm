import { and, desc, eq, getTableColumns, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../../drizzle/construction";
import { taskExecutionStatus } from "../../../shared/gantt";
import { database } from "../../core/database";
import { constructionScope, type AccessContext } from "../../core/policy";

export const projectListInput = z
  .object({
    cursor: z.number().int().positive().optional(),
    pageSize: z.number().int().min(1).max(200).default(50),
  })
  .default({ pageSize: 50 });

type ProjectListTask = typeof s.projectTasks.$inferSelect & {
  statusCode: string;
  statusName: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  executionStatus: ReturnType<typeof taskExecutionStatus>;
  employeeIds: number[];
};

/** A project page and its task trees, without per-project detail queries. */
export async function projectListView(
  access: AccessContext,
  input: z.input<typeof projectListInput>
) {
  const { cursor: beforeId, pageSize } = projectListInput.parse(input);
  const db = await database();
  const page = await db
    .select()
    .from(s.constructionProjects)
    .where(
      and(
        constructionScope(access, s.constructionProjects.id),
        beforeId === undefined
          ? undefined
          : lt(s.constructionProjects.id, beforeId)
      )
    )
    .orderBy(desc(s.constructionProjects.id))
    .limit(pageSize + 1);
  const projects = page.slice(0, pageSize);
  const hasMore = page.length > pageSize;
  const nextBeforeId = hasMore ? projects.at(-1)!.id : null;
  if (!projects.length)
    return {
      projects,
      tasks: [] as ProjectListTask[],
      hasMore,
      nextBeforeId,
    };

  // Only IDs selected through constructionScope can reach these two reads.
  const projectIds = projects.map(project => project.id);
  const [tasks, assignees] = await Promise.all([
    db
      .select({
        ...getTableColumns(s.projectTasks),
        statusCode: s.taskStatuses.code,
        statusName: s.taskStatuses.name,
        actualStartDate: s.ganttTaskSettings.actualStartDate,
        actualEndDate: s.ganttTaskSettings.actualEndDate,
      })
      .from(s.projectTasks)
      .innerJoin(s.taskStatuses, eq(s.taskStatuses.id, s.projectTasks.statusId))
      .leftJoin(
        s.ganttTaskSettings,
        eq(s.ganttTaskSettings.taskId, s.projectTasks.id)
      )
      .where(inArray(s.projectTasks.projectId, projectIds))
      .orderBy(s.projectTasks.id),
    db
      .select({
        taskId: s.taskAssignees.taskId,
        employeeId: s.taskAssignees.employeeId,
      })
      .from(s.taskAssignees)
      .innerJoin(s.projectTasks, eq(s.projectTasks.id, s.taskAssignees.taskId))
      .where(inArray(s.projectTasks.projectId, projectIds)),
  ]);
  const employeesByTask = new Map<number, number[]>();
  for (const assignment of assignees) {
    const employees = employeesByTask.get(assignment.taskId) ?? [];
    employees.push(assignment.employeeId);
    employeesByTask.set(assignment.taskId, employees);
  }
  return {
    projects,
    tasks: tasks.map(task => ({
      ...task,
      executionStatus: taskExecutionStatus(task.statusCode),
      employeeIds: employeesByTask.get(task.id) ?? [],
    })),
    hasMore,
    nextBeforeId,
  };
}
