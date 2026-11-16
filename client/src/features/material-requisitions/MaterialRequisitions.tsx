import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { businessDate } from "@shared/date";
import {
  dateFromLead,
  isWholeRequisitionQuantity,
  materialRequisitionListInput,
  projectHasCmmsLocation,
} from "@shared/material-requisitions";
import { dateInput } from "@shared/validation";
import { CatalogPicker } from "./CatalogPicker";
import { ItemImage, localImageUrl } from "./CatalogItemImage";
import { RequisitionItemCard, type ItemDraft } from "./RequisitionItemCard";
import { mrText, type MrKey } from "./copy";
import "./material-requisitions.css";

type Outputs = inferRouterOutputs<AppRouter>["materialRequisitions"];
type Directory = Outputs["directory"];
type Row = Outputs["list"]["rows"][number];
type Detail = Outputs["detail"];
type User = { id?: number; permissions: string[] };
const defaults = () => materialRequisitionListInput.parse({});
const compactNumber = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const unitName = (unit: ItemDraft["unit"], locale: Locale) =>
  locale === "ar" ? unit.nameAr : locale === "en" ? unit.nameEn : unit.nameUr;
const isoDate = (date: Date | string | null) =>
  date ? businessDate(new Date(date)) : "—";

function needDateFromOffset(startDate: string, offsetDays: string) {
  const decimalDigits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  const offset = offsetDays
    .trim()
    .replace(/[٠-٩۰-۹]/g, digit => String(decimalDigits.indexOf(digit) % 10))
    .replace("−", "-");
  if (!startDate || !/^[+-]?\d{1,7}$/.test(offset)) return "";
  const needDate = dateFromLead(startDate, -Number(offset));
  return dateInput.safeParse(needDate).success ? needDate : "";
}

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
function purchaseStatusRefresh(
  records: readonly Pick<Row, "cmmsDispatchNextAt" | "externalStatus">[]
) {
  let interval: number | false = false;
  for (const row of records) {
    if (!row.cmmsDispatchNextAt) continue;
    const next =
      row.externalStatus === "sending"
        ? 5_000
        : Math.min(
            60_000,
            Math.max(
              5_000,
              new Date(row.cmmsDispatchNextAt).getTime() - Date.now()
            )
          );
    interval = interval === false ? next : Math.min(interval, next);
  }
  return interval;
}
function PurchaseRequestReference({
  number,
  url,
}: {
  number: string | null;
  url: string | null;
}) {
  let href: string | null = null;
  if (url) {
    try {
      const target = new URL(url);
      if (
        ["http:", "https:"].includes(target.protocol) &&
        !target.username &&
        !target.password
      )
        href = target.href;
    } catch {
      href = null;
    }
  }
  return href && number ? (
    <a href={href} target="_blank" rel="noreferrer">
      {number}
    </a>
  ) : (
    (number ?? "—")
  );
}

const cmmsItemColumns = [
  "cmmsSite",
  "cmmsSection",
  "cmmsAsset",
  "cmmsCategory",
  "cmmsReviewRole",
] as const;
type CmmsProjectNames = Pick<
  Directory["projects"][number],
  "cmmsSiteName" | "cmmsSectionName" | "cmmsAssetName"
