import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as s from "../../../drizzle/construction";
import { ganttStudioStateInput } from "../../../shared/gantt";
import type { AccessContext } from "../../core/policy";
import { saveStudioState } from "./service";

const statusCodes = ["not_started", "working", "done", "cancelled"];

const fixture = vi.hoisted(() => ({
  tasks: new Map<number, Partial<typeof s.projectTasks.$inferSelect>>(),
  settings: new Map<number, typeof s.ganttTaskSettings.$inferInsert>(),
  project: {
    actualStartDate: null as string | null,
    actualEndDate: null as string | null,
    version: 0,
  },
  studioVersion: 0,
  workCalendar: null as Pick<
    typeof s.pmWorkCalendar.$inferSelect,
    "weeklyDaysOff" | "holidays" | "version"
  > | null,
}));

function read(table: unknown, projection?: Record<string, unknown>) {
  if (table === s.constructionProjects)
    return [
      {
        id: 1,
        status: "active",
        number: "PRJ-1",
        name: "Project",
        description: "",
        plannedStartDate: "2026-11-16",
        plannedEndDate: "2026-11-19",
        ...fixture.project,
      },
    ];
  if (table === s.ganttStudioStates)
    return [{ version: fixture.studioVersion }];
  if (table === s.pmWorkCalendar)
    return fixture.workCalendar ? [fixture.workCalendar] : [];
  if (table === s.employees) return [{ id: 1, name: "Employee", active: true }];
  if (table === s.taskStatuses)
    return statusCodes.map((code, index) => ({
      id: index + 1,
      code,
    }));
  if (table === s.taskAssignees)
    return [...fixture.tasks.keys()].map(taskId => ({ taskId, employeeId: 1 }));
  if (table === s.ganttTaskSettings)
    return [...fixture.settings.values()].map(settings => ({ settings }));
  if (table === s.projectTasks)
    return [...fixture.tasks].map(([id, task]) => {
      const settings = fixture.settings.get(id);
      const dates = {
        actualStartDate: settings?.actualStartDate ?? null,
        actualEndDate: settings?.actualEndDate ?? null,
      };
      if (projection?.task) return { task, ...dates };
      if (projection?.settingsVersion)
        return {
          id,
          projectId: 1,
          parentId: task.parentId,
          statusCode: statusCodes[(task.statusId ?? 1) - 1],
          settingsVersion: settings?.version ?? null,
          ...dates,
        };
      return task;
    });
  return [];
}

