import { afterEach, describe, expect, it, vi } from "vitest";
import * as s from "../../../drizzle/construction";
import { taskInput } from "../../../shared/construction";
import { businessDate } from "../../../shared/date";
import { taskExecutionMetrics } from "../../../shared/gantt";
import type { HolidayCalendarSettings } from "../../../shared/work-calendar";
import type { AccessContext } from "../../core/policy";
import { detail, saveTask } from "./service";

const database = vi.hoisted(() => vi.fn());
vi.mock("../../core/database", () => ({ database }));
vi.mock("../../core/policy", () => ({
  assertConstructionAccess: vi
    .fn()
    .mockResolvedValue({ id: 7, status: "active" }),
  canAccess: () => true,
}));
vi.mock("../../core/idempotency", () => ({
  once: (
    _tx: unknown,
    _actor: number,
    _name: string,
    _key: string,
    _input: unknown,
    run: () => unknown
  ) => run(),
}));
vi.mock("../../core/audit", () => ({ recordChange: vi.fn() }));
vi.mock("../gantt/scheduling", () => ({
  ensureTaskSettings: vi.fn(),
  rollUpAncestors: vi.fn().mockResolvedValue([]),
  propagateScheduleChanges: vi.fn().mockResolvedValue([]),
  enforceProjectBounds: vi.fn(),
}));
vi.mock("../gantt/studio-state", () => ({ touchGanttStudioStates: vi.fn() }));

const project = { id: 7, status: "active" };
const actor = { user: { id: 1 } } as AccessContext;
const statuses = [
  { id: 1, code: "not_started" },
  { id: 2, code: "working" },
  { id: 3, code: "done" },
];
const employee = { id: 1, active: true };
const calendar = {
  workingDays: [1, 2, 3, 4, 5],
  hoursPerDay: 7,
  holidays: [{ date: "2026-11-17", name: "Office closure" }],
};

function taskFixture(
  parentId: number | null,
  globalCalendar?: HolidayCalendarSettings & { version: number }
) {
  let task = {
    id: 20,
    projectId: project.id,
    parentId,
    version: 0,
    level: parentId ? 2 : 1,
    name: parentId ? "Install unit" : "Refit",
    startDate: "2026-11-12",
    endDate: "2026-11-16",
    statusId: 1,
    priority: "medium",
  };
  const parent = {
    ...task,
    id: parentId,
    parentId: null,
    level: 1,
    name: "Refit",
    startDate: "2026-11-10",
    endDate: "2026-11-24",
    statusId: 2,
  };
  let schedule = {
    actualStartDate: null as string | null,
    actualEndDate: null as string | null,
    plannedStartDate: task.startDate,
    plannedEndDate: task.endDate,
    version: 0,
  };
  const tx = {
    select: (projection?: unknown) => ({
      from: (table: unknown) => {
        let rows: unknown[] = [];
        if (table === s.constructionProjects) rows = [project];
        if (table === s.employees) rows = [employee];
        if (table === s.taskStatuses) rows = statuses;
        if (table === s.ganttTaskSettings) rows = [schedule];
        if (table === s.projectTasks) {
          const selected = projection
            ? {
                ...task,
                ...schedule,
                version: task.version,
                statusCode: statuses[task.statusId - 1].code,
              }
            : task;
          rows = parentId ? [parent, selected] : [selected];
        }
        if (table === s.taskAssignees) {
          rows = [{ taskId: task.id, employeeId: employee.id }];
        }
        if (table === s.ganttProjectSettings) {
          rows = [
            {
              ...calendar,
              workingDays: JSON.stringify(calendar.workingDays),
              holidays: JSON.stringify(calendar.holidays),
            },
          ];
        }
        if (table === s.pmWorkCalendar && globalCalendar)
          rows = [globalCalendar];
        const query = Object.assign(Promise.resolve(rows), {
          where: () => query,
          for: () => query,
          orderBy: () => query,
          innerJoin: () => query,
          leftJoin: () => query,
        });
        return query;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === s.projectTasks) task = { ...task, ...values };
          if (table === s.ganttTaskSettings)
            schedule = { ...schedule, ...values };
        },
      }),
    }),
    delete: () => ({ where: vi.fn() }),
    insert: () => ({ values: vi.fn() }),
  };
  database.mockResolvedValue({
    ...tx,
    transaction: async (run: (transaction: typeof tx) => unknown) => run(tx),
  });
  return {
    save: (statusId: number, name = task.name) =>
      saveTask(
        taskInput.parse({
          ...task,
          key: crypto.randomUUID(),
          statusId,
          name,
          employeeIds: [employee.id],
        }),
        actor
      ),
    async read(expectedCalendar = calendar) {
      const projectDetail = await detail(project.id, actor);
      expect(projectDetail.calendar).toEqual(expectedCalendar);
      return projectDetail.tasks.find(item => item.id === task.id)!;
    },
  };
}

