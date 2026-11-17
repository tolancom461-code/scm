import { describe, expect, it } from "vitest";
import { businessDate } from "../../../shared/date";
import {
  taskExecutionMetrics,
  updateTaskExecutionDates,
} from "../../../shared/gantt";

const noActualDates = { actualStartDate: null, actualEndDate: null };
const schedule = { startDate: "2026-11-19", endDate: "2026-11-19" };
const calendar = {
  workingDays: [0, 1, 2, 3, 4],
  hoursPerDay: 8,
  holidays: [{ date: "2026-11-22", name: "Holiday" }],
};

describe("task execution dates", () => {
  it("records the Riyadh date at the first saved start and keeps it after reopening", () => {
    const riyadhDate = businessDate(new Date("2026-11-20T21:01:00Z"));
    expect(riyadhDate).toBe("2026-11-21");
    const working = updateTaskExecutionDates(
      noActualDates,
      "not_started",
      "working",
      riyadhDate
    );
    const firstFinish = updateTaskExecutionDates(
      working,
      "working",
      "done",
      "2026-11-23"
    );
    expect(
      updateTaskExecutionDates(firstFinish, "done", "done", "2026-11-24")
    ).toEqual(firstFinish);
    const reopened = updateTaskExecutionDates(
      firstFinish,
      "done",
      "working",
      "2026-11-24"
    );
    expect(reopened).toEqual({
      actualStartDate: "2026-11-21",
      actualEndDate: null,
    });
    expect(
      updateTaskExecutionDates(reopened, "working", "done", "2026-11-25")
    ).toEqual({ ...reopened, actualEndDate: "2026-11-25" });
  });

  it("records a direct completion and keeps historical dates unknown", () => {
    expect(
      updateTaskExecutionDates(
        noActualDates,
        "not_started",
        "done",
        "2026-11-23"
      )
    ).toEqual({ actualStartDate: null, actualEndDate: "2026-11-23" });
    for (const status of ["working", "done"]) {
      expect(
        updateTaskExecutionDates(noActualDates, status, status, "2026-11-23")
      ).toEqual(noActualDates);
    }
    expect(
      taskExecutionMetrics(
        { ...schedule, ...noActualDates, executionStatus: "completed" },
        calendar,
        "2026-11-24"
      )
    ).toEqual({ startDelayDays: null, endDelayDays: null, progress: 100 });
  });

  it("counts only workdays strictly after the planned date", () => {
    const task = {
      ...schedule,
      ...noActualDates,
      executionStatus: "not_started" as const,
    };
    for (const today of ["2026-11-18", "2026-11-19", "2026-11-22"]) {
      expect(taskExecutionMetrics(task, calendar, today)).toEqual({
        startDelayDays: 0,
        endDelayDays: 0,
        progress: null,
      });
    }
    expect(taskExecutionMetrics(task, calendar, "2026-11-23")).toEqual({
      startDelayDays: 1,
      endDelayDays: 1,
      progress: null,
    });
  });
});
