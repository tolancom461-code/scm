import { useState,useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { z } from "zod";
import { requisitionInput } from "@shared/procurement";
import type { Locale } from "@/lib/i18n";
import { Dialog, Input } from "../operations/ui";
import { opText, opName } from "../operations/copy";
import { ReferencePicker } from "../master-data/MasterDataPage";
import { ProjectPicker } from "./SourcePicker";
type Data = z.infer<typeof requisitionInput>;
type Line = Data["lines"][number];
export const blankLine = (): Line => ({
  itemId: 0,
  description: "",
  specification: "",
  quantity: "1",
  uomId: 0,
  unitPrice: "0",
  requiredDate: "",
  siteId: 0,
  warehouseId: 0,
  projectId: 0,
  wbsId: 0,
  costCenterId: 0,
  budgetId: 0,
});
export function LineEditor({
  line,
  onChange,
  onRemove,
  locale,
}: {
  line: Line;
  onChange: (line: Line) => void;
  onRemove: () => void;
  locale: Locale;
}) {
  const project = trpc.projects.detail.useQuery(
    { id: line.projectId || 1 },
    { enabled: !!line.projectId }
  );
  const item = trpc.masterData.detail.useQuery(
    { kind: "items", id: line.itemId || 1 },
    { enabled: !!line.itemId }
  );
  const budgetOptions =
    project.data?.budgets.filter(b => b.status === "approved") ?? [];
  useEffect(()=>{if(item.data&&item.data.id===line.itemId&&"purchasingUomId"in item.data&&line.uomId===0)onChange({...line,uomId:item.data.purchasingUomId});},[item.data,line,onChange]);
  return (
    <section className="op-step">
      <div className="op-fields">
        <label>
          {opText(locale, "item")}
          <ReferencePicker
            kind="items"
            value={String(line.itemId || "")}
            onChange={v => onChange({ ...line, itemId: Number(v), uomId: 0 })}
            locale={locale}
          />
        </label>
        <Input
          label="description"
          value={line.description}
          onChange={v => onChange({ ...line, description: v })}
          locale={locale}
        />
        <Input
          label="specification"
          value={line.specification}
          required={false}
          onChange={v => onChange({ ...line, specification: v })}
          locale={locale}
        />
        <Input
          label="quantity"
          value={line.quantity}
          onChange={v => onChange({ ...line, quantity: v })}
          locale={locale}
        />
        <label>
          {opText(locale, "uom")}
          <ReferencePicker
            kind="units"
            allowedIds={item.data&&"baseUomId"in item.data?[item.data.baseUomId,item.data.purchasingUomId]:undefined}
            value={String(line.uomId || "")}
            onChange={v => onChange({ ...line, uomId: Number(v) })}
            locale={locale}
          />
        </label>
        <Input
          label="unitPrice"
          value={line.unitPrice}
          onChange={v => onChange({ ...line, unitPrice: v })}
          locale={locale}
        />
        <Input
          label="requiredDate"
          type="date"
          value={line.requiredDate}
          onChange={v => onChange({ ...line, requiredDate: v })}
          locale={locale}
        />
        <ProjectPicker
          value={line.projectId}
          onChange={v =>
            onChange({
              ...line,
              projectId: v,
              budgetId: 0,
              wbsId: 0,
              costCenterId: 0,
            })
          }
          locale={locale}
        />
        <label>
          {opText(locale, "budget")}
          <select
            aria-label={opText(locale,"budget")}
            required
            value={line.budgetId || ""}
            onChange={e => {
              const budget = budgetOptions.find(
                b => b.id === Number(e.target.value)
              );
              if (budget)
                onChange({
                  ...line,
                  budgetId: budget.id,
                  wbsId: budget.wbsId,
                  costCenterId: budget.costCenterId,
                });
            }}
          >
            <option value="">{opText(locale, "select")}</option>
            {budgetOptions.map(b => (
              <option value={b.id} key={b.id}>
                {opName(project.data!.wbs.find(w => w.id === b.wbsId)!, locale)}{" "}
                — {b.amount} {project.data?.project.currency} — #
                {b.costCenterId}
              </option>
            ))}
          </select>
        </label>
        <label>
          {opText(locale, "site")}
          <ReferencePicker
            kind="sites"
            value={String(line.siteId || "")}
            onChange={v => onChange({ ...line, siteId: Number(v) })}
            locale={locale}
          />
        </label>
        <label>
          {opText(locale, "warehouse")}
          <ReferencePicker
            kind="warehouses"
            value={String(line.warehouseId || "")}
            onChange={v => onChange({ ...line, warehouseId: Number(v) })}
            locale={locale}
          />
        </label>
      </div>
      <button type="button" onClick={onRemove}>
        {opText(locale, "remove")}
      </button>
    </section>
  );
}
export function RequisitionForm({
  locale,
  onClose,
  existing,
}: {
  locale: Locale;
  onClose: () => void;
  existing?: { id: number; version: number; data: Data };
}) {
  const [data, setData] = useState<Data>(
    existing?.data ?? {
      title: "",
      department: "",
      branchId: 0,
      currency: "SAR",
      priority: "normal",
      requiredDate: "",
      reason: "",
      lines: [blankLine()],
    }
  );
  const [reason, setReason] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const done = () => {
    void utils.procurement.invalidate();
    toast.success(opText(locale, "saved"));
    onClose();
  };
  const create = trpc.procurement.createRequisition.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    }),
    revise = trpc.procurement.reviseRequisition.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    });
  return (
    <Dialog
      title={existing ? "revise" : "requisition"}
      locale={locale}
      onClose={onClose}
    >
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = requisitionInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          if (existing)
            revise.mutate({
              id: existing.id,
              version: existing.version,
              data: parsed.data,
              reason,
            });
          else create.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          {(["title", "department", "currency", "reason"] as const).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
          <Input
            label="requiredDate"
            type="date"
            value={data.requiredDate}
            onChange={v => setData({ ...data, requiredDate: v })}
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
          <label>
            {opText(locale, "priority")}
            <select
              value={data.priority}
              onChange={e =>
                setData({
                  ...data,
                  priority: e.target.value as Data["priority"],
                })
              }
            >
              {(["low", "normal", "high", "urgent"] as const).map(p => (
                <option value={p} key={p}>
                  {opText(locale, p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h3>{opText(locale, "lines")}</h3>
        {data.lines.map((line, index) => (
          <LineEditor
            key={index}
            line={line}
            locale={locale}
            onChange={v =>
              setData({
                ...data,
                lines: data.lines.map((l, i) => (i === index ? v : l)),
              })
            }
            onRemove={() =>
              setData({
                ...data,
                lines: data.lines.filter((_, i) => i !== index),
              })
            }
          />
        ))}
        {existing && (
          <Input
            label="reason"
            value={reason}
            onChange={setReason}
            locale={locale}
          />
        )}
        <div className="op-actions">
          <button
            type="button"
            onClick={() =>
              setData({ ...data, lines: [...data.lines, blankLine()] })
            }
          >
            {opText(locale, "addLine")}
          </button>
          <button disabled={create.isPending || revise.isPending}>
            {opText(locale, "save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
