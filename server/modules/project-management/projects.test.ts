import { describe, it, expect, vi } from "vitest";
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
  readCmmsSites: vi.fn(async (_locale?: string) => [
    { id: 1, name: "Main Site" },
  ]),
  readCmmsSections: vi.fn(async (_siteId: number, _locale?: string) => [
    { id: 2, name: "Electrical" },
  ]),
  readCmmsAssets: vi.fn(
    async (_siteId: number, _sectionId: number, _locale?: string) => [
      { id: 3, name: "Panel" },
    ]
  ),
}));
vi.mock("../cmms-integration/references", () => references);
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
    expect(references.readCmmsSections).toHaveBeenLastCalledWith(1, "en");
    expect(references.readCmmsAssets).toHaveBeenLastCalledWith(1, 2, "en");
  });
  it("rejects unknown CMMS section and asset IDs from the selected hierarchy", async () => {
    await expect(
      resolveProjectLocation({ siteId: 1, sectionId: 4, assetId: null })
    ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
    await expect(
      resolveProjectLocation({ siteId: 1, sectionId: 2, assetId: 4 })
    ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
    references.readCmmsAssets.mockClear();
    const location = await resolveProjectLocation({
      siteId: 1,
      sectionId: 2,
      assetId: null,
    });
    expect(location.cmmsAssetId).toBeNull();
    expect(references.readCmmsAssets).not.toHaveBeenCalled();
  });
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
