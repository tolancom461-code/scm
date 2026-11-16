import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { businessDate } from "@shared/date";
import {
  canLinkProjectCmmsLocation,
  projectAttachmentMaxBytes,
  projectStates,
  projectFileExtensions,
} from "@shared/construction";
import { toast } from "sonner";
import { FilePreview } from "./Preview";
import {
  ProjectAttachmentUploadStatus,
  useProjectAttachmentUpload,
} from "./ProjectAttachmentUpload";
import {
  GoogleProjectMap,
  type GoogleProjectMapPoint,
} from "./GoogleProjectMap";
import { MaterialRequisitionForm } from "../material-requisitions/MaterialRequisitions";
import { mrText } from "../material-requisitions/copy";
import { ProjectMaterialCosts } from "./ProjectMaterialCosts";
import { TaskMaterialTrigger } from "./TaskMaterialProgress";
import "./projects.css";
type Outputs = inferRouterOutputs<AppRouter>["projectManagement"];
type Project = Outputs["detail"]["project"];
type Task = Outputs["detail"]["tasks"][number];
type Directory = Outputs["directory"];
type Person = { id: number; permissions: string[] };
const projectPageSize = 50;
type LocalizedLabel = [string, string, string];
const localeIndex = { ar: 0, en: 1, ur: 2 } as const;
const linkProjectLocationLabel: LocalizedLabel = [
  "ربط موقع المشروع",
  "Link project location",
  "منصوبے کا مقام جوڑیں",
];
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
function directLocationOf(project?: Project): GoogleProjectMapPoint | null {
  const lat = project?.directLatitude;
  const lng = project?.directLongitude;
  return typeof lat === "number" && typeof lng === "number"
    ? { lat, lng }
    : null;
}
function directLocationCoordinates({ lat, lng }: GoogleProjectMapPoint) {
  return lat.toFixed(6) + ", " + lng.toFixed(6);
}
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
function validateFiles(files: File[], t: ReturnType<typeof text>) {
  if (
    files.some(
      f =>
        !projectFileExtensions.test(f.name) ||
        f.size > projectAttachmentMaxBytes ||
        f.size === 0
    )
  ) {
    toast.error(
      t(
        "اختر صورًا أو PDF أو DWG، بحد أقصى 150 ميغابايت لكل ملف",
        "Choose images, PDF or DWG, up to 150 MB per file",
        "تصویر، PDF یا DWG منتخب کریں۔ ہر فائل زیادہ سے زیادہ 150 MB ہو۔"
      )
    );
    return false;
  }
  return true;
}
function notifyAttachmentsUploaded(locale: Locale) {
  toast.success(
    text(locale)(
      "تم رفع المرفقات",
      "Attachments uploaded",
      "منسلکات اپ لوڈ ہو گئے"
    )
  );
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
    [creating, setCreating] = useState(false),
    [linkingProjectId, setLinkingProjectId] = useState<number | null>(null),
    [linkedProjectIds, setLinkedProjectIds] = useState<Set<number>>(
      () => new Set()
    );
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
  const mayLinkFromList = (project: Project) =>
    can("pm.edit") &&
    !linkedProjectIds.has(project.id) &&
    canLinkProjectCmmsLocation(project);
  const linkingProject =
    tab === "projects" && !selected && !creating
      ? projects.find(p => p.id === linkingProjectId && mayLinkFromList(p))
      : undefined;
  const linkLocationTitle = linkProjectLocationLabel[localeIndex[locale]];
  const chooseTab = (v: typeof tab) => {
    setSelected(0);
    setLinkingProjectId(null);
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
                  <article className="pm-project-card" key={p.id}>
                    <div>
                      <div className="pm-project-card-reference">
                        <bdi>{p.number}</bdi>
                        {mayLinkFromList(p) && (
                          <button
                            type="button"
                            className="pm-project-card-link-location"
                            aria-haspopup="dialog"
                            aria-label={linkLocationTitle + " " + p.number}
                            onClick={() => setLinkingProjectId(p.id)}
                          >
                            {linkLocationTitle}
                          </button>
                        )}
                      </div>
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
                    <button
                      type="button"
                      className="pm-project-card-open"
                      aria-label={
                        t("فتح المشروع", "Open project", "منصوبہ کھولیں") +
                        " " +
                        p.number
                      }
                      onClick={() => {
                        setLinkingProjectId(null);
                        setSelected(p.id);
                      }}
                    >
                      {t("فتح المشروع ←", "Open project →", "منصوبہ کھولیں ←")}
                    </button>
                  </article>
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
      {linkingProject && (
        <LinkProjectCmmsLocation
          key={linkingProject.id}
          locale={locale}
          project={linkingProject}
          close={() => setLinkingProjectId(null)}
          refresh={() => void list.refetch()}
          saved={() => {
            setLinkedProjectIds(ids => new Set(ids).add(linkingProject.id));
            setLinkingProjectId(null);
          }}
        />
      )}
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
            void utils.materialRequisitions.directory.invalidate();
          }}
        />
      )}
    </section>
  );
}
type ProjectLocationSelection = {
  siteId: number | null;
  sectionId: number | null;
  assetId: number | null;
};

