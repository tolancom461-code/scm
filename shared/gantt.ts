import { z } from "zod";

export const ganttRelationTypes = ["FS", "SS", "FF", "SF"] as const;
export type GanttRelationType = (typeof ganttRelationTypes)[number];
export type GanttHoliday = { date: string; name: string };
export type GanttTask = {
  id: number;
  parentId: number | null;
  name: string;
  startDate: string;
  endDate: string;
  notBefore: string | null;
  isMilestone: boolean;
  statusCode: string;
  level: number;
  version: number;
};
export type GanttLink = {
  id: number;
  fromTaskId: number;
  toTaskId: number;
  type: GanttRelationType;
  lagDays: number;
};
export type GanttCalendarSettings = {
  workingDays: number[];
  hoursPerDay: number;
  holidays: GanttHoliday[];
};

const DAY = 86_400_000;
export function ganttDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}
export function ganttEpoch(value: string) {
  if (!ganttDate(value)) throw new Error("Invalid Gantt date: " + value);
  return Date.parse(value + "T00:00:00Z") / DAY;
}
export function ganttIso(day: number) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

const firstCalendarDay = ganttEpoch("0000-01-01");
const lastCalendarDay = ganttEpoch("9999-12-31");

export class GanttCalendar {
  readonly days: Set<number>;
  readonly holidays: Set<number>;
  readonly origin: number;
  private readonly weekdayHolidays: number[];
  constructor(start: string, settings: GanttCalendarSettings) {
    if (!settings.workingDays.length) throw new Error("No working days");
    this.days = new Set(settings.workingDays);
    this.holidays = new Set(
      settings.holidays.map(item => ganttEpoch(item.date))
    );
    this.weekdayHolidays = [...this.holidays]
      .filter(day => this.days.has(this.weekday(day)))
      .sort((a, b) => a - b);
    this.origin = this.snap(ganttEpoch(start), 1);
  }
  private weekday(day: number) {
    return (((day + 4) % 7) + 7) % 7;
  }
  isWorkday(day: number) {
    return this.days.has(this.weekday(day)) && !this.holidays.has(day);
  }
  snap(day: number, direction: 1 | -1) {
    let guard = 0;
    while (!this.isWorkday(day)) {
      day += direction;
      if (++guard > 3660) throw new Error("No workday in calendar range");
    }
    if (day < firstCalendarDay || day > lastCalendarDay)
      throw new Error("Date outside the supported calendar range");
    return day;
  }
  /** Count working days through day, with cost independent of the date span. */
  private workdaysThrough(day: number) {
    const length = day - firstCalendarDay + 1;
    let total = Math.floor(length / 7) * this.days.size;
    for (let offset = 0; offset < length % 7; offset++) {
      if (this.days.has(this.weekday(firstCalendarDay + offset))) total++;
    }
    let low = 0;
    let high = this.weekdayHolidays.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.weekdayHolidays[middle] <= day) low = middle + 1;
      else high = middle;
    }
    return total - low;
  }
  index(date: string, direction: 1 | -1 = 1) {
    const target = this.snap(ganttEpoch(date), direction);
    return this.workdaysThrough(target) - this.workdaysThrough(this.origin);
  }
  date(index: number) {
    if (!Number.isSafeInteger(index))
      throw new Error("Invalid calendar offset");
    if (index === 0) return ganttIso(this.origin);
    const ordinal = this.workdaysThrough(this.origin) + index;
    if (ordinal < 1 || ordinal > this.workdaysThrough(lastCalendarDay))
      throw new Error("Date outside the supported calendar range");
    let low = index < 0 ? firstCalendarDay : this.origin + 1;
    let high = index < 0 ? this.origin - 1 : lastCalendarDay;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.workdaysThrough(middle) < ordinal) low = middle + 1;
      else high = middle;
    }
    return ganttIso(low);
  }
  duration(start: string, end: string, milestone = false) {
    if (milestone) return 0;
    const first = this.snap(ganttEpoch(start), 1);
    const last = this.snap(ganttEpoch(end), -1);
    if (last < first) return 1;
    return Math.max(
      1,
      this.workdaysThrough(last) - this.workdaysThrough(first - 1)
    );
  }
  finish(start: string, duration: number) {
    const at = this.index(start);
    return this.date(at + Math.max(0, duration - 1));
  }
  shift(date: string, amount: number) {
    return this.date(this.index(date) + amount);
  }
}

