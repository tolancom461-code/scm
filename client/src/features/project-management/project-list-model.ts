export type ListTaskNode = {
  id: number;
  projectId: number;
  parentId: number | null;
  name: string;
  statusCode: string;
};

export type ListProjectNode = {
  id: number;
  name: string;
  number: string;
  site: string;
  cmmsSiteName?: string | null;
  cmmsSectionName?: string | null;
};

export type ListProgress = { done: number; total: number; value: number };

export function completionPercent(done: number, total: number) {
  return !total
    ? 0
    : done === total
      ? 100
      : Math.min(99, Math.round((done * 100) / total));
}

/** Count each executable leaf once; a cancelled ancestor excludes its whole branch. */
export function deriveListProgress<T extends ListTaskNode>(
  tasks: readonly T[]
) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const children = new Map<number, T[]>();
  const result = new Map<number, ListProgress>();
  const visiting = new Set<number>();
  for (const task of tasks) {
    const parent = task.parentId === null ? undefined : byId.get(task.parentId);
    if (!parent || parent.projectId !== task.projectId) continue;
    const list = children.get(parent.id) ?? [];
    list.push(task);
    children.set(parent.id, list);
  }
  function cancelledBranch(task: T) {
    const seen = new Set<number>();
    let current: T | undefined = task;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.statusCode === "cancelled") return true;
      const parent: T | undefined =
        current.parentId === null ? undefined : byId.get(current.parentId);
      current = parent?.projectId === task.projectId ? parent : undefined;
    }
    return false;
  }
  function derive(task: T): ListProgress {
    const cached = result.get(task.id);
    if (cached) return cached;
    if (visiting.has(task.id)) return { done: 0, total: 0, value: 0 };
    visiting.add(task.id);
    let done = 0,
      total = 0;
    if (!cancelledBranch(task)) {
      const kids = children.get(task.id) ?? [];
      if (kids.length) {
        for (const child of kids) {
          const progress = derive(child);
          done += progress.done;
          total += progress.total;
        }
      } else {
        total = 1;
        done = ["done", "completed"].includes(task.statusCode) ? 1 : 0;
      }
    }
    visiting.delete(task.id);
    const progress = { done, total, value: completionPercent(done, total) };
    result.set(task.id, progress);
    return progress;
  }
  for (const task of tasks) derive(task);
  return result;
}

export function normalizeListSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .trim();
}

export function buildListGroups<
  P extends ListProjectNode,
  T extends ListTaskNode,
>({
  projects,
  tasks,
  query,
  projectId,
  statusCode,
  collapsedProjects,
  collapsedTasks,
  assigneeNames,
}: {
  projects: readonly P[];
  tasks: readonly T[];
  query: string;
  projectId: number | null;
  statusCode: string;
  collapsedProjects: ReadonlySet<number>;
  collapsedTasks: ReadonlySet<number>;
  assigneeNames: (task: T) => string;
}) {
  const normalized = normalizeListSearch(query);
  const filtered = Boolean(normalized || statusCode);
  const byProject = new Map<number, T[]>();
  for (const task of tasks) {
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }
  return projects.flatMap(project => {
    if (projectId !== null && project.id !== projectId) return [];
    const projectTasks = byProject.get(project.id) ?? [];
    const byId = new Map(projectTasks.map(task => [task.id, task]));
    const children = new Map<number, T[]>();
    const roots: T[] = [];
    for (const task of projectTasks) {
      if (task.parentId === null || !byId.has(task.parentId)) roots.push(task);
      else {
        const list = children.get(task.parentId) ?? [];
        list.push(task);
        children.set(task.parentId, list);
      }
    }
    const projectMatches =
      normalized &&
      normalizeListSearch(
        [
          project.name,
          project.number,
          project.site,
          project.cmmsSiteName,
          project.cmmsSectionName,
        ].join(" ")
      ).includes(normalized);
    const direct = new Set(
      projectTasks
        .filter(
          task =>
            (!normalized ||
              projectMatches ||
              normalizeListSearch(
                [task.name, task.id, assigneeNames(task)].join(" ")
              ).includes(normalized)) &&
            (!statusCode || task.statusCode === statusCode)
        )
        .map(task => task.id)
    );
    if (filtered && !direct.size && !(projectMatches && !statusCode)) return [];
    const allowed = new Set(direct);
    for (const id of direct) {
      let current = byId.get(id);
      const seen = new Set<number>();
      while (
        current?.parentId !== null &&
        current?.parentId !== undefined &&
        !seen.has(current.parentId)
      ) {
        seen.add(current.parentId);
        allowed.add(current.parentId);
        current = byId.get(current.parentId);
      }
    }
    const rows: {
      task: T;
      depth: number;
      context: boolean;
      childCount: number;
    }[] = [];
    const seen = new Set<number>();
    const walk = (task: T, depth: number) => {
      if (seen.has(task.id) || (filtered && !allowed.has(task.id))) return;
      seen.add(task.id);
      const kids = children.get(task.id) ?? [];
      rows.push({
        task,
        depth,
        context: filtered && !direct.has(task.id),
        childCount: kids.length,
      });
      if (filtered || !collapsedTasks.has(task.id))
        for (const child of kids) walk(child, depth + 1);
    };
    const open = filtered || !collapsedProjects.has(project.id);
    if (open) for (const root of roots) walk(root, 0);
    return [
      {
        project,
        tasks: projectTasks,
        rows,
        roots,
        open,
        filtered,
        matched: filtered ? direct.size : projectTasks.length,
      },
    ];
  });
}

export function compactListDate(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "")
    ? value!.slice(8) + "/" + value!.slice(5, 7) + "/" + value!.slice(2, 4)
    : value || "—";
}
