import { describe, it, expect } from "vitest";
import {
  projectTransition,
  taskInput,
  taskDateConflicts,
  validateProjectFile,
  projectSaveInput,
} from "../../../shared/construction";
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
