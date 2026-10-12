import { trpc } from "@/lib/trpc";
import { chrome, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { CheckCircle2, FileText, Plus, Search, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
const technicalLabels: Record<string, Parameters<typeof chrome>[1]> = {
  ACTION: "action",
  "BUDGET//CODE": "budgetCode",
  "BUDGET//LIMIT": "budgetLimit",
  "CLOSING//AT": "closingAt",
  "RFQ//ID": "rfqId",
  "QUOTATION//ID": "quotationId",
  "AWARD//RATIONALE": "awardRationale",
  VERSION: "version",
  "ENTITY//ID": "entityId",
  "DELIVERED / REMAINING": "deliveredRemaining",
  "DELIVERY//LOCATION": "deliveryLocation",
  TERMS: "terms",
  "PO//ID": "poId",
  "DELIVERED//VALUE": "delivered",
  "ACCEPTED//VALUE": "accepted",
  "REJECTED//VALUE": "rejectedValue",
  "CURRENT//VALUE": "currentValue",
  "PREVIOUS//VALUE": "previousValue",
  "EXTENSION//DAYS": "extensionDays",
  "AMENDMENT//REASON": "amendmentReason",
  RANK: "rank",
  "DELIVERY//DAYS": "deliveryDays",
  "TECHNICAL//COMPLIANCE": "technicalCompliance",
  "ACTOR//ID": "actorId",
  COMMENT: "comment",
  TIMESTAMP: "timestamp",
};
const contractTechnicalText: Record<string, Record<Locale, string>> = {
  "VALUE//CHANGE": {
    ar: "تغير القيمة",
    en: "Value change",
    ur: "مالیت کی تبدیلی",
  },
  DEDUCTIONS: { ar: "الخصومات", en: "Deductions", ur: "کٹوتیاں" },
  "CERTIFICATE//ID": {
    ar: "معرف المستخلص",
    en: "Certificate ID",
    ur: "سرٹیفکیٹ شناخت",
  },
  "AMENDMENT//ID": {
    ar: "معرف التعديل",
    en: "Amendment ID",
    ur: "ترمیم شناخت",
  },
  "NET//DUE": { ar: "الصافي المستحق", en: "Net due", ur: "خالص واجب" },
};
const operationalValueText: Record<string, Record<Locale, string>> = {
  draft: { ar: "مسودة", en: "Draft", ur: "مسودہ" },
  pending: { ar: "قيد الانتظار", en: "Pending", ur: "زیر التواء" },
  submitted: { ar: "مُرسل", en: "Submitted", ur: "جمع شدہ" },
  approved: { ar: "معتمد", en: "Approved", ur: "منظور" },
  rejected: { ar: "مرفوض", en: "Rejected", ur: "مسترد" },
  active: { ar: "نشط", en: "Active", ur: "فعال" },
  recorded: { ar: "مسجل", en: "Recorded", ur: "درج" },
  compliant: { ar: "مطابق", en: "Compliant", ur: "مطابق" },
  supply: { ar: "توريد", en: "Supply", ur: "سپلائی" },
  payment: { ar: "دفعة", en: "Payment", ur: "ادائیگی" },
};
export function pageLocale() {
  return (
    document.documentElement.lang === "en"
      ? "en"
      : document.documentElement.lang === "ur"
        ? "ur"
        : "ar"
  ) as Locale;
}
export function localizeTechnical(value: string, locale = pageLocale()) {
  const key = technicalLabels[value];
  if (key) return chrome(locale, key);
  if (contractTechnicalText[value]) return contractTechnicalText[value][locale];
  if (operationalValueText[value]) return operationalValueText[value][locale];
  const reference = value.match(/^(SUPPLIER|RFQ|QUOTE)\s#(.+)$/);
  if (reference) {
    const referenceKey =
      reference[1] === "SUPPLIER"
        ? "supplierReference"
        : reference[1] === "RFQ"
          ? "rfqReference"
          : "quotationReference";
    return `${chrome(locale, referenceKey)} #${reference[2]}`;
  }
  return value;
}

export function Input({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {localizeTechnical(label)}
        {required ? <i> *</i> : null}
      </span>
      {children}
    </label>
  );
}

export function PageFrame({
  locale,
  title,
  action,
  actionLabel,
  children,
}: {
  locale: Locale;
  title: TranslationKey;
  action?: () => void;
  actionLabel?: TranslationKey;
  children: React.ReactNode;
}) {
  const t9 = (key: TranslationKey) => t(locale, key);
  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="eyebrow">
            {chrome(locale, "module")} // {t9(title)}
          </p>
          <h1>{t9(title)}</h1>
        </div>
        {action && actionLabel ? (
          <button className="neo-button" onClick={action}>
            <Plus size={16} />
            {t9(actionLabel)}
          </button>
        ) : null}
      </section>
      {children}
    </div>
  );
}
export function Table({
  headers,
  rows,
  empty,
}: {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  const locale = pageLocale();
  return (
    <section className="data-panel">
      <div className="table-tools">
        <div className="search-shell">
          <Search size={15} />
          <input placeholder={chrome(locale, "search")} />
        </div>
        <span>
          {rows.length.toString().padStart(2, "0")} {chrome(locale, "records")}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>
                  {typeof header === "string"
                    ? localizeTechnical(header, locale)
                    : header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      {typeof cell === "string"
                        ? localizeTechnical(cell, locale)
                        : cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>
                  <div className="empty-state">
                    <FileText size={26} />
                    {empty}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function Status({ value }: { value: string }) {
  const locale = pageLocale();
  return (
    <span className={`status ${value.replace(/_/g, "-")}`}>
      <i />
      {operationalValueText[value]?.[locale] ?? value.replace(/_/g, " ")}
    </span>
  );
}
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const locale = pageLocale();
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={e => e.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">
              {eyebrow ?? chrome(locale, "createRecord")}
            </p>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t(locale, "close")}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function FormFooter({
  t9,
  pending,
}: {
  t9: (key: TranslationKey) => string;
  pending: boolean;
}) {
  return (
    <div className="form-footer">
      <button className="neo-button" disabled={pending}>
        {pending ? chrome(pageLocale(), "syncingShort") : t9("create")}
        <CheckCircle2 size={16} />
      </button>
    </div>
  );
}
export function RequestAction({
  item,
  t9,
  onAction,
}: {
  item: { id: number; status: string };
  t9: (key: TranslationKey) => string;
  onAction: (
    to: "draft" | "submitted" | "approved" | "rejected" | "cancelled"
  ) => void;
}) {
  const history = <RequestHistoryButton requestId={item.id} t9={t9} />;
  const documents = (
    <EntityDocumentsButton
      entityType="purchase_request"
      entityId={item.id}
      t9={t9}
    />
  );
  if (item.status === "draft")
    return (
      <div className="action-group">
        <button className="table-action" onClick={() => onAction("submitted")}>
          {t9("submit")}
        </button>
        {history}
        {documents}
      </div>
    );
  if (item.status === "submitted")
    return (
      <div className="action-group">
        <button
          className="table-action accept"
          onClick={() => onAction("approved")}
        >
          {t9("approve")}
        </button>
        <button
          className="table-action reject"
          onClick={() => onAction("rejected")}
        >
          {t9("reject")}
        </button>
        {history}
        {documents}
      </div>
    );
  if (item.status === "rejected")
    return (
      <div className="action-group">
        <button className="table-action" onClick={() => onAction("draft")}>
          {t9("revise")}
        </button>
        {history}
        {documents}
      </div>
    );
  return (
    <div className="action-group">
      {history}
      {documents}
    </div>
  );
}
export function RequestHistoryButton({
  requestId,
  t9,
}: {
  requestId: number;
  t9: (key: TranslationKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const history = trpc.purchaseRequests.history.useQuery(
    { requestId },
    { enabled: open }
  );
  return (
    <>
      {!open ? (
        <button className="table-action" onClick={() => setOpen(true)}>
          LOG
        </button>
      ) : (
        <Modal title={t9("approvals")} onClose={() => setOpen(false)}>
          <Table
            headers={["ACTION", "ACTOR//ID", "COMMENT", "TIMESTAMP"]}
            rows={(history.data ?? []).map(item => [
              item.action,
              `#${item.actedBy}`,
              item.comment ?? "—",
              new Date(item.createdAt).toLocaleString(),
            ])}
            empty={t9("noData")}
          />
        </Modal>
      )}
    </>
  );
}
export function EntityDocumentsButton({
  entityType,
  entityId,
  t9,
}: {
  entityType: string;
  entityId: number;
  t9: (key: TranslationKey) => string;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const documents = trpc.documents.list.useQuery(
    { entityType, entityId },
    { enabled: open }
  );
  const upload = trpc.documents.upload.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate({ entityType, entityId });
      toast.success(t9("actionDone"));
    },
  });
  const attach = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error(t9("required"));
    if (file.size > 6_000_000) return toast.error(t9("fileMax"));
    upload.mutate({
      entityType,
      entityId,
      title: file.name,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      classification: "internal",
      base64: await fileToBase64(file),
    });
  };
  return (
    <>
      {!open ? (
        <button className="table-action" onClick={() => setOpen(true)}>
          DOCS
        </button>
      ) : (
        <Modal title={t9("documents")} onClose={() => setOpen(false)}>
          <div className="context-upload">
            <input ref={fileRef} type="file" />
            <button
              className="neo-button"
              onClick={() => void attach()}
              disabled={upload.isPending}
            >
              {t9("uploadDocument")}
              <Upload size={15} />
            </button>
          </div>
          <Table
            headers={[t9("title"), "VERSION", t9("classification")]}
            rows={(documents.data ?? []).map(item => [
              <a
                key={item.id}
                className="file-link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.title}
              </a>,
              `V${item.version}`,
              <Status key={`${item.id}-class`} value={item.classification} />,
            ])}
            empty={t9("noData")}
          />
        </Modal>
      )}
    </>
  );
}
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
