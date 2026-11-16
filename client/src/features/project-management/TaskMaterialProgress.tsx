import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import {
  materialCostCopy,
  materialCostFormatter,
} from "./ProjectMaterialCosts";
import "./task-materials.css";

type Request =
  inferRouterOutputs<AppRouter>["projectManagement"]["taskMaterialProgress"]["requisitions"][number];
type Item = Request["items"][number];
type RequisitionCost =
  inferRouterOutputs<AppRouter>["projectManagement"]["taskMaterialCosts"]["requisitions"][number];
type DeliveryProgress = NonNullable<Item["progress"]>["deliveries"][number];
type MaterialTask = { projectId: number; taskId: number; locale: Locale };

function materialCopy(locale: Locale) {
  const t = (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;

  return {
    title: t(
      "طلبات احتياج المهمة",
      "Task material requests",
      "کام کے لیے مواد کی درخواستیں"
    ),
    close: t("إغلاق", "Close", "بند کریں"),
    loading: t(
      "جارٍ تحميل طلبات الاحتياج…",
      "Loading material requests…",
      "مواد کی درخواستیں لوڈ ہو رہی ہیں…"
    ),
    loadFailed: t(
      "تعذّر تحميل طلبات الاحتياج.",
      "Unable to load material requests.",
      "مواد کی درخواستیں لوڈ نہیں ہو سکیں۔"
    ),
    empty: t(
      "لا توجد طلبات احتياج معتمدة لهذه المهمة.",
      "There are no approved material requests for this task.",
      "اس کام کے لیے مواد کی کوئی منظور شدہ درخواست نہیں ہے۔"
    ),
    request: t("طلب احتياج", "Material requisition", "مواد کی درخواست"),
    requests: t("طلبات الاحتياج", "Material requisitions", "مواد کی درخواستیں"),
    materials: t("مواد المهمة", "Task materials", "کام کا سامان"),
    readyItem: t(
      "بند جاهز للصرف",
      "1 item ready to issue",
      "ایک آئٹم اجرا کے لیے تیار"
    ),
    readyItems: t(
      "بنود جاهزة للصرف",
      "Items ready to issue",
      "اجرا کے لیے تیار اشیاء"
    ),
    statuses: {
      unknown: t(
        "حالة الصرف غير متاحة",
        "Issue status unavailable",
        "اجرا کی حالت دستیاب نہیں"
      ),
      issued: t("تم الصرف للمهمة", "Issued to task", "کام کے لیے جاری ہو گیا"),
      partlyIssued: t(
        "تم صرف جزء للمهمة",
        "Partially issued to task",
        "کام کے لیے جزوی اجرا"
      ),
      ready: t("جاهزة للصرف", "Ready to issue", "اجرا کے لیے تیار"),
      received: t("وصلت للمستودع", "Received at warehouse", "گودام میں موصول"),
      awaitingReceipt: t(
        "بانتظار الاستلام",
        "Awaiting receipt",
        "وصولی کا انتظار"
      ),
      awaitingPurchase: t(
        "بانتظار طلب الشراء",
        "Awaiting purchase request",
        "خریداری کی درخواست کا انتظار"
      ),
      purchaseFailed: t(
        "تعذّر إنشاء طلب الشراء",
        "Purchase request could not be created",
        "خریداری کی درخواست نہیں بن سکی"
      ),
    },
    required: t("المطلوب", "Required", "مطلوب"),
    received: t("وصل للمستودع", "Received", "موصول"),
    ready: t("جاهز للصرف", "Ready to issue", "اجرا کے لیے تیار"),
    issued: t("المصروف", "Issued", "جاری شدہ"),
    remaining: t("متبقٍ للصرف", "Remaining to issue", "اجرا باقی"),
    deliveries: t("سندات التسليم", "Delivery documents", "حوالگی کی دستاویزات"),
    delivery: t("سند تسليم", "Delivery", "حوالگی رسید"),
    previous: t("السابق", "Previous", "پچھلا"),
    next: t("التالي", "Next", "اگلا"),
  };
}

type Copy = ReturnType<typeof materialCopy>;

function itemStatus(request: Request, item: Item): keyof Copy["statuses"] {
  if (!request.purchaseNumber)
    return request.externalStatus === "send_failed" ||
      request.externalStatus === "rejected"
      ? "purchaseFailed"
      : "awaitingPurchase";
  const progress = item.progress;
  if (!progress) return "unknown";
  if (progress.issuedQuantity >= item.requestedQuantity) return "issued";
  if (progress.issuedQuantity > 0) return "partlyIssued";
  if (progress.readyQuantity > 0) return "ready";
  if (progress.receivedQuantity > 0) return "received";
  return "awaitingReceipt";
}

function RequisitionDetails({
  request,
  requisitionCost,
  costsLoading,
  locale,
  copy,
  format,
}: {
  request: Request;
  requisitionCost: RequisitionCost | undefined;
  costsLoading: boolean;
  locale: Locale;
  copy: Copy;
  format: Intl.NumberFormat;
}) {
  const costCopy = materialCostCopy(locale);
  const formatCost = materialCostFormatter(locale);
  const items = request.items.map(item => ({
    item,
    status: itemStatus(request, item),
    hasReadyQuantity: (item.progress?.readyQuantity ?? 0) > 0,
  }));
  const counts = new Map<keyof Copy["statuses"], number>();
  for (const { status, hasReadyQuantity } of items) {
    const summaryStatus = hasReadyQuantity ? "ready" : status;
    counts.set(summaryStatus, (counts.get(summaryStatus) ?? 0) + 1);
  }
  return (
    <details className="task-material-request">
      <summary>
        <span className="task-material-reference">
          <bdi>{request.number}</bdi>
          {request.purchaseNumber && <bdi>{request.purchaseNumber}</bdi>}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
        <span className="task-material-summary">
          {[...counts].map(([status, count]) => (
            <span
              key={status}
              className={status === "ready" ? "task-material-ready" : undefined}
            >
              {copy.statuses[status]} ({format.format(count)})
            </span>
          ))}
        </span>
      </summary>
      <div className="task-material-items">
        {items.map(({ item, status, hasReadyQuantity }) => {
          const progress = item.progress;
          const quantity = (value: number) =>
            `${format.format(value)} ${item.unit[locale]}`;
          const deliveries = new Map<
            string,
            {
              progress?: DeliveryProgress;
              cost?: RequisitionCost["deliveries"][number];
            }
          >();
          for (const delivery of progress?.deliveries ?? []) {
            deliveries.set(delivery.number, { progress: delivery });
          }
          for (const delivery of requisitionCost?.deliveries ?? []) {
            const existing = deliveries.get(delivery.number);
            if (
              delivery.sequence === item.sequence ||
              (delivery.sequence === null && existing)
            ) {
              deliveries.set(delivery.number, { ...existing, cost: delivery });
            }
          }
          return (
            <div key={item.sequence} className="task-material-item">
              <div className="task-material-item-heading">
                <strong>{item.name}</strong>
                <span className="task-material-item-status">
                  <span
                    className={
                      status === "ready" ? "task-material-ready" : undefined
                    }
                  >
                    {copy.statuses[status]}
                  </span>
                  {status === "partlyIssued" && hasReadyQuantity && (
                    <span className="task-material-ready">
                      {copy.statuses.ready}
                    </span>
                  )}
                </span>
              </div>
              <dl>
                <div>
                  <dt>{copy.required}</dt>
                  <dd>{quantity(item.requestedQuantity)}</dd>
                </div>
                {progress && (
                  <>
                    <div>
                      <dt>{copy.received}</dt>
                      <dd>{quantity(progress.receivedQuantity)}</dd>
                    </div>
                    <div>
                      <dt>{copy.ready}</dt>
                      <dd>{quantity(progress.readyQuantity)}</dd>
                    </div>
                    <div>
                      <dt>{copy.issued}</dt>
                      <dd>{quantity(progress.issuedQuantity)}</dd>
                    </div>
                    <div>
                      <dt>{copy.remaining}</dt>
                      <dd>
                        {quantity(
                          Math.max(
                            0,
                            item.requestedQuantity - progress.issuedQuantity
                          )
                        )}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {deliveries.size > 0 && (
                <ul aria-label={copy.deliveries}>
                  {[...deliveries].map(([number, delivery]) => (
                    <li key={number} className="task-material-delivery">
                      <span>
                        {copy.delivery} <bdi>{number}</bdi>
                        {delivery.progress && (
                          <> · {quantity(delivery.progress.quantity)}</>
                        )}
                        {delivery.progress?.recipientName && (
                          <> · {delivery.progress.recipientName}</>
                        )}
                      </span>
                      {delivery.cost ? (
                        <dl className="task-material-delivery-cost">
                          <div>
                            <dt>{costCopy.issued}</dt>
                            <dd>
                              <bdi>{formatCost(delivery.cost.issuedCents)}</bdi>
                            </dd>
                          </div>
                          {delivery.cost.returnedCents > 0 && (
                            <>
                              <div>
                                <dt>{costCopy.returned}</dt>
                                <dd>
                                  <bdi>
                                    {formatCost(delivery.cost.returnedCents)}
                                  </bdi>
                                </dd>
                              </div>
                              <div>
                                <dt>{costCopy.net}</dt>
                                <dd>
                                  <bdi>
                                    {formatCost(delivery.cost.netCents)}
                                  </bdi>
                                </dd>
                              </div>
                            </>
                          )}
                        </dl>
                      ) : (
                        !costsLoading && (
                          <small className="task-material-cost-unavailable">
                            {costCopy.unavailable}
                          </small>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function TaskMaterialProgress({
  projectId,
  taskId,
  locale,
}: MaterialTask) {
  const copy = materialCopy(locale);
  const format = new Intl.NumberFormat(localeMeta[locale].formatting, {
    maximumFractionDigits: 9,
  });
  const [pages, setPages] = useState<number[]>([]);
  const beforeId = pages[pages.length - 1];
  const query = trpc.projectManagement.taskMaterialProgress.useQuery(
    { projectId, taskId, beforeId },
    { refetchInterval: 30_000, retry: false }
  );
  const costsQuery = trpc.projectManagement.taskMaterialCosts.useQuery(
    { projectId, taskId },
    { refetchInterval: 30_000, retry: false }
  );
  const costs = costsQuery.isError ? undefined : costsQuery.data;
  const costsByRequisition = new Map(
    costs?.requisitions.map(item => [item.requisitionId, item])
  );
  const costCopy = materialCostCopy(locale);
  const total = costs?.totals;
  const totalLabel = total
    ? materialCostFormatter(locale)(total.netCents)
    : costsQuery.isLoading
      ? costCopy.loading
      : costs
        ? costCopy.incomplete
        : costCopy.unavailable;
  const nextBeforeId = query.data?.nextBeforeId;

  return (
    <div className="task-material-list">
      {query.isLoading && <p role="status">{copy.loading}</p>}
      {query.isError && <p role="alert">{copy.loadFailed}</p>}
      {query.data?.requisitions.length === 0 && <p>{copy.empty}</p>}
      {query.data?.requisitions.map(request => (
        <RequisitionDetails
          key={request.id}
          request={request}
          requisitionCost={costsByRequisition.get(request.id)}
          costsLoading={costsQuery.isLoading}
          locale={locale}
          copy={copy}
          format={format}
        />
      ))}
      {(pages.length > 0 || nextBeforeId != null) && (
        <div className="task-material-pagination">
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => setPages(current => current.slice(0, -1))}
            >
              {copy.previous}
            </button>
          )}
          {nextBeforeId != null && (
            <button
              type="button"
              onClick={() => setPages(current => [...current, nextBeforeId])}
            >
              {copy.next}
            </button>
          )}
        </div>
      )}
      <footer className="task-material-cost-total">
        <strong>{costCopy.taskTotal}</strong>
        <bdi>{totalLabel}</bdi>
      </footer>
    </div>
  );
}

export function TaskMaterialPanel({
  close,
  ...task
}: MaterialTask & { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const copy = materialCopy(task.locale);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="task-material-panel"
      aria-labelledby={titleId}
      dir={localeMeta[task.locale].direction}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="task-material-panel-header">
        <h2 id={titleId}>{copy.title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={copy.close}
          onClick={close}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <TaskMaterialProgress
        key={`${task.projectId}:${task.taskId}`}
        {...task}
      />
    </dialog>
  );
}

export function TaskMaterialTrigger(task: MaterialTask) {
  const [open, setOpen] = useState(false);
  const { data, isError } = trpc.projectManagement.taskMaterialSummary.useQuery(
    { projectId: task.projectId, taskId: task.taskId },
    { refetchInterval: 30_000, retry: false }
  );
  const summary = data?.items.find(item => item.taskId === task.taskId);
  const copy = materialCopy(task.locale);
  const ready = Boolean(summary?.readyItemCount);
  const count =
    (ready ? summary?.readyItemCount : summary?.requisitionCount) ?? 0;
  const format = new Intl.NumberFormat(localeMeta[task.locale].formatting);
  const label =
    count === 1
      ? ready
        ? copy.readyItem
        : copy.request
      : `${ready ? copy.readyItems : copy.requests} (${format.format(count)})`;
  return (
    <>
      {(count > 0 || isError) && (
        <div className="task-material-entry">
          <button
            className={`task-material-trigger${ready ? " task-material-ready" : ""}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {count > 0 ? label : copy.materials}
          </button>
        </div>
      )}
      {open && <TaskMaterialPanel {...task} close={() => setOpen(false)} />}
    </>
  );
}
