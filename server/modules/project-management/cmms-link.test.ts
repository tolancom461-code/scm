import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { constructionProjects } from "../../../drizzle/construction";
import { operationKeys } from "../../../drizzle/foundation";
import {
  canLinkProjectCmmsLocation,
  projectLinkCmmsLocationInput,
} from "../../../shared/construction";
import type { AccessContext } from "../../core/policy";
import { routePolicies } from "../../core/policy-registry";
import { linkCmmsLocation } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  canAccess: vi.fn(),
  assertConstructionAccess: vi.fn(),
  resolveProjectLocation: vi.fn(),
  recordChange: vi.fn(),
}));
vi.mock("../../core/database", () => ({ database: mocks.database }));
vi.mock("../../core/policy", () => ({
  canAccess: mocks.canAccess,
  assertConstructionAccess: mocks.assertConstructionAccess,
}));
vi.mock("./cmms-location", () => ({
  resolveProjectLocation: mocks.resolveProjectLocation,
}));
vi.mock("../../core/audit", () => ({ recordChange: mocks.recordChange }));

const unlinked: Pick<
  typeof constructionProjects.$inferSelect,
  | "cmmsSiteId"
  | "cmmsSiteName"
  | "cmmsSectionId"
  | "cmmsSectionName"
  | "cmmsAssetId"
  | "cmmsAssetName"
> = {
  cmmsSiteId: null,
  cmmsSiteName: null,
  cmmsSectionId: null,
  cmmsSectionName: null,
  cmmsAssetId: null,
  cmmsAssetName: null,
};
const initial = {
  ...unlinked,
  id: 83,
  version: 7,
  status: "approved",
  site: "Previous free-text site",
  description: "Project description",
  directLatitude: 24.7,
  directLongitude: 46.7,
};
const resolved = {
  cmmsSiteId: 101,
  cmmsSiteName: "Riyadh",
  cmmsSectionId: 102,
  cmmsSectionName: "Workshop",
  cmmsAssetId: null,
  cmmsAssetName: null,
};
const command = projectLinkCmmsLocationInput.parse({
  key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
  id: initial.id,
  version: initial.version,
  location: { siteId: 101, sectionId: 102 },
});
const editor = { user: { id: 11 } } as AccessContext;

function stubDatabase(project = initial) {
  let current = { ...project };
  const operations = new Map<
    string,
    { payloadHash: string; result: { id: number } | null }
  >();
  const updateProject = vi.fn((values: Record<string, unknown>) => {
    current = { ...current, ...values };
  });
  const readLockedProject = vi.fn((_mode: string) => [{ ...current }]);
  mocks.assertConstructionAccess.mockImplementation(async () => ({
    ...current,
  }));
  mocks.database.mockResolvedValue({
    transaction: async (run: (tx: unknown) => unknown) => {
      let currentKey = "";
      return run({
        insert: (table: unknown) => ({
          values: (row: { key: string; payloadHash: string }) => ({
            onDuplicateKeyUpdate: async () => {
              expect(table).toBe(operationKeys);
              currentKey = row.key;
              if (!operations.has(currentKey))
                operations.set(currentKey, {
                  payloadHash: row.payloadHash,
                  result: null,
                });
            },
          }),
        }),
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              for: async (mode: string) =>
                table === constructionProjects
                  ? readLockedProject(mode)
                  : [operations.get(currentKey)],
            }),
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: async () => {
              if (table === constructionProjects) updateProject(values);
              else
                operations.get(currentKey)!.result = values.result as {
                  id: number;
                };
            },
          }),
        }),
      });
    },
  });
  return { updateProject, readLockedProject };
}

