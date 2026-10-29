import { useState, type ReactNode, type CSSProperties } from "react";
import { trpc } from "@/lib/trpc";
import { localeMeta, type Locale } from "@/lib/i18n";
import { businessDate } from "@shared/date";
import { trimDecimal } from "@shared/display";
import { inspectionInput } from "@shared/inspections";
import type { z } from "zod";
import { toast } from "sonner";
import { LinkedDocuments } from "../documents/LinkedDocuments";
import { SystemPrintFooter } from "@/components/SystemBrand";
import type { State } from "./Forms";

const labels = {
  title: ["فحص أعمال - FIR", "Work inspection - FIR", "کام کا معائنہ - FIR"],
  add: ["إضافة فحص أعمال", "Add work inspection", "کام کا معائنہ شامل کریں"],
  number: ["رقم الفحص", "Inspection number", "معائنہ نمبر"],
  contract: [
    "رقم العقد / اسم العقد",
    "Contract number / title",
    "معاہدہ نمبر / نام",
  ],
  project: ["المشروع", "Project", "منصوبہ"],
  date: ["تاريخ الفحص", "Inspection date", "معائنے کی تاریخ"],
  location: ["موقع الأعمال", "Work location", "کام کی جگہ"],
  item: ["بند العقد", "Contract item", "معاہدے کا بند"],
  description: ["وصف الأعمال", "Work description", "کام کی تفصیل"],
  executed: ["الكمية المنفذة", "Executed quantity", "مکمل مقدار"],
  accepted: ["الكمية المقبولة", "Accepted quantity", "قبول شدہ مقدار"],
  remaining: [
    "المتاح للمستخلص",
    "Available for certificate",
    "مستخلص کے لیے دستیاب",
  ],
  status: ["حالة الفحص", "Inspection status", "معائنے کی حالت"],
  pending: ["معلق", "Pending", "زیر التوا"],
  acceptedState: ["مقبول", "Accepted", "قبول"],
  accepted_noted: [
    "مقبول مع ملاحظات",
    "Accepted with notes",
    "ملاحظات کے ساتھ قبول",
  ],
  rejected: ["مرفوض", "Rejected", "مسترد"],
  notes: ["الملاحظات", "Notes", "ملاحظات"],
  signatures: [
    "عدد التوقيعات الإضافية",
    "Additional signatures",
    "اضافی دستخط",
  ],
  signatureHint: [
    "0 = التوقيعان الأساسيان فقط. حتى 4 إضافية في الصف نفسه.",
    "0 = the two fixed signatures only. Up to 4 extra in the same row.",
    "0 = صرف دو مستقل دستخط۔ اسی قطار میں 4 تک اضافی۔",
  ],
  role: ["الصفة", "Capacity / role", "عہدہ"],
  name: ["اسم الشخص", "Person's name", "شخص کا نام"],
  representative: ["ممثل الشركة", "Company representative", "کمپنی کا نمائندہ"],
  supplier: ["المقاول / المورد", "Contractor / supplier", "ٹھیکیدار / سپلائر"],
  signature: ["التوقيع", "Signature", "دستخط"],
  attachments: [
    "صور الأعمال أو نموذج الفحص (صور أو PDF)",
    "Work photos or inspection form (images or PDF)",
    "کام کی تصاویر یا معائنہ فارم",
  ],
  save: ["حفظ الفحص", "Save inspection", "معائنہ محفوظ کریں"],
  cancel: ["إلغاء", "Cancel", "منسوخ کریں"],
  automatic: [
    "يُرقّم تلقائيًا عند الحفظ",
    "Numbered automatically on save",
    "محفوظ کرنے پر خودکار نمبر",
  ],
  edit: ["تعديل", "Edit", "ترمیم"],
  view: ["التفاصيل", "Details", "تفصیلات"],
  reinspection: ["إعادة فحص", "Reinspection", "دوبارہ معائنہ"],
  previous: ["الفحص السابق", "Previous inspection", "پچھلا معائنہ"],
  locked: [
    "هذا الفحص مرتبط بمستخلص أو إعادة فحص؛ بياناته محفوظة ولا يمكن تعديلها.",
    "This inspection is linked to a certificate or reinspection and cannot be amended.",
    "یہ معائنہ مستخلص سے منسلک ہے، ترمیم ممکن نہیں۔",
  ],
  empty: [
    "لا توجد فحوص أعمال بعد.",
    "No work inspections yet.",
    "ابھی کام کے معائنے موجود نہیں۔",
  ],
  enable: [
    "تفعيل الفحص قبل المستخلص",
    "Require inspection before certificates",
    "مستخلص سے پہلے معائنہ لازم کریں",
  ],
  enabled: [
    "الفحص مطلوب قبل المستخلص",
    "Inspection required before certificates",
    "مستخلص سے پہلے معائنہ ضروری ہے",
  ],
  needContract: [
    "أضف عقدًا جديدًا أو فعّل الفحص من تفاصيل العقد الحالي أولًا.",
    "Create a new contract or enable inspections from existing contract details first.",
    "پہلے نیا معاہدہ بنائیں یا معائنے فعال کریں۔",
  ],
  select: ["اختر", "Select", "منتخب کریں"],
  uploadFailed: [
    "حُفظ الفحص، لكن تعذر رفع المرفق. أعد رفعه من التفاصيل.",
    "Inspection saved, but upload failed. Retry from details.",
    "معائنہ محفوظ ہے، فائل تفصیلات سے دوبارہ اپ لوڈ کریں۔",
  ],
} as const;
export function inspectionText(locale: Locale, key: keyof typeof labels) {
  return labels[key][locale === "ar" ? 0 : locale === "en" ? 1 : 2];
}
export type Inspection = State["inspections"][number];
const textInput = (
  label: string,
  value: string,
  change: (v: string) => void,
  type = "text",
  readonly = false
) => (
  <label>
    {label}
    <input
      aria-label={label}
      type={type}
      value={value}
      readOnly={readonly}
      onChange={e => change(e.target.value)}
      required={!readonly}
      step={type === "number" ? "0.0001" : undefined}
    />
  </label>
);

