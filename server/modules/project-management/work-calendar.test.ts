import { beforeEach, describe, expect, it, vi } from "vitest";
import { GanttCalendar, ganttEpoch } from "../../../shared/gantt";
import {
  expandHolidayCalendar,
  holidayCalendarSettingsInput,
} from "../../../shared/work-calendar";
import type { Transaction } from "../../core/database";
import type { AccessContext } from "../../core/policy";
import {
  holidayCalendar,
  readGlobalWorkCalendar,
  saveHolidayCalendar,
} from "./work-calendar";

const fixture = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn();
  const database = {
    select: vi.fn(() => ({ from: () => ({ where }) })),
    update: vi.fn(() => ({ set })),
  };
  return { where, set, database, lockingRead: vi.fn(), recordChange: vi.fn() };
});

vi.mock("../../core/database", () => ({
  database: async () => ({
    ...fixture.database,
    transaction: async (run: (tx: typeof fixture.database) => unknown) =>
      run(fixture.database),
  }),
}));
vi.mock("../../core/audit", () => ({
  recordChange: fixture.recordChange,
}));
vi.mock("../../core/idempotency", () => ({
  once: async (
    _tx: unknown,
    _actor: number,
    _operation: string,
    _key: string,
    _payload: unknown,
    run: () => Promise<unknown>
  ) => run(),
}));

const calendarReader = fixture.database as unknown as Pick<
  Transaction,
  "select"
>;

const access = (allProjects: boolean, manage = true) =>
  ({
    user: {
      id: 15,
      role: "user",
      active: true,
      permissionCodes: manage ? ["pm.view", "pm.tasks.manage"] : ["pm.view"],
    },
    scope: { allProjects },
  }) as AccessContext;

const holiday = {
  name: "إجازة العيد",
  startDate: "2026-11-22",
  endDate: "2026-11-23",
};
const input = {
  key: "a8977e76-7c70-4339-a658-6d88737120d2",
  version: 0,
  weeklyDaysOff: [4, 5],
  holidays: [holiday],
};

describe("global work calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const row = { version: 0, weeklyDaysOff: [5, 6], holidays: [] };
    fixture.lockingRead.mockResolvedValue([row]);
    fixture.where.mockReturnValue(
      Object.assign(Promise.resolve([row]), { for: fixture.lockingRead })
    );
    fixture.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    fixture.recordChange.mockResolvedValue(undefined);
  });

  it("exposes the editable default without applying it to legacy calendars", async () => {
    expect(await holidayCalendar(access(true))).toEqual({
      version: 0,
      weeklyDaysOff: [5, 6],
      holidays: [],
      configured: false,
      canEdit: true,
    });
    await expect(readGlobalWorkCalendar(calendarReader)).resolves.toBeNull();
  });

  it("rejects calendar changes outside all-project scope or without task management", async () => {
    const scoped = access(false);
    expect((await holidayCalendar(scoped)).canEdit).toBe(false);
    await expect(saveHolidayCalendar(input, scoped)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      saveHolidayCalendar(input, access(true, false))
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it("locks the current version before saving and rejects stale edits", async () => {
    const payload = await saveHolidayCalendar(input, access(true));
    expect(fixture.lockingRead).toHaveBeenCalledWith("update");
    expect(payload).toMatchObject({
      version: 1,
      weeklyDaysOff: input.weeklyDaysOff,
      holidays: [holiday],
      configured: true,
    });
    expect(fixture.set).toHaveBeenCalledWith({
      version: 1,
      weeklyDaysOff: input.weeklyDaysOff,
      holidays: [holiday],
    });
    expect(fixture.recordChange).toHaveBeenCalledOnce();
    fixture.set.mockClear();
    fixture.lockingRead.mockResolvedValue([payload]);
    await expect(
      saveHolidayCalendar(input, access(true))
    ).rejects.toMatchObject({
      domainCode: "CONFLICT",
    });
    expect(fixture.set).not.toHaveBeenCalled();
  });

  it("uses the saved weekly days and inclusive distinct exception dates to count working days", async () => {
    const saved = {
      version: 1,
      weeklyDaysOff: [5, 6],
      holidays: [
        holiday,
        { name: "مناسبة", startDate: "2026-11-23", endDate: "2026-11-24" },
      ],
    };
    fixture.where.mockReturnValue(Promise.resolve([saved]));
    const effective = await readGlobalWorkCalendar(calendarReader);
    expect(effective).toEqual({
      version: 1,
      workingDays: [0, 1, 2, 3, 4],
      holidays: [
        { date: "2026-11-22", name: "إجازة العيد" },
        { date: "2026-11-23", name: "إجازة العيد" },
        { date: "2026-11-24", name: "مناسبة" },
      ],
    });
    const calendar = new GanttCalendar("2026-11-19", {
      ...expandHolidayCalendar(saved),
      hoursPerDay: 8,
    });
    expect(calendar.duration("2026-11-19", "2026-11-22")).toBe(1);
    expect(calendar.isWorkday(ganttEpoch("2026-11-24"))).toBe(false);
    expect(calendar.finish("2026-11-19", 2)).toBe("2026-11-25");
  });

  it("requires a weekly workday and rejects invalid dates or reversed holiday periods", () => {
    expect(
      holidayCalendarSettingsInput.safeParse({
        ...input,
        weeklyDaysOff: [0, 1, 2, 3, 4, 5, 6],
      }).success
    ).toBe(false);
    expect(
      holidayCalendarSettingsInput.safeParse({
        ...input,
        holidays: [{ ...holiday, endDate: "2026-02-30" }],
      }).success
    ).toBe(false);
    expect(
      holidayCalendarSettingsInput.safeParse({
        ...input,
        holidays: [{ ...holiday, endDate: "2026-11-21" }],
      }).success
    ).toBe(false);
  });
});
