import { describe, it, expect } from "vitest";
import { formatPercent, trimDecimal } from "../../../shared/display";
describe("exact percentage display", () => {
  it.each([
    ["50.0000", "50%"],
    ["50.5000", "50.5%"],
    ["50.2500", "50.25%"],
    ["50.005000", "50.005%"],
    ["50.000100", "50.0001%"],
    ["0.0000", "0%"],
    ["100.0000", "100%"],
  ])("displays %s as %s without rounding", (value, display) =>
    expect(formatPercent(value)).toBe(display)
  );
  it("leaves incomplete input untouched", () =>
    expect(trimDecimal("50.")).toBe("50."));
});
