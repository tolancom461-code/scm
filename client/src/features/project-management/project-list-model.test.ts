import { describe, expect, it } from "vitest";
import {
  buildListGroups,
  completionPercent,
  deriveListProgress,
  type ListTaskNode,
} from "./project-list-model";

const project = {
  id: 10,
  number: "PRJ-10",
  name: "مشروع البرج",
  site: "موقع البرج",
};
const node = (
  id: number,
  parentId: number | null,
  statusCode = "not_started",
  projectId = 10
): ListTaskNode => ({
  id,
  parentId,
  projectId,
  statusCode,
  name: "مهمة " + id,
});

describe("project List completion", () => {
  it("counts executable leaves once, without treating a completed summary as another vote", () => {
    const progress = deriveListProgress([
      node(1, null, "done"),
      node(2, 1, "done"),
      node(3, 1),
      node(4, 3, "working"),
      node(5, 3, "done"),
    ]);
    expect(progress.get(1)).toEqual({ done: 2, total: 3, value: 67 });
    expect(progress.get(3)).toEqual({ done: 1, total: 2, value: 50 });
    expect(progress.get(2)).toEqual({ done: 1, total: 1, value: 100 });
  });
  it("excludes whole cancelled branches and does not invent progress for an empty eligible summary", () => {
    const progress = deriveListProgress([
      node(1, null),
      node(2, 1, "cancelled"),
      node(3, 2, "done"),
      node(4, 1, "done"),
      node(5, null),
      node(6, 5, "cancelled"),
    ]);
    expect(progress.get(1)).toEqual({ done: 1, total: 1, value: 100 });
    expect(progress.get(3)).toEqual({ done: 0, total: 0, value: 0 });
    expect(progress.get(5)).toEqual({ done: 0, total: 0, value: 0 });
    expect(completionPercent(199, 200)).toBe(99);
    expect(completionPercent(200, 200)).toBe(100);
  });
});

describe("project List hierarchy and filtering", () => {
  const options = {
    projects: [project],
    query: "",
    projectId: null,
    statusCode: "",
    collapsedProjects: new Set<number>(),
    collapsedTasks: new Set<number>(),
    assigneeNames: () => "",
  };
  it("keeps the full ancestor chain for an assignee match even when the project and branches are collapsed", () => {
    const tasks = [
      node(1, null),
      node(2, 1),
      node(3, 2),
      node(4, 3),
      node(5, 4),
      node(6, null),
    ];
    const groups = buildListGroups({
      ...options,
      tasks,
      query: "احمد",
      collapsedProjects: new Set([10]),
      collapsedTasks: new Set([1, 2, 3, 4]),
      assigneeNames: task => (task.id === 5 ? "م.أحمد وائل" : "خالد"),
    });
    expect(groups).toHaveLength(1);
    expect(
      groups[0].rows.map(row => [row.task.id, row.depth, row.context])
    ).toEqual([
      [1, 0, true],
      [2, 1, true],
      [3, 2, true],
      [4, 3, true],
      [5, 4, false],
    ]);
    expect(groups[0].matched).toBe(1);
    expect(groups[0].open).toBe(true);
  });
  it("keeps projects with no tasks, honors per-project/task collapse, and combines search with task status", () => {
    const tasks = [node(1, null), node(2, 1, "done"), node(3, 1, "working")];
    const empty = { ...project, id: 20, number: "PRJ-20", name: "مشروع فارغ" };
    const groups = buildListGroups({
      ...options,
      projects: [project, empty],
      tasks,
      collapsedTasks: new Set([1]),
    });
    expect(groups[0].rows.map(row => row.task.id)).toEqual([1]);
    expect(groups[1].tasks).toHaveLength(0);
    expect(groups[1].rows).toHaveLength(0);
    const filtered = buildListGroups({
      ...options,
      projects: [project, empty],
      tasks,
      query: "PRJ-10",
      statusCode: "done",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].rows.map(row => row.task.id)).toEqual([1, 2]);
    expect(filtered[0].matched).toBe(1);
  });
});
