import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { X } from "lucide-react";
import { toast } from "sonner";
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
import "./gantt-portfolio.css";

type Outputs = inferRouterOutputs<AppRouter>["gantt"];
type Project = Outputs["portfolio"]["projects"][number];
type Task = Outputs["portfolio"]["tasks"][number];

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

export function ProjectPicker({
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

export function ProjectColor({
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

export function TaskColor({
  task,
  project,
  locale,
  canEdit,
  close,
}: {
  task: Task;
  project: Project;
  locale: Locale;
  canEdit: boolean;
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
      title={t("لون المهمة", "Task color", "کام کا رنگ")}
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

export function PortfolioSummary({
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
