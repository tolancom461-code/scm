import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import type { ProcurementKind } from "@shared/procurement";
import { opText, opName, type OpLabel } from "../operations/copy";
export function SourcePicker({
  kind,
  value,
  onChange,
  locale,
  status,
  execution,
  label = "source",
}: {
  kind: ProcurementKind;
  value: number;
  onChange: (v: number) => void;
  locale: Locale;
  status?: string;
  execution?: "goods"|"works";
  label?: OpLabel;
}) {
  const [search, setSearch] = useState("");
  const list = trpc.procurement.list.useQuery({
    kind,
    search,
    status,
    execution,
    pageSize: 100,
  });
  return (
    <label>
      {opText(locale, label)}
      <input
        placeholder={opText(locale, "search")}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select
        aria-label={opText(locale,label)}
        required
        value={value || ""}
        onChange={e => onChange(Number(e.target.value))}
      >
        <option value="">{opText(locale, "select")}</option>
        {value && !list.data?.records.some(r => r.id === value) && (
          <option value={value}>#{value}</option>
        )}
        {list.data?.records.map(r => (
          <option key={r.id} value={r.id}>
            {r.number} —{" "}
            {opText(
              locale,
              r.status === "received" ? "receivedQuote" : (r.status as OpLabel)
            )}
          </option>
        ))}
      </select>
      {list.isError && <span role="alert">{opText(locale, "error")}</span>}
    </label>
  );
}
export function SupplierPicker({
  value,
  onChange,
  locale,
}: {
  value: number;
  onChange: (v: number) => void;
  locale: Locale;
}) {
  const [search, setSearch] = useState("");
  const query = trpc.procurement.suppliers.useQuery({ search, pageSize: 100 });
  return (
    <label>
      {opText(locale, "supplier")}
      <input
        placeholder={opText(locale, "search")}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select
        aria-label={opText(locale,"supplier")}
        required
        value={value || ""}
        onChange={e => onChange(Number(e.target.value))}
      >
        <option value="">{opText(locale, "select")}</option>
        {value && !query.data?.some(r => r.id === value) && (
          <option value={value}>#{value}</option>
        )}
        {query.data?.map(r => (
          <option value={r.id} key={r.id}>
            {r.code} —{" "}
            {locale === "ar"
              ? r.nameAr
              : locale === "ur"
                ? (r.nameUr ?? r.nameAr)
                : (r.nameEn ?? r.nameAr)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function ProjectPicker({
  value,
  onChange,
  locale,
}: {
  value: number;
  onChange: (v: number) => void;
  locale: Locale;
}) {
  const [search, setSearch] = useState("");
  const query = trpc.projects.list.useQuery({ search, pageSize: 100 });
  return (
    <label>
      {opText(locale, "projects")}
      <input
        placeholder={opText(locale, "search")}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select
        aria-label={opText(locale,"projects")}
        required
        value={value || ""}
        onChange={e => onChange(Number(e.target.value))}
      >
        <option value="">{opText(locale, "select")}</option>
        {query.data?.records
          .filter(r => r.status === "active")
          .map(r => (
            <option key={r.id} value={r.id}>
              {r.code} — {opName(r, locale)}
            </option>
          ))}
      </select>
    </label>
  );
}
