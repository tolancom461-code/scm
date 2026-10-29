import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { Modal } from "../workspace/ui";
import { roleTemplates } from "@shared/policy";
import { policyText, type PolicyLabel } from "./copy";
import "./policy.css";
import { UserAccessFields } from "./UserAccessFields";

export function PolicyCenter({
  locale,
  targetId = 0,
  clearTarget,
}: {
  locale: Locale;
  targetId?: number;
  clearTarget?: () => void;
}) {
  const p = (key: PolicyLabel) => policyText(locale, key),
    utils = trpc.useUtils();
  const catalog = trpc.policy.catalog.useQuery(),
    audit = trpc.policy.audit.useQuery();
  const [selected, setSelected] = useState(0);
  const target = trpc.policy.user.useQuery(
    { userId: selected },
    {
      enabled: selected > 0 && !!catalog.data?.canManage,
      refetchOnWindowFocus: false,
    }
  );
  type Config = NonNullable<typeof target.data>;
  const [form, setForm] = useState<Config | null>(null);
  useEffect(() => {
    if (targetId && catalog.data?.canManage) {
      setSelected(targetId);
      clearTarget?.();
    }
  }, [targetId, catalog.data?.canManage]);
  useEffect(() => {
    if (target.data && !target.isFetching) setForm(target.data);
  }, [target.data, target.isFetching]);
  const save = trpc.policy.save.useMutation({
    onSuccess: () => {
      toast.success(p("saved"));
      setSelected(0);
      setForm(null);
      void utils.policy.invalidate();
      void utils.auth.me.invalidate();
      void utils.phaseOne.invalidate();
      void utils.users.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const languageIndex = locale === "en" ? 1 : locale === "ur" ? 2 : 0;
  const chosenUser = catalog.data?.users.find(u => u.id === selected);
  const reason = (code: string) =>
    p(
      (
        {
          PERMISSION_DENIED: "permissionDenied",
          PROJECT_SCOPE: "projectDenied",
          SELF_APPROVAL: "selfDenied",
          DOCUMENT_TARGET: "targetDenied",
          GRANT_AUTHORITY: "grantDenied",
          BUSINESS_RULE: "businessDenied",
          UNREGISTERED_ACTION: "unknownDenied",
          OWNER_ACCOUNT: "grantDenied",
        } as Record<string, PolicyLabel>
      )[code] ?? "permissionDenied"
    );
  const close = () => {
    if (!save.isPending) {
      setSelected(0);
      setForm(null);
    }
  };
  return (
    <div className="policy-center">
      <h1>{p("title")}</h1>
      <p className="p1-hint">{p("hint")}</p>
      {catalog.isError ? (
        <p role="alert">{p("error")}</p>
      ) : (
        <div className="p1-table-wrap">
          <table className="policy-users-table">
            <thead>
              <tr>
                <th>{p("user")}</th>
                <th>{p("role")}</th>
                <th>{p("edit")}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.data?.users.map(user => (
                <tr key={user.id}>
                  <td>
                    {user.name}
                    <small>
                      {user.username} · {p(user.active ? "active" : "inactive")}
                    </small>
                  </td>
                  <td>
                    {user.role === "admin"
                      ? p("owner")
                      : (catalog.data.templates.find(
                          t => t.code === user.template
                        )?.labels[languageIndex] ??
                        roleTemplates.custom.labels[languageIndex])}
                    <small>
                      {p(
                        user.role === "admin" || user.allProjects
                          ? "all"
                          : "assigned"
                      )}
                    </small>
                  </td>
                  <td>
                    {catalog.data?.canManage && (
                      <button
                        onClick={() => {
                          setForm(null);
                          setSelected(user.id);
                        }}
                      >
                        {p("edit")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!catalog.isLoading && !catalog.data?.users.length && (
            <p>{p("noUsers")}</p>
          )}
        </div>
      )}
      <h2>{p("audit")}</h2>
      <div className="p1-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{p("user")}</th>
              <th>{p("path")}</th>
              <th>{p("reason")}</th>
              <th>{p("date")}</th>
            </tr>
          </thead>
          <tbody>
            {audit.data?.map(event => (
              <tr key={event.id}>
                <td>{event.username}</td>
                <td>
                  <bdi>{event.path}</bdi>
                </td>
                <td>{reason(event.reason)}</td>
                <td>
                  {new Intl.DateTimeFormat(locale, {
                    timeZone: "Asia/Riyadh",
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!audit.isLoading && !audit.data?.length && <p>{p("noDenials")}</p>}
      </div>
      {selected > 0 && (
        <Modal
          title={`${p("edit")} — ${chosenUser?.name ?? ""}`}
          eyebrow={chosenUser?.username ?? ""}
          close={close}
        >
          {chosenUser?.role === "admin" ? (
            <p>{p("ownerHint")}</p>
          ) : target.isError ? (
            <p role="alert">{p("error")}</p>
          ) : !form || target.isFetching ? (
            <p>…</p>
          ) : (
            <form
              className="policy-form"
              onSubmit={e => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              {catalog.data && (
                <UserAccessFields
                  locale={locale}
                  form={form}
                  catalog={catalog.data}
                  onChange={value => setForm({ ...form, ...value })}
                />
              )}
              <div className="p1-actions">
                <button disabled={save.isPending}>{p("save")}</button>
                <button type="button" onClick={close} disabled={save.isPending}>
                  {p("close")}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
