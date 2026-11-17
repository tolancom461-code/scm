import { useEffect, useId, useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { ganttRelationTypes, type GanttRelationType } from "@shared/gantt";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../../server/routers";
import "./task-dependencies.css";

type TaskDependencyProps = {
  locale: Locale;
  projectId: number;
  taskId: number;
  taskName: string;
  canEdit: boolean;
  onSaved?: () => void | Promise<void>;
};

type GanttOutputs = inferRouterOutputs<AppRouter>["gantt"];
type Link = GanttOutputs["taskCrossProjectLinks"][number];
type SchedulePreview = GanttOutputs["previewCrossProjectLink"];

function dependencyCopy(locale: Locale) {
  const t = (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;
  return {
    create: t(
      "ربط بمهمة في مشروع آخر",
      "Link to a task in another project",
      "دوسرے منصوبے کے کام سے جوڑیں"
    ),
    title: t(
      "العلاقات مع مشاريع أخرى",
      "Dependencies across projects",
      "دوسرے منصوبوں سے روابط"
    ),
    currentTask: t("المهمة الحالية", "Current task", "موجودہ کام"),
    newLink: t("إضافة علاقة", "Add dependency", "نیا ربط بنائیں"),
    close: t("إغلاق", "Close", "بند کریں"),
    project: t("المشروع الآخر", "Other project", "دوسرا منصوبہ"),
    searchProject: t(
      "ابحث باسم المشروع أو رقمه",
      "Search by project name or number",
      "نام یا نمبر سے منصوبہ تلاش کریں"
    ),
    chooseProject: t("اختر المشروع", "Choose project", "منصوبہ منتخب کریں"),
    noProjects: t(
      "لا توجد مشاريع أخرى مطابقة.",
      "No matching projects.",
      "کوئی مماثل منصوبہ نہیں ملا۔"
    ),
    task: t("المهمة السابقة", "Predecessor task", "سابقہ کام"),
    searchTask: t(
      "ابحث باسم المهمة",
      "Search by task name",
      "نام سے کام تلاش کریں"
    ),
    chooseTask: t("اختر المهمة", "Choose task", "کام منتخب کریں"),
    noTasks: t(
      "لا توجد مهام مطابقة في هذا المشروع.",
      "No matching tasks in this project.",
      "اس منصوبے میں کوئی مماثل کام نہیں ملا۔"
    ),
    loadingDirectory: t(
      "جارٍ تحميل المشاريع والمهام…",
      "Loading projects and tasks…",
      "منصوبے اور کام لوڈ ہو رہے ہیں…"
    ),
    directoryFailed: t(
      "تعذّر تحميل المشاريع والمهام.",
      "Could not load projects and tasks.",
      "منصوبے اور کام لوڈ نہیں ہو سکے۔"
    ),
    advanced: t("خيارات متقدمة", "Advanced options", "اضافی اختیارات"),
    type: t("نوع العلاقة", "Dependency type", "ربط کی قسم"),
    types: {
      FS: t("بداية بعد نهاية", "Finish to start", "اختتام سے آغاز"),
      SS: t("بداية مع بداية", "Start to start", "آغاز سے آغاز"),
      FF: t("نهاية مع نهاية", "Finish to finish", "اختتام سے اختتام"),
      SF: t("نهاية بعد بداية", "Start to finish", "آغاز سے اختتام"),
    },
    lag: t("الفاصل بأيام العمل", "Lag in workdays", "کام کے دنوں میں وقفہ"),
    lagHint: t(
      "القيمة الموجبة تؤخر الموعد، والسالبة تقدّمه.",
      "Positive values delay the date; negative values bring it forward.",
      "مثبت قدر تاریخ کو آگے اور منفی قدر اسے پہلے لے آتی ہے۔"
    ),
    lagInvalid: t(
      "أدخل عددًا صحيحًا بين −2000 و2000.",
      "Enter a whole number from −2000 to 2000.",
      "−2000 سے 2000 تک مکمل عدد درج کریں۔"
    ),
    preview: t("معاينة العلاقة", "Dependency preview", "ربط کا پیش منظر"),
    checking: t(
      "جارٍ حساب التواريخ…",
      "Checking dates…",
      "تاریخیں دیکھی جا رہی ہیں…"
    ),
    previewFailed: t(
      "تعذّرت معاينة العلاقة.",
      "Could not preview the dependency.",
      "ربط کا پیش منظر دستیاب نہیں۔"
    ),
    datePlan: t("المخطط حاليًا", "Currently planned", "موجودہ منصوبہ"),
    dateExpected: t(
      "المتوقع بعد الربط",
      "Expected after linking",
      "ربط کے بعد متوقع"
    ),
    unchanged: t(
      "لا يُتوقع تغيير التاريخ المخطط لهذه المهمة.",
      "This task’s planned dates are expected to stay the same.",
      "اس کام کی منصوبہ شدہ تاریخیں یکساں رہنے کی توقع ہے۔"
    ),
    retry: t("إعادة المحاولة", "Try again", "دوبارہ کوشش کریں"),
    save: t("حفظ العلاقة", "Save dependency", "ربط محفوظ کریں"),
    saving: t(
      "جارٍ حفظ العلاقة…",
      "Saving dependency…",
      "ربط محفوظ ہو رہا ہے…"
    ),
    saved: t("تم حفظ العلاقة.", "Dependency saved.", "ربط محفوظ ہو گیا۔"),
    saveFailed: t(
      "تعذّر حفظ العلاقة.",
      "Could not save the dependency.",
      "ربط محفوظ نہیں ہو سکا۔"
    ),
    existing: t("العلاقات الحالية", "Existing dependencies", "موجودہ روابط"),
    loadingLinks: t(
      "جارٍ تحميل العلاقات…",
      "Loading dependencies…",
      "روابط لوڈ ہو رہے ہیں…"
    ),
    linksFailed: t(
      "تعذّر تحميل العلاقات.",
      "Could not load dependencies.",
      "روابط لوڈ نہیں ہو سکے۔"
    ),
    noLinks: t(
      "لا توجد علاقات مع مشاريع أخرى لهذه المهمة.",
      "This task has no dependencies with other projects.",
      "اس کام کا کسی دوسرے منصوبے سے ربط نہیں ہے۔"
    ),
  };
}

function RelationSentence({
  locale,
  from,
  to,
  type,
  lagDays,
}: {
  locale: Locale;
  from: string;
  to: string;
  type: GanttRelationType;
  lagDays: number;
}) {
  const t = (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;
  const predecessor = <bdi>«{from}»</bdi>;
  const successor = <bdi>«{to}»</bdi>;
  const starts = type === "FS" || type === "SS";
  const finishAnchor = type === "FS" || type === "FF";
  const lag = new Intl.NumberFormat(localeMeta[locale].formatting, {
    signDisplay: "always",
  }).format(lagDays);

  return (
    <>
      {locale === "ar" ? (
        <>
          {starts ? "تبدأ مهمة" : "تنتهي مهمة"} {successor}{" "}
          {type === "FS"
            ? "بعد انتهاء"
            : finishAnchor
              ? "عند انتهاء"
              : "عند بداية"}{" "}
          مهمة {predecessor}
          {type === "FS" ? "" : finishAnchor ? " أو بعده" : " أو بعدها"}
        </>
      ) : locale === "en" ? (
        <>
          {successor} {starts ? "starts" : "finishes"}{" "}
          {type === "FS" ? "after" : "at or after"} the{" "}
          {finishAnchor ? "finish" : "start"} of {predecessor}
        </>
      ) : (
        <>
          {successor} کا {starts ? "آغاز" : "اختتام"} {predecessor} کے{" "}
          {finishAnchor ? "اختتام" : "آغاز"}{" "}
          {type === "FS" ? "کے بعد" : "پر یا اس کے بعد"} ہوگا
        </>
      )}
      {lagDays !== 0 && (
        <>
          {" "}
          · {t("الفاصل", "Lag", "وقفہ")}: <bdi>{lag}</bdi>{" "}
          {t("يوم عمل", "workdays", "کام کے دن")}
        </>
      )}
    </>
  );
}

const normalizeSearch = (text: string) =>
  text.normalize("NFKC").trim().toLowerCase();

function DirectorySelector({
  label,
  searchLabel,
  placeholder,
  empty,
  options,
  value,
  setValue,
}: {
  label: string;
  searchLabel: string;
  placeholder: string;
  empty: string;
  options: { id: number; label: string }[];
  value: number;
  setValue: (id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const selectId = useId();
  const query = normalizeSearch(search);
  const visible = options.filter(
    option =>
      option.id === value || normalizeSearch(option.label).includes(query)
  );
  return (
    <div className="task-dependency-selector">
      <input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={search}
        onChange={event => setSearch(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <label htmlFor={selectId}>{label}</label>
      <select
        id={selectId}
        value={value}
        onChange={event => setValue(Number(event.target.value))}
      >
        <option value={0}>{placeholder}</option>
        {visible.map(option => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {!visible.length && <small role="status">{empty}</small>}
    </div>
  );
}

function PreviewDates({
  data,
  copy,
}: {
  data: SchedulePreview;
  copy: ReturnType<typeof dependencyCopy>;
}) {
  const range = (start: string, end: string) => (
    <bdi>
      <time dateTime={start}>{start}</time> — <time dateTime={end}>{end}</time>
    </bdi>
  );
  return data.changed ? (
    <dl>
      <dt>{copy.datePlan}</dt>
      <dd>{range(data.currentStartDate, data.currentEndDate)}</dd>
      <dt>{copy.dateExpected}</dt>
      <dd>{range(data.startDate, data.endDate)}</dd>
    </dl>
  ) : (
    <p>{copy.unchanged}</p>
  );
}

export function TaskDependencyPanel({
  locale,
  projectId,
  taskId,
  taskName,
  canEdit,
  onSaved,
  onClose,
}: TaskDependencyProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const typeId = useId();
  const copy = dependencyCopy(locale);
  const utils = trpc.useUtils();
  const [otherProjectId, setOtherProjectId] = useState(0);
  const [otherTaskId, setOtherTaskId] = useState(0);
  const [type, setType] = useState<GanttRelationType>("FS");
  const [lag, setLag] = useState("0");
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pickerGeneration, resetPicker] = useState(0);
  const lastAttempt = useRef<{ signature: string; key: string } | null>(null);
  const directory = trpc.gantt.sharedDirectory.useQuery(undefined, {
    enabled: canEdit,
    retry: false,
  });
  const existing = trpc.gantt.taskCrossProjectLinks.useQuery(
    { projectId, taskId },
    { retry: false }
  );
  const projects =
    directory.data?.projects.filter(project => project.id !== projectId) ?? [];
  const otherProject = projects.find(project => project.id === otherProjectId);
  const tasks = otherProject
    ? (directory.data?.tasks.filter(
        task => task.projectId === otherProject.id
      ) ?? [])
    : [];
  const otherTask = tasks.find(task => task.id === otherTaskId);
  const taskNameCounts = new Map<string, number>();
  for (const task of tasks) {
    const name = normalizeSearch(task.name);
    taskNameCounts.set(name, (taskNameCounts.get(name) ?? 0) + 1);
  }
  const lagDays = Number(lag);
  const validLag = Number.isInteger(lagDays) && Math.abs(lagDays) <= 2000;
  const input = {
    projectId,
    fromTaskId: otherTaskId,
    toTaskId: taskId,
    type,
    lagDays: validLag ? lagDays : 0,
  };
  const hasDraft = canEdit && !directory.isError && Boolean(otherTask);
  const preview = trpc.gantt.previewCrossProjectLink.useQuery(input, {
    enabled: hasDraft && validLag,
    retry: false,
    trpc: { abortOnUnmount: true },
  });
  const save = trpc.gantt.saveLink.useMutation({
    onSuccess: async () => {
      setOtherTaskId(0);
      setOtherProjectId(0);
      setType("FS");
      setLag("0");
      setAdvanced(false);
      resetPicker(value => value + 1);
      lastAttempt.current = null;
      setSaved(true);
      await Promise.allSettled([
        utils.gantt.invalidate(),
        utils.projectManagement.invalidate(),
        Promise.resolve().then(onSaved),
      ]);
    },
  });

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dialog.current?.open) return;
      // A disabled save button can leave the focus on the document during save.
      // Catch Escape before the underlying task editor's document listener.
      event.preventDefault();
      event.stopPropagation();
      if (!save.isPending) onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [save.isPending, onClose]);

  const close = () => {
    if (!save.isPending) onClose();
  };
  const edited = () => {
    setSaved(false);
    save.reset();
  };
  const canSave =
    hasDraft &&
    validLag &&
    preview.isSuccess &&
    !preview.isFetching &&
    !save.isPending;

  return (
    <dialog
      ref={dialog}
      className="task-dependency-panel"
      dir={localeMeta[locale].direction}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
    >
      <header className="task-dependency-header">
        <div>
          <h2 id={titleId}>{copy.title}</h2>
          <p>
            {copy.currentTask}:{" "}
            <strong>
              <bdi>{taskName}</bdi>
            </strong>
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={copy.close}
          onClick={close}
          disabled={save.isPending}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {canEdit && (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (!canSave) return;
            const signature = JSON.stringify(input);
            if (lastAttempt.current?.signature !== signature) {
              lastAttempt.current = { signature, key: crypto.randomUUID() };
            }
            save.mutate({
              ...input,
              key: lastAttempt.current.key,
              version: 0,
              action: "save",
            });
          }}
        >
          <fieldset className="task-dependency-add" disabled={save.isPending}>
            <legend>{copy.newLink}</legend>
            {directory.isLoading && (
              <p role="status">{copy.loadingDirectory}</p>
            )}
            {directory.isError ? (
              <div className="task-dependency-error">
                <p role="alert">{copy.directoryFailed}</p>
                <button
                  type="button"
                  className="task-dependency-button"
                  onClick={() => void directory.refetch()}
                >
                  {copy.retry}
                </button>
              </div>
            ) : (
              directory.data && (
                <DirectorySelector
                  key={pickerGeneration}
                  label={copy.project}
                  searchLabel={copy.searchProject}
                  placeholder={copy.chooseProject}
                  empty={copy.noProjects}
                  options={projects.map(project => ({
                    id: project.id,
                    label: `${project.name} — ${project.number}`,
                  }))}
                  value={otherProjectId}
                  setValue={id => {
                    setOtherProjectId(id);
                    setOtherTaskId(0);
                    edited();
                  }}
                />
              )
            )}
            {otherProject && (
              <DirectorySelector
                key={otherProjectId}
                label={copy.task}
                searchLabel={copy.searchTask}
                placeholder={copy.chooseTask}
                empty={copy.noTasks}
                options={tasks.map(task => ({
                  id: task.id,
                  label:
                    (taskNameCounts.get(normalizeSearch(task.name)) ?? 0) > 1
                      ? `${task.name} · ${task.startDate} (#${task.id})`
                      : task.name,
                }))}
                value={otherTaskId}
                setValue={id => {
                  setOtherTaskId(id);
                  edited();
                }}
              />
            )}
            {otherTask && (
              <>
                <details
                  open={advanced}
                  onToggle={event => setAdvanced(event.currentTarget.open)}
                >
                  <summary>{copy.advanced}</summary>
                  <div className="task-dependency-advanced">
                    <div>
                      <label htmlFor={typeId}>{copy.type}</label>
                      <select
                        id={typeId}
                        value={type}
                        onChange={event => {
                          setType(event.target.value as GanttRelationType);
                          edited();
                        }}
                      >
                        {ganttRelationTypes.map(value => (
                          <option key={value} value={value}>
                            {copy.types[value]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label>
                      <span>{copy.lag}</span>
                      <input
                        type="number"
                        min={-2000}
                        max={2000}
                        step={1}
                        value={lag}
                        onChange={event => {
                          setLag(event.target.value);
                          edited();
                        }}
                      />
                    </label>
                    <small>{copy.lagHint}</small>
                  </div>
                </details>
                <div className="task-dependency-preview">
                  <h3>{copy.preview}</h3>
                  <p>
                    <RelationSentence
                      locale={locale}
                      from={otherTask.name}
                      to={taskName}
                      type={type}
                      lagDays={input.lagDays}
                    />
                  </p>
                  <div aria-live="polite">
                    {!validLag ? (
                      <p className="task-dependency-error">{copy.lagInvalid}</p>
                    ) : preview.isFetching || preview.isPending ? (
                      <p>{copy.checking}</p>
                    ) : preview.isError ? (
                      <div className="task-dependency-error">
                        <p role="alert">
                          {copy.previewFailed} {preview.error.message}
                        </p>
                        <button
                          type="button"
                          className="task-dependency-button"
                          onClick={() => void preview.refetch()}
                        >
                          {copy.retry}
                        </button>
                      </div>
                    ) : (
                      preview.data && (
                        <PreviewDates data={preview.data} copy={copy} />
                      )
                    )}
                  </div>
                </div>
                <button
                  type="submit"
                  className="task-dependency-button task-dependency-save"
                  disabled={!canSave}
                >
                  {save.isPending ? copy.saving : copy.save}
                </button>
                {save.isError && (
                  <p className="task-dependency-error" role="alert">
                    {copy.saveFailed} {save.error.message}
                  </p>
                )}
              </>
            )}
            {saved && (
              <p className="task-dependency-saved" role="status">
                {copy.saved}
              </p>
            )}
          </fieldset>
        </form>
      )}
      <section className="task-dependency-existing">
        <h3>{copy.existing}</h3>
        {existing.isLoading ? (
          <p role="status">{copy.loadingLinks}</p>
        ) : existing.isError ? (
          <div className="task-dependency-error">
            <p role="alert">{copy.linksFailed}</p>
            <button
              className="task-dependency-button"
              type="button"
              onClick={() => void existing.refetch()}
            >
              {copy.retry}
            </button>
          </div>
        ) : existing.data?.length ? (
          <ul>
            {existing.data.map((link: Link) => {
              const other = link.to.taskId === taskId ? link.from : link.to;
              return (
                <li key={link.id}>
                  <strong>
                    <bdi>{other.projectName}</bdi> ·{" "}
                    <bdi>{other.projectNumber}</bdi>
                  </strong>
                  <p>
                    <RelationSentence
                      locale={locale}
                      from={link.from.taskName}
                      to={link.to.taskName}
                      type={link.type}
                      lagDays={link.lagDays}
                    />
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{copy.noLinks}</p>
        )}
      </section>
    </dialog>
  );
}

export function TaskDependencyAction({
  disabled,
  ...task
}: TaskDependencyProps & { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const copy = dependencyCopy(task.locale);

  return (
    <>
      <button
        className="task-dependency-button task-dependency-trigger"
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Link2 aria-hidden="true" size={16} />
        {task.canEdit ? copy.create : copy.title}
      </button>
      {open && <TaskDependencyPanel {...task} onClose={() => setOpen(false)} />}
    </>
  );
}