vi.mock("../../core/database", () => ({
  database: async () => ({
    transaction: (run: (tx: unknown) => unknown) =>
      run({
        select: (projection?: Record<string, unknown>) => ({
          from: (table: unknown) => {
            const results = () => read(table, projection);
            const query = {
              innerJoin: () => query,
              leftJoin: () => query,
              where: () => query,
              orderBy: () => query,
              for: async () => results(),
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(results()).then(resolve),
            };
            return query;
          },
        }),
        update: (table: unknown) => ({
          set: (values: Partial<typeof s.projectTasks.$inferSelect>) => ({
            where: (filter: SQL) => {
              const id = Number(
                new MySqlDialect().sqlToQuery(filter).params[0]
              );
              if (table === s.constructionProjects)
                Object.assign(fixture.project, values);
              if (table === s.projectTasks)
                fixture.tasks.set(id, { ...fixture.tasks.get(id), ...values });
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: typeof s.ganttTaskSettings.$inferInsert) => ({
            onDuplicateKeyUpdate: () => {
              if (table === s.ganttTaskSettings)
                fixture.settings.set(values.taskId, {
                  ...fixture.settings.get(values.taskId),
                  ...values,
                });
              if (table === s.ganttStudioStates)
                fixture.studioVersion = values.version!;
            },
          }),
        }),
      }),
  }),
}));
vi.mock("../../core/idempotency", () => ({
  once: (
    _tx: unknown,
    _actor: unknown,
    _action: unknown,
    _key: unknown,
    _input: unknown,
    run: () => unknown
  ) => run(),
}));
vi.mock("../../core/policy", () => ({
  assertConstructionAccess: async () => {},
}));
vi.mock("../../core/audit", () => ({ recordChange: async () => {} }));
vi.mock("../material-requisitions/schedule-guards", () => ({
  assertDraftRequisitionSourceStarts: async () => {},
}));
vi.mock("./studio-state", () => ({ touchGanttStudioStates: async () => {} }));
vi.mock("./scheduling", async importOriginal => ({
  ...(await importOriginal<typeof import("./scheduling")>()),
  propagateScheduleChanges: async () => [],
}));

afterEach(() => vi.useRealTimers());
beforeEach(() => {
  fixture.tasks.clear();
  fixture.settings.clear();
  Object.assign(fixture.project, {
    actualStartDate: null,
    actualEndDate: null,
    version: 0,
  });
  fixture.studioVersion = 0;
  fixture.workCalendar = null;
});

it("rolls up descendant execution dates and excludes cancelled tasks from ancestors and the project", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const plannedStart = "2026-11-16";
  const plannedEnd = "2026-11-19";
  for (const [id, parentId, name, level] of [
    [1, null, "Parent", 1],
    [2, 1, "Nested parent", 2],
    [3, 2, "Child", 3],
    [4, 2, "Cancelled sibling", 3],
  ] as const) {
    fixture.tasks.set(id, {
      id,
      parentId,
      name,
      statusId: 1,
      startDate: plannedStart,
      endDate: plannedEnd,
      priority: "medium",
      level,
      version: 0,
    });
  }
  const save = (
    status: "in_progress" | "completed",
    now: string,
    { edited = false, cancelled = false, duration = 4 } = {}
  ) => {
    vi.setSystemTime(new Date(now));
    return saveStudioState(
      ganttStudioStateInput.parse({
        key: randomUUID(),
        projectId: 1,
        version: fixture.studioVersion,
        state: {
          schemaVersion: 2,
          completionModel: "leaf-count-v1",
          project: {
            id: "PRJ-1",
            name: "Project",
            description: "",
            start: plannedStart,
            statusDate: plannedStart,
            deadline: null,
            mode: "smart",
          },
          calendar: {
            workingDays: [0, 1, 2, 3, 4],
            hoursPerDay: 8,
            holidays: [],
          },
          links: [],
          activity: [],
          tasks: [...fixture.tasks].map(([id, task]) => ({
            id: `T${id}`,
            parentId: task.parentId ? `T${task.parentId}` : null,
            name: id === 3 && edited ? "Renamed child" : task.name,
            duration: id === 3 ? duration : 4,
            phase: "Implementation",
            owner: "Employee",
            progress: 0,
            start: plannedStart,
            notBefore: null,
            notes: "",
            executionStatus: id === 3 ? status : "not_started",
            status:
              id === 3
                ? status
                : id === 4
                  ? "not_started"
                  : cancelled
                    ? "completed"
                    : "in_progress",
            pmStatusCode: id === 4 && cancelled ? "cancelled" : undefined,
            pmVersion: task.version,
            actualStart: "2020-01-01",
            actualEnd: "2020-01-02",
          })),
        },
      }),
      { user: { id: 1 } } as AccessContext
    );
  };

  const started = await save("in_progress", "2026-11-16T21:15:00Z");
  for (const task of started.state.tasks.slice(0, 3)) {
    expect(task.actualStart).toBe("2026-11-17");
    expect(task.actualEnd).toBeNull();
  }
  expect(fixture.project.actualStartDate).toBe("2026-11-17");
  const edited = await save("in_progress", "2026-11-18T12:00:00Z", {
    edited: true,
  });
  expect(edited.state.tasks[2].name).toBe("Renamed child");
  for (const task of edited.state.tasks.slice(0, 3))
    expect(task.actualStart).toBe("2026-11-17");

  const pending = await save("completed", "2026-11-22T12:00:00Z");
  expect(pending.state.tasks.map(task => task.actualEnd)).toEqual([
    null,
    null,
    "2026-11-22",
    null,
  ]);
  expect(fixture.project.actualEndDate).toBeNull();
  for (const timestamp of ["2026-11-24T12:00:00Z", "2026-11-25T12:00:00Z"]) {
    const completed = await save("completed", timestamp, { cancelled: true });
    for (const task of completed.state.tasks.slice(0, 3)) {
      expect(task.actualStart).toBe("2026-11-17");
      expect(task.actualEnd).toBe("2026-11-22");
      expect(task.progress).toBe(100);
    }
    expect(completed.state.tasks[3].pmStatusCode).toBe("cancelled");
    expect(fixture.project.actualEndDate).toBe("2026-11-22");
  }

  const version = fixture.studioVersion;
  const parentSettings = fixture.settings.get(1)!;
  fixture.settings.set(1, { ...parentSettings, endLocked: true });
  await expect(
    save("completed", "2026-11-26T12:00:00Z", {
      cancelled: true,
      duration: 5,
    })
  ).rejects.toThrow("لا يمكن تمديد نهاية المهمة الأم «Parent» لأنها مقفلة");
  expect(fixture.studioVersion).toBe(version);
  expect(fixture.tasks.get(1)?.endDate).toBe(plannedEnd);
  expect(fixture.tasks.get(2)?.endDate).toBe(plannedEnd);
  expect(fixture.tasks.get(3)?.endDate).toBe(plannedEnd);
});

it("keeps approved dates and schedules edits with the current central calendar", async () => {
  fixture.workCalendar = {
    version: 2,
    weeklyDaysOff: [5, 6],
    holidays: [
      {
        name: "Annual holiday",
        startDate: "2026-11-17",
        endDate: "2026-11-17",
      },
    ],
  };
  fixture.tasks.set(1, {
    id: 1,
    parentId: null,
    name: "Task",
    statusId: 1,
    startDate: "2026-11-16",
    endDate: "2026-11-19",
    priority: "medium",
    level: 1,
    version: 0,
  });

  const save = (duration: number, calendarRevision?: number) =>
    saveStudioState(
      ganttStudioStateInput.parse({
        key: randomUUID(),
        projectId: 1,
        version: fixture.studioVersion,
        calendarRevision,
        state: {
          schemaVersion: 2,
          completionModel: "leaf-count-v1",
          project: {
            id: "PRJ-1",
            name: "Project",
            description: "",
            start: "2026-11-16",
            statusDate: "2026-11-16",
            deadline: null,
            mode: "smart",
          },
          calendar: {
            workingDays: [0, 1, 2, 3, 4],
            hoursPerDay: 6,
            holidays: [],
          },
          tasks: [
            {
              id: "T1",
              parentId: null,
              name: "Task",
              duration,
              phase: "Implementation",
              owner: "Employee",
              progress: 0,
              start: "2026-11-16",
              notBefore: null,
              notes: "",
              executionStatus: "not_started",
              pmVersion: fixture.tasks.get(1)?.version,
            },
          ],
          links: [],
          activity: [],
        },
      }),
      { user: { id: 1 } } as AccessContext
    );

  await expect(save(2)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(fixture.studioVersion).toBe(0);
  await expect(save(3, 2)).resolves.toMatchObject({
    state: {
      calendar: {
        hoursPerDay: 6,
        holidays: [{ date: "2026-11-17", name: "Annual holiday" }],
      },
      tasks: [{ start: "2026-11-16", duration: 3 }],
    },
  });
  expect(fixture.tasks.get(1)?.endDate).toBe("2026-11-19");
  await save(2, 2);
  expect(fixture.tasks.get(1)?.endDate).toBe("2026-11-18");
});
