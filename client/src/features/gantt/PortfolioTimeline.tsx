import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from "lucide-react";
import { localeMeta, type Locale } from "@/lib/i18n";
import { businessDate } from "@shared/date";
import type { GanttHoliday, GanttRelationType } from "@shared/gantt";
import { ganttColorText } from "@shared/gantt-colors";
import "./portfolio-timeline.css";

export type PortfolioTimelineTask = {
  id: number;
  parentId: number | null;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
  owner?: string | null;
  isMilestone?: boolean;
  statusLabel: string;
  statusTone?: "done" | "late" | "active" | "pending";
};

export type PortfolioTimelineProject = {
  id: number;
  number: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  plannedStartDate?: string | null;
  color: string;
  workingDays?: number[];
  holidays?: GanttHoliday[];
  calendarRevision?: number;
  tasks: PortfolioTimelineTask[];
};

export type PortfolioTimelineLink = {
  id: number;
  from: number;
  to: number;
  type: GanttRelationType;
  lag?: number;
};

type Props = {
  locale: Locale;
  projects: PortfolioTimelineProject[];
  links: PortfolioTimelineLink[];
  search?: string;
  showLinks?: boolean;
  linkMode?: boolean;
  sourceTaskId?: number | null;
  targetTaskId?: number | null;
  focusedTaskId?: number | null;
  today?: string;
  actions?: ReactNode;
  onProjectOpen?: (id: number) => void;
  onTaskClick: (id: number) => void;
  onProjectColor?: (id: number) => void;
  onTaskColor?: (id: number) => void;
};

const dayMs = 86_400_000;
const rowHeight = 44;
const axisHeight = 54;
const overscan = 8;
const milestoneSize = 14;
const defaultWorkingDays = [0, 1, 2, 3, 4];

type Range = { start: number; end: number };
type AxisMark = { day: number; width: number; label: string };
type ChartStyle = CSSProperties & Record<`--pt-${string}`, string | number>;
type Row =
  | {
      type: "project";
      project: PortfolioTimelineProject;
      dates: Range | null;
      open: boolean;
    }
  | {
      type: "task";
      project: PortfolioTimelineProject;
      task: PortfolioTimelineTask;
      dates: Range | null;
      depth: number;
      open: boolean;
      expandable: boolean;
    };

function toDay(date: string | null) {
  if (!date) return null;
  const day = Date.parse(`${date}T00:00:00Z`) / dayMs;
  return Number.isFinite(day) ? day : null;
}

function dateRange(start: string | null, end: string | null): Range | null {
  const first = toDay(start);
  const last = toDay(end);
  if (first === null && last === null) return null;
  const known = first ?? last!;
  return { start: known, end: Math.max(known, last ?? known) };
}

function mergedDates(a: Range | null, b: Range | null): Range | null {
  if (!a || !b) return a ?? b;
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

function monthsInRange(
  range: Range,
  pixelDay: number,
  format: Intl.DateTimeFormat
) {
  const step = Math.max(1, Math.ceil(64 / (28 * pixelDay)));
  const marks: AxisMark[] = [];
  for (let day = range.start; day <= range.end; ) {
    const date = new Date(day * dayMs);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + step);
    const next = Math.min(range.end + 1, date.getTime() / dayMs);
    marks.push({ day, width: next - day, label: format.format(day * dayMs) });
    day = next;
  }
  return marks;
}

function daysInRange(range: Range, pixelDay: number, lang: string) {
  const span = range.end - range.start + 1;
  const step = Math.max(1, Math.ceil(28 / pixelDay), Math.ceil(span / 900));
  const formatter = new Intl.DateTimeFormat(lang, {
    timeZone: "UTC",
    day: "numeric",
  });
  const marks: AxisMark[] = [];
  for (let day = range.start; day <= range.end; day += step) {
    marks.push({
      day,
      width: Math.min(step, range.end + 1 - day),
      label: formatter.format(day * dayMs),
    });
  }
  return marks;
}

function weekShade(rangeStart: number, pixelDay: number, workdays: number[]) {
  if (pixelDay < 9 || workdays.length === 7) return "none";
  const workWeek = new Set(workdays);
  const fromWeekday = new Date(rangeStart * dayMs).getUTCDay();
  const stops = Array.from({ length: 7 }, (_, index) => {
    const fill = workWeek.has((fromWeekday + index) % 7)
      ? "transparent"
      : "#63789212";
    return `${fill} ${index * pixelDay}px ${(index + 1) * pixelDay}px`;
  });
  return `repeating-linear-gradient(to right, ${stops.join(", ")})`;
}

