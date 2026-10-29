import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { documentText as opText } from "./copy";
import { allowed, type AccessUser } from "@/lib/access";
export function LinkedDocuments({
  entityType,
  entityId,
  locale,
  user,
}: {
  entityType: "p1_contract" | "p1_certificate" | "p1_payment" | "p1_inspection" | "pm_project";
  entityId: number;
  locale: Locale;
  user: AccessUser;
}) {
  const canView = allowed(user, "documents.view"),
    query = trpc.documents.list.useQuery(
      { entityType, entityId },
      { enabled: canView }
    ),
    utils = trpc.useUtils(),
    [title, setTitle] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const upload = trpc.documents.upload.useMutation({
    onSuccess: () => {
      void utils.documents.invalidate();
      setTitle("");
      setFile(null);
    },
    onError: e => toast.error(e.message),
  });
  return (
    <section className="op-step">
      <h4>{opText(locale, "attachments")}</h4>
      {query.data?.map(d => (
        <p key={d.id}>
          <a href={d.url} target="_blank" rel="noreferrer">
            {d.title} — {d.fileName}
          </a>
        </p>
      ))}
      {query.isError && <p role="alert">{opText(locale, "error")}</p>}
      {allowed(user, "documents.upload") && (
        <form
          className="op-form"
          onSubmit={async e => {
            e.preventDefault();
            if (!file) return;
            if (file.size > 6000000) {
              toast.error(opText(locale, "fileTooLarge"));
              return;
            }
            const reader = new FileReader();
            reader.onload = () =>
              upload.mutate({
                entityType,
                entityId,
                title,
                fileName: file.name,
                mimeType: file.type || "application/octet-stream",
                classification: "internal",
                base64: String(reader.result).split(",")[1],
              });
            reader.onerror = () => toast.error(opText(locale, "error"));
            reader.readAsDataURL(file);
          }}
        >
          <label>
            {opText(locale, "title")}
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </label>
          <label>
            {opText(locale, "attachments")}
            <input
              type="file"
              required
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={upload.isPending}>{opText(locale, "save")}</button>
        </form>
      )}
    </section>
  );
}
