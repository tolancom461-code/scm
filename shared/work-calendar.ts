import { z } from "zod";
import {
  ganttDate,
  ganttEpoch,
  ganttIso,
  maxGlobalHolidayDays,
  type GanttHoliday,
} from "./gantt";

export { maxGlobalHolidayDays };
export const maxHolidayRangeDays = 366;
export const defaultWeeklyDaysOff = [5, 6];

const date = z.string().refine(ganttDate, "Invalid date");
export const holidayRangeInput = z
  .object({
    name: z.string().trim().min(2).max(150),
    startDate: date,
    endDate: date,
  })
  .superRefine(({ startDate, endDate }, ctx) => {
    if (!ganttDate(startDate) || !ganttDate(endDate)) return;
    const length = ganttEpoch(endDate) - ganttEpoch(startDate) + 1;
    if (length < 1 || length > maxHolidayRangeDays) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "اختر نهاية تبدأ من يوم بداية الإجازة وبحد أقصى 366 يومًا.",
      });
    }
  });

export type HolidayRange = z.infer<typeof holidayRangeInput>;

function holidayDayCount(holidays: HolidayRange[]) {
  const ranges = holidays
    .filter(period => ganttDate(period.startDate) && ganttDate(period.endDate))
    .map(period => [ganttEpoch(period.startDate), ganttEpoch(period.endDate)])
    .sort(([startA], [startB]) => startA - startB);
  let count = 0;
  let through = -Infinity;
  for (const [start, end] of ranges) {
    if (end < start || end <= through) continue;
    count += end - Math.max(start, through + 1) + 1;
    through = end;
    if (count > maxGlobalHolidayDays) break;
  }
  return count;
}

export const holidayCalendarSettingsInput = z.object({
  weeklyDaysOff: z
    .array(z.number().int().min(0).max(6))
    .max(6, "اترك يوم عمل واحدًا على الأقل في الأسبوع.")
    .refine(days => new Set(days).size === days.length, "Duplicate weekly day")
    .transform(days => [...days].sort((a, b) => a - b)),
  holidays: z
    .array(holidayRangeInput)
    .max(maxGlobalHolidayDays)
    .refine(
      holidays => holidayDayCount(holidays) <= maxGlobalHolidayDays,
      "تجاوز عدد تواريخ الإجازات الحد المسموح به."
    ),
});

export const saveHolidayCalendarInput = holidayCalendarSettingsInput.extend({
  key: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export type HolidayCalendarSettings = z.infer<
  typeof holidayCalendarSettingsInput
>;

export function expandHolidayCalendar(settings: HolidayCalendarSettings) {
  const daysOff = new Set(settings.weeklyDaysOff);
  const holidays = new Map<number, string>();
  for (const { startDate, endDate, name } of settings.holidays) {
    const end = ganttEpoch(endDate);
    for (let day = ganttEpoch(startDate); day <= end; day++) {
      if (!holidays.has(day)) holidays.set(day, name);
    }
  }
  return {
    workingDays: [0, 1, 2, 3, 4, 5, 6].filter(day => !daysOff.has(day)),
    holidays: [...holidays]
      .sort(([dayA], [dayB]) => dayA - dayB)
      .map(([day, name]): GanttHoliday => ({ date: ganttIso(day), name })),
  };
}
