import { useState } from "react";
import { businessDate } from "@shared/date";
import type { z } from "zod";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import {
  invoiceInput,
  scheduleInput,
  paymentInput,
  certificateInput,
  creditInput,
} from "@shared/finance";
import { Dialog, Input } from "../operations/ui";
import { opText } from "../operations/copy";
import { SourcePicker } from "../procurement/SourcePicker";
type Props = { locale: Locale; onClose: () => void; initialOrder?: number };
const today = businessDate;
export function InvoiceForm({ locale, onClose, initialOrder = 0 }: Props) {
  const [data, setData] = useState<z.infer<typeof invoiceInput>>({
      orderId: initialOrder,
      supplierReference: "",
      invoiceDate: today(),
      dueDate: today(),
      retentionPercent: "0",
      lines: [],
    }),
    [key] = useState(() => crypto.randomUUID());
  const plan = trpc.finance.orderSummary.useQuery(
      { id: data.orderId || 1 },
      { enabled: !!data.orderId }
    ),
    utils = trpc.useUtils();
  const save = trpc.finance.createInvoice.useMutation({
    onSuccess: () => {
      void utils.finance.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="invoice" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = invoiceInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          <SourcePicker
            kind="orders"
            status="approved"
            label="order"
            value={data.orderId}
            onChange={orderId => setData({ ...data, orderId, lines: [] })}
            locale={locale}
          />
          {(
            [
              "supplierReference",
              "invoiceDate",
              "dueDate",
              "retentionPercent",
            ] as const
          ).map(k => (
            <Input
              key={k}
              label={k === "dueDate" ? "paymentDue" : k}
              type={k.endsWith("Date") ? "date" : "text"}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        {plan.isError && <p role="alert">{opText(locale, "error")}</p>}
        {plan.data?.lines.map(({ line, eligibleQuantity }) => {
          const selected = data.lines.find(l => l.orderLineId === line.id);
          return (
            <section className="op-step" key={line.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={e =>
                    setData({
                      ...data,
                      lines: e.target.checked
                        ? [
                            ...data.lines,
                            {
                              orderLineId: line.id,
                              quantity:
                                eligibleQuantity.startsWith("-") ||
                                eligibleQuantity === "0.000000"
                                  ? line.quantity
                                  : eligibleQuantity,
                              unitPrice: line.unitPrice,
                              discountPercent: line.discountPercent,
                              taxPercent: line.taxPercent,
                            },
                          ]
                        : data.lines.filter(l => l.orderLineId !== line.id),
                    })
                  }
                />
                {line.description} — {opText(locale, "eligibleQuantity")}:{" "}
                {eligibleQuantity}
              </label>
              {selected && (
                <div className="op-fields">
                  {(
                    [
                      "quantity",
                      "unitPrice",
                      "discountPercent",
                      "taxPercent",
                    ] as const
                  ).map(k => (
                    <Input
                      key={k}
                      label={k}
                      value={selected[k]}
                      onChange={v =>
                        setData({
                          ...data,
                          lines: data.lines.map(l =>
                            l.orderLineId === line.id ? { ...l, [k]: v } : l
                          ),
                        })
                      }
                      locale={locale}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
export function ScheduleForm({ locale, onClose, initialOrder = 0 }: Props) {
  const [data, setData] = useState<z.infer<typeof scheduleInput>>({
      orderId: initialOrder,
      milestones: [
        {
          nameAr: "دفعة أولى",
          nameEn: "First payment",
          nameUr: "پہلی ادائیگی",
          percent: "30",
          dueDate: today(),
          condition: "manual",
        },
        {
          nameAr: "دفعة الاستلام",
          nameEn: "Receipt payment",
          nameUr: "وصولی ادائیگی",
          percent: "40",
          dueDate: today(),
          condition: "accepted",
        },
        {
          nameAr: "دفعة نهائية",
          nameEn: "Final payment",
          nameUr: "آخری ادائیگی",
          percent: "30",
          dueDate: today(),
          condition: "manual",
        },
      ],
    }),
    [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils(),
    save = trpc.finance.createSchedule.useMutation({
      onSuccess: () => {
        void utils.finance.invalidate();
        onClose();
      },
      onError: e => toast.error(e.message),
    });
  return (
    <Dialog title="paymentSchedule" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const p = scheduleInput.safeParse(data);
          if (!p.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: p.data, key });
        }}
      >
        <SourcePicker
          kind="orders"
          status="approved"
          value={data.orderId}
          label="order"
          onChange={orderId => setData({ ...data, orderId })}
          locale={locale}
        />
        {data.milestones.map((m, index) => (
          <section className="op-step" key={index}>
            <div className="op-fields">
              <Input
                label="description"
                value={
                  locale === "ar"
                    ? m.nameAr
                    : locale === "ur"
                      ? m.nameUr
                      : m.nameEn
                }
                onChange={v =>
                  setData({
                    ...data,
                    milestones: data.milestones.map((x, i) =>
                      i === index
                        ? { ...x, nameAr: v, nameEn: v, nameUr: v }
                        : x
                    ),
                  })
                }
                locale={locale}
              />
              {(["percent", "dueDate"] as const).map(k => (
                <Input
                  key={k}
                  label={k === "dueDate" ? "paymentDue" : k}
                  type={k === "dueDate" ? "date" : "text"}
                  value={m[k]}
                  onChange={v =>
                    setData({
                      ...data,
                      milestones: data.milestones.map((x, i) =>
                        i === index ? { ...x, [k]: v } : x
                      ),
                    })
                  }
                  locale={locale}
                />
              ))}
              <label>
                {opText(locale, "condition")}
                <select
                  value={m.condition}
                  onChange={e =>
                    setData({
                      ...data,
                      milestones: data.milestones.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              condition: e.target.value as typeof m.condition,
                            }
                          : x
                      ),
                    })
                  }
                >
                  {(
                    [
                      "advance",
                      "accepted",
                      "manual",
                      "planting",
                      "warranty",
                    ] as const
                  ).map(k => (
                    <option key={k} value={k}>
                      {opText(locale, k)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  milestones: data.milestones.filter((_, i) => i !== index),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </section>
        ))}
        <div className="op-actions">
          <button
            type="button"
            onClick={() =>
              setData({
                ...data,
                milestones: [
                  ...data.milestones,
                  {
                    nameAr: "",
                    nameEn: "",
                    nameUr: "",
                    percent: "0",
                    dueDate: today(),
                    condition: "manual",
                  },
                ],
              })
            }
          >
            {opText(locale, "addLine")}
          </button>
          <button disabled={save.isPending}>{opText(locale, "save")}</button>
        </div>
      </form>
    </Dialog>
  );
}
export function PaymentForm({ locale, onClose, initialOrder = 0 }: Props) {
  const [data, setData] = useState<z.infer<typeof paymentInput>>({
      orderId: initialOrder,
      invoiceId: null,
      milestoneId: null,
      sourceAdvanceId: null,
      kind: "invoice",
      amount: "",
      reference: "",
      reason: "",
    }),
    [key] = useState(() => crypto.randomUUID());
  const plan = trpc.finance.orderSummary.useQuery(
      { id: data.orderId || 1 },
      { enabled: !!data.orderId }
    ),
    utils = trpc.useUtils();
  const save = trpc.finance.requestPayment.useMutation({
    onSuccess: () => {
      void utils.finance.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="payment" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const p = paymentInput.safeParse(data);
          if (!p.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: p.data, key });
        }}
      >
        <div className="op-fields">
          <SourcePicker
            kind="orders"
            status="approved"
            label="order"
            value={data.orderId}
            onChange={orderId =>
              setData({
                ...data,
                orderId,
                invoiceId: null,
                milestoneId: null,
                sourceAdvanceId: null,
              })
            }
            locale={locale}
          />
          <label>
            {opText(locale, "type")}
            <select
              value={data.kind}
              onChange={e =>
                setData({
                  ...data,
                  kind: e.target.value as typeof data.kind,
                  invoiceId: null,
                  milestoneId: null,
                  sourceAdvanceId: null,
                })
              }
            >
              {(["invoice", "advance", "recovery"] as const).map(k => (
                <option value={k} key={k}>
                  {opText(locale, k === "invoice" ? "invoicePayment" : k)}
                </option>
              ))}
            </select>
          </label>
          {data.kind !== "advance" && (
            <label>
              {opText(locale, "invoice")}
              <select
                required
                value={data.invoiceId || ""}
                onChange={e =>
                  setData({ ...data, invoiceId: Number(e.target.value) })
                }
              >
                <option value="">{opText(locale, "select")}</option>
                {plan.data?.invoiceBalances
                  .filter(r => r.invoice.status === "approved")
                  .map(r => (
                    <option key={r.invoice.id} value={r.invoice.id}>
                      {r.invoice.number} — {opText(locale, "due")}:{" "}
                      {r.balance.due}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {data.kind === "recovery" ? (
            <label>
              {opText(locale, "advance")}
              <select
                required
                value={data.sourceAdvanceId || ""}
                onChange={e =>
                  setData({ ...data, sourceAdvanceId: Number(e.target.value) })
                }
              >
                <option value="">{opText(locale, "select")}</option>
                {plan.data?.payments
                  .filter(p => p.kind === "advance" && p.status === "posted")
                  .map(p => (
                    <option value={p.id} key={p.id}>
                      {p.number} — {p.amount}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <label>
              {opText(locale, "milestone")}
              <select
                required
                value={data.milestoneId || ""}
                onChange={e =>
                  setData({ ...data, milestoneId: Number(e.target.value) })
                }
              >
                <option value="">{opText(locale, "select")}</option>
                {plan.data?.milestones
                  .filter(
                    m =>
                      m.status === "eligible" &&
                      (data.kind === "advance") === (m.condition === "advance")
                  )
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {locale === "ar"
                        ? m.nameAr
                        : locale === "ur"
                          ? m.nameUr
                          : m.nameEn}{" "}
                      — {m.amount} — {opText(locale, "paid")}: {m.paid}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(["amount", "reference", "reason"] as const).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        {plan.isError && <p role="alert">{opText(locale, "error")}</p>}
        <button disabled={save.isPending}>{opText(locale, "submit")}</button>
      </form>
    </Dialog>
  );
}
export function CertificateForm({ locale, onClose, initialOrder = 0 }: Props) {
  const [data, setData] = useState<z.infer<typeof certificateInput>>({
      orderId: initialOrder,
      certificateDate: today(),
      evidence: "",
      lines: [],
    }),
    [key] = useState(() => crypto.randomUUID());
  const plan = trpc.finance.orderSummary.useQuery(
      { id: data.orderId || 1 },
      { enabled: !!data.orderId }
    ),
    utils = trpc.useUtils(),
    save = trpc.finance.createCertificate.useMutation({
      onSuccess: () => {
        void utils.finance.invalidate();
        void utils.projects.invalidate();
        onClose();
      },
      onError: e => toast.error(e.message),
    });
  return (
    <Dialog title="certificates" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const p = certificateInput.safeParse(data);
          if (!p.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: p.data, key });
        }}
      >
        <SourcePicker
          kind="orders"
          status="approved"
          execution="works"
          label="order"
          value={data.orderId}
          onChange={orderId => setData({ ...data, orderId, lines: [] })}
          locale={locale}
        />
        <Input
          label="certificateDate"
          type="date"
          value={data.certificateDate}
          onChange={certificateDate => setData({ ...data, certificateDate })}
          locale={locale}
        />
        <Input
          label="evidence"
          value={data.evidence}
          onChange={evidence => setData({ ...data, evidence })}
          locale={locale}
        />
        {plan.data?.order.execution === "works"
          ? plan.data.lines.map(({ line }) => {
              const selected = data.lines.find(l => l.orderLineId === line.id);
              return (
                <section className="op-step" key={line.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!selected}
                      onChange={e =>
                        setData({
                          ...data,
                          lines: e.target.checked
                            ? [
                                ...data.lines,
                                {
                                  orderLineId: line.id,
                                  quantity: line.quantity,
                                },
                              ]
                            : data.lines.filter(l => l.orderLineId !== line.id),
                        })
                      }
                    />
                    {line.description} — {line.quantity}
                  </label>
                  {selected && (
                    <Input
                      label="quantity"
                      value={selected.quantity}
                      onChange={quantity =>
                        setData({
                          ...data,
                          lines: data.lines.map(l =>
                            l.orderLineId === line.id ? { ...l, quantity } : l
                          ),
                        })
                      }
                      locale={locale}
                    />
                  )}
                </section>
              );
            })
          : plan.data && <p role="alert">{opText(locale, "works")}</p>}
        <button disabled={save.isPending}>{opText(locale, "submit")}</button>
      </form>
    </Dialog>
  );
}
export function CreditForm({
  locale,
  onClose,
  invoiceId,
}: {
  locale: Locale;
  onClose: () => void;
  invoiceId: number;
}) {
  const [data, setData] = useState<z.infer<typeof creditInput>>({
      invoiceId,
      supplierReference: "",
      returnId: null,
      reason: "",
      lines: [],
    }),
    [key] = useState(() => crypto.randomUUID());
  const invoice = trpc.finance.invoiceDetail.useQuery({ id: invoiceId }),
    utils = trpc.useUtils(),
    save = trpc.finance.createCredit.useMutation({
      onSuccess: () => {
        void utils.finance.invalidate();
        onClose();
      },
      onError: e => toast.error(e.message),
    });
  return (
    <Dialog title="credit" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const p = creditInput.safeParse(data);
          if (!p.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: p.data, key });
        }}
      >
        {(["supplierReference", "reason"] as const).map(k => (
          <Input
            key={k}
            label={k}
            value={data[k]}
            onChange={v => setData({ ...data, [k]: v })}
            locale={locale}
          />
        ))}
        {invoice.data?.lines.map(({ line, source }) => {
          const selected = data.lines.find(l => l.invoiceLineId === line.id);
          return (
            <section key={line.id} className="op-step">
              <label>
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={e =>
                    setData({
                      ...data,
                      lines: e.target.checked
                        ? [
                            ...data.lines,
                            { invoiceLineId: line.id, quantity: line.quantity },
                          ]
                        : data.lines.filter(l => l.invoiceLineId !== line.id),
                    })
                  }
                />
                {source.description} — {line.quantity}
              </label>
              {selected && (
                <Input
                  label="quantity"
                  value={selected.quantity}
                  onChange={quantity =>
                    setData({
                      ...data,
                      lines: data.lines.map(l =>
                        l.invoiceLineId === line.id ? { ...l, quantity } : l
                      ),
                    })
                  }
                  locale={locale}
                />
              )}
            </section>
          );
        })}
        <button disabled={save.isPending}>{opText(locale, "submit")}</button>
      </form>
    </Dialog>
  );
}
