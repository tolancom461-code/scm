import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n";
import type { z } from "zod";
import { orderInput } from "@shared/procurement";
import { Dialog, Input } from "../operations/ui";
import { opText } from "../operations/copy";
import { ReferencePicker } from "../master-data/MasterDataPage";
import { SourcePicker, SupplierPicker } from "./SourcePicker";
type Line = z.infer<typeof orderInput>["lines"][number];
const blankSchedule = () => ({
  quantity: "1",
  dueDate: "",
  warehouseId: 0,
  siteId: 0,
});
function AwardSource({
  supplierId,
  locale,
  onAdd,
}: {
  supplierId: number;
  locale: Locale;
  onAdd: (v: Line) => void;
}) {
  const [id, setId] = useState(0);
  const query = trpc.procurement.detail.useQuery(
    { kind: "awards", id: id || 1 },
    { enabled: !!id }
  );
  return (
    <section className="op-step">
      <SourcePicker
        kind="awards"
        status="approved"
        value={id}
        onChange={setId}
        locale={locale}
      />
      {query.data?.kind === "awards" &&
        query.data.lines
          .filter(l => l.quotation.supplierId === supplierId)
          .map(({ line, quotationLine }) => (
            <div className="op-actions" key={line.id}>
              <span>
                #{quotationLine.rfqLineId} — {line.quantity} ×{" "}
                {quotationLine.unitPrice}
              </span>
              <button
                type="button"
                onClick={() =>
                  onAdd({
                    awardLineId: line.id,
                    quantity: line.quantity,
                    schedules: [
                      { ...blankSchedule(), quantity: line.quantity },
                    ],
                  })
                }
              >
                {opText(locale, "addLine")}
              </button>
            </div>
          ))}
    </section>
  );
}
export function OrderForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    supplierId: 0,
    department: "",
    paymentTerms: "",
    deliveryTerms: "",
    lines: [] as Line[],
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.procurement.createOrder.useMutation({
    onSuccess: () => {
      void utils.procurement.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  const change = (index: number, line: Line) =>
    setData({
      ...data,
      lines: data.lines.map((l, i) => (i === index ? line : l)),
    });
  return (
    <Dialog title="orders" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = orderInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <SupplierPicker
          value={data.supplierId}
          onChange={v => setData({ ...data, supplierId: v, lines: [] })}
          locale={locale}
        />
        {(["department", "paymentTerms", "deliveryTerms"] as const).map(k => (
          <Input
            key={k}
            label={k}
            value={data[k]}
            onChange={v => setData({ ...data, [k]: v })}
            locale={locale}
          />
        ))}
        {data.supplierId > 0 && (
          <AwardSource
            supplierId={data.supplierId}
            locale={locale}
            onAdd={line => {
              if (!data.lines.some(l => l.awardLineId === line.awardLineId))
                setData({ ...data, lines: [...data.lines, line] });
            }}
          />
        )}
        {data.lines.map((line, index) => (
          <section className="op-step" key={line.awardLineId}>
            <strong>
              {opText(locale, "sourceLine")} #{line.awardLineId}
            </strong>
            <Input
              label="quantity"
              value={line.quantity}
              onChange={v => change(index, { ...line, quantity: v })}
              locale={locale}
            />
            <h4>{opText(locale, "schedule")}</h4>
            {line.schedules.map((schedule, si) => (
              <div className="op-fields" key={si}>
                <Input
                  label="quantity"
                  value={schedule.quantity}
                  onChange={v =>
                    change(index, {
                      ...line,
                      schedules: line.schedules.map((s, i) =>
                        i === si ? { ...s, quantity: v } : s
                      ),
                    })
                  }
                  locale={locale}
                />
                <Input
                  label="dueDate"
                  type="date"
                  value={schedule.dueDate}
                  onChange={v =>
                    change(index, {
                      ...line,
                      schedules: line.schedules.map((s, i) =>
                        i === si ? { ...s, dueDate: v } : s
                      ),
                    })
                  }
                  locale={locale}
                />
                <label>
                  {opText(locale, "warehouse")}
                  <ReferencePicker
                    kind="warehouses"
                    value={String(schedule.warehouseId || "")}
                    onChange={v =>
                      change(index, {
                        ...line,
                        schedules: line.schedules.map((s, i) =>
                          i === si ? { ...s, warehouseId: Number(v) } : s
                        ),
                      })
                    }
                    locale={locale}
                  />
                </label>
                <label>
                  {opText(locale, "site")}
                  <ReferencePicker
                    kind="sites"
                    value={String(schedule.siteId || "")}
                    onChange={v =>
                      change(index, {
                        ...line,
                        schedules: line.schedules.map((s, i) =>
                          i === si ? { ...s, siteId: Number(v) } : s
                        ),
                      })
                    }
                    locale={locale}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    change(index, {
                      ...line,
                      schedules: line.schedules.filter((_, i) => i !== si),
                    })
                  }
                >
                  {opText(locale, "remove")}
                </button>
              </div>
            ))}
            <div className="op-actions">
              <button
                type="button"
                onClick={() =>
                  change(index, {
                    ...line,
                    schedules: [...line.schedules, blankSchedule()],
                  })
                }
              >
                {opText(locale, "addSchedule")}
              </button>
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
            </div>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
