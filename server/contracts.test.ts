import { describe, expect, it } from "vitest";
import { calculateCertificateNetDue, calculateContractEndDate } from "./contracts";

describe("دورة العقود", () => {
  it("يمدد تاريخ نهاية العقد بعدد الأيام المعتمد", () => {
    const result = calculateContractEndDate(new Date("2026-08-31T00:00:00.000Z"), 14);
    expect(result?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("يحافظ على تاريخ النهاية عند عدم وجود تمديد", () => {
    const date = new Date("2026-08-31T00:00:00.000Z");
    expect(calculateContractEndDate(date, 0)?.toISOString()).toBe(date.toISOString());
  });

  it("يحسب صافي المستخلص بعد القيمة السابقة والخصومات", () => {
    expect(calculateCertificateNetDue(25000, 12000, 1500)).toBe(11500);
  });
});
