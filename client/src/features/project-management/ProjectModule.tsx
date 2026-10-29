import { useState, type FormEvent } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { businessDate } from "@shared/date";
import { projectStates, projectFileExtensions } from "@shared/construction";
import { toast } from "sonner";
import { FilePreview } from "./Preview";
import "./projects.css";
type Outputs = inferRouterOutputs<AppRouter>["projectManagement"];
type Project = Outputs["detail"]["project"];
type Task = Outputs["detail"]["tasks"][number];
type Directory = Outputs["directory"];
type Person = { id: number; permissions: string[] };
const states: Record<string, [string, string]> = {
  draft: ["مسودة", "Draft"],
  pending: ["بانتظار الإدارة العليا", "Awaiting management"],
  returned: ["مطلوب تعديل", "Changes requested"],
  rejected: ["مرفوض", "Rejected"],
  approved: ["معتمد — لم يبدأ", "Approved — not started"],
  active: ["قيد التنفيذ", "In progress"],
};
const priorities: Record<string, [string, string]> = {
  critical: ["حرجة", "Critical"],
  high: ["عالية", "High"],
  medium: ["متوسطة", "Medium"],
  low: ["منخفضة", "Low"],
};
const defaultStatuses: Record<string, [string, string]> = {
  not_started: ["لم يتم البدء", "Not started"],
  working: ["جاري العمل", "In progress"],
  paused: ["متوقفة", "On hold"],
  done: ["منتهية", "Completed"],
};
const text = (locale: Locale) => (ar: string, en: string) =>
  locale === "ar" ? ar : en;
