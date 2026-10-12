import { useEffect, useState } from "react";
import { localeMeta, type Locale } from "@/lib/i18n";
export function useLocale(initial: Locale = "ar") {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem("procureflow.locale");
      return stored === "ar" || stored === "en" || stored === "ur"
        ? stored
        : initial;
    } catch {
      return initial;
    }
  });
  const applyLocale = (next: Locale) => {
    try {
      localStorage.setItem("procureflow.locale", next);
    } catch {
      /* Session language remains usable when storage is unavailable. */
    }
    document.documentElement.lang = next;
    document.documentElement.dir = localeMeta[next].direction;
  };
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);
  const updateLocale = (next: Locale) => {
    applyLocale(next);
    setLocale(next);
  };
  return [locale, updateLocale] as const;
}
