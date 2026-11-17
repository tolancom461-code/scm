import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { X } from "lucide-react";
import { toast } from "sonner";
import { businessDate } from "@shared/date";
import { taskExecutionMetrics, taskExecutionStatus } from "@shared/gantt";
import {
  ganttColorInput,
  ganttColorText,
  ganttPaletteInput,
  ganttPalettes,
  ganttProjectColors,
} from "@shared/gantt-colors";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import { PortfolioTimeline } from "./PortfolioTimeline";
import { TaskDependencyPanel } from "./TaskDependencyPanel";
import "./gantt-portfolio.css";

const ProjectForm = lazy(() =>
  import("../project-management/ProjectModule").then(module => ({
    default: module.ProjectForm,
  }))
);

type Outputs = inferRouterOutputs<AppRouter>["gantt"];
type User = { id: number; permissions: string[] };
type Project = Outputs["portfolio"]["projects"][number];
type Task = Outputs["portfolio"]["tasks"][number];
type Editor = { projectId: number; taskId?: number };
type ColorSelection = { kind: "project" | "task" | "details"; id: number };
type LinkPair = { from: Task; to: Task };
const emptyProjects: Outputs["portfolioDirectory"] = [];

function words(locale: Locale) {
  return (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;
}

function PortfolioDialog({
  title,
  close,
  locale,
  busy,
  children,
}: {
  title: string;
  close: () => void;
  locale: Locale;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      className="gantt-portfolio-dialog"
      dir={localeMeta[locale].direction}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          aria-label={words(locale)("إغلاق", "Close", "بند کریں")}
          disabled={busy}
          onClick={close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function ProjectPicker({
  locale,
  directory,
  selected,
  close,
  apply,
}: {
  locale: Locale;
  directory: Outputs["portfolioDirectory"];
  selected: number[] | null;
  close: () => void;
  apply: (ids: number[] | null) => void;
}) {
  const t = words(locale);
  const [filter, setFilter] = useState("");
  const [all, setAll] = useState(selected === null);
  const [ids, setIds] = useState(new Set(selected ?? directory.map(p => p.id)));
  const query = filter.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = directory.filter(project =>
    `${project.name} ${project.number}`
      .normalize("NFKC")
      .toLocaleLowerCase()
      .includes(query)
  );
  return (
    <PortfolioDialog
      locale={locale}
      title={t("عرض المشاريع", "Show projects", "منصوبے دکھائیں")}
      close={close}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          apply(
            all ? null : directory.filter(p => ids.has(p.id)).map(p => p.id)
          );
          close();
        }}
      >
        <div className="gantt-portfolio-dialog-body">
          <input
            type="search"
            aria-label={t(
              "اسم المشروع أو رقمه",
              "Project name or number",
              "منصوبے کا نام یا نمبر"
            )}
            placeholder={t(
              "ابحث باسم المشروع أو رقمه…",
              "Search by project name or number…",
              "نام یا نمبر سے تلاش کریں…"
            )}
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
          <div className="gantt-portfolio-actions">
            <button
              type="button"
              onClick={() => {
                setAll(true);
                setIds(new Set(directory.map(p => p.id)));
              }}
            >
              {t("اختيار الكل", "Select all", "سب منتخب کریں")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAll(false);
                setIds(new Set());
              }}
            >
              {t("مسح التحديد", "Clear selection", "انتخاب صاف کریں")}
            </button>
            <small>
              {ids.size} {t("محدد", "selected", "منتخب")}
            </small>
          </div>
          <div className="gantt-portfolio-project-list">
            {matches.map(project => (
              <label key={project.id}>
                <input
                  type="checkbox"
                  checked={ids.has(project.id)}
                  onChange={event => {
                    const next = new Set(ids);
                    if (event.target.checked) next.add(project.id);
                    else next.delete(project.id);
                    setAll(false);
                    setIds(next);
                  }}
                />
                <i
                  style={{ background: ganttProjectColors(project).base }}
                  aria-hidden="true"
                />
                <span>{project.name}</span>
                <small>
                  <bdi>{project.number}</bdi>
                </small>
              </label>
            ))}
            {!matches.length && (
              <p role="status">
                {t(
                  "لا توجد مشاريع مطابقة.",
                  "No matching projects.",
                  "کوئی مماثل منصوبہ نہیں۔"
                )}
              </p>
            )}
          </div>
        </div>
        <footer>
          <button type="button" onClick={close}>
            {t("إلغاء", "Cancel", "منسوخ کریں")}
          </button>
          <button className="gantt-portfolio-primary" type="submit">
            {t("عرض المحدد", "Show selection", "منتخب منصوبے دکھائیں")}
          </button>
        </footer>
      </form>
    </PortfolioDialog>
  );
}

function useColorSave(locale: Locale, close: () => void) {
  const utils = trpc.useUtils();
  const attempt = useRef<{ data: string; key: string } | null>(null);
  return {
    operationKey(input: object) {
      const data = JSON.stringify(input);
      if (attempt.current?.data !== data)
        attempt.current = { data, key: crypto.randomUUID() };
      return attempt.current.key;
    },
    async refresh() {
      await Promise.allSettled([
        utils.gantt.invalidate(),
        utils.projectManagement.invalidate(),
      ]);
      toast.success(
        words(locale)("تم حفظ اللون", "Color saved", "رنگ محفوظ ہوگیا")
      );
      close();
    },
  };
}

function ColorFooter({
  locale,
  pending,
  disabled,
  close,
}: {
  locale: Locale;
  pending: boolean;
  disabled: boolean;
  close: () => void;
}) {
  const t = words(locale);
  return (
    <footer>
      <button type="button" disabled={pending} onClick={close}>
        {t("إلغاء", "Cancel", "منسوخ کریں")}
      </button>
      <button
        type="submit"
        className="gantt-portfolio-primary"
        disabled={pending || disabled}
      >
        {pending
          ? t("جارٍ الحفظ…", "Saving…", "محفوظ کیا جا رہا ہے…")
          : t("حفظ اللون", "Save color", "رنگ محفوظ کریں")}
      </button>
    </footer>
  );
}

function ProjectColor({
  project,
  locale,
  close,
}: {
  project: Project;
  locale: Locale;
  close: () => void;
}) {
  const t = words(locale);
  const initial =
    ganttPaletteInput.safeParse(project.ganttPalette).data ?? null;
  const initialColor =
    ganttColorInput.safeParse(project.ganttColor).data ?? null;
  const [preset, setPreset] = useState(initial);
  const [custom, setCustom] = useState(initialColor);
  const selection = ganttProjectColors({
    id: project.id,
    ganttPalette: preset,
    ganttColor: custom,
  });
  const { operationKey, refresh } = useColorSave(locale, close);
  const save = trpc.gantt.saveProjectColor.useMutation({ onSuccess: refresh });
  const changed = preset !== initial || custom !== initialColor;
  return (
    <PortfolioDialog
      locale={locale}
      title={t("لوحة ألوان المشروع", "Project colors", "منصوبے کے رنگ")}
      busy={save.isPending}
      close={close}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!changed || save.isPending) return;
          const fields = {
            projectId: project.id,
            version: project.version,
            ganttPalette: preset,
            ganttColor: custom,
          };
          save.mutate({ ...fields, key: operationKey(fields) });
        }}
      >
        <div className="gantt-portfolio-dialog-body">
          <strong>{project.name}</strong>
          <div
            className="gantt-portfolio-palettes"
            role="group"
            aria-label={t("لوحات الألوان", "Color palettes", "رنگوں کے پیلیٹ")}
          >
            {ganttPalettes.map(palette => (
              <button
                key={palette.id}
                type="button"
                aria-pressed={palette.id === preset && custom === null}
                disabled={save.isPending}
                onClick={() => {
                  setPreset(palette.id);
                  setCustom(null);
                }}
              >
                {palette.label[locale]}
                <span aria-hidden="true">
                  {ganttProjectColors({ ganttPalette: palette.id }).levels.map(
                    color => (
                      <i key={color} style={{ background: color }} />
                    )
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="gantt-portfolio-actions">
            <label className="gantt-portfolio-color-field">
              <input
                type="color"
                value={selection.base}
                disabled={save.isPending}
                onChange={event => setCustom(event.target.value)}
              />
              {t(
                "لون مخصص للمشروع",
                "Custom project color",
                "منصوبے کا مخصوص رنگ"
              )}
            </label>
            {custom && (
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => setCustom(null)}
              >
                {t(
                  "استخدام لون اللوحة",
                  "Use palette color",
                  "پیلیٹ کا رنگ استعمال کریں"
                )}
              </button>
            )}
          </div>
          <div
            className="gantt-portfolio-levels"
            aria-label={t(
              "معاينة الدرجات الخمس",
              "Preview of five levels",
              "پانچ درجوں کا پیش منظر"
            )}
          >
            {selection.levels.map((color, index) => (
              <div key={color}>
                <i aria-hidden="true" style={{ background: color }} />
                <small>
                  {index === 0
                    ? t("رئيسية", "Main task", "مرکزی کام")
                    : t(
                        `فرعي ${index}`,
                        `Level ${index}`,
                        `ذیلی درجہ ${index}`
                      )}
                </small>
              </div>
            ))}
          </div>
          {save.isError && (
            <p className="gantt-portfolio-error" role="alert">
              {save.error.message}
            </p>
          )}
        </div>
        <ColorFooter
          locale={locale}
          pending={save.isPending}
          disabled={!changed}
          close={close}
        />
      </form>
    </PortfolioDialog>
  );
}

function TaskColor({
  task,
  project,
  locale,
  details,
  canEdit,
  openEditor,
  close,
}: {
  task: Task;
  project: Project;
  locale: Locale;
  details: boolean;
  canEdit: boolean;
  openEditor: (editor: Editor) => void;
  close: () => void;
}) {
  const t = words(locale);
  const initial = ganttColorInput.safeParse(task.color).data ?? null;
  const [chosen, setChosen] = useState(initial);
  const inherited =
    ganttProjectColors(project).levels[
      Math.max(0, Math.min(4, task.level - 1))
    ];
  const shown = chosen ?? inherited;
  const { operationKey, refresh } = useColorSave(locale, close);
  const save = trpc.gantt.saveTaskColor.useMutation({ onSuccess: refresh });
  return (
    <PortfolioDialog
      locale={locale}
      title={
        details
          ? t("تفاصيل المهمة", "Task details", "کام کی تفصیلات")
          : t("لون المهمة", "Task color", "کام کا رنگ")
      }
      busy={save.isPending}
      close={close}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!canEdit || chosen === initial || save.isPending) return;
          const fields = {
            projectId: project.id,
            taskId: task.id,
            version: task.version,
            color: chosen,
          };
          save.mutate({ ...fields, key: operationKey(fields) });
        }}
      >
        <div className="gantt-portfolio-dialog-body">
          <div className="gantt-portfolio-dialog-note">
            <strong>{task.name}</strong>
            <small>
              {project.name} · <bdi>{project.number}</bdi>
            </small>
          </div>
          {details && (
            <dl className="gantt-portfolio-task-dates">
              <div>
                <dt>
                  {t("البداية المخططة", "Planned start", "منصوبہ شدہ آغاز")}
                </dt>
                <dd>
                  <bdi>{task.startDate}</bdi>
                </dd>
              </div>
              <div>
                <dt>
                  {t("النهاية المخططة", "Planned finish", "منصوبہ شدہ اختتام")}
                </dt>
                <dd>
                  <bdi>{task.endDate}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("البداية الفعلية", "Actual start", "حقیقی آغاز")}</dt>
                <dd>
                  <bdi>{task.actualStartDate ?? "—"}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("النهاية الفعلية", "Actual finish", "حقیقی اختتام")}</dt>
                <dd>
                  <bdi>{task.actualEndDate ?? "—"}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("الحالة", "Status", "حالت")}</dt>
                <dd>{task.statusName}</dd>
              </div>
              <div>
                <dt>{t("المسؤولون", "Assignees", "ذمہ داران")}</dt>
                <dd>{task.assignees.join("، ") || "—"}</dd>
              </div>
            </dl>
          )}
          {canEdit && (
            <>
              <div
                className="gantt-portfolio-swatches"
                role="group"
                aria-label={t(
                  "ألوان جاهزة للمهمة",
                  "Task color presets",
                  "کام کے تیار رنگ"
                )}
              >
                {ganttPalettes.map(palette => (
                  <button
                    type="button"
                    key={palette.id}
                    disabled={save.isPending}
                    aria-label={palette.label[locale]}
                    title={palette.label[locale]}
                    aria-pressed={chosen === palette.color}
                    onClick={() => setChosen(palette.color)}
                  >
                    <i
                      style={{ background: palette.color }}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
              <div className="gantt-portfolio-actions">
                <label className="gantt-portfolio-color-field">
                  <input
                    type="color"
                    value={shown}
                    disabled={save.isPending}
                    onChange={event => setChosen(event.target.value)}
                  />
                  {t(
                    "لون مخصص للمهمة",
                    "Custom task color",
                    "کام کا مخصوص رنگ"
                  )}
                </label>
                <button
                  type="button"
                  disabled={save.isPending || chosen === null}
                  onClick={() => setChosen(null)}
                >
                  {t(
                    "استخدام ألوان المشروع",
                    "Use project colors",
                    "منصوبے کے رنگ استعمال کریں"
                  )}
                </button>
              </div>
              <div
                className="gantt-portfolio-color-preview"
                style={{ background: shown, color: ganttColorText(shown) }}
                aria-label={t(
                  "معاينة لون المهمة",
                  "Task color preview",
                  "کام کے رنگ کا پیش منظر"
                )}
              >
                {task.name}
              </div>
              {save.isError && (
                <p className="gantt-portfolio-error" role="alert">
                  {save.error.message}
                </p>
              )}
            </>
          )}
          {details && (
            <div>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() =>
                  openEditor({ projectId: project.id, taskId: task.id })
                }
              >
                {t(
                  "فتح المهمة في محرر جانت",
                  "Open task in Gantt editor",
                  "گانٹ میں کام کھولیں"
                )}
              </button>
            </div>
          )}
        </div>
        {canEdit && (
          <ColorFooter
            locale={locale}
            pending={save.isPending}
            disabled={chosen === initial}
            close={close}
          />
        )}
      </form>
    </PortfolioDialog>
  );
}