function holidayShade(
  start: number,
  end: number,
  pixelDay: number,
  holidays: GanttHoliday[] = []
) {
  const dates = holidays
    .flatMap(({ date }) => {
      const day = toDay(date);
      return day !== null && day >= start && day <= end ? [day] : [];
    })
    .sort((a, b) => a - b);
  if (!dates.length) return "none";
  const spans: Range[] = [];
  for (const day of dates) {
    const last = spans.at(-1);
    if (last && day <= last.end + 1) last.end = day;
    else spans.push({ start: day, end: day });
  }
  const stops = ["transparent 0"];
  for (const span of spans) {
    const left = `${(span.start - start) * pixelDay}px`;
    const right = `${(span.end - start + 1) * pixelDay}px`;
    stops.push(
      `transparent ${left}`,
      `#f2bc6e34 ${left} ${right}`,
      `transparent ${right}`
    );
  }
  stops.push("transparent 100%");
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function projectCompare(
  first: PortfolioTimelineProject,
  second: PortfolioTimelineProject
) {
  const firstDay = toDay(
    first.plannedStartDate === undefined
      ? first.startDate
      : first.plannedStartDate
  );
  const secondDay = toDay(
    second.plannedStartDate === undefined
      ? second.startDate
      : second.plannedStartDate
  );
  if (firstDay !== secondDay) {
    if (firstDay === null) return 1;
    if (secondDay === null) return -1;
    return firstDay - secondDay;
  }
  return first.number.localeCompare(second.number) || first.id - second.id;
}

function flattenRows(
  projects: PortfolioTimelineProject[],
  projectExpansion: ReadonlyMap<number, boolean>,
  foldedTasks: ReadonlySet<number>,
  search: string
) {
  const rows: Row[] = [];
  let dateBounds: Range | null = null;
  const query = search.trim().toLowerCase();

  for (const project of projects) {
    const byParent = new Map<number | null, PortfolioTimelineTask[]>();
    const taskDates = new Map<number, Range | null>();
    const taskIds = new Set(project.tasks.map(task => task.id));
    let projectDates = dateRange(project.startDate, project.endDate);
    for (const task of project.tasks) {
      const parent =
        taskIds.has(task.parentId ?? 0) && task.parentId !== task.id
          ? task.parentId
          : null;
      const siblings = byParent.get(parent) ?? [];
      if (!byParent.has(parent)) byParent.set(parent, siblings);
      siblings.push(task);
      const dates = dateRange(task.startDate, task.endDate);
      taskDates.set(task.id, dates);
      projectDates = mergedDates(projectDates, dates);
    }
    dateBounds = mergedDates(dateBounds, projectDates);

    const matchesProject = query
      ? `${project.name} ${project.number}`.toLowerCase().includes(query)
      : false;
    const open =
      Boolean(query) ||
      (projectExpansion.get(project.id) ?? projects.length <= 3);
    const projectRow: Row = {
      type: "project",
      project,
      dates: projectDates,
      open,
    };
    if (!open) {
      rows.push(projectRow);
      continue;
    }

    const taskRows: Row[] = [];
    const seen = new Set<number>();
    function appendTasks(parent: number | null, depth: number) {
      for (const task of byParent.get(parent) ?? []) {
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        const children = byParent.get(task.id) ?? [];
        const taskOpen = Boolean(query) || !foldedTasks.has(task.id);
        const matchesTask =
          !query ||
          matchesProject ||
          `${task.name} ${task.owner ?? ""} ${task.statusLabel}`
            .toLowerCase()
            .includes(query);
        const index = taskRows.length;
        taskRows.push({
          type: "task",
          project,
          task,
          dates: taskDates.get(task.id) ?? null,
          depth,
          open: taskOpen,
          expandable: children.length > 0,
        });
        if (taskOpen) appendTasks(task.id, depth + 1);
        if (!matchesTask && taskRows.length === index + 1) taskRows.pop();
      }
    }
    appendTasks(null, 0);
    if (!query || matchesProject || taskRows.length)
      rows.push(projectRow, ...taskRows);
  }
  return { rows, dateBounds };
}

function chartColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#087f7b";
}

