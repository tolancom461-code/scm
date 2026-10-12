import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n";
import { rfqInput, quotationInput, awardInput } from "@shared/procurement";
import { Dialog, Input } from "../operations/ui";
import { opText, opName } from "../operations/copy";
import { SourcePicker, SupplierPicker } from "./SourcePicker";
type RfqLine = { requisitionLineId: number; quantity: string };
function RequestSource({
  locale,
  onAdd,
}: {
  locale: Locale;
  onAdd: (v: RfqLine) => void;
}) {
  const [id, setId] = useState(0);
  const query = trpc.procurement.detail.useQuery(
    { kind: "requisitions", id: id || 1 },
    { enabled: !!id }
  );
  return (
    <section className="op-step">
      <SourcePicker
        kind="requisitions"
        status="approved"
        value={id}
        onChange={setId}
        locale={locale}
      />
      {query.data?.kind === "requisitions" &&
        query.data.lines.map(({ line, item }) => (
          <div className="op-actions" key={line.id}>
            <span>
              {opName(item, locale)} — {line.quantity}
            </span>
            <button
              type="button"
              onClick={() =>
                onAdd({ requisitionLineId: line.id, quantity: line.quantity })
              }
            >
              {opText(locale, "addLine")}
            </button>
          </div>
        ))}
    </section>
  );
}
export function RfqForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    title: "",
    currency: "SAR",
    opensAt: "",
    closesAt: "",
    terms: "",
    supplierIds: [] as number[],
    lines: [] as RfqLine[],
  });
  const [supplierId, setSupplierId] = useState(0);
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.procurement.createRfq.useMutation({
    onSuccess: () => {
      void utils.procurement.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="rfqs" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = rfqInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          {(["title", "currency", "terms"] as const).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
          {(["opensAt", "closesAt"] as const).map(k => (
            <Input
              key={k}
              label={k}
              type="date"
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        <SupplierPicker
          value={supplierId}
          onChange={setSupplierId}
          locale={locale}
        />
        <button
          type="button"
          onClick={() => {
            if (supplierId && !data.supplierIds.includes(supplierId))
              setData({
                ...data,
                supplierIds: [...data.supplierIds, supplierId],
              });
          }}
        >
          {opText(locale, "create")}
        </button>
        {data.supplierIds.map(id => (
          <div className="op-actions" key={id}>
            <span>
              {opText(locale, "supplier")} #{id}
            </span>
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  supplierIds: data.supplierIds.filter(v => v !== id),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </div>
        ))}
        <RequestSource
          locale={locale}
          onAdd={line => {
            if (
              !data.lines.some(
                l => l.requisitionLineId === line.requisitionLineId
              )
            )
              setData({ ...data, lines: [...data.lines, line] });
          }}
        />
        {data.lines.map((line, i) => (
          <section className="op-step" key={line.requisitionLineId}>
            <strong>
              {opText(locale, "sourceLine")} #{line.requisitionLineId}
            </strong>
            <Input
              label="quantity"
              value={line.quantity}
              onChange={v =>
                setData({
                  ...data,
                  lines: data.lines.map((l, j) =>
                    i === j ? { ...l, quantity: v } : l
                  ),
                })
              }
              locale={locale}
            />
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  lines: data.lines.filter((_, j) => j !== i),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
const quoteLine = (rfqLineId: number, quantity: string) => ({
  rfqLineId,
  quantity,
  unitPrice: "0",
  discountPercent: "0",
  taxPercent: "0",
  brand: "",
  model: "",
  deliveryDays: 0,
  warranty: "",
  notes: "",
});
export function QuotationForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    rfqId: 0,
    supplierId: 0,
    supplierReference: "",
    validUntil: "",
    currency: "SAR",
    paymentTerms: "",
    deliveryTerms: "",
    lines: [] as ReturnType<typeof quoteLine>[],
  });
  const rfq = trpc.procurement.detail.useQuery(
    { kind: "rfqs", id: data.rfqId || 1 },
    { enabled: !!data.rfqId }
  );
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.procurement.createQuotation.useMutation({
    onSuccess: () => {
      void utils.procurement.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="quotations" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = quotationInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <SourcePicker
          kind="rfqs"
          status="open"
          value={data.rfqId}
          onChange={v =>
            setData({ ...data, rfqId: v, supplierId: 0, lines: [] })
          }
          locale={locale}
        />
        {rfq.data?.kind === "rfqs" && (
          <>
            <label>
              {opText(locale, "supplier")}
              <select
                required
                value={data.supplierId || ""}
                onChange={e =>
                  setData({
                    ...data,
                    supplierId: Number(e.target.value),
                    currency: rfq.data!.header.currency,
                  })
                }
              >
                <option value="">{opText(locale, "select")}</option>
                {rfq.data.invited.map(s => (
                  <option key={s.supplierId} value={s.supplierId}>
                    {locale === "ar"
                      ? s.nameAr
                      : locale === "ur"
                        ? (s.nameUr ?? s.nameAr)
                        : (s.nameEn ?? s.nameAr)}
                  </option>
                ))}
              </select>
            </label>
            {rfq.data.lines.map(({ line, item }) => (
              <div className="op-actions" key={line.id}>
                <span>
                  {opName(item, locale)} — {line.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!data.lines.some(l => l.rfqLineId === line.id))
                      setData({
                        ...data,
                        currency: rfq.data!.header.currency,
                        lines: [
                          ...data.lines,
                          quoteLine(line.id, line.quantity),
                        ],
                      });
                  }}
                >
                  {opText(locale, "addLine")}
                </button>
              </div>
            ))}
          </>
        )}
        <div className="op-fields">
          {(
            [
              "supplierReference",
              "currency",
              "paymentTerms",
              "deliveryTerms",
            ] as const
          ).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
          <Input
            label="validUntil"
            type="date"
            value={data.validUntil}
            onChange={v => setData({ ...data, validUntil: v })}
            locale={locale}
          />
        </div>
        {data.lines.map((line, index) => (
          <section className="op-step" key={line.rfqLineId}>
            <strong>
              {opText(locale, "sourceLine")} #{line.rfqLineId}
            </strong>
            <div className="op-fields">
              {(
                [
                  "quantity",
                  "unitPrice",
                  "discountPercent",
                  "taxPercent",
                  "warranty",
                ] as const
              ).map(k => (
                <Input
                  key={k}
                  label={k}
                  value={line[k]}
                  required={k !== "warranty"}
                  onChange={v =>
                    setData({
                      ...data,
                      lines: data.lines.map((l, i) =>
                        i === index ? { ...l, [k]: v } : l
                      ),
                    })
                  }
                  locale={locale}
                />
              ))}
              <Input
                label="deliveryDays"
                type="number"
                value={String(line.deliveryDays)}
                onChange={v =>
                  setData({
                    ...data,
                    lines: data.lines.map((l, i) =>
                      i === index ? { ...l, deliveryDays: Number(v) } : l
                    ),
                  })
                }
                locale={locale}
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  lines: data.lines.filter((_, i) => i !== index),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
function QuoteSource({
  rfqId,
  locale,
  onAdd,
}: {
  rfqId: number;
  locale: Locale;
  onAdd: (v: { quotationLineId: number; quantity: string }) => void;
}) {
  const [id, setId] = useState(0);
  const query = trpc.procurement.detail.useQuery(
    { kind: "quotations", id: id || 1 },
    { enabled: !!id }
  );
  return (
    <section className="op-step">
      <SourcePicker
        kind="quotations"
        status="evaluated"
        value={id}
        onChange={setId}
        locale={locale}
      />
      {query.data?.kind === "quotations" &&
        query.data.header.rfqId === rfqId &&
        query.data.lines.map(line => (
          <div className="op-actions" key={line.id}>
            <span>
              #{line.rfqLineId} — {line.quantity} × {line.unitPrice}
            </span>
            <button
              type="button"
              onClick={() =>
                onAdd({ quotationLineId: line.id, quantity: line.quantity })
              }
            >
              {opText(locale, "addLine")}
            </button>
          </div>
        ))}
    </section>
  );
}
export function AwardForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    rfqId: 0,
    department: "",
    reason: "",
    lines: [] as { quotationLineId: number; quantity: string }[],
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.procurement.createAward.useMutation({
    onSuccess: () => {
      void utils.procurement.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="awards" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = awardInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <SourcePicker
          kind="rfqs"
          status="closed"
          value={data.rfqId}
          onChange={v => setData({ ...data, rfqId: v, lines: [] })}
          locale={locale}
        />
        <Input
          label="department"
          value={data.department}
          onChange={v => setData({ ...data, department: v })}
          locale={locale}
        />
        <Input
          label="reason"
          value={data.reason}
          onChange={v => setData({ ...data, reason: v })}
          locale={locale}
        />
        {data.rfqId > 0 && (
          <QuoteSource
            rfqId={data.rfqId}
            locale={locale}
            onAdd={line => {
              if (
                !data.lines.some(
                  l => l.quotationLineId === line.quotationLineId
                )
              )
                setData({ ...data, lines: [...data.lines, line] });
            }}
          />
        )}
        {data.lines.map((line, index) => (
          <section className="op-step" key={line.quotationLineId}>
            <strong>
              {opText(locale, "sourceLine")} #{line.quotationLineId}
            </strong>
            <Input
              label="quantity"
              value={line.quantity}
              onChange={v =>
                setData({
                  ...data,
                  lines: data.lines.map((l, i) =>
                    i === index ? { ...l, quantity: v } : l
                  ),
                })
              }
              locale={locale}
            />
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  lines: data.lines.filter((_, i) => i !== index),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
