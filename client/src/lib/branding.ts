import type { Locale } from "./i18n";

export const systemBrand = {
  abbreviation: "PSCM",
  ar: "إدارة المشاريع وسلاسل الإمداد",
  en: "Project & Supply Chain Management",
  ur: "منصوبوں اور سپلائی چین کا انتظام",
} as const;

export const systemName = (locale: Locale) => systemBrand[locale];
export const systemTitle = (page: string) =>
  `${systemBrand.abbreviation} · ${page}`;