export function InspectionForm({
  state,
  locale,
  contractId,
  inspection,
  reinspection,
  user,
  done,
  cancel,
}: {
  state: State;
  locale: Locale;
  contractId?: number;
  inspection?: Inspection;
  reinspection?: Inspection;
  user: { id: number; permissions: string[]; role: string };
  done: (id: number) => void;
  cancel: () => void;
}) {
  const t = (key: keyof typeof labels) => inspectionText(locale, key);
  const choices = state.contracts.filter(
    c => c.inspectionRequired && !c.handoverDate
  );
  const initial = inspection ?? reinspection;
  const [key] = useState(() => crypto.randomUUID());
  const [data, set] = useState<z.infer<typeof inspectionInput>>({
    contractId: initial?.contractId ?? contractId ?? choices[0]?.id ?? 0,
    itemIndex: initial?.itemIndex ?? 0,
    inspectionDate: inspection?.inspectionDate ?? businessDate(),
    location: initial?.location ?? "",
    description: initial?.description ?? "",
    executed: inspection?.executed ?? "",
    accepted: inspection?.accepted ?? "0",
    status: (inspection?.status ?? "pending") as z.infer<
      typeof inspectionInput
    >["status"],
    notes: inspection?.notes ?? "",
    additionalSignatures: initial?.additionalSignatures ?? [],
    previousInspectionId:
      inspection?.previousInspectionId ?? reinspection?.id ?? null,
  });
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false);
  const contract = choices.find(c => c.id === data.contractId),
    item = contract?.items[data.itemIndex];
  const upload = trpc.documents.upload.useMutation();
  const save = trpc.phaseOne.saveInspection.useMutation({
    onError: e => toast.error(e.message),
  });
  if (!contract) return <p>{t("needContract")}</p>;
  const signatures = [
    { role: t("representative"), name: state.company?.representative ?? "—" },
    {
      role: t("supplier"),
      name:
        state.suppliers.find(s => s.id === contract.supplierId)?.nameAr ?? "—",
    },
  ];
  return (
    <form
      className="p1-form p1-fir-form"
      dir={localeMeta[locale].direction}
      onSubmit={async e => {
        e.preventDefault();
        const parsed = inspectionInput.safeParse(data);
        if (!parsed.success) {
          toast.error(parsed.error.issues.map(i => i.message).join(" · "));
          return;
        }
        if (
          file &&
          (file.size > 6000000 ||
            (!file.type.startsWith("image/") &&
              file.type !== "application/pdf"))
        ) {
          toast.error(
            locale === "ar"
              ? "المرفق يجب أن يكون صورة أو PDF بحجم لا يتجاوز 6 MB"
              : "Use an image or PDF up to 6 MB"
          );
          return;
        }
        setBusy(true);
        try {
          const saved = await save.mutateAsync({
            data: parsed.data,
            key,
            id: inspection?.id,
            revision: inspection?.revision ?? 0,
          });
          if (file)
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              await upload.mutateAsync({
                entityType: "p1_inspection",
                entityId: saved.id,
                title: t("attachments"),
                fileName: file.name,
                mimeType: file.type,
                classification: "internal",
                base64,
              });
            } catch {
              toast.error(t("uploadFailed"));
            }
          done(saved.id);
        } catch {
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="p1-wide">{t("title")}</h3>
      <label className="p1-wide">
        {t("number")}
        <input readOnly value={inspection?.number ?? t("automatic")} />
      </label>
      <label className="p1-wide">
        {t("contract")}
        <select
          aria-label={t("contract")}
          value={data.contractId}
          disabled={Boolean(contractId || initial)}
          onChange={e => {
            const c = choices.find(c => c.id === Number(e.target.value))!;
            set({
              ...data,
              contractId: c.id,
              itemIndex: 0,
              description: c.items[0].description,
              executed: "",
              accepted: "0",
              previousInspectionId: null,
            });
          }}
        >
          {choices.map(c => (
            <option key={c.id} value={c.id}>
              {c.number} — {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className="p1-wide">
        {t("project")}
        <input
          readOnly
          value={(() => {
            const p = state.projects.find(p => p.id === contract.projectId);
            return p ? `${p.number} — ${p.name}` : "—";
          })()}
        />
      </label>
      {textInput(
        t("date"),
        data.inspectionDate,
        v => set({ ...data, inspectionDate: v }),
        "date"
      )}
      {textInput(t("location"), data.location, v =>
        set({ ...data, location: v })
      )}
      <label className="p1-wide">
        {t("item")}
        <select
          aria-label={t("item")}
          value={data.itemIndex}
          disabled={Boolean(initial)}
          onChange={e =>
            set({
              ...data,
              itemIndex: Number(e.target.value),
              description: contract.items[Number(e.target.value)].description,
            })
          }
        >
          {contract.items.map((i, n) => (
            <option key={n} value={n}>
              {n + 1} — {i.description} ({i.unit})
            </option>
          ))}
        </select>
      </label>
      <label className="p1-wide">
        {t("description")}
        <textarea
          aria-label={t("description")}
          required
          value={data.description}
          onChange={e => set({ ...data, description: e.target.value })}
        />
      </label>
      {textInput(
        `${t("executed")} (${item?.unit})`,
        data.executed,
        v => set({ ...data, executed: v }),
        "number"
      )}
      {textInput(
        `${t("accepted")} (${item?.unit})`,
        data.accepted,
        v => set({ ...data, accepted: v }),
        "number",
        ["pending", "rejected"].includes(data.status)
      )}
      <fieldset className="p1-wide p1-fir-status">
        <legend>{t("status")}</legend>
        {(["pending", "accepted", "accepted_noted", "rejected"] as const).map(
          status => (
            <label key={status}>
              <input
                type="radio"
                name="fir-status"
                checked={data.status === status}
                onChange={() =>
                  set({
                    ...data,
                    status,
                    accepted: ["pending", "rejected"].includes(status)
                      ? "0"
                      : data.accepted,
                  })
                }
              />
              {t(status === "accepted" ? "acceptedState" : status)}
            </label>
          )
        )}
      </fieldset>
      <label className="p1-wide">
        {t("notes")}
        <textarea
          aria-label={t("notes")}
          value={data.notes}
          onChange={e => set({ ...data, notes: e.target.value })}
        />
      </label>
      {user.permissions.includes("documents.upload") && (
        <label className="p1-wide">
          {t("attachments")}
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
      <label className="p1-wide">
        {t("signatures")}
        <input
          aria-label={t("signatures")}
          type="number"
          min="0"
          max="4"
          value={data.additionalSignatures.length}
          onChange={e => {
            const count = Math.max(0, Math.min(4, Number(e.target.value) || 0));
            set({
              ...data,
              additionalSignatures: Array.from(
                { length: count },
                (_, i) => data.additionalSignatures[i] ?? { role: "", name: "" }
              ),
            });
          }}
        />
        <small>{t("signatureHint")}</small>
      </label>
      <div
        className="p1-wide p1-fir-signatures"
        style={
          {
            "--signature-count": 2 + data.additionalSignatures.length,
          } as CSSProperties
        }
      >
        {signatures.map(s => (
          <div key={s.role}>
            <b>{s.role}</b>
            <p>{s.name}</p>
            <div className="p1-fir-signature-line">{t("signature")}</div>
          </div>
        ))}
        {data.additionalSignatures.map((s, i) => (
          <div key={i}>
            {textInput(t("role"), s.role, v =>
              set({
                ...data,
                additionalSignatures: data.additionalSignatures.map((s, n) =>
                  n === i ? { ...s, role: v } : s
                ),
              })
            )}
            {textInput(t("name"), s.name, v =>
              set({
                ...data,
                additionalSignatures: data.additionalSignatures.map((s, n) =>
                  n === i ? { ...s, name: v } : s
                ),
              })
            )}
            <div className="p1-fir-signature-line">{t("signature")}</div>
          </div>
        ))}
      </div>
      <div className="p1-wide p1-actions">
        <button className="primary" disabled={busy}>
          {t("save")}
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

export function InspectionView({
  state,
  row,
  locale,
  header,
  user,
}: {
  state: State;
  row: Inspection;
  locale: Locale;
  header: ReactNode;
  user: { id: number; permissions: string[]; role: string };
}) {
  const t = (key: keyof typeof labels) => inspectionText(locale, key),
    c =
      state.contracts.find(c => c.id === row.contractId) ??
      state.cancelledContracts.find(c => c.id === row.contractId)!;
  const project = state.projects.find(p => p.id === c.projectId),
    item = c.items[row.itemIndex];
  return (
    <>
      <div className="p1-print" dir={localeMeta[locale].direction}>
        {header}
        <div className="p1-detail-list">
          {[
            [t("number"), row.number],
            [t("contract"), `${c.number} — ${c.title}`],
            [t("project"), `${project?.number} — ${project?.name}`],
            [t("date"), row.inspectionDate],
            [t("location"), row.location],
            [t("item"), item.description],
            [t("executed"), `${trimDecimal(row.executed)} ${item.unit}`],
            [t("accepted"), `${trimDecimal(row.accepted)} ${item.unit}`],
            [
              t("status"),
              t(
                row.status === "accepted"
                  ? "acceptedState"
                  : (row.status as "pending" | "rejected" | "accepted_noted")
              ),
            ],
            [
              t("previous"),
              state.inspections.find(r => r.id === row.previousInspectionId)
                ?.number ?? "—",
            ],
          ].map(([label, value]) => (
            <p key={label}>
              <b>{label}</b>
              {value}
            </p>
          ))}
        </div>
        <h3>{t("description")}</h3>
        <p className="p1-pre">{row.description}</p>
        <h3>{t("notes")}</h3>
        <p className="p1-pre">{row.notes || "—"}</p>
        <div
          className="p1-fir-signatures p1-signatures"
          style={
            {
              "--signature-count": 2 + row.additionalSignatures.length,
            } as CSSProperties
          }
        >
          {[
            { role: t("representative"), name: row.representative },
            { role: t("supplier"), name: row.supplierName },
            ...row.additionalSignatures,
          ].map((s, i) => (
            <div key={i}>
              <b>{s.role}</b>
              <p>{s.name || "—"}</p>
              <div className="p1-fir-signature-line">{t("signature")}</div>
            </div>
          ))}
        </div>
        <SystemPrintFooter locale={locale} />
      </div>
      {row.locked && <p>{t("locked")}</p>}
      {row.history.length > 0 && (
        <details className="p1-panel">
          <summary>
            {locale === "ar"
              ? "سجل الفحص والتعديلات"
              : locale === "en"
                ? "Inspection history"
                : "معائنے کی تاریخ"}
          </summary>
          {row.history.map(h => (
            <p key={h.id}>
              {new Date(h.createdAt).toLocaleString(
                localeMeta[locale].formatting
              )}{" "}
              — #{h.actorId} — {t("accepted")}:{" "}
              {String(
                (h.after as { accepted?: string } | null)?.accepted ?? "—"
              )}{" "}
              — {t("notes")}:{" "}
              {String((h.after as { notes?: string } | null)?.notes || "—")}
            </p>
          ))}
        </details>
      )}
      <LinkedDocuments
        entityType="p1_inspection"
        entityId={row.id}
        locale={locale}
        user={user}
      />
    </>
  );
}

export function InspectionList({
  state,
  locale,
  contractId,
  filter = "",
  open,
}: {
  state: State;
  locale: Locale;
  contractId?: number;
  filter?: string;
  open: (id: number) => void;
}) {
  const t = (key: keyof typeof labels) => inspectionText(locale, key),
    [status, setStatus] = useState(""),
    [projectId, setProject] = useState(0);
  const rows = state.inspections.filter(r => {
    const c =
      state.contracts.find(c => c.id === r.contractId) ??
      state.cancelledContracts.find(c => c.id === r.contractId);
    return (
      (!contractId || r.contractId === contractId) &&
      (!status || r.status === status) &&
      (!projectId || c?.projectId === projectId) &&
      [
        r.number,
        c?.number,
        c?.title,
        r.location,
        state.projects.find(p => p.id === c?.projectId)?.name,
        state.suppliers.find(s => s.id === c?.supplierId)?.nameAr,
      ]
        .join(" ")
        .toLowerCase()
        .includes(filter.toLowerCase())
    );
  });
  return (
    <section className="p1-panel">
      <h3>{t("title")}</h3>
      {!contractId && (
        <div className="p1-actions">
          <select
            aria-label={t("project")}
            value={projectId}
            onChange={e => setProject(Number(e.target.value))}
          >
            <option value="0">
              {t("project")} — {t("select")}
            </option>
            {state.projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.number} — {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("status")}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="">
              {t("status")} — {t("select")}
            </option>
            {(
              ["pending", "accepted", "accepted_noted", "rejected"] as const
            ).map(s => (
              <option key={s} value={s}>
                {t(s === "accepted" ? "acceptedState" : s)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="p1-table-wrap">
        <table>
          <thead>
            <tr>
              {[
                t("number"),
                t("contract"),
                t("date"),
                t("status"),
                t("accepted"),
                t("remaining"),
                t("view"),
              ].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.number}</td>
                <td>
                  {state.contracts.find(c => c.id === r.contractId)?.number ??
                    state.cancelledContracts.find(c => c.id === r.contractId)
                      ?.number}
                </td>
                <td>{r.inspectionDate}</td>
                <td>
                  {t(
                    r.status === "accepted"
                      ? "acceptedState"
                      : (r.status as "pending" | "rejected" | "accepted_noted")
                  )}
                </td>
                <td>{trimDecimal(r.accepted)}</td>
                <td>{trimDecimal(r.remaining)}</td>
                <td>
                  <button onClick={() => open(r.id)}>{t("view")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>{t("empty")}</p>}
      </div>
    </section>
  );
}