function relationWeight(
  link: GanttLink,
  fromDuration: number,
  toDuration: number
) {
  return (
    link.lagDays +
    (link.type[0] === "F" ? fromDuration : 0) -
    (link.type[1] === "F" ? toDuration : 0)
  );
}

export type GanttMetric = {
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  duration: number;
};

export function analyzeGantt(
  tasks: GanttTask[],
  links: GanttLink[],
  settings: GanttCalendarSettings
) {
  if (!tasks.length)
    return {
      finish: null as string | null,
      metrics: {} as Record<number, GanttMetric>,
      criticalTaskIds: [] as number[],
      criticalLinkIds: [] as number[],
      issues: [] as number[],
    };
  const start = tasks.map(task => task.startDate).sort()[0];
  const calendar = new GanttCalendar(start, settings);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const incoming = new Map(tasks.map(task => [task.id, [] as GanttLink[]]));
  const outgoing = new Map(tasks.map(task => [task.id, [] as GanttLink[]]));
  for (const link of links) {
    if (
      link.fromTaskId === link.toTaskId ||
      !byId.has(link.fromTaskId) ||
      !byId.has(link.toTaskId)
    )
      throw new Error("Invalid Gantt dependency");
    incoming.get(link.toTaskId)!.push(link);
    outgoing.get(link.fromTaskId)!.push(link);
  }
  const indegree = new Map(
    tasks.map(task => [task.id, incoming.get(task.id)!.length])
  );
  const queue = tasks
    .filter(task => indegree.get(task.id) === 0)
    .map(t => t.id);
  const order: number[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const link of outgoing.get(id)!) {
      const count = indegree.get(link.toTaskId)! - 1;
      indegree.set(link.toTaskId, count);
      if (!count) queue.push(link.toTaskId);
    }
  }
  if (order.length !== tasks.length) throw new Error("Dependency cycle");
  const duration = new Map(
    tasks.map(task => [
      task.id,
      calendar.duration(task.startDate, task.endDate, task.isMilestone),
    ])
  );
  const early = new Map<number, number>();
  for (const id of order) {
    const task = byId.get(id)!;
    let value = Math.max(
      0,
      task.notBefore ? calendar.index(task.notBefore) : 0
    );
    for (const link of incoming.get(id)!)
      value = Math.max(
        value,
        early.get(link.fromTaskId)! +
          relationWeight(
            link,
            duration.get(link.fromTaskId)!,
            duration.get(id)!
          )
      );
    early.set(id, value);
  }
  const projectFinish = tasks.reduce(
    (finish, task) =>
      Math.max(finish, early.get(task.id)! + duration.get(task.id)!),
    0
  );
  const late = new Map<number, number>();
  for (const id of [...order].reverse()) {
    let value = projectFinish - duration.get(id)!;
    for (const link of outgoing.get(id)!)
      value = Math.min(
        value,
        late.get(link.toTaskId)! -
          relationWeight(link, duration.get(id)!, duration.get(link.toTaskId)!)
      );
    late.set(id, value);
  }
  const metrics: Record<number, GanttMetric> = {};
  const criticalTaskIds: number[] = [];
  for (const task of tasks) {
    const es = early.get(task.id)!;
    const d = duration.get(task.id)!;
    const ls = late.get(task.id)!;
    const successors = outgoing.get(task.id)!;
    const freeFloat = successors.length
      ? successors.reduce(
          (available, link) =>
            Math.min(
              available,
              early.get(link.toTaskId)! -
                es -
                relationWeight(link, d, duration.get(link.toTaskId)!)
            ),
          Number.POSITIVE_INFINITY
        )
      : projectFinish - es - d;
    const totalFloat = ls - es;
    const critical = totalFloat === 0;
    if (critical) criticalTaskIds.push(task.id);
    const span = Math.max(0, d - 1);
    metrics[task.id] = {
      earlyStart: calendar.date(es),
      earlyFinish: calendar.date(es + span),
      lateStart: calendar.date(ls),
      lateFinish: calendar.date(ls + span),
      totalFloat,
      freeFloat,
      critical,
      duration: d,
    };
  }
  const critical = new Set(criticalTaskIds);
  const criticalLinkIds = links
    .filter(link => {
      if (!critical.has(link.fromTaskId) || !critical.has(link.toTaskId))
        return false;
      return (
        early.get(link.toTaskId) ===
        early.get(link.fromTaskId)! +
          relationWeight(
            link,
            duration.get(link.fromTaskId)!,
            duration.get(link.toTaskId)!
          )
      );
    })
    .map(link => link.id);
  const issues = links
    .filter(link => {
      const from = byId.get(link.fromTaskId)!;
      const to = byId.get(link.toTaskId)!;
      return (
        calendar.index(to.startDate) <
        calendar.index(from.startDate) +
          relationWeight(link, duration.get(from.id)!, duration.get(to.id)!)
      );
    })
    .map(link => link.id);
  return {
    finish: calendar.date(Math.max(0, projectFinish - 1)),
    metrics,
    criticalTaskIds,
    criticalLinkIds,
    issues,
  };
}

