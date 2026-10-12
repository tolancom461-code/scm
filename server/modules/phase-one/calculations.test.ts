import { describe, it, expect } from "vitest";
import {
  calculateSimpleCertificate,
  simpleContractInput,
  voucherKey,
} from "../../../shared/phase-one";
const base = {
  items: [
    { description: "Epoxy", quantity: "141", unit: "m2", unitPrice: "24" },
  ],
  quantities: ["126.9"],
  previousQuantities: ["0"],
  retentionPercent: "20",
  taxPercent: "0",
  dailyPenalty: "200",
  delayDays: 2,
  previousDelayDays: 0,
  previousPenalty: "0",
  otherDeduction: "414",
};
describe("phase one financial calculations", () => {
  it("reconciles the sample quantities, retention, delay and deduction", () =>
    expect(calculateSimpleCertificate(base)).toMatchObject({
      cumulativeGross: "3045.60",
      gross: "3045.60",
      retention: "609.12",
      penalty: "400.00",
      net: "1622.48",
      progress: "90.0000",
    }));
  it("only charges newly executed quantities and newly accrued delay", () =>
    expect(
      calculateSimpleCertificate({
        ...base,
        quantities: ["141"],
        previousQuantities: ["126.9"],
        previousDelayDays: 2,
        previousPenalty: "400",
        otherDeduction: "0",
      })
    ).toMatchObject({
      previousGross: "3045.60",
      gross: "338.40",
      retention: "67.68",
      penalty: "0.00",
      net: "270.72",
    }));
  it("rejects decreasing progress and quantities exceeding the contract", () => {
    expect(() =>
      calculateSimpleCertificate({ ...base, quantities: ["142"] })
    ).toThrow("QUANTITY_EXCEEDED");
    expect(() =>
      calculateSimpleCertificate({ ...base, previousQuantities: ["130"] })
    ).toThrow("QUANTITY_EXCEEDED");
    expect(() =>
      calculateSimpleCertificate({ ...base, otherDeduction: "4000" })
    ).toThrow("INVALID_INPUT");
  });
  it("requires every contract line and uses currency rounding", () => {
    expect(() =>
      calculateSimpleCertificate({ ...base, quantities: [] })
    ).toThrow();
    expect(
      calculateSimpleCertificate({
        ...base,
        items: [
          {
            description: "Small",
            quantity: "1",
            unit: "unit",
            unitPrice: "0.10",
          },
        ],
        quantities: ["0.3"],
        dailyPenalty: "0",
        delayDays: 0,
        retentionPercent: "0",
        taxPercent: "15",
        otherDeduction: "0",
      })
    ).toMatchObject({ gross: "0.03", tax: "0.00", net: "0.03" });
  });
  it("normalizes a voucher within its accounting year", () => {
    expect(voucherKey("  pv-1  ", "2026-10-11")).toBe(
      voucherKey("PV-1", "2026-01-01")
    );
    expect(voucherKey("PV-1", "2027-01-01")).not.toBe(
      voucherKey("PV-1", "2026-01-01")
    );
  });
  it("keeps cumulative tax and retention consistent across small certificates", () => {
    const calculate = (
      price: string,
      taxPercent: string,
      retentionPercent: string,
      quantity: string,
      previous: string
    ) =>
      calculateSimpleCertificate({
        ...base,
        items: [
          {
            description: "Small",
            quantity: "1",
            unit: "unit",
            unitPrice: price,
          },
        ],
        quantities: [quantity],
        previousQuantities: [previous],
        dailyPenalty: "0",
        delayDays: 0,
        otherDeduction: "0",
        taxPercent,
        retentionPercent,
      });
    expect(calculate("0.08", "15", "0", "0.5", "0")).toMatchObject({
      gross: "0.04",
      tax: "0.01",
      net: "0.05",
    });
    expect(calculate("0.08", "15", "0", "1", "0.5")).toMatchObject({
      gross: "0.04",
      tax: "0.00",
      net: "0.04",
    });
    expect(calculate("0.06", "0", "20", "0.5", "0")).toMatchObject({
      gross: "0.03",
      retention: "0.01",
      net: "0.02",
    });
    expect(calculate("0.06", "0", "20", "1", "0.5")).toMatchObject({
      gross: "0.03",
      retention: "0.00",
      net: "0.03",
    });
  });
  it("requires schedule percentages to total exactly 100", () => {
    const data = {
      projectId: 1,
      supplierId: 1,
      title: "Example",
      contractDate: "2026-01-01",
      siteDate: "2026-01-01",
      durationDays: 5,
      items: base.items,
      milestones: [
        {
          name: "First",
          percent: "30",
          dueDate: "2026-01-01",
          minProgress: "25",
        },
      ],
    };
    expect(simpleContractInput.safeParse(data).success).toBe(false);
    expect(
      simpleContractInput.safeParse({
        ...data,
        milestones: [{ ...data.milestones[0], percent: "100" }],
      }).success
    ).toBe(true);
  });
});
