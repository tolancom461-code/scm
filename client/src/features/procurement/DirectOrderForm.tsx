import { useState } from "react";
import type { z } from "zod";
import { toast } from "sonner";
import { directOrderInput } from "@shared/procurement";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { Dialog, Input } from "../operations/ui";
import { opText } from "../operations/copy";
import { ReferencePicker } from "../master-data/MasterDataPage";
import { SupplierPicker } from "./SourcePicker";
import { blankLine, LineEditor } from "./RequisitionForm";
type Data = z.infer<typeof directOrderInput>;
export function DirectOrderForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data>({
      title: "",
      department: "",
      branchId: 0,
      currency: "SAR",
      priority: "normal",
      requiredDate: "",
      reason: "",
      supplierId: 0,
      execution: "goods",
      contractReference: "",
      paymentTerms: "",
      deliveryTerms: "",
      lines: [{ ...blankLine(), discountPercent: "0", taxPercent: "0" }],
    }),
    [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils(),
    save = trpc.procurement.createDirectOrder.useMutation({
      onSuccess: () => {
        void utils.procurement.invalidate();
        onClose();
        toast.success(opText(locale, "saved"));
      },
      onError: e => toast.error(e.message),
    });
  return (
    <Dialog title="directOrder" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = directOrderInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          <label>
            {opText(locale, "type")}
            <select
              value={data.execution}
              onChange={e =>
                setData({
                  ...data,
                  execution: e.target.value as Data["execution"],
                })
              }
            >
              {(["goods", "works"] as const).map(v => (
                <option key={v} value={v}>
                  {opText(locale, v)}
                </option>
              ))}
            </select>
          </label>
          <SupplierPicker
            value={data.supplierId}
            onChange={supplierId => setData({ ...data, supplierId })}
            locale={locale}
          />
          {(
            [
              "title",
              "department",
              "currency",
              "paymentTerms",
              "deliveryTerms",
              "reason",
              "contractReference",
            ] as const
          ).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              required={k !== "contractReference"}
              locale={locale}
            />
          ))}
          <Input
            label="requiredDate"
            type="date"
            value={data.requiredDate}
            onChange={requiredDate => setData({ ...data, requiredDate })}
            locale={locale}
          />
          <label>
            {opText(locale, "branch")}
            <ReferencePicker
              kind="branches"
              value={String(data.branchId || "")}
              onChange={v => setData({ ...data, branchId: Number(v) })}
              locale={locale}
            />
          </label>
        </div>
        {data.lines.map((line, index) => (
          <div key={index}>
            <LineEditor
              line={line}
              locale={locale}
              onRemove={() =>
                setData({
                  ...data,
                  lines: data.lines.filter((_, i) => i !== index),
                })
              }
              onChange={updated =>
                setData({
                  ...data,
                  lines: data.lines.map((l, i) =>
                    i === index
                      ? {
                          ...updated,
                          discountPercent: line.discountPercent,
                          taxPercent: line.taxPercent,
                        }
                      : l
                  ),
                })
              }
            />
            <div className="op-fields">
              {(["discountPercent", "taxPercent"] as const).map(k => (
                <Input
                  key={k}
                  label={k}
                  value={line[k]}
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
            </div>
          </div>
        ))}
        <div className="op-actions">
          <button
            type="button"
            onClick={() =>
              setData({
                ...data,
                lines: [
                  ...data.lines,
                  {
                    ...blankLine(),
                    requiredDate: data.requiredDate,
                    discountPercent: "0",
                    taxPercent: "0",
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
