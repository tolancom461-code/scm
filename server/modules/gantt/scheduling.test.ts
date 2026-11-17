import { describe, expect, it } from "vitest";
import { GanttCalendar } from "../../../shared/gantt";
import {
  calendarDays,
  dependencyDateMovement,
  dependencyTargetMovement,
  lockedTaskDateChanged,
  planDependencyMovement,
  propagateTaskChanges,
  shiftIso,
} from "./scheduling";

describe("project schedule date movement", () => {
  it("keeps the duration while shifting from planned to actual start", () => {
    const delta = calendarDays("2026-10-01", "2026-10-03");
    expect(delta).toBe(2);
    expect(shiftIso("2026-10-01", delta)).toBe("2026-10-03");
    expect(shiftIso("2026-10-10", delta)).toBe("2026-10-12");
  });

  it("calculates extension days from the original planned finish", () => {
    expect(calendarDays("2026-10-20", "2026-10-27")).toBe(7);
  });

  it("blocks changes only to the locked task endpoint", () => {
    const dates = { startDate: "2026-10-01", endDate: "2026-10-05" };
    const nextStart = { ...dates, startDate: "2026-10-02" };
    const nextEnd = { ...dates, endDate: "2026-10-06" };
    const startLock = { startLocked: true, endLocked: false };
    const endLock = { startLocked: false, endLocked: true };
    expect(lockedTaskDateChanged(dates, nextStart, startLock)).toBe(true);
    expect(lockedTaskDateChanged(dates, nextEnd, startLock)).toBe(false);
    expect(lockedTaskDateChanged(dates, nextStart, endLock)).toBe(false);
    expect(lockedTaskDateChanged(dates, nextEnd, endLock)).toBe(true);
  });
});

describe("Studio dependency calendars", () => {
  const calendar = new GanttCalendar("2026-10-29", {
    workingDays: [1, 2, 3, 4, 5],
    hoursPerDay: 8,
    holidays: [{ date: "2026-11-02", name: "Office closure" }],
  });
  const fs = { type: "FS", lagDays: 0 };
  const predecessor = {
    projectId: 1,
    startDate: "2026-10-29",
    endDate: "2026-10-30",
    isMilestone: false,
  };
  const successor = {
    ...predecessor,
    startDate: "2026-10-30",
    endDate: "2026-11-03",
  };

  it("leaves internal dependencies manual in free mode and still moves cross-project successors", () => {
    const editor = { projectId: 1, mode: "free" as const, calendar };
    expect(
      dependencyDateMovement(fs, predecessor, successor, editor)
    ).toBeNull();
    const external = { ...successor, projectId: 2 };
    const move = dependencyDateMovement(fs, predecessor, external, editor);
    expect(move?.(external, false)).toEqual({
      startDate: "2026-10-31",
      endDate: "2026-11-04",
    });
  });

  it("moves smart-mode successors by working days and preserves their working duration", () => {
    const editor = { projectId: 1, mode: "smart" as const, calendar };
    const move = dependencyDateMovement(fs, predecessor, successor, editor);
    expect(move?.(successor, false)).toEqual({
      startDate: "2026-11-03",
      endDate: "2026-11-04",
    });
  });

  it("keeps a milestone and its smart-mode finish-to-start successor on the same day", () => {
    const editor = { projectId: 1, mode: "smart" as const, calendar };
    const milestone = {
      ...predecessor,
      startDate: predecessor.endDate,
      isMilestone: true,
    };
    expect(dependencyDateMovement(fs, milestone, successor, editor)).toBeNull();
  });
});

