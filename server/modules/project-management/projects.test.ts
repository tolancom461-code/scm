import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  projectTransition,
  taskInput,
  taskDateConflicts,
  validateProjectFile,
  projectSaveInput,
} from "../../../shared/construction";
import {
  matchesProjectLocation,
  resolveProjectLocation,
} from "./cmms-location";

const references = vi.hoisted(() => ({
  cmmsReferencesConfigured: vi.fn(() => true),
  readCmmsProjectLocation: vi.fn(),
}));
vi.mock("../cmms-integration/references", () => references);
const cmmsLocation = {
  site: { id: 1, name: "Main Site" },
  section: { id: 2, name: "Electrical" },
  asset: { id: 3, name: "Panel" },
};
const rows = [
  {
    id: 1,
    parentId: null,
    name: "Main",
    startDate: "2026-10-01",
    endDate: "2026-10-20",
    level: 1,
  },
  {
    id: 2,
    parentId: 1,
    name: "Child",
    startDate: "2026-10-15",
    endDate: "2026-10-19",
    level: 2,
  },
];
describe("Project workflow and task rules", () => {
  beforeEach(() => {
    references.readCmmsProjectLocation.mockReset();
  });

  it("requires separate draft submission, approval and start", () => {
    expect(projectTransition("draft", "submit")).toBe("pending");
    expect(projectTransition("pending", "return")).toBe("returned");
    expect(projectTransition("returned", "submit")).toBe("pending");
    expect(projectTransition("pending", "approve")).toBe("approved");
    expect(projectTransition("approved", "start")).toBe("active");
    for (const [state, action] of [
      ["draft", "start"],
      ["pending", "start"],
      ["active", "submit"],
      ["rejected", "submit"],
      ["draft", "approve"],
    ])
      expect(() => projectTransition(state, action)).toThrow();
  });
  it("allows incomplete drafts without bypassing the submission step", () => {
    expect(
      projectSaveInput.parse({
        key: crypto.randomUUID(),
        data: { name: "Test" },
      }).data.site
    ).toBe("");
  });
  it("accepts CMMS identifiers with an optional asset without trusting labels", () => {
    const project = projectSaveInput.parse({
      key: crypto.randomUUID(),
      data: {
        name: "Test",
        cmmsLocation: { siteId: 1, sectionId: 2, name: "Browser label" },
      },
    });
    expect(project.data.cmmsLocation).toEqual({
      siteId: 1,
      sectionId: 2,
      assetId: null,
    });
    expect(
      projectSaveInput.safeParse({
        ...project,
        data: { ...project.data, cmmsLocation: { siteId: 1, assetId: 3 } },
      }).success
    ).toBe(false);
  });
  it("preserves an unchanged saved CMMS hierarchy and validates the labels of a new selection", async () => {
    const input = {
      siteId: 1,
      sectionId: 2,
      assetId: 3,
      locale: "en" as const,
    };
    references.readCmmsProjectLocation.mockResolvedValueOnce(cmmsLocation);
    const location = await resolveProjectLocation(input);
    expect(location).toEqual({
      cmmsSiteId: 1,
      cmmsSiteName: "Main Site",
      cmmsSectionId: 2,
      cmmsSectionName: "Electrical",
      cmmsAssetId: 3,
      cmmsAssetName: "Panel",
    });
    expect(matchesProjectLocation(input, location)).toBe(true);
    expect(matchesProjectLocation({ ...input, assetId: null }, location)).toBe(
      false
    );
    expect(references.readCmmsProjectLocation).toHaveBeenCalledTimes(1);
    expect(references.readCmmsProjectLocation).toHaveBeenCalledWith(
      1,
      2,
      3,
      "en"
    );
  });
  it("validates a CMMS site and section with no selected asset", async () => {
    references.readCmmsProjectLocation.mockResolvedValueOnce({
      ...cmmsLocation,
      asset: null,
    });
    const location = await resolveProjectLocation({
      siteId: 1,
      sectionId: 2,
      assetId: null,
    });
    expect(location).toMatchObject({ cmmsAssetId: null, cmmsAssetName: null });
    expect(references.readCmmsProjectLocation).toHaveBeenCalledTimes(1);
    expect(references.readCmmsProjectLocation).toHaveBeenCalledWith(
      1,
      2,
      null,
      undefined
    );
  });
  it.each([
    ["missing location", 3, null],
    ["different site", 3, { ...cmmsLocation, site: { id: 9, name: "Other" } }],
    [
      "different section",
      3,
      { ...cmmsLocation, section: { id: 9, name: "Other" } },
    ],
    [
      "different asset",
      3,
      { ...cmmsLocation, asset: { id: 9, name: "Other" } },
    ],
    ["missing selected asset", 3, { ...cmmsLocation, asset: null }],
    ["unexpected asset", null, cmmsLocation],
  ] as const)(
    "rejects an invalid CMMS hierarchy with %s",
    async (_, assetId, result) => {
      references.readCmmsProjectLocation.mockResolvedValueOnce(result);
      await expect(
        resolveProjectLocation({ siteId: 1, sectionId: 2, assetId })
      ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
    }
  );
  it("identifies child dates invalidated by shortening the parent", () => {
    expect(
      taskDateConflicts({ ...rows[0], endDate: "2026-10-17" }, rows)
    ).toEqual(["Child"]);
    expect(taskDateConflicts(rows[0], rows)).toEqual([]);
  });
  it("rejects children outside either parent boundary and allows overlapping siblings", () => {
    expect(
      taskDateConflicts({ ...rows[1], startDate: "2026-09-30" }, rows)
    ).toEqual(["Main"]);
    expect(
      taskDateConflicts({ ...rows[1], endDate: "2026-10-21" }, rows)
    ).toEqual(["Main"]);
    expect(
      taskDateConflicts({ ...rows[1], id: 3, startDate: "2026-10-15" }, rows)
    ).toEqual([]);
  });
  it("checks real dates, date ordering and multi-employee assignment", () => {
    const data = {
      key: crypto.randomUUID(),
      projectId: 1,
      name: "Task",
      statusId: 1,
      startDate: "2026-10-01",
      endDate: "2026-10-20",
      priority: "medium",
      employeeIds: [1, 2, 1],
    };
    expect(taskInput.parse(data).employeeIds).toEqual([1, 2]);
    for (const change of [
      { endDate: "2026-09-30" },
      { startDate: "2026-02-30" },
      { employeeIds: [] },
    ])
      expect(taskInput.safeParse({ ...data, ...change }).success).toBe(false);
  });
  it("checks file content rather than trusting names and MIME types", () => {
    const bytes = (v: string) => new TextEncoder().encode(v);
    expect(validateProjectFile("test.pdf", bytes("%PDF-1.7"))).toBe(true);
    expect(validateProjectFile("test.dwg", bytes("AC1027test"))).toBe(true);
    expect(validateProjectFile("test.png", bytes("<html>"))).toBe(false);
    expect(validateProjectFile("test.dwg", bytes("<script>"))).toBe(false);
    expect(validateProjectFile("test.html", bytes("%PDF-1.7"))).toBe(false);
  });
});
