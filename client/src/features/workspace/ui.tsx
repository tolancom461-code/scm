import { useState } from "react";
import { CheckCircle2, FileText, Plus, Search } from "lucide-react";
import { chrome, t, type Locale, type TranslationKey } from "@/lib/i18n";
export { Modal } from "@/components/Modal";
export function pageLocale() {
  return (
    document.documentElement.lang === "en"
      ? "en"
      : document.documentElement.lang === "ur"
        ? "ur"
        : "ar"
  ) as Locale;
}

export function Input({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <i> *</i> : null}
      </span>
      {children}
    </label>
  );
}

export function PageFrame({
  locale,
  title,
  action,
  actionLabel,
  children,
}: {
  locale: Locale;
  title: TranslationKey;
  action?: () => void;
  actionLabel?: TranslationKey;
  children: React.ReactNode;
}) {
  const t9 = (key: TranslationKey) => t(locale, key);
  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="eyebrow">
            {chrome(locale, "module")} // {t9(title)}
          </p>
          <h1>{t9(title)}</h1>
        </div>
        {action && actionLabel ? (
          <button className="neo-button" onClick={action}>
            <Plus size={16} />
            {t9(actionLabel)}
          </button>
        ) : null}
      </section>
      {children}
    </div>
  );
}

export function Table({
  headers,
  rows,
  empty,
}: {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  const locale = pageLocale();
  const [filter, setFilter] = useState("");
  const visible = rows.filter(row =>
    row
      .filter(c => typeof c === "string" || typeof c === "number")
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase())
  );
  return (
    <section className="data-panel">
      <div className="table-tools">
        <div className="search-shell">
          <Search size={15} />
          <input
            aria-label={chrome(locale, "search")}
            placeholder={chrome(locale, "search")}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <span>
          {visible.length.toString().padStart(2, "0")}{" "}
          {chrome(locale, "records")}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>
                  {typeof header === "string" ? header : header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      {typeof cell === "string" ? cell : cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>
                  <div className="empty-state">
                    <FileText size={26} />
                    {empty}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function FormFooter({
  t9,
  pending,
}: {
  t9: (key: TranslationKey) => string;
  pending: boolean;
}) {
  return (
    <div className="form-footer">
      <button className="neo-button" disabled={pending}>
        {pending ? chrome(pageLocale(), "syncingShort") : t9("create")}
        <CheckCircle2 size={16} />
      </button>
    </div>
  );
}
