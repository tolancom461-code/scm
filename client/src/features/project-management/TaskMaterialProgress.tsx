import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { localeMeta, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type Request =
  inferRouterOutputs<AppRouter>["projectManagement"]["taskMaterialProgress"]["requisitions"][number];
type Item = Request["items"][number];

function itemStatus(item: Item) {
  const progress = item.progress;
  if (!progress) return "unknown";
  if (progress.issuedQuantity >= item.requestedQuantity) return "issued";
  if (progress.issuedQuantity > 0) return "partlyIssued";
  if (progress.readyQuantity > 0) return "ready";
  if (progress.receivedQuantity > 0) return "received";
  return "awaitingReceipt";
}

export function TaskMaterialProgress({
  projectId,
  taskId,
  locale,
}: {
  projectId: number;
  taskId: number;
  locale: Locale;
}) {
  const t = (ar: string, en: string, ur: string) =>
    locale === "ar" ? ar : locale === "en" ? en : ur;
  const [pages, setPages] = useState<number[]>([]);
  const beforeId = pages[pages.length - 1];
  const query = trpc.projectManagement.taskMaterialProgress.useQuery(
    { projectId, taskId, beforeId },
    {
      refetchInterval: 30_000,
      retry: false,
    }
  );
  const nextBeforeId = query.data?.nextBeforeId;
  const labels = {
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
  };
  const quantityFormat = new Intl.NumberFormat(localeMeta[locale].formatting, {
    maximumFractionDigits: 9,
  });
  const quantity = (value: number, unit: string) =>
    `${quantityFormat.format(value)} ${unit}`;

  if (query.data?.requisitions.length === 0 && pages.length === 0) return null;

  return (
    <section className="pm-panel pm-material-progress">
      <h3>{t("مواد المهمة", "Task materials", "کام کا سامان")}</h3>
      {query.isLoading && (
        <p role="status">
          {t(
            "جارٍ تحميل حالة المواد…",
            "Loading material progress…",
            "سامان کی حالت لوڈ ہو رہی ہے…"
          )}
        </p>
      )}
      {query.isError && (
        <p role="alert">
          {t(
            "تعذّر تحميل حالة مواد المهمة.",
            "Unable to load task material progress.",
            "کام کے سامان کی حالت لوڈ نہیں ہو سکی۔"
          )}
        </p>
      )}
      {query.data?.requisitions.map(request => (
        <article key={request.id}>
          <h4>
            <bdi>{request.number}</bdi>
            {request.purchaseNumber && (
              <>
                {" "}
                · <bdi>{request.purchaseNumber}</bdi>
              </>
            )}
          </h4>
          {request.items.map(item => {
            const progress = item.progress;
            const unit = item.unit[locale];
            const status = request.purchaseNumber
              ? labels[itemStatus(item)]
              : request.externalStatus === "send_failed"
                ? t(
                    "تعذّر إنشاء طلب الشراء",
                    "Purchase request could not be created",
                    "خریداری کی درخواست نہیں بن سکی"
                  )
                : t(
                    "بانتظار طلب الشراء",
                    "Awaiting purchase request",
                    "خریداری کی درخواست کا انتظار"
                  );
            return (
              <div className="pm-material-progress-item" key={item.sequence}>
                <strong>{item.name}</strong>
                <span className="pm-help">{status}</span>
                <dl>
                  <div>
                    <dt>{t("المطلوب", "Required", "مطلوب")}</dt>
                    <dd>{quantity(item.requestedQuantity, unit)}</dd>
                  </div>
                  {progress && (
                    <>
                      <div>
                        <dt>{t("وصل للمستودع", "Received", "موصول")}</dt>
                        <dd>{quantity(progress.receivedQuantity, unit)}</dd>
                      </div>
                      <div>
                        <dt>
                          {t(
                            "جاهز للصرف",
                            "Ready to issue",
                            "اجرا کے لیے تیار"
                          )}
                        </dt>
                        <dd>{quantity(progress.readyQuantity, unit)}</dd>
                      </div>
                      <div>
                        <dt>{t("المصروف", "Issued", "جاری شدہ")}</dt>
                        <dd>{quantity(progress.issuedQuantity, unit)}</dd>
                      </div>
                      <div>
                        <dt>
                          {t("متبقٍ للصرف", "Remaining to issue", "اجرا باقی")}
                        </dt>
                        <dd>
                          {quantity(
                            Math.max(
                              0,
                              item.requestedQuantity - progress.issuedQuantity
                            ),
                            unit
                          )}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                {progress && progress.deliveries.length > 0 && (
                  <ul
                    aria-label={t(
                      "سندات التسليم",
                      "Delivery documents",
                      "حوالگی کی دستاویزات"
                    )}
                  >
                    {progress.deliveries.map(delivery => (
                      <li key={delivery.number}>
                        {t("سند تسليم", "Delivery", "حوالگی رسید")}{" "}
                        <bdi>{delivery.number}</bdi>
                        {" · "}
                        {quantity(delivery.quantity, unit)}
                        {delivery.recipientName && (
                          <> · {delivery.recipientName}</>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </article>
      ))}
      {(pages.length > 0 || nextBeforeId != null) && (
        <div className="pm-actions">
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => setPages(current => current.slice(0, -1))}
            >
              {t("السابق", "Previous", "پچھلا")}
            </button>
          )}
          {nextBeforeId != null && (
            <button
              type="button"
              onClick={() => setPages(current => [...current, nextBeforeId])}
            >
              {t("التالي", "Next", "اگلا")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
