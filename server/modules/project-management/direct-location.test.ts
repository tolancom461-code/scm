import { beforeEach, describe, expect, it, vi } from "vitest";
import { constructionProjects } from "../../../drizzle/construction";
import {
  projectActionInput,
  projectSaveInput,
} from "../../../shared/construction";
import type { AccessContext } from "../../core/policy";
import { projectAction, saveProject } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  canAccess: vi.fn(),
  assertConstructionAccess: vi.fn(),
  cmmsConfigured: vi.fn(),
  sites: vi.fn(),
  sections: vi.fn(),
  assets: vi.fn(),
}));
vi.mock("../../core/database", () => ({ database: mocks.database }));
vi.mock("../../core/policy", () => ({
  assertConstructionAccess: mocks.assertConstructionAccess,
  canAccess: mocks.canAccess,
}));
vi.mock("../../core/numbering", () => ({
  allocateRecordNumber: vi.fn().mockResolvedValue("P-1"),
}));
vi.mock("../../core/audit", () => ({ recordChange: vi.fn() }));
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
vi.mock("../material-requisitions/schedule-guards", () => ({
  assertApprovedRequisitionDates: vi.fn(),
}));
vi.mock("../gantt/studio-state", () => ({ touchGanttStudioStates: vi.fn() }));
vi.mock("../cmms-integration/references", () => ({
  cmmsReferencesConfigured: mocks.cmmsConfigured,
  readCmmsSites: mocks.sites,
  readCmmsSections: mocks.sections,
  readCmmsAssets: mocks.assets,
}));

const editor = { user: { id: 11, name: "Editor" } } as AccessContext;
const point = { lat: 24.6877, lng: 46.7219 };
const savedCoordinates = {
  directLatitude: point.lat,
  directLongitude: point.lng,
};
const cmmsSelection = { siteId: 15, sectionId: 16 };
const savedCmms = {
  cmmsSiteId: cmmsSelection.siteId,
  cmmsSiteName: "Site 15",
  cmmsSectionId: cmmsSelection.sectionId,
  cmmsSectionName: "Section 16",
  cmmsAssetId: null,
  cmmsAssetName: null,
};
const command = {
  key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
  id: 8,
  version: 2,
  data: { name: "Project" },
};

function stubProject(status = "draft", linked = true) {
  const project = {
    id: command.id,
    version: command.version,
    status,
    ...savedCoordinates,
    ...(linked ? savedCmms : { cmmsSiteId: null, cmmsSectionId: null }),
  };
  mocks.assertConstructionAccess.mockResolvedValue(project);
  const query = {
    from: () => query,
    where: () => query,
    for: vi.fn().mockResolvedValue([project]),
  };
  const set = vi.fn((_values: Record<string, unknown>) => ({ where: vi.fn() }));
  const values = vi.fn().mockResolvedValue([{ insertId: command.id }]);
  const update = vi.fn(() => ({ set }));
  const insert = vi.fn(() => ({ values }));
  const tx = { select: () => query, update, insert };
  mocks.database.mockResolvedValue({
    transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
  });
  return { update, set, insert, values };
}

function withLocation(directLocation: unknown) {
  return { ...command, data: { ...command.data, directLocation } };
}

