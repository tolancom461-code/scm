import { trpc } from "@/lib/trpc";
import { t, localeMeta, type Locale, type TranslationKey } from "@/lib/i18n";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Input,
  PageFrame,
  Table,
  Modal,
  FormFooter,
} from "@/features/workspace/ui";
import { userText } from "./copy";
import "./users.css";
import {
  UserAccessFields,
  type UserAccessForm,
} from "../policy/UserAccessFields";
import { roleTemplates, type AccessTemplate } from "@shared/policy";
import { policyText } from "../policy/copy";

type User = {
  id: number;
  username: string | null;
  name: string | null;
  email: string | null;
  preferredLocale: Locale;
  role: string;
  active: boolean;
  template: string | null;
};
type Dialog = { kind: "edit" | "password" | "status"; user: User } | null;
export function UsersPage({
  locale,
  managePolicy,
}: {
  locale: Locale;
  managePolicy?: (id: number) => void;
}) {
  const t9 = (key: TranslationKey) => t(locale, key),
    p = (key: Parameters<typeof userText>[1]) => userText(locale, key);
  const utils = trpc.useUtils(),
    me = trpc.auth.me.useQuery();
  const can = (code: string) =>
    me.data?.role === "admin" || !!me.data?.permissions.includes(code);
  const users = trpc.users.list.useQuery();
  const catalog = trpc.policy.catalog.useQuery(undefined, {
    enabled: can("policy.manage"),
  });
  const [open, setOpen] = useState(false),
    [dialog, setDialog] = useState<Dialog>(null);
  const emptyAccess: UserAccessForm = {
    template: "custom",
    permissions: [],
    allProjects: false,
    projectIds: [],
    legacyAccess: false,
  };
  const [createAccess, setCreateAccess] = useState<UserAccessForm>(emptyAccess);
  const [editAccess, setEditAccess] = useState<
    (UserAccessForm & { version: number }) | null
  >(null);
  const targetPolicy = trpc.policy.user.useQuery(
    { userId: dialog?.user.id ?? 0 },
    {
      enabled:
        dialog?.kind === "edit" &&
        dialog.user.role !== "admin" &&
        can("policy.manage"),
      refetchOnWindowFocus: false,
    }
  );
  useEffect(() => {
    if (
      dialog?.kind === "edit" &&
      targetPolicy.data &&
      !targetPolicy.isFetching
    )
      setEditAccess(targetPolicy.data);
  }, [targetPolicy.data, targetPolicy.isFetching, dialog?.user.id]);
  const editingPolicy =
    dialog?.kind === "edit" &&
    dialog.user.role !== "admin" &&
    can("policy.manage");
  const accessReady = !!catalog.data && !catalog.isError;
  const emptyForm = {
    username: "",
    name: "",
    email: "",
    password: "",
    permissions: [] as string[],
  };
  const [form, setForm] = useState(emptyForm);
  const [profile, setProfile] = useState({
    username: "",
    name: "",
    email: "",
    locale,
  });
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const close = () => {
    setDialog(null);
    setPassword("");
    setConfirmation("");
  };
  const done = (message: string) => {
    void utils.users.list.invalidate();
    void utils.policy.invalidate();
    void utils.phaseOne.invalidate();
    toast.success(message);
    close();
  };
  const create = trpc.users.create.useMutation({
    onSuccess: () => {
      void utils.users.list.invalidate();
      void utils.policy.invalidate();
      toast.success(t9("userCreated"));
      setOpen(false);
      setForm(emptyForm);
    },
    onError: e => toast.error(e.message),
  });
  const update = trpc.users.update.useMutation({
    onSuccess: () => {
      done(p("saved"));
      void utils.auth.me.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const reset = trpc.users.resetPassword.useMutation({
    onSuccess: result => {
      done(p("passwordSaved"));
      if (result.requiresLogin) window.location.reload();
    },
    onError: e => toast.error(e.message),
  });
  const status = trpc.users.setActive.useMutation({
    onSuccess: () => done(p(dialog?.user.active ? "deactivated" : "activated")),
    onError: e => toast.error(e.message),
  });
  const pending = update.isPending || reset.isPending || status.isPending;
  const openAction = (kind: NonNullable<Dialog>["kind"], user: User) => {
    setEditAccess(null);
    setProfile({
      username: user.username ?? "",
      name: user.name ?? "",
      email: user.email ?? "",
      locale: user.preferredLocale,
    });
    setPassword("");
    setConfirmation("");
    setDialog({ kind, user });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending || (can("policy.manage") && !accessReady)) return;
    create.mutate({
      username: form.username,
      name: form.name,
      email: form.email || undefined,
      password: form.password,
      permissions: form.permissions,
      locale,
      accessPolicy: can("policy.manage") ? createAccess : undefined,
    });
  };
  return (
    <div className="users-page">
      <PageFrame
        locale={locale}
        title="users"
        action={
          can("users.create")
            ? () => {
                setForm(emptyForm);
                setCreateAccess(emptyAccess);
                setOpen(true);
              }
            : undefined
        }
        actionLabel="addUser"
      >
        {users.isError ? (
          <div role="alert">
            {p("error")}{" "}
            <button onClick={() => users.refetch()}>{p("retry")}</button>
          </div>
        ) : (
          <Table
            headers={[
              t9("account"),
              t9("name"),
              t9("email"),
              policyText(locale, "role"),
              t9("status"),
              t9("permissions"),
              p("actions"),
            ]}
            rows={(users.data ?? []).map(item => {
              const manageTarget =
                item.role !== "admin" || me.data?.role === "admin";
              return [
                item.username ?? "—",
                item.name ?? "—",
                item.email ?? "—",
                item.role === "admin"
                  ? p("fullAccess")
                  : (roleTemplates[
                      (item.template ?? "custom") as AccessTemplate
                    ]?.labels[locale === "en" ? 1 : locale === "ur" ? 2 : 0] ??
                    "—"),
                <span
                  key={item.id}
                  className={`status ${item.active ? "active" : "blocked"}`}
                >
                  <i />
                  {p(item.active ? "active" : "inactive")}
                </span>,
                item.role === "admin" ? (
                  p("fullAccess")
                ) : can("policy.manage") && manageTarget ? (
                  managePolicy ? (
                    <button
                      className="table-action"
                      onClick={() => managePolicy(item.id)}
                    >
                      {p("configurePolicy")}
                    </button>
                  ) : (
                    <ManageUserPermissions
                      key={`${item.id}-permissions`}
                      userId={item.id}
                      locale={locale}
                    />
                  )
                ) : (
                  "—"
                ),
                <div className="users-actions" key={`${item.id}-actions`}>
                  {can("users.edit") && manageTarget && (
                    <button
                      className="table-action"
                      onClick={() => openAction("edit", item)}
                    >
                      {p("edit")}
                    </button>
                  )}
                  {can("users.password.reset") && manageTarget && (
                    <button
                      className="table-action"
                      onClick={() => openAction("password", item)}
                    >
                      {p("password")}
                    </button>
                  )}
                  {can("users.status.manage") && manageTarget && (
                    <button
                      className={`table-action ${item.active ? "reject" : "accept"}`}
                      disabled={item.active && item.id === me.data?.id}
                      title={
                        item.id === me.data?.id ? p("selfDisable") : undefined
                      }
                      onClick={() => openAction("status", item)}
                    >
                      {p(item.active ? "deactivate" : "activate")}
                    </button>
                  )}
                </div>,
              ];
            })}
            empty={users.isLoading ? "…" : t9("noData")}
          />
        )}
      </PageFrame>
      {open && (
        <Modal
          title={t9("addUser")}
          onClose={() => {
            if (!create.isPending) {
              setOpen(false);
              setForm(emptyForm);
            }
          }}
        >
          <form onSubmit={submit} className="form-grid">
            <Input label={t9("username")} required>
              <input
                autoComplete="off"
                minLength={3}
                maxLength={80}
                pattern="[a-zA-Z0-9._-]+"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                required
              />
            </Input>
            <Input label={t9("name")} required>
              <input
                minLength={2}
                maxLength={150}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
              />
            </Input>
            <Input label={t9("email")}>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </Input>
            <Input label={t9("password")} required>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
            </Input>
            {can("policy.manage") && (
              <div className="users-policy-fields">
                <p className="users-hint">{p("policyHint")}</p>
                {catalog.isError ? (
                  <p role="alert">{p("error")}</p>
                ) : catalog.data ? (
                  <UserAccessFields
                    locale={locale}
                    form={createAccess}
                    onChange={setCreateAccess}
                    catalog={catalog.data}
                  />
                ) : (
                  <p>…</p>
                )}
              </div>
            )}
            {!can("policy.manage") && (
              <Input label={policyText(locale, "role")}>
                <select
                  aria-label={policyText(locale, "role")}
                  disabled
                  value="custom"
                >
                  <option value="custom">
                    {
                      roleTemplates.custom.labels[
                        locale === "en" ? 1 : locale === "ur" ? 2 : 0
                      ]
                    }
                  </option>
                </select>
              </Input>
            )}
            <FormFooter
              t9={t9}
              pending={
                create.isPending || (can("policy.manage") && !accessReady)
              }
            />
          </form>
        </Modal>
      )}
      {dialog && (
        <Modal
          title={p(
            dialog.kind === "edit"
              ? "edit"
              : dialog.kind === "password"
                ? "password"
                : dialog.user.active
                  ? "deactivate"
                  : "activate"
          )}
          eyebrow={dialog.user.username ?? ""}
          onClose={() => {
            if (!pending) close();
          }}
        >
          <form
            className="form-grid users-form"
            onSubmit={e => {
              e.preventDefault();
              if (
                pending ||
                (editingPolicy &&
                  (!editAccess ||
                    targetPolicy.isFetching ||
                    targetPolicy.isError ||
                    !accessReady))
              )
                return;
              if (dialog.kind === "edit")
                update.mutate({
                  userId: dialog.user.id,
                  ...profile,
                  accessPolicy:
                    editingPolicy && editAccess ? editAccess : undefined,
                });
              else if (dialog.kind === "password") {
                if (password !== confirmation) {
                  toast.error(p("mismatch"));
                  return;
                }
                reset.mutate({
                  userId: dialog.user.id,
                  password,
                  confirmation,
                });
              } else
                status.mutate({
                  userId: dialog.user.id,
                  active: !dialog.user.active,
                });
            }}
          >
            {dialog.kind === "edit" ? (
              <>
                <Input label={t9("username")} required>
                  <input
                    autoComplete="off"
                    minLength={3}
                    maxLength={80}
                    pattern="[a-zA-Z0-9._-]+"
                    value={profile.username}
                    onChange={e =>
                      setProfile({ ...profile, username: e.target.value })
                    }
                    required
                  />
                </Input>
                <Input label={t9("name")} required>
                  <input
                    minLength={2}
                    maxLength={150}
                    value={profile.name}
                    onChange={e =>
                      setProfile({ ...profile, name: e.target.value })
                    }
                    required
                  />
                </Input>
                <Input label={t9("email")}>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={e =>
                      setProfile({ ...profile, email: e.target.value })
                    }
                  />
                </Input>
                <Input label={t9("language")}>
                  <select
                    aria-label={t9("language")}
                    value={profile.locale}
                    onChange={e =>
                      setProfile({
                        ...profile,
                        locale: e.target.value as Locale,
                      })
                    }
                  >
                    {(Object.keys(localeMeta) as Locale[]).map(l => (
                      <option key={l} value={l}>
                        {localeMeta[l].label}
                      </option>
                    ))}
                  </select>
                </Input>
                <div className="users-policy-fields">
                  {editingPolicy ? (
                    targetPolicy.isError || catalog.isError ? (
                      <p role="alert">{p("error")}</p>
                    ) : !editAccess ||
                      targetPolicy.isFetching ||
                      !catalog.data ? (
                      <p>…</p>
                    ) : (
                      <UserAccessFields
                        locale={locale}
                        form={editAccess}
                        catalog={catalog.data}
                        onChange={value =>
                          setEditAccess({ ...editAccess, ...value })
                        }
                      />
                    )
                  ) : (
                    <Input label={policyText(locale, "role")}>
                      <select
                        aria-label={policyText(locale, "role")}
                        disabled
                        value={
                          dialog.user.role === "admin"
                            ? "admin"
                            : (dialog.user.template ?? "custom")
                        }
                      >
                        <option value="admin">{p("fullAccess")}</option>
                        {Object.entries(roleTemplates).map(
                          ([code, template]) => (
                            <option key={code} value={code}>
                              {
                                template.labels[
                                  locale === "en" ? 1 : locale === "ur" ? 2 : 0
                                ]
                              }
                            </option>
                          )
                        )}
                      </select>
                    </Input>
                  )}
                </div>
              </>
            ) : dialog.kind === "password" ? (
              <>
                <Input label={p("newPassword")} required>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </Input>
                <Input label={p("confirmation")} required>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    onChange={e => setConfirmation(e.target.value)}
                    required
                  />
                </Input>
                <p className="users-hint">
                  {p("passwordHint")}
                  {dialog.user.id === me.data?.id && (
                    <> {p("selfPasswordHint")}</>
                  )}
                </p>
              </>
            ) : (
              <p className="users-hint">
                {p(dialog.user.active ? "deactivateHint" : "activateHint")}
              </p>
            )}
            <div className="form-footer">
              <button
                type="button"
                className="table-action"
                disabled={pending}
                onClick={close}
              >
                {t9("cancel")}
              </button>
              <button
                className="neo-button"
                disabled={
                  pending ||
                  (editingPolicy &&
                    (!editAccess ||
                      targetPolicy.isFetching ||
                      targetPolicy.isError ||
                      !accessReady))
                }
              >
                {dialog.kind === "status"
                  ? p(dialog.user.active ? "deactivate" : "activate")
                  : t9("save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function ManageUserPermissions({
  userId,
  locale,
}: {
  userId: number;
  locale: Locale;
}) {
  const t9 = (key: TranslationKey) => t(locale, key),
    utils = trpc.useUtils();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const current = trpc.users.permissions.useQuery(
    { userId },
    { enabled: open }
  );
  const catalog = trpc.permissions.list.useQuery(undefined, { enabled: open });
  const update = trpc.users.setPermissions.useMutation({
    onSuccess: () => {
      void utils.users.permissions.invalidate({ userId });
      toast.success(t9("actionDone"));
      setOpen(false);
    },
    onError: e => toast.error(e.message),
  });
  useEffect(() => {
    if (current.data) setSelected(current.data);
  }, [current.data]);
  const toggle = (code: string) =>
    setSelected(value =>
      value.includes(code)
        ? value.filter(item => item !== code)
        : [...value, code]
    );
  if (!open)
    return (
      <button className="table-action" onClick={() => setOpen(true)}>
        {t9("grant")}
      </button>
    );
  return (
    <Modal
      title={t9("permissions")}
      onClose={() => {
        if (!update.isPending) setOpen(false);
      }}
    >
      <div className="permission-picker">
        <div className="picker-title">
          <ShieldCheck size={16} /> {t9("permissions")}
        </div>
        {(catalog.data ?? []).map(item => (
          <label className="permission-option" key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.code)}
              onChange={() => toggle(item.code)}
            />
            <span>
              {locale === "en"
                ? item.labelEn
                : locale === "ur"
                  ? item.labelUr
                  : item.labelAr}
            </span>
            <code>{item.code}</code>
          </label>
        ))}
      </div>
      <div className="form-footer">
        <button
          className="neo-button"
          onClick={() => update.mutate({ userId, permissions: selected })}
          disabled={
            update.isPending ||
            current.isLoading ||
            current.isError ||
            catalog.isError
          }
        >
          {t9("save")}
          <ShieldCheck size={16} />
        </button>
      </div>
    </Modal>
  );
}
