import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../../drizzle/construction";
import type { AccessContext } from "../../core/policy";
import { saveLink, saveProjectSchedule, saveSharedGroup } from "./service";

const fixture = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  deleteRow: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("../../core/database", () => ({
  database: async () => ({
    transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({
          from: (table: unknown) => {
            const query = {
              innerJoin: () => query,
              where: () => query,
              for: async () => fixture.rows.get(table) ?? [],
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
