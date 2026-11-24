import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as s from "../../../drizzle/construction";
import type { AccessContext } from "../../core/policy";
import { routePolicies } from "../../core/policy-registry";
import { projectListInput, projectListView } from "./project-list";

const mocks = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../../core/database", () => ({ database: mocks.database }));

type Read = { table?: unknown; where?: SQL; limit?: number };
function readDatabase(
  projects: object[],
  tasks: object[] = [],
  assignments: object[] = []
) {
  const reads: Read[] = [];
  const rows = (table: unknown) => {
    if (table === s.constructionProjects) return projects;
    if (table === s.projectTasks) return tasks;
    if (table === s.taskAssignees) return assignments;
    throw new Error("Unexpected table read");
  };
  const db = {
    select: vi.fn(() => {
      const read: Read = {};
      reads.push(read);
      const query = {
        from(table: unknown) {
          read.table = table;
          return query;
        },
        where(predicate?: SQL) {
          read.where = predicate;
          return query;
        },
        innerJoin: () => query,
        leftJoin: () => query,
        orderBy: () => query,
        limit(value: number) {
          read.limit = value;
          return Promise.resolve(rows(read.table).slice(0, value));
        },
        then(resolve: (result: object[]) => unknown) {
          return Promise.resolve(rows(read.table)).then(resolve);
        },
      };
      return query;
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };
  mocks.database.mockResolvedValue(db);
  return { db, reads };
}
const access = (projectIds: number[], allProjects = false) =>
  ({
    user: { id: 1 },
    scope: {
      allProjects,
      projectIds: [],
      constructionProjectIds: projectIds,
      template: "custom",
      version: 0,
    },
  }) as unknown as AccessContext;
const sql = (read: Read) =>
  read.where
    ? new MySqlDialect().sqlToQuery(read.where)
    : { sql: "", params: [] };

describe("Project list grouped read", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses pm.view and rejects unbounded pages before querying", async () => {
    expect(routePolicies["projectManagement.listView"]).toEqual({
      any: ["pm.view"],
    });
    expect(projectListInput.parse(undefined)).toEqual({ pageSize: 50 });
    expect(projectListInput.safeParse({ cursor: 0 }).success).toBe(false);
    expect(projectListInput.safeParse({ pageSize: 200 }).success).toBe(true);
    await expect(
      projectListView(access([], true), { pageSize: 201 })
    ).rejects.toThrow();
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("applies project scope and cursor before loading only the returned project trees", async () => {
    const { db, reads } = readDatabase(
      [{ id: 9 }, { id: 7 }, { id: 6 }],
      [
        {
          id: 101,
          projectId: 9,
          parentId: null,
          name: "Install",
          statusCode: "working",
          statusName: "In progress",
          actualStartDate: "2026-11-20",
          actualEndDate: null,
        },
        {
          id: 102,
          projectId: 9,
          parentId: 101,
          name: "Finish",
          statusCode: "done",
          statusName: "Done",
          actualStartDate: "2026-11-20",
          actualEndDate: "2026-11-23",
        },
        {
          id: 103,
          projectId: 7,
          parentId: null,
          statusCode: "not_started",
          statusName: "Not started",
          actualStartDate: null,
          actualEndDate: null,
        },
      ],
      [
        { taskId: 101, employeeId: 11 },
        { taskId: 101, employeeId: 12 },
        { taskId: 102, employeeId: 12 },
      ]
    );
    const result = await projectListView(access([9, 7, 6]), {
      cursor: 10,
      pageSize: 2,
    });
    expect(result.projects.map(project => project.id)).toEqual([9, 7]);
    expect(result).toMatchObject({ hasMore: true, nextBeforeId: 7 });
    expect(reads[0].limit).toBe(3);
    expect(sql(reads[0]).params).toEqual([9, 7, 6, 10]);
    expect(sql(reads[0]).sql).toContain("`pm_projects`.`id` in");
    expect(sql(reads[0]).sql).toContain("`pm_projects`.`id` <");
    for (const read of reads.slice(1)) {
      expect(sql(read).params).toEqual([9, 7]);
      expect(sql(read).sql).toContain("`pm_tasks`.`project_id` in");
    }
    expect(result.tasks).toMatchObject([
      {
        id: 101,
        employeeIds: [11, 12],
        executionStatus: "in_progress",
        actualStartDate: "2026-11-20",
      },
      {
        id: 102,
        parentId: 101,
        employeeIds: [12],
        executionStatus: "completed",
        actualEndDate: "2026-11-23",
      },
      { id: 103, employeeIds: [], executionStatus: "not_started" },
    ]);
    expect(db.select).toHaveBeenCalledTimes(3);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns no task reads when construction scope grants no projects", async () => {
    const { db, reads } = readDatabase([]);
    expect(await projectListView(access([]), {})).toEqual({
      projects: [],
      tasks: [],
      hasMore: false,
      nextBeforeId: null,
    });
    expect(sql(reads[0]).sql).toBe("FALSE");
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("allows all-project viewers without an artificial status restriction or next cursor", async () => {
    const { reads } = readDatabase([
      { id: 4, status: "draft" },
      { id: 3, status: "active" },
      { id: 2, status: "approved" },
    ]);
    const result = await projectListView(access([], true), {});
    expect(result.projects.map(project => project.status)).toEqual([
      "draft",
      "active",
      "approved",
    ]);
    expect(sql(reads[0])).toEqual({ sql: "", params: [] });
    expect(result.hasMore).toBe(false);
    expect(result.nextBeforeId).toBeNull();
    expect(reads[0].limit).toBe(51);
  });
});
