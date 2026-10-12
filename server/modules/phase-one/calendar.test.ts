import { describe, it, expect } from "vitest";
import { addCalendarMonths, addCalendarDays } from "../../../shared/date";
describe("warranty calendar dates", () => {
  it("counts exact days across leap years without treating them as months", () => {
    expect(addCalendarDays("2026-10-12", 731)).toBe("2028-10-12");
    expect(addCalendarDays("2026-10-12", 730)).toBe("2028-10-11");
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2026-10-12", 0)).toBe("2026-10-12");
  });
  it("clamps leap days and month ends", () => {
    expect(addCalendarMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2023-12-31", 2)).toBe("2024-02-29");
  });
  it("handles year transitions and a zero warranty", () => {
    expect(addCalendarMonths("2025-11-20", 12)).toBe("2026-11-20");
    expect(addCalendarMonths("2026-10-11", 0)).toBe("2026-10-11");
  });
});
