import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { toast } from "sonner";
import {
  workflowTypes,
  definitionInput,
  delegationInput,
} from "@shared/workflows";
import { opText, opName, type OpLabel } from "../operations/copy";
import { Dialog, Input, Names, Pager, UserPicker } from "../operations/ui";
const blankNames = { nameAr: "", nameEn: "", nameUr: "" };
function DefinitionForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    code: "",
    ...blankNames,
    entityType: "requisition" as (typeof workflowTypes)[number],
    currency: "SAR",
    department: "*",
    minAmount: "0",
    maxAmount: "",
    steps: [{ ...blankNames, approvers: [{ userId: 0, limit: "1000000" }] }],
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.workflows.create.useMutation({
    onSuccess: () => {
      void utils.workflows.invalidate();
      toast.success(opText(locale, "saved"));
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  const change = (
    index: number,
    k: "nameAr" | "nameEn" | "nameUr",
    v: string
  ) =>
    setData({
      ...data,
      steps: data.steps.map((s, i) => (i === index ? { ...s, [k]: v } : s)),
    });
  return (
    <Dialog title="definition" onClose={onClose} locale={locale}>
      <p>{opText(locale, "immutable")}</p>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = definitionInput.safeParse({
            ...data,
            maxAmount: data.maxAmount || null,
          });
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          <Input
            label="code"
            value={data.code}
            onChange={code => setData({ ...data, code })}
            locale={locale}
          />
          <Names
            data={data}
            setData={(k, v) => setData({ ...data, [k]: v })}
            locale={locale}
          />
          <label>
            {opText(locale, "entityType")}
            <select
              value={data.entityType}
              onChange={e =>
                setData({
                  ...data,
                  entityType: e.target.value as (typeof workflowTypes)[number],
                })
              }
            >
              {workflowTypes.map(type => (
                <option key={type} value={type}>
                  {opText(locale, type)}
                </option>
              ))}
            </select>
          </label>
          {(["currency", "department", "minAmount", "maxAmount"] as const).map(
            k => (
              <Input
                key={k}
                label={k}
                value={data[k]}
                required={k !== "maxAmount"}
                onChange={v => setData({ ...data, [k]: v })}
                locale={locale}
              />
            )
          )}
        </div>
        <h3>{opText(locale, "steps")}</h3>
        {data.steps.map((step, index) => (
          <section key={index} className="op-step">
            <strong>{index + 1}</strong>
            <div className="op-fields">
              <Names
                data={step}
                setData={(k, v) => change(index, k, v)}
                locale={locale}
              />
            </div>
            {step.approvers.map((a, ai) => (
              <div className="op-fields" key={ai}>
                <UserPicker
                  module="workflows"
                  label="approver"
                  value={a.userId}
                  onChange={v =>
                    setData({
                      ...data,
                      steps: data.steps.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              approvers: s.approvers.map((x, j) =>
                                j === ai ? { ...x, userId: v } : x
                              ),
                            }
                          : s
                      ),
                    })
                  }
                  locale={locale}
                />
                <Input
                  label="limit"
                  value={a.limit}
                  onChange={v =>
                    setData({
                      ...data,
                      steps: data.steps.map((s, i) =>
                        i === index
                          ? {
                              ...s,
                              approvers: s.approvers.map((x, j) =>
                                j === ai ? { ...x, limit: v } : x
                              ),
                            }
                          : s
                      ),
                    })
                  }
                  locale={locale}
                />
                {step.approvers.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setData({
                        ...data,
                        steps: data.steps.map((s, i) =>
                          i === index
                            ? {
                                ...s,
                                approvers: s.approvers.filter(
                                  (_, j) => j !== ai
                                ),
                              }
                            : s
                        ),
                      })
                    }
                  >
                    {opText(locale, "remove")}
                  </button>
                )}
              </div>
            ))}
            <div className="op-actions">
              <button
                type="button"
                onClick={() =>
                  setData({
                    ...data,
                    steps: data.steps.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            approvers: [
                              ...s.approvers,
                              { userId: 0, limit: "1000000" },
                            ],
                          }
                        : s
                    ),
                  })
                }
              >
                {opText(locale, "addApprover")}
              </button>
              {data.steps.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setData({
                      ...data,
                      steps: data.steps.filter((_, i) => i !== index),
                    })
                  }
                >
                  {opText(locale, "remove")}
                </button>
              )}
            </div>
          </section>
        ))}
        <div className="op-actions">
          <button
            type="button"
            onClick={() =>
              setData({
                ...data,
                steps: [
                  ...data.steps,
                  {
                    ...blankNames,
                    approvers: [{ userId: 0, limit: "1000000" }],
                  },
                ],
              })
            }
          >
            {opText(locale, "addStep")}
          </button>
          <button disabled={save.isPending}>{opText(locale, "save")}</button>
        </div>
      </form>
    </Dialog>
  );
}
function DelegationForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    fromUserId: 0,
    toUserId: 0,
    entityType: "requisition" as (typeof workflowTypes)[number],
    startsAt: "",
    endsAt: "",
    reason: "",
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.workflows.delegate.useMutation({
    onSuccess: () => {
      void utils.workflows.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="delegations" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = delegationInput.safeParse({
            ...data,
            startsAt: new Date(data.startsAt),
            endsAt: new Date(data.endsAt),
          });
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          <UserPicker
            module="workflows"
            label="fromUser"
            value={data.fromUserId}
            onChange={v => setData({ ...data, fromUserId: v })}
            locale={locale}
          />
          <UserPicker
            module="workflows"
            label="toUser"
            value={data.toUserId}
            onChange={v => setData({ ...data, toUserId: v })}
            locale={locale}
          />
          <label>
            {opText(locale, "entityType")}
            <select
              value={data.entityType}
              onChange={e =>
                setData({
                  ...data,
                  entityType: e.target.value as (typeof workflowTypes)[number],
                })
              }
            >
              {workflowTypes.map(type => (
                <option key={type} value={type}>
                  {opText(locale, type)}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="startsAt"
            value={data.startsAt}
            type="datetime-local"
            onChange={v => setData({ ...data, startsAt: v })}
            locale={locale}
          />
          <Input
            label="endsAt"
            value={data.endsAt}
            type="datetime-local"
            onChange={v => setData({ ...data, endsAt: v })}
            locale={locale}
          />
          <Input
            label="reason"
            value={data.reason}
            onChange={v => setData({ ...data, reason: v })}
            locale={locale}
          />
        </div>
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
function WorkflowDetail({
  id,
  locale,
  canManage,
  onClose,
}: {
  id: number;
  locale: Locale;
  canManage: boolean;
  onClose: () => void;
}) {
  const query = trpc.workflows.detail.useQuery({ id });
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const deactivate = trpc.workflows.deactivate.useMutation({
    onSuccess: () => {
      void utils.workflows.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="details" locale={locale} onClose={onClose}>
      {query.isLoading ? (
        <p>{opText(locale, "loading")}</p>
      ) : query.isError ? (
        <p role="alert">{opText(locale, "error")}</p>
      ) : (
        query.data && (
          <>
            <h3>
              {opName(query.data.definition, locale)} —{" "}
              {query.data.definition.code} v{query.data.definition.version}
            </h3>
            <p>{opText(locale, "immutable")}</p>
            {query.data.steps.map(s => (
              <section className="op-step" key={s.id}>
                <strong>
                  {s.position}. {opName(s, locale)}
                </strong>
                {s.approvers.map(a => (
                  <p key={a.userId}>
                    {a.name ?? a.username} — {opText(locale, "limit")}:{" "}
                    {a.limit}
                  </p>
                ))}
              </section>
            ))}
            {canManage && query.data.definition.active === "yes" && (
              <form
                className="op-form"
                onSubmit={e => {
                  e.preventDefault();
                  deactivate.mutate({ id, reason });
                }}
              >
                <Input
                  label="reason"
                  value={reason}
                  onChange={setReason}
                  locale={locale}
                />
                <button disabled={deactivate.isPending}>
                  {opText(locale, "deactivate")}
                </button>
              </form>
            )}
          </>
        )
      )}
    </Dialog>
  );
}
export function WorkflowsPage({
  locale,
  canManage,
}: {
  locale: Locale;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<"definitions" | "delegations">("definitions"),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [form, setForm] = useState(false),
    [id, setId] = useState<number | null>(null),
    [revokeId, setRevokeId] = useState<number | null>(null),
    [reason, setReason] = useState("");
  const list = trpc.workflows.list.useQuery(
    { page, search },
    { enabled: tab === "definitions" }
  );
  const delegationList = trpc.workflows.delegationList.useQuery(
    { page },
    { enabled: tab === "delegations" }
  );
  const utils = trpc.useUtils();
  const revoke = trpc.workflows.revoke.useMutation({
    onSuccess: () => {
      void utils.workflows.invalidate();
      setRevokeId(null);
    },
    onError: e => toast.error(e.message),
  });
  const query = tab === "definitions" ? list : delegationList;
  return (
    <div className="op-page">
      <div className="op-toolbar">
        <button
          onClick={() => {
            setTab("definitions");
            setPage(1);
          }}
        >
          {opText(locale, "workflows")}
        </button>
        <button
          onClick={() => {
            setTab("delegations");
            setPage(1);
          }}
        >
          {opText(locale, "delegations")}
        </button>
        {canManage && (
          <button onClick={() => setForm(true)}>
            {opText(locale, "create")}
          </button>
        )}
      </div>
      <section className="op-panel">
        {tab === "definitions" && (
          <Input
            label="search"
            required={false}
            value={search}
            onChange={v => {
              setSearch(v);
              setPage(1);
            }}
            locale={locale}
          />
        )}{" "}
        {query.isLoading ? (
          <p>{opText(locale, "loading")}</p>
        ) : query.isError ? (
          <p role="alert">{opText(locale, "error")}</p>
        ) : (
          <div className="op-table">
            <table>
              <thead>
                <tr>
                  <th>{opText(locale, "code")}</th>
                  <th>{opText(locale, "entityType")}</th>
                  <th>{opText(locale, "status")}</th>
                  <th>{opText(locale, "details")}</th>
                </tr>
              </thead>
              <tbody>
                {tab === "definitions"
                  ? list.data?.records.map(r => (
                      <tr key={r.id}>
                        <td>
                          {r.code} v{r.version}
                          <br />
                          {opName(r, locale)}
                        </td>
                        <td>
                          {opText(locale, r.entityType as OpLabel)}
                          <br />
                          {r.minAmount} – {r.maxAmount ?? "∞"} {r.currency}
                        </td>
                        <td>{opText(locale, r.active)}</td>
                        <td>
                          <button onClick={() => setId(r.id)}>
                            {opText(locale, "details")}
                          </button>
                        </td>
                      </tr>
                    ))
                  : delegationList.data?.records.map(r => (
                      <tr key={r.id}>
                        <td>
                          #{r.fromUserId} → #{r.toUserId}
                        </td>
                        <td>{opText(locale, r.entityType as OpLabel)}</td>
                        <td>
                          {r.startsAt.toLocaleString()} –{" "}
                          {r.endsAt.toLocaleString()}
                          <br />
                          {r.revokedAt && opText(locale, "revoked")}
                        </td>
                        <td>
                          {canManage && !r.revokedAt && (
                            <button
                              onClick={() => {
                                setRevokeId(r.id);
                                setReason("");
                              }}
                            >
                              {opText(locale, "revoke")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {query.data?.total === 0 && <p>{opText(locale, "empty")}</p>}
          </div>
        )}
        <Pager
          page={page}
          total={query.data?.total ?? 0}
          setPage={setPage}
          locale={locale}
        />
      </section>
      {form &&
        (tab === "definitions" ? (
          <DefinitionForm locale={locale} onClose={() => setForm(false)} />
        ) : (
          <DelegationForm locale={locale} onClose={() => setForm(false)} />
        ))}
      {id !== null && (
        <WorkflowDetail
          id={id}
          locale={locale}
          canManage={canManage}
          onClose={() => setId(null)}
        />
      )}{" "}
      {revokeId !== null && (
        <Dialog
          title="revoke"
          locale={locale}
          onClose={() => setRevokeId(null)}
        >
          <form
            className="op-form"
            onSubmit={e => {
              e.preventDefault();
              revoke.mutate({ id: revokeId, reason });
            }}
          >
            <Input
              label="reason"
              value={reason}
              onChange={setReason}
              locale={locale}
            />
            <button disabled={revoke.isPending}>
              {opText(locale, "save")}
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
