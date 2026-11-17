import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../../drizzle/construction";
import type { AccessContext } from "../../core/policy";
import {
  previewCrossProjectLink,
  saveLink,
  saveProjectSchedule,
  saveSharedGroup,
  taskCrossProjectLinks,
} from "./service";

const fixture = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  deleteRow: vi.fn(),
  assertAccess: vi.fn(),
  filters: [] as SQL[],
}));

vi.mock("../../core/database", () => ({
  database: async () => ({
    transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({
          from: (table: unknown) => {
            const query = {
              innerJoin: () => query,
              leftJoin: () => query,
              orderBy: () => query,
              where: (filter: SQL) => {
                fixture.filters.push(filter);
                return query;
              },
              for: async () => fixture.rows.get(table) ?? [],
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(fixture.rows.get(table) ?? []).then(resolve),
            };
            return query;
          },
        }),
        delete: (table: unknown) => ({
          where: () => fixture.deleteRow(table),
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
vi.mock("./studio-state", () => ({ touchGanttStudioStates: async () => {} }));
vi.mock("../../core/policy", async importOriginal => {
  const policy = await importOriginal<typeof import("../../core/policy")>();
  return {
    ...policy,
    assertConstructionAccess: (access: AccessContext, projectId: number) => {
      fixture.assertAccess(projectId);
      if (!access.scope.constructionProjectIds?.includes(projectId))
        throw new TRPCError({ code: "FORBIDDEN" });
    },
  };
});

function actor(projectIds: number[], permissionCodes = ["pm.tasks.manage"]) {
  return {
    user: { id: 1, role: "user", permissionCodes },
    scope: { allProjects: false, constructionProjectIds: projectIds },
  } as AccessContext;
}

describe("Gantt cross-project dependency reads", () => {
  const dialect = new MySqlDialect();

  it("searches both directions and requires a visible project at each endpoint", async () => {
    fixture.filters.length = 0;
    fixture.rows.set(schema.projectTasks, [{ id: 5 }]);
    fixture.rows.set(schema.ganttTaskLinks, []);

    await expect(
      taskCrossProjectLinks(
        { projectId: 20, taskId: 5 },
        actor([10], ["pm.view"])
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.filters).toHaveLength(0);
    await taskCrossProjectLinks(
      { projectId: 10, taskId: 5 },
      actor([10, 20], ["pm.view"])
    );

    const [task, links] = fixture.filters.map(filter =>
      dialect.sqlToQuery(filter)
    );
    expect(task.params).toEqual([5, 10]);
    expect(links.sql).toContain(
      "`pm_gantt_task_links`.`from_task_id` = ? or `pm_gantt_task_links`.`to_task_id` = ?"
    );
    expect(links.sql).toContain("`from_project`.`id` in (?, ?)");
    expect(links.sql).toContain("`to_project`.`id` in (?, ?)");
    expect(links.params).toEqual([5, 5, 10, 20, 10, 20]);
  });

  it("scopes the proposed tasks before checking the dependency graph", async () => {
    fixture.filters.length = 0;
    fixture.rows.set(schema.projectTasks, [{ task: { id: 5, projectId: 10 } }]);

    await expect(
      previewCrossProjectLink(
        {
          projectId: 10,
          fromTaskId: 8,
          toTaskId: 5,
          type: "FS",
          lagDays: 0,
        },
        actor([10])
      )
    ).rejects.toMatchObject({ domainCode: "NOT_FOUND" });

    const [lookup] = fixture.filters.map(filter => dialect.sqlToQuery(filter));
    expect(lookup.sql).toContain("`pm_tasks`.`project_id` in (?)");
    expect(lookup.params).toEqual([8, 5, 10]);
  });
});

describe("Gantt write authorization", () => {
  it("requires access to the saved relationship endpoints before deleting it", async () => {
    fixture.rows.set(schema.ganttTaskLinks, [
      {
        id: 4,
        projectId: 10,
        fromTaskId: 1,
        toTaskId: 2,
        version: 3,
      },
    ]);
    fixture.rows.set(schema.projectTasks, [
      { projectId: 10 },
      { projectId: 20 },
    ]);
    const input = {
      key: randomUUID(),
      projectId: 10,
      id: 4,
      version: 3,
      action: "delete" as const,
      fromTaskId: 1,
      toTaskId: 2,
      type: "FS" as const,
      lagDays: 0,
    };
    fixture.deleteRow.mockClear();
    await expect(saveLink(input, actor([10]))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.deleteRow).not.toHaveBeenCalled();
    await expect(saveLink(input, actor([10, 20]))).resolves.toEqual({ id: 4 });
    expect(fixture.deleteRow).toHaveBeenCalledWith(schema.ganttTaskLinks);
  });

  it("checks all stored group members and the group revision before removal", async () => {
    fixture.rows.set(schema.ganttSharedTaskGroups, [{ id: 7, version: 1 }]);
    fixture.rows.set(schema.ganttSharedTaskMembers, [
      { projectId: 10 },
      { projectId: 20 },
    ]);
    const input = {
      key: randomUUID(),
      id: 7,
      version: 1,
      action: "delete" as const,
      name: "Shared task",
      taskIds: [1, 2],
      syncDates: true,
      syncStatus: true,
      syncAssignees: false,
    };
    fixture.deleteRow.mockClear();
    await expect(saveSharedGroup(input, actor([10]))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveSharedGroup({ ...input, version: 0 }, actor([10, 20]))
    ).rejects.toThrow("CONFLICT");
    expect(fixture.deleteRow).not.toHaveBeenCalled();
    await expect(saveSharedGroup(input, actor([10, 20]))).resolves.toEqual({
      id: 7,
    });
    expect(fixture.deleteRow).toHaveBeenCalledWith(
      schema.ganttSharedTaskGroups
    );
  });

  it("requires both start permission and an approved project for a new start", async () => {
    fixture.rows.set(schema.constructionProjects, [
      { id: 10, status: "draft", version: 2 },
    ]);
    const input = {
      key: randomUUID(),
      projectId: 10,
      version: 2,
      action: "start" as const,
      actualStartDate: "2026-11-11",
      reason: "",
    };
    await expect(saveProjectSchedule(input, actor([10]))).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await expect(
      saveProjectSchedule(input, actor([10], ["pm.start", "pm.tasks.manage"]))
    ).rejects.toThrow("INVALID_TRANSITION");
  });
});
