import type { ReactNode } from "react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { opText, type OpLabel } from "./copy";
import { trpc } from "@/lib/trpc";
import "./operations.css";
export function Input({
  label,
  value,
  onChange,
  type = "text",
  required = true,
  locale,
}: {
  label: OpLabel;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  locale: Locale;
}) {
  return (
    <label>
      {opText(locale, label)}
      <input
        type={type}
        value={value}
        required={required}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}
export function Names({
  data,
  setData,
  locale,
}: {
  data: { nameAr: string; nameEn: string; nameUr: string };
  setData: (key: "nameAr" | "nameEn" | "nameUr", v: string) => void;
  locale: Locale;
}) {
  return (
    <>
      {(["nameAr", "nameEn", "nameUr"] as const).map(key => (
        <Input
          key={key}
          label={key}
          value={data[key]}
          onChange={v => setData(key, v)}
          locale={locale}
        />
      ))}
    </>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  locale,
}: {
  title: OpLabel;
  children: ReactNode;
  onClose: () => void;
  locale: Locale;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card op-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={opText(locale, title)}
      >
        <header>
          <h2>{opText(locale, title)}</h2>
          <button type="button" onClick={onClose}>
            {opText(locale, "close")}
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Pager({
  page,
  total,
  setPage,
  locale,
}: {
  page: number;
  total: number;
  setPage: (v: number) => void;
  locale: Locale;
}) {
  return (
    <footer className="op-actions">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        {opText(locale, "previous")}
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / 25))}
      </span>
      <button disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>
        {opText(locale, "next")}
      </button>
    </footer>
  );
}
export function UserPicker({
  module,
  value,
  onChange,
  label,
  locale,
}: {
  module: "workflows" | "projects";
  value: number;
  onChange: (v: number) => void;
  label: OpLabel;
  locale: Locale;
}) {
  const [search, setSearch] = useState("");
  const workflow = trpc.workflows.users.useQuery(
    { search, pageSize: 100 },
    { enabled: module === "workflows" }
  );
  const project = trpc.projects.users.useQuery(
    { search, pageSize: 100 },
    { enabled: module === "projects" }
  );
  const query = module === "workflows" ? workflow : project;
  return (
    <label>
      {opText(locale, label)}
      <input
        placeholder={opText(locale, "search")}
        aria-label={opText(locale, "search")}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select
        required
        value={value || ""}
        onChange={e => onChange(Number(e.target.value))}
      >
        <option value="">{opText(locale, "select")}</option>
        {value && !query.data?.some(u => u.id === value) && (
          <option value={value}>#{value}</option>
        )}
        {query.data?.map(u => (
          <option key={u.id} value={u.id}>
            {u.name ?? u.username}
          </option>
        ))}
      </select>
      {query.isError && <span role="alert">{opText(locale, "error")}</span>}
    </label>
  );
}
