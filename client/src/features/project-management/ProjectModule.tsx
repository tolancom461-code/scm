import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { businessDate } from "@shared/date";
import { projectStates, projectFileExtensions } from "@shared/construction";
import { toast } from "sonner";
import { FilePreview } from "./Preview";
import { MaterialRequisitionForm } from "../material-requisitions/MaterialRequisitions";
import { mrText } from "../material-requisitions/copy";
import "./projects.css";
type Outputs = inferRouterOutputs<AppRouter>["projectManagement"];
type Project = Outputs["detail"]["project"];
type Task = Outputs["detail"]["tasks"][number];
type Directory = Outputs["directory"];
type Person = { id: number; permissions: string[] };
const projectPageSize = 50;
type LocalizedLabel = [string, string, string];
const localeIndex = { ar: 0, en: 1, ur: 2 } as const;
const states: Record<string, LocalizedLabel> = {
  draft: ["مسودة", "Draft", "مسودہ"],
  pending: [
    "بانتظار الإدارة العليا",
    "Awaiting management",
    "انتظامیہ کی منظوری کے منتظر",
  ],
  returned: ["مطلوب تعديل", "Changes requested", "تبدیلی مطلوب ہے"],
  rejected: ["مرفوض", "Rejected", "مسترد"],
  approved: [
    "معتمد — لم يبدأ",
    "Approved — not started",
    "منظور شدہ — شروع نہیں ہوا",
  ],
  active: ["قيد التنفيذ", "In progress", "زیرِ عمل"],
};
const priorities: Record<string, LocalizedLabel> = {
  critical: ["حرجة", "Critical", "انتہائی اہم"],
  high: ["عالية", "High", "زیادہ"],
  medium: ["متوسطة", "Medium", "درمیانی"],
  low: ["منخفضة", "Low", "کم"],
};
const defaultStatuses: Record<string, LocalizedLabel> = {
  not_started: ["لم يتم البدء", "Not started", "شروع نہیں ہوا"],
  working: ["جاري العمل", "In progress", "زیرِ عمل"],
  paused: ["متوقفة", "On hold", "روکا ہوا"],
  done: ["منتهية", "Completed", "مکمل"],
};
const text = (locale: Locale) => (ar: string, en: string, ur: string) =>
  locale === "ar" ? ar : locale === "en" ? en : ur;
