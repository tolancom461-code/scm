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
} from "@/features/workspace/ui";
export function SupplierPage({ locale }: { locale: Locale }) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const utils = trpc.useUtils();
  const suppliers = trpc.suppliers.list.useQuery();
  const create = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      void utils.suppliers.list.invalidate();
      toast.success(t9("actionDone"));
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    nameAr: "",
    nameEn: "",
    nameUr: "",
    email: "",
    phone: "",
    country: "",
    category: "",
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        ...form,
        nameEn: form.nameEn || undefined,
        nameUr: form.nameUr || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        country: form.country || undefined,
        category: form.category || undefined,
      },
      { onSuccess: () => setOpen(false) }
    );
  };
  return (
    <>
      <PageFrame
        locale={locale}
        title="suppliers"
        action={() => setOpen(true)}
        actionLabel="newSupplier"
      >
        <Table
          headers={[
            t9("number"),
            t9("supplier"),
            "EN//UR",
            t9("category"),
            t9("status"),
          ]}
          rows={(suppliers.data ?? []).map(item => [
            item.supplierNumber,
            item.nameAr,
            `${item.nameEn ?? "—"} / ${item.nameUr ?? "—"}`,
            item.category ?? "—",
            <Status key={item.id} value={item.status} />,
          ])}
          empty={t9("noData")}
        />
      </PageFrame>
      {open ? (
        <Modal title={t9("newSupplier")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="form-grid">
            <Input label="الاسم بالعربية / Arabic" required>
              <input
                value={form.nameAr}
                onChange={e => setForm({ ...form, nameAr: e.target.value })}
                required
                dir="auto"
              />
            </Input>
            <Input label="English name">
              <input
                value={form.nameEn}
                onChange={e => setForm({ ...form, nameEn: e.target.value })}
              />
            </Input>
            <Input label="اردو نام">
              <input
                value={form.nameUr}
                onChange={e => setForm({ ...form, nameUr: e.target.value })}
                dir="auto"
              />
            </Input>
            <Input label={t9("email")}>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </Input>
            <Input label="Phone">
              <input
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
              />
            </Input>
            <Input label="Country">
              <input
                value={form.country}
                onChange={e => setForm({ ...form, country: e.target.value })}
              />
            </Input>
            <Input label={t9("category")}>
              <input
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
              />
            </Input>
            <FormFooter t9={t9} pending={create.isPending} />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