function PortfolioSummary({
  locale,
  projects,
  tasks,
  close,
}: {
  locale: Locale;
  projects: Project[];
  tasks: Task[];
  close: () => void;
}) {
  const t = words(locale);
  const finishes = [
    ...projects.map(
      project => project.forecastEndDate ?? project.plannedEndDate
    ),
    ...tasks.map(task => task.endDate),
  ]
    .filter((value): value is string => Boolean(value))
    .sort();
  const metrics = [
    [
      t("المشاريع المعروضة", "Shown projects", "دکھائے گئے منصوبے"),
      projects.length,
    ],
    [t("مهام المشاريع", "Project tasks", "منصوبوں کے کام"), tasks.length],
    [
      t("المهام المنتهية", "Completed tasks", "مکمل کام"),
      tasks.filter(task => task.statusCode === "done").length,
    ],
    [
      t("آخر نهاية مجدولة", "Latest scheduled finish", "آخری طے شدہ اختتام"),
      finishes.at(-1) ?? "—",
    ],
  ];
  return (
    <PortfolioDialog
      locale={locale}
      title={t("ملخص المشاريع", "Project summary", "منصوبوں کا خلاصہ")}
      close={close}
    >
      <dl className="gantt-portfolio-summary">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </PortfolioDialog>
  );
}

