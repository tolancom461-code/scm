import { useState, type ReactNode } from "react";
import type { z } from "zod";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { businessDate } from "@shared/date";
import {
  decimal,
  formatDecimal,
  multiply,
  roundedDivide,
} from "@shared/decimal";
import {
  calculateSimpleCertificate,
  simpleContractInput,
  simpleCertificateInput,
  simplePaymentInput,
  contractCorrectionInput,
  totalItems,
  percentOf,
} from "@shared/phase-one";
import { phaseText, type PhaseLabel } from "./copy";
import { defaultInstallments, InstallmentEditor } from "./FinanceControls";
export type State = inferRouterOutputs<AppRouter>["phaseOne"]["state"];
export function Field({
  label,
  value,
  set,
  type = "text",
  required = true,
  wide = false,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  type?: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "p1-wide" : ""}>
      {label}
      {type === "textarea" ? (
        <textarea
          required={required}
          value={value}
          onChange={e => set(e.target.value)}
        />
      ) : (
        <input
          type={type}
          step={type === "number" ? "any" : undefined}
          min={type === "number" ? "0" : undefined}
          required={required}
          value={value}
          onChange={e => set(e.target.value)}
        />
      )}
    </label>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card p1-dialog p1-page"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={close} aria-label="Close / إغلاق">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function ContractForm({
  state,
  locale,
  done,
}: {
  state: State;
  locale: Locale;
  done: () => void;
}) {
  const p = (key: PhaseLabel) => phaseText(locale, key),
    today = businessDate();
  const [key] = useState(() => crypto.randomUUID());
  const [data, set] = useState<z.infer<typeof simpleContractInput>>({
    projectId: state.projects[0]?.id ?? 0,
    supplierId: state.suppliers.find(s => s.status === "active")?.id ?? 0,
    title: "",
    reference: "",
    contractDate: today,
    siteDate: today,
    durationDays: 1,
    warrantyMonths: 0,
    scope: "",
    terms: "",
    retentionPercent: "0",
    taxPercent: "0",
    dailyPenalty: "0",
    items: [{ description: "", quantity: "1", unit: "م²", unitPrice: "0" }],
    milestones: [
      {
        name: p("stage") + " 1",
        percent: "100",
        dueDate: today,
        minProgress: "100",
      },
    ],
  });
  const change = (field: keyof typeof data, value: unknown) =>
    set(d => ({ ...d, [field]: value }));
  const mutation = trpc.phaseOne.createContract.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  let total = "—";
  try {
    const subtotal = totalItems(data.items);
    total = formatDecimal(
      decimal(subtotal) + decimal(percentOf(subtotal, data.taxPercent))
    );
  } catch {}
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        const result = simpleContractInput.safeParse(data);
        if (!result.success) {
          toast.error(result.error.issues.map(i => i.message).join(" · "));
          return;
        }
        mutation.mutate({ data: result.data, key });
      }}
    >
      <label>
        {p("project")}
        <select
          required
          aria-label={p("project")}
          value={data.projectId || ""}
          onChange={e => change("projectId", Number(e.target.value))}
        >
          <option value="">{p("select")}</option>
          {state.projects.map(x => (
            <option key={x.id} value={x.id}>
              {x.number} — {x.name}
            </option>
          ))}
        </select>
      </label>
      <p className="p1-hint p1-wide">{p("automaticNumber")}</p>
      <label>
        {p("supplier")}
        <select
          required
          aria-label={p("supplier")}
          value={data.supplierId || ""}
          onChange={e => change("supplierId", Number(e.target.value))}
        >
          <option value="">{p("select")}</option>
          {state.suppliers
            .filter(s => s.status === "active")
            .map(x => (
              <option key={x.id} value={x.id}>
                {x.nameAr}
              </option>
            ))}
        </select>
      </label>
      {(
        [
          "title",
          "reference",
          "contractDate",
          "siteDate",
          "durationDays",
          "warrantyMonths",
          "retentionPercent",
          "taxPercent",
          "dailyPenalty",
        ] as const
      ).map(k => (
        <Field
          key={k}
          label={p(
            k === "durationDays"
              ? "duration"
              : k === "warrantyMonths"
                ? "warranty"
                : k
          )}
          value={String(data[k])}
          required={k !== "reference"}
          type={
            k.endsWith("Date")
              ? "date"
              : [
                    "durationDays",
                    "warrantyMonths",
                    "retentionPercent",
                    "taxPercent",
                    "dailyPenalty",
                  ].includes(k)
                ? "number"
                : "text"
          }
          set={v =>
            change(
              k,
              ["durationDays", "warrantyMonths"].includes(k) ? Number(v) : v
            )
          }
        />
      ))}
      <Field
        label={p("scope")}
        value={data.scope}
        set={v => change("scope", v)}
        type="textarea"
        required={false}
        wide
      />
      <Field
        label={p("terms")}
        value={data.terms}
        set={v => change("terms", v)}
        type="textarea"
        required={false}
        wide
      />
      <h3 className="p1-wide">{p("items")}</h3>
      {data.items.map((item, i) => (
        <div className="p1-row p1-wide" key={i}>
          {(["description", "quantity", "unit", "unitPrice"] as const).map(
            k => (
              <Field
                key={k}
                label={p(k === "unitPrice" ? "price" : k)}
                value={item[k]}
                type={k === "quantity" || k === "unitPrice" ? "number" : "text"}
                set={v =>
                  change(
                    "items",
                    data.items.map((x, n) => (n === i ? { ...x, [k]: v } : x))
                  )
                }
              />
            )
          )}
          <button
            type="button"
            disabled={data.items.length === 1}
            onClick={() =>
              change(
                "items",
                data.items.filter((_, n) => n !== i)
              )
            }
          >
            {p("remove")}
          </button>
        </div>
      ))}
      <div className="p1-actions p1-wide">
        <button
          type="button"
          disabled={data.items.length >= 50}
          onClick={() =>
            change("items", [
              ...data.items,
              { description: "", quantity: "1", unit: "م²", unitPrice: "0" },
            ])
          }
        >
          {p("addItem")}
        </button>
        <strong>
          {p("total")}: {total} SAR
        </strong>
      </div>
      <h3 className="p1-wide">{p("stages")}</h3>
      {data.milestones.map((m, i) => (
        <div className="p1-row p1-wide" key={i}>
          {(["name", "percent", "dueDate", "minProgress"] as const).map(k => (
            <Field
              key={k}
              label={p(k === "name" ? "stageName" : k)}
              value={m[k]}
              type={k === "dueDate" ? "date" : k === "name" ? "text" : "number"}
              set={v =>
                change(
                  "milestones",
                  data.milestones.map((x, n) =>
                    n === i ? { ...x, [k]: v } : x
                  )
                )
              }
            />
          ))}
          <button
            type="button"
            disabled={data.milestones.length === 1}
            onClick={() =>
              change(
                "milestones",
                data.milestones.filter((_, n) => n !== i)
              )
            }
          >
            {p("remove")}
          </button>
        </div>
      ))}
      <div className="p1-actions p1-wide">
        <button
          type="button"
          disabled={data.milestones.length >= 20}
          onClick={() =>
            change("milestones", [
              ...data.milestones,
              {
                name: p("stage") + " " + (data.milestones.length + 1),
                percent: "0",
                dueDate: today,
                minProgress: "100",
              },
            ])
          }
        >
          {p("addStage")}
        </button>
      </div>
      <p className="p1-hint p1-wide">{p("scheduleHint")}</p>
      <button className="primary p1-wide" disabled={mutation.isPending}>
        {p("save")}
      </button>
    </form>
  );
}
export function CertificateForm({
  state,
  contractId,
  locale,
  done,
}: {
  state: State;
  contractId: number;
  locale: Locale;
  done: () => void;
}) {
  const p = (key: PhaseLabel) => phaseText(locale, key),
    contract = state.contracts.find(c => c.id === contractId)!;
  const approved = state.certificates.filter(
      c => c.contractId === contractId && c.status === "approved"
    ),
    last = approved.at(-1);
  const [key] = useState(() => crypto.randomUUID()),
    [data, set] = useState<z.infer<typeof simpleCertificateInput>>({
      contractId,
      certificateDate: businessDate(),
      mode: "percent",
      progress: last?.progress ?? "0",
      quantities: last?.quantities ?? contract.items.map(() => "0"),
      delayDays: last?.delayDays ?? 0,
      otherDeduction: "0",
      deductionReason: "",
      notes: "",
      installments: defaultInstallments(businessDate()),
    });
  const mutation = trpc.phaseOne.createCertificate.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  let preview: ReturnType<typeof calculateSimpleCertificate> | null = null;
  try {
    const quantities =
      data.mode === "quantity"
        ? data.quantities
        : contract.items.map(i =>
            formatDecimal(
              roundedDivide(
                multiply(decimal(i.quantity), decimal(data.progress)),
                100n
              ),
              4
            )
          );
    preview = calculateSimpleCertificate({
      items: contract.items,
      quantities,
      previousQuantities: last?.quantities ?? contract.items.map(() => "0"),
      retentionPercent: contract.retentionPercent,
      taxPercent: contract.taxPercent,
      dailyPenalty: contract.dailyPenalty,
      delayDays: data.delayDays,
      previousDelayDays: last?.delayDays ?? 0,
      previousPenalty: formatDecimal(
        approved.reduce((n, c) => n + decimal(c.penalty), 0n)
      ),
      otherDeduction: data.otherDeduction,
    });
  } catch {}
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        const result = simpleCertificateInput.safeParse({
          ...data,
          installments: preview?.net === "0.00" ? undefined : data.installments,
        });
        if (!result.success || !preview) {
          toast.error(p("error"));
          return;
        }
        mutation.mutate({ data: result.data, key });
      }}
    >
      <p className="p1-wide">
        {contract.number} — {contract.title}
      </p>
      <p className="p1-hint p1-wide">{p("automaticNumber")}</p>
      <Field
        label={p("certificateDate")}
        value={data.certificateDate}
        type="date"
        set={v =>
          set({
            ...data,
            certificateDate: v,
            installments: defaultInstallments(v),
          })
        }
      />
      <label>
        {p("mode")}
        <select
          aria-label={p("mode")}
          value={data.mode}
          onChange={e =>
            set({ ...data, mode: e.target.value as typeof data.mode })
          }
        >
          <option value="percent">{p("byPercent")}</option>
          <option value="quantity">{p("byQuantity")}</option>
        </select>
      </label>
      {data.mode === "percent" ? (
        <Field
          label={p("progress")}
          value={data.progress}
          type="number"
          set={v => set({ ...data, progress: v })}
        />
      ) : (
        contract.items.map((item, i) => (
          <Field
            key={i}
            label={
              item.description +
              " — " +
              p("completed") +
              " / " +
              item.quantity +
              " " +
              item.unit
            }
            value={data.quantities[i] ?? "0"}
            type="number"
            set={v =>
              set({
                ...data,
                quantities: data.quantities.map((q, n) => (n === i ? v : q)),
              })
            }
          />
        ))
      )}
      <Field
        label={p("delayDays")}
        type="number"
        value={String(data.delayDays)}
        set={v => set({ ...data, delayDays: Number(v) })}
      />
      <Field
        label={p("otherDeduction")}
        type="number"
        value={data.otherDeduction}
        set={v => set({ ...data, otherDeduction: v })}
      />
      <Field
        label={p("deductionReason")}
        value={data.deductionReason}
        required={Number(data.otherDeduction) > 0}
        set={v => set({ ...data, deductionReason: v })}
      />
      <Field
        label={p("notes")}
        value={data.notes}
        required={false}
        wide
        type="textarea"
        set={v => set({ ...data, notes: v })}
      />
      <div className="p1-detail-list p1-panel p1-wide" aria-live="polite">
        {(
          [
            "cumulativeGross",
            "previousGross",
            "gross",
            "tax",
            "retention",
            "penalty",
            "net",
          ] as const
        ).map(k => (
          <p key={k}>
            <b>{p(k)}</b>
            {preview?.[k] ?? "—"} SAR
          </p>
        ))}
      </div>
      <button
        className="primary p1-wide"
        disabled={mutation.isPending || !preview}
      >
        {p("send")}
      </button>
      <InstallmentEditor
        plan={data.installments ?? []}
        set={installments => set({ ...data, installments })}
        net={preview?.net ?? "0"}
        locale={locale}
      />
    </form>
  );
}
export function ContractCorrectionForm({
  contract,
  action,
  locale,
  done,
}: {
  contract: State["contracts"][number];
  action: "terms" | "cancel" | "restore";
  locale: Locale;
  done: () => void;
}) {
  const p = (key: PhaseLabel) => phaseText(locale, key);
  const [terms, setTerms] = useState(contract.terms),
    [reason, setReason] = useState("");
  const mutation = trpc.phaseOne.correctContract.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        const parsed = contractCorrectionInput.safeParse({
          id: contract.id,
          revision: contract.revision,
          action,
          terms,
          reason,
        });
        if (!parsed.success) {
          toast.error(p("error"));
          return;
        }
        mutation.mutate(parsed.data);
      }}
    >
      <p className="p1-wide">
        {contract.number} — {contract.title}
      </p>
      <p className="p1-hint p1-wide">{p("correctionHint")}</p>
      {action === "terms" && (
        <Field
          label={p("terms")}
          type="textarea"
          value={terms}
          set={setTerms}
          wide
          required={false}
        />
      )}
      <Field
        label={p("reason")}
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
        {p(
          action === "terms"
            ? "correctTerms"
            : action === "cancel"
              ? "cancelContract"
              : "restoreContract"
        )}
      </button>
    </form>
  );
}
export function PaymentForm({
  state,
  contractId,
  locale,
  done,
  replacement,
}: {
  state: State;
  contractId: number;
  locale: Locale;
  done: () => void;
  replacement?: State["payments"][number];
}) {
  const p = (key: PhaseLabel) => phaseText(locale, key),
    current = state.balances.find(b => b.contractId === contractId)!;
  const first = replacement
    ? current.certificates.find(c => c.id === replacement.certificateId)
    : current.certificates.find(
        c => c.status === "approved" && Number(c.outstanding) > 0
      );
  const [key] = useState(() => crypto.randomUUID()),
    [data, set] = useState<z.infer<typeof simplePaymentInput>>({
      contractId,
      certificateId: first?.id ?? 0,
      milestoneId: current.upcoming?.id ?? null,
      installmentId: first?.nextInstallment?.id ?? null,
      replacesPaymentId: replacement?.id ?? null,
      kind: replacement?.kind === "retention" ? "retention" : "normal",
      amount: first
        ? String(
            Math.min(
              Number(first.outstanding),
              Number(
                first.nextInstallment?.readyAmount ??
                  current.upcoming?.readyAmount ??
                  0
              )
            )
          )
        : "0",
      paymentDate: replacement?.paymentDate ?? businessDate(),
      voucher: replacement?.voucher ?? "",
      notes: "",
    });
  const preview = trpc.phaseOne.paymentPreview.useQuery(
    { contractId, paymentDate: data.paymentDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(data.paymentDate), retry: false }
  );
  const balance = preview.data ?? current;
  const mutation = trpc.phaseOne.recordPayment.useMutation({
    onSuccess: done,
    onError: e => toast.error(e.message),
  });
  const eligible = balance.certificates.filter(
    c =>
      c.status === "approved" &&
      Number(data.kind === "normal" ? c.outstanding : c.releasedOutstanding) > 0
  );
  const choose = (kind: typeof data.kind, certificateId?: number) => {
    const c = balance.certificates.find(
      x =>
        x.id ===
        (certificateId ??
          balance.certificates.find(
            x =>
              x.status === "approved" &&
              Number(
                kind === "normal" ? x.outstanding : x.releasedOutstanding
              ) > 0
          )?.id)
    );
    set({
      ...data,
      kind,
      certificateId: c?.id ?? 0,
      milestoneId: kind === "normal" ? (balance.upcoming?.id ?? null) : null,
      installmentId:
        kind === "normal" ? (c?.nextInstallment?.id ?? null) : null,
      amount: c
        ? String(
            kind === "normal"
              ? Math.min(
                  Number(c.outstanding),
                  Number(
                    c.nextInstallment?.readyAmount ??
                      balance.upcoming?.readyAmount ??
                      0
                  )
                )
              : Number(c.releasedOutstanding)
          )
        : "0",
    });
  };
  return (
    <form
      className="p1-form"
      onSubmit={e => {
        e.preventDefault();
        if (!preview.data || preview.isFetching || preview.error) return;
        const parsed = simplePaymentInput.safeParse({
          ...data,
          milestoneId:
            data.kind === "normal" &&
            !balance.certificates.find(c => c.id === data.certificateId)
              ?.scheduleVersion
              ? (balance.upcoming?.id ?? null)
              : null,
          installmentId:
            data.kind === "normal"
              ? (balance.certificates.find(c => c.id === data.certificateId)
                  ?.nextInstallment?.id ?? null)
              : null,
        });
        if (!parsed.success) {
          toast.error(p("error"));
          return;
        }
        mutation.mutate({ data: parsed.data, key });
      }}
    >
      <p className="p1-hint p1-wide">{p("accountHint")}</p>
      <p className="p1-hint p1-wide">{p("paymentDateHint")}</p>
      {(preview.error || mutation.error) && (
        <p role="alert" className="p1-wide">
          {preview.error?.message ?? mutation.error?.message}
        </p>
      )}
      <label>
        {p("kind")}
        <select
          aria-label={p("kind")}
          value={data.kind}
          onChange={e => choose(e.target.value as typeof data.kind)}
        >
          <option value="normal">{p("normal")}</option>
          <option value="retention">{p("retentionPayment")}</option>
        </select>
      </label>
      <label>
        {p("certificate")}
        <select
          required
          aria-label={p("certificate")}
          value={data.certificateId || ""}
          onChange={e => choose(data.kind, Number(e.target.value))}
        >
          <option value="">{p("select")}</option>
          {eligible.map(c => (
            <option key={c.id} value={c.id}>
              {c.number} —{" "}
              {data.kind === "normal" ? c.outstanding : c.releasedOutstanding}{" "}
              SAR
            </option>
          ))}
        </select>
      </label>
      {data.kind === "normal" && (
        <p className="p1-wide">
          {p("stage")}:{" "}
          {balance.certificates.find(c => c.id === data.certificateId)
            ?.nextInstallment?.name ??
            balance.upcoming?.name ??
            "—"}{" "}
          · {p("readyAmount")}:{" "}
          {balance.certificates.find(c => c.id === data.certificateId)
            ?.nextInstallment?.readyAmount ??
            balance.upcoming?.readyAmount ??
            "0.00"}{" "}
          SAR
        </p>
      )}
      <Field
        label={p("amount")}
        value={data.amount}
        type="number"
        set={v => set({ ...data, amount: v })}
      />
      <Field
        label={p("paymentDate")}
        value={data.paymentDate}
        type="date"
        set={v => set({ ...data, paymentDate: v })}
      />
      <Field
        label={p("voucher")}
        value={data.voucher}
        set={v => set({ ...data, voucher: v })}
        wide
      />
      <Field
        label={p("notes")}
        value={data.notes}
        set={v => set({ ...data, notes: v })}
        required={false}
        wide
      />
      <button
        className="primary p1-wide"
        disabled={
          mutation.isPending ||
          preview.isFetching ||
          !preview.data ||
          !!preview.error ||
          !data.certificateId ||
          Number(data.amount) <= 0
        }
      >
        {p("save")}
      </button>
    </form>
  );
}
