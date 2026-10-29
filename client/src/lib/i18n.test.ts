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

  it("يوفر عناوين تقنية مترجمة للصفحات الداخلية في اللغات الثلاث", () => {
    for (const locale of ["ar", "en", "ur"] as const) {
      expect(chrome(locale, "module")).toBeTruthy();
      expect(chrome(locale, "records")).toBeTruthy();
    }
  });
});
