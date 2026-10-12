import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { masterInput, masterKinds, type MasterKind } from "@shared/master-data";
import { localeMeta, type Locale } from "@/lib/i18n";
import { masterText, type MasterLabel } from "./copy";
import { fields, type Field } from "./fields";
import { toast } from "sonner";
import "./master-data.css";

type RecordData = {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  active: boolean;
  version: number;
};
const languageName = (row: RecordData, locale: Locale) =>
  locale === "ar" ? row.nameAr : locale === "ur" ? row.nameUr : row.nameEn;

export function ReferencePicker({
  kind,
  value,
  onChange,
  locale,
  optional,
  disabled,
  allowedIds,
}: {
  kind: MasterKind;
  value: string;
  onChange: (v: string) => void;
  locale: Locale;
  optional?: boolean;
  disabled?: boolean;
  allowedIds?: number[];
}) {
  const [search, setSearch] = useState("");
  const query = trpc.masterData.list.useQuery({
    kind,
    search,
    pageSize: 25,
    active: true,
  });
  const selected = trpc.masterData.detail.useQuery(
    { kind, id: Number(value) || 1 },
    { enabled: Boolean(value) }
  );
  const records = (query.data?.records ?? []).filter(r=>!allowedIds||allowedIds.includes(r.id));
  const text = (key: MasterLabel) => masterText(locale, key);
  return (
    <div className="md-reference">
      <input
        aria-label={text("search")}
        placeholder={text("search")}
        value={search}
        disabled={disabled}
        onChange={e => setSearch(e.target.value)}
      />
      <select
        aria-label={text(kind)}
        required={!optional}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{text(optional ? "none" : "select")}</option>
        {selected.data && !records.some(r => r.id === selected.data?.id) && (
          <option value={selected.data.id}>
            {selected.data.code} — {languageName(selected.data, locale)}
          </option>
        )}
        {records.map(row => (
          <option key={row.id} value={row.id}>
            {row.code} — {languageName(row, locale)}
          </option>
        ))}
      </select>
      {query.isError && <span role="alert">{text("error")}</span>}
    </div>
  );
}

