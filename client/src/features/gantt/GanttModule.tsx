import { useEffect, useMemo, useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import type { AppRouter } from "../../../../server/routers";
import { Modal } from "@/components/Modal";
import { businessDate } from "@shared/date";
import { taskExecutionMetrics, taskExecutionStatus } from "@shared/gantt";
import {
  ganttColorInput,
  ganttColorText,
  ganttProjectColors,
} from "@shared/gantt-colors";
import { MaterialRequisitionForm } from "../material-requisitions/MaterialRequisitions";
import { mrText } from "../material-requisitions/copy";
import { TaskMaterialPanel } from "../project-management/TaskMaterialProgress";
import { TaskDependencyPanel } from "./TaskDependencyPanel";
import { GanttPortfolio } from "./GanttPortfolio";
import "./gantt.css";

type User = { id: number; permissions: string[] };
type Task = {
  id: string;
  name: string;
  duration: number;
  phase: string;
  owner: string;
  progress: number;
  start: string;
  notBefore: string | null;
  notes: string;
  parentId: string | null;
  executionStatus: "not_started" | "in_progress" | "completed";
  status?: "not_started" | "in_progress" | "completed";
  pmTaskId?: number;
  pmVersion?: number;
  pmStatusId?: number;
  pmStatusCode?: string;
  pmPriority?: "critical" | "high" | "medium" | "low";
  pmEmployeeIds?: number[];
  startLocked?: boolean;
  endLocked?: boolean;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  [key: string]: unknown;
};
type StudioInput =
  inferRouterInputs<AppRouter>["gantt"]["saveStudioState"]["state"];
type State = {
  schemaVersion: 2;
  completionModel: "leaf-count-v1";
  project: {
    id: string;
    name: string;
    description: string;
    start: string;
    statusDate: string;
    deadline: string | null;
    mode: "smart" | "free";
  };
  calendar: {
    workingDays: number[];
    hoursPerDay: number;
    holidays: { date: string; name: string }[];
  };
  tasks: Task[];
  links: {
    id: string;
    from: string;
    to: string;
    type: "FS" | "SS" | "FF" | "SF";
    lag: number;
    pmLinkId?: number;
    [key: string]: unknown;
  }[];
  baseline: StudioInput["baseline"];
  activity: StudioInput["activity"];
};
type Detail = inferRouterOutputs<AppRouter>["gantt"]["detail"];
type Shared = inferRouterOutputs<AppRouter>["gantt"]["sharedDirectory"];
type ScheduleAction = "configure" | "start" | "extend" | "lock";
type StudioEdit = { sequence: number; version: number; state: State };
type StudioSave = StudioEdit & { key: string; projectId: number };
type StudioReceipt = {
  sequence: number;
  version: number;
  state: State;
  submitted: State;
};
function isStudioEdit(value: unknown): value is StudioEdit {
  if (typeof value !== "object" || !value) return false;
  const edit = value as Partial<StudioEdit>;
  return (
    Number.isSafeInteger(edit.sequence) &&
    edit.sequence! > 0 &&
    Number.isSafeInteger(edit.version) &&
    edit.version! >= 0 &&
    edit.state?.schemaVersion === 2 &&
    Array.isArray(edit.state.tasks) &&
    Array.isArray(edit.state.links)
  );
}
const uid = () => crypto.randomUUID();
const epoch = (d: string) =>
  Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
function taskDuration(
  start: string,
  end: string,
  days: number[],
  holidays: { date: string }[]
) {
  const first = epoch(start),
    last = epoch(end),
    span = last - first + 1;
  if (!Number.isFinite(span) || span < 1) return 1;
  const workdays = new Set(days);
  const weekday = (day: number) => new Date(day * 86400000).getUTCDay();
  let count = Math.floor(span / 7) * workdays.size;
  for (let offset = 0; offset < span % 7; offset++)
    if (workdays.has(weekday(first + offset))) count++;
  for (const date of new Set(holidays.map(item => item.date))) {
    const day = epoch(date);
    if (day >= first && day <= last && workdays.has(weekday(day))) count--;
  }
  return Math.max(1, count);
}
function initialState(data: Detail): State {
  const start =
    data.project.actualStartDate ??
    data.project.plannedStartDate ??
    data.tasks.map(t => t.startDate).sort()[0] ??
    businessDate();
  const calendar = {
    workingDays: data.settings.workingDays,
    hoursPerDay: data.settings.hoursPerDay,
    holidays: data.settings.holidays,
  };
  return {
    schemaVersion: 2,
    completionModel: "leaf-count-v1",
    project: {
      id: data.project.number,
      name: data.project.name,
      description: data.project.description,
      start,
      statusDate: data.settings.statusDate ?? businessDate(),
      deadline: data.project.forecastEndDate ?? data.settings.deadline,
      mode: data.settings.mode,
    },
    calendar,
    tasks: data.tasks.map(t => {
      const status =
        t.statusCode === "done"
          ? "completed"
          : t.statusCode === "working"
            ? "in_progress"
            : "not_started";
      return {
        id: `T${t.id}`,
        name: t.name,
        duration: t.isMilestone
          ? 0
          : taskDuration(
              t.startDate,
              t.endDate,
              calendar.workingDays,
              calendar.holidays
            ),
        phase: t.level === 1 ? "مهمة رئيسية" : `مستوى فرعي ${t.level - 1}`,
        owner: t.assignees.join("، "),
        progress: status === "completed" ? 100 : 0,
        start: t.startDate,
        notBefore: t.notBefore,
        notes: "",
        parentId: t.parentId ? `T${t.parentId}` : null,
        executionStatus: status,
        status,
        pmTaskId: t.id,
        pmVersion: t.version,
        pmStatusId: t.statusId,
        pmStatusCode: t.statusCode,
        pmPriority: t.priority as Task["pmPriority"],
        pmEmployeeIds: t.employeeIds,
        startLocked: t.startLocked ?? false,
        endLocked: t.endLocked ?? false,
        plannedStart: t.plannedStartDate,
        plannedEnd: t.plannedEndDate,
        actualStart: t.actualStartDate,
        actualEnd: t.actualEndDate,
      };
    }),
    links: data.links.map(l => ({
      id: `L${l.id}`,
      from: `T${l.fromTaskId}`,
      to: `T${l.toTaskId}`,
      type: l.type as "FS" | "SS" | "FF" | "SF",
      lag: l.lagDays,
      pmLinkId: l.id,
    })),
    baseline: null,
    activity: [],
  };
}
function reconcile(data: Detail): State {
  const fresh = initialState(data),
    saved = data.studio?.state as State | null | undefined;
  if (saved?.schemaVersion !== 2) return fresh;
  const oldTasks = new Map(
    saved.tasks.map(t => [
      t.pmTaskId ?? Number(/^T(\d+)$/.exec(t.id)?.[1] ?? 0),
      t,
    ])
  );
  const oldLinks = new Map(
    saved.links.map(l => [
      l.pmLinkId ?? Number(/^L(\d+)$/.exec(l.id)?.[1] ?? 0),
      l,
    ])
  );
  return {
    ...saved,
    project: fresh.project,
    calendar: fresh.calendar,
    tasks: fresh.tasks.map(t => ({
      ...(oldTasks.get(t.pmTaskId!) ?? {}),
      ...t,
      notes: String(oldTasks.get(t.pmTaskId!)?.notes ?? ""),
    })),
    links: fresh.links.map(l => ({
      ...(oldLinks.get(l.pmLinkId!) ?? {}),
      ...l,
    })),
  };
}

export function GanttModule({ locale, user }: { locale: Locale; user: User }) {
  return <GanttWorkspace key={user.id} locale={locale} user={user} />;
}

function GanttWorkspace({ locale, user }: { locale: Locale; user: User }) {
  const [editor, setEditor] = useState<{
    projectId: number;
    taskId?: number;
  } | null>(null);
  const utils = trpc.useUtils();
  return (
    <>
      <div hidden={Boolean(editor)}>
        <GanttPortfolio locale={locale} user={user} openEditor={setEditor} />
      </div>
      {editor && (
        <ScopedGanttModule
          key={editor.projectId}
          locale={locale}
          user={user}
          projectId={editor.projectId}
          initialTaskId={editor.taskId}
          onBack={() => {
            setEditor(null);
            void utils.gantt.portfolioDirectory.invalidate();
            void utils.gantt.portfolio.invalidate();
          }}
        />
      )}
    </>
  );
}

function ScopedGanttModule({
  locale,
  user,
  projectId,
  initialTaskId,
  onBack,
}: {
  locale: Locale;
  user: User;
  projectId: number;
  initialTaskId?: number;
  onBack: () => void;
}) {
  const t = (a: string, e: string, u: string) =>
      locale === "ar" ? a : locale === "ur" ? u : e,
    canEdit = user.permissions.includes("pm.tasks.manage"),
    canView = user.permissions.includes("pm.view"),
    canCreateRequisition = user.permissions.includes(
      "materialRequisitions.create"
    );
  const [channel] = useState(uid),
    [frameKey, setFrameKey] = useState(0),
    [dialog, setDialog] = useState<ScheduleAction | null>(null),
    [sharedOpen, setSharedOpen] = useState(false),
    [hasQueuedEdits, setHasQueuedEdits] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [requisition, setRequisition] = useState<{
      projectId: number;
      taskId: number | null;
    } | null>(null),
    [materialTaskId, setMaterialTaskId] = useState<number | null>(null),
    [dependencyTaskId, setDependencyTaskId] = useState<number | null>(null),
    [waitingForStudioSave, setWaitingForStudioSave] = useState(false),
    [openingRequisition, setOpeningRequisition] = useState(false);
  const detail = trpc.gantt.detail.useQuery(
      { projectId },
      { enabled: projectId > 0, staleTime: 0 }
    ),
    taskMaterials = trpc.projectManagement.taskMaterialSummary.useQuery(
      { projectId },
      {
        enabled: canView && projectId > 0 && Boolean(detail.data),
        refetchInterval: 30_000,
        retry: false,
      }
    ),
    directory = trpc.gantt.sharedDirectory.useQuery(undefined, {
      enabled: sharedOpen,
    }),
    requisitionDirectory = trpc.materialRequisitions.directory.useQuery(
      undefined,
      {
        enabled: canCreateRequisition,
      }
    ),
    utils = trpc.useUtils(),
    frame = useRef<HTMLIFrameElement>(null),
    entryTask = useRef(initialTaskId),
    executionTaskId = useRef<number | null>(null),
    saving = useRef(false),
    afterStudioSave = useRef<(() => void) | null>(null),
    openFreshRequisition = useRef<
      (target: { projectId: number; taskId: number | null }) => void
    >(() => {}),
    readyProject = useRef(0),
    recoveredProject = useRef(0),
    serverVersion = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    queued = useRef<StudioEdit | null>(null),
    submitted = useRef<StudioSave | null>(null),
    receipt = useRef<StudioReceipt | null>(null),
    flush = useRef<() => void>(() => {});
  const post = (type: string, data: object = {}) =>
    frame.current?.contentWindow?.postMessage(
      { ...data, type, channel, projectId },
      window.location.origin
    );
  const postTaskExecution = (taskId: number) => {
    const data = detail.data;
    const task = data?.tasks.find(task => task.id === taskId);
    if (!data || !task) return;
    const dates = {
      startDate: task.startDate,
      endDate: task.endDate,
      actualStartDate: task.actualStartDate,
      actualEndDate: task.actualEndDate,
      executionStatus: taskExecutionStatus(task.statusCode),
    };
    post("pscm:task-execution", {
      taskId,
      ...dates,
      ...taskExecutionMetrics(dates, data.settings, businessDate()),
    });
  };
  const materialSummaries =
    canView && !taskMaterials.isError ? taskMaterials.data?.items : undefined;
  const palette = useMemo(() => {
    if (!detail.data) return undefined;
    const colors = ganttProjectColors(detail.data.project);
    const withInk = (color: string) => ({ color, ink: ganttColorText(color) });
    return {
      levels: colors.levels.map(withInk),
      overrides: detail.data.tasks.flatMap(task => {
        const color = ganttColorInput.safeParse(task.color).data;
        return color ? [{ id: task.id, ...withInk(color) }] : [];
      }),
    };
  }, [detail.data]);
  const draftKey = `pscm:gantt-draft-v1:${user.id}:${projectId}`;
  const storeDraft = () => {
    try {
      if (submitted.current || queued.current)
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            submitted: submitted.current,
            queued: queued.current,
          })
        );
      else sessionStorage.removeItem(draftKey);
    } catch {
      // The editor still retains the draft if browser storage is unavailable.
    }
  };
  const save = trpc.gantt.saveStudioState.useMutation({
    onSuccess: (r, input) => {
      if (!submitted.current || submitted.current.key !== input.key) return;
      serverVersion.current = r.version;
      const accepted: StudioReceipt = {
        sequence: submitted.current.sequence,
        version: r.version,
        state: r.state as State,
        submitted: submitted.current.state,
      };
      receipt.current = accepted;
      post("pscm:gantt:saved", accepted);
      void utils.gantt.detail.invalidate({ projectId: input.projectId });
      void utils.projectManagement.detail.invalidate({ id: input.projectId });
      void utils.materialRequisitions.invalidate();
    },
    onError: e => {
      // A rejected operation can be replaced by the latest draft. Keep the exact
      // request and key if the response was lost or the outcome is uncertain.
      if (
        e.data?.code &&
        [
          "BAD_REQUEST",
          "CONFLICT",
          "FORBIDDEN",
          "NOT_FOUND",
          "PAYLOAD_TOO_LARGE",
        ].includes(e.data.code)
      ) {
        queued.current ??= submitted.current;
        submitted.current = null;
      }
      storeDraft();
      afterStudioSave.current = null;
      setSaveFailed(true);
      setWaitingForStudioSave(false);
      setOpeningRequisition(false);
      post("pscm:gantt:save-failed");
      toast.error(e.message);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const refreshed = () => {
    void utils.gantt.invalidate();
    void utils.projectManagement.invalidate();
    setDialog(null);
    setSharedOpen(false);
    toast.success(
      t(
        "تم تحديث Gantt ووحدة المشاريع",
        "Gantt and Project Unit updated",
        "گانٹ اور منصوبے کی اکائی اپ ڈیٹ ہو گئیں"
      )
    );
  };
  const schedule = trpc.gantt.saveProjectSchedule.useMutation({
      onSuccess: refreshed,
      onError: e => toast.error(e.message),
    }),
    shared = trpc.gantt.saveSharedGroup.useMutation({
      onSuccess: refreshed,
      onError: e => toast.error(e.message),
    });
  flush.current = () => {
    if (saving.current || receipt.current || saveFailed) return;
    if (!submitted.current && queued.current) {
      submitted.current = { ...queued.current, key: uid(), projectId };
      queued.current = null;
      storeDraft();
    }
    const edit = submitted.current;
    if (!edit || edit.projectId !== projectId) return;
    saving.current = true;
    post("pscm:gantt:saving");
    save.mutate({
      key: edit.key,
      projectId: edit.projectId,
      version: edit.version,
      state: edit.state,
    });
  };
  openFreshRequisition.current = target => {
    setOpeningRequisition(true);
    void utils.materialRequisitions.directory
      .fetch()
      .then(data => {
        if (!data.projects.some(item => item.id === target.projectId)) return;
        if (
          target.taskId &&
          !data.tasks.some(
            item =>
              item.id === target.taskId && item.projectId === target.projectId
          )
        )
          return;
        setRequisition(target);
      })
      .catch(error =>
        toast.error(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setOpeningRequisition(false));
  };
  const runAfterStudioSave = (action: () => void) => {
    if (afterStudioSave.current || saveFailed) return;
    if (timer.current) clearTimeout(timer.current);
    if (submitted.current || queued.current) {
      setWaitingForStudioSave(true);
      afterStudioSave.current = action;
      flush.current();
    } else action();
  };
  const requestRequisition = (taskId: number | null) => {
    if (!canCreateRequisition || !projectId || openingRequisition) return;
    runAfterStudioSave(() =>
      openFreshRequisition.current({ projectId, taskId })
    );
  };
  const state = useMemo(
    () => (detail.data ? reconcile(detail.data) : null),
    [detail.data]
  );
  const dataVersion = detail.data?.studio?.version ?? 0;
  const currentBridge = useRef<(event: MessageEvent) => void>(() => {});
  currentBridge.current = event => {
    const message = event.data;
    if (
      event.origin !== window.location.origin ||
      event.source !== frame.current?.contentWindow ||
      message?.channel !== channel ||
      message.projectId !== projectId
    )
      return;
    if (message.type === "pscm:gantt:ready" && state) {
      readyProject.current = projectId;
      let recovered = false;
      if (canEdit && recoveredProject.current !== projectId) {
        recoveredProject.current = projectId;
        try {
          const stored = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
          if (isStudioEdit(stored?.queued)) queued.current = stored.queued;
          if (
            stored?.submitted?.projectId === projectId &&
            typeof stored.submitted.key === "string" &&
            isStudioEdit(stored.submitted)
          )
            submitted.current = stored.submitted;
          recovered = Boolean(queued.current || submitted.current);
          if (recovered) {
            setHasQueuedEdits(true);
            setSaveFailed(true);
          }
        } catch {
          // Missing or invalid browser recovery data does not change the project.
        }
      }
      const draft = queued.current ?? submitted.current;
      if (!draft) serverVersion.current = dataVersion;
      post("pscm:gantt:load", {
        state: draft?.state ?? state,
        version: draft?.version ?? dataVersion,
        sequence: draft?.sequence ?? 0,
        dirty: Boolean(draft),
        locale,
        readOnly: !canEdit,
        failed: saveFailed || recovered,
        palette,
      });
      const taskId = entryTask.current;
      if (
        !draft &&
        taskId &&
        detail.data?.tasks.some(task => task.id === taskId)
      ) {
        entryTask.current = undefined;
        post("pscm:open-task", { taskId });
      }
      post("pscm:task-materials", { items: materialSummaries ?? [] });
      if (receipt.current) post("pscm:gantt:saved", receipt.current);
      return;
    }
    if (message.type === "pscm:material-requisition") {
      if (Number.isSafeInteger(message.taskId) && message.taskId > 0)
        requestRequisition(message.taskId);
      return;
    }
    if (message.type === "pscm:open-task-materials") {
      if (
        canView &&
        Number.isSafeInteger(message.taskId) &&
        materialSummaries?.some(item => item.taskId === message.taskId) &&
        detail.data?.tasks.some(task => task.id === message.taskId)
      )
        setMaterialTaskId(message.taskId);
      return;
    }
    if (message.type === "pscm:task-dependencies") {
      const taskId = message.taskId;
      if (
        canView &&
        !openingRequisition &&
        Number.isSafeInteger(taskId) &&
        detail.data?.tasks.some(task => task.id === taskId)
      )
        runAfterStudioSave(() => setDependencyTaskId(taskId));
      return;
    }
    if (message.type === "pscm:task-execution-request") {
      const taskId = message.taskId;
      if (canView && Number.isSafeInteger(taskId) && taskId > 0) {
        executionTaskId.current = taskId;
        postTaskExecution(taskId);
      }
      return;
    }
    if (message.type === "pscm:gantt:rebase-failed") {
      setSaveFailed(true);
      afterStudioSave.current = null;
      setWaitingForStudioSave(false);
      setOpeningRequisition(false);
      return;
    }
    if (!canEdit) return;
    const validEdit = isStudioEdit(message);
    if (message.type === "pscm:gantt:edit" && validEdit) {
      queued.current = {
        sequence: message.sequence,
        version: message.version,
        state: message.state,
      };
      storeDraft();
      setHasQueuedEdits(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush.current(), 700);
      return;
    }
    if (message.type !== "pscm:gantt:ack" || !receipt.current) return;
    const saved = receipt.current;
    if (
      message.savedSequence !== saved.sequence ||
      message.version !== saved.version ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence < saved.sequence ||
      (message.sequence > saved.sequence && !validEdit)
    )
      return;
    receipt.current = null;
    submitted.current = null;
    const pending = message.sequence > saved.sequence;
    queued.current = pending
      ? {
          sequence: message.sequence,
          version: message.version,
          state: message.state,
        }
      : null;
    storeDraft();
    setHasQueuedEdits(pending);
    setSaveFailed(false);
    if (timer.current) clearTimeout(timer.current);
    if (pending) timer.current = setTimeout(() => flush.current(), 100);
    else if (afterStudioSave.current) {
      const action = afterStudioSave.current;
      afterStudioSave.current = null;
      setWaitingForStudioSave(false);
      action();
    }
  };
  useEffect(() => {
    const listener = (event: MessageEvent) => currentBridge.current(event);
    const confirmUnsaved = (event: BeforeUnloadEvent) => {
      if (!queued.current && !submitted.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("message", listener);
    window.addEventListener("beforeunload", confirmUnsaved);
    return () => {
      window.removeEventListener("message", listener);
      window.removeEventListener("beforeunload", confirmUnsaved);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (readyProject.current === projectId)
      post("pscm:gantt:locale", { locale });
  }, [locale, projectId]);
  useEffect(() => {
    if (readyProject.current === projectId)
      post("pscm:task-materials", { items: materialSummaries ?? [] });
  }, [materialSummaries, projectId]);
  useEffect(() => {
    if (readyProject.current === projectId && palette)
      post("pscm:gantt:palette", { palette });
  }, [palette, projectId]);
  useEffect(() => {
    if (readyProject.current === projectId && executionTaskId.current !== null)
      postTaskExecution(executionTaskId.current);
  }, [detail.data, projectId]);
  useEffect(() => {
    if (
      !state ||
      readyProject.current !== projectId ||
      queued.current ||
      submitted.current ||
      dataVersion <= serverVersion.current
    )
      return;
    serverVersion.current = dataVersion;
    post("pscm:gantt:refresh", { state, version: dataVersion });
  }, [state, projectId, dataVersion, hasQueuedEdits]);
  const retry = () => {
    if (receipt.current) post("pscm:gantt:saved", receipt.current);
    else {
      setSaveFailed(false);
      timer.current = setTimeout(() => flush.current(), 100);
    }
  };
  const discard = async () => {
    if (
      !window.confirm(
        t(
          "تجاهل التعديلات غير المحفوظة وإعادة تحميل المشروع؟",
          "Discard unsaved changes and reload this project?",
          "غیر محفوظ تبدیلیاں چھوڑ کر یہ منصوبہ دوبارہ لوڈ کریں؟"
        )
      )
    )
      return;
    const result = await detail.refetch();
    if (result.isError) return;
    queued.current = null;
    submitted.current = null;
    receipt.current = null;
    storeDraft();
    readyProject.current = 0;
    setHasQueuedEdits(false);
    setSaveFailed(false);
    setFrameKey(v => v + 1);
  };
  const project = detail.data?.project;
  const dependencyTask = detail.data?.tasks.find(
    task => task.id === dependencyTaskId
  );
  const canStart =
    canEdit &&
    user.permissions.includes("pm.start") &&
    (project?.status === "approved" || project?.status === "active") &&
    !project.actualStartDate;
  return (
    <section
      className="gantt-studio-shell"
      dir={locale === "en" ? "ltr" : "rtl"}
    >
      <div className="gantt-project-switcher">
        <div className="gantt-schedule-actions">
          <button
            type="button"
            onClick={onBack}
            disabled={
              save.isPending ||
              hasQueuedEdits ||
              waitingForStudioSave ||
              openingRequisition
            }
          >
            {t(
              "العودة إلى عرض المشاريع",
              "Back to projects",
              "منصوبوں پر واپس جائیں"
            )}
          </button>
        </div>
        {project && (
          <label>
            <bdi>{project.number}</bdi> · {project.name}
          </label>
        )}
        {canEdit && project && (
          <div className="gantt-schedule-actions">
            <button
              disabled={hasQueuedEdits}
              onClick={() => setDialog("configure")}
            >
              {t("الخطة", "Plan", "منصوبہ بندی")}
            </button>
            <button
              disabled={hasQueuedEdits}
              onClick={() => setDialog("extend")}
            >
              {t("تمديد", "Extend", "توسیع")}
            </button>
            <button disabled={hasQueuedEdits} onClick={() => setDialog("lock")}>
              {t("الأقفال", "Locks", "تاریخ کی پابندیاں")}
            </button>
            <button
              disabled={hasQueuedEdits}
              onClick={() => setSharedOpen(true)}
            >
              {t("مهمة مشتركة", "Shared task", "مشترکہ کام")}
            </button>
          </div>
        )}
        {canStart && (
          <div className="gantt-schedule-actions">
            <button
              disabled={hasQueuedEdits}
              onClick={() => setDialog("start")}
            >
              {t("بدء فعلي", "Actual start", "حقیقی آغاز")}
            </button>
          </div>
        )}
        {canCreateRequisition && project && (
          <div className="gantt-schedule-actions">
            <button
              disabled={
                openingRequisition || waitingForStudioSave || saveFailed
              }
              onClick={() => requestRequisition(null)}
            >
              + {mrText(locale, "request")}
            </button>
          </div>
        )}
        <span
          className={hasQueuedEdits ? "saving" : "saved"}
          aria-live="polite"
        >
          {saveFailed
            ? t(
                "تعذر الحفظ؛ التعديلات لا تزال مفتوحة",
                "Save failed. Edits are still open.",
                "محفوظ نہ ہو سکا۔ تبدیلیاں اب بھی کھلی ہیں۔"
              )
            : save.isPending
              ? t("جارٍ الحفظ…", "Saving…", "محفوظ ہو رہا ہے…")
              : hasQueuedEdits
                ? t(
                    "تعديلات بانتظار الحفظ",
                    "Changes waiting to save",
                    "تبدیلیاں محفوظ ہونے کی منتظر ہیں"
                  )
                : t(
                    "متزامن مع وحدة المشاريع",
                    "Synced with Project Unit",
                    "منصوبے کی اکائی سے ہم آہنگ"
                  )}
        </span>
        {saveFailed && (
          <div className="gantt-schedule-actions">
            <button type="button" onClick={retry}>
              {t("إعادة المحاولة", "Retry", "دوبارہ کوشش")}
            </button>
            <button type="button" onClick={() => void discard()}>
              {t(
                "تجاهل وإعادة تحميل",
                "Discard and reload",
                "چھوڑیں اور دوبارہ لوڈ کریں"
              )}
            </button>
          </div>
        )}
      </div>
      {detail.isError && !state ? (
        <div className="gantt-frame-error">{detail.error.message}</div>
      ) : !state ? (
        <div className="gantt-frame-loading">…</div>
      ) : (
        <iframe
          ref={frame}
          key={`${projectId}:${frameKey}`}
          onLoad={() => post("pscm:gantt:ping")}
          title={t(
            "مخطط جانت المعتمد",
            "Approved Gantt chart",
            "منظور شدہ گانٹ چارٹ"
          )}
          src={`/gantt-studio/index.html?v=pscm-bridge-5&project=${projectId}&channel=${channel}&requisitions=${canCreateRequisition ? "1" : "0"}`}
          className="gantt-studio-frame"
        />
      )}
      {materialTaskId !== null && (
        <TaskMaterialPanel
          projectId={projectId}
          taskId={materialTaskId}
          locale={locale}
          close={() => setMaterialTaskId(null)}
        />
      )}
      {dependencyTask && (
        <TaskDependencyPanel
          projectId={projectId}
          taskId={dependencyTask.id}
          taskName={dependencyTask.name}
          locale={locale}
          canEdit={canEdit}
          onClose={() => setDependencyTaskId(null)}
          onSaved={() =>
            post("pscm:task-dependencies-saved", { taskId: dependencyTask.id })
          }
        />
      )}
      {dialog && project && (
        <ScheduleDialog
          locale={locale}
          action={dialog}
          project={project}
          pending={schedule.isPending}
          close={() => setDialog(null)}
          save={data =>
            schedule.mutate({
              key: uid(),
              projectId,
              version: project.version,
              action: dialog,
              ...data,
            })
          }
        />
      )}{" "}
      {sharedOpen && (
        <SharedDialog
          locale={locale}
          projectId={projectId}
          data={directory.data}
          pending={shared.isPending}
          close={() => setSharedOpen(false)}
          save={data =>
            shared.mutate({ key: uid(), version: 0, action: "save", ...data })
          }
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
    </section>
  );
}

type ScheduleData = {
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string;
  extensionEndDate?: string;
  extensionDays?: number;
  reason?: string;
  startLocked?: boolean;
  endLocked?: boolean;
};
function ScheduleDialog({
  locale,
  action,
  project,
  pending,
  close,
  save,
}: {
  locale: Locale;
  action: ScheduleAction;
  project: Detail["project"];
  pending: boolean;
  close: () => void;
  save: (data: ScheduleData) => void;
}) {
  const t = (a: string, e: string, u: string) =>
      locale === "ar" ? a : locale === "ur" ? u : e,
    [ps, setPs] = useState(project.plannedStartDate ?? ""),
    [pe, setPe] = useState(project.plannedEndDate ?? ""),
    [actual, setActual] = useState(businessDate()),
    [newEnd, setNewEnd] = useState(""),
    [days, setDays] = useState(""),
    [reason, setReason] = useState(""),
    [startLock, setStartLock] = useState(project.startLocked),
    [endLock, setEndLock] = useState(project.endLocked);
  const title = {
    configure: t(
      "الخطة الزمنية للمشروع",
      "Project schedule plan",
      "منصوبے کا شیڈول"
    ),
    start: t(
      "تسجيل البدء الفعلي",
      "Record actual start",
      "حقیقی آغاز درج کریں"
    ),
    extend: t("تمديد المشروع", "Extend project", "منصوبے میں توسیع"),
    lock: t("أقفال المشروع", "Project locks", "منصوبے کی تاریخ کی پابندیاں"),
  }[action];
  const submit = () => {
    if (action === "configure")
      save({ plannedStartDate: ps || null, plannedEndDate: pe || null });
    if (action === "start") save({ actualStartDate: actual });
    if (action === "extend")
      save({
        extensionEndDate: newEnd || undefined,
        extensionDays: !newEnd && days !== "" ? Number(days) : undefined,
        reason,
      });
    if (action === "lock") save({ startLocked: startLock, endLocked: endLock });
  };
  return (
    <Modal title={title} close={close}>
      <form
        className="gantt-control-form"
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        {action === "configure" && (
          <>
            <label>
              {t("البداية المخططة", "Planned start", "طے شدہ آغاز")}
              <input
                required
                type="date"
                value={ps}
                onChange={e => setPs(e.target.value)}
              />
            </label>
            <label>
              {t("النهاية المخططة", "Planned end", "طے شدہ اختتام")}
              <input
                required
                type="date"
                min={ps}
                value={pe}
                onChange={e => setPe(e.target.value)}
              />
            </label>
          </>
        )}
        {action === "start" && (
          <>
            <p>
              {t(
                "ستُزاح المهام التي لم تبدأ فقط مع حفظ الخطة الأصلية.",
                "Only not-started tasks shift; the original plan is preserved.",
                "صرف وہ کام منتقل ہوں گے جو شروع نہیں ہوئے۔ اصل منصوبہ محفوظ رہے گا۔"
              )}
            </p>
            <label>
              {t(
                "تاريخ البدء الفعلي",
                "Actual start date",
                "حقیقی آغاز کی تاریخ"
              )}
              <input
                required
                type="date"
                value={actual}
                onChange={e => setActual(e.target.value)}
              />
            </label>
          </>
        )}
        {action === "extend" && (
          <>
            <p>
              {t("النهاية الحالية: ", "Current end: ", "موجودہ اختتام: ")}
              {project.forecastEndDate ?? project.plannedEndDate ?? "—"}
            </p>
            <label>
              {t("النهاية الجديدة", "New end date", "اختتام کی نئی تاریخ")}
              <input
                type="date"
                min={
                  project.forecastEndDate ?? project.plannedEndDate ?? undefined
                }
                value={newEnd}
                onChange={e => {
                  setNewEnd(e.target.value);
                  if (e.target.value) setDays("");
                }}
              />
            </label>
            <label>
              {t(
                "أو مدة التمديد بالأيام",
                "Or extension days",
                "یا توسیع کے دن"
              )}
              <input
                type="number"
                min={0}
                max={10000}
                value={days}
                onChange={e => {
                  setDays(e.target.value);
                  if (e.target.value !== "") setNewEnd("");
                }}
              />
            </label>
            <label>
              {t("السبب", "Reason", "وجہ")}
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </label>
          </>
        )}
        {action === "lock" && (
          <>
            <p>
              {t(
                "القفل يمنع المهام والعلاقات من تجاوز الحد.",
                "Locks prevent tasks and dependencies from crossing the boundary.",
                "مقفل تاریخ سے کام اور ان کے روابط آگے نہیں جا سکتے۔"
              )}
            </p>
            <label className="gantt-check">
              <input
                type="checkbox"
                checked={startLock}
                onChange={e => setStartLock(e.target.checked)}
              />
              {t("قفل البداية", "Lock start", "آغاز مقفل کریں")}
            </label>
            <label className="gantt-check">
              <input
                type="checkbox"
                checked={endLock}
                onChange={e => setEndLock(e.target.checked)}
              />
              {t("قفل النهاية", "Lock finish", "اختتام مقفل کریں")}
            </label>
          </>
        )}
        <button
          className="primary"
          disabled={pending || (action === "extend" && !newEnd && days === "")}
        >
          {t("حفظ وتطبيق", "Save and apply", "محفوظ اور لاگو کریں")}
        </button>
      </form>
    </Modal>
  );
}

function SharedDialog({
  locale,
  projectId,
  data,
  pending,
  close,
  save,
}: {
  locale: Locale;
  projectId: number;
  data: Shared | undefined;
  pending: boolean;
  close: () => void;
  save: (data: {
    name: string;
    taskIds: number[];
    syncDates: boolean;
    syncStatus: boolean;
    syncAssignees: boolean;
  }) => void;
}) {
  const t = (a: string, e: string, u: string) =>
      locale === "ar" ? a : locale === "ur" ? u : e,
    [name, setName] = useState(""),
    [ids, setIds] = useState<number[]>([]),
    [people, setPeople] = useState(false);
  return (
    <Modal
      title={t(
        "مهمة مشتركة بين المشاريع",
        "Shared task across projects",
        "منصوبوں کے درمیان مشترکہ کام"
      )}
      close={close}
    >
      <form
        className="gantt-control-form gantt-shared-form"
        onSubmit={e => {
          e.preventDefault();
          save({
            name,
            taskIds: ids,
            syncDates: true,
            syncStatus: true,
            syncAssignees: people,
          });
        }}
      >
        <p>
          {t(
            "اختر نسخ المهمة في مشروعين أو أكثر. تعديل التاريخ أو الحالة في أي نسخة سيُزامن الجميع كوحدة واحدة.",
            "Select task copies in two or more projects. Editing dates or status in any copy synchronizes all of them.",
            "دو یا زیادہ منصوبوں میں کام کے نسخے منتخب کریں۔ کسی ایک کی تاریخ یا حالت بدلنے سے سب ہم آہنگ ہوں گے۔"
          )}
        </p>
        <label>
          {t("اسم المهمة المشتركة", "Shared task name", "مشترکہ کام کا نام")}
          <input
            required
            minLength={2}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <div className="gantt-shared-list">
          {data?.projects.map(project => (
            <fieldset key={project.id}>
              <legend>
                {project.number} — {project.name}
                {project.id === projectId
                  ? ` (${t("الحالي", "current", "موجودہ")})`
                  : ""}
              </legend>
              {data.tasks
                .filter(task => task.projectId === project.id)
                .map(task => (
                  <label
                    key={task.id}
                    className={task.groupId ? "occupied" : ""}
                  >
                    <input
                      type="checkbox"
                      disabled={Boolean(task.groupId)}
                      checked={ids.includes(task.id)}
                      onChange={e =>
                        setIds(
                          e.target.checked
                            ? [...ids, task.id]
                            : ids.filter(id => id !== task.id)
                        )
                      }
                    />
                    <span>
                      {task.name}
                      <small>
                        {task.startDate} — {task.endDate}
                        {task.groupId
                          ? ` · ${t("مرتبط مسبقًا", "already linked", "پہلے سے منسلک")}`
                          : ""}
                      </small>
                    </span>
                  </label>
                ))}
            </fieldset>
          ))}
        </div>
        <label className="gantt-check">
          <input
            type="checkbox"
            checked={people}
            onChange={e => setPeople(e.target.checked)}
          />
          {t(
            "مزامنة المسؤولين أيضًا",
            "Synchronize assignees too",
            "ذمہ دار افراد بھی ہم آہنگ کریں"
          )}
        </label>
        <button className="primary" disabled={pending || ids.length < 2}>
          {t(
            "إنشاء الربط المتزامن",
            "Create synchronized link",
            "ہم آہنگ ربط بنائیں"
          )}
        </button>
      </form>
    </Modal>
  );
}
