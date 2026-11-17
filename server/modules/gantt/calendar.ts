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

export function readGanttCalendarSettings(
  row: StoredCalendar | null | undefined
): GanttCalendarSettings {
  return {
    workingDays: parseGanttJson<number[]>(row?.workingDays, [0, 1, 2, 3, 4]),
    hoursPerDay: row?.hoursPerDay ?? 8,
    holidays: parseGanttJson<GanttHoliday[]>(row?.holidays, []),
  };
}