describe("Project direct location", () => {
  beforeEach(() => {
    mocks.canAccess.mockReset().mockReturnValue(true);
    mocks.cmmsConfigured.mockReset().mockReturnValue(false);
    mocks.sites
      .mockReset()
      .mockResolvedValue([
        { id: cmmsSelection.siteId, name: savedCmms.cmmsSiteName },
      ]);
    mocks.sections
      .mockReset()
      .mockResolvedValue([
        { id: cmmsSelection.sectionId, name: savedCmms.cmmsSectionName },
      ]);
    mocks.assets.mockReset().mockResolvedValue([]);
  });

  it.each([
    { lat: 1 },
    { lng: 1 },
    { lat: 91, lng: 0 },
    { lat: 0, lng: -181 },
    { lat: NaN, lng: 0 },
    { lat: 0, lng: Infinity },
    { lat: "24.6877", lng: 0 },
  ])("rejects invalid or partial point %j", invalidPoint => {
    expect(projectSaveInput.safeParse(withLocation(invalidPoint)).success).toBe(
      false
    );
  });

  it("saves coordinates and assigns the record number when creating a draft", async () => {
    const { insert, values } = stubProject();
    mocks.cmmsConfigured.mockReturnValue(true);
    const input = projectSaveInput.parse({
      ...withLocation(point),
      id: undefined,
      data: {
        ...command.data,
        directLocation: point,
        cmmsLocation: cmmsSelection,
      },
    });
    await expect(saveProject(input, editor)).resolves.toEqual({
      id: command.id,
    });
    expect(mocks.canAccess).toHaveBeenCalledWith(editor, "pm.create");
    expect(insert).toHaveBeenNthCalledWith(1, constructionProjects);
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ...savedCoordinates,
        ...savedCmms,
        number: "P-1",
      })
    );
    expect(mocks.sections).toHaveBeenCalledWith(
      cmmsSelection.siteId,
      undefined
    );
    expect(mocks.assets).not.toHaveBeenCalled();
  });

  it("requires a CMMS site and section for a new or previously unlinked draft", async () => {
    const { insert, update } = stubProject("draft", false);
    for (const id of [undefined, command.id])
      await expect(
        saveProject(projectSaveInput.parse({ ...command, id }), editor)
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Select the CMMS site and section"),
      });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves an unchanged saved CMMS location while the reference service is offline", async () => {
    const { set } = stubProject();
    const input = projectSaveInput.parse({
      ...command,
      data: { ...command.data, cmmsLocation: cmmsSelection },
    });
    await expect(saveProject(input, editor)).resolves.toEqual({
      id: command.id,
    });
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("cmmsSiteId");
    expect(mocks.sites).not.toHaveBeenCalled();
  });

  it("rejects saving a selected asset absent from the selected CMMS section", async () => {
    const { update } = stubProject();
    mocks.cmmsConfigured.mockReturnValue(true);
    const input = projectSaveInput.parse({
      ...command,
      data: {
        ...command.data,
        cmmsLocation: { ...cmmsSelection, assetId: 55 },
      },
    });
    await expect(saveProject(input, editor)).rejects.toMatchObject({
      domainCode: "INVALID_REFERENCE",
    });
    expect(mocks.assets).toHaveBeenCalledWith(
      cmmsSelection.siteId,
      cmmsSelection.sectionId,
      undefined
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("can replace the draft point with zero coordinates and clear it explicitly", async () => {
    const { set } = stubProject();
    await saveProject(
      projectSaveInput.parse(withLocation({ lat: 0, lng: 0 })),
      editor
    );
    await saveProject(projectSaveInput.parse(withLocation(null)), editor);
    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        directLatitude: 0,
        directLongitude: 0,
      })
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        directLatitude: null,
        directLongitude: null,
      })
    );
  });

  it("preserves coordinates when the location is omitted from a draft edit", async () => {
    const { set } = stubProject();
    await saveProject(projectSaveInput.parse(command), editor);
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLatitude");
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLongitude");
  });

  it("allows unrelated edits to a returned project with the same coordinates", async () => {
    const { set } = stubProject("returned");
    await saveProject(projectSaveInput.parse(withLocation(point)), editor);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Project" })
    );
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLatitude");
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLongitude");
  });

  it.each(["returned", "pending", "rejected", "approved", "active"])(
    "rejects coordinate removal in status %s",
    async status => {
      const { update } = stubProject(status);
      await expect(
        saveProject(projectSaveInput.parse(withLocation(null)), editor)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(update).not.toHaveBeenCalled();
    }
  );

  it("enforces project edit permissions while the project is a draft", async () => {
    mocks.canAccess.mockReturnValue(false);
    const { update } = stubProject();
    await expect(
      saveProject(projectSaveInput.parse(withLocation(point)), editor)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps coordinates when the pending project is approved", async () => {
    const { set } = stubProject("pending");
    const input = projectActionInput.parse({ ...command, action: "approve" });
    await projectAction(input, editor);
    expect(mocks.canAccess).toHaveBeenCalledWith(editor, "pm.review");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "approved" })
    );
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLatitude");
    expect(set.mock.lastCall?.[0]).not.toHaveProperty("directLongitude");
  });
});