function CmmsLocationSelect({
  label,
  placeholder,
  value,
  options,
  saved,
  disabled,
  required,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  options?: { id: number; name: string }[];
  saved?: { id: number | null; name: string | null };
  disabled?: boolean;
  required?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        disabled={disabled}
        required={required}
        onChange={event =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">{placeholder}</option>
        {saved?.id != null &&
          value === saved.id &&
          !options?.some(option => option.id === saved.id) && (
            <option value={saved.id}>{saved.name ?? saved.id}</option>
          )}
        {options?.map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function useProjectCmmsChoices(
  locale: Locale,
  { siteId, sectionId }: ProjectLocationSelection
) {
  const status = trpc.cmmsReferences.status.useQuery();
  const configured = status.isSuccess && status.data.configured;
  const sites = trpc.cmmsReferences.sites.useQuery(
    { locale },
    { enabled: configured }
  );
  const sections = trpc.cmmsReferences.sections.useQuery(
    { siteId: siteId ?? 0, locale },
    { enabled: configured && siteId !== null }
  );
  const assets = trpc.cmmsReferences.assets.useQuery(
    { siteId: siteId ?? 0, sectionId: sectionId ?? 0, locale },
    { enabled: configured && siteId !== null && sectionId !== null }
  );
  return { status, configured, sites, sections, assets };
}

function cmmsLocationIsAvailable(
  { siteId, sectionId, assetId }: ProjectLocationSelection,
  {
    configured,
    sites,
    sections,
    assets,
  }: ReturnType<typeof useProjectCmmsChoices>
) {
  return (
    configured &&
    sites.isSuccess &&
    sites.data.some(option => option.id === siteId) &&
    sections.isSuccess &&
    sections.data.some(option => option.id === sectionId) &&
    (assetId === null ||
      (assets.isSuccess && assets.data.some(option => option.id === assetId)))
  );
}

function ProjectCmmsLocationFields({
  locale,
  project,
  selection,
  choices,
  onChange,
  disabled,
}: {
  locale: Locale;
  project?: Project;
  selection: ProjectLocationSelection;
  choices: ReturnType<typeof useProjectCmmsChoices>;
  onChange: (value: ProjectLocationSelection) => void;
  disabled?: boolean;
}) {
  const t = text(locale);
  const { siteId, sectionId, assetId } = selection;
  const { status, configured, sites, sections, assets } = choices;
  const failed = configured
    ? [sites, sections, assets].filter(query => query.isError)
    : [];
  const isLoading =
    configured &&
    (sites.isFetching || sections.isFetching || assets.isFetching);
  return (
    <fieldset className="pm-cmms-location" disabled={disabled}>
      <legend>
        {t(
          "موقع المشروع من CMMS",
          "Project location from CMMS",
          "سی ایم ایم ایس سے منصوبے کا مقام"
        )}
      </legend>
      <div className="pm-cmms-location-fields">
        <CmmsLocationSelect
          label={t("الموقع *", "Site *", "مقام *")}
          placeholder={t("اختر الموقع", "Select a site", "مقام منتخب کریں")}
          value={siteId}
          options={configured && sites.isSuccess ? sites.data : undefined}
          saved={
            project && { id: project.cmmsSiteId, name: project.cmmsSiteName }
          }
          required
          disabled={!configured || !sites.isSuccess}
          onChange={value =>
            onChange({ siteId: value, sectionId: null, assetId: null })
          }
        />
        <CmmsLocationSelect
          label={t("القسم *", "Section *", "شعبہ *")}
          placeholder={t("اختر القسم", "Select a section", "شعبہ منتخب کریں")}
          value={sectionId}
          options={configured && sections.isSuccess ? sections.data : undefined}
          saved={
            project && {
              id: project.cmmsSectionId,
              name: project.cmmsSectionName,
            }
          }
          required
          disabled={!configured || siteId === null || !sections.isSuccess}
          onChange={value =>
            onChange({ siteId, sectionId: value, assetId: null })
          }
        />
        <CmmsLocationSelect
          label={t("الأصل (اختياري)", "Asset (optional)", "اثاثہ (اختیاری)")}
          placeholder={t("بدون أصل", "No asset", "اثاثہ نہیں")}
          value={assetId}
          options={configured && assets.isSuccess ? assets.data : undefined}
          saved={
            project && { id: project.cmmsAssetId, name: project.cmmsAssetName }
          }
          disabled={!configured || sectionId === null || !assets.isSuccess}
          onChange={value => onChange({ siteId, sectionId, assetId: value })}
        />
      </div>
      {status.isPending && (
        <p className="pm-help" role="status">
          {t(
            "جارٍ التحقق من ربط قوائم CMMS…",
            "Checking the CMMS reference connection…",
            "CMMS کے حوالہ جاتی رابطے کی جانچ جاری ہے…"
          )}
        </p>
      )}
      {status.isSuccess && !configured && (
        <p className="pm-help" role="status">
          {t(
            "يلزم تفعيل ربط قوائم CMMS لاختيار الموقع والقسم.",
            "Connect the CMMS reference lists to choose the site and section.",
            "مقام اور شعبہ منتخب کرنے کے لیے CMMS کی حوالہ جاتی فہرستیں جوڑیں۔"
          )}
        </p>
      )}
      {status.isError && (
        <p className="pm-help" role="alert">
          {t(
            "تعذر التحقق من إعدادات ربط المواقع.",
            "Location integration status is unavailable.",
            "مقام کے انضمام کی حالت دستیاب نہیں۔"
          )}{" "}
          <button type="button" onClick={() => void status.refetch()}>
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      )}
      {isLoading && (
        <small role="status">
          {t(
            "جاري جلب قوائم CMMS…",
            "Loading CMMS choices…",
            "سی ایم ایم ایس کی فہرستیں لوڈ ہو رہی ہیں…"
          )}
        </small>
      )}
      {configured && sites.isSuccess && sites.data.length === 0 && (
        <small role="status">
          {t(
            "قائمة المواقع في CMMS فارغة. أضف موقعًا في CMMS أولًا.",
            "CMMS has no sites. Add a site in CMMS first.",
            "CMMS میں کوئی مقام موجود نہیں۔ پہلے وہاں مقام شامل کریں۔"
          )}
        </small>
      )}
      {configured &&
        siteId !== null &&
        sections.isSuccess &&
        sections.data.length === 0 && (
          <small role="status">
            {t(
              "اختر موقعًا له أقسام في CMMS.",
              "Choose a site that has sections in CMMS.",
              "CMMS میں شعبوں والا مقام منتخب کریں۔"
            )}
          </small>
        )}
      {failed.length > 0 && (
        <p className="pm-help" role="alert">
          {sites.isError || sections.isError
            ? t(
                "تعذر جلب قوائم موقع المشروع من CMMS.",
                "CMMS project locations could not be loaded.",
                "سی ایم ایم ایس سے منصوبے کے مقامات لوڈ نہیں ہو سکے۔"
              )
            : t(
                "تعذر جلب قائمة الأصول من CMMS.",
                "CMMS assets could not be loaded.",
                "CMMS سے اثاثے لوڈ نہیں ہو سکے۔"
              )}{" "}
          <button
            type="button"
            onClick={() =>
              void Promise.all(failed.map(query => query.refetch()))
            }
          >
            {t("إعادة المحاولة", "Retry", "دوبارہ کوشش کریں")}
          </button>
        </p>
      )}
    </fieldset>
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
    [location, setLocation] = useState<ProjectLocationSelection>({
      siteId: project?.cmmsSiteId ?? null,
      sectionId: project?.cmmsSectionId ?? null,
      assetId: project?.cmmsAssetId ?? null,
    }),
    [directLocation, setDirectLocation] = useState(() =>
      directLocationOf(project)
    ),
    [locationPicker, setLocationPicker] = useState<{
      point: GoogleProjectMapPoint | null;
    } | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [savedProjectId, setSavedProjectId] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const save = trpc.projectManagement.save.useMutation();
  const attachmentUpload = useProjectAttachmentUpload(locale);
  const choices = useProjectCmmsChoices(locale, location);
  const canEditDirectLocation = !project || project.status === "draft";
  const directLocationChanged =
    canEditDirectLocation &&
    ((directLocation?.lat ?? null) !== (project?.directLatitude ?? null) ||
      (directLocation?.lng ?? null) !== (project?.directLongitude ?? null));
  const locationChanged =
    location.siteId !== (project?.cmmsSiteId ?? null) ||
    location.sectionId !== (project?.cmmsSectionId ?? null) ||
    location.assetId !== (project?.cmmsAssetId ?? null);
  const { siteId, sectionId, assetId } = location;
  const locationComplete =
    siteId !== null && siteId > 0 && sectionId !== null && sectionId > 0;
  const canSaveLocation =
    locationComplete &&
    (!locationChanged || cmmsLocationIsAvailable(location, choices));
  const selectLocationMessage = t(
    "اختر الموقع والقسم من CMMS قبل الحفظ. الأصل اختياري.",
    "Choose the CMMS site and section before saving. The asset is optional.",
    "محفوظ کرنے سے پہلے CMMS کا مقام اور شعبہ منتخب کریں۔ اثاثہ اختیاری ہے۔"
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !validateFiles(files, t)) return;
    if (locationPicker !== null) return;
    if (!canSaveLocation) {
      toast.error(selectLocationMessage);
      return;
    }
    setBusy(true);
    try {
      const result = await save.mutateAsync({
        key: crypto.randomUUID(),
        id: project?.id,
        version: project?.version ?? 0,
        data: {
          ...form,
          ...(directLocationChanged ? { directLocation } : {}),
          ...(locationChanged && siteId !== null && sectionId !== null
            ? {
                cmmsLocation: {
                  siteId,
                  sectionId,
                  assetId,
                  locale,
                },
              }
            : {}),
        },
      });
      toast.success(t("تم حفظ المسودة", "Draft saved", "مسودہ محفوظ ہو گیا"));
      const id = result.id;
      if (files.length) {
        setSavedProjectId(id);
        const uploads = await attachmentUpload.upload(
          { entityType: "pm_project", entityId: id },
          files
        );
        if (!uploads || uploads.failed) return;
        notifyAttachmentsUploaded(locale);
      }
      saved(id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("تعذر الحفظ", "Could not save", "محفوظ نہیں ہو سکا")
      );
    } finally {
      setBusy(false);
    }
  }
  if (savedProjectId !== null) {
    const uploading = busy || attachmentUpload.running;
    return (
      <Modal
        title={t("مرفقات المشروع", "Project attachments", "منصوبے کے منسلکات")}
        close={() => saved(savedProjectId)}
        closeDisabled={uploading}
      >
        <div className="pm-form">
          <p className="pm-help">
            {t("تم حفظ المسودة", "Draft saved", "مسودہ محفوظ ہو گیا")}
          </p>
          <ProjectAttachmentUploadStatus
            locale={locale}
            state={attachmentUpload}
            onRetry={async attachmentId => {
              const result = await attachmentUpload.retry(attachmentId);
              if (result?.failed === 0) {
                notifyAttachmentsUploaded(locale);
                saved(savedProjectId);
              }
            }}
          />
          <div className="pm-actions">
            <button
              type="button"
              disabled={uploading}
              onClick={() => saved(savedProjectId)}
            >
              {t("فتح المشروع", "Open project", "منصوبہ کھولیں")}
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title={
        locationPicker
          ? t(
              "تحديد الموقع المباشر",
              "Select the direct location",
              "براہ راست مقام منتخب کریں"
            )
          : project
            ? t("تعديل المشروع", "Edit project", "منصوبے میں ترمیم کریں")
            : t("إنشاء مشروع", "Create project", "منصوبہ بنائیں")
      }
      close={() => {
        if (busy) return;
        if (locationPicker) setLocationPicker(null);
        else close();
      }}
      closeDisabled={busy}
    >
      {locationPicker && (
        <div className="pm-direct-location-map">
          <p className="pm-help">
            {t(
              "اضغط على الخريطة لتحديد نقطة المشروع.",
              "Click the map to place the project pin.",
              "منصوبے کا پن لگانے کے لیے نقشے پر کلک کریں۔"
            )}
          </p>
          <GoogleProjectMap
            locale={locale}
            point={locationPicker.point}
            mode="pick"
            onPick={point => setLocationPicker({ point })}
          />
          <div className="pm-actions">
            <button
              type="button"
              className="primary"
              disabled={!locationPicker.point}
              onClick={() => {
                if (!locationPicker.point) return;
                setDirectLocation(locationPicker.point);
                setLocationPicker(null);
              }}
            >
              {t("اختيار هذه النقطة", "Use this point", "یہ مقام منتخب کریں")}
            </button>
            <button type="button" onClick={() => setLocationPicker(null)}>
              {t("رجوع", "Back", "واپس")}
            </button>
            {locationPicker.point && (
              <bdi dir="ltr" aria-live="polite">
                {directLocationCoordinates(locationPicker.point)}
              </bdi>
            )}
          </div>
        </div>
      )}
      <form
        className="pm-form"
        hidden={locationPicker !== null}
        onSubmit={submit}
      >
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
        <ProjectCmmsLocationFields
          locale={locale}
          project={project}
          selection={location}
          choices={choices}
          onChange={setLocation}
        />
        {!canSaveLocation && choices.configured && (
          <small role="status">{selectLocationMessage}</small>
        )}
        <div className="pm-field">
          <span>
            {t("الموقع المباشر", "Direct location", "براہ راست مقام")}
          </span>
          {canEditDirectLocation ? (
            <div className="pm-actions">
              <button
                type="button"
                onClick={() => setLocationPicker({ point: directLocation })}
                disabled={busy}
              >
                {directLocation
                  ? t(
                      "تغيير الموقع المباشر",
                      "Change direct location",
                      "براہ راست مقام تبدیل کریں"
                    )
                  : t(
                      "تحديد الموقع على الخريطة",
                      "Choose a location on the map",
                      "نقشے پر مقام منتخب کریں"
                    )}
              </button>
              {directLocation && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDirectLocation(null)}
                >
                  {t("إزالة الموقع", "Remove location", "مقام ہٹائیں")}
                </button>
              )}
            </div>
          ) : (
            <small>
              {t(
                "تعديل الموقع المباشر متاح في المسودة.",
                "Direct location can be edited in a draft.",
                "براہ راست مقام مسودے میں تبدیل کیا جا سکتا ہے۔"
              )}
            </small>
          )}
          {directLocation && (
            <bdi dir="ltr">{directLocationCoordinates(directLocation)}</bdi>
          )}
        </div>
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
                  "حتى 150 ميغابايت لكل ملف",
                  "Up to 150 MB per file",
                  "ہر فائل زیادہ سے زیادہ 150 MB"
                )}
              </small>
              {files.map((f, i) => (
                <span key={i}>{f.name}</span>
              ))}
            </Field>
          )}
        <div className="pm-actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || !canSaveLocation}
          >
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
function ProjectDirectLocationDetails({
  project,
  locale,
}: {
  project: Project;
  locale: Locale;
}) {
  const t = text(locale);
  const point = directLocationOf(project);
  const [dialog, setDialog] = useState<"share" | "map" | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  if (!point) return null;

  const showActions =
    project.status === "approved" || project.status === "active";
  const mapUrl = new URL("https://www.google.com/maps/search/");
  mapUrl.searchParams.set("api", "1");
  mapUrl.searchParams.set("query", point.lat + "," + point.lng);
  const url = mapUrl.href;
  const share = async () => {
    try {
      const data = { title: project.name, url };
      if (
        typeof navigator.share === "function" &&
        (typeof navigator.canShare !== "function" || navigator.canShare(data))
      ) {
        await navigator.share(data);
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
    setDialog("share");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("تم نسخ الرابط", "Link copied", "لنک کاپی ہو گیا"));
    } catch {
      urlInput.current?.focus();
      urlInput.current?.select();
      toast.info(
        t(
          "انسخ الرابط من الحقل.",
          "Copy the selected link.",
          "منتخب لنک کاپی کریں۔"
        )
      );
    }
  };
  return (
    <div>
      <dt>{t("الموقع المباشر", "Direct location", "براہ راست مقام")}</dt>
      <dd>
        <bdi dir="ltr">{directLocationCoordinates(point)}</bdi>
        {showActions && (
          <div className="pm-actions pm-direct-location-actions">
            <button type="button" onClick={() => void share()}>
              {t("مشاركة الموقع", "Share location", "مقام شیئر کریں")}
            </button>
            <button type="button" onClick={() => setDialog("map")}>
              {t("عرض على الخريطة", "View on map", "نقشے پر دیکھیں")}
            </button>
          </div>
        )}
        {showActions && dialog === "map" && (
          <Modal
            title={t("الموقع المباشر", "Direct location", "براہ راست مقام")}
            close={() => setDialog(null)}
          >
            <div className="pm-direct-location-map">
              <GoogleProjectMap
                locale={locale}
                point={point}
                mode="satellite"
              />
            </div>
          </Modal>
        )}
        {showActions && dialog === "share" && (
          <Modal
            title={t("مشاركة الموقع", "Share location", "مقام شیئر کریں")}
            close={() => setDialog(null)}
          >
            <div className="pm-direct-location-share">
              <Field label={t("رابط الموقع", "Location link", "مقام کا لنک")}>
                <input
                  ref={urlInput}
                  value={url}
                  readOnly
                  dir="ltr"
                  onFocus={e => e.currentTarget.select()}
                />
              </Field>
              <div className="pm-actions">
                <button type="button" onClick={() => void copyLink()}>
                  {t("نسخ الرابط", "Copy link", "لنک کاپی کریں")}
                </button>
                <a
                  href={"https://wa.me/?text=" + encodeURIComponent(url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(
                    "مشاركة عبر واتساب",
                    "Share on WhatsApp",
                    "واٹس ایپ پر شیئر کریں"
                  )}
                </a>
                <a href={url} target="_blank" rel="noreferrer">
                  {t(
                    "فتح في خرائط Google",
                    "Open in Google Maps",
                    "گوگل میپس میں کھولیں"
                  )}
                </a>
              </div>
            </div>
          </Modal>
        )}
      </dd>
    </div>
  );
}
function LinkProjectCmmsLocation({
  locale,
  project,
  close,
  saved,
  refresh,
}: {
  locale: Locale;
  project: Project;
  close: () => void;
  saved: () => void;
  refresh: () => void;
}) {
  const [selection, setSelection] = useState<ProjectLocationSelection>({
    siteId: null,
    sectionId: null,
    assetId: null,
  });
  const attempt = useRef<{
    key: string;
    version: number;
    locale: Locale;
  } | null>(null);
  const t = text(locale);
  const utils = trpc.useUtils();
  const choices = useProjectCmmsChoices(locale, selection);
  const canSave = cmmsLocationIsAvailable(selection, choices);
  const link = trpc.projectManagement.linkCmmsLocation.useMutation({
    onSuccess: () => {
      saved();
      void utils.projectManagement.invalidate();
      void utils.gantt.projects.invalidate();
      void utils.gantt.detail.invalidate({ projectId: project.id });
      void utils.materialRequisitions.invalidate();
      toast.success(
        t(
          "تم ربط موقع المشروع",
          "Project location linked",
          "منصوبے کا مقام جوڑ دیا گیا"
        )
      );
    },
    onError: error => {
      if (error.data?.code === "CONFLICT") refresh();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const { siteId, sectionId, assetId } = selection;
    if (link.isPending || !canSave || siteId === null || sectionId === null)
      return;
    const version = project.version;
    if (
      attempt.current?.version !== version ||
      attempt.current.locale !== locale
    )
      attempt.current = { key: crypto.randomUUID(), version, locale };
    link.mutate({
      key: attempt.current.key,
      id: project.id,
      version,
      location: { siteId, sectionId, assetId, locale },
    });
  }
  return (
    <Modal
      title={linkProjectLocationLabel[localeIndex[locale]]}
      eyebrow={project.number}
      close={() => {
        if (!link.isPending) close();
      }}
    >
      <form className="pm-form" onSubmit={submit}>
        <p className="pm-help">
          {t(
            "اختر الموقع والقسم من CMMS. الأصل اختياري. يُحفظ الربط مرة واحدة.",
            "Choose a site and section from CMMS. The asset is optional. This location can be linked once.",
            "CMMS سے مقام اور شعبہ منتخب کریں۔ اثاثہ اختیاری ہے۔ مقام ایک مرتبہ جوڑا جا سکتا ہے۔"
          )}
        </p>
        <ProjectCmmsLocationFields
          locale={locale}
          selection={selection}
          choices={choices}
          disabled={link.isPending}
          onChange={value => {
            attempt.current = null;
            link.reset();
            setSelection(value);
          }}
        />
        {link.error && (
          <p className="pm-help" role="alert">
            {link.error.message}
          </p>
        )}
        <div className="pm-actions">
          <button
            type="submit"
            className="primary"
            disabled={link.isPending || !canSave}
          >
            {link.isPending
              ? t("جاري الحفظ…", "Saving…", "محفوظ ہو رہا ہے…")
              : t("حفظ الربط", "Save link", "ربط محفوظ کریں")}
          </button>
          <button type="button" onClick={close} disabled={link.isPending}>
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
  const attachmentUpload = useProjectAttachmentUpload(locale);
  const [edit, setEdit] = useState(false),
    [locationLink, setLocationLink] = useState<"closed" | "open" | "saved">(
      "closed"
    ),
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
  const mayLinkLocation =
    locationLink !== "saved" &&
    can("pm.edit") &&
    canLinkProjectCmmsLocation(project);
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
      <button onClick={back} disabled={attachmentUpload.running}>
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
          {mayLinkLocation && (
            <button type="button" onClick={() => setLocationLink("open")}>
              {linkProjectLocationLabel[localeIndex[locale]]}
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
          <dd>{project.cmmsSiteName ?? (project.site || "—")}</dd>
        </div>
        {project.cmmsSiteId && (
          <>
            <div>
              <dt>{t("القسم", "Section", "شعبہ")}</dt>
              <dd>{project.cmmsSectionName ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("الأصل", "Asset", "اثاثہ")}</dt>
              <dd>{project.cmmsAssetName ?? "—"}</dd>
            </div>
          </>
        )}
        <ProjectDirectLocationDetails project={project} locale={locale} />
        <div>
          <dt>{t("وصف المشروع", "Project description", "منصوبے کی تفصیل")}</dt>
          <dd>{project.description || "—"}</dd>
        </div>
        <div>
          <dt>{t("المتطلبات", "Requirements", "ضروریات")}</dt>
          <dd>{project.requirements || "—"}</dd>
        </div>
      </dl>
      <ProjectMaterialCosts projectId={id} locale={locale} />
      <ProjectAttachments
        id={id}
        entityType="pm_project"
        locale={locale}
        editable={editable && can("pm.edit") && can("documents.upload")}
        canView={can("documents.view")}
        uploader={attachmentUpload}
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
            void utils.materialRequisitions.directory.invalidate();
          }}
        />
      )}
      {mayLinkLocation && locationLink === "open" && (
        <LinkProjectCmmsLocation
          locale={locale}
          project={project}
          close={() => setLocationLink("closed")}
          refresh={() => void query.refetch()}
          saved={() => setLocationLink("saved")}
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
  const saveInFlight = useRef(false);
  const attachmentUpload = useProjectAttachmentUpload(locale);
  const utils = trpc.useUtils(),
    save = trpc.projectManagement.saveTask.useMutation({
      onSuccess: () => {
        void utils.gantt.detail.invalidate({ projectId });
        toast.success(t("تم حفظ المهمة", "Task saved", "کام محفوظ ہو گیا"));
        saved();
      },
      onError: e => {
        setFormError(e.message);
        toast.error(e.message);
      },
      onSettled: () => {
        saveInFlight.current = false;
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
  const taskBusy = save.isPending || attachmentUpload.running;
  const inputsDisabled = !canManage || taskBusy;
  const requestClose = () => {
    if (!saveInFlight.current && !taskBusy) close();
  };
  return (
    <Modal
      title={
        row
          ? t("تفاصيل المهمة", "Task details", "کام کی تفصیلات")
          : parent
            ? t("إضافة مهمة فرعية", "Add subtask", "ذیلی کام شامل کریں")
            : t("إضافة مهمة رئيسية", "Add main task", "مرکزی کام شامل کریں")
      }
      close={requestClose}
      closeDisabled={taskBusy}
    >
      <form
        className="pm-form"
        onSubmit={e => {
          e.preventDefault();
          if (
            inputsDisabled ||
            saveInFlight.current ||
            status.isPending ||
            !form.employeeIds.length ||
            !form.statusId
          )
            return;
          saveInFlight.current = true;
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
            disabled={inputsDisabled}
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
                disabled={inputsDisabled}
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
                  disabled={taskBusy}
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
              disabled={inputsDisabled}
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
              disabled={inputsDisabled}
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
              disabled={inputsDisabled}
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
              disabled={taskBusy}
              onChange={e => setStatusLabel(e.target.value)}
              maxLength={100}
            />
            <button
              type="button"
              disabled={
                taskBusy || status.isPending || statusLabel.trim().length < 2
              }
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
                    inputsDisabled ||
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
              className="primary pm-save-action"
              disabled={
                taskBusy ||
                status.isPending ||
                !form.employeeIds.length ||
                !form.statusId
              }
            >
              {save.isPending && (
                <LoaderCircle
                  size={16}
                  className="pm-save-spinner"
                  aria-hidden="true"
                />
              )}
              <span role="status">
                {save.isPending
                  ? t(
                      "جارٍ حفظ المهمة…",
                      "Saving task…",
                      "کام محفوظ ہو رہا ہے…"
                    )
                  : t("حفظ المهمة", "Save task", "کام محفوظ کریں")}
              </span>
            </button>
            <button type="button" disabled={taskBusy} onClick={requestClose}>
              {t("إلغاء", "Cancel", "منسوخ کریں")}
            </button>
          </div>
        )}
      </form>
      {row && (
        <>
          <TaskMaterialTrigger
            projectId={projectId}
            taskId={row.id}
            locale={locale}
          />
          <ProjectAttachments
            id={row.id}
            entityType="pm_task"
            locale={locale}
            editable={canManage && canDocumentsUpload}
            canView={canDocumentsView}
            disabled={save.isPending}
            uploader={attachmentUpload}
          />
        </>
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
  disabled = false,
  uploader,
}: {
  id: number;
  entityType: "pm_project" | "pm_task";
  locale: Locale;
  editable: boolean;
  canView: boolean;
  disabled?: boolean;
  uploader: ReturnType<typeof useProjectAttachmentUpload>;
}) {
  const t = text(locale),
    utils = trpc.useUtils(),
    target = { entityType, entityId: id },
    list = trpc.documents.list.useQuery(target, { enabled: canView }),
    [preview, setPreview] = useState<{ fileName: string; url: string } | null>(
      null
    ),
    [inputKey, setInputKey] = useState(0);
  function finishUpload(result: { uploaded: number; failed: number } | null) {
    if (!result?.uploaded) return;
    void utils.documents.list.invalidate(target);
    if (!result.failed) notifyAttachmentsUploaded(locale);
  }
  async function add(files: File[]) {
    if (!files.length || !editable || disabled || uploader.running) return;
    if (!validateFiles(files, t)) {
      setInputKey(v => v + 1);
      return;
    }
    finishUpload(await uploader.upload(target, files));
    setInputKey(v => v + 1);
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
              disabled={uploader.running}
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
        <>
          <Field
            label={t(
              "إضافة مرفقات — صور، PDF، DWG — 150 ميغابايت للملف",
              "Add attachments — images, PDF, DWG — 150 MB per file",
              "منسلکات شامل کریں — تصاویر، PDF، DWG — ہر فائل 150 MB تک"
            )}
          >
            <input
              key={inputKey}
              type="file"
              multiple
              disabled={disabled || uploader.running}
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.dwg"
              onChange={e => {
                void add(Array.from(e.target.files ?? []));
              }}
            />
          </Field>
          <ProjectAttachmentUploadStatus
            locale={locale}
            state={uploader}
            retryDisabled={disabled}
            onRetry={async fileId => {
              if (!disabled) finishUpload(await uploader.retry(fileId));
            }}
          />
        </>
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
