import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import "./task-materials.css";

export function materialCostFormatter(locale: Locale) {
  const formatter = new Intl.NumberFormat(localeMeta[locale].formatting, {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (cents: number) => formatter.format(cents / 100);
}

export function materialCostCopy(locale: Locale) {
  const t = (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;
  return {
    projectTotal: t(
      "تكلفة المواد الفعلية",
      "Actual material costs",
      "مواد کی حقیقی لاگت"
    ),
    taskTotal: t(
      "صافي تكلفة مواد المهمة",
      "Net task material cost",
      "کام کے مواد کی خالص لاگت"
    ),
    issued: t("قيمة الصرف", "Issued cost", "جاری کردہ مواد کی لاگت"),
    returned: t("قيمة المرتجع", "Return value", "واپسی کی رقم"),
    net: t("الصافي", "Net cost", "خالص لاگت"),
    loading: t("جارٍ تحميل التكلفة…", "Loading cost…", "لاگت لوڈ ہو رہی ہے…"),
    unavailable: t("التكلفة غير متاحة", "Cost unavailable", "لاگت دستیاب نہیں"),
    incomplete: t("التكلفة غير مكتملة", "Cost incomplete", "لاگت نامکمل ہے"),
    direct: t(
      "مواد مباشرة للمشروع",
      "Direct project materials",
      "منصوبے کا براہ راست مواد"
    ),
    empty: t(
      "لا توجد تكاليف مواد مسجّلة للمشروع.",
      "No material costs recorded for the project.",
      "منصوبے کے مواد کی کوئی لاگت درج نہیں ہے۔"
    ),
  };
}

export function ProjectMaterialCosts({
  projectId,
  locale,
}: {
  projectId: number;
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = trpc.projectManagement.taskMaterialCosts.useQuery(
    { projectId },
    {
      staleTime: 30_000,
      refetchInterval: expanded ? 30_000 : 60_000,
      retry: false,
    }
  );
  const copy = materialCostCopy(locale);
  const formatCost = materialCostFormatter(locale);
  const data = query.isError ? undefined : query.data;
  const total = data?.totals
    ? formatCost(data.totals.netCents)
    : query.isLoading
      ? copy.loading
      : data
        ? copy.incomplete
        : copy.unavailable;
  const direct = data?.direct;
  const showDirect =
    data != null &&
    (direct == null || direct.issuedCents > 0 || direct.returnedCents > 0);

  return (
    <details
      className="pm-panel project-material-costs"
      onToggle={event => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open && query.isStale) void query.refetch();
      }}
    >
      <summary>
        <strong>{copy.projectTotal}</strong>
        <span>
          <bdi>{total}</bdi>
          <ChevronDown size={18} aria-hidden="true" />
        </span>
      </summary>
      {data &&
        (data.tasks.length > 0 || showDirect ? (
          <dl>
            {data.tasks.map(task => (
              <div key={task.taskId}>
                <dt>{task.taskName}</dt>
                <dd>
                  <bdi>
                    {task.totals
                      ? formatCost(task.totals.netCents)
                      : copy.incomplete}
                  </bdi>
                </dd>
              </div>
            ))}
            {showDirect && (
              <div>
                <dt>{copy.direct}</dt>
                <dd>
                  <bdi>
                    {direct ? formatCost(direct.netCents) : copy.incomplete}
                  </bdi>
                </dd>
              </div>
            )}
          </dl>
        ) : data.totals ? (
          <p>{copy.empty}</p>
        ) : null)}
    </details>
  );
}
