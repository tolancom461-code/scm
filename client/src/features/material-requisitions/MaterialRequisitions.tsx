import { useEffect, useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { businessDate } from "@shared/date";
import {
  dateFromLead,
  leadDays,
  materialRequisitionListInput,
} from "@shared/material-requisitions";
import { mrText, type MrKey } from "./copy";
import "./material-requisitions.css";

type Outputs = inferRouterOutputs<AppRouter>["materialRequisitions"];
type Directory = Outputs["directory"];
type Row = Outputs["list"]["rows"][number];
type Detail = Outputs["detail"];
type User = { id?: number; permissions: string[] };
type ItemDraft = {
  catalogEntryId: number | null;
  catalogCode: string;
  imageUrl: string | null;
  importedUnit?: Directory["units"][number];
  itemName: string;
  quantity: string;
  unitId: number;
  specifications: string;
  notes: string;
  needDate: string;
};
const defaults = () => materialRequisitionListInput.parse({});
const compactNumber = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const unitName = (unit: Directory["units"][number], locale: Locale) =>
  locale === "ar" ? unit.nameAr : locale === "en" ? unit.nameEn : unit.nameUr;
const isoDate = (date: Date | string | null) =>
  date ? businessDate(new Date(date)) : "—";
const externalKeys = new Set([
  "pending_send",
  "sending",
  "received",
  "purchase_request_created",
  "send_failed",
  "rejected",
]);
function externalLabel(status: string | null, locale: Locale) {
  return status && externalKeys.has(status)
    ? mrText(locale, status as MrKey)
    : "—";
}
function initialItem(unitId: number, needDate = ""): ItemDraft {
  return {
    catalogEntryId: null,
    catalogCode: "",
    imageUrl: null,
    itemName: "",
    quantity: "",
    unitId,
    specifications: "",
    notes: "",
    needDate,
  };
}
const occupiedItem = (item: ItemDraft) =>
  Boolean(
    item.catalogEntryId ||
      item.itemName.trim() ||
      item.quantity ||
      item.specifications.trim() ||
      item.notes.trim()
  );

function localImageUrl(value: string | null | undefined) {
  if (!value || !value.startsWith("/material-requisitions/")) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}`
      : null;
  } catch {
    return null;
  }
}

function ItemImage({
  url,
  name,
  locale,
}: {
  url?: string | null;
  name: string;
  locale: Locale;
}) {
  const c = (key: MrKey) => mrText(locale, key),
    source = localImageUrl(url);
  const [enlarged, setEnlarged] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [source]);
  if (!source || failed)
    return <span className="mr-no-image">{c("noImage")}</span>;
  return (
    <>
      <button
        type="button"
        className="mr-image-button"
        aria-label={`${c("enlargeImage")} — ${name}`}
        title={c("enlargeImage")}
        onClick={() => setEnlarged(true)}
      >
        <img
          className="mr-item-image"
          src={source}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </button>
      {enlarged && (
        <div
          className="mr-image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={c("itemImage")}
          onClick={() => setEnlarged(false)}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEnlarged(false);
            }
          }}
        >
          <button type="button" autoFocus onClick={() => setEnlarged(false)}>
            {c("close")}
          </button>
          <figure onClick={event => event.stopPropagation()}>
            <img src={source} alt={name} />
            <figcaption>{name}</figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

export function MaterialRequisitions({
  locale,
  user,
}: {
  locale: Locale;
  user: User;
}) {
  const c = (key: MrKey) => mrText(locale, key),
    can = (p: string) => user.permissions.includes(p),
    utils = trpc.useUtils();
  const [filters, setFilters] = useState(defaults),
    [applied, setApplied] = useState(defaults);
  const [form, setForm] = useState<{
      id?: number;
      projectId?: number;
      taskId?: number | null;
    } | null>(null),
    [viewId, setViewId] = useState(0),
    [unitsOpen, setUnitsOpen] = useState(false);
  const [filterName, setFilterName] = useState(""),
    [grouped, setGrouped] = useState(false);
  const filterKey = `pscm-mr-filters-${user.id ?? "local"}`;
  const [presets, setPresets] = useState<
    { name: string; filters: ReturnType<typeof defaults> }[]
  >(() => {
    try {
      const value = JSON.parse(localStorage.getItem(filterKey) ?? "[]");
      return Array.isArray(value)
        ? value.filter(
            item =>
              typeof item.name === "string" &&
              materialRequisitionListInput.safeParse(item.filters).success
          )
        : [];
    } catch {
      return [];
    }
  });
  const directory = trpc.materialRequisitions.directory.useQuery(),
    list = trpc.materialRequisitions.list.useQuery(applied);
  const approve = trpc.materialRequisitions.approve.useMutation({
    onSuccess: () => {
      void utils.materialRequisitions.invalidate();
      toast.success(c("approvedDone"));
    },
    onError: e => toast.error(e.message),
  });
  const savePreset = () => {
    if (!filterName.trim()) return;
    const next = [
      ...presets.filter(p => p.name !== filterName.trim()),
      { name: filterName.trim(), filters },
    ].slice(-20);
    setPresets(next);
    localStorage.setItem(filterKey, JSON.stringify(next));
    setFilterName("");
  };
  const rows = list.data?.rows ?? [],
    total = list.data?.total ?? 0;
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const key = grouped ? row.projectId : 0;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const refresh = () => {
    setForm(null);
    void utils.materialRequisitions.invalidate();
    toast.success(c("saved"));
  };
  return (
    <section className="mr-module" dir={localeMeta[locale].direction}>
      <header className="mr-heading">
        <div>
          <h1>{c("title")}</h1>
          <p>{c("draftHint")}</p>
        </div>
        <div className="mr-actions">
          {can("materialRequisitions.units.manage") && (
            <button onClick={() => setUnitsOpen(true)}>+ {c("addUnit")}</button>
          )}
          {can("materialRequisitions.create") && (
            <button
              className="primary"
              disabled={!directory.data}
              onClick={() => setForm({})}
            >
              + {c("newRequest")}
            </button>
          )}
        </div>
      </header>
      {directory.error && (
        <p role="alert">
          {directory.error.message}{" "}
          <button onClick={() => void directory.refetch()}>{c("retry")}</button>
        </p>
      )}
      <details className="mr-filters">
        <summary>{c("filter")}</summary>
        <div className="mr-filter-grid">
          <label>
            <span>{c("search")}</span>
            <input
              value={filters.q}
              onChange={e => setFilters({ ...filters, q: e.target.value })}
            />
          </label>
          <label>
            <span>{c("project")}</span>
            <select
              value={filters.projectId}
              onChange={e =>
                setFilters({
                  ...filters,
                  projectId: Number(e.target.value),
                  taskId: 0,
                })
              }
            >
              <option value={0}>{c("allProjects")}</option>
              {directory.data?.projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.number} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{c("task")}</span>
            <select
              value={filters.taskId}
              onChange={e =>
                setFilters({ ...filters, taskId: Number(e.target.value) })
              }
            >
              <option value={0}>{c("allTasks")}</option>
              {directory.data?.tasks
                .filter(
                  t => !filters.projectId || t.projectId === filters.projectId
                )
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>{c("level")}</span>
            <select
              value={filters.linkType}
              onChange={e =>
                setFilters({
                  ...filters,
                  linkType: e.target.value as typeof filters.linkType,
                })
              }
            >
              <option value="">{c("allLinks")}</option>
              <option value="project">{c("projectLevel")}</option>
              <option value="main_task">{c("mainTask")}</option>
              <option value="subtask">{c("subtask")}</option>
            </select>
          </label>
          <label>
            <span>{c("status")}</span>
            <select
              value={filters.status}
              onChange={e =>
                setFilters({
                  ...filters,
                  status: e.target.value as typeof filters.status,
                })
              }
            >
              <option value="">{c("allStatuses")}</option>
              <option value="draft">{c("draft")}</option>
              <option value="approved">{c("approved")}</option>
            </select>
          </label>
          <label>
            <span>{c("creator")}</span>
            <select
              value={filters.createdBy}
              onChange={e =>
                setFilters({ ...filters, createdBy: Number(e.target.value) })
              }
            >
              <option value={0}>{c("allCreators")}</option>
              {directory.data?.creators.map(person => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.username}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["createdFrom", "createdRange", "from"],
              ["createdTo", "createdRange", "to"],
              ["approvedFrom", "approvedRange", "from"],
              ["approvedTo", "approvedRange", "to"],
              ["needFrom", "needRange", "from"],
              ["needTo", "needRange", "to"],
            ] as const
          ).map(([key, label, side]) => (
            <label key={key}>
              <span>
                {c(label)} — {c(side)}
              </span>
              <input
                type="date"
                lang="en-CA"
                value={filters[key]}
                onChange={e =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            <span>{c("sort")}</span>
            <select
              value={filters.sort}
              onChange={e =>
                setFilters({
                  ...filters,
                  sort: e.target.value as typeof filters.sort,
                })
              }
            >
              {(
                [
                  ["created_desc", "sortCreatedDesc"],
                  ["created_asc", "sortCreatedAsc"],
                  ["project", "sortProject"],
                  ["need_date", "sortNeed"],
                  ["number", "sortNumber"],
                  ["status", "status"],
                  ["task_level", "level"],
                ] as const
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {c(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mr-actions">
          <button
            className="primary"
            onClick={() => setApplied({ ...filters, page: 1 })}
          >
            {c("apply")}
          </button>
          <button
            onClick={() => {
              setFilters(defaults());
              setApplied(defaults());
            }}
          >
            {c("clear")}
          </button>
          <input
            aria-label={c("filterName")}
            placeholder={c("filterName")}
            maxLength={50}
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
          />
          <button disabled={!filterName.trim()} onClick={savePreset}>
            {c("saveFilter")}
          </button>
          {presets.length > 0 && (
            <select
              aria-label={c("savedFilters")}
              value=""
              onChange={e => {
                const preset = presets[Number(e.target.value)];
                if (preset) {
                  setFilters(preset.filters);
                  setApplied({ ...preset.filters, page: 1 });
                }
              }}
            >
              <option value="">{c("savedFilters")}</option>
              {presets.map((p, i) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </details>
      <div className="mr-list-toolbar">
        <label className="mr-check">
          <input
            type="checkbox"
            checked={grouped}
            onChange={e => setGrouped(e.target.checked)}
          />
          {c("group")}
        </label>
        <span dir="ltr">{total}</span>
      </div>
      {list.isLoading ? (
        <p>…</p>
      ) : list.error ? (
        <p role="alert">
          {list.error.message}{" "}
          <button onClick={() => void list.refetch()}>{c("retry")}</button>
        </p>
      ) : !rows.length ? (
        <p className="mr-empty">{c("noData")}</p>
      ) : (
        [...groups.entries()].map(([key, values]) => (
          <div className="mr-list" key={key}>
            {grouped && (
              <h2>
                {values[0].projectNumber} — {values[0].projectName}
              </h2>
            )}
            {values.map(row => (
              <article className="mr-card" key={row.id}>
                <div className="mr-card-title">
                  <div>
                    <b dir="ltr">{row.number}</b>
                    <h3>
                      {row.projectNumber} — {row.projectName}
                    </h3>
                    <p>
                      {row.taskId
                        ? `${row.taskLevel === 1 ? c("mainTask") : `${c("subtask")} ${row.taskLevel! - 1}`} · ${row.taskName}`
                        : c("projectLevel")}
                    </p>
                    {row.taskPath.length > 1 && (
                      <p className="mr-task-path">{row.taskPath.join(" / ")}</p>
                    )}
                  </div>
                  <span className={`mr-status ${row.status}`}>
                    {row.status === "draft" ? c("draft") : c("approved")}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>{c("itemCount")}</dt>
                    <dd>{row.itemCount}</dd>
                  </div>
                  <div>
                    <dt>{c("earliestNeed")}</dt>
                    <dd dir="ltr">{row.earliestNeedDate ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{c("creator")}</dt>
                    <dd>{row.creatorName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{c("createdAt")}</dt>
                    <dd dir="ltr">{isoDate(row.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>{c("approvedAt")}</dt>
                    <dd dir="ltr">{isoDate(row.approvedAt)}</dd>
                  </div>
                  <div>
                    <dt>{c("externalPr")}</dt>
                    <dd dir="ltr">
                      {row.externalPurchaseRequestNumber ?? "—"}
                    </dd>
                  </div>
                </dl>
                {row.status === "approved" && (
                  <p className="mr-integration">
                    {externalLabel(row.externalStatus, locale)}
                  </p>
                )}
                <div className="mr-actions">
                  <button onClick={() => setViewId(row.id)}>{c("view")}</button>
                  {row.status === "draft" &&
                    can("materialRequisitions.create") && (
                      <button
                        onClick={() =>
                          setForm({
                            id: row.id,
                            projectId: row.projectId,
                            taskId: row.taskId,
                          })
                        }
                      >
                        {c("edit")}
                      </button>
                    )}
                  {row.status === "draft" &&
                    can("materialRequisitions.approve") && (
                      <button
                        className="primary"
                        disabled={approve.isPending}
                        onClick={() => {
                          if (window.confirm(c("confirmApprove")))
                            approve.mutate({
                              key: crypto.randomUUID(),
                              id: row.id,
                              version: row.version,
                            });
                        }}
                      >
                        {c("approve")}
                      </button>
                    )}
                  {can("materialRequisitions.print") && (
                    <button onClick={() => printRequisition(row, locale)}>
                      {c("print")}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ))
      )}
      <div className="mr-actions mr-pagination">
        <button
          disabled={applied.page <= 1}
          onClick={() => setApplied({ ...applied, page: applied.page - 1 })}
        >
          {c("previous")}
        </button>
        <span dir="ltr">
          {applied.page} / {Math.max(1, Math.ceil(total / applied.pageSize))}
        </span>
        <button
          disabled={applied.page * applied.pageSize >= total}
          onClick={() => setApplied({ ...applied, page: applied.page + 1 })}
        >
          {c("next")}
        </button>
      </div>
      {form && directory.data && (
        <MaterialRequisitionForm
          key={form.id ?? `new-${form.projectId}-${form.taskId}`}
          locale={locale}
          directory={directory.data}
          fixedProjectId={form.projectId}
          fixedTaskId={form.taskId}
          requisitionId={form.id}
          close={() => setForm(null)}
          saved={refresh}
        />
      )}
      {viewId > 0 && (
        <RequisitionView
          id={viewId}
          locale={locale}
          close={() => setViewId(0)}
        />
      )}
      {unitsOpen && (
        <UnitForm
          locale={locale}
          close={() => setUnitsOpen(false)}
          saved={() => {
            setUnitsOpen(false);
            void utils.materialRequisitions.directory.invalidate();
          }}
        />
      )}
    </section>
  );
}

type FormProps = {
  locale: Locale;
  directory: Directory;
  fixedProjectId?: number;
  fixedTaskId?: number | null;
  requisitionId?: number;
  close: () => void;
  saved: () => void;
};
export function MaterialRequisitionForm(props: FormProps) {
  const detail = trpc.materialRequisitions.detail.useQuery(
    { id: props.requisitionId! },
    { enabled: Boolean(props.requisitionId), refetchOnWindowFocus: false }
  );
  if (props.requisitionId && !detail.data)
    return (
      <Modal title={mrText(props.locale, "request")} close={props.close}>
        <p role={detail.error ? "alert" : "status"}>
          {detail.error?.message ?? "…"}
        </p>
      </Modal>
    );
  return (
    <RequisitionEditor
      key={props.requisitionId ?? "new"}
      {...props}
      initial={detail.data}
    />
  );
}
function RequisitionEditor({
  locale,
  directory,
  fixedProjectId,
  fixedTaskId,
  requisitionId,
  close,
  saved,
  initial,
}: FormProps & { initial?: Detail }) {
  const c = (key: MrKey) => mrText(locale, key);
  const [projectId, setProjectId] = useState(
      initial?.projectId ?? fixedProjectId ?? 0
    ),
    [taskId, setTaskId] = useState<number | null>(
      initial?.taskId ?? fixedTaskId ?? null
    );
  const initialUnit = directory.units[0]?.id ?? 0;
  const [items, setItems] = useState<ItemDraft[]>(
    () =>
      initial?.items.map(item => ({
        catalogEntryId: item.catalogEntryId ?? null,
        catalogCode: item.catalogCode ?? "",
        imageUrl: item.imageUrl ?? null,
        importedUnit: item.catalogEntryId ? item.unit : undefined,
        itemName: item.itemName,
        quantity: compactNumber(item.quantity),
        unitId: item.unitId,
        specifications: item.specifications,
        notes: item.notes,
        needDate: item.needDate,
      })) ?? [initialItem(initialUnit)]
  );
  const [error, setError] = useState(""),
    [catalogOpen, setCatalogOpen] = useState(false);
  const save = trpc.materialRequisitions.save.useMutation({
    onSuccess: saved,
    onError: e => setError(e.message),
  });
  const tasks = directory.tasks.filter(t => t.projectId === projectId),
    linkedTask = tasks.find(t => t.id === taskId),
    project = directory.projects.find(p => p.id === projectId);
  const startDate =
      linkedTask?.startDate ??
      project?.actualStartDate ??
      project?.plannedStartDate ??
      "",
    maxNeedDate = startDate ? dateFromLead(startDate, 3) : undefined;
  const [dateBasis, setDateBasis] = useState(startDate);
  useEffect(() => {
    if (dateBasis && startDate && dateBasis !== startDate) {
      setItems(rows =>
        rows.map(item => ({
          ...item,
          needDate: item.needDate
            ? dateFromLead(startDate, leadDays(dateBasis, item.needDate))
            : "",
        }))
      );
    }
    setDateBasis(startDate);
  }, [dateBasis, startDate]);
  const update = (index: number, values: Partial<ItemDraft>) =>
    setItems(
      items.map((item, i) => (i === index ? { ...item, ...values } : item))
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (initial?.status === "approved") return;
    if (!startDate) {
      setError(c("noStart"));
      return;
    }
    if (items.some(i => leadDays(startDate, i.needDate) < 3)) {
      setError(c("leadHint"));
      return;
    }
    save.mutate({
      key: crypto.randomUUID(),
      id: requisitionId,
      version: initial?.version ?? 0,
      projectId,
      taskId,
      expectedSourceStartDate: startDate,
      items: items.map(
        ({ imageUrl: _imageUrl, importedUnit: _importedUnit, ...item }) => item
      ),
    });
  };
  return (
    <div className="mr-modal">
      <Modal
        title={
          requisitionId
            ? `${c("request")} · ${initial?.number ?? "…"}`
            : c("newRequest")
        }
        close={close}
      >
        <form
          className="mr-form"
          onSubmit={submit}
          dir={localeMeta[locale].direction}
        >
          {catalogOpen ? (
            <CatalogPicker
              locale={locale}
              capacity={20 - items.filter(occupiedItem).length}
              close={() => setCatalogOpen(false)}
              imported={imported => {
                setItems(current => {
                  const kept = current.filter(occupiedItem);
                  return [
                    ...kept,
                    ...imported.map(item => ({
                      catalogEntryId: item.catalogEntryId,
                      catalogCode: item.catalogCode,
                      imageUrl: item.imageUrl,
                      importedUnit: item.unit,
                      itemName: item.itemName,
                      quantity: "",
                      unitId: item.unitId,
                      specifications: item.specifications,
                      notes: "",
                      needDate: maxNeedDate ?? "",
                    })),
                  ].slice(0, 20);
                });
                setCatalogOpen(false);
              }}
            />
          ) : (
            <>
              <div className="mr-form-grid">
                <label>
                  <span>{c("project")} *</span>
                  <select
                    required
                    disabled={
                      fixedProjectId !== undefined || Boolean(requisitionId)
                    }
                    value={projectId || ""}
                    onChange={e => {
                      setProjectId(Number(e.target.value));
                      setTaskId(null);
                    }}
                  >
                    <option value="">{c("select")}</option>
                    {directory.projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.number} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{c("task")}</span>
                  <select
                    disabled={
                      !projectId ||
                      fixedTaskId !== undefined ||
                      Boolean(requisitionId)
                    }
                    value={taskId ?? 0}
                    onChange={e => setTaskId(Number(e.target.value) || null)}
                  >
                    <option value={0}>{c("projectLevel")}</option>
                    {tasks.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.level === 1
                          ? c("mainTask")
                          : `${c("subtask")} ${t.level - 1}`}{" "}
                        — {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mr-help">
                {c("leadHint")}
                <br />
                {c("draftHint")}
                <br />
                {c("startDate")}: <bdi>{startDate || "—"}</bdi>
              </p>
              <div className="mr-items">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{c("catalogCode")}</th>
                      <th>{c("itemImage")}</th>
                      <th>{c("item")}</th>
                      <th>{c("quantity")}</th>
                      <th>{c("unit")}</th>
                      <th>{c("specifications")}</th>
                      <th>{c("notes")}</th>
                      <th>{c("needDate")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>
                          <input
                            aria-label={`${c("catalogCode")} ${index + 1}`}
                            dir="ltr"
                            readOnly
                            value={item.catalogCode}
                            placeholder="—"
                            title={
                              item.catalogEntryId
                                ? c("catalogLocked")
                                : c("addFromCatalog")
                            }
                          />
                        </td>
                        <td>
                          <ItemImage
                            url={item.imageUrl}
                            name={item.itemName}
                            locale={locale}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${c("item")} ${index + 1}`}
                            required
                            readOnly={Boolean(item.catalogEntryId)}
                            maxLength={255}
                            value={item.itemName}
                            onChange={e =>
                              update(index, { itemName: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${c("quantity")} ${index + 1}`}
                            required
                            dir="ltr"
                            lang="en"
                            inputMode="decimal"
                            pattern="[0-9]{1,9}(\.[0-9]{1,9})?"
                            value={item.quantity}
                            onChange={e =>
                              update(index, { quantity: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`${c("unit")} ${index + 1}`}
                            required
                            disabled={Boolean(item.catalogEntryId)}
                            value={item.unitId || ""}
                            onChange={e =>
                              update(index, { unitId: Number(e.target.value) })
                            }
                          >
                            <option value="">{c("select")}</option>
                            {directory.units
                              .filter(unit => unit.id !== item.importedUnit?.id)
                              .map(unit => (
                                <option key={unit.id} value={unit.id}>
                                  {unitName(unit, locale)} ({unit.code})
                                </option>
                              ))}
                            {item.importedUnit && (
                              <option value={item.importedUnit.id}>
                                {unitName(item.importedUnit, locale)} (
                                {item.importedUnit.code})
                              </option>
                            )}
                          </select>
                        </td>
                        <td>
                          <textarea
                            aria-label={`${c("specifications")} ${index + 1}`}
                            maxLength={5000}
                            value={item.specifications}
                            onChange={e =>
                              update(index, { specifications: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <textarea
                            aria-label={`${c("notes")} ${index + 1}`}
                            maxLength={5000}
                            value={item.notes}
                            onChange={e =>
                              update(index, { notes: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${c("needDate")} ${index + 1}`}
                            required
                            type="date"
                            lang="en-CA"
                            max={maxNeedDate}
                            value={item.needDate}
                            onChange={e =>
                              update(index, { needDate: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={items.length === 1}
                            onClick={() =>
                              setItems(items.filter((_, i) => i !== index))
                            }
                          >
                            {c("remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mr-help">
                {c("limitHint")} <bdi>{items.length}/20</bdi>
              </p>
              {error && (
                <p className="mr-error" role="alert">
                  {error}
                </p>
              )}
              <div className="mr-actions">
                <button
                  type="button"
                  disabled={
                    items.filter(occupiedItem).length >= 20 || save.isPending
                  }
                  onClick={() => setCatalogOpen(true)}
                >
                  + {c("addFromCatalog")}
                </button>
                <button
                  type="button"
                  disabled={items.length >= 20}
                  onClick={() =>
                    setItems([
                      ...items,
                      initialItem(initialUnit, maxNeedDate ?? ""),
                    ])
                  }
                >
                  + {c("addItem")}
                </button>
                <button
                  className="primary"
                  disabled={
                    save.isPending ||
                    !projectId ||
                    !startDate ||
                    initial?.status === "approved"
                  }
                >
                  {c("saveDraft")}
                </button>
                <button type="button" onClick={close}>
                  {c("close")}
                </button>
              </div>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}

function CatalogPicker({
  locale,
  capacity,
  close,
  imported,
}: {
  locale: Locale;
  capacity: number;
  close: () => void;
  imported: (items: Outputs["catalogImport"]) => void;
}) {
  const c = (key: MrKey) => mrText(locale, key);
  const [searchText, setSearchText] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]);
  const status = trpc.materialRequisitions.catalogStatus.useQuery();
  const catalog = trpc.materialRequisitions.catalogSearch.useQuery(
    { q, page, pageSize: 20, locale },
    {
      enabled: status.data?.configured === true,
      refetchOnWindowFocus: false,
      retry: false,
    }
  );
  const importItems = trpc.materialRequisitions.catalogImport.useMutation({
    onSuccess: imported,
  });
  const search = () => {
    setQ(searchText.trim());
    setPage(1);
  };
  return (
    <section className="mr-catalog" aria-label={c("catalog")}>
      <div className="mr-heading">
        <h3>{c("catalog")}</h3>
        <button type="button" disabled={importItems.isPending} onClick={close}>
          {c("backToRequest")}
        </button>
      </div>
      <p className="mr-help">
        {c("catalogCapacity")}: <bdi>{capacity}</bdi> · {c("selectedItems")}:{" "}
        <bdi>{selected.length}</bdi>
      </p>
      {status.isLoading ? (
        <p role="status">{c("loadingCatalog")}</p>
      ) : status.error ? (
        <p className="mr-error" role="alert">
          {status.error.message}{" "}
          <button type="button" onClick={() => void status.refetch()}>
            {c("retry")}
          </button>
        </p>
      ) : !status.data?.configured ? (
        <p className="mr-help" role="status">
          {c("catalogNotConfigured")}
        </p>
      ) : (
        <>
          <div className="mr-catalog-search">
            <input
              aria-label={c("catalogSearch")}
              placeholder={c("catalogSearch")}
              maxLength={150}
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  search();
                }
              }}
            />
            <button
              type="button"
              onClick={search}
              disabled={catalog.isFetching || importItems.isPending}
            >
              {c("searchAction")}
            </button>
          </div>
          {catalog.isFetching ? (
            <p role="status">{c("loadingCatalog")}</p>
          ) : catalog.error ? (
            <p className="mr-error" role="alert">
              {catalog.error.message}{" "}
              <button type="button" onClick={() => void catalog.refetch()}>
                {c("retry")}
              </button>
            </p>
          ) : !catalog.data?.items.length ? (
            <p className="mr-empty">{c("catalogEmpty")}</p>
          ) : (
            <div className="mr-catalog-items">
              {catalog.data.items.map(item => {
                const checked = selected.includes(item.id);
                return (
                  <article
                    className={`mr-catalog-item ${checked ? "selected" : ""}`}
                    key={item.id}
                  >
                    <label className="mr-catalog-select">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={
                          importItems.isPending ||
                          (!checked && selected.length >= capacity)
                        }
                        aria-label={`${c("select")} ${item.code} — ${item.name}`}
                        onChange={event =>
                          setSelected(current =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter(id => id !== item.id)
                          )
                        }
                      />
                      <span>
                        <bdi>{item.code}</bdi>
                        <strong>{item.name}</strong>
                      </span>
                    </label>
                    <ItemImage
                      url={item.previewUrl}
                      name={item.name}
                      locale={locale}
                    />
                    <div>
                      <span>
                        {c("unit")}:{" "}
                        {locale === "ar"
                          ? item.unit.nameAr
                          : locale === "en"
                            ? item.unit.nameEn
                            : item.unit.nameUr}
                      </span>
                      <p>{item.specifications || "—"}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <div className="mr-actions mr-pagination">
            <button
              type="button"
              disabled={
                page <= 1 || catalog.isFetching || importItems.isPending
              }
              onClick={() => setPage(page - 1)}
            >
              {c("previous")}
            </button>
            <span dir="ltr">
              {page} / {Math.max(1, Math.ceil((catalog.data?.total ?? 0) / 20))}
            </span>
            <button
              type="button"
              disabled={
                !catalog.data ||
                page * 20 >= catalog.data.total ||
                catalog.isFetching ||
                importItems.isPending
              }
              onClick={() => setPage(page + 1)}
            >
              {c("next")}
            </button>
          </div>
          {importItems.error && (
            <p role="alert" className="mr-error">
              {importItems.error.message}
            </p>
          )}
          <div className="mr-actions">
            <button
              type="button"
              className="primary"
              disabled={
                !selected.length ||
                selected.length > capacity ||
                importItems.isPending
              }
              onClick={() => importItems.mutate({ ids: selected, locale })}
            >
              {importItems.isPending ? c("importing") : c("importSelected")}{" "}
              <bdi>({selected.length})</bdi>
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function RequisitionView({
  id,
  locale,
  close,
}: {
  id: number;
  locale: Locale;
  close: () => void;
}) {
  const c = (key: MrKey) => mrText(locale, key),
    detail = trpc.materialRequisitions.detail.useQuery({ id });
  return (
    <div className="mr-modal">
      <Modal
        title={`${c("request")} · ${detail.data?.number ?? "…"}`}
        close={close}
      >
        {detail.isLoading ? (
          <p>…</p>
        ) : detail.error ? (
          <p role="alert">{detail.error.message}</p>
        ) : (
          detail.data && (
            <div className="mr-view" dir={localeMeta[locale].direction}>
              <p>
                <b>{c("project")}:</b> {detail.data.project.number} —{" "}
                {detail.data.project.name}
              </p>
              <p>
                <b>{c("task")}:</b>{" "}
                {detail.data.task?.name ?? c("projectLevel")}
              </p>
              <p>
                <b>{c("status")}:</b>{" "}
                {detail.data.status === "draft" ? c("draft") : c("approved")}
              </p>
              {detail.data.status === "approved" && (
                <p className="mr-help">{c("lockedHint")}</p>
              )}
              <div className="mr-view-table">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{c("catalogCode")}</th>
                      <th>{c("itemImage")}</th>
                      <th>{c("item")}</th>
                      <th>{c("quantity")}</th>
                      <th>{c("unit")}</th>
                      <th>{c("specifications")}</th>
                      <th>{c("notes")}</th>
                      <th>{c("needDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.items.map(item => (
                      <tr key={item.id}>
                        <td>{item.sequence}</td>
                        <td dir="ltr">{item.catalogCode || "—"}</td>
                        <td>
                          <ItemImage
                            url={item.imageUrl}
                            name={item.itemName}
                            locale={locale}
                          />
                        </td>
                        <td>{item.itemName}</td>
                        <td dir="ltr">{compactNumber(item.quantity)}</td>
                        <td>{unitName(item.unit, locale)}</td>
                        <td>{item.specifications || "—"}</td>
                        <td>{item.notes || "—"}</td>
                        <td dir="ltr">{item.needDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                <b>{c("approvedAt")}:</b>{" "}
                <bdi>{isoDate(detail.data.approvedAt)}</bdi>
              </p>
              <p>
                <b>{c("creator")}:</b> {detail.data.creatorName ?? "—"}
              </p>
              <p>
                <b>{c("approver")}:</b> {detail.data.approverName ?? "—"}
              </p>
              {detail.data.status === "approved" && (
                <p>
                  <b>{c("integrationStatus")}:</b>{" "}
                  {externalLabel(detail.data.externalStatus, locale)}
                </p>
              )}
              <p>
                <b>{c("externalPr")}:</b>{" "}
                <bdi>{detail.data.externalPurchaseRequestNumber ?? "—"}</bdi>
              </p>
              {detail.data.externalMessage && (
                <p>{detail.data.externalMessage}</p>
              )}
            </div>
          )
        )}
      </Modal>
    </div>
  );
}

function UnitForm({
  locale,
  close,
  saved,
}: {
  locale: Locale;
  close: () => void;
  saved: () => void;
}) {
  const c = (key: MrKey) => mrText(locale, key),
    [form, setForm] = useState({
      code: "",
      nameAr: "",
      nameEn: "",
      nameUr: "",
    });
  const save = trpc.materialRequisitions.saveUnit.useMutation({
    onSuccess: saved,
    onError: e => toast.error(e.message),
  });
  return (
    <Modal title={c("addUnit")} close={close}>
      <form
        className="mr-form"
        dir={localeMeta[locale].direction}
        onSubmit={e => {
          e.preventDefault();
          save.mutate({
            key: crypto.randomUUID(),
            version: 0,
            active: true,
            ...form,
          });
        }}
      >
        <div className="mr-form-grid">
          {(
            [
              ["code", "unitCode"],
              ["nameAr", "nameAr"],
              ["nameEn", "nameEn"],
              ["nameUr", "nameUr"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{c(label)} *</span>
              <input
                required
                maxLength={key === "code" ? 30 : 100}
                dir={key === "code" || key === "nameEn" ? "ltr" : "rtl"}
                pattern={key === "code" ? "[A-Za-z0-9_]+" : undefined}
                value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="mr-actions">
          <button className="primary" disabled={save.isPending}>
            {c("addUnit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

async function printRequisition(row: Row, locale: Locale) {
  const c = (key: MrKey) => mrText(locale, key),
    popup = window.open("", "_blank");
  if (!popup) return;
  const escape = (value: unknown) =>
    String(value ?? "—").replace(
      /[&<>"']/g,
      char =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!
    );
  const rows = row.items
    .map(
      item =>
        `<tr><td>${item.sequence}</td><td dir="ltr">${escape(item.catalogCode || "—")}</td><td>${localImageUrl(item.imageUrl) ? `<img class="item-image" src="${escape(window.location.origin + localImageUrl(item.imageUrl))}" alt="${escape(item.itemName)}">` : escape(c("noImage"))}</td><td>${escape(item.itemName)}</td><td dir="ltr">${escape(compactNumber(item.quantity))}</td><td>${escape(unitName(item.unit, locale))}</td><td>${escape(item.specifications || "—")}</td><td>${escape(item.notes || "—")}</td><td dir="ltr">${escape(item.needDate)}</td></tr>`
    )
    .join("");
  popup.document.write(
    `<!doctype html><html lang="${locale}" dir="${localeMeta[locale].direction}"><head><meta charset="utf-8"><title>${escape(row.number)}</title><style>@page{size:A4;margin:1cm}*{box-sizing:border-box}body{font:12px Tahoma,Arial;color:#172b3a;line-height:1.6}h1{font-size:20px}header{border-bottom:2px solid #172b3a;padding-bottom:12px}table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:18px;font-size:9px}th,td{border:1px solid #b8c2ca;padding:6px 4px;text-align:start;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#eef3f5}thead{display:table-header-group}tr{break-inside:avoid}.item-image{display:block;width:40px;height:40px;max-width:100%;object-fit:contain;margin:auto}dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}dt{font-weight:bold}dd{margin:3px 0}footer{margin-top:20px;font-size:10px;border-top:1px solid #aaa}</style></head><body><header><h1>PSCM — ${c("request")}</h1><b dir="ltr">${escape(row.number)}</b></header><dl><div><dt>${c("project")}</dt><dd>${escape(row.projectNumber)} — ${escape(row.projectName)}</dd></div><div><dt>${c("task")}</dt><dd>${escape(row.taskName ?? c("projectLevel"))}</dd></div><div><dt>${c("status")}</dt><dd>${row.status === "draft" ? c("draft") : c("approved")}</dd></div><div><dt>${c("createdAt")}</dt><dd dir="ltr">${isoDate(row.createdAt)}</dd></div><div><dt>${c("approvedAt")}</dt><dd dir="ltr">${isoDate(row.approvedAt)}</dd></div><div><dt>${c("externalPr")}</dt><dd dir="ltr">${escape(row.externalPurchaseRequestNumber)}</dd></div></dl><table><thead><tr><th style="width:3%">#</th><th style="width:10%">${c("catalogCode")}</th><th style="width:8%">${c("itemImage")}</th><th style="width:17%">${c("item")}</th><th style="width:8%">${c("quantity")}</th><th style="width:9%">${c("unit")}</th><th style="width:14%">${c("specifications")}</th><th style="width:15%">${c("notes")}</th><th style="width:16%">${c("needDate")}</th></tr></thead><tbody>${rows}</tbody></table><footer>${row.status === "approved" ? c("lockedHint") : c("draftHint")}</footer></body></html>`
  );
  popup.document.close();
  await Promise.all(
    Array.from(popup.document.images).map(image =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            const timer = window.setTimeout(() => resolve(), 15000);
            const done = () => {
              window.clearTimeout(timer);
              resolve();
            };
            image.onload = done;
            image.onerror = () => {
              image.replaceWith(
                popup.document.createTextNode(c("imageUnavailable"))
              );
              done();
            };
          })
    )
  );
  if (popup.closed) return;
  popup.focus();
  popup.print();
}
