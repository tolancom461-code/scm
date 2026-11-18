import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessContext } from "../../core/policy";
import {
  portfolio,
  portfolioDirectory,
  saveProjectColor,
  saveTaskColor,
} from "./portfolio";
import { saveLink } from "./service";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  record: vi.fn(),
  touch: vi.fn(),
}));

vi.mock("../../core/database", async () => {
  const { drizzle } = await import("drizzle-orm/mysql-proxy");
  const db = drizzle(fixture.query);
  return {
    database: async () =>
      Object.assign(db, {
        transaction: (execute: (tx: typeof db) => unknown) => execute(db),
      }),
  };
});
vi.mock("../../core/idempotency", () => ({
  once: (
    _tx: unknown,
    _actor: number,
    _action: string,
    _key: string,
    _input: unknown,
    execute: () => unknown
  ) => execute(),
}));
vi.mock("../../core/audit", () => ({ recordChange: fixture.record }));
vi.mock("./studio-state", () => ({ touchGanttStudioStates: fixture.touch }));
vi.mock("../material-requisitions/schedule-guards", () => ({
  lockRequisitionSourceProjects: async () => {},
}));
vi.mock("../../core/policy", async importOriginal => {
  const policy = await importOriginal<typeof import("../../core/policy")>();
  return {
    ...policy,
    assertConstructionAccess: async (
      access: AccessContext,
      projectId: number
    ) => {
      if (!access.scope.constructionProjectIds?.includes(projectId))
        throw new TRPCError({ code: "FORBIDDEN" });
    },
  };
});

function actor(projectIds: number[]) {
  return {
    user: {
      id: 1,
      role: "user",
      permissionCodes: ["pm.view", "pm.tasks.manage"],
    },
    scope: { allProjects: false, constructionProjectIds: projectIds },
  } as AccessContext;
}
const projectRows = [
  [
    10,
    "PR1",
    "First",
    "active",
    "2026-11-15",
    "2026-11-30",
    "2026-11-16",
    null,
    null,
    "blue",
    null,
    4,
  ],
  [
    20,
    "PR2",
    "Second",
    "approved",
    "2026-11-17",
    "2026-11-30",
    null,
    null,
    null,
    null,
    "#2288cc",
    2,
  ],
];

beforeEach(() => {
  fixture.query.mockReset();
  fixture.record.mockReset();
  fixture.touch.mockReset();
});

