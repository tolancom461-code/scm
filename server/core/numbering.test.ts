import { describe, expect, it } from "vitest";
import { documentPeriod, formatDocumentNumber } from "../../shared/numbering";

describe("central document numbering policy", () => {
  it("uses the Riyadh year and month at UTC boundaries", () => {
    expect(documentPeriod(new Date("2026-12-31T20:59:59Z"))).toEqual({
      year: 2026,
      month: "12",
    });
    expect(documentPeriod(new Date("2026-12-31T21:00:00Z"))).toEqual({
      year: 2027,
      month: "01",
    });
    expect(documentPeriod(new Date("2026-10-31T21:00:00Z"))).toEqual({
      year: 2026,
      month: "11",
    });
  });
  it("formats each document type without truncating larger counters", () => {
    expect(formatDocumentNumber("PRJ", 2026, "10", 1)).toBe("PRJ-26-10-0001");
    expect(formatDocumentNumber("CTR", 2026, "11", 2)).toBe("CTR-26-11-0002");
    expect(formatDocumentNumber("IPC", 2027, "01", 10000)).toBe(
      "IPC-27-01-10000"
    );
  });
  it("rejects invalid components and years outside the unambiguous century", () => {
    for (const [prefix, year, month, serial] of [
      ["bad", 2026, "10", 1],
      ["PRJ", 2026, "13", 1],
      ["PRJ", 2026, "10", 0],
      ["PRJ", 2100, "01", 1],
    ] as const)
      expect(() => formatDocumentNumber(prefix, year, month, serial)).toThrow();
  });
});
