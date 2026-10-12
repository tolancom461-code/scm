import { describe, expect, it } from "vitest";
import {
  decimal,
  formatDecimal,
  lineAmounts,
  multiply,
} from "../../shared/decimal";
import { payloadHash } from "./idempotency";
import { hasPermission } from "./permissions";

describe("exact decimal arithmetic", () => {
  it("calculates the olive order without floating point", () => {
    expect(lineAmounts("20", "10000")).toEqual({
      subtotal: "200000.00",
      tax: "0.00",
      total: "200000.00",
    });
    expect(lineAmounts("18", "10000").total).toBe("180000.00");
  });
  it("rounds discounts and VAT at explicit currency boundaries", () => {
    expect(lineAmounts("3", "0.10", "10", "15")).toEqual({
      subtotal: "0.27",
      tax: "0.04",
      total: "0.31",
    });
    expect(lineAmounts("2.5", "19.99", "5", "15")).toEqual({
      subtotal: "47.48",
      tax: "7.12",
      total: "54.60",
    });
  });
  it("uses symmetric half-up rounding and retains large values", () => {
    expect(formatDecimal(decimal("-1.005"))).toBe("-1.01");
    expect(formatDecimal(decimal("999999999999.999999"))).toBe(
      "1000000000000.00"
    );
    expect(formatDecimal(multiply(decimal("0.1"), decimal("0.2")), 6)).toBe(
      "0.020000"
    );
  });
  it("rejects invalid amounts, precision and percentages", () => {
    for (const value of ["NaN", "1e6", "1.0000001", "", " 1"])
      expect(() => decimal(value)).toThrow();
    expect(() => lineAmounts("0", "100")).toThrow();
    expect(() => lineAmounts("1", "100", "101")).toThrow();
    expect(() => lineAmounts("1", "-1")).toThrow();
    expect(() => formatDecimal(1n, 7)).toThrow();
  });
});
describe("idempotency payload identity", () => {
  it("is independent of object key ordering but preserves array order", () => {
    expect(payloadHash({ a: 1, b: { x: 2, y: 3 } })).toBe(
      payloadHash({ b: { y: 3, x: 2 }, a: 1 })
    );
    expect(payloadHash([1, 2])).not.toBe(payloadHash([2, 1]));
    expect(payloadHash({ quantity: "20" })).not.toBe(
      payloadHash({ quantity: "21" })
    );
  });
});
describe("server permissions", () => {
  it("requires the exact grant or administrator role", () => {
    expect(
      hasPermission(
        { role: "user", permissionCodes: ["master.view"] },
        "master.manage"
      )
    ).toBe(false);
    expect(
      hasPermission(
        { role: "user", permissionCodes: ["master.manage"] },
        "master.manage"
      )
    ).toBe(true);
    expect(
      hasPermission({ role: "admin", permissionCodes: [] }, "master.manage")
    ).toBe(true);
  });
});
