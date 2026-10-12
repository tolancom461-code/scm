import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { addCalendarMonths, addCalendarDays, businessDate } from "@shared/date";
import { decimal, formatDecimal } from "@shared/decimal";
import {
  percentOf,
  certificateScheduleInput,
  handoverInput,
} from "@shared/phase-one";
import { Field, type State } from "./Forms";
import { phaseText } from "./copy";
export function ContractSchedule({
  state,
  contractId,
  locale,
}: {
  state: State;
  contractId: number;
  locale: Locale;
}) {
  const stages =
    state.schedules.find(s => s.contractId === contractId)?.stages ?? [];
  return (
    <div className="p1-table-wrap p1-wide">
      <table>
        <thead>
          <tr>
            {(
              ["stage", "percent", "planned", "dueDate", "minProgress"] as const
            ).map(k => (
              <th key={k}>{phaseText(locale, k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stages.map(s => (
            <tr key={s.id}>
              <td>
                {s.position} — {s.name}
              </td>
              <td>{s.percent}%</td>
              <td>{s.amount} SAR</td>
              <td>{s.dueDate}</td>
              <td>{s.minProgress}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const financeText = (
  locale: Locale,
  ar: string,
  en: string,
  ur: string
) => (locale === "ar" ? ar : locale === "en" ? en : ur);
export function defaultInstallments(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = businessDate();
  const base = date.slice(0, 8) + "20";
  return ["30", "40", "30"].map((percent, n) => ({
    name: ["الدفعة الأولى", "الدفعة الثانية", "الدفعة الثالثة"][n],
    percent,
    dueDate: n === 0 && base < date ? date : addCalendarMonths(base, n),
  }));
}
type Plan = ReturnType<typeof defaultInstallments>;
export function InstallmentEditor({
  plan,
  set,
  net,
  locale,
}: {
  plan: Plan;
  set: (p: Plan) => void;
  net: string;
  locale: Locale;
}) {
  const t = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  let allocated = 0n;
  return (
    <div className="p1-wide">
      <h3>
        {t(
          "جدول دفعات المستخلص",
          "Certificate installments",
          "مستخلص کی اقساط"
        )}
      </h3>
      <p>
        {t(
          "مجموع النسب 100% من صافي المستخلص. التاريخ هو تاريخ الاستحقاق المتفق عليه.",
          "Percentages total 100% of certificate net. Dates are agreed due dates.",
          "فیصد کا مجموعہ خالص رقم کا 100% ہے۔ تاریخ متفقہ واجب تاریخ ہے۔"
        )}
      </p>
      {plan.map((row, n) => {
        let amount = "—";
        try {
          amount =
            n === plan.length - 1
              ? formatDecimal(decimal(net) - allocated)
              : percentOf(net, row.percent);
          allocated += decimal(amount);
        } catch {}
        return (
          <div className="p1-row" key={n}>
            <Field
              label={t("اسم الدفعة", "Installment name", "قسط کا نام")}
              value={row.name}
              set={v =>
                set(plan.map((r, i) => (i === n ? { ...r, name: v } : r)))
              }
            />
            <Field
              label={t("نسبة الدفعة", "Installment percent", "قسط فیصد")}
              type="number"
              value={row.percent}
              set={v =>
                set(plan.map((r, i) => (i === n ? { ...r, percent: v } : r)))
              }
            />
            <Field
              label={t(
                "تاريخ استحقاق الدفعة",
                "Installment due date",
                "قسط کی واجب تاریخ"
              )}
              type="date"
              value={row.dueDate}
              set={v =>
                set(plan.map((r, i) => (i === n ? { ...r, dueDate: v } : r)))
              }
            />
            <strong>{amount} SAR</strong>
            <button
              type="button"
              disabled={plan.length === 1}
              onClick={() => set(plan.filter((_, i) => i !== n))}
            >
              {t("حذف الدفعة", "Remove installment", "قسط حذف کریں")}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={plan.length >= 20}
        onClick={() =>
          set([
            ...plan,
            {
              name: t("دفعة إضافية", "Additional installment", "اضافی قسط"),
              percent: "0",
              dueDate: plan.at(-1)!.dueDate,
            },
          ])
        }
      >
        {t("إضافة دفعة", "Add installment", "قسط شامل کریں")}
      </button>
    </div>
  );
}
export function ScheduleForm({
  certificate,
  state,
  locale,
  done,
}: {
  certificate: State["certificates"][number];
  state: State;
  locale: Locale;
  done: () => void;
}) {
  const t = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  const old = state.installments.filter(
    i =>
      i.certificateId === certificate.id &&
      i.version === certificate.scheduleVersion
  );
  const [plan, setPlan] = useState<Plan>(
    old.length
      ? old.map(({ name, percent, dueDate }) => ({ name, percent, dueDate }))
      : defaultInstallments(certificate.certificateDate)
  );
  const [reason, setReason] = useState(""),
    [positions, setPositions] = useState<Record<number, number>>({});
  const preview = trpc.phaseOne.schedulePreview.useQuery(
    { id: certificate.id },
    { retry: false }
  );
  const mutation = trpc.phaseOne.configureSchedule.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        const parsed = certificateScheduleInput.safeParse({
          id: certificate.id,
          version: certificate.scheduleVersion,
          reason,
          installments: plan,
          assignments: (preview.data ?? []).map(p => ({
            paymentId: p.id,
            position:
              positions[p.id] ??
              old.find(i => i.id === p.installmentId)?.position ??
              0,
          })),
        });
        if (!parsed.success)
          return toast.error(
            t(
              "تحقق من النسب والتواريخ وتوزيع جميع السندات.",
              "Check percentages, dates and assign every voucher.",
              "فیصد، تاریخ اور تمام رسیدوں کی تقسیم جانچیں۔"
            )
          );
        mutation.mutate(parsed.data);
      }}
    >
      <p className="p1-wide">
        {certificate.number} · {certificate.net} SAR
      </p>
      <InstallmentEditor
        plan={plan}
        set={setPlan}
        net={certificate.net}
        locale={locale}
      />
      {(preview.data ?? []).map(p => (
        <label key={p.id} className="p1-wide">
          {p.voucher} · {p.paymentDate} · {p.amount} SAR
          <select
            aria-label={
              t("توزيع السند", "Voucher allocation", "رسید کی تقسیم") +
              " " +
              p.voucher
            }
            required
            value={
              positions[p.id] ??
              old.find(i => i.id === p.installmentId)?.position ??
              ""
            }
            onChange={e =>
              setPositions({ ...positions, [p.id]: Number(e.target.value) })
            }
          >
            <option value="">
              {t("اختر الدفعة", "Choose installment", "قسط منتخب کریں")}
            </option>
            {plan.map((r, i) => (
              <option value={i + 1} key={i}>
                {i + 1} — {r.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Field
        label={t(
          "سبب اعتماد الجدول",
          "Schedule approval reason",
          "شیڈول کی منظوری کی وجہ"
        )}
        type="textarea"
        value={reason}
        set={setReason}
        wide
      />
      {(mutation.error || preview.error) && (
        <p role="alert">{mutation.error?.message ?? preview.error?.message}</p>
      )}
      <button
        className="primary p1-wide"
        disabled={mutation.isPending || !preview.data || !!preview.error}
      >
        {t(
          "اعتماد جدول الدفعات",
          "Approve installment schedule",
          "اقساط کا شیڈول منظور کریں"
        )}
      </button>
    </form>
  );
}
export function HandoverForm({
  contract,
  locale,
  done,
}: {
  contract: State["contracts"][number];
  locale: Locale;
  done: () => void;
}) {
  const t = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  const [date, setDate] = useState(contract.handoverDate ?? businessDate()),
    [reason, setReason] = useState("");
  const mutation = trpc.phaseOne.acceptHandover.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        const result = handoverInput.safeParse({
          id: contract.id,
          revision: contract.revision,
          handoverDate: date,
          reason,
        });
        if (result.success) mutation.mutate(result.data);
      }}
    >
      <p className="p1-wide">{contract.number}</p>
      <Field
        label={t(
          "تاريخ التسليم النهائي",
          "Final handover date",
          "آخری حوالگی کی تاریخ"
        )}
        type="date"
        value={date}
        set={setDate}
      />
      <p>
        {t("انتهاء الضمان", "Warranty expiry", "ضمانت کی اختتامی تاریخ")}:{" "}
        {/^\d{4}-\d{2}-\d{2}$/.test(date)
          ? addCalendarDays(date, contract.warrantyDays)
          : "—"}
      </p>
      <Field
        label={t(
          "سبب اعتماد التسليم",
          "Handover approval reason",
          "حوالگی کی منظوری کی وجہ"
        )}
        type="textarea"
        value={reason}
        set={setReason}
        wide
      />
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      <button
        className="primary p1-wide"
        disabled={mutation.isPending || reason.trim().length < 3}
      >
        {t(
          "اعتماد التسليم النهائي",
          "Approve final handover",
          "آخری حوالگی منظور کریں"
        )}
      </button>
    </form>
  );
}
export function PaymentCorrection({
  payment,
  state,
  locale,
  canRecord,
  done,
  replace,
}: {
  payment: State["payments"][number];
  state: State;
  locale: Locale;
  canRecord: boolean;
  done: () => void;
  replace: () => void;
}) {
  const t = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  const [reason, setReason] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  const mutation = trpc.phaseOne.requestReversal.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  const pending = state.reversals.find(
    r => r.paymentId === payment.id && r.status === "pending"
  );
  const replacement = state.payments.find(
    p => p.replacesPaymentId === payment.id
  );
  return (
    <>
      <div className="p1-detail-list">
        <p>{payment.voucher}</p>
        <p>{payment.paymentDate}</p>
        <p>{payment.amount} SAR</p>
        <p>
          {payment.status === "reversed"
            ? t(
                "معكوس — خارج الأرصدة",
                "Reversed — excluded from balances",
                "معکوس — بقایا سے خارج"
              )
            : t("سند نشط", "Active voucher", "فعال رسید")}
        </p>
      </div>
      <p>{payment.notes}</p>
      {payment.reversalReason && (
        <p>
          {t("سبب العكس", "Reversal reason", "واپسی کی وجہ")}:{" "}
          {payment.reversalReason}
        </p>
      )}
      {payment.replacesPaymentId && (
        <p>
          {t("بديل للسجل رقم", "Replaces record", "ریکارڈ کا متبادل")}:{" "}
          {payment.replacesPaymentId}
        </p>
      )}
      {replacement && (
        <p>
          {t("السند البديل", "Replacement voucher", "متبادل رسید")}:{" "}
          {replacement.voucher} · {replacement.paymentDate} ·{" "}
          {replacement.amount} SAR
        </p>
      )}
      {pending && (
        <p>
          {t(
            "طلب العكس بانتظار الاعتماد المستقل",
            "Reversal awaits independent approval",
            "واپسی آزاد منظوری کی منتظر ہے"
          )}
        </p>
      )}
      {canRecord && payment.status === "active" && !pending && (
        <form
          className="p1-form"
          onSubmit={e => {
            e.preventDefault();
            mutation.mutate({ paymentId: payment.id, reason, key });
          }}
        >
          <p className="p1-wide">
            {t(
              "تصحيح لسجل الصرف داخل البرنامج. لا ينفذ إلغاء سند محاسبي خارجي أو حركة بنكية. يبقى الأصل محفوظًا ويستبعد من الأرصدة بعد اعتماد مستقل.",
              "Corrects this application's record; it does not cancel an external accounting voucher or execute a bank transaction. The original remains saved and is excluded after independent approval.",
              "یہ پروگرام کے ریکارڈ کی تصحیح ہے۔ بیرونی رسید یا بینک کارروائی منسوخ نہیں ہوتی۔ اصل آزاد منظوری کے بعد بقایا سے خارج ہوتا ہے۔"
            )}
          </p>
          <Field
            label={t(
              "سبب طلب العكس",
              "Reversal request reason",
              "واپسی کی درخواست کی وجہ"
            )}
            type="textarea"
            value={reason}
            set={setReason}
            wide
          />
          <button disabled={mutation.isPending || reason.trim().length < 3}>
            {t(
              "طلب عكس سجل الصرف",
              "Request record reversal",
              "ریکارڈ کی واپسی کی درخواست"
            )}
          </button>
        </form>
      )}
      {canRecord && payment.status === "reversed" && !replacement && (
        <button onClick={replace}>
          {t(
            "تسجيل سند بديل مرتبط",
            "Record linked replacement",
            "مربوط متبادل درج کریں"
          )}
        </button>
      )}
    </>
  );
}
export function ReversalReview({
  request,
  locale,
  done,
  userId,
  canApprove,
}: {
  request: State["reversals"][number];
  locale: Locale;
  done: () => void;
  userId: number;
  canApprove: boolean;
}) {
  const t = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  const [reason, setReason] = useState("");
  const mutation = trpc.phaseOne.decideReversal.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  return (
    <div className="p1-panel">
      <p>
        <strong>{request.payment.voucher}</strong> ·{" "}
        {request.payment.paymentDate} · {request.payment.amount} SAR
      </p>
      <p>
        {request.reason} · {t("الحالة", "Status", "حالت")}:{" "}
        {request.status === "pending"
          ? t("بانتظار الاعتماد", "Pending", "زیر غور")
          : request.status === "approved"
            ? t("معتمد", "Approved", "منظور")
            : t("مرفوض", "Rejected", "مسترد")}
      </p>
      {request.status === "pending" &&
        canApprove &&
        request.createdBy !== userId &&
        request.payment.createdBy !== userId && (
          <div className="p1-form">
            <Field
              label={t(
                "سبب قرار العكس",
                "Reversal decision reason",
                "واپسی کے فیصلے کی وجہ"
              )}
              value={reason}
              set={setReason}
            />
            {["approve", "reject"].map(action => (
              <button
                key={action}
                disabled={mutation.isPending || reason.trim().length < 3}
                onClick={() =>
                  mutation.mutate({
                    id: request.id,
                    action: action as "approve" | "reject",
                    reason,
                  })
                }
              >
                {action === "approve"
                  ? t(
                      "اعتماد عكس السجل",
                      "Approve reversal",
                      "واپسی منظور کریں"
                    )
                  : t("رفض عكس السجل", "Reject reversal", "واپسی مسترد کریں")}
              </button>
            ))}
          </div>
        )}
    </div>
  );
}
