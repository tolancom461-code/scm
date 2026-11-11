import { describe, expect, it } from "vitest";
import {
  analyzeGantt,
  GanttCalendar,
  ganttProgress,
  type GanttTask,
} from "../../../shared/gantt";

const settings = { workingDays: [0, 1, 2, 3, 4], hoursPerDay: 8, holidays: [] };
const task = (id: number, startDate: string, endDate: string): GanttTask => ({
  id,
  parentId: null,
  name: `T${id}`,
  startDate,
  endDate,
  notBefore: null,
  isMilestone: false,
  statusCode: "not_started",
  level: 1,
  version: 0,
});

describe("Gantt scheduling engine", () => {
  it("counts weekdays and distinct holidays with inclusive and reverse calendar offsets", () => {
    const calendar = new GanttCalendar("2026-11-03", {
      ...settings,
      holidays: [
        { date: "2026-11-02", name: "Monday" },
        { date: "2026-11-02", name: "Duplicate" },
        { date: "2026-11-06", name: "Already a weekend" },
      ],
    });
    expect(calendar.date(-1)).toBe("2026-11-01");
    expect(calendar.index("2026-11-02", -1)).toBe(-1);
    expect(calendar.index("2026-11-02")).toBe(0);
    expect(calendar.date(2)).toBe("2026-11-05");
    expect(calendar.duration("2026-11-01", "2026-11-07")).toBe(4);
    expect(calendar.finish("2026-11-05", 2)).toBe("2026-11-08");
  });

  it("supports long calendar intervals without per-day traversal", () => {
    const calendar = new GanttCalendar("2026-01-01", settings);
    const old = calendar.index("1000-01-01");
    const future = calendar.index("9998-12-31", -1);
    expect(calendar.date(old)).toBe("1000-01-01");
    expect(calendar.date(future)).toBe("9998-12-31");
    expect(calendar.duration("1000-01-01", "9998-12-31")).toBe(
      future - old + 1
    );
  });
  it("calculates a finish-to-start critical path on working days", () => {
    const result = analyzeGantt(
      [
        task(1, "2026-11-01", "2026-11-03"),
        task(2, "2026-11-04", "2026-11-05"),
      ],
      [{ id: 1, fromTaskId: 1, toTaskId: 2, type: "FS", lagDays: 0 }],
      settings
    );
    expect(result.criticalTaskIds).toEqual([1, 2]);
    expect(result.finish).toBe("2026-11-05");
    expect(result.issues).toEqual([]);
  });

  it("rejects circular dependencies", () => {
    expect(() =>
      analyzeGantt(
        [
          task(1, "2026-11-01", "2026-11-02"),
          task(2, "2026-11-03", "2026-11-04"),
        ],
        [
          { id: 1, fromTaskId: 1, toTaskId: 2, type: "FS", lagDays: 0 },
          { id: 2, fromTaskId: 2, toTaskId: 1, type: "FS", lagDays: 0 },
        ],
        settings
      )
    ).toThrow("Dependency cycle");
  });

  it("derives progress from completed leaf tasks only", () => {
    const parent = {
      ...task(1, "2026-11-01", "2026-11-05"),
      statusCode: "done",
    };
    const first = {
      ...task(2, "2026-11-01", "2026-11-02"),
      parentId: 1,
      statusCode: "done",
      level: 2,
    };
    const second = {
      ...task(3, "2026-11-03", "2026-11-05"),
      parentId: 1,
      level: 2,
    };
    expect(ganttProgress([parent, first, second])).toEqual({
      done: 1,
      total: 2,
      percent: 50,
    });
  });
});