>;
function CmmsLocationCells({ project }: { project?: CmmsProjectNames }) {
  return (
    <>
      <td className="mr-cmms-fixed">
        <bdi>{project?.cmmsSiteName ?? "—"}</bdi>
      </td>
      <td className="mr-cmms-fixed">
        <bdi>{project?.cmmsSectionName ?? "—"}</bdi>
      </td>
      <td className="mr-cmms-fixed">
        <bdi>{project?.cmmsAssetName ?? "—"}</bdi>
      </td>
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
    [viewId, setViewId] = useState(0);
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
    list = trpc.materialRequisitions.list.useQuery(applied, {
      refetchInterval: query =>
        query.state.data?.cmmsDispatchEnabled
          ? purchaseStatusRefresh(query.state.data.rows)
          : false,
    });
  const references = trpc.cmmsReferences.status.useQuery();
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
                      <PurchaseRequestReference
                        number={row.externalPurchaseRequestNumber}
                        url={row.externalReferenceUrl}
                      />
                    </dd>
                  </div>
                </dl>
                {row.status === "approved" && (
                  <p className="mr-integration">
                    {references.data?.configured &&
                    row.externalStatus === "pending_send" &&
                    !projectHasCmmsLocation(row)
                      ? c("cmmsLocalApproval")
                      : externalLabel(row.externalStatus, locale)}
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
                          if (
                            window.confirm(
                              c(
                                projectHasCmmsLocation(row)
                                  ? "confirmApprove"
                                  : "confirmApproveLocal"
                              )
                            )
                          )
                            approve.mutate({
                              key: crypto.randomUUID(),
                              id: row.id,
                              version: row.version,
                              locale,
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
  const [items, setItems] = useState<ItemDraft[]>(
    () =>
      initial?.items.map(item => ({
        rowKey: "saved-" + item.id,
        catalogEntryId: item.catalogEntryId ?? null,
        catalogCode: item.catalogCode ?? "",
        imageUrl: item.imageUrl ?? null,
        unit: item.unit,
        itemName: item.itemName,
        quantity: compactNumber(item.quantity),
        unitId: item.unitId,
        specifications: item.specifications,
        notes: item.notes,
        offsetDays:
          item.leadDays < 0 ? `+${-item.leadDays}` : String(-item.leadDays),
        cmmsCategoryId: item.cmmsCategoryId,
        cmmsCategoryName: item.cmmsCategoryName,
        cmmsReviewRole: item.cmmsReviewRole,
        cmmsReviewRoleName: item.cmmsReviewRoleName,
      })) ?? []
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
  const references = trpc.cmmsReferences.status.useQuery();
  const cmmsConfigured = references.isSuccess && references.data.configured;
  const purchaseOptions = trpc.cmmsReferences.purchaseOptions.useQuery(
    { locale },
    { enabled: cmmsConfigured }
  );
  const cmmsOptions =
    cmmsConfigured && purchaseOptions.isSuccess
      ? purchaseOptions.data
      : undefined;
  const linkedLocation = projectHasCmmsLocation(project);
  const invalidQuantity = items.some(
    item => !isWholeRequisitionQuantity(item.quantity)
  );
  const invalidPurchaseChoice =
    cmmsOptions !== undefined &&
    items.some(
      item =>
        !cmmsOptions.categories.some(
          option => option.id === item.cmmsCategoryId
        ) ||
        !cmmsOptions.reviewRoles.some(
          option => option.code === item.cmmsReviewRole
        )
    );
  const purchaseOptionsEmpty =
    cmmsOptions !== undefined &&
    (!cmmsOptions.categories.length || !cmmsOptions.reviewRoles.length);
  const purchaseOptionsLoading =
    references.isPending || (cmmsConfigured && purchaseOptions.isPending);
  const startDate =
    (taskId === null ? project?.plannedStartDate : linkedTask?.startDate) ?? "";
  const datedItems = items.map(item => ({
    ...item,
    needDate: needDateFromOffset(startDate, item.offsetDays),
  }));
  const invalidNeedDate = datedItems.some(item => !item.needDate);
  const update = (rowKey: string, values: Partial<ItemDraft>) =>
    setItems(current =>
      current.map(item =>
        item.rowKey === rowKey ? { ...item, ...values } : item
      )
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (save.isPending || catalogOpen || initial?.status === "approved") return;
    if (!linkedLocation) {
      setError(c("cmmsProjectNotLinked"));
      return;
    }
    if (items.length === 0) {
      setError(c("emptyDraft"));
      return;
    }
    if (invalidQuantity) {
      setError(c("wholeQuantityRequired"));
      return;
    }
    if (!startDate) {
      setError(c("noStart"));
      return;
    }
    if (invalidNeedDate) {
      setError(c("invalidOffsetDays"));
      return;
    }
    if (!cmmsOptions) {
      setError(
        c(
          references.data?.configured === false
            ? "cmmsPurchaseNotConfigured"
            : "cmmsOptionsUnavailable"
        )
      );
      return;
    }
    if (purchaseOptionsEmpty || invalidPurchaseChoice) {
      setError(c(purchaseOptionsEmpty ? "cmmsOptionsEmpty" : "cmmsSaveFields"));
      return;
    }
    save.mutate({
      key: crypto.randomUUID(),
      id: requisitionId,
      version: initial?.version ?? 0,
      projectId,
      taskId,
      expectedSourceStartDate: startDate,
      locale,
      items: datedItems.map(
        ({
          rowKey: _rowKey,
          imageUrl: _imageUrl,
          unit: _unit,
          offsetDays: _offsetDays,
          cmmsCategoryName: _cmmsCategoryName,
          cmmsReviewRoleName: _cmmsReviewRoleName,
          ...item
        }) => item
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
        close={catalogOpen ? () => setCatalogOpen(false) : close}
      >
        <form
          className="mr-form"
          onSubmit={submit}
          dir={localeMeta[locale].direction}
        >
          {catalogOpen ? (
            <CatalogPicker
              locale={locale}
              capacity={20 - items.length}
              close={() => setCatalogOpen(false)}
              imported={imported => {
                setItems(current => [
                  ...current,
                  ...imported.slice(0, 20 - current.length).map(item => ({
                    ...item,
                    rowKey: "catalog-" + item.catalogEntryId,
                    quantity: "",
                    notes: "",
                    offsetDays: "-3",
                    cmmsCategoryId: null,
                    cmmsCategoryName: null,
                    cmmsReviewRole: null,
                    cmmsReviewRoleName: null,
                  })),
                ]);
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
                {c("offsetDaysHint")}
                <br />
                {c("draftHint")}
                <br />
                {c("startDate")}: <bdi>{startDate || "—"}</bdi>
              </p>
              {projectId > 0 && !startDate && (
                <p className="mr-help">{c("noStart")}</p>
              )}
              {projectId > 0 && !linkedLocation && (
                <p className="mr-help">{c("cmmsProjectNotLinked")}</p>
              )}
              {purchaseOptionsLoading && (
                <p className="mr-help" role="status">
                  {c("cmmsOptionsLoading")}
                </p>
              )}
              {purchaseOptionsEmpty ? (
                <p className="mr-help">{c("cmmsOptionsEmpty")}</p>
              ) : (
                invalidPurchaseChoice && (
                  <p className="mr-help">{c("cmmsSaveFields")}</p>
                )
              )}
              {(references.isError ||
                (cmmsConfigured && purchaseOptions.isError)) && (
                <p className="mr-error" role="alert">
                  {c("cmmsOptionsUnavailable")}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      void (references.isError
                        ? references.refetch()
                        : purchaseOptions.refetch())
                    }
                  >
                    {c("retry")}
                  </button>
                </p>
              )}
              {references.isSuccess && !cmmsConfigured && (
                <p className="mr-help">{c("cmmsPurchaseNotConfigured")}</p>
              )}
              <div className="mr-line-toolbar">
                <div className="mr-actions">
                  <button
                    type="button"
                    disabled={items.length >= 20 || save.isPending}
                    onClick={() => {
                      setError("");
                      setCatalogOpen(true);
                    }}
                  >
                    + {c("addFromCatalog")}
                  </button>
                </div>
                <small className="mr-line-limit" aria-live="polite">
                  <bdi>{items.length}/20</bdi> · {c("limitHint")}
                </small>
              </div>
              {items.length ? (
                <div className="mr-line-list">
                  {datedItems.map((item, index) => (
                    <RequisitionItemCard
                      key={item.rowKey}
                      item={item}
                      number={index + 1}
                      locale={locale}
                      unitLabel={
                        unitName(item.unit, locale) +
                        " (" +
                        item.unit.code +
                        ")"
                      }
                      needDate={item.needDate}
                      hasStartDate={Boolean(startDate)}
                      project={project}
                      options={cmmsOptions}
                      update={values => update(item.rowKey, values)}
                      remove={() =>
                        setItems(current =>
                          current.filter(row => row.rowKey !== item.rowKey)
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="mr-empty">{c("emptyDraft")}</p>
              )}
              {error && (
                <p className="mr-error" role="alert">
                  {error}
                </p>
              )}
              <div className="mr-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    save.isPending ||
                    !items.length ||
                    !linkedLocation ||
                    !startDate ||
                    !cmmsOptions ||
                    purchaseOptionsEmpty ||
                    invalidPurchaseChoice ||
                    invalidQuantity ||
                    invalidNeedDate ||
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

export function RequisitionView({
  id,
  locale,
  close,
}: {
  id: number;
  locale: Locale;
  close: () => void;
}) {
  const c = (key: MrKey) => mrText(locale, key);
  const references = trpc.cmmsReferences.status.useQuery();
  const detail = trpc.materialRequisitions.detail.useQuery(
    { id },
    {
      refetchInterval: query =>
        query.state.data?.cmmsDispatchEnabled
          ? purchaseStatusRefresh([query.state.data])
          : false,
    }
  );
  const project = detail.data?.project;
  const showCmmsFields =
    projectHasCmmsLocation(project) ||
    detail.data?.items.some(item => item.cmmsCategoryId || item.cmmsReviewRole);
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
                <table className={showCmmsFields ? "mr-cmms-items" : undefined}>
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
                      {showCmmsFields &&
                        cmmsItemColumns.map(column => (
                          <th key={column}>{c(column)}</th>
                        ))}
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
                        {showCmmsFields && (
                          <>
                            <CmmsLocationCells project={project} />
                            <td>
                              <bdi>{item.cmmsCategoryName ?? "—"}</bdi>
                            </td>
                            <td>
                              <bdi>{item.cmmsReviewRoleName ?? "—"}</bdi>
                            </td>
                          </>
                        )}
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
                  {references.data?.configured &&
                  detail.data.externalStatus === "pending_send" &&
                  !projectHasCmmsLocation(project)
                    ? c("cmmsLocalApproval")
                    : externalLabel(detail.data.externalStatus, locale)}
                </p>
              )}
              <p>
                <b>{c("externalPr")}:</b>{" "}
                <bdi>
                  <PurchaseRequestReference
                    number={detail.data.externalPurchaseRequestNumber}
                    url={detail.data.externalReferenceUrl}
                  />
                </bdi>
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