describe("One-time CMMS location link", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.canAccess.mockReturnValue(true);
    mocks.resolveProjectLocation.mockResolvedValue(resolved);
  });

  it("requires edit permission in the route policy and service", async () => {
    expect(routePolicies["projectManagement.linkCmmsLocation"]).toEqual({
      any: ["pm.edit"],
    });
    mocks.canAccess.mockReturnValue(false);
    await expect(linkCmmsLocation(command, editor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it.each(["approved", "active"])(
    "links a project in status %s with a canonical site and audit",
    async status => {
      const { updateProject, readLockedProject } = stubDatabase({
        ...initial,
        status,
      });
      await expect(linkCmmsLocation(command, editor)).resolves.toEqual({
        id: initial.id,
      });
      expect(mocks.canAccess).toHaveBeenCalledWith(editor, "pm.edit");
      expect(mocks.resolveProjectLocation).toHaveBeenCalledWith({
        siteId: 101,
        sectionId: 102,
        assetId: null,
      });
      expect(readLockedProject).toHaveBeenCalledWith("update");
      expect(updateProject).toHaveBeenCalledTimes(1);
      expect(updateProject).toHaveBeenCalledWith({
        ...resolved,
        site: "Riyadh",
        version: 8,
        updatedAt: expect.any(Date),
      });
      expect(mocks.recordChange).toHaveBeenCalledWith(expect.anything(), {
        action: "pm.project.cmmsLocation.linked",
        actorId: editor.user.id,
        entityType: "pm_project",
        entityId: initial.id,
        before: { ...unlinked, site: initial.site },
        after: { ...resolved, site: "Riyadh" },
      });
    }
  );

  it("persists an optional asset returned by CMMS", async () => {
    const { updateProject } = stubDatabase();
    mocks.resolveProjectLocation.mockResolvedValue({
      ...resolved,
      cmmsAssetId: 201,
      cmmsAssetName: "Generator",
    });
    await linkCmmsLocation(
      {
        ...command,
        location: { ...command.location, assetId: 201 },
      },
      editor
    );
    expect(updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ cmmsAssetId: 201, cmmsAssetName: "Generator" })
    );
  });

  it("rejects other statuses and even partially linked projects before CMMS lookup", async () => {
    for (const project of [
      ...["draft", "returned", "pending", "rejected"].map(status => ({
        ...initial,
        status,
      })),
      { ...initial, cmmsSiteId: 101 },
      { ...initial, cmmsSectionId: 102 },
      { ...initial, cmmsAssetId: 201 },
    ]) {
      expect(canLinkProjectCmmsLocation(project)).toBe(false);
      const { updateProject } = stubDatabase(project);
      await expect(linkCmmsLocation(command, editor)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(updateProject).not.toHaveBeenCalled();
    }
    expect(mocks.resolveProjectLocation).not.toHaveBeenCalled();
  });

  it("checks project scope and version before contacting CMMS", async () => {
    const { updateProject } = stubDatabase();
    mocks.assertConstructionAccess.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(linkCmmsLocation(command, editor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      linkCmmsLocation({ ...command, version: 6 }, editor)
    ).rejects.toMatchObject({ domainCode: "CONFLICT" });
    expect(mocks.resolveProjectLocation).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("returns the same id on replay and rejects a change after linking", async () => {
    const { updateProject } = stubDatabase();
    const result = await linkCmmsLocation(command, editor);
    await expect(linkCmmsLocation(command, editor)).resolves.toEqual(result);
    await expect(
      linkCmmsLocation(
        { ...command, key: crypto.randomUUID(), version: 8 },
        editor
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      linkCmmsLocation(
        { ...command, location: { ...command.location, assetId: 201 } },
        editor
      )
    ).rejects.toMatchObject({ domainCode: "CONFLICT" });
    expect(mocks.resolveProjectLocation).toHaveBeenCalledTimes(1);
    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.recordChange).toHaveBeenCalledTimes(1);
  });

  it("requires project scope even when replaying a completed link", async () => {
    const { updateProject } = stubDatabase();
    await linkCmmsLocation(command, editor);
    mocks.assertConstructionAccess.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(linkCmmsLocation(command, editor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.resolveProjectLocation).toHaveBeenCalledTimes(1);
    expect(updateProject).toHaveBeenCalledTimes(1);
  });

  it("keeps the competing save that reached the lock first", async () => {
    const { updateProject } = stubDatabase();
    let unblockLookup!: () => void;
    let lookupStarted!: () => void;
    const lookup = new Promise<void>(resolve => {
      unblockLookup = resolve;
    });
    const started = new Promise<void>(resolve => {
      lookupStarted = resolve;
    });
    mocks.resolveProjectLocation.mockImplementationOnce(async () => {
      lookupStarted();
      await lookup;
      return resolved;
    });
    const first = linkCmmsLocation(command, editor);
    await started;
    const otherLocation = {
      ...resolved,
      cmmsSiteId: 301,
      cmmsSiteName: "Other",
    };
    mocks.resolveProjectLocation.mockResolvedValueOnce(otherLocation);
    const other = await linkCmmsLocation(
      {
        ...command,
        key: crypto.randomUUID(),
        location: { ...command.location, siteId: 301 },
      },
      editor
    ).finally(unblockLookup);
    expect(other.id).toBe(initial.id);
    await expect(first).rejects.toMatchObject({ domainCode: "CONFLICT" });
    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(updateProject).toHaveBeenCalledWith({
      ...otherLocation,
      site: "Other",
      version: 8,
      updatedAt: expect.any(Date),
    });
  });
});
