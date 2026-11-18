import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { pmWorkCalendar } from "../../../drizzle/construction";
import {
  defaultWeeklyDaysOff,
  expandHolidayCalendar,
  type HolidayCalendarSettings,
  type saveHolidayCalendarInput,
} from "../../../shared/work-calendar";
import { recordChange } from "../../core/audit";
import { database, type Transaction } from "../../core/database";
import { DomainError } from "../../core/errors";
import { once } from "../../core/idempotency";
import { canAccess, type AccessContext } from "../../core/policy";

const calendarId = 1;
const calendarFilter = eq(pmWorkCalendar.id, calendarId);

function canEditCalendar(access: AccessContext) {
  return access.scope.allProjects && canAccess(access, "pm.tasks.manage");
}

async function readCalendar(db: Pick<Transaction, "select">, lock = false) {
  const query = db
    .select({
      weeklyDaysOff: pmWorkCalendar.weeklyDaysOff,
      holidays: pmWorkCalendar.holidays,
      version: pmWorkCalendar.version,
    })
    .from(pmWorkCalendar)
    .where(calendarFilter);
  const [row] = await (lock ? query.for("update") : query);
  return row;
}

export async function readGlobalWorkCalendar(
  db: Pick<Transaction, "select">,
  lock = false
) {
  const row = await readCalendar(db, lock);
  if (!row?.version) return null;
  return { ...expandHolidayCalendar(row), version: row.version };
}

export async function holidayCalendar(access: AccessContext) {
  const row = await readCalendar(await database());
  return {
    weeklyDaysOff: row?.weeklyDaysOff ?? [...defaultWeeklyDaysOff],
    holidays: row?.holidays ?? [],
    version: row?.version ?? 0,
    configured: Boolean(row?.version),
    canEdit: canEditCalendar(access),
  };
}

export async function saveHolidayCalendar(
  input: z.infer<typeof saveHolidayCalendarInput>,
  access: AccessContext
) {
  if (!canEditCalendar(access))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "تعديل تقويم الإجازات يتطلب صلاحية إدارة المهام لكل المشاريع.",
    });
  return (await database()).transaction(tx =>
    once(tx, access.user.id, "pm.calendar.save", input.key, input, async () => {
      const current = await readCalendar(tx, true);
      if (!current) throw new DomainError("SERVICE_UNAVAILABLE");
      if (current.version !== input.version) throw new DomainError("CONFLICT");
      const settings: HolidayCalendarSettings = {
        weeklyDaysOff: input.weeklyDaysOff,
        holidays: input.holidays,
      };
      const version = current.version + 1;
      const next = { ...settings, version };
      await tx.update(pmWorkCalendar).set(next).where(calendarFilter);
      await recordChange(tx, {
        actorId: access.user.id,
        action: "pm.calendar.saved",
        entityType: "pm_work_calendar",
        entityId: calendarId,
        before: current,
        after: next,
      });
      return { id: calendarId, ...next, configured: true, canEdit: true };
    })
  );
}