export function GanttPortfolio({
  locale,
  user,
  openEditor,
}: {
  locale: Locale;
  user: User;
  openEditor: (editor: Editor) => void;
}) {
  const t = words(locale);
  const utils = trpc.useUtils();
  const canEdit = user.permissions.includes("pm.tasks.manage");
  const directory = trpc.gantt.portfolioDirectory.useQuery();
  const candidates = directory.data ?? emptyProjects;
  const [selected, setSelected] = useState<number[] | null>(null);
  const projectIds = useMemo(() => {
    const allowed = new Set(selected);
    return candidates
      .filter(project => selected === null || allowed.has(project.id))
      .map(project => project.id);
  }, [candidates, selected]);
  const chart = trpc.gantt.portfolio.useQuery(
    { projectIds },
    { enabled: projectIds.length > 0 }
  );
  const [picker, setPicker] = useState(false);
  const [summary, setSummary] = useState(false);
  const [creating, setCreating] = useState(false);
  const [colors, setColors] = useState<ColorSelection | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [pair, setPair] = useState<LinkPair | null>(null);
  const [search, setSearch] = useState("");
  const [today, setToday] = useState(businessDate);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(businessDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useMemo(() => {
    const projectById = new Map(
      chart.data?.projects.map(project => [project.id, project])
    );
    const byTask = new Map<number, Task>();
    const byProject = new Map<number, Task[]>();
    for (const task of chart.data?.tasks ?? []) {
      byTask.set(task.id, task);
      const children = byProject.get(task.projectId) ?? [];
      children.push(task);
      byProject.set(task.projectId, children);
    }
    const copy = words(locale);
    return {
      projectById,
      byTask,
      projects: (chart.data?.projects ?? []).map(project => {
        const shades = ganttProjectColors(project);
        return {
          id: project.id,
          number: project.number,
          name: project.name,
          plannedStartDate: project.plannedStartDate,
          startDate: project.actualStartDate ?? project.plannedStartDate,
          endDate: project.forecastEndDate ?? project.plannedEndDate,
          color: shades.base,
          workingDays: project.settings.workingDays,
          tasks: (byProject.get(project.id) ?? []).map(task => {
            const executionStatus = taskExecutionStatus(task.statusCode);
            const delay =
              executionStatus !== "completed" && task.endDate < today
                ? taskExecutionMetrics(
                    { ...task, executionStatus },
                    project.settings,
                    today
                  ).endDelayDays
                : 0;
            return {
              id: task.id,
              parentId: task.parentId,
              name: task.name,
              startDate: task.startDate,
              endDate: task.endDate,
              color:
                ganttColorInput.safeParse(task.color).data ??
                shades.levels[Math.max(0, Math.min(4, task.level - 1))],
              statusLabel: delay
                ? copy(
                    `متأخرة · ${delay} يوم عمل`,
                    `Late · ${delay} workdays`,
                    `تاخیر · ${delay} کام کے دن`
                  )
                : task.statusName,
              statusTone: (delay
                ? "late"
                : executionStatus === "completed"
                  ? "done"
                  : executionStatus === "in_progress"
                    ? "active"
                    : "pending") as "late" | "done" | "active" | "pending",
              owner: task.assignees.join(locale === "en" ? ", " : "، "),
              isMilestone: task.isMilestone,
            };
          }),
        };
      }),
      links: (chart.data?.links ?? []).map(link => ({
        id: link.id,
        from: link.fromTaskId,
        to: link.toTaskId,
        type: link.type,
        lag: link.lagDays,
      })),
    };
  }, [chart.data, locale, today]);

  const cancelLink = () => {
    setLinkMode(false);
    setSourceId(null);
    setPair(null);
  };
  const chooseTask = (id: number) => {
    const task = model.byTask.get(id);
    if (!task) return;
    if (!linkMode) {
      setFocused(id);
      setColors({ kind: "details", id });
      return;
    }
    const predecessor =
      sourceId === null ? undefined : model.byTask.get(sourceId);
    if (!predecessor) {
      setSourceId(id);
      return;
    }
    if (predecessor.projectId === task.projectId) {
      toast.error(
        t(
          "اختر المهمة التابعة من مشروع آخر.",
          "Choose the successor from another project.",
          "اگلا کام دوسرے منصوبے سے منتخب کریں۔"
        )
      );
      return;
    }
    setPair({ from: predecessor, to: task });
  };
  const selectedTask =
    colors && colors.kind !== "project"
      ? model.byTask.get(colors.id)
      : undefined;
  const selectedProject =
    colors?.kind === "project"
      ? model.projectById.get(colors.id)
      : selectedTask && model.projectById.get(selectedTask.projectId);
  const predecessorProject = pair && model.projectById.get(pair.from.projectId);
  const source = sourceId === null ? undefined : model.byTask.get(sourceId);
  const loading =
    directory.isPending || (projectIds.length > 0 && chart.isPending);
  const failed = directory.error ?? (projectIds.length ? chart.error : null);
  return (
    <section
      className="gantt-studio-shell gantt-portfolio-shell"
      dir={localeMeta[locale].direction}
    >
      <header className="gantt-portfolio-header">
        <strong>
          <bdi>Gantt Studio</bdi>
        </strong>
        <button
          type="button"
          onClick={() => setPicker(true)}
          disabled={!directory.data}
        >
          {t("عرض المشاريع", "Show projects", "منصوبے دکھائیں")}
          <span aria-hidden="true"> ▾</span>
        </button>
        <small className="gantt-portfolio-count">
          {projectIds.length} / {candidates.length}
        </small>
        <div className="gantt-portfolio-actions">
          <button
            type="button"
            onClick={() => setSummary(true)}
            disabled={loading || Boolean(failed)}
          >
            {t("الملخص", "Summary", "خلاصہ")}
          </button>
          {user.permissions.includes("pm.create") && (
            <button
              className="gantt-portfolio-primary"
              type="button"
              onClick={() => setCreating(true)}
            >
              + {t("إنشاء مشروع", "Create project", "منصوبہ بنائیں")}
            </button>
          )}
        </div>
      </header>
      {linkMode && (
        <div className="gantt-portfolio-link-hint" role="status">
          <span>
            {source ? (
              <>
                {t("المهمة السابقة", "Predecessor", "سابقہ کام")}{" "}
                <bdi>{source.name}</bdi> ·{" "}
                {t(
                  "اختر المهمة التابعة من مشروع آخر.",
                  "Choose a successor in another project.",
                  "دوسرے منصوبے سے اگلا کام منتخب کریں۔"
                )}
              </>
            ) : (
              t(
                "اختر المهمة السابقة، ثم المهمة التي تعتمد عليها.",
                "Choose the predecessor, then the task that depends on it.",
                "پہلے سابقہ کام پھر اس پر منحصر کام منتخب کریں۔"
              )
            )}
          </span>
          <button type="button" onClick={cancelLink}>
            {t("إلغاء الربط", "Cancel linking", "ربط منسوخ کریں")}
          </button>
        </div>
      )}
      {failed ? (
        <div className="gantt-portfolio-message" role="alert">
          <p>{failed.message}</p>
          <button
            type="button"
            onClick={() =>
              void (directory.isError ? directory.refetch() : chart.refetch())
            }
          >
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </div>
      ) : loading ? (
        <p className="gantt-portfolio-message" role="status">
          {t(
            "جارٍ تحميل المشاريع…",
            "Loading projects…",
            "منصوبے لوڈ ہو رہے ہیں…"
          )}
        </p>
      ) : model.projects.length ? (
        <PortfolioTimeline
          locale={locale}
          projects={model.projects}
          links={model.links}
          today={today}
          search={search}
          showLinks={showLinks}
          linkMode={linkMode}
          sourceTaskId={sourceId}
          targetTaskId={pair?.to.id}
          focusedTaskId={focused}
          onTaskClick={chooseTask}
          onTaskColor={
            canEdit ? id => setColors({ kind: "task", id }) : undefined
          }
          onProjectColor={
            canEdit ? id => setColors({ kind: "project", id }) : undefined
          }
          onProjectOpen={projectId => openEditor({ projectId })}
          actions={
            <div className="gantt-portfolio-actions">
              {canEdit && (
                <button
                  type="button"
                  aria-pressed={linkMode}
                  disabled={model.projects.length < 2}
                  onClick={() => {
                    if (linkMode) cancelLink();
                    else {
                      setSearch("");
                      setFocused(null);
                      setLinkMode(true);
                    }
                  }}
                >
                  {t(
                    "ربط مباشر بين المهام",
                    "Link tasks directly",
                    "کام براہ راست جوڑیں"
                  )}
                </button>
              )}
              <button
                type="button"
                aria-pressed={showLinks}
                onClick={() => setShowLinks(value => !value)}
              >
                {t("الروابط", "Links", "روابط")}
              </button>
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t(
                  "ابحث عن مهمة…",
                  "Find a task…",
                  "کام تلاش کریں…"
                )}
                aria-label={t("ابحث عن مهمة", "Find a task", "کام تلاش کریں")}
              />
            </div>
          }
        />
      ) : (
        <p className="gantt-portfolio-message">
          {candidates.length
            ? t(
                "اختر المشاريع التي تريد عرضها.",
                "Select projects to display.",
                "دکھانے کے لیے منصوبے منتخب کریں۔"
              )
            : t(
                "لا توجد مشاريع مفتوحة للعرض في جانت.",
                "There are no open projects for Gantt.",
                "گانٹ میں دکھانے کے لیے کوئی کھلا منصوبہ نہیں۔"
              )}
        </p>
      )}
      {picker && (
        <ProjectPicker
          locale={locale}
          directory={candidates}
          selected={selected}
          close={() => setPicker(false)}
          apply={ids => {
            cancelLink();
            setFocused(null);
            setSelected(ids);
          }}
        />
      )}
      {summary && (
        <PortfolioSummary
          locale={locale}
          projects={chart.data?.projects ?? []}
          tasks={chart.data?.tasks ?? []}
          close={() => setSummary(false)}
        />
      )}
      {creating && (
        <Suspense
          fallback={
            <p className="gantt-portfolio-message" role="status">
              …
            </p>
          }
        >
          <ProjectForm
            locale={locale}
            user={user}
            close={() => setCreating(false)}
            saved={() => {
              setCreating(false);
              void utils.projectManagement.invalidate();
              void utils.gantt.portfolioDirectory.invalidate();
              toast.success(
                t(
                  "تم حفظ المشروع كمسودة.",
                  "Project saved as a draft.",
                  "منصوبہ مسودے کے طور پر محفوظ ہو گیا۔"
                )
              );
            }}
          />
        </Suspense>
      )}
      {selectedProject && colors?.kind === "project" && canEdit && (
        <ProjectColor
          key={selectedProject.id}
          project={selectedProject}
          locale={locale}
          close={() => setColors(null)}
        />
      )}
      {selectedProject && selectedTask && (
        <TaskColor
          key={selectedTask.id}
          task={selectedTask}
          project={selectedProject}
          locale={locale}
          canEdit={canEdit}
          details={colors?.kind === "details"}
          close={() => setColors(null)}
          openEditor={editor => {
            setColors(null);
            openEditor(editor);
          }}
        />
      )}
      {pair && predecessorProject && (
        <TaskDependencyPanel
          key={`${pair.from.id}:${pair.to.id}`}
          locale={locale}
          projectId={pair.to.projectId}
          taskId={pair.to.id}
          taskName={pair.to.name}
          fixedPredecessor={{
            id: pair.from.id,
            name: pair.from.name,
            projectName: predecessorProject.name,
            projectNumber: predecessorProject.number,
          }}
          canEdit={canEdit}
          onClose={() => setPair(null)}
          onSaved={() => {
            setFocused(pair.to.id);
            setLinkMode(false);
            setSourceId(null);
            setShowLinks(true);
            toast.success(
              t("تم حفظ العلاقة", "Dependency saved", "ربط محفوظ ہو گیا")
            );
          }}
        />
      )}
    </section>
  );
}
