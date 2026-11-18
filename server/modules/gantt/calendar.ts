import type {
  GanttCalendarSettings,
  GanttHoliday,
} from "../../../shared/gantt";

export function parseGanttJson<T>(
  value: string | null | undefined,
  fallback: T
): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

type StoredCalendar = {
  workingDays: string | null;
  hoursPerDay: number | null;
  holidays: string | null;
};

export type GlobalGanttCalendar = Pick<
  GanttCalendarSettings,
  "workingDays" | "holidays"
> & { version: number };

export function readGanttCalendarSettings(
  row: StoredCalendar | null | undefined,
  global?: GlobalGanttCalendar | null
) {
  return {
    workingDays:
      global?.workingDays ??
      parseGanttJson<number[]>(row?.workingDays, [0, 1, 2, 3, 4]),
    hoursPerDay: row?.hoursPerDay ?? 8,
    holidays:
      global?.holidays ?? parseGanttJson<GanttHoliday[]>(row?.holidays, []),
    calendarManaged: Boolean(global),
    calendarRevision: global?.version ?? 0,
  };
}

export function localCalendarValues(
  submitted: GanttCalendarSettings,
  stored: StoredCalendar | null | undefined,
  centrallyManaged: boolean
) {
  if (!centrallyManaged)
    return {
      workingDays: JSON.stringify(submitted.workingDays),
      holidays: JSON.stringify(submitted.holidays),
    };

  return {
    workingDays: stored?.workingDays ?? "[0,1,2,3,4]",
    holidays: stored?.holidays ?? "[]",
  };
}
