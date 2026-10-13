import { useEffect } from "react";
import type { Locale } from "@/lib/i18n";
import { systemBrand, systemName, systemTitle } from "@/lib/branding";

export function useSystemTitle(page: string) {
  useEffect(() => {
    document.title = systemTitle(page);
  }, [page]);
}

export function SystemBrand({
  locale,
  landing = false,
}: {
  locale: Locale;
  landing?: boolean;
}) {
  return (
    <div className={`system-brand ${landing ? "system-brand-landing" : ""}`}>
      <strong dir={landing ? undefined : "ltr"}>
        {landing
          ? locale === "en"
            ? `${systemBrand.en} - ${systemBrand.abbreviation}`
            : systemName(locale)
          : systemBrand.abbreviation}
      </strong>
      <small dir={landing ? (locale === "en" ? "rtl" : "ltr") : undefined}>
        {landing
          ? locale === "en"
            ? systemBrand.ar
            : `${systemBrand.en} - ${systemBrand.abbreviation}`
          : systemName(locale)}
      </small>
    </div>
  );
}

export function SystemPrintFooter({ locale }: { locale: Locale }) {
  return (
    <p className="system-print-footer">
      {locale === "ar"
        ? "صادر من نظام"
        : locale === "en"
          ? "Issued by"
          : "نظام سے جاری کردہ"}{" "}
      <span dir="ltr">{systemBrand.abbreviation}</span>
    </p>
  );
}
