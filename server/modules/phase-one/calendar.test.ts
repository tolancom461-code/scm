import { describe, it, expect } from "vitest";
import { addCalendarMonths } from "../../../shared/date";
describe("warranty calendar dates", () => {
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
