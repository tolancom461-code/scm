import { trpc } from "@/lib/trpc";
import { localeMeta, t, type Locale, type TranslationKey } from "@/lib/i18n";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Input,
  PageFrame,
  Table,
  Status,
  Modal,
  FormFooter,
  fileToBase64,
} from "@/features/workspace/ui";
export function DocumentsPage({ locale }: { locale: Locale }) {
  const t9 = (key: TranslationKey) => t(locale, key);
  const utils = trpc.useUtils();
  const documents = trpc.documents.list.useQuery();
  const upload = trpc.documents.upload.useMutation({
    onSuccess: () => {
      void utils.documents.list.invalidate();
      toast.success(t9("actionDone"));
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    entityType: "purchase_request",
    entityId: "",
    title: "",
    classification: "internal" as
      | "normal"
      | "internal"
      | "confidential"
      | "highly_confidential",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error(t9("required"));
    if (file.size > 6_000_000) return toast.error(t9("fileMax"));
    const base64 = await fileToBase64(file);
    upload.mutate(
      {
        ...form,
        entityId: Number(form.entityId),
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      },
      { onSuccess: () => setOpen(false) }
    );
  };
  return (
    <>
      <PageFrame
        locale={locale}
        title="documents"
        action={() => setOpen(true)}
        actionLabel="uploadDocument"
      >
        <Table
          headers={[
            t9("number"),
            t9("title"),
            t9("entity"),
            "VERSION",
            t9("classification"),
            t9("created"),
          ]}
          rows={(documents.data ?? []).map(item => [
            item.documentNumber,
            <a
              key={`${item.id}-l`}
              className="file-link"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              {item.title}
            </a>,
            `${item.entityType} #${item.entityId}`,
            `V${item.version}`,
            <Status key={`${item.id}-c`} value={item.classification} />,
            new Date(item.createdAt).toLocaleDateString(
              localeMeta[locale].formatting
            ),
          ])}
          empty={t9("noData")}
        />
      </PageFrame>
      {open ? (
        <Modal title={t9("uploadDocument")} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="form-grid">
            <Input label={t9("entity")} required>
              <select
                value={form.entityType}
                onChange={e => setForm({ ...form, entityType: e.target.value })}
              >
                <option value="purchase_request">Purchase request</option>
                <option value="contract">Contract</option>
                <option value="supplier">Supplier</option>
                <option value="purchase_order">Purchase order</option>
              </select>
            </Input>
            <Input label="ENTITY//ID" required>
              <input
                type="number"
                min="1"
                value={form.entityId}
                onChange={e => setForm({ ...form, entityId: e.target.value })}
                required
              />
            </Input>
            <Input label={t9("title")} required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                required
                dir="auto"
              />
            </Input>
            <Input label={t9("classification")}>
              <select
                value={form.classification}
                onChange={e =>
                  setForm({
                    ...form,
                    classification: e.target
                      .value as typeof form.classification,
                  })
                }
              >
                {(
                  [
                    "normal",
                    "internal",
                    "confidential",
                    "highly_confidential",
                  ] as const
                ).map(x => (
                  <option key={x} value={x}>
                    {t9(x === "normal" ? "normalClass" : x)}
                  </option>
                ))}
              </select>
            </Input>
            <Input label={t9("file")} required>
              <input ref={fileRef} type="file" required />
            </Input>
            <FormFooter t9={t9} pending={upload.isPending} />
          </form>
        </Modal>
      ) : null}
    </>
  );
}
