import { trpc } from "@/lib/trpc";
import { t, type Locale, type TranslationKey } from "@/lib/i18n";
import { useState } from "react";
import { toast } from "sonner";
import {
  Input,
  PageFrame,
  Table,
  Status,
  Modal,
  FormFooter,
  RequestAction,
} from "@/features/workspace/ui";
export function RequestPage({ locale }: { locale: Locale }) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const utils = trpc.useUtils();
  const requests = trpc.purchaseRequests.list.useQuery();
  const suppliers = trpc.suppliers.list.useQuery();
  const create = trpc.purchaseRequests.create.useMutation({
    onSuccess: () => {
      void utils.purchaseRequests.list.invalidate();
      void utils.dashboard.overview.invalidate();
      toast.success(t9("actionDone"));
    },
  });
  const transition = trpc.purchaseRequests.transition.useMutation({
    onSuccess: () => {
      void utils.purchaseRequests.list.invalidate();
      void utils.dashboard.overview.invalidate();
      toast.success(t9("actionDone"));
    },
    onError: error => toast.error(error.message),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    department: "",
    site: "",
    supplierId: "",
    priority: "normal" as "low" | "normal" | "high" | "urgent",
    budgetCode: "",
    budgetLimit: "",
    estimatedValue: "",
    item: "",
    quantity: "1",
    unit: "EA",
    unitPrice: "",
    notes: "",
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        title: form.title,
        department: form.department || undefined,
        site: form.site || undefined,
        supplierId: form.supplierId ? Number(form.supplierId) : undefined,
        priority: form.priority,
        budgetCode: form.budgetCode || undefined,
        budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : undefined,
        estimatedValue: Number(form.estimatedValue || 0),
        notes: form.notes || undefined,
        items: [
          {
            description: form.item,
            quantity: Number(form.quantity),
            unit: form.unit,
            estimatedUnitPrice: Number(form.unitPrice || 0),
          },
        ],
      },
      { onSuccess: () => setOpen(false) }
    );
  };
  return (
    <>
      <PageFrame
        locale={locale}
        title="requests"
        action={() => setOpen(true)}
        actionLabel="newRequest"
      >
        <Table
          headers={[
            t9("number"),
            t9("requestTitle"),
            t9("priority"),
            t9("estimate"),
            t9("status"),
            "ACTION",
          ]}
          rows={(requests.data ?? []).map(item => [
            item.requestNumber,
            item.title,
            <Status key={`${item.id}-p`} value={item.priority} />,
            `${item.estimatedValue} ${item.currency}`,
            <Status key={`${item.id}-s`} value={item.status} />,
            <RequestAction
              key={`${item.id}-a`}
              item={item}
              t9={t9}
              onAction={to =>
                transition.mutate({ requestId: item.id, from: item.status, to })
              }
            />,
          ])}
          empty={t9("noData")}
        />
      </PageFrame>
      {open ? (
        <Modal title={t9("newRequest")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="form-grid">
            <Input label={t9("requestTitle")} required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                required
                dir="auto"
              />
            </Input>
            <Input label={t9("department")}>
              <input
                value={form.department}
                onChange={e => setForm({ ...form, department: e.target.value })}
              />
            </Input>
            <Input label={t9("site")}>
              <input
                value={form.site}
                onChange={e => setForm({ ...form, site: e.target.value })}
              />
            </Input>
            <Input label={t9("supplier")}>
              <select
                value={form.supplierId}
                onChange={e => setForm({ ...form, supplierId: e.target.value })}
              >
                <option value="">—</option>
                {(suppliers.data ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.nameAr}
                  </option>
                ))}
              </select>
            </Input>
            <Input label={t9("priority")}>
              <select
                value={form.priority}
                onChange={e =>
                  setForm({
                    ...form,
                    priority: e.target.value as typeof form.priority,
                  })
                }
              >
                {(["low", "normal", "high", "urgent"] as const).map(x => (
                  <option key={x} value={x}>
                    {t9(x)}
                  </option>
                ))}
              </select>
            </Input>
            <Input label="BUDGET//CODE">
              <input
                value={form.budgetCode}
                onChange={e => setForm({ ...form, budgetCode: e.target.value })}
                dir="ltr"
              />
            </Input>
            <Input label="BUDGET//LIMIT">
              <input
                type="number"
                min="0"
                value={form.budgetLimit}
                onChange={e =>
                  setForm({ ...form, budgetLimit: e.target.value })
                }
              />
            </Input>
            <Input label={t9("estimate")}>
              <input
                type="number"
                min="0"
                value={form.estimatedValue}
                onChange={e =>
                  setForm({ ...form, estimatedValue: e.target.value })
                }
              />
            </Input>
            <div className="form-divider">ITEM//01</div>
            <Input label={t9("item")} required>
              <input
                value={form.item}
                onChange={e => setForm({ ...form, item: e.target.value })}
                required
                dir="auto"
              />
            </Input>
            <Input label={t9("quantity")} required>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })}
                required
              />
            </Input>
            <Input label={t9("unit")} required>
              <input
                value={form.unit}
                onChange={e => setForm({ ...form, unit: e.target.value })}
                required
              />
            </Input>
            <Input label={t9("unitPrice")}>
              <input
                type="number"
                min="0"
                value={form.unitPrice}
                onChange={e => setForm({ ...form, unitPrice: e.target.value })}
              />
            </Input>
            <Input label={t9("notes")}>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </Input>
            <FormFooter t9={t9} pending={create.isPending} />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