describe("task-centered cross-project dependency movement", () => {
  const from = {
    task: {
      id: 1,
      name: "Drawings",
      parentId: null,
      projectId: 1,
      startDate: "2026-11-01",
      endDate: "2026-11-05",
    },
    status: "done",
    settings: null,
  };
  const to = {
    task: {
      id: 2,
      name: "Install",
      parentId: null,
      projectId: 2,
      startDate: "2026-11-04",
      endDate: "2026-11-08",
    },
    status: "not_started",
    settings: null,
  };
  const child = {
    ...to,
    task: {
      ...to.task,
      id: 3,
      parentId: to.task.id,
      name: "Equipment",
      startDate: "2026-11-07",
    },
  };

  it("computes the dates to write without modifying the source schedule", () => {
    const move = dependencyTargetMovement({ type: "FS", lagDays: 1 }, from, to);
    const planned = planDependencyMovement(to.task.id, [to, child], move!);

    expect(planned.movingIds).toEqual([2, 3]);
    expect(planned.movingTasks.map(row => row.dates)).toEqual([
      { startDate: "2026-11-07", endDate: "2026-11-11" },
      { startDate: "2026-11-10", endDate: "2026-11-11" },
    ]);
    expect(to.task.startDate).toBe("2026-11-04");
    expect(child.task.startDate).toBe("2026-11-07");
  });

  it("uses the same started-task and descendant lock guards for preview and save", () => {
    const link = { type: "FS", lagDays: 0 };
    const started = { ...to, status: "working" };
    expect(() => dependencyTargetMovement(link, from, started)).toThrow(
      "Install"
    );
    expect(
      dependencyTargetMovement({ ...link, lagDays: -2 }, from, started)
    ).toBeNull();

    const move = dependencyTargetMovement(link, from, to);
    const locked = {
      ...child,
      settings: { isMilestone: false, startLocked: false, endLocked: true },
    };
    expect(() =>
      planDependencyMovement(to.task.id, [to, locked], move!)
    ).toThrow("Equipment");
  });
});

const noChanges = { dateTaskIds: [], projectIds: [] };
const edge = (fromTaskId: number, toTaskId: number, lagDays = 0) => ({
  id: fromTaskId * 100 + toTaskId,
  fromTaskId,
  toTaskId,
  type: "SS",
  lagDays,
});

describe("schedule change propagation", () => {
  it("starts with only the explicitly saved link, then follows resulting changes", async () => {
    const checked: number[] = [];
    const selected = edge(1, 3);
    await propagateTaskChanges(
      {
        sharedTaskIds: [],
        dependencyTaskIds: [],
        dependencyLinkIds: [selected.id],
      },
      [edge(1, 2), selected, edge(3, 4)],
      async () => noChanges,
      async link => {
        checked.push(link.toTaskId);
        return { dateTaskIds: [link.toTaskId], projectIds: [1] };
      }
    );
    expect(checked).toEqual([3, 4]);
  });

  it("revisits successors after a longer predecessor path changes the dates", async () => {
    const starts = new Map([[1, 10]]);
    await propagateTaskChanges(
      { sharedTaskIds: [], dependencyTaskIds: [1] },
      [edge(1, 2), edge(1, 4), edge(2, 3), edge(4, 5), edge(5, 2, 3)],
      async () => noChanges,
      async ({ fromTaskId, toTaskId, lagDays }) => {
        const required = starts.get(fromTaskId)! + lagDays;
        if ((starts.get(toTaskId) ?? 0) >= required) return noChanges;
        starts.set(toTaskId, required);
        return { dateTaskIds: [toTaskId], projectIds: [1] };
      }
    );
    expect(starts.get(3)).toBe(13);
  });

  it("follows date changes from shared peers, descendants and rolled-up ancestors", async () => {
    const checked: number[] = [];
    const affected = await propagateTaskChanges(
      { sharedTaskIds: [1], dependencyTaskIds: [] },
      [edge(2, 3), edge(4, 7), edge(5, 8), edge(6, 9)],
      async (taskId, includeStatusAndAssignees) => {
        if (taskId === 1 && includeStatusAndAssignees)
          return { dateTaskIds: [2], projectIds: [10] };
        if (taskId === 4 && !includeStatusAndAssignees)
          return { dateTaskIds: [6], projectIds: [30] };
        return noChanges;
      },
      async ({ fromTaskId, toTaskId }) => {
        checked.push(fromTaskId);
        return fromTaskId === 2
          ? { dateTaskIds: [toTaskId, 4, 5], projectIds: [20] }
          : noChanges;
      }
    );
    expect(checked).toEqual([2, 4, 5, 6]);
    expect(affected).toEqual([10, 20, 30]);
  });

  it("rejects schedule effects that keep changing each other", async () => {
    await expect(
      propagateTaskChanges(
        { sharedTaskIds: [], dependencyTaskIds: [1] },
        [edge(1, 2)],
        async taskId =>
          taskId === 2 ? { dateTaskIds: [1], projectIds: [1] } : noChanges,
        async () => ({ dateTaskIds: [2], projectIds: [2] })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