function timelineGeometry(range: Range, dayWidth: number) {
  return {
    offset: (day: number) => (day - range.start) * dayWidth,
    width: (dayCount: number) => dayCount * dayWidth,
  };
}

export function PortfolioTimeline({
  locale,
  projects,
  links,
  search = "",
  showLinks = true,
  linkMode = false,
  sourceTaskId,
  targetTaskId,
  focusedTaskId,
  today = businessDate(),
  actions,
  onProjectOpen,
  onTaskClick,
  onProjectColor,
  onTaskColor,
}: Props) {
  const [expandedProjects, setExpandedProjects] = useState(
    new Map<number, boolean>()
  );
  const [foldedTasks, setFoldedTasks] = useState(new Set<number>());
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({
    width: 1024,
    height: 440,
    top: 0,
  });
  const viewportRef = useRef<HTMLDivElement>(null);
  const arrow = useId();
  const { direction, formatting } = localeMeta[locale];
  const lang = `${formatting}-ca-gregory`;
  const t = (ar: string, en: string, ur: string) => ({ ar, en, ur })[locale];
  const orderedProjects = useMemo(
    () => [...projects].sort(projectCompare),
    [projects]
  );
  const { rows, dateBounds } = useMemo(
    () => flattenRows(orderedProjects, expandedProjects, foldedTasks, search),
    [orderedProjects, expandedProjects, foldedTasks, search]
  );
  const counts = useMemo(() => new Intl.NumberFormat(formatting), [formatting]);
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, { timeZone: "UTC", dateStyle: "medium" }),
    [lang]
  );
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
      }),
    [lang]
  );

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = {
        width: element.clientWidth,
        height: element.clientHeight,
        top: element.scrollTop,
      };
      setViewport(current =>
        current.width === next.width &&
        current.height === next.height &&
        current.top === next.top
          ? current
          : next
      );
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      element.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, []);

  const todayDay = toDay(today);
  const range = dateBounds
    ? { start: dateBounds.start - 2, end: dateBounds.end + 2 }
    : { start: (todayDay ?? 0) - 7, end: (todayDay ?? 0) + 7 };
  const days = range.end - range.start + 1;
  const treeWidth =
    viewport.width <= 540
      ? Math.min(212, viewport.width * 0.64)
      : viewport.width <= 800
        ? 286
        : 352;
  const fitWidth = Math.max(64, viewport.width - treeWidth);
  const pixelDay = (fitWidth / days) * zoom;
  const timelineWidth = Math.max(fitWidth, days * pixelDay);
  const geometry = timelineGeometry(range, pixelDay);
  const shadesByProject = useMemo(() => {
    const central = new Map<number, string>();
    return new Map(
      projects.map(project => {
        const revision = project.calendarRevision ?? 0;
        const holiday =
          central.get(revision) ??
          holidayShade(range.start, range.end, pixelDay, project.holidays);
        if (revision) central.set(revision, holiday);
        return [
          project.id,
          {
            holiday,
            week: weekShade(
              range.start,
              pixelDay,
              project.workingDays ?? defaultWorkingDays
            ),
          },
        ];
      })
    );
  }, [projects, range.start, range.end, pixelDay]);
  const months = useMemo(
    () =>
      monthsInRange(
        { start: range.start, end: range.end },
        pixelDay,
        monthLabel
      ),
    [range.start, range.end, pixelDay, monthLabel]
  );
  const dayLabels = useMemo(
    () => daysInRange({ start: range.start, end: range.end }, pixelDay, lang),
    [range.start, range.end, pixelDay, lang]
  );
  const rowNumbers = useMemo(() => {
    const numbers = new Map<
      number,
      { index: number; dates: Range; milestone: boolean }
    >();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.type === "task" && row.dates) {
        numbers.set(row.task.id, {
          index,
          dates: row.dates,
          milestone: Boolean(row.task.isMilestone),
        });
      }
    }
    return numbers;
  }, [rows]);
  const drawFrom = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
  const drawTo = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + overscan
  );
  const rendered = rows.slice(drawFrom, drawTo);
  const hasExpandedProject = orderedProjects.some(
    project => expandedProjects.get(project.id) ?? orderedProjects.length <= 3
  );
  const todayOffset =
    todayDay !== null && todayDay >= range.start && todayDay <= range.end
      ? geometry.offset(todayDay)
      : null;
  const canvasStyle: ChartStyle = {
    "--pt-tree-width": `${treeWidth}px`,
    "--pt-timeline-width": `${timelineWidth}px`,
    "--pt-axis-height": `${axisHeight}px`,
    "--pt-grid-step": `${pixelDay * (dayLabels[0]?.width ?? 1)}px`,
    "--pt-row-height": `${rowHeight}px`,
  };

  function toggleProject(id: number, open: boolean) {
    setExpandedProjects(previous => new Map(previous).set(id, !open));
  }

  function toggleAllProjects() {
    setExpandedProjects(previous => {
      const next = new Map(previous);
      for (const project of orderedProjects)
        next.set(project.id, !hasExpandedProject);
      return next;
    });
  }

  function toggleTask(id: number) {
    setFoldedTasks(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const taskLabel = t(
    "المشروع / المهمة / المسؤول",
    "Project / task / owner",
    "منصوبہ / کام / ذمہ دار"
  );
  const colorTitle = t("اللون", "Color", "رنگ");
  const closedIcon = direction === "rtl" ? ChevronLeft : ChevronRight;
  const chartAriaLabel = t(
    "مخطط جانت الزمني",
    "Gantt timeline",
    "گینٹ ٹائم لائن"
  );
  const canDrawRows = rendered.length > 0;
  const highlights = new Set(
    [sourceTaskId, targetTaskId, focusedTaskId].filter(id => id != null)
  );

  return (
    <section className="pt-root" dir={direction} aria-label={chartAriaLabel}>
      <div className="pt-toolbar">
        <div className="pt-actions">
          {actions}
          {orderedProjects.length > 0 && (
            <button
              type="button"
              onClick={toggleAllProjects}
              disabled={Boolean(search.trim())}
            >
              {hasExpandedProject
                ? t("طي المشاريع", "Collapse projects", "منصوبے سمیٹیں")
                : t("توسيع المشاريع", "Expand projects", "منصوبے پھیلائیں")}
            </button>
          )}
        </div>
        <div className="pt-actions">
          <button type="button" onClick={() => setZoom(1)}>
            {t("احتواء", "Fit", "سما دیں")}
          </button>
          <button
            type="button"
            className="pt-square"
            title={t("تكبير المخطط", "Zoom in", "بڑا کریں")}
            aria-label={t("تكبير المخطط", "Zoom in", "بڑا کریں")}
            onClick={() => setZoom(value => Math.min(16, value * 1.4))}
            disabled={zoom >= 16}
          >
            <Plus aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="pt-square"
            title={t("تصغير المخطط", "Zoom out", "چھوٹا کریں")}
            aria-label={t("تصغير المخطط", "Zoom out", "چھوٹا کریں")}
            onClick={() => setZoom(value => Math.max(0.25, value / 1.4))}
            disabled={zoom <= 0.25}
          >
            <Minus aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
      <div
        className="pt-scroll"
        ref={viewportRef}
        tabIndex={0}
        aria-label={chartAriaLabel}
      >
        <div className="pt-canvas" style={canvasStyle}>
          <div className="pt-head">
            <div className="pt-axis" aria-hidden="true">
              <div className="pt-months">
                {months.map(mark => (
                  <span
                    key={mark.day}
                    style={{
                      left: geometry.offset(mark.day),
                      width: geometry.width(mark.width),
                    }}
                  >
                    {mark.label}
                  </span>
                ))}
              </div>
              <div className="pt-days">
                {dayLabels.map(mark => (
                  <span
                    key={mark.day}
                    title={dateLabel.format(mark.day * dayMs)}
                    style={{
                      left: geometry.offset(mark.day),
                      width: geometry.width(mark.width),
                    }}
                    className={
                      todayDay !== null &&
                      todayDay >= mark.day &&
                      todayDay < mark.day + mark.width
                        ? "pt-current"
                        : undefined
                    }
                  >
                    {mark.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="pt-tree pt-tree-head" dir={direction}>
              <strong>{taskLabel}</strong>
              {(onProjectColor || onTaskColor) && <span>{colorTitle}</span>}
            </div>
          </div>
          <div
            className="pt-body"
            style={{ height: Math.max(rowHeight, rows.length * rowHeight) }}
          >
            {todayOffset !== null && canDrawRows && (
              <div
                className="pt-today-line"
                aria-hidden="true"
                style={{ left: todayOffset }}
              />
            )}
            {canDrawRows && showLinks && links.length > 0 && (
              <svg
                className="pt-lines"
                width={timelineWidth}
                height={rows.length * rowHeight}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={arrow}
                    markerWidth="7"
                    markerHeight="7"
                    refX="5.8"
                    refY="3.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0 0 L7 3.5 L0 7 Z" fill="context-stroke" />
                  </marker>
                </defs>
                {links.map(link => {
                  const from = rowNumbers.get(link.from);
                  const to = rowNumbers.get(link.to);
                  if (
                    !from ||
                    !to ||
                    Math.max(from.index, to.index) < drawFrom ||
                    Math.min(from.index, to.index) >= drawTo
                  )
                    return null;
                  const anchor = (point: typeof from, finish: boolean) =>
                    point.milestone
                      ? geometry.offset(point.dates.start + 0.5) +
                        (finish ? 9 : -9)
                      : geometry.offset(
                          finish ? point.dates.end + 1 : point.dates.start
                        );
                  const fromX = anchor(from, link.type[0] === "F");
                  const toX = anchor(to, link.type[1] === "F");
                  const fromY = from.index * rowHeight + rowHeight / 2;
                  const toY = to.index * rowHeight + rowHeight / 2;
                  const lead = link.type[0] === "F" ? 10 : -10;
                  const tail = link.type[1] === "F" ? 10 : -10;
                  const middleY = (fromY + toY) / 2;
                  const focused =
                    highlights.has(link.from) || highlights.has(link.to);
                  return (
                    <path
                      key={link.id}
                      className={
                        focused
                          ? "pt-link-focused"
                          : highlights.size
                            ? "pt-link-muted"
                            : undefined
                      }
                      d={`M ${fromX} ${fromY} H ${fromX + lead} V ${middleY} H ${toX + tail} V ${toY} H ${toX}`}
                      markerEnd={`url(#${arrow})`}
                    />
                  );
                })}
              </svg>
            )}
            {rendered.map((row, visibleIndex) => {
              const isProject = row.type === "project";
              const entry = isProject ? row.project : row.task;
              const milestone = !isProject && row.task.isMilestone;
              const key = `${row.type}-${entry.id}`;
              const color = chartColor(entry.color);
              const taskId = isProject ? null : row.task.id;
              const endpoint =
                taskId === null
                  ? null
                  : taskId === sourceTaskId
                    ? t("السابقة", "Predecessor", "پچھلا کام")
                    : taskId === targetTaskId
                      ? t("التابعة", "Successor", "اگلا کام")
                      : null;
              const selected = Boolean(
                endpoint || (taskId !== null && taskId === focusedTaskId)
              );
              const expandable = isProject
                ? row.project.tasks.length > 0
                : row.expandable;
              const ToggleIcon = row.open ? ChevronDown : closedIcon;
              const toggle = () =>
                isProject
                  ? toggleProject(row.project.id, row.open)
                  : toggleTask(row.task.id);
              const select = () =>
                isProject ? toggle() : onTaskClick(row.task.id);
              const pickColor = isProject ? onProjectColor : onTaskColor;
              const formatDate = (day: number) => dateLabel.format(day * dayMs);
              const tooltip = row.dates
                ? `${entry.name} · ${formatDate(row.dates.start)} – ${formatDate(row.dates.end)}`
                : entry.name;
              const style: ChartStyle = {
                "--pt-color": color,
                "--pt-text-color": ganttColorText(color),
                "--pt-indent": isProject ? 0 : Math.min(row.depth, 5),
                "--pt-week-shade":
                  shadesByProject.get(row.project.id)?.week ?? "none",
                "--pt-holiday-shade":
                  shadesByProject.get(row.project.id)?.holiday ?? "none",
                top: (drawFrom + visibleIndex) * rowHeight,
              };
              return (
                <div
                  key={key}
                  className={`pt-row${isProject ? " pt-project" : ""}${selected ? " pt-selected" : ""}`}
                  style={style}
                >
                  <div className="pt-track">
                    {row.dates && (
                      <button
                        type="button"
                        className={milestone ? "pt-bar pt-milestone" : "pt-bar"}
                        dir={direction}
                        title={tooltip}
                        aria-label={tooltip}
                        aria-pressed={
                          isProject
                            ? undefined
                            : linkMode
                              ? selected
                              : undefined
                        }
                        onClick={select}
                        style={{
                          left: milestone
                            ? geometry.offset(row.dates.start + 0.5) -
                              milestoneSize / 2
                            : geometry.offset(row.dates.start),
                          width: milestone
                            ? milestoneSize
                            : Math.max(
                                5,
                                geometry.width(
                                  row.dates.end - row.dates.start + 1
                                ) - 2
                              ),
                        }}
                      >
                        {!milestone &&
                          geometry.width(row.dates.end - row.dates.start + 1) >=
                            34 && <span>{entry.name}</span>}
                      </button>
                    )}
                  </div>
                  <div className="pt-tree pt-entry" dir={direction}>
                    {expandable ? (
                      <button
                        type="button"
                        className="pt-square pt-disclosure"
                        aria-expanded={row.open}
                        aria-label={`${row.open ? t("طي", "Collapse", "سمیٹیں") : t("توسيع", "Expand", "پھیلائیں")} ${entry.name}`}
                        onClick={toggle}
                        disabled={Boolean(search.trim())}
                      >
                        <ToggleIcon aria-hidden="true" size={13} />
                      </button>
                    ) : (
                      <span className="pt-node" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className="pt-label"
                      title={entry.name}
                      onClick={select}
                      aria-pressed={
                        isProject ? undefined : linkMode ? selected : undefined
                      }
                    >
                      <strong>{entry.name}</strong>
                      {isProject ? (
                        <small>
                          <bdi>{row.project.number}</bdi>
                          <span>
                            {" "}
                            · {counts.format(row.project.tasks.length)}{" "}
                            {t("مهمة", "tasks", "کام")}
                          </span>
                        </small>
                      ) : row.task.owner ? (
                        <small>{row.task.owner}</small>
                      ) : null}
                    </button>
                    {isProject ? (
                      onProjectOpen && (
                        <button
                          type="button"
                          className="pt-square pt-open"
                          title={t(
                            "فتح مخطط المشروع",
                            "Open project schedule",
                            "منصوبے کا شیڈول کھولیں"
                          )}
                          aria-label={`${t("فتح مخطط المشروع", "Open project schedule", "منصوبے کا شیڈول کھولیں")} ${entry.name}`}
                          onClick={() => onProjectOpen(row.project.id)}
                        >
                          <ArrowUpRight aria-hidden="true" size={14} />
                        </button>
                      )
                    ) : (
                      <Fragment>
                        {endpoint && (
                          <span className="pt-endpoint">{endpoint}</span>
                        )}
                        {!endpoint && row.task.statusLabel && (
                          <span
                            className={`pt-status pt-status-${row.task.statusTone ?? "pending"}`}
                            title={row.task.statusLabel}
                          >
                            {row.task.statusLabel}
                          </span>
                        )}
                      </Fragment>
                    )}
                    {pickColor && (
                      <button
                        type="button"
                        className="pt-square pt-palette"
                        title={`${colorTitle} · ${entry.name}`}
                        aria-label={`${isProject ? t("لوحة ألوان المشروع", "Project palette", "منصوبے کے رنگ") : t("لون المهمة", "Task color", "کام کا رنگ")} ${entry.name}`}
                        onClick={() => pickColor(entry.id)}
                      >
                        <i aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {!rows.length && (
              <p className="pt-empty" dir={direction}>
                {search.trim()
                  ? t(
                      "لا توجد نتائج للبحث.",
                      "No results match your search.",
                      "تلاش سے کوئی نتیجہ نہیں ملا۔"
                    )
                  : t(
                      "اختر المشاريع لعرضها في المخطط.",
                      "Select projects to display.",
                      "دکھانے کے لیے منصوبے منتخب کریں۔"
                    )}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="pt-legend">
        <span>
          <i className="pt-legend-today" /> {t("تاريخ المتابعة", "Today", "آج")}
        </span>
        {[...shadesByProject.values()].some(
          ({ holiday }) => holiday !== "none"
        ) && (
          <span>
            <i className="pt-legend-holiday" aria-hidden="true" />
            {t("الإجازات المسجّلة", "Recorded holidays", "درج شدہ تعطیلات")}
          </span>
        )}
        {showLinks && (
          <span>
            <i className="pt-legend-link" />{" "}
            {t("علاقة بين المهام", "Task dependency", "کاموں کا تعلق")}
          </span>
        )}
      </div>
    </section>
  );
}
