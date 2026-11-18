import { randomUUID } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as s from "../../../drizzle/construction";
import { ganttStudioStateInput } from "../../../shared/gantt";
import type { AccessContext } from "../../core/policy";
import { saveStudioState } from "./service";

const fixture = vi.hoisted(() => ({
  tasks: new Map<number, Partial<typeof s.projectTasks.$inferSelect>>(),
  settings: new Map<number, typeof s.ganttTaskSettings.$inferInsert>(),
  studioVersion: 0,
  workCalendar: null as Pick<
    typeof s.pmWorkCalendar.$inferSelect,
    "weeklyDaysOff" | "holidays" | "version"
  > | null,
}));

function read(table: unknown, withActualDates: boolean) {
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
      },
    ];
  if (table === s.ganttStudioStates)
    return [{ version: fixture.studioVersion }];
  if (table === s.pmWorkCalendar)
    return fixture.workCalendar ? [fixture.workCalendar] : [];
  if (table === s.employees) return [{ id: 1, name: "Employee", active: true }];
  if (table === s.taskStatuses)
    return ["not_started", "working", "done"].map((code, index) => ({
      id: index + 1,
      code,
    }));
  if (table === s.taskAssignees)
    return [...fixture.tasks.keys()].map(taskId => ({ taskId, employeeId: 1 }));
  if (table === s.ganttTaskSettings)
    return [...fixture.settings.values()].map(settings => ({ settings }));
  if (table === s.projectTasks)
    return [...fixture.tasks].map(([id, task]) =>
      withActualDates
        ? {
            task,
            actualStartDate: fixture.settings.get(id)?.actualStartDate ?? null,
            actualEndDate: fixture.settings.get(id)?.actualEndDate ?? null,
          }
        : task
    );
  return [];
}

vi.mock("../../core/database", () => ({
  database: async () => ({
    transaction: (run: (tx: unknown) => unknown) =>
      run({
        select: (projection?: Record<string, unknown>) => ({
          from: (table: unknown) => {
            const results = () => read(table, Boolean(projection?.task));
            const query = {
              innerJoin: () => query,
              leftJoin: () => query,
              where: () => query,
              for: async () => results(),
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(results()).then(resolve),
            };
            return query;
          },
        }),
        update: () => ({
          set: (values: Partial<typeof s.projectTasks.$inferSelect>) => ({
            where: (filter: SQL) => {
              const id = Number(
                new MySqlDialect().sqlToQuery(filter).params[0]
              );
              fixture.tasks.set(id, { ...fixture.tasks.get(id), ...values });
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: typeof s.ganttTaskSettings.$inferInsert) => ({
            onDuplicateKeyUpdate: () => {
              if (table === s.ganttTaskSettings)
                fixture.settings.set(values.taskId, values);
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
  fixture.studioVersion = 0;
  fixture.workCalendar = null;
});

it("stamps persisted parent and child status transitions and ignores dates supplied by Studio", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const plannedStart = "2026-11-16";
  const plannedEnd = "2026-11-19";
  for (const id of [1, 2]) {
    fixture.tasks.set(id, {
      id,
      parentId: id === 1 ? null : 1,
      name: id === 1 ? "Parent" : "Child",
      statusId: 1,
      startDate: plannedStart,
      endDate: plannedEnd,
      priority: "medium",
      level: id,
      version: 0,
    });
  }
  const save = (
    status: "in_progress" | "completed",
    now: string,
    edited = false
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
            parentId: id === 1 ? null : "T1",
            name: id === 2 && edited ? "Renamed child" : task.name,
            duration: 4,
            phase: "Implementation",
            owner: "Employee",
            progress: 0,
            start: plannedStart,
            notBefore: null,
            notes: "",
            executionStatus: id === 1 ? "not_started" : status,
            status,
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
  for (const task of started.state.tasks) {
    expect(task.actualStart).toBe("2026-11-17");
    expect(task.actualEnd).toBeNull();
  }
  const edited = await save("in_progress", "2026-11-18T12:00:00Z", true);
  expect(edited.state.tasks[1].name).toBe("Renamed child");
  for (const task of edited.state.tasks)
    expect(task.actualStart).toBe("2026-11-17");

  for (const timestamp of ["2026-11-22T12:00:00Z", "2026-11-24T12:00:00Z"]) {
    const completed = await save("completed", timestamp);
    for (const task of completed.state.tasks) {
      expect(task.actualStart).toBe("2026-11-17");
      expect(task.actualEnd).toBe("2026-11-22");
      expect(task.progress).toBe(100);
    }
  }
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
