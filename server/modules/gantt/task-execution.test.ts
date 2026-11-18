import { describe, expect, it } from "vitest";
import { businessDate } from "../../../shared/date";
import {
  taskExecutionMetrics,
  updateTaskExecutionDates,
} from "../../../shared/gantt";
import { deriveExecutionDates } from "./execution-rollup";

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

  it("retains execution history when a completed task is cancelled", () => {
    const executed = {
      actualStartDate: "2026-10-21",
      actualEndDate: "2026-10-27",
    };
    expect(
      updateTaskExecutionDates(executed, "done", "cancelled", "2026-10-29")
    ).toEqual(executed);
    expect(
      updateTaskExecutionDates(executed, "cancelled", "done", "2026-10-30")
    ).toEqual(executed);
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

describe("execution date roll-up", () => {
  it("derives the earliest start and latest finish through nested tasks", () => {
    const tasks: Parameters<typeof deriveExecutionDates>[0] = [
      { id: 1, parentId: null, statusCode: "not_started", ...noActualDates },
      { id: 2, parentId: 1, statusCode: "not_started", ...noActualDates },
      {
        id: 3,
        parentId: 2,
        statusCode: "done",
        actualStartDate: "2026-10-21",
        actualEndDate: "2026-10-26",
      },
      {
        id: 4,
        parentId: 1,
        statusCode: "done",
        actualStartDate: "2026-10-22",
        actualEndDate: "2026-10-27",
      },
      {
        id: 5,
        parentId: null,
        statusCode: "working",
        actualStartDate: "2026-10-24",
        actualEndDate: null,
      },
    ];
    const inProgress = deriveExecutionDates(tasks);
    expect(inProgress.parentDates.get(1)).toEqual({
      actualStartDate: "2026-10-21",
      actualEndDate: "2026-10-27",
    });
    expect(inProgress.projectDates).toEqual({
      actualStartDate: "2026-10-21",
      actualEndDate: null,
    });

    tasks[4] = {
      ...tasks[4],
      statusCode: "done",
      actualEndDate: "2026-10-31",
    };
    expect(deriveExecutionDates(tasks).projectDates).toEqual({
      actualStartDate: "2026-10-21",
      actualEndDate: "2026-10-31",
    });

    tasks[3] = { ...tasks[3], statusCode: "cancelled" };
    expect(deriveExecutionDates(tasks).parentDates.get(1)).toEqual({
      actualStartDate: "2026-10-21",
      actualEndDate: "2026-10-26",
    });
    tasks[4] = { ...tasks[4], statusCode: "cancelled" };
    expect(deriveExecutionDates(tasks).projectDates.actualEndDate).toBe(
      "2026-10-26"
    );
  });

  it("excludes a cancelled branch and keeps dates unknown when no work remains", () => {
    const result = deriveExecutionDates([
      { id: 1, parentId: null, statusCode: "cancelled", ...noActualDates },
      {
        id: 2,
        parentId: 1,
        statusCode: "done",
        actualStartDate: "2026-10-21",
        actualEndDate: "2026-10-26",
      },
    ]);
    expect(result.parentDates.get(1)).toEqual(noActualDates);
    expect(result.projectDates).toEqual(noActualDates);
  });
});