describe("Gantt portfolio", () => {
  it("scopes the project directory, excludes completed projects and orders old starts first", async () => {
    fixture.query.mockResolvedValue({ rows: projectRows });
    await expect(portfolioDirectory(actor([10, 20]))).resolves.toMatchObject([
      { id: 10, ganttPalette: "blue" },
      { id: 20, ganttColor: "#2288cc" },
    ]);
    const [statement, values] = fixture.query.mock.calls[0];
    expect(statement).toContain("`pm_projects`.`id` in (?, ?)");
    expect(statement).toContain("`pm_projects`.`actual_end_date` is null");
    expect(statement).toContain("not exists (select `id` from `pm_tasks`");
    expect(statement).toContain(
      "`portfolio_child`.`parent_id` = `portfolio_leaf`.`id`"
    );
    expect(statement).toContain(
      "order by `pm_projects`.`planned_start_date` IS NULL asc, `pm_projects`.`planned_start_date` asc"
    );
    expect(values).toEqual([10, 20, "active", "approved", "done"]);
  });

  it("reads tasks and both endpoints only from eligible selected projects", async () => {
    fixture.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from `pm_projects`"))
        return { rows: projectRows };
      if (statement.includes("`pm_gantt_task_settings`.`actual_start_date`"))
        return {
          rows: [
            [
              1,
              10,
              null,
              "Task",
              "working",
              "In progress",
              "2026-11-17",
              "2026-11-23",
              "2026-11-15",
              "2026-11-20",
              "2026-11-16",
              null,
              "medium",
              1,
              null,
              0,
              null,
            ],
          ],
        };
      if (statement.includes("from `pm_gantt_task_links`"))
        return { rows: [[5, 1, 3, "FS", 0]] };
      return { rows: [] };
    });
    await expect(
      portfolio({ projectIds: [20, 999, 10, 10] }, actor([10, 20]))
    ).resolves.toMatchObject({
      projects: [{ id: 10, actualStartDate: "2026-11-16" }, { id: 20 }],
      tasks: [
        {
          id: 1,
          startDate: "2026-11-17",
          endDate: "2026-11-23",
          plannedStartDate: "2026-11-15",
          plannedEndDate: "2026-11-20",
          actualStartDate: "2026-11-16",
          actualEndDate: null,
        },
      ],
      links: [{ id: 5, fromTaskId: 1, toTaskId: 3, type: "FS", lagDays: 0 }],
    });
    expect(fixture.query).toHaveBeenCalledTimes(6);
    const [projects, ...rest] = fixture.query.mock.calls;
    expect(projects[1]).toEqual([
      10,
      20,
      "active",
      "approved",
      "done",
      20,
      999,
      10,
    ]);
    for (const [, params] of rest) expect(params).not.toContain(999);
    const linkLookup = rest.find(([sql]) =>
      sql.includes("from `pm_gantt_task_links`")
    );
    expect(linkLookup?.[0]).toContain(
      "`portfolio_source`.`project_id` in (?, ?)"
    );
    expect(linkLookup?.[0]).toContain(
      "`portfolio_target`.`project_id` in (?, ?)"
    );
  });

  it("uses one central calendar while retaining the working hours of each project", async () => {
    fixture.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from `pm_projects`"))
        return { rows: projectRows };
      if (statement.includes("from `pm_work_calendar`"))
        return {
          rows: [
            [
              [0, 6],
              [
                {
                  name: "Annual holiday",
                  startDate: "2026-11-18",
                  endDate: "2026-11-19",
                },
              ],
              3,
            ],
          ],
        };
      if (statement.includes("from `pm_gantt_project_settings`"))
        return {
          rows: [
            [
              10,
              "[0,1,2]",
              6,
              '[{"date":"2026-11-20","name":"Previous project holiday"}]',
              "smart",
              null,
              null,
              2,
              "2026-11-17 08:00:00",
            ],
          ],
        };
      return { rows: [] };
    });
    const result = await portfolio({ projectIds: [10, 20] }, actor([10, 20]));
    const calendar = {
      workingDays: [1, 2, 3, 4, 5],
      holidays: [
        { date: "2026-11-18", name: "Annual holiday" },
        { date: "2026-11-19", name: "Annual holiday" },
      ],
      calendarManaged: true,
      calendarRevision: 3,
    };
    expect(result.projects).toMatchObject([
      { id: 10, settings: { ...calendar, hoursPerDay: 6 } },
      { id: 20, settings: { ...calendar, hoursPerDay: 8 } },
    ]);
    expect(
      fixture.query.mock.calls.filter(([sql]) =>
        sql.includes("from `pm_work_calendar`")
      )
    ).toHaveLength(1);
  });

  it("rechecks project eligibility when a direct relationship is saved", async () => {
    fixture.query
      .mockResolvedValueOnce({
        rows: [
          [1, 10],
          [3, 20],
        ],
      })
      .mockResolvedValueOnce({ rows: [[20]] });
    await expect(
      saveLink(
        {
          key: randomUUID(),
          projectId: 20,
          version: 0,
          action: "save",
          fromTaskId: 1,
          toTaskId: 3,
          type: "FS",
          lagDays: 0,
          portfolio: true,
        },
        actor([10, 20])
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.query).toHaveBeenCalledTimes(2);
    expect(fixture.query.mock.calls[1]?.[0]).toContain(
      "`pm_projects`.`actual_end_date` is null"
    );
    expect(fixture.touch).not.toHaveBeenCalled();
  });
});

describe("Gantt colours", () => {
  it("updates exactly the scoped task, without querying or updating descendants", async () => {
    fixture.query
      .mockResolvedValueOnce({ rows: [["#445566", 2]] })
      .mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
    const input = {
      key: randomUUID(),
      projectId: 10,
      taskId: 12,
      version: 2,
      color: null,
    };
    await expect(saveTaskColor(input, actor([10]))).resolves.toEqual({
      id: 12,
    });
    const [lookup, update] = fixture.query.mock.calls;
    expect(fixture.query).toHaveBeenCalledTimes(2);
    expect(lookup?.[1]).toEqual([12, 10]);
    expect(update?.[0]).toMatch(/^update `pm_tasks` set `gantt_color`/);
    expect(update?.[0]).toContain(
      "`pm_tasks`.`id` = ? and `pm_tasks`.`project_id` = ?"
    );
    expect(update?.[1].slice(0, 2)).toEqual([null, 3]);
    expect(update?.[1].slice(-2)).toEqual([12, 10]);
    expect(fixture.touch).toHaveBeenCalledOnce();
  });

  it("blocks unauthorized projects and stale color changes before writing", async () => {
    const task = {
      key: randomUUID(),
      projectId: 10,
      taskId: 12,
      version: 2,
      color: "#2266bb",
    };
    await expect(saveTaskColor(task, actor([20]))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.query).not.toHaveBeenCalled();
    fixture.query.mockResolvedValue({ rows: [[null, null, 4]] });
    await expect(
      saveProjectColor(
        {
          key: randomUUID(),
          projectId: 10,
          version: 3,
          ganttPalette: "blue",
          ganttColor: null,
        },
        actor([10])
      )
    ).rejects.toMatchObject({ domainCode: "CONFLICT" });
    expect(fixture.query).toHaveBeenCalledOnce();
    expect(fixture.touch).not.toHaveBeenCalled();
  });
});