export function ganttProgress(tasks: GanttTask[]) {
  const parents = new Set(tasks.map(task => task.parentId).filter(Boolean));
  const leaves = tasks.filter(task => !parents.has(task.id));
  const done = leaves.filter(task => task.statusCode === "done").length;
  return {
    done,
    total: leaves.length,
    percent: leaves.length
      ? done === leaves.length
        ? 100
        : Math.min(99, Math.round((done * 100) / leaves.length))
      : 0,
  };
}

const dateField = z.string().refine(ganttDate, "Invalid date");
const key = z.string().uuid();
const distinctHolidayDates = (holidays: { date: string }[]) =>
  new Set(holidays.map(holiday => holiday.date)).size === holidays.length;
export const ganttSettingsInput = z.object({
  key,
  projectId: z.number().int().positive(),
  version: z.number().int().nonnegative().default(0),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform(v => [...new Set(v)]),
  hoursPerDay: z.number().int().min(1).max(24),
  holidays: z
    .array(
      z.object({ date: dateField, name: z.string().trim().min(2).max(150) })
    )
    .max(366)
    .refine(distinctHolidayDates, "Duplicate holiday date"),
  mode: z.enum(["smart", "free"]),
  statusDate: dateField.nullable(),
  deadline: dateField.nullable(),
});
export const ganttLinkInput = z.object({
  key,
  projectId: z.number().int().positive(),
  id: z.number().int().positive().optional(),
  version: z.number().int().nonnegative().default(0),
  action: z.enum(["save", "delete"]).default("save"),
  fromTaskId: z.number().int().positive(),
  toTaskId: z.number().int().positive(),
  type: z.enum(ganttRelationTypes),
  lagDays: z.number().int().min(-2000).max(2000),
});
export const ganttScheduleInput = z.object({
  key,
  projectId: z.number().int().positive(),
  updates: z
    .array(
      z.object({
        taskId: z.number().int().positive(),
        version: z.number().int().nonnegative(),
        startDate: dateField,
        endDate: dateField,
        notBefore: dateField.nullable(),
        isMilestone: z.boolean(),
      })
    )
    .min(1)
    .max(500),
});
export const ganttBaselineInput = z.object({
  key,
  projectId: z.number().int().positive(),
  name: z.string().trim().min(2).max(160),
});

export const ganttProjectScheduleInput = z
  .object({
    key,
    projectId: z.number().int().positive(),
    version: z.number().int().nonnegative(),
    action: z.enum(["configure", "start", "extend", "lock"]),
    plannedStartDate: dateField.nullable().optional(),
    plannedEndDate: dateField.nullable().optional(),
    actualStartDate: dateField.optional(),
    extensionEndDate: dateField.optional(),
    extensionDays: z.number().int().min(0).max(10000).optional(),
    reason: z.string().trim().max(2000).default(""),
    startLocked: z.boolean().optional(),
    endLocked: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "start" && !value.actualStartDate)
      ctx.addIssue({
        code: "custom",
        path: ["actualStartDate"],
        message: "حدد تاريخ البدء الفعلي",
      });
    if (
      value.action === "extend" &&
      !value.extensionEndDate &&
      value.extensionDays === undefined
    )
      ctx.addIssue({
        code: "custom",
        path: ["extensionDays"],
        message: "حدد تاريخ النهاية الجديد أو مدة التمديد",
      });
  });