function Editor({
  kind,
  record,
  locale,
  onClose,
}: {
  kind: MasterKind;
  record?: RecordData;
  locale: Locale;
  onClose: () => void;
}) {
  const text = (key: MasterLabel) => masterText(locale, key);
  const utils = trpc.useUtils();
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const result: Record<string, string | boolean> = {
      code: "",
      nameAr: "",
      nameEn: "",
      nameUr: "",
      active: true,
    };
    for (const field of fields[kind])
      result[field.key] =
        field.type === "boolean" ? false : (field.options?.[0] ?? "");
    if (record)
      for (const [key, value] of Object.entries(record))
        result[key] =
          typeof value === "boolean"
            ? value
            : value === null
              ? ""
              : String(value);
    return result;
  });
  const [reason, setReason] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  const done = () => {
    void utils.masterData.invalidate();
    toast.success(text("saved"));
    onClose();
  };
  const create = trpc.masterData.create.useMutation({
    onSuccess: done,
    onError: error => toast.error(error.message),
  });
  const update = trpc.masterData.update.useMutation({
    onSuccess: done,
    onError: error => toast.error(error.message),
  });
  const pending = create.isPending || update.isPending;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const raw: Record<string, unknown> = { ...values, kind };
    for (const field of fields[kind]) {
      if (field.type === "reference")
        raw[field.key] =
          values[field.key] === "" ? null : Number(values[field.key]);
      else if (field.optional && values[field.key] === "")
        raw[field.key] = null;
    }
    const parsed = masterInput.safeParse(raw);
    if (!parsed.success) {
      toast.error(text("invalid"));
      return;
    }
    if (record)
      update.mutate({
        data: parsed.data,
        id: record.id,
        version: record.version,
        reason,
      });
    else create.mutate({ data: parsed.data, key });
  };
  const renderField = (field: Field) => (
    <label className="field" key={field.key}>
      <span>{text(field.key)}</span>
      {field.type === "reference" && field.reference ? (
        <ReferencePicker
          kind={field.reference}
          value={String(values[field.key] ?? "")}
          onChange={v => setValues(p => ({ ...p, [field.key]: v }))}
          locale={locale}
          optional={field.optional}
          disabled={pending || Boolean(record && field.immutable)}
        />
      ) : field.type === "boolean" ? (
        <input
          type="checkbox"
          checked={Boolean(values[field.key])}
          disabled={pending || Boolean(record && field.immutable)}
          onChange={e =>
            setValues(p => ({ ...p, [field.key]: e.target.checked }))
          }
        />
      ) : field.type === "select" ? (
        <select
          value={String(values[field.key])}
          disabled={pending || Boolean(record && field.immutable)}
          onChange={e =>
            setValues(p => ({ ...p, [field.key]: e.target.value }))
          }
        >
          {field.options?.map(option => (
            <option key={option} value={option}>
              {text(option)}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={String(values[field.key] ?? "")}
          required={!field.optional}
          disabled={pending || Boolean(record && field.immutable)}
          inputMode={field.type === "decimal" ? "decimal" : "text"}
          maxLength={
            field.key === "code"
              ? 40
              : field.key === "description"
                ? 4000
                : field.key === "address"
                  ? 2000
                  : 200
          }
          onChange={e =>
            setValues(p => ({ ...p, [field.key]: e.target.value }))
          }
        />
      )}
    </label>
  );
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={text(record ? "edit" : "create")}
      >
        <header>
          <h2>
            {text(record ? "edit" : "create")} — {text(kind)}
          </h2>
          <button type="button" onClick={onClose} disabled={pending}>
            {text("cancel")}
          </button>
        </header>
        <form className="form-grid" onSubmit={submit}>
          {["code", "nameAr", "nameEn", "nameUr"].map(k =>
            renderField({ key: k as MasterLabel, type: "text" })
          )}
          {fields[kind].map(renderField)}
          {renderField({ key: "active", type: "boolean" })}
          {record && (
            <>
              <p>{text("immutable")}</p>
              <label className="field">
                <span>{text("reason")}</span>
                <input
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
            </>
          )}
          <div className="form-footer">
            <button className="neo-button" disabled={pending}>
              {text(pending ? "loading" : "save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ReferenceSummary({
  kind,
  id,
  locale,
}: {
  kind: MasterKind;
  id: number;
  locale: Locale;
}) {
  const query = trpc.masterData.detail.useQuery({ kind, id });
  if (query.isLoading) return <>{masterText(locale, "loading")}</>;
  if (!query.data)
    return (
      <>
        {masterText(locale, "error")} ({id})
      </>
    );
  return (
    <>
      {query.data.code} — {languageName(query.data, locale)}
    </>
  );
}

function Detail({
  kind,
  id,
  locale,
  onClose,
  onEdit,
  canManage,
}: {
  kind: MasterKind;
  id: number;
  locale: Locale;
  onClose: () => void;
  onEdit: (record: RecordData) => void;
  canManage: boolean;
}) {
  const query = trpc.masterData.detail.useQuery({ kind, id });
  const text = (key: MasterLabel) => masterText(locale, key);
  const row = query.data;
  const display = (key: string, value: unknown) => {
    const field = fields[kind].find(field => field.key === key);
    if (field?.reference && typeof value === "number")
      return (
        <ReferenceSummary kind={field.reference} id={value} locale={locale} />
      );
    if (field?.options?.includes(value as MasterLabel))
      return text(value as MasterLabel);
    return typeof value === "boolean"
      ? text(value ? "active" : "inactive")
      : value instanceof Date
        ? value.toLocaleString(localeMeta[locale].formatting)
        : value === null
          ? "—"
          : String(value);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={text("details")}
      >
        <header>
          <h2>{text("details")}</h2>
          <button onClick={onClose}>{text("cancel")}</button>
        </header>
        {query.isLoading ? (
          <p>{text("loading")}</p>
        ) : query.isError ? (
          <p role="alert">{text("error")}</p>
        ) : (
          row && (
            <>
              <dl className="md-details">
                {Object.entries(row)
                  .filter(([key]) => key !== "id")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{text(key as MasterLabel)}</dt>
                      <dd>{display(key, value)}</dd>
                    </div>
                  ))}
              </dl>
              {canManage && (
                <button className="neo-button" onClick={() => onEdit(row)}>
                  {text("edit")}
                </button>
              )}
            </>
          )
        )}
      </section>
    </div>
  );
}

function Records({
  kind,
  locale,
  canManage,
}: {
  kind: MasterKind;
  locale: Locale;
  canManage: boolean;
}) {
  const text = (key: MasterLabel) => masterText(locale, key);
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [page, setPage] = useState(1);
  const [status, setStatus] = useState("all"),
    [sort, setSort] = useState<"code" | "nameAr" | "nameEn" | "nameUr">("code");
  const [editor, setEditor] = useState<{ record?: RecordData } | null>(null),
    [detail, setDetail] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.masterData.list.useQuery({
    kind,
    search: debounced,
    page,
    pageSize: 25,
    sort,
    active: status === "all" ? undefined : status === "active",
  });
  return (
    <section className="data-panel md-records">
      <div className="md-toolbar">
        <input
          aria-label={text("search")}
          placeholder={text("search")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          aria-label={text("status")}
          value={status}
          onChange={e => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {["all", "active", "inactive"].map(s => (
            <option key={s} value={s}>
              {text(s as MasterLabel)}
            </option>
          ))}
        </select>
        <select
          aria-label={text("code")}
          value={sort}
          onChange={e => {
            setSort(e.target.value as typeof sort);
            setPage(1);
          }}
        >
          {["code", "nameAr", "nameEn", "nameUr"].map(s => (
            <option key={s} value={s}>
              {text(s as MasterLabel)}
            </option>
          ))}
        </select>
        {canManage && (
          <button className="neo-button" onClick={() => setEditor({})}>
            {text("create")}
          </button>
        )}
      </div>
      {query.isLoading ? (
        <p>{text("loading")}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{text("error")}</p>
          <button onClick={() => void query.refetch()}>{text("retry")}</button>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {["code", "nameAr", "nameEn", "nameUr", "status"].map(k => (
                    <th key={k}>{text(k as MasterLabel)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data?.records.map(row => (
                  <tr key={row.id}>
                    <td>
                      <button
                        className="table-action"
                        onClick={() => setDetail(row.id)}
                      >
                        {row.code}
                      </button>
                    </td>
                    <td>{row.nameAr}</td>
                    <td>{row.nameEn}</td>
                    <td>{row.nameUr}</td>
                    <td>
                      <span
                        className={`status ${row.active ? "active" : "blocked"}`}
                      >
                        {text(row.active ? "active" : "inactive")}
                      </span>
                    </td>
                  </tr>
                ))}
                {!query.data?.records.length && (
                  <tr>
                    <td colSpan={5}>{text("empty")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md-pagination">
            <span>
              {query.data?.total ?? 0} {text("records")} · {text("page")} {page}
            </span>
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              {text("previous")}
            </button>
            <button
              disabled={page * 25 >= (query.data?.total ?? 0)}
              onClick={() => setPage(p => p + 1)}
            >
              {text("next")}
            </button>
          </div>
        </>
      )}
      {editor && (
        <Editor
          kind={kind}
          record={editor.record}
          locale={locale}
          onClose={() => setEditor(null)}
        />
      )}
      {detail !== null && (
        <Detail
          kind={kind}
          id={detail}
          locale={locale}
          canManage={canManage}
          onClose={() => setDetail(null)}
          onEdit={record => {
            setDetail(null);
            setEditor({ record });
          }}
        />
      )}
    </section>
  );
}

export function MasterDataPage({
  locale,
  canManage,
}: {
  locale: Locale;
  canManage: boolean;
}) {
  const [kind, setKind] = useState<MasterKind>("items");
  return (
    <div className="page-stack">
      <section className="page-header">
        <h1>{masterText(locale, "masterData")}</h1>
      </section>
      <nav className="md-tabs" aria-label={masterText(locale, "masterData")}>
        {masterKinds.map(k => (
          <button
            key={k}
            aria-current={kind === k ? "page" : undefined}
            className={kind === k ? "active" : ""}
            onClick={() => setKind(k)}
          >
            {masterText(locale, k)}
          </button>
        ))}
      </nav>
      <Records key={kind} kind={kind} locale={locale} canManage={canManage} />
    </div>
  );
}
