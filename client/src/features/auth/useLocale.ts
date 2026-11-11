import { useEffect, useState } from "react";
import { localeMeta, type Locale } from "@/lib/i18n";
export function useLocale(preferred?: Locale, accountId?: number) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (preferred) return preferred;
    try {
      const stored = localStorage.getItem("procureflow.locale");
      return stored === "ar" || stored === "en" || stored === "ur"
        ? stored
        : "ar";
    } catch {
      return "ar";
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
  useEffect(() => {
    if (preferred) setLocale(preferred);
  }, [preferred, accountId]);
  const updateLocale = (next: Locale) => {
    applyLocale(next);
    setLocale(next);
  };
  return [locale, updateLocale] as const;
}