export const ganttSharedGroupInput = z.object({
  key,
  id: z.number().int().positive().optional(),
  version: z.number().int().nonnegative().default(0),
  action: z.enum(["save", "delete"]).default("save"),
  name: z.string().trim().min(2).max(255),
  taskIds: z
    .array(z.number().int().positive())
    .min(2)
    .max(100)
    .transform(v => [...new Set(v)]),
  syncDates: z.boolean().default(true),
  syncStatus: z.boolean().default(true),
  syncAssignees: z.boolean().default(false),
});

const studioTask = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
    name: z.string().trim().min(1).max(255),
    duration: z.number().int().min(0).max(2000),
    phase: z.string().max(2000),
    owner: z.string().max(2000),
    progress: z.number().int().min(0).max(100),
    start: dateField,
    notBefore: dateField.nullable(),
    notes: z.string().max(2000),
    parentId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,50}$/)
      .nullable(),
    executionStatus: z.enum(["not_started", "in_progress", "completed"]),
    status: z.enum(["not_started", "in_progress", "completed"]).optional(),
    pmTaskId: z.number().int().positive().optional(),
    pmVersion: z.number().int().nonnegative().optional(),
    pmStatusId: z.number().int().positive().optional(),
    pmStatusCode: z.string().max(60).optional(),
    pmPriority: z.enum(["critical", "high", "medium", "low"]).optional(),
    pmEmployeeIds: z.array(z.number().int().positive()).max(50).optional(),
    startLocked: z.boolean().optional(),
    endLocked: z.boolean().optional(),
    plannedStart: dateField.nullable().optional(),
    plannedEnd: dateField.nullable().optional(),
    actualStart: dateField.nullable().optional(),
    actualEnd: dateField.nullable().optional(),
  })
  .passthrough();

export const ganttStudioStateInput = z.object({
  key,
  projectId: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  state: z
    .object({
      schemaVersion: z.literal(2),
      completionModel: z.literal("leaf-count-v1"),
      project: z
        .object({
          id: z.string().max(50),
          name: z.string().trim().min(1).max(255),
          description: z.string().max(10000),
          start: dateField,
          statusDate: dateField,
          deadline: dateField.nullable(),
          mode: z.enum(["smart", "free"]),
        })
        .passthrough(),
      calendar: z
        .object({
          workingDays: z
            .array(z.number().int().min(0).max(6))
            .min(1)
            .max(7)
            .refine(
              days => new Set(days).size === days.length,
              "Duplicate working day"
            ),
          hoursPerDay: z.number().int().min(1).max(24),
          holidays: z
            .array(
              z
                .object({ date: dateField, name: z.string().max(150) })
                .passthrough()
            )
            .max(366)
            .refine(distinctHolidayDates, "Duplicate holiday date"),
        })
        .passthrough(),
      tasks: z.array(studioTask).max(500),
      links: z
        .array(
          z
            .object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
              from: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
              to: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
              type: z.enum(ganttRelationTypes),
              lag: z.number().int().min(-2000).max(2000),
              pmLinkId: z.number().int().positive().optional(),
            })
            .passthrough()
        )
        .max(3000),
      baseline: z
        .object({
          tasks: z
            .array(
              z
                .object({
                  id: z.string(),
                  start: dateField,
                  finish: dateField,
                  duration: z.number().int().min(0).max(2000),
                })
                .passthrough()
                .refine(
                  task => task.start <= task.finish,
                  "Invalid baseline dates"
                )
            )
            .max(500)
            .refine(
              tasks =>
                new Set(tasks.map(task => task.id)).size === tasks.length,
              "Duplicate baseline task"
            ),
        })
        .passthrough()
        .nullable()
        .default(null),
      activity: z
        .array(
          z
            .object({
              action: z.string().max(500),
              at: z
                .string()
                .max(50)
                .refine(
                  value => Number.isFinite(Date.parse(value)),
                  "Invalid activity date"
                ),
            })
            .passthrough()
        )
        .max(100),
    })
    .passthrough(),
});