function statusName(status: Directory["statuses"][number], locale: Locale) {
  return status.version === 0 && defaultStatuses[status.code]
    ? defaultStatuses[status.code][locale === "ar" ? 0 : 1]
    : status.name;
}
function Badge({ state, locale }: { state: string; locale: Locale }) {
  return (
    <span className={"pm-badge pm-" + state}>
      {states[state]?.[locale === "ar" ? 0 : 1] ?? state}
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
        "Choose images, PDF or DWG, up to 20 MB per file"
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
    [selected, setSelected] = useState(0),
    [creating, setCreating] = useState(false);
  const list = trpc.projectManagement.list.useQuery({
      q,
      status: tab === "reviews" ? "pending" : filter,
    }),
    directory = trpc.projectManagement.directory.useQuery();
  const chooseTab = (v: typeof tab) => {
    setSelected(0);
    setTab(v);
  };
  return (
    <section className="pm-module">
      <div className="pm-heading">
        <div>
          <h1>{t("وحدة المشاريع", "Project module")}</h1>
          <p>
            {t(
              "من الفكرة والاعتماد إلى تنفيذ المهام، خطوة بخطوة.",
              "From proposal and approval to task execution, step by step."
            )}
          </p>
        </div>
        {can("pm.create") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + {t("إنشاء مشروع", "Create project")}
          </button>
        )}
      </div>
      <nav
        className="pm-tabs"
        aria-label={t("أقسام وحدة المشاريع", "Project module sections")}
      >
        {(
          [
            ["projects", t("المشاريع", "Projects")],
            ...(can("pm.review")
              ? [["reviews", t("بانتظار الاعتماد", "Awaiting approval")]]
              : []),
            ["employees", t("الموظفون", "Employees")],
            ...(can("pm.statuses.manage")
              ? [["statuses", t("حالات المهام", "Task statuses")]]
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
            {t("إعادة المحاولة", "Retry")}
          </button>
        </p>
      )}
      {directory.error && (
        <p role="alert">
          {directory.error.message}
          <button onClick={() => directory.refetch()}>
            {t("إعادة المحاولة", "Retry")}
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
                aria-label={t("بحث المشاريع", "Search projects")}
                placeholder={t(
                  "ابحث باسم المشروع أو رقمه",
                  "Search by project name or number"
                )}
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              {tab !== "reviews" && (
                <select
                  aria-label={t("حالة المشروع", "Project status")}
                  value={filter}
                  onChange={e => setFilter(e.target.value as typeof filter)}
                >
                  <option value="">{t("كل الحالات", "All statuses")}</option>
                  {projectStates.map(v => (
                    <option key={v} value={v}>
                      {states[v][locale === "ar" ? 0 : 1]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {list.isLoading ? (
              <p aria-live="polite">
                {t("جاري تحميل المشاريع…", "Loading projects…")}
              </p>
            ) : !list.data?.length ? (
              <div className="pm-empty">
                <h2>
                  {tab === "reviews"
                    ? t(
                        "لا توجد مشاريع بانتظار الاعتماد",
                        "No projects awaiting approval"
                      )
                    : t("ابدأ بمشروعك الأول", "Start your first project")}
                </h2>
                <p>
                  {t(
                    "احفظ بيانات المشروع كمسودة، ثم أرسله للإدارة العليا عندما يكتمل.",
                    "Save a project draft, then submit it to management when ready."
                  )}
                </p>
              </div>
            ) : (
              <div className="pm-projects">
                {list.data.map(p => (
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
                    <p>{p.site || t("الموقع لم يُحدد", "Location not set")}</p>
                    <span>{t("فتح المشروع ←", "Open project →")}</span>
                  </button>
                ))}
              </div>
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
            setSelected(id);
            void utils.projectManagement.invalidate();
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
      toast.success(t("تم حفظ المسودة", "Draft saved"));
      saved(id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("تعذر الحفظ", "Could not save")
      );
      if (id) {
        toast.info(
          t(
            "حُفظت المسودة. أعد رفع المرفق الذي لم يكتمل من تفاصيل المشروع.",
            "Draft saved. Retry the failed attachment from project details."
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
          ? t("تعديل المشروع", "Edit project")
          : t("إنشاء مشروع", "Create project")
      }
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="pm-form" onSubmit={submit}>
        <p className="pm-help">
          {t(
            "الحفظ هنا كمسودة فقط. الإرسال للإدارة العليا خطوة مستقلة من تفاصيل المشروع.",
            "This saves a draft. Submission to management is a separate step in project details."
          )}
        </p>
        <Field label={t("اسم المشروع *", "Project name *")}>
          <input
            required
            minLength={2}
            maxLength={255}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label={t("الموقع", "Location")}>
          <input
            maxLength={500}
            value={form.site}
            onChange={e => setForm({ ...form, site: e.target.value })}
          />
        </Field>
        <Field label={t("وصف المشروع", "Project description")}>
          <textarea
            maxLength={10000}
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label={t("المتطلبات", "Requirements")}>
          <textarea
            maxLength={10000}
            value={form.requirements}
            onChange={e => setForm({ ...form, requirements: e.target.value })}
          />
        </Field>
        {user.permissions.includes("documents.upload") &&
          user.permissions.includes("pm.edit") && (
            <Field
              label={t(
                "المرفقات — صور، PDF، DWG",
                "Attachments — images, PDF, DWG"
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
                {t("حتى 20 ميغابايت لكل ملف", "Up to 20 MB per file")}
              </small>
              {files.map((f, i) => (
                <span key={i}>{f.name}</span>
              ))}
            </Field>
          )}
        <div className="pm-actions">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t("جاري الحفظ…", "Saving…") : t("حفظ كمسودة", "Save draft")}
          </button>
          <button type="button" onClick={close} disabled={busy}>
            {t("إلغاء", "Cancel")}
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
    query = trpc.projectManagement.detail.useQuery({ id });
  const [edit, setEdit] = useState(false),
    [decision, setDecision] = useState<"approve" | "return" | "reject" | null>(
      null
    ),
    [comment, setComment] = useState(""),
    [task, setTask] = useState<{ parentId: number | null; row?: Task } | null>(
      null
    ),
    [collapsed, setCollapsed] = useState<number[]>([]);
  const action = trpc.projectManagement.action.useMutation({
    onSuccess: () => {
      setDecision(null);
      setComment("");
      void utils.projectManagement.invalidate();
      toast.success(t("تم تحديث المشروع", "Project updated"));
    },
    onError: e => toast.error(e.message),
  });
  if (query.isLoading)
    return (
      <p aria-live="polite">{t("جاري فتح المشروع…", "Opening project…")}</p>
    );
  if (query.error || !query.data)
    return (
      <p role="alert">
        {query.error?.message}
        <button onClick={() => query.refetch()}>
          {t("إعادة المحاولة", "Retry")}
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
                  t("طي أو توسيع المهمة", "Collapse or expand task") +
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
                    ? t("مهمة رئيسية", "Main task")
                    : t("مستوى فرعي ", "Sublevel ") + (row.level - 1)}{" "}
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
                {priorities[row.priority]?.[locale === "ar" ? 0 : 1]}
              </span>
              {can("pm.tasks.manage") && row.level < 5 && (
                <button
                  aria-label={
                    t("إضافة مهمة فرعية إلى ", "Add subtask to ") + row.name
                  }
                  onClick={() => setTask({ parentId: row.id })}
                >
                  +
                </button>
              )}
            </div>
            {!collapsed.includes(row.id) && renderTasks(row.id)}
          </div>
        );
      });
  return (
    <div className="pm-detail">
      <button onClick={back}>← {t("قائمة المشاريع", "Project list")}</button>
      <div className="pm-heading">
        <div>
          <bdi>{project.number}</bdi>
          <h2>{project.name}</h2>
          <Badge state={project.status} locale={locale} />
        </div>
        <div className="pm-actions">
          {editable && can("pm.edit") && (
            <button onClick={() => setEdit(true)}>
              {t("تعديل المشروع", "Edit project")}
            </button>
          )}
          {editable && can("pm.submit") && (
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => perform("submit")}
            >
              {t("إرسال للاعتماد", "Submit for approval")}
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
                  ? t("الموافقة على المشروع", "Approve project")
                  : v === "return"
                    ? t("طلب تعديل", "Request changes")
                    : t("رفض المشروع", "Reject project")}
              </button>
            ))}
          {project.status === "approved" && can("pm.start") && (
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => perform("start")}
            >
              {t("بدء التنفيذ", "Start execution")}
            </button>
          )}
        </div>
      </div>
      {project.status === "pending" && (
        <p className="pm-notice">
          {t(
            "أُرسل المشروع للإدارة العليا. بياناته مقفلة حتى صدور القرار.",
            "Submitted to management. Project details are locked until a decision is made."
          )}
        </p>
      )}
      {project.status === "returned" && (
        <p className="pm-notice">
          {t(
            "عدّل المطلوب حسب ملاحظات الإدارة، ثم أعد الإرسال للاعتماد.",
            "Address management comments, then resubmit for approval."
          )}{" "}
          {events.find(e => e.action === "return")?.comment}
        </p>
      )}
      <dl className="pm-summary">
        <div>
          <dt>{t("الموقع", "Location")}</dt>
          <dd>{project.site || "—"}</dd>
        </div>
        <div>
          <dt>{t("وصف المشروع", "Project description")}</dt>
          <dd>{project.description || "—"}</dd>
        </div>
        <div>
          <dt>{t("المتطلبات", "Requirements")}</dt>
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
              <h3>{t("مهام المشروع", "Project tasks")}</h3>
              <p>
                {t(
                  "مهمة رئيسية وأربعة مستويات فرعية. اضغط اسم المهمة لعرض تفاصيلها.",
                  "One main level and four sublevels. Select a task to open its details."
                )}
              </p>
            </div>
            {can("pm.tasks.manage") && (
              <button
                className="primary"
                disabled={!directory}
                onClick={() => setTask({ parentId: null })}
              >
                + {t("مهمة رئيسية", "Main task")}
              </button>
            )}
          </div>
          {tasks.length ? (
            renderTasks(null)
          ) : (
            <p className="pm-empty">
              {t(
                "لم تُضف مهام بعد. ابدأ بإضافة المهمة الرئيسية الأولى.",
                "No tasks yet. Add your first main task."
              )}
            </p>
          )}
        </section>
      )}
      {events.length > 0 && (
        <details className="pm-history" open={project.status !== "active"}>
          <summary>
            {t("سجل الاعتماد والملاحظات", "Approval history & comments")}
          </summary>
          {events.map(e => (
            <div key={e.id}>
              <b>
                {
                  (
                    {
                      submit: t("إرسال للاعتماد", "Submitted"),
                      approve: t("موافقة الإدارة", "Approved"),
                      return: t("طلب تعديل", "Changes requested"),
                      reject: t("رفض", "Rejected"),
                      start: t("بدء التنفيذ", "Execution started"),
                    } as Record<string, string>
                  )[e.action]
                }
              </b>
              <small>
                {e.actor} ·{" "}
                {new Date(e.createdAt).toLocaleDateString(
                  locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB"
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
          }}
        />
      )}
      {decision && (
        <Modal
          title={
            decision === "approve"
              ? t("الموافقة على المشروع", "Approve project")
              : decision === "return"
                ? t("طلب تعديل", "Request changes")
                : t("رفض المشروع", "Reject project")
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
                      "Management comments — optional"
                    )
                  : t("السبب والملاحظات *", "Reason and comments *")
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
              {t("تأكيد القرار", "Confirm decision")}
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
      onSuccess: saved,
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
          ? t("تفاصيل المهمة", "Task details")
          : parent
            ? t("إضافة مهمة فرعية", "Add subtask")
            : t("إضافة مهمة رئيسية", "Add main task")
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
            {t("تتبع للمهمة: ", "Parent task: ")}
            <b>{parent.name}</b>
            <br />
            {t("الفترة المسموحة: ", "Allowed dates: ")}
            <bdi>
              {parent.startDate} — {parent.endDate}
            </bdi>
          </p>
        )}
        <Field label={t("اسم المهمة *", "Task name *")}>
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
          <Field label={t("الحالة", "Status")}>
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
                  aria-label={t("إضافة حالة", "Add status")}
                  onClick={() => setAddingStatus(!addingStatus)}
                >
                  +
                </button>
              )}
            </div>
          </Field>
          <Field label={t("الأولوية", "Priority")}>
            <select
              disabled={!canManage}
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
            >
              {Object.entries(priorities).map(([v, label]) => (
                <option key={v} value={v}>
                  {label[locale === "ar" ? 0 : 1]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("تاريخ البداية *", "Start date *")}>
            <input
              disabled={!canManage}
              required
              type="date"
              min={parent?.startDate}
              max={parent?.endDate}
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
          <Field label={t("تاريخ النهاية *", "End date *")}>
            <input
              disabled={!canManage}
              required
              type="date"
              min={form.startDate}
              max={parent?.endDate}
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
              aria-label={t("اسم الحالة الجديدة", "New status name")}
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
              {t("إضافة", "Add")}
            </button>
          </div>
        )}
        <fieldset className="pm-assignees">
          <legend>
            {t(
              "المسؤولون عن المهمة * — يمكن اختيار أكثر من موظف",
              "Assignees * — select one or more employees"
            )}
          </legend>
          {!directory.employees.some(e => e.active) ? (
            <p>
              {t(
                "أضف الموظفين أولًا من قسم «الموظفون» في وحدة المشاريع.",
                "Add employees first from the Employees section of the project module."
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
                  {!e.active ? t(" (غير متاح)", " (inactive)") : ""}
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
              {t("حفظ المهمة", "Save task")}
            </button>
            <button type="button" onClick={close}>
              {t("إلغاء", "Cancel")}
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
              ? t("قائمة الموظفين", "Employee directory")
              : t("حالات المهام", "Task statuses")}
          </h2>
          <p>
            {kind === "employee"
              ? t(
                  "هذه الأسماء متاحة للإسناد إلى المهام، ولا تنشئ حسابات دخول.",
                  "Employees can be assigned to tasks. This does not create login accounts."
                )
              : t(
                  "يمكن تعديل أسماء الحالات أو إضافة حالة جديدة.",
                  "Edit status names or add a new status."
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
              ? t("إضافة موظف", "Add employee")
              : t("إضافة حالة", "Add status")}
          </button>
        )}
      </div>
      {!rows.length && (
        <p className="pm-empty">{t("لا توجد أسماء بعد.", "No records yet.")}</p>
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
                {t("غير متاح للإسناد", "Unavailable for assignment")}
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
                {t("تعديل", "Edit")}
              </button>
            )}
          </div>
        ))}
      </div>
      {form && (
        <Modal
          title={
            kind === "employee"
              ? t("بيانات الموظف", "Employee details")
              : t("بيانات الحالة", "Status details")
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
            <Field label={t("الاسم *", "Name *")}>
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
                  label={t("المسمى الوظيفي — اختياري", "Job title — optional")}
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
                  {t("متاح لإسناد المهام", "Available for task assignment")}
                </label>
              </>
            )}
            <button
              className="primary"
              disabled={employee.isPending || status.isPending}
            >
              {t("حفظ", "Save")}
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
      toast.success(t("تم رفع المرفقات", "Attachments uploaded"));
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
          ? t("مرفقات المهمة", "Task attachments")
          : t("المرفقات", "Attachments")}
      </h3>
      {list.error && <p role="alert">{list.error.message}</p>}
      <div className="pm-files">
        {list.data?.map(f => (
          <div key={f.id}>
            <span>{f.fileName}</span>
            <button
              onClick={() => setPreview({ fileName: f.fileName, url: f.url })}
            >
              {t("استعراض", "Preview")}
            </button>
            <a href={f.url} target="_blank" rel="noreferrer">
              {t("تنزيل", "Download")}
            </a>
          </div>
        ))}
      </div>
      {!list.isLoading && !list.data?.length && (
        <p>{t("لا توجد مرفقات بعد.", "No attachments yet.")}</p>
      )}
      {editable && (
        <Field
          label={t(
            "إضافة مرفقات — صور، PDF، DWG — 20 ميغابايت للملف",
            "Add attachments — images, PDF, DWG — 20 MB per file"
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
            <small aria-live="polite">{t("جاري الرفع…", "Uploading…")}</small>
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
