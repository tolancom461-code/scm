import { describe, expect, it } from "vitest";
import { chrome, localeMeta, translations } from "./i18n";

describe("واجهة اللغات الثلاث", () => {
  it("تحافظ على نفس مفاتيح الترجمة في العربية والإنجليزية والأردية", () => {
    const arabicKeys = Object.keys(translations.ar).sort();
    expect(Object.keys(translations.en).sort()).toEqual(arabicKeys);
    expect(Object.keys(translations.ur).sort()).toEqual(arabicKeys);
  });

  it("يطبق اتجاه RTL للعربية والأردية وLTR للإنجليزية", () => {
    expect(localeMeta.ar.direction).toBe("rtl");
    expect(localeMeta.ur.direction).toBe("rtl");
    expect(localeMeta.en.direction).toBe("ltr");
  });

  it("يستخدم الأرقام الغربية في عرض المبالغ والتواريخ بكل اللغات", () => {
    for (const { formatting } of Object.values(localeMeta)) {
      expect(new Intl.NumberFormat(formatting).format(123.5)).toBe("123.5");
      const parts = new Intl.DateTimeFormat(formatting, {
        timeZone: "UTC",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(new Date("2026-11-11T00:00:00Z"));
      for (const part of parts.filter(({ type }) =>
        ["year", "month", "day"].includes(type)
      )) {
        expect(part.value).toMatch(/^\d+$/);
      }
    }
  });

  it("يوفر عناوين تقنية مترجمة للصفحات الداخلية في اللغات الثلاث", () => {
    for (const locale of ["ar", "en", "ur"] as const) {
      expect(chrome(locale, "module")).toBeTruthy();
      expect(chrome(locale, "records")).toBeTruthy();
    }
  });
});
