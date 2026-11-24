import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { businessDate } from "@shared/date";
import { ganttProjectColors } from "@shared/gantt-colors";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import {
  buildListGroups,
  compactListDate,
  deriveListProgress,
  type ListProgress,
} from "./project-list-model";
import "./project-list.css";

type Outputs = inferRouterOutputs<AppRouter>["projectManagement"];
export type ProjectListProject = Outputs["detail"]["project"];
export type ProjectListTask = Outputs["detail"]["tasks"][number] & {
  statusCode: string;
  statusName: string;
};
type Directory = Outputs["directory"];
type User = { id: number; permissions: string[] };
export type ProjectListTaskSelection = {
  projectId: number;
  taskId?: number;
  parentId: number | null;
};
type Actions = {
  onCreateProject: () => void;
  onOpenProject: (id: number) => void;
  onEditProject: (id: number) => void;
  onTask: (selection: ProjectListTaskSelection) => void;
  onCards: () => void;
};
export type ProjectListViewProps = Actions & {
  locale: Locale;
  user: User;
  directory?: Directory;
};
export type ProjectListTableProps = Actions & {
  locale: Locale;
  user: User;
  directory: Directory;
  projects: readonly ProjectListProject[];
  tasks: readonly ProjectListTask[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  refreshing?: boolean;
  loadError?: string;
  onRetry?: () => void;
};

const copy = (locale: Locale) => (ar: string, en: string, ur: string) =>
  locale === "ar" ? ar : locale === "en" ? en : ur;
const priorityLabels = {
  critical: ["حرجة", "Critical", "انتہائی اہم"],
  high: ["عالية", "High", "زیادہ"],
  medium: ["متوسطة", "Medium", "درمیانی"],
  low: ["منخفضة", "Low", "کم"],
};
const defaultStatusLabels: Record<string, string[]> = {
  not_started: ["لم يتم البدء", "Not started", "شروع نہیں ہوا"],
  working: ["جاري العمل", "In progress", "زیرِ عمل"],
  paused: ["متوقفة", "On hold", "روکا ہوا"],
  done: ["منتهية", "Completed", "مکمل"],
  cancelled: ["ملغاة", "Cancelled", "منسوخ"],
};
const localeIndex = { ar: 0, en: 1, ur: 2 } as const;
const customStyle = (values: Record<string, string | number>) =>
  values as CSSProperties;

export function ProjectListView(props: ProjectListViewProps) {
  const t = copy(props.locale);
  const query = trpc.projectManagement.listView.useInfiniteQuery(
    { pageSize: 50 },
    {
      getNextPageParam: page => page.nextBeforeId ?? undefined,
    }
  );
  const data = useMemo(() => {
    const projects = new Map<number, ProjectListProject>();
    const tasks = new Map<number, ProjectListTask>();
    for (const page of query.data?.pages ?? []) {
      for (const project of page.projects)
        if (!projects.has(project.id)) projects.set(project.id, project);
      for (const task of page.tasks)
        if (!tasks.has(task.id)) tasks.set(task.id, task);
    }
    return {
      projects: [...projects.values()].sort(
        (left, right) => left.id - right.id
      ),
      tasks: [...tasks.values()],
    };
  }, [query.data]);
  if (!query.data && query.error)
    return (
      <div className="pm-list-view">
        <p className="pl-notice" role="alert">
          {query.error.message}{" "}
          <button
            type="button"
            className="pl-btn"
            onClick={() => void query.refetch()}
          >
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      </div>
    );
  if (!query.data || !props.directory)
    return (
      <div className="pm-list-view">
        <p className="pl-loading" role="status">
          <LoaderCircle className="pl-icon" aria-hidden="true" />{" "}
          {t(
            "جاري تحميل المشاريع والمهام…",
            "Loading projects and tasks…",
            "منصوبے اور کام لوڈ ہو رہے ہیں…"
          )}
        </p>
      </div>
    );
  return (
    <ProjectListTable
      {...props}
      directory={props.directory}
      {...data}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      refreshing={query.isFetching && !query.isFetchingNextPage}
      loadError={query.error?.message}
      onRetry={() => void query.refetch()}
    />
  );
}

function ListProgressBar({
  stats,
  label,
  locale,
}: {
  stats: ListProgress;
  label: string;
  locale: Locale;
}) {
  const t = copy(locale);
  if (!stats.total)
    return (
      <span
        className="pl-dash"
        title={t(
          "لا توجد مهام نهائية غير ملغاة قابلة للاحتساب",
          "No eligible leaf tasks",
          "حساب کے لیے کوئی فعال آخری کام نہیں"
        )}
      >
        —
      </span>
    );
  const description = t(
    `${stats.done} من ${stats.total} مهام نهائية مكتملة`,
    `${stats.done} of ${stats.total} leaf tasks complete`,
    `${stats.total} میں سے ${stats.done} آخری کام مکمل`
  );
  return (
    <span
      className={
        "pl-work-progress" + (stats.value === 100 ? " pl-is-complete" : "")
      }
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={stats.value}
      aria-valuetext={stats.value + "% — " + description}
      title={description}
      style={customStyle({ "--pl-progress": stats.value + "%" })}
    >
      <span className="pl-work-progress-track" aria-hidden="true">
        <span className="pl-work-progress-fill" />
        <span className="pl-work-progress-dot" />
      </span>
      <span className="pl-work-progress-value">{stats.value}%</span>
    </span>
  );
}

function TableDate({ value }: { value: string | null | undefined }) {
  return value ? (
    <span className="pl-date-value" title={value}>
      <bdi>{compactListDate(value)}</bdi>
    </span>
  ) : (
    <span className="pl-dash">—</span>
  );
}

export function ProjectListTable({
  locale,
  user,
  directory,
  projects,
  tasks,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  refreshing = false,
  loadError,
  onRetry,
  onCreateProject,
  onOpenProject,
  onEditProject,
  onTask,
  onCards,
}: ProjectListTableProps) {
  const t = copy(locale),
    li = localeIndex[locale];
  const canManage = user.permissions.includes("pm.tasks.manage");
  const canEditProject = user.permissions.includes("pm.edit");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [actual, setActual] = useState(true);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(
    () => new Set()
  );
  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(
    () => new Set()
  );
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [today, setToday] = useState(businessDate);
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(businessDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const employees = useMemo(
    () => new Map(directory.employees.map(person => [person.id, person])),
    [directory.employees]
  );
  const statuses = useMemo(
    () => new Map(directory.statuses.map(status => [status.id, status])),
    [directory.statuses]
  );
  const taskById = useMemo(
    () => new Map(tasks.map(task => [task.id, task])),
    [tasks]
  );
  const progressByTask = useMemo(() => deriveListProgress(tasks), [tasks]);
  const groups = useMemo(
    () =>
      buildListGroups({
        projects,
        tasks,
        query: search,
        projectId: projectFilter,
        statusCode: statusFilter,
        collapsedProjects,
        collapsedTasks,
        assigneeNames: task =>
          task.employeeIds.map(id => employees.get(id)?.name ?? "").join(" "),
      }),
    [
      projects,
      tasks,
      search,
      projectFilter,
      statusFilter,
      collapsedProjects,
      collapsedTasks,
      employees,
    ]
  );
  const visibleTasks = groups.flatMap(group => group.rows.map(row => row.task));
  const visibleSelected = visibleTasks.filter(task =>
    selected.has(task.id)
  ).length;
  const filtered = Boolean(search.trim() || statusFilter);
  const selectedTask =
    selected.size === 1 ? taskById.get([...selected][0]) : undefined;
  const projectForNewTask =
    projectFilter === null
      ? projects.find(project => project.status === "active")
      : projects.find(project => project.id === projectFilter);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        visibleSelected > 0 && visibleSelected < visibleTasks.length;
  }, [visibleSelected, visibleTasks.length]);
  useEffect(() => {
    setSelected(previous => {
      const retained = new Set([...previous].filter(id => taskById.has(id)));
      return retained.size === previous.size ? previous : retained;
    });
  }, [taskById]);
  function toggleProject(id: number) {
    setCollapsedProjects(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTask(id: number) {
    setCollapsedTasks(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectTask(id: number) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function openTask(task: ProjectListTask) {
    onTask({
      projectId: task.projectId,
      taskId: task.id,
      parentId: task.parentId,
    });
  }
  function statusLabel(id: number, fallback: string) {
    const status = statuses.get(id);
    return status && status.version === 0 && defaultStatusLabels[status.code]
      ? defaultStatusLabels[status.code][li]
      : (status?.name ?? fallback);
  }
  const columns = (withSelection: boolean) => (
    <>
      <th className="pl-name-col" scope="col">
        <span className="pl-name-label">
          <List className="pl-icon" aria-hidden="true" />
          {t("المشروع / المهمة", "Project / task", "منصوبہ / کام")}
        </span>
      </th>
      <th className="pl-priority-col" scope="col">
        {t("الأولوية", "Priority", "ترجیح")}
      </th>
      <th className="pl-assignee-col" scope="col">
        {t("المسؤولون", "Assignees", "ذمہ داران")}
      </th>
      <th className="pl-status-col" scope="col">
        {t("الحالة", "Status", "حالت")}
      </th>
      <th className="pl-select-col" scope="col">
        <span className="pl-select-heading">
          <small>{t("تحديد", "Select", "منتخب")}</small>
          {withSelection && (
            <input
              ref={selectAll}
              className="pl-select-all-checkbox"
              type="checkbox"
              aria-label={t(
                "تحديد كل المهام الظاهرة",
                "Select all visible tasks",
                "تمام دکھائی دینے والے کام منتخب کریں"
              )}
              checked={
                visibleTasks.length > 0 &&
                visibleSelected === visibleTasks.length
              }
              disabled={!visibleTasks.length}
              onChange={event => {
                const checked = event.target.checked;
                setSelected(previous => {
                  const next = new Set(previous);
                  for (const task of visibleTasks)
                    if (checked) next.add(task.id);
                    else next.delete(task.id);
                  return next;
                });
              }}
            />
          )}
        </span>
      </th>
      <th className="pl-progress-col" scope="col">
        {t("الإنجاز", "Progress", "پیش رفت")}{" "}
        <span
          className="pl-info-icon"
          title={t(
            "محسوب من المهام النهائية المكتملة، مع استبعاد الفروع الملغاة",
            "Completed leaf tasks, excluding cancelled branches",
            "منسوخ شاخوں کے بغیر مکمل آخری کام"
          )}
        >
          <Info className="pl-icon" aria-hidden="true" />
        </span>
      </th>
      <th className="pl-timeline-col" scope="col">
        <span
          className="pl-timeline-heading"
          title={t(
            "البداية والنهاية المخططتان",
            "Planned start and finish",
            "منصوبہ شدہ آغاز اور اختتام"
          )}
        >
          Timeline
        </span>
      </th>
      <th className="pl-date-col" scope="col">
        {t("البداية المخططة", "Planned start", "منصوبہ شدہ آغاز")}
      </th>
      {actual && (
        <>
          <th className="pl-date-col pl-actual-col" scope="col">
            {t("البداية الفعلية", "Actual start", "اصل آغاز")}
          </th>
          <th className="pl-date-col pl-actual-col" scope="col">
            {t("النهاية الفعلية", "Actual finish", "اصل اختتام")}
          </th>
        </>
      )}
    </>
  );
  return (
    <section
      className="pm-list-view"
      dir={localeMeta[locale].direction}
      aria-label={t(
        "قائمة المشاريع والمهام",
        "Project and task list",
        "منصوبوں اور کاموں کی فہرست"
      )}
    >
      <div className="pl-toolbar">
        <div className="pl-toolbar-start">
          <button
            type="button"
            className="pl-btn pl-primary"
            disabled={!canManage || projectForNewTask?.status !== "active"}
            title={
              projectForNewTask?.status === "active"
                ? t(
                    "إضافة مهمة رئيسية إلى ",
                    "Add main task to ",
                    "مرکزی کام شامل کریں: "
                  ) + projectForNewTask.name
                : t(
                    "ابدأ تنفيذ المشروع المعتمد قبل إضافة المهام",
                    "Start the approved project before adding tasks",
                    "کام شامل کرنے سے پہلے منظور شدہ منصوبہ شروع کریں"
                  )
            }
            onClick={() => {
              if (projectForNewTask)
                onTask({ projectId: projectForNewTask.id, parentId: null });
            }}
          >
            <Plus className="pl-icon" aria-hidden="true" />
            {t("مهمة جديدة", "New task", "نیا کام")}
          </button>
          <div
            className="pl-view-switch"
            role="group"
            aria-label={t(
              "طريقة عرض المشاريع",
              "Project view",
              "منصوبے کا منظر"
            )}
          >
            <button type="button" aria-pressed="true">
              <List className="pl-icon" aria-hidden="true" />
              {t("الجدول", "List", "فہرست")}
            </button>
            <button type="button" aria-pressed="false" onClick={onCards}>
              <LayoutGrid className="pl-icon" aria-hidden="true" />
              {t("البطاقات", "Cards", "کارڈز")}
            </button>
          </div>
          <button
            type="button"
            className="pl-btn"
            disabled={filtered}
            onClick={() => {
              setCollapsedProjects(new Set());
              setCollapsedTasks(new Set());
            }}
            title={
              filtered
                ? t(
                    "تُوسّع النتائج تلقائيًا أثناء التصفية",
                    "Results expand automatically while filtering",
                    "فلٹر کے دوران نتائج خود بخود پھیل جاتے ہیں"
                  )
                : undefined
            }
          >
            <ChevronsUpDown className="pl-icon" aria-hidden="true" />
            {t("توسيع الكل", "Expand all", "سب کھولیں")}
          </button>
          <button
            type="button"
            className="pl-btn pl-collapse-all"
            disabled={filtered}
            onClick={() =>
              setCollapsedProjects(new Set(projects.map(project => project.id)))
            }
          >
            <ChevronsDownUp className="pl-icon" aria-hidden="true" />
            {t("طي الكل", "Collapse all", "سب سمیٹیں")}
          </button>
        </div>
        <div className="pl-toolbar-end">
          <label className="pl-search">
            <Search className="pl-icon" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              aria-label={t(
                "البحث في المشاريع والمهام والمسؤولين",
                "Search projects, tasks and assignees",
                "منصوبوں، کاموں اور ذمہ داران میں تلاش کریں"
              )}
              placeholder={t(
                "ابحث عن مشروع أو مهمة أو مسؤول...",
                "Search project, task or assignee...",
                "منصوبہ، کام یا ذمہ دار تلاش کریں..."
              )}
            />
          </label>
          <select
            className="pl-filter-select"
            aria-label={t(
              "تصفية المشروع",
              "Filter project",
              "منصوبہ فلٹر کریں"
            )}
            value={projectFilter ?? ""}
            onChange={event =>
              setProjectFilter(
                event.target.value ? Number(event.target.value) : null
              )
            }
          >
            <option value="">
              {t("كل المشاريع", "All projects", "تمام منصوبے")}
            </option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name} — {project.number}
              </option>
            ))}
          </select>
          <select
            className="pl-filter-select"
            aria-label={t(
              "تصفية حالة المهمة",
              "Filter task status",
              "کام کی حالت فلٹر کریں"
            )}
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
          >
            <option value="">
              {t(
                "كل حالات المهام",
                "All task statuses",
                "کاموں کی تمام حالتیں"
              )}
            </option>
            {directory.statuses.map(status => (
              <option key={status.id} value={status.code}>
                {statusLabel(status.id, status.name)}
              </option>
            ))}
          </select>
          <label className="pl-actual-switch">
            <input
              type="checkbox"
              checked={actual}
              onChange={event => setActual(event.target.checked)}
            />
            {t("التواريخ الفعلية", "Actual dates", "اصل تاریخیں")}
          </label>
        </div>
      </div>
      {loadError && (
        <p className="pl-notice" role="alert">
          {loadError}{" "}
          <button type="button" className="pl-btn" onClick={onRetry}>
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      )}
      {selected.size > 0 && (
        <div className="pl-table-caption">
          <div className="pl-selection-tools">
            <b>
              {t(
                `${selected.size} مهام محددة`,
                `${selected.size} tasks selected`,
                `${selected.size} کام منتخب`
              )}
            </b>
            <button
              type="button"
              className="pl-icon-btn"
              aria-label={t(
                "إلغاء التحديد",
                "Clear selection",
                "انتخاب ختم کریں"
              )}
              onClick={() => setSelected(new Set())}
            >
              <X className="pl-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pl-btn"
              disabled={
                !selectedTask ||
                !canManage ||
                projects.find(project => project.id === selectedTask.projectId)
                  ?.status !== "active"
              }
              onClick={() => {
                if (selectedTask) openTask(selectedTask);
              }}
            >
              {t("تعديل المهمة", "Edit task", "کام میں ترمیم کریں")}
            </button>
          </div>
        </div>
      )}
      {groups.length > 0 ? (
        <div
          className={"pl-table-scroll" + (actual ? " pl-with-actual" : "")}
          tabIndex={0}
          aria-label={t(
            "جدول المشاريع والمهام، يمكن تمريره أفقيًا",
            "Project and task table; scroll horizontally",
            "منصوبوں اور کاموں کا جدول، افقی اسکرول دستیاب ہے"
          )}
        >
          <table
            className="pl-project-table"
            aria-label={t(
              "المشاريع والمهام",
              "Projects and tasks",
              "منصوبے اور کام"
            )}
          >
            <thead>
              <tr>{columns(true)}</tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const { project, rows, open } = group;
                const active = project.status === "active",
                  editable =
                    canEditProject &&
                    ["draft", "returned"].includes(project.status);
                const color = ganttProjectColors(project).base,
                  colspan = actual ? 10 : 8;
                return (
                  <Fragment key={project.id}>
                    {index > 0 && (
                      <tr
                        className="pl-project-column-head"
                        data-heading-project={project.id}
                      >
                        {columns(false)}
                      </tr>
                    )}
                    <tr
                      className="pl-group-row"
                      data-project-id={project.id}
                      style={customStyle({ "--pl-project-color": color })}
                    >
                      <td colSpan={colspan}>
                        <div className="pl-group-heading">
                          <button
                            type="button"
                            className="pl-tree-toggle"
                            disabled={group.filtered}
                            aria-expanded={open}
                            aria-label={
                              t(
                                open ? "طي مشروع " : "توسيع مشروع ",
                                open ? "Collapse project " : "Expand project ",
                                open ? "منصوبہ سمیٹیں " : "منصوبہ کھولیں "
                              ) + project.name
                            }
                            onClick={() => toggleProject(project.id)}
                          >
                            <ChevronDown
                              className="pl-icon"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            className="pl-group-title"
                            onClick={() => onOpenProject(project.id)}
                            title={
                              project.number +
                              " — " +
                              t(
                                "تفاصيل المشروع",
                                "Project details",
                                "منصوبے کی تفصیلات"
                              )
                            }
                          >
                            <span className="pl-title-text">
                              {project.name}
                            </span>
                          </button>
                          <span
                            className="pl-group-count"
                            title={t(
                              `${group.roots.length} مهام رئيسية و${group.tasks.length - group.roots.length} مهام فرعية`,
                              `${group.roots.length} main tasks, ${group.tasks.length - group.roots.length} subtasks`,
                              `${group.roots.length} مرکزی، ${group.tasks.length - group.roots.length} ذیلی کام`
                            )}
                          >
                            {group.tasks.length}
                          </span>
                          <bdi className="pl-group-reference">
                            {project.number}
                          </bdi>
                          <button
                            type="button"
                            className="pl-group-add-task"
                            disabled={!canManage || !active}
                            onClick={() =>
                              onTask({ projectId: project.id, parentId: null })
                            }
                            title={t(
                              "إضافة مهمة رئيسية",
                              "Add main task",
                              "مرکزی کام شامل کریں"
                            )}
                          >
                            <Plus className="pl-icon" aria-hidden="true" />
                            <span>
                              {t("مهمة رئيسية", "Main task", "مرکزی کام")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="pl-icon-btn"
                            disabled={!editable}
                            onClick={() => onEditProject(project.id)}
                            aria-label={
                              t(
                                "تعديل مشروع ",
                                "Edit project ",
                                "منصوبے میں ترمیم "
                              ) + project.name
                            }
                            title={
                              editable
                                ? t(
                                    "تعديل المشروع",
                                    "Edit project",
                                    "منصوبے میں ترمیم کریں"
                                  )
                                : t(
                                    "يمكن تعديل المسودة أو المشروع المعاد للتعديل فقط",
                                    "Only drafts and returned projects can be edited",
                                    "صرف مسودے اور واپس کیے گئے منصوبے تبدیل کیے جا سکتے ہیں"
                                  )
                            }
                          >
                            <Pencil className="pl-icon" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="pl-icon-btn pl-group-expand"
                            disabled={group.filtered}
                            aria-label={
                              t(
                                "توسيع كل مهام ",
                                "Expand all tasks in ",
                                "تمام کام کھولیں: "
                              ) + project.name
                            }
                            onClick={() => {
                              setCollapsedProjects(previous => {
                                const next = new Set(previous);
                                next.delete(project.id);
                                return next;
                              });
                              setCollapsedTasks(
                                previous =>
                                  new Set(
                                    [...previous].filter(
                                      id =>
                                        !group.tasks.some(
                                          task => task.id === id
                                        )
                                    )
                                  )
                              );
                            }}
                          >
                            <ChevronsUpDown
                              className="pl-icon"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && !group.tasks.length && (
                      <tr>
                        <td className="pl-empty-project" colSpan={colspan}>
                          {t(
                            "لا توجد مهام مسجلة في هذا المشروع حتى الآن.",
                            "No tasks have been added to this project yet.",
                            "ابھی اس منصوبے میں کوئی کام درج نہیں ہوا۔"
                          )}
                        </td>
                      </tr>
                    )}
                    {rows.map(({ task, depth, context, childCount }) => {
                      const expanded =
                          group.filtered || !collapsedTasks.has(task.id),
                        mayEdit = canManage && active;
                      const assignees = task.employeeIds
                        .map(id => employees.get(id))
                        .filter(
                          (person): person is Directory["employees"][number] =>
                            Boolean(person)
                        );
                      const overdue =
                        task.endDate < today &&
                        !["done", "completed", "cancelled"].includes(
                          task.statusCode
                        );
                      return (
                        <tr
                          key={task.id}
                          className={
                            "pl-task-row" +
                            (childCount ? " pl-is-parent" : "") +
                            (selected.has(task.id) ? " pl-is-selected" : "")
                          }
                          data-task-id={task.id}
                          data-project-id={project.id}
                          data-context={context || undefined}
                          style={customStyle({ "--pl-project-color": color })}
                        >
                          <td className="pl-task-name-cell">
                            <div
                              className={
                                "pl-tree-cell" + (depth ? " pl-child" : "")
                              }
                              style={customStyle({ "--pl-depth": depth })}
                            >
                              {childCount ? (
                                <button
                                  type="button"
                                  className="pl-tree-toggle"
                                  disabled={group.filtered}
                                  aria-expanded={expanded}
                                  aria-label={
                                    t(
                                      expanded ? "طي تفرعات " : "توسيع تفرعات ",
                                      expanded
                                        ? "Collapse subtasks of "
                                        : "Expand subtasks of ",
                                      expanded
                                        ? "ذیلی کام سمیٹیں: "
                                        : "ذیلی کام کھولیں: "
                                    ) + task.name
                                  }
                                  onClick={() => toggleTask(task.id)}
                                >
                                  <ChevronDown
                                    className="pl-icon"
                                    aria-hidden="true"
                                  />
                                </button>
                              ) : (
                                <span
                                  className="pl-tree-leaf"
                                  aria-hidden="true"
                                />
                              )}
                              <i className="pl-task-dot" aria-hidden="true" />
                              <button
                                type="button"
                                className="pl-task-open"
                                onClick={() => openTask(task)}
                                title={
                                  task.name +
                                  (context
                                    ? t(
                                        " — تظهر للسياق",
                                        " — ancestor context",
                                        " — متعلقہ بالائی کام"
                                      )
                                    : "")
                                }
                              >
                                {task.name}
                              </button>
                              {childCount > 0 && (
                                <span
                                  className="pl-child-count"
                                  title={t(
                                    "عدد المهام الفرعية المباشرة",
                                    "Direct subtasks",
                                    "براہ راست ذیلی کام"
                                  )}
                                >
                                  {childCount}
                                </span>
                              )}
                              <span className="pl-row-actions">
                                <button
                                  type="button"
                                  className="pl-row-add-subtask"
                                  disabled={!mayEdit || task.level >= 5}
                                  onClick={() =>
                                    onTask({
                                      projectId: project.id,
                                      parentId: task.id,
                                    })
                                  }
                                  aria-label={
                                    t(
                                      "إضافة مهمة فرعية إلى ",
                                      "Add subtask to ",
                                      "ذیلی کام شامل کریں: "
                                    ) + task.name
                                  }
                                  title={
                                    task.level >= 5
                                      ? t(
                                          "وصلت إلى الحد الأقصى للتفرعات",
                                          "Maximum task depth reached",
                                          "ذیلی کاموں کی زیادہ سے زیادہ سطح"
                                        )
                                      : t(
                                          "إضافة مهمة فرعية",
                                          "Add subtask",
                                          "ذیلی کام شامل کریں"
                                        )
                                  }
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="pl-row-edit"
                                  disabled={!mayEdit}
                                  onClick={() => openTask(task)}
                                  aria-label={
                                    t("تعديل ", "Edit ", "ترمیم ") + task.name
                                  }
                                  title={t(
                                    "تعديل المهمة",
                                    "Edit task",
                                    "کام میں ترمیم کریں"
                                  )}
                                >
                                  <Pencil
                                    className="pl-icon"
                                    aria-hidden="true"
                                  />
                                </button>
                              </span>
                            </div>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="pl-cell-edit"
                              disabled={!mayEdit}
                              onClick={() => openTask(task)}
                              aria-label={
                                t(
                                  "تعديل أولوية ",
                                  "Edit priority of ",
                                  "ترجیح میں ترمیم "
                                ) + task.name
                              }
                            >
                              <span
                                className={"pl-priority pl-" + task.priority}
                              >
                                <Flag className="pl-icon" aria-hidden="true" />
                                {priorityLabels[
                                  task.priority as keyof typeof priorityLabels
                                ]?.[li] ?? task.priority}
                              </span>
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="pl-cell-edit"
                              disabled={!mayEdit}
                              onClick={() => openTask(task)}
                              aria-label={
                                t(
                                  "تعديل مسؤولي ",
                                  "Edit assignees of ",
                                  "ذمہ داران میں ترمیم "
                                ) + task.name
                              }
                            >
                              {assignees.length ? (
                                <span
                                  className="pl-assignee"
                                  title={assignees
                                    .map(
                                      person =>
                                        person.name +
                                        (person.jobTitle
                                          ? " — " + person.jobTitle
                                          : "")
                                    )
                                    .join("، ")}
                                >
                                  {assignees.map(person => (
                                    <span
                                      className="pl-person-avatar"
                                      data-person={person.id}
                                      key={person.id}
                                      aria-hidden="true"
                                    >
                                      {person.name
                                        .replace(/^م\.\s*/, "")
                                        .trim()
                                        .split(/\s+/)
                                        .slice(0, 2)
                                        .map(part => part[0])
                                        .join("")}
                                    </span>
                                  ))}
                                  <span className="pl-assignee-name">
                                    {assignees
                                      .map(person => person.name)
                                      .join("، ")}
                                  </span>
                                </span>
                              ) : (
                                <span className="pl-dash">—</span>
                              )}
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="pl-cell-edit"
                              disabled={!mayEdit}
                              onClick={() => openTask(task)}
                              aria-label={
                                t(
                                  "تعديل حالة ",
                                  "Edit status of ",
                                  "حالت میں ترمیم "
                                ) + task.name
                              }
                            >
                              <span
                                className={
                                  "pl-status-badge pl-status-" + task.statusCode
                                }
                              >
                                {statusLabel(task.statusId, task.statusName)}
                              </span>
                            </button>
                          </td>
                          <td className="pl-selection-cell">
                            <input
                              className="pl-task-select-checkbox"
                              type="checkbox"
                              aria-label={
                                t("تحديد ", "Select ", "منتخب کریں ") +
                                task.name
                              }
                              checked={selected.has(task.id)}
                              onChange={() => selectTask(task.id)}
                            />
                          </td>
                          <td
                            data-progress={progressByTask.get(task.id)?.value}
                          >
                            <ListProgressBar
                              stats={progressByTask.get(task.id)!}
                              label={
                                t("إنجاز ", "Progress of ", "پیش رفت ") +
                                task.name
                              }
                              locale={locale}
                            />
                          </td>
                          <td className="pl-timeline-cell">
                            <button
                              type="button"
                              className="pl-timeline-button"
                              onClick={() => openTask(task)}
                              aria-label={
                                t(
                                  "الفترة المخططة للمهمة ",
                                  "Planned timeline for ",
                                  "منصوبہ شدہ مدت "
                                ) + task.name
                              }
                              title={task.startDate + " — " + task.endDate}
                            >
                              <span
                                className="pl-timeline-dates"
                                data-timeline-start={task.startDate}
                                data-timeline-end={task.endDate}
                              >
                                <span className="pl-timeline-date-block">
                                  <small>
                                    {t(
                                      "البداية المخططة",
                                      "Planned start",
                                      "منصوبہ شدہ آغاز"
                                    )}
                                  </small>
                                  <span className="pl-timeline-date-value">
                                    <CalendarDays
                                      className="pl-icon"
                                      aria-hidden="true"
                                    />
                                    <bdi>{compactListDate(task.startDate)}</bdi>
                                  </span>
                                </span>
                                <ArrowLeft
                                  className="pl-icon"
                                  aria-hidden="true"
                                />
                                <span
                                  className={
                                    "pl-timeline-date-block pl-timeline-date-end" +
                                    (overdue ? " pl-is-overdue" : "")
                                  }
                                  title={
                                    overdue
                                      ? t(
                                          "تجاوز تاريخ النهاية المخطط والمهمة غير منتهية",
                                          "Past the planned finish; task is not complete",
                                          "منصوبہ شدہ اختتام گزر گیا، کام مکمل نہیں"
                                        )
                                      : undefined
                                  }
                                >
                                  <small>
                                    {t(
                                      "النهاية المخططة",
                                      "Planned finish",
                                      "منصوبہ شدہ اختتام"
                                    )}
                                  </small>
                                  <span className="pl-timeline-date-value">
                                    <CalendarDays
                                      className="pl-icon"
                                      aria-hidden="true"
                                    />
                                    <bdi>{compactListDate(task.endDate)}</bdi>
                                  </span>
                                </span>
                              </span>
                            </button>
                          </td>
                          <td>
                            <TableDate value={task.startDate} />
                          </td>
                          {actual && (
                            <>
                              <td className="pl-actual-col">
                                <TableDate value={task.actualStartDate} />
                              </td>
                              <td className="pl-actual-col">
                                <TableDate value={task.actualEndDate} />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {open && (
                      <tr className="pl-add-task-row">
                        <td colSpan={colspan}>
                          <button
                            type="button"
                            disabled={!canManage || !active}
                            onClick={() =>
                              onTask({ projectId: project.id, parentId: null })
                            }
                          >
                            <Plus className="pl-icon" aria-hidden="true" />
                            {t("إضافة مهمة", "Add task", "کام شامل کریں")}
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pl-no-results">
          <Search className="pl-icon" aria-hidden="true" />
          <p>
            {projects.length
              ? t(
                  "لا توجد مشاريع أو مهام تطابق البحث والتصفية.",
                  "No projects or tasks match these filters.",
                  "کوئی منصوبہ یا کام ان فلٹرز سے مطابقت نہیں رکھتا۔"
                )
              : t(
                  "لا توجد مشاريع مسجلة حتى الآن.",
                  "No projects have been added yet.",
                  "ابھی کوئی منصوبہ درج نہیں ہوا۔"
                )}
          </p>
          {projects.length > 0 ? (
            <button
              type="button"
              className="pl-btn"
              onClick={() => {
                setSearch("");
                setProjectFilter(null);
                setStatusFilter("");
              }}
            >
              {t("مسح التصفية", "Clear filters", "فلٹر صاف کریں")}
            </button>
          ) : (
            user.permissions.includes("pm.create") && (
              <button
                type="button"
                className="pl-btn pl-primary"
                onClick={onCreateProject}
              >
                {t("إنشاء مشروع", "Create project", "منصوبہ بنائیں")}
              </button>
            )
          )}
        </div>
      )}
      <div className="pl-workspace-footer">
        <span role="status">
          {t(
            `عرض ${visibleTasks.length} من ${tasks.length} مهمة — ${groups.length} من ${projects.length} مشاريع`,
            `${visibleTasks.length} of ${tasks.length} tasks — ${groups.length} of ${projects.length} projects`,
            `${tasks.length} میں سے ${visibleTasks.length} کام — ${projects.length} میں سے ${groups.length} منصوبے`
          )}
          {refreshing && (
            <LoaderCircle
              className="pl-icon"
              aria-label={t("جاري التحديث", "Refreshing", "اپ ڈیٹ ہو رہا ہے")}
            />
          )}
        </span>
        <span>
          {t(
            "اضغط على اسم المهمة لعرض تفاصيلها",
            "Click a task name for details",
            "تفصیلات کے لیے کام کے نام پر کلک کریں"
          )}
        </span>
      </div>
      {hasMore && (
        <div className="pl-pagination">
          <p>
            {t(
              "البحث والتصفية يشملان المشاريع المحمّلة. حمّل المزيد لإظهار بقية المشاريع المتاحة.",
              "Search and filters cover loaded projects. Load more to include the remaining available projects.",
              "تلاش اور فلٹر لوڈ شدہ منصوبوں پر لاگو ہیں۔ باقی دستیاب منصوبوں کے لیے مزید لوڈ کریں۔"
            )}
          </p>
          <button
            type="button"
            className="pl-btn"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore && (
              <LoaderCircle className="pl-icon" aria-hidden="true" />
            )}
            {loadingMore
              ? t("جاري التحميل…", "Loading…", "لوڈ ہو رہا ہے…")
              : t(
                  "تحميل مشاريع إضافية",
                  "Load more projects",
                  "مزید منصوبے لوڈ کریں"
                )}
          </button>
        </div>
      )}
    </section>
  );
}