function statusName(status: Directory["statuses"][number], locale: Locale) {
  return status.version === 0 && defaultStatuses[status.code]
    ? defaultStatuses[status.code][localeIndex[locale]]
    : status.name;
}
function Badge({ state, locale }: { state: string; locale: Locale }) {
  return (
    <span className={"pm-badge pm-" + state}>
      {states[state]?.[localeIndex[locale]] ?? state}
    </span>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="pm-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
async function encoded(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("تعذر قراءة الملف / Cannot read file"));
    reader.readAsDataURL(file);
  });
}
function validateFiles(files: File[], t: ReturnType<typeof text>) {
  if (
    files.some(
      f =>
        !projectFileExtensions.test(f.name) ||
        f.size > 20_000_000 ||
        f.size === 0
    )
  ) {
    toast.error(
      t(
        "اختر صورًا أو PDF أو DWG، بحد أقصى 20 ميغابايت لكل ملف",
        "Choose images, PDF or DWG, up to 20 MB per file",
        "تصویر، PDF یا DWG منتخب کریں۔ ہر فائل زیادہ سے زیادہ 20 MB ہو۔"
      )
    );
    return false;
  }
  return true;
}
export function ProjectModule({
  locale,
  user,
}: {
  locale: Locale;
  user: Person;
}) {
  const t = text(locale),
    can = (p: string) => user.permissions.includes(p),
    utils = trpc.useUtils();
  const [tab, setTab] = useState<
      "projects" | "reviews" | "employees" | "statuses"
    >("projects"),
    [q, setQ] = useState(""),
    [filter, setFilter] = useState<(typeof projectStates)[number] | "">(""),
    [pageCursors, setPageCursors] = useState<(number | undefined)[]>([
      undefined,
    ]),
    [selected, setSelected] = useState(0),
    [creating, setCreating] = useState(false);
  const list = trpc.projectManagement.list.useQuery({
      q,
      status: tab === "reviews" ? "pending" : filter,
      beforeId: pageCursors.at(-1),
      pageSize: projectPageSize + 1,
    }),
    directory = trpc.projectManagement.directory.useQuery();
  const projects = list.data?.slice(0, projectPageSize) ?? [];
  const lastProject = projects.at(-1);
  const hasNextPage = (list.data?.length ?? 0) > projectPageSize;
  const chooseTab = (v: typeof tab) => {
    setSelected(0);
    setPageCursors([undefined]);
    setTab(v);
  };
  return (
    <section className="pm-module">
      <div className="pm-heading">
        <div>
          <h1>{t("وحدة المشاريع", "Project module", "منصوبوں کا ماڈیول")}</h1>
          <p>
            {t(
              "من الفكرة والاعتماد إلى تنفيذ المهام، خطوة بخطوة.",
              "From proposal and approval to task execution, step by step.",
              "تجویز اور منظوری سے لے کر کاموں کی تکمیل تک، قدم بہ قدم۔"
            )}
          </p>
        </div>
        {can("pm.create") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + {t("إنشاء مشروع", "Create project", "منصوبہ بنائیں")}
          </button>
        )}
      </div>
      <nav
        className="pm-tabs"
        aria-label={t(
          "أقسام وحدة المشاريع",
          "Project module sections",
          "منصوبوں کے ماڈیول کے حصے"
        )}
      >
        {(
          [
            ["projects", t("المشاريع", "Projects", "منصوبے")],
            ...(can("pm.review")
              ? [
                  [
                    "reviews",
                    t(
                      "بانتظار الاعتماد",
                      "Awaiting approval",
                      "منظوری کے منتظر"
                    ),
                  ],
                ]
              : []),
            ["employees", t("الموظفون", "Employees", "ملازمین")],
            ...(can("pm.statuses.manage")
              ? [
                  [
                    "statuses",
                    t("حالات المهام", "Task statuses", "کاموں کی حالتیں"),
                  ],
                ]
              : []),
          ] as [typeof tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => chooseTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {list.error && (
        <p role="alert">
          {list.error.message}
          <button onClick={() => list.refetch()}>
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      )}
      {directory.error && (
        <p role="alert">
          {directory.error.message}
          <button onClick={() => directory.refetch()}>
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      )}
      {tab === "employees" && directory.data && (
        <DirectoryEditor
          kind="employee"
          directory={directory.data}
          locale={locale}
          canManage={can("pm.employees.manage")}
        />
      )}
      {tab === "statuses" && directory.data && (
        <DirectoryEditor
          kind="status"
          directory={directory.data}
          locale={locale}
          canManage={can("pm.statuses.manage")}
        />
      )}
      {(tab === "projects" || tab === "reviews") &&
        (selected ? (
          <ProjectDetail
            id={selected}
            locale={locale}
            user={user}
            directory={directory.data}
            back={() => setSelected(0)}
          />
        ) : (
          <>
            <div className="pm-filters">
              <input
                aria-label={t(
                  "بحث المشاريع",
                  "Search projects",
                  "منصوبے تلاش کریں"
                )}
                placeholder={t(
                  "ابحث باسم المشروع أو رقمه",
                  "Search by project name or number",
                  "منصوبے کے نام یا نمبر سے تلاش کریں"
                )}
                value={q}
                onChange={e => {
                  setQ(e.target.value);
                  setPageCursors([undefined]);
                }}
              />
              {tab !== "reviews" && (
                <select
                  aria-label={t(
                    "حالة المشروع",
                    "Project status",
                    "منصوبے کی حالت"
                  )}
                  value={filter}
                  onChange={e => {
                    setFilter(e.target.value as typeof filter);
                    setPageCursors([undefined]);
                  }}
                >
                  <option value="">
                    {t("كل الحالات", "All statuses", "تمام حالتیں")}
                  </option>
                  {projectStates.map(v => (
                    <option key={v} value={v}>
                      {states[v][localeIndex[locale]]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {list.isLoading ? (
              <p aria-live="polite">
                {t(
                  "جاري تحميل المشاريع…",
                  "Loading projects…",
                  "منصوبے لوڈ ہو رہے ہیں…"
                )}
              </p>
            ) : !projects.length ? (
              <div className="pm-empty">
                <h2>
                  {tab === "reviews"
                    ? t(
                        "لا توجد مشاريع بانتظار الاعتماد",
                        "No projects awaiting approval",
                        "کوئی منصوبہ منظوری کا منتظر نہیں"
                      )
                    : t(
                        "ابدأ بمشروعك الأول",
                        "Start your first project",
                        "اپنا پہلا منصوبہ شروع کریں"
                      )}
                </h2>
                <p>
                  {t(
                    "احفظ بيانات المشروع كمسودة، ثم أرسله للإدارة العليا عندما يكتمل.",
                    "Save a project draft, then submit it to management when ready.",
                    "منصوبے کا مسودہ محفوظ کریں اور تیار ہونے پر انتظامیہ کو بھیجیں۔"
                  )}
                </p>
              </div>
            ) : (
              <div className="pm-projects">
                {projects.map(p => (
                  <button
                    className="pm-project-card"
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <div>
                      <bdi>{p.number}</bdi>
                      <Badge state={p.status} locale={locale} />
                    </div>
                    <h2>{p.name}</h2>
                    <p>
                      {p.site ||
                        t(
                          "الموقع لم يُحدد",
                          "Location not set",
                          "مقام درج نہیں"
                        )}
                    </p>
                    <span>
                      {t("فتح المشروع ←", "Open project →", "منصوبہ کھولیں ←")}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {(pageCursors.length > 1 || hasNextPage) && (
              <nav
                className="pm-pagination"
                aria-label={t(
                  "صفحات المشاريع",
                  "Project pages",
                  "منصوبوں کے صفحات"
                )}
              >
                <button
                  disabled={pageCursors.length === 1 || list.isFetching}
                  onClick={() =>
                    setPageCursors(cursors => cursors.slice(0, -1))
                  }
                >
                  {t("السابقة", "Previous", "پچھلا")}
                </button>
                <span aria-live="polite">
                  {t("صفحة", "Page", "صفحہ")} {pageCursors.length}
                </span>
                <button
                  disabled={!hasNextPage || list.isFetching}
                  onClick={() => {
                    if (lastProject)
                      setPageCursors(cursors => [...cursors, lastProject.id]);
                  }}
                >
                  {t("التالية", "Next", "اگلا")}
                </button>
              </nav>
            )}
          </>
        ))}
      {creating && (
        <ProjectForm
          locale={locale}
          user={user}
          close={() => setCreating(false)}
          saved={id => {
            setCreating(false);
            setTab("projects");
            setPageCursors([undefined]);
            setSelected(id);
            void utils.projectManagement.invalidate();
            void utils.gantt.projects.invalidate();
          }}
        />
      )}
    </section>
  );
}
function ProjectForm({
  locale,
  user,
  project,
  close,
  saved,
}: {
  locale: Locale;
  user: Person;
  project?: Project;
  close: () => void;
  saved: (id: number) => void;
}) {
  const t = text(locale),
    [form, setForm] = useState({
      name: project?.name ?? "",
      site: project?.site ?? "",
      description: project?.description ?? "",
      requirements: project?.requirements ?? "",
      plannedStartDate: project?.plannedStartDate ?? null,
      plannedEndDate: project?.plannedEndDate ?? null,
    }),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false);
  const save = trpc.projectManagement.save.useMutation(),
    upload = trpc.documents.upload.useMutation();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !validateFiles(files, t)) return;
    setBusy(true);
    let id: number | undefined;
    try {
      const result = await save.mutateAsync({
        key: crypto.randomUUID(),
        id: project?.id,
        version: project?.version ?? 0,
        data: form,
      });
      id = result.id;
      for (const f of files)
        await upload.mutateAsync({
          entityType: "pm_project",
          entityId: id,
          title: f.name.length >= 2 ? f.name : "مرفق",
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          base64: await encoded(f),
        });
      toast.success(t("تم حفظ المسودة", "Draft saved", "مسودہ محفوظ ہو گیا"));
      saved(id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("تعذر الحفظ", "Could not save", "محفوظ نہیں ہو سکا")
      );
      if (id) {
        toast.info(
          t(
            "حُفظت المسودة. أعد رفع المرفق الذي لم يكتمل من تفاصيل المشروع.",
            "Draft saved. Retry the failed attachment from project details.",
            "مسودہ محفوظ ہو گیا۔ منصوبے کی تفصیلات سے ناکام منسلکہ دوبارہ اپ لوڈ کریں۔"
          )
        );
        saved(id);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        project
          ? t("تعديل المشروع", "Edit project", "منصوبے میں ترمیم کریں")
          : t("إنشاء مشروع", "Create project", "منصوبہ بنائیں")
      }
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="pm-form" onSubmit={submit}>
        <p className="pm-help">
          {t(
            "الحفظ هنا كمسودة فقط. الإرسال للإدارة العليا خطوة مستقلة من تفاصيل المشروع.",
            "This saves a draft. Submission to management is a separate step in project details.",
            "یہاں مسودہ محفوظ ہوتا ہے۔ اسے انتظامیہ کو منصوبے کی تفصیلات سے بھیجیں۔"
          )}
        </p>
        <Field label={t("اسم المشروع *", "Project name *", "منصوبے کا نام *")}>
          <input
            required
            minLength={2}
            maxLength={255}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label={t("الموقع", "Location", "مقام")}>
          <input
            maxLength={500}
            value={form.site}
            onChange={e => setForm({ ...form, site: e.target.value })}
          />
        </Field>
        <Field
          label={t("وصف المشروع", "Project description", "منصوبے کی تفصیل")}
        >
          <textarea
            maxLength={10000}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label={t("المتطلبات", "Requirements", "ضروریات")}>
          <textarea
            maxLength={10000}
            value={form.requirements}
            onChange={e => setForm({ ...form, requirements: e.target.value })}
          />
        </Field>
        <div className="pm-form-grid">
          <Field
            label={t("البداية المخططة", "Planned start", "منصوبہ بند آغاز")}
          >
            <input
              type="date"
              value={form.plannedStartDate ?? ""}
              onChange={e =>
                setForm({ ...form, plannedStartDate: e.target.value || null })
              }
            />
          </Field>
          <Field
            label={t("النهاية المخططة", "Planned end", "منصوبہ بند اختتام")}
          >
            <input
              type="date"
              min={form.plannedStartDate ?? undefined}
              value={form.plannedEndDate ?? ""}
              onChange={e =>
                setForm({ ...form, plannedEndDate: e.target.value || null })
              }
            />
          </Field>
        </div>
        {user.permissions.includes("documents.upload") &&
          user.permissions.includes("pm.edit") && (
            <Field
              label={t(
                "المرفقات — صور، PDF، DWG",
                "Attachments — images, PDF, DWG",
                "منسلکات — تصاویر، PDF، DWG"
              )}
            >
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.dwg"
                onChange={e => {
                  const chosen = Array.from(e.target.files ?? []);
                  if (validateFiles(chosen, t)) setFiles(chosen);
                  else {
                    e.target.value = "";
                    setFiles([]);
                  }
                }}
              />
              <small>
                {t(
                  "حتى 20 ميغابايت لكل ملف",
                  "Up to 20 MB per file",
                  "ہر فائل زیادہ سے زیادہ 20 MB"
                )}
              </small>
              {files.map((f, i) => (
                <span key={i}>{f.name}</span>
              ))}
            </Field>
          )}
        <div className="pm-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? t("جاري الحفظ…", "Saving…", "محفوظ ہو رہا ہے…")
              : t("حفظ كمسودة", "Save draft", "مسودہ محفوظ کریں")}
          </button>
          <button type="button" onClick={close} disabled={busy}>
            {t("إلغاء", "Cancel", "منسوخ کریں")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectDetail({
  id,
  locale,
  user,
  directory,
  back,
}: {
  id: number;
  locale: Locale;
  user: Person;
  directory?: Directory;
  back: () => void;
}) {
  const t = text(locale),
    can = (p: string) => user.permissions.includes(p),
    utils = trpc.useUtils(),
    query = trpc.projectManagement.detail.useQuery({ id }),
    requisitionDirectory = trpc.materialRequisitions.directory.useQuery(
      undefined,
      { enabled: can("materialRequisitions.create") }
    );
  const [edit, setEdit] = useState(false),
    [decision, setDecision] = useState<"approve" | "return" | "reject" | null>(
      null
    ),
    [comment, setComment] = useState(""),
    [starting, setStarting] = useState(false),
    [actualStartDate, setActualStartDate] = useState(businessDate()),
    [task, setTask] = useState<{ parentId: number | null; row?: Task } | null>(
      null
    ),
    [requisition, setRequisition] = useState<{
      projectId: number;
      taskId: number | null;
    } | null>(null),
    [collapsed, setCollapsed] = useState<number[]>([]);
  const openRequisition = async (taskId: number | null) => {
    const result = await requisitionDirectory.refetch();
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (result.data) setRequisition({ projectId: id, taskId });
  };
  const action = trpc.projectManagement.action.useMutation({
    onSuccess: () => {
      setDecision(null);
      setComment("");
      void utils.projectManagement.invalidate();
      void utils.gantt.projects.invalidate();
      void utils.gantt.detail.invalidate({ projectId: id });
      toast.success(
        t("تم تحديث المشروع", "Project updated", "منصوبہ اپ ڈیٹ ہو گیا")
      );
    },
    onError: e => toast.error(e.message),
  });
  if (query.isLoading)
    return (
      <p aria-live="polite">
        {t("جاري فتح المشروع…", "Opening project…", "منصوبہ کھل رہا ہے…")}
      </p>
    );
  if (query.error || !query.data)
    return (
      <p role="alert">
        {query.error?.message}
        <button onClick={() => query.refetch()}>
          {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
        </button>
      </p>
    );
  const { project, tasks, events } = query.data,
    editable = ["draft", "returned"].includes(project.status),
    perform = (a: "submit" | "approve" | "return" | "reject" | "start") =>
      action.mutate({
        key: crypto.randomUUID(),
        id,
        version: project.version,
        action: a,
        comment,
        ...(a === "start" ? { actualStartDate } : {}),
      });
  const renderTasks = (parentId: number | null): React.ReactNode =>
    tasks
      .filter(r => r.parentId === parentId)
      .map(row => {
        const status = directory?.statuses.find(s => s.id === row.statusId),
          hasChildren = tasks.some(r => r.parentId === row.id);
        return (
          <div className="pm-task-branch" key={row.id}>
            <div
              className="pm-task-row"
              style={{ "--task-level": row.level } as React.CSSProperties}
            >
              <button
                className="pm-task-toggle"
                disabled={!hasChildren}
                aria-label={
                  t(
                    "طي أو توسيع المهمة",
                    "Collapse or expand task",
                    "کام کو سمیٹیں یا پھیلائیں"
                  ) +
                  " " +
                  row.name
                }
                onClick={() =>
                  setCollapsed(
                    collapsed.includes(row.id)
                      ? collapsed.filter(i => i !== row.id)
                      : [...collapsed, row.id]
                  )
                }
              >
                {hasChildren ? (collapsed.includes(row.id) ? "▸" : "▾") : "·"}
              </button>
              <button
                className="pm-task-open"
                onClick={() => setTask({ parentId: row.parentId, row })}
              >
                <strong>{row.name}</strong>
                <span>
                  {row.level === 1
                    ? t("مهمة رئيسية", "Main task", "مرکزی کام")
                    : t("مستوى فرعي ", "Sublevel ", "ذیلی سطح ") +
                      (row.level - 1)}{" "}
                  · {row.startDate} — {row.endDate}
                </span>
                <small>
                  {row.employeeIds
                    .map(
                      id =>
                        directory?.employees.find(e => e.id === id)?.name ?? "—"
                    )
                    .join("، ")}
                </small>
              </button>
              <span className="pm-task-state">
                {status ? statusName(status, locale) : "—"}
              </span>
              <span className={"pm-priority pm-" + row.priority}>
                {priorities[row.priority]?.[localeIndex[locale]]}
              </span>
              {can("pm.tasks.manage") && row.level < 5 && (
                <button
                  aria-label={
                    t(
                      "إضافة مهمة فرعية إلى ",
                      "Add subtask to ",
                      "ذیلی کام شامل کریں — "
                    ) + row.name
                  }
                  onClick={() => setTask({ parentId: row.id })}
                >
                  +
                </button>
              )}
              {can("materialRequisitions.create") && (
                <button
                  className="pm-requisition-add"
                  aria-label={`${mrText(locale, "request")} — ${row.name}`}
                  title={mrText(locale, "request")}
                  onClick={() => void openRequisition(row.id)}
                >
                  + {mrText(locale, "request")}
                </button>
              )}
            </div>
            {!collapsed.includes(row.id) && renderTasks(row.id)}
          </div>
        );
      });
  return (
    <div className="pm-detail">
      <button onClick={back}>
        ← {t("قائمة المشاريع", "Project list", "منصوبوں کی فہرست")}
      </button>
      <div className="pm-heading">
        <div>
          <bdi>{project.number}</bdi>
          <h2>{project.name}</h2>
          <Badge state={project.status} locale={locale} />
        </div>
        <div className="pm-actions">
          {editable && can("pm.edit") && (
            <button onClick={() => setEdit(true)}>
              {t("تعديل المشروع", "Edit project", "منصوبے میں ترمیم کریں")}
            </button>
          )}
          {editable && can("pm.submit") && (
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => perform("submit")}
            >
              {t(
                "إرسال للاعتماد",
                "Submit for approval",
                "منظوری کے لیے بھیجیں"
              )}
            </button>
          )}
          {project.status === "pending" &&
            can("pm.review") &&
            (["approve", "return", "reject"] as const).map(v => (
              <button
                key={v}
                disabled={action.isPending}
                className={v === "approve" ? "primary" : ""}
                onClick={() => {
                  setComment("");
                  setDecision(v);
                }}
              >
                {v === "approve"
                  ? t(
                      "الموافقة على المشروع",
                      "Approve project",
                      "منصوبہ منظور کریں"
                    )
                  : v === "return"
                    ? t("طلب تعديل", "Request changes", "ترمیم کی درخواست کریں")
                    : t("رفض المشروع", "Reject project", "منصوبہ مسترد کریں")}
              </button>
            ))}
          {project.status === "approved" && can("pm.start") && (
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => setStarting(true)}
            >
              {t("بدء التنفيذ", "Start execution", "عمل درآمد شروع کریں")}
            </button>
          )}
          {can("materialRequisitions.create") &&
            (project.actualStartDate || project.plannedStartDate) && (
              <button onClick={() => void openRequisition(null)}>
                + {mrText(locale, "request")}
              </button>
            )}
        </div>
      </div>
      {project.status === "pending" && (
        <p className="pm-notice">
          {t(
            "أُرسل المشروع للإدارة العليا. بياناته مقفلة حتى صدور القرار.",
            "Submitted to management. Project details are locked until a decision is made.",
            "منصوبہ انتظامیہ کو بھیج دیا گیا۔ فیصلے تک تفصیلات مقفل ہیں۔"
          )}
        </p>
      )}
      {project.status === "returned" && (
        <p className="pm-notice">
          {t(
            "عدّل المطلوب حسب ملاحظات الإدارة، ثم أعد الإرسال للاعتماد.",
            "Address management comments, then resubmit for approval.",
            "انتظامیہ کے تبصروں کے مطابق ترمیم کریں اور پھر منظوری کے لیے بھیجیں۔"
          )}{" "}
          {events.find(e => e.action === "return")?.comment}
        </p>
      )}
      <dl className="pm-summary">
        <div>
          <dt>{t("الفترة المخططة", "Planned period", "منصوبہ بند مدت")}</dt>
          <dd>
            {project.plannedStartDate && project.plannedEndDate
              ? `${project.plannedStartDate} — ${project.plannedEndDate}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("البدء الفعلي", "Actual start", "اصل آغاز")}</dt>
          <dd>{project.actualStartDate || "—"}</dd>
        </div>
        <div>
          <dt>{t("النهاية المتوقعة", "Forecast finish", "متوقع اختتام")}</dt>
          <dd>
            {project.forecastEndDate || project.plannedEndDate || "—"}
            {project.extensionDays
              ? ` (+${project.extensionDays} ${t("يوم", "days", "دن")})`
              : ""}
          </dd>
        </div>
        <div>
          <dt>{t("الموقع", "Location", "مقام")}</dt>
          <dd>{project.site || "—"}</dd>
        </div>
        <div>
          <dt>{t("وصف المشروع", "Project description", "منصوبے کی تفصیل")}</dt>
          <dd>{project.description || "—"}</dd>
        </div>
        <div>
          <dt>{t("المتطلبات", "Requirements", "ضروریات")}</dt>
          <dd>{project.requirements || "—"}</dd>
        </div>
      </dl>
      <ProjectAttachments
        id={id}
        entityType="pm_project"
        locale={locale}
        editable={editable && can("pm.edit") && can("documents.upload")}
        canView={can("documents.view")}
      />
      {project.status === "active" && (
        <section className="pm-panel">
          <div className="pm-heading">
            <div>
              <h3>{t("مهام المشروع", "Project tasks", "منصوبے کے کام")}</h3>
              <p>
                {t(
                  "مهمة رئيسية وأربعة مستويات فرعية. اضغط اسم المهمة لعرض تفاصيلها.",
                  "One main level and four sublevels. Select a task to open its details.",
                  "ایک مرکزی سطح اور چار ذیلی سطحیں۔ تفصیلات کے لیے کام منتخب کریں۔"
                )}
              </p>
            </div>
            {can("pm.tasks.manage") && (
              <button
                className="primary"
                disabled={!directory}
                onClick={() => setTask({ parentId: null })}
              >
                + {t("مهمة رئيسية", "Main task", "مرکزی کام")}
              </button>
            )}
          </div>
          {tasks.length ? (
            renderTasks(null)
          ) : (
            <p className="pm-empty">
              {t(
                "لم تُضف مهام بعد. ابدأ بإضافة المهمة الرئيسية الأولى.",
                "No tasks yet. Add your first main task.",
                "ابھی کوئی کام شامل نہیں۔ پہلا مرکزی کام شامل کریں۔"
              )}
            </p>
          )}
        </section>
      )}
      {events.length > 0 && (
        <details className="pm-history" open={project.status !== "active"}>
          <summary>
            {t(
              "سجل الاعتماد والملاحظات",
              "Approval history & comments",
              "منظوریوں اور تبصروں کا ریکارڈ"
            )}
          </summary>
          {events.map(e => (
            <div key={e.id}>
              <b>
                {
                  (
                    {
                      submit: t("إرسال للاعتماد", "Submitted", "بھیج دیا گیا"),
                      approve: t("موافقة الإدارة", "Approved", "منظور شدہ"),
                      return: t(
                        "طلب تعديل",
                        "Changes requested",
                        "تبدیلی کی درخواست کی گئی"
                      ),
                      reject: t("رفض", "Rejected", "مسترد"),
                      start: t(
                        "بدء التنفيذ",
                        "Execution started",
                        "عمل درآمد شروع ہو گیا"
                      ),
                    } as Record<string, string>
                  )[e.action]
                }
              </b>
              <small>
                {e.actor} ·{" "}
                {new Date(e.createdAt).toLocaleDateString(
                  locale === "ar"
                    ? "ar-SA-u-ca-gregory-nu-latn"
                    : locale === "en"
                      ? "en-GB-u-nu-latn"
                      : localeMeta.ur.formatting
                )}
              </small>
              <p>{e.comment || "—"}</p>
            </div>
          ))}
        </details>
      )}
      {edit && (
        <ProjectForm
          project={project}
          locale={locale}
          user={user}
          close={() => setEdit(false)}
          saved={() => {
            setEdit(false);
            void utils.projectManagement.invalidate();
            void utils.gantt.projects.invalidate();
            void utils.gantt.detail.invalidate({ projectId: id });
          }}
        />
      )}
      {decision && (
        <Modal
          title={
            decision === "approve"
              ? t(
                  "الموافقة على المشروع",
                  "Approve project",
                  "منصوبہ منظور کریں"
                )
              : decision === "return"
                ? t("طلب تعديل", "Request changes", "ترمیم کی درخواست کریں")
                : t("رفض المشروع", "Reject project", "منصوبہ مسترد کریں")
          }
          close={() => setDecision(null)}
        >
          <form
            className="pm-form"
            onSubmit={e => {
              e.preventDefault();
              perform(decision);
            }}
          >
            <Field
              label={
                decision === "approve"
                  ? t(
                      "ملاحظات الإدارة — اختياري",
                      "Management comments — optional",
                      "انتظامیہ کے تبصرے — اختیاری"
                    )
                  : t(
                      "السبب والملاحظات *",
                      "Reason and comments *",
                      "وجہ اور تبصرے *"
                    )
              }
            >
              <textarea
                required={decision !== "approve"}
                minLength={decision === "approve" ? 0 : 3}
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={4000}
              />
            </Field>
            <button className="primary" disabled={action.isPending}>
              {t("تأكيد القرار", "Confirm decision", "فیصلے کی تصدیق کریں")}
            </button>
          </form>
        </Modal>
      )}
      {starting && (
        <Modal
          title={t(
            "بدء تنفيذ المشروع",
            "Start project execution",
            "منصوبے پر عمل درآمد شروع کریں"
          )}
          close={() => setStarting(false)}
        >
          <form
            className="pm-form"
            onSubmit={e => {
              e.preventDefault();
              perform("start");
              setStarting(false);
            }}
          >
            <p className="pm-help">
              {t(
                "هذا هو تاريخ البدء الفعلي، وتُزاح منه تواريخ الجدول مع الاحتفاظ بالخطة الأصلية.",
                "This is the actual start date. The schedule shifts from it while preserving the original baseline.",
                "یہ اصل تاریخِ آغاز ہے۔ ابتدائی منصوبہ محفوظ رہتا ہے اور شیڈول اس تاریخ کے مطابق آگے یا پیچھے ہوتا ہے۔"
              )}
            </p>
            <Field
              label={t(
                "تاريخ البدء الفعلي *",
                "Actual start date *",
                "اصل تاریخِ آغاز *"
              )}
            >
              <input
                required
                type="date"
                value={actualStartDate}
                onChange={e => setActualStartDate(e.target.value)}
              />
            </Field>
            <button className="primary" disabled={action.isPending}>
              {t("تأكيد بدء التنفيذ", "Confirm start", "آغاز کی تصدیق کریں")}
            </button>
          </form>
        </Modal>
      )}
      {task && directory && (
        <TaskForm
          projectId={id}
          parentId={task.parentId}
          row={task.row}
          tasks={tasks}
          directory={directory}
          locale={locale}
          canManage={can("pm.tasks.manage")}
          canStatus={can("pm.statuses.manage")}
          canDocumentsView={can("documents.view")}
          canDocumentsUpload={can("documents.upload")}
          close={() => setTask(null)}
          saved={() => {
            setTask(null);
            void utils.projectManagement.detail.invalidate({ id });
          }}
        />
      )}
      {requisition && requisitionDirectory.data && (
        <MaterialRequisitionForm
          locale={locale}
          directory={requisitionDirectory.data}
          fixedProjectId={requisition.projectId}
          fixedTaskId={requisition.taskId}
          close={() => setRequisition(null)}
          saved={() => {
            setRequisition(null);
            void utils.materialRequisitions.invalidate();
            toast.success(mrText(locale, "saved"));
          }}
        />
      )}
    </div>
  );
}
function TaskForm({
  projectId,
  parentId,
  row,
  tasks,
  directory,
  locale,
  canManage,
  canStatus,
  canDocumentsView,
  canDocumentsUpload,
  close,
  saved,
}: {
  projectId: number;
  parentId: number | null;
  row?: Task;
  tasks: Task[];
  directory: Directory;
  locale: Locale;
  canManage: boolean;
  canStatus: boolean;
  canDocumentsView: boolean;
  canDocumentsUpload: boolean;
  close: () => void;
  saved: () => void;
}) {
  const t = text(locale),
    parent = tasks.find(v => v.id === parentId),
    [form, setForm] = useState({
      name: row?.name ?? "",
      statusId: row?.statusId ?? directory.statuses[0]?.id ?? 0,
      startDate: row?.startDate ?? parent?.startDate ?? businessDate(),
      endDate: row?.endDate ?? parent?.endDate ?? businessDate(),
      priority: row?.priority ?? "medium",
      employeeIds: row?.employeeIds ?? [],
    }),
    [addingStatus, setAddingStatus] = useState(false),
    [statusLabel, setStatusLabel] = useState(""),
    [formError, setFormError] = useState("");
  const utils = trpc.useUtils(),
    save = trpc.projectManagement.saveTask.useMutation({
      onSuccess: () => {
        void utils.gantt.detail.invalidate({ projectId });
        saved();
      },
      onError: e => {
        setFormError(e.message);
        toast.error(e.message);
      },
    }),
    status = trpc.projectManagement.saveStatus.useMutation({
      onSuccess: r => {
        setForm({ ...form, statusId: r.id });
        setStatusLabel("");
        setAddingStatus(false);
        void utils.projectManagement.directory.invalidate();
      },
      onError: e => toast.error(e.message),
    });
  return (
    <Modal
      title={
        row
          ? t("تفاصيل المهمة", "Task details", "کام کی تفصیلات")
          : parent
            ? t("إضافة مهمة فرعية", "Add subtask", "ذیلی کام شامل کریں")
            : t("إضافة مهمة رئيسية", "Add main task", "مرکزی کام شامل کریں")
      }
      close={close}
    >
      <form
        className="pm-form"
        onSubmit={e => {
          e.preventDefault();
          setFormError("");
          save.mutate({
            ...form,
            priority: form.priority as "critical" | "high" | "medium" | "low",
            key: crypto.randomUUID(),
            projectId,
            parentId,
            id: row?.id,
            version: row?.version ?? 0,
          });
        }}
      >
        {parent && (
          <p className="pm-help">
            {t("تتبع للمهمة: ", "Parent task: ", "بالائی کام: ")}
            <b>{parent.name}</b>
            <br />
            {t("الفترة المسموحة: ", "Allowed dates: ", "مجاز تاریخیں: ")}
            <bdi>
              {parent.startDate} — {parent.endDate}
            </bdi>
          </p>
        )}
        <Field label={t("اسم المهمة *", "Task name *", "کام کا نام *")}>
          <input
            required
            disabled={!canManage}
            minLength={2}
            maxLength={255}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="pm-two">
          <Field label={t("الحالة", "Status", "حالت")}>
            <div className="pm-inline">
              <select
                disabled={!canManage}
                value={form.statusId}
                onChange={e =>
                  setForm({ ...form, statusId: Number(e.target.value) })
                }
              >
                {directory.statuses.map(s => (
                  <option key={s.id} value={s.id}>
                    {statusName(s, locale)}
                  </option>
                ))}
              </select>
              {canStatus && canManage && (
                <button
                  type="button"
                  aria-label={t("إضافة حالة", "Add status", "حالت شامل کریں")}
                  onClick={() => setAddingStatus(!addingStatus)}
                >
                  +
                </button>
              )}
            </div>
          </Field>
          <Field label={t("الأولوية", "Priority", "ترجیح")}>
            <select
              disabled={!canManage}
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
            >
              {Object.entries(priorities).map(([v, label]) => (
                <option key={v} value={v}>
                  {label[localeIndex[locale]]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("تاريخ البداية *", "Start date *", "تاریخِ آغاز *")}>
            <input
              disabled={!canManage}
              required
              type="date"
              value={form.startDate}
              onInput={e =>
                setForm(prev => ({
                  ...prev,
                  startDate: (e.target as HTMLInputElement).value,
                }))
              }
              onChange={e => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label={t("تاريخ النهاية *", "End date *", "تاریخِ اختتام *")}>
            <input
              disabled={!canManage}
              required
              type="date"
              min={form.startDate}
              value={form.endDate}
              onInput={e =>
                setForm(prev => ({
                  ...prev,
                  endDate: (e.target as HTMLInputElement).value,
                }))
              }
              onChange={e => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>
        {addingStatus && (
          <div className="pm-inline">
            <input
              aria-label={t(
                "اسم الحالة الجديدة",
                "New status name",
                "نئی حالت کا نام"
              )}
              value={statusLabel}
              onChange={e => setStatusLabel(e.target.value)}
              maxLength={100}
            />
            <button
              type="button"
              disabled={status.isPending || statusLabel.trim().length < 2}
              onClick={() =>
                status.mutate({ key: crypto.randomUUID(), name: statusLabel })
              }
            >
              {t("إضافة", "Add", "شامل کریں")}
            </button>
          </div>
        )}
        <fieldset className="pm-assignees">
          <legend>
            {t(
              "المسؤولون عن المهمة * — يمكن اختيار أكثر من موظف",
              "Assignees * — select one or more employees",
              "ذمہ دار افراد * — ایک یا زیادہ ملازمین منتخب کریں"
            )}
          </legend>
          {!directory.employees.some(e => e.active) ? (
            <p>
              {t(
                "أضف الموظفين أولًا من قسم «الموظفون» في وحدة المشاريع.",
                "Add employees first from the Employees section of the project module.",
                "پہلے منصوبوں کے ماڈیول میں ملازمین کے حصے سے ملازمین شامل کریں۔"
              )}
            </p>
          ) : (
            directory.employees.map(e => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  disabled={
                    !canManage ||
                    (!e.active && !form.employeeIds.includes(e.id))
                  }
                  checked={form.employeeIds.includes(e.id)}
                  onChange={() =>
                    setForm({
                      ...form,
                      employeeIds: form.employeeIds.includes(e.id)
                        ? form.employeeIds.filter(id => id !== e.id)
                        : [...form.employeeIds, e.id],
                    })
                  }
                />
                <span>
                  {e.name}
                  {e.jobTitle ? " — " + e.jobTitle : ""}
                  {!e.active
                    ? t(" (غير متاح)", " (inactive)", " (غیر فعال)")
                    : ""}
                </span>
              </label>
            ))
          )}
        </fieldset>
        {formError && (
          <p role="alert" className="pm-notice">
            {formError}
          </p>
        )}
        {canManage && (
          <div className="pm-actions">
            <button
              className="primary"
              disabled={
                save.isPending || !form.employeeIds.length || !form.statusId
              }
            >
              {t("حفظ المهمة", "Save task", "کام محفوظ کریں")}
            </button>
            <button type="button" onClick={close}>
              {t("إلغاء", "Cancel", "منسوخ کریں")}
            </button>
          </div>
        )}
      </form>
      {row && (
        <ProjectAttachments
          id={row.id}
          entityType="pm_task"
          locale={locale}
          editable={canManage && canDocumentsUpload}
          canView={canDocumentsView}
        />
      )}
    </Modal>
  );
}
function DirectoryEditor({
  kind,
  directory,
  locale,
  canManage,
}: {
  kind: "employee" | "status";
  directory: Directory;
  locale: Locale;
  canManage: boolean;
}) {
  const t = text(locale),
    utils = trpc.useUtils(),
    [form, setForm] = useState<{
      id?: number;
      version: number;
      name: string;
      jobTitle: string;
      active: boolean;
    } | null>(null),
    done = () => {
      setForm(null);
      void utils.projectManagement.directory.invalidate();
    },
    employee = trpc.projectManagement.saveEmployee.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    }),
    status = trpc.projectManagement.saveStatus.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    });
  const rows = kind === "employee" ? directory.employees : directory.statuses;
  return (
    <section className="pm-panel">
      <div className="pm-heading">
        <div>
          <h2>
            {kind === "employee"
              ? t("قائمة الموظفين", "Employee directory", "ملازمین کی فہرست")
              : t("حالات المهام", "Task statuses", "کاموں کی حالتیں")}
          </h2>
          <p>
            {kind === "employee"
              ? t(
                  "هذه الأسماء متاحة للإسناد إلى المهام، ولا تنشئ حسابات دخول.",
                  "Employees can be assigned to tasks. This does not create login accounts.",
                  "ملازمین کو کام تفویض کیے جا سکتے ہیں۔ اس سے لاگ ان اکاؤنٹ نہیں بنتے۔"
                )
              : t(
                  "يمكن تعديل أسماء الحالات أو إضافة حالة جديدة.",
                  "Edit status names or add a new status.",
                  "حالتوں کے نام تبدیل کریں یا نئی حالت شامل کریں۔"
                )}
          </p>
        </div>
        {canManage && (
          <button
            className="primary"
            onClick={() =>
              setForm({ version: 0, name: "", jobTitle: "", active: true })
            }
          >
            +{" "}
            {kind === "employee"
              ? t("إضافة موظف", "Add employee", "ملازم شامل کریں")
              : t("إضافة حالة", "Add status", "حالت شامل کریں")}
          </button>
        )}
      </div>
      {!rows.length && (
        <p className="pm-empty">
          {t("لا توجد أسماء بعد.", "No records yet.", "ابھی کوئی ریکارڈ نہیں۔")}
        </p>
      )}
      <div className="pm-directory">
        {rows.map(e => (
          <div key={e.id}>
            <strong>
              {kind === "status"
                ? statusName(e as Directory["statuses"][number], locale)
                : e.name}
            </strong>
            <span>{"jobTitle" in e ? e.jobTitle : ""}</span>
            {"active" in e && !e.active && (
              <small>
                {t(
                  "غير متاح للإسناد",
                  "Unavailable for assignment",
                  "تفویض کے لیے دستیاب نہیں"
                )}
              </small>
            )}
            {canManage && (
              <button
                onClick={() =>
                  setForm({
                    id: e.id,
                    version: e.version,
                    name: e.name,
                    jobTitle: "jobTitle" in e ? e.jobTitle : "",
                    active: "active" in e ? e.active : true,
                  })
                }
              >
                {t("تعديل", "Edit", "ترمیم کریں")}
              </button>
            )}
          </div>
        ))}
      </div>
      {form && (
        <Modal
          title={
            kind === "employee"
              ? t("بيانات الموظف", "Employee details", "ملازم کی تفصیلات")
              : t("بيانات الحالة", "Status details", "حالت کی تفصیلات")
          }
          close={() => setForm(null)}
        >
          <form
            className="pm-form"
            onSubmit={e => {
              e.preventDefault();
              if (kind === "employee")
                employee.mutate({ ...form, key: crypto.randomUUID() });
              else
                status.mutate({
                  id: form.id,
                  version: form.version,
                  name: form.name,
                  key: crypto.randomUUID(),
                });
            }}
          >
            <Field label={t("الاسم *", "Name *", "نام *")}>
              <input
                required
                minLength={2}
                maxLength={kind === "employee" ? 200 : 100}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            {kind === "employee" && (
              <>
                <Field
                  label={t(
                    "المسمى الوظيفي — اختياري",
                    "Job title — optional",
                    "عہدہ — اختیاری"
                  )}
                >
                  <input
                    value={form.jobTitle}
                    maxLength={200}
                    onChange={e =>
                      setForm({ ...form, jobTitle: e.target.value })
                    }
                  />
                </Field>
                <label className="pm-check">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e =>
                      setForm({ ...form, active: e.target.checked })
                    }
                  />
                  {t(
                    "متاح لإسناد المهام",
                    "Available for task assignment",
                    "کام کی تفویض کے لیے دستیاب"
                  )}
                </label>
              </>
            )}
            <button
              className="primary"
              disabled={employee.isPending || status.isPending}
            >
              {t("حفظ", "Save", "محفوظ کریں")}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
function ProjectAttachments({
  id,
  entityType,
  locale,
  editable,
  canView,
}: {
  id: number;
  entityType: "pm_project" | "pm_task";
  locale: Locale;
  editable: boolean;
  canView: boolean;
}) {
  const t = text(locale),
    utils = trpc.useUtils(),
    list = trpc.documents.list.useQuery(
      { entityType, entityId: id },
      { enabled: canView }
    ),
    upload = trpc.documents.upload.useMutation(),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ fileName: string; url: string } | null>(
      null
    ),
    [inputKey, setInputKey] = useState(0);
  async function add(files: File[]) {
    if (!validateFiles(files, t) || busy) return;
    setBusy(true);
    try {
      for (const f of files)
        await upload.mutateAsync({
          entityType,
          entityId: id,
          title: f.name,
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          base64: await encoded(f),
        });
      toast.success(
        t("تم رفع المرفقات", "Attachments uploaded", "منسلکات اپ لوڈ ہو گئے")
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      void utils.documents.list.invalidate();
      setBusy(false);
      setInputKey(v => v + 1);
    }
  }
  if (!canView) return null;
  return (
    <section className="pm-panel">
      <h3>
        {entityType === "pm_task"
          ? t("مرفقات المهمة", "Task attachments", "کام کے منسلکات")
          : t("المرفقات", "Attachments", "منسلکات")}
      </h3>
      {list.error && <p role="alert">{list.error.message}</p>}
      <div className="pm-files">
        {list.data?.map(f => (
          <div key={f.id}>
            <span>{f.fileName}</span>
            <button
              onClick={() => setPreview({ fileName: f.fileName, url: f.url })}
            >
              {t("استعراض", "Preview", "پیش منظر")}
            </button>
            <a href={f.url} target="_blank" rel="noreferrer">
              {t("تنزيل", "Download", "ڈاؤن لوڈ کریں")}
            </a>
          </div>
        ))}
      </div>
      {!list.isLoading && !list.data?.length && (
        <p>
          {t(
            "لا توجد مرفقات بعد.",
            "No attachments yet.",
            "ابھی کوئی منسلکہ نہیں۔"
          )}
        </p>
      )}
      {editable && (
        <Field
          label={t(
            "إضافة مرفقات — صور، PDF، DWG — 20 ميغابايت للملف",
            "Add attachments — images, PDF, DWG — 20 MB per file",
            "منسلکات شامل کریں — تصاویر، PDF، DWG — ہر فائل 20 MB تک"
          )}
        >
          <input
            key={inputKey}
            type="file"
            multiple
            disabled={busy}
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.dwg"
            onChange={e => {
              void add(Array.from(e.target.files ?? []));
            }}
          />
          {busy && (
            <small aria-live="polite">
              {t("جاري الرفع…", "Uploading…", "اپ لوڈ ہو رہا ہے…")}
            </small>
          )}
        </Field>
      )}
      {preview && (
        <FilePreview
          file={preview}
          locale={locale}
          close={() => setPreview(null)}
        />
      )}
    </section>
  );
}