describe("Project task execution dates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses weekly and dated holidays from the shared calendar for existing tasks", async () => {
    const task = taskFixture(null, {
      version: 1,
      weeklyDaysOff: [5, 6],
      holidays: [
        {
          name: "Holiday",
          startDate: "2026-11-17",
          endDate: "2026-11-18",
        },
      ],
    });
    const effective = {
      workingDays: [0, 1, 2, 3, 4],
      hoursPerDay: calendar.hoursPerDay,
      holidays: [
        { name: "Holiday", date: "2026-11-17" },
        { name: "Holiday", date: "2026-11-18" },
      ],
    };
    const row = await task.read(effective);
    expect(row).toMatchObject({
      startDate: "2026-11-12",
      endDate: "2026-11-16",
    });
    expect(
      taskExecutionMetrics(row, effective, "2026-11-19").endDelayDays
    ).toBe(1);
  });

  it.each([
    { label: "main task", parentId: null },
    { label: "subtask", parentId: 10 },
  ])(
    "records and retains execution dates for a $label",
    async ({ parentId }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const task = taskFixture(parentId);
      expect(await task.read()).toMatchObject({
        executionStatus: "not_started",
        actualStartDate: null,
        actualEndDate: null,
      });

      // Both saves are on the following calendar day in Riyadh.
      vi.setSystemTime(new Date("2026-11-12T21:15:00Z"));
      await task.save(2);
      expect(await task.read()).toMatchObject({
        executionStatus: "in_progress",
        actualStartDate: "2026-11-13",
        actualEndDate: null,
      });

      vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
      await task.save(2, "Renamed task");
      const afterEdit = await task.read();
      expect(afterEdit).toMatchObject({
        name: "Renamed task",
        actualStartDate: "2026-11-13",
        actualEndDate: null,
      });
      expect(
        taskExecutionMetrics(afterEdit, calendar, businessDate())
      ).toMatchObject({
        startDelayDays: 1,
        endDelayDays: 1,
      });
      vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
      expect(
        taskExecutionMetrics(await task.read(), calendar, businessDate())
          .endDelayDays
      ).toBe(2);

      vi.setSystemTime(new Date("2026-11-19T21:15:00Z"));
      await task.save(3);
      const completed = await task.read();
      expect(completed).toMatchObject({
        executionStatus: "completed",
        actualStartDate: "2026-11-13",
        actualEndDate: "2026-11-20",
      });
      const completedMetrics = taskExecutionMetrics(
        completed,
        calendar,
        businessDate()
      );
      expect(completedMetrics).toEqual({
        startDelayDays: 1,
        endDelayDays: 3,
        progress: 100,
      });

      vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
      await task.save(3);
      const later = await task.read();
      expect(later).toMatchObject({
        actualStartDate: "2026-11-13",
        actualEndDate: "2026-11-20",
      });
      expect(taskExecutionMetrics(later, calendar, businessDate())).toEqual(
        completedMetrics
      );
    }
  );
});
