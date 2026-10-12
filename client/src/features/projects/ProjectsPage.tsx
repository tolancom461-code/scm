import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { toast } from "sonner";
import { projectInput, wbsInput, budgetInput } from "@shared/projects";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { opText, opName, type OpLabel } from "../operations/copy";
import { Dialog, Input, Names, Pager, UserPicker } from "../operations/ui";
import { ReferencePicker } from "../master-data/MasterDataPage";
const blankNames = { nameAr: "", nameEn: "", nameUr: "" };
function ProjectForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    code: "",
    ...blankNames,
    branchId: 0,
    managerId: 0,
    currency: "SAR",
    startsAt: "",
    endsAt: "",
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.projects.create.useMutation({
    onSuccess: () => {
      void utils.projects.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="create" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = projectInput.safeParse({
            ...data,
            startsAt: data.startsAt || null,
            endsAt: data.endsAt || null,
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
            onChange={v => setData({ ...data, code: v })}
            locale={locale}
          />
          <Names
            data={data}
            setData={(k, v) => setData({ ...data, [k]: v })}
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
          <UserPicker
            module="projects"
            label="manager"
            value={data.managerId}
            onChange={v => setData({ ...data, managerId: v })}
            locale={locale}
          />
          <Input
            label="currency"
            value={data.currency}
            onChange={v => setData({ ...data, currency: v })}
            locale={locale}
          />
          {(["startsAt", "endsAt"] as const).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              type="date"
              required={false}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
type DetailData = inferRouterOutputs<AppRouter>["projects"]["detail"];
function WbsForm({
  detail,
  locale,
  onClose,
}: {
  detail: DetailData;
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    projectId: detail.project.id,
    parentId: null as number | null,
    code: "",
    ...blankNames,
    startsAt: "",
    endsAt: "",
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.projects.createWbs.useMutation({
    onSuccess: () => {
      void utils.projects.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="addWbs" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = wbsInput.safeParse({
            ...data,
            startsAt: data.startsAt || null,
            endsAt: data.endsAt || null,
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
            onChange={v => setData({ ...data, code: v })}
            locale={locale}
          />
          <Names
            data={data}
            setData={(k, v) => setData({ ...data, [k]: v })}
            locale={locale}
          />
          <label>
            {opText(locale, "parent")}
            <select
              value={data.parentId ?? ""}
              onChange={e =>
                setData({ ...data, parentId: Number(e.target.value) || null })
              }
            >
              <option value="">{opText(locale, "none")}</option>
              {detail.wbs.map(w => (
                <option value={w.id} key={w.id}>
                  {w.code} — {opName(w, locale)}
                </option>
              ))}
            </select>
          </label>
          {(["startsAt", "endsAt"] as const).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              type="date"
              required={false}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
function BudgetForm({
  detail,
  locale,
  onClose,
}: {
  detail: DetailData;
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    projectId: detail.project.id,
    wbsId: 0,
    costCenterId: 0,
    amount: "",
    reason: "",
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.projects.createBudget.useMutation({
    onSuccess: () => {
      void utils.projects.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  const replacesId =
    detail.budgets.find(
      b =>
        b.status === "approved" &&
        b.wbsId === data.wbsId &&
        b.costCenterId === data.costCenterId
    )?.id ?? null;
  return (
    <Dialog title="addBudget" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = budgetInput.safeParse({ ...data, replacesId });
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <div className="op-fields">
          <label>
            {opText(locale, "wbs")}
            <select
              required
              value={data.wbsId || ""}
              onChange={e =>
                setData({ ...data, wbsId: Number(e.target.value) })
              }
            >
              <option value="">{opText(locale, "select")}</option>
              {detail.wbs.map(w => (
                <option key={w.id} value={w.id}>
                  {w.code} — {opName(w, locale)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {opText(locale, "costCenter")}
            <ReferencePicker
              kind="costCenters"
              value={String(data.costCenterId || "")}
              onChange={v => setData({ ...data, costCenterId: Number(v) })}
              locale={locale}
            />
          </label>
          <Input
            label="amount"
            value={data.amount}
            onChange={v => setData({ ...data, amount: v })}
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
function ProjectDetail({
  id,
  locale,
  canManage,
  canApprove,
  userId,
  onClose,
}: {
  id: number;
  locale: Locale;
  canManage: boolean;
  canApprove: boolean;
  userId: number;
  onClose: () => void;
}) {
  const query = trpc.projects.detail.useQuery({ id }),
    utils = trpc.useUtils();
  const [form, setForm] = useState<"wbs" | "budget" | null>(null),
    [reason, setReason] = useState(""),
    [status, setStatus] = useState<
      "active" | "on_hold" | "completed" | "cancelled"
    >("active"),
    [decision, setDecision] = useState<{
      id: number;
      action: "approve" | "reject";
    } | null>(null);
  const change = trpc.projects.status.useMutation({
    onSuccess: () => {
      void utils.projects.invalidate();
      setReason("");
    },
    onError: e => toast.error(e.message),
  });
  const approve = trpc.projects.approveBudget.useMutation({
    onSuccess: () => {
      void utils.projects.invalidate();
      setDecision(null);
      setReason("");
    },
    onError: e => toast.error(e.message),
  });
  const detail = query.data;
  return (
    <>
      <Dialog title="details" locale={locale} onClose={onClose}>
        {query.isLoading ? (
          <p>{opText(locale, "loading")}</p>
        ) : query.isError ? (
          <p role="alert">{opText(locale, "error")}</p>
        ) : (
          detail && (
            <div className="op-page">
              <h3>
                {detail.project.code} — {opName(detail.project, locale)} —{" "}
                {opText(locale, detail.project.status)}
              </h3>
              <div className="op-metrics">
                {Object.entries(detail.metrics).map(([k, v]) => (
                  <div className="op-metric" key={k}>
                    <span>{opText(locale, k as OpLabel)}</span>
                    <strong>
                      {v} {detail.project.currency}
                    </strong>
                  </div>
                ))}
              </div>
              {canManage &&
                ["planning", "active"].includes(detail.project.status) && (
                  <div className="op-actions">
                    <button onClick={() => setForm("wbs")}>
                      {opText(locale, "addWbs")}
                    </button>
                    <button onClick={() => setForm("budget")}>
                      {opText(locale, "addBudget")}
                    </button>
                  </div>
                )}
              <h3>{opText(locale, "wbs")}</h3>
              <div className="op-table">
                <table>
                  <tbody>
                    {detail.wbs.map(w => (
                      <tr key={w.id}>
                        <td>{w.code}</td>
                        <td>{opName(w, locale)}</td>
                        <td>
                          {w.startsAt} – {w.endsAt}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>{opText(locale, "budgets")}</h3>
              <div className="op-table">
                <table>
                  <thead>
                    <tr>
                      <th>{opText(locale, "wbs")}</th>
                      <th>{opText(locale, "costCenter")}</th>
                      <th>{opText(locale, "amount")}</th>
                      <th>{opText(locale, "status")}</th>
                      <th>{opText(locale, "approve")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.budgets.map(b => (
                      <tr key={b.id}>
                        <td>{detail.wbs.find(w => w.id === b.wbsId)?.code}</td>
                        <td>#{b.costCenterId}</td>
                        <td>{b.amount}</td>
                        <td>{opText(locale, b.status)}</td>
                        <td>
                          {canApprove &&
                            b.status === "draft" &&
                            b.createdBy !== userId && (
                              <div className="op-actions">
                                <button
                                  onClick={() => {
                                    setReason("");
                                    setDecision({
                                      id: b.id,
                                      action: "approve",
                                    });
                                  }}
                                >
                                  {opText(locale, "approve")}
                                </button>
                                <button
                                  onClick={() => {
                                    setReason("");
                                    setDecision({ id: b.id, action: "reject" });
                                  }}
                                >
                                  {opText(locale, "reject")}
                                </button>
                              </div>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManage &&
                !["completed", "cancelled"].includes(detail.project.status) && (
                  <form
                    className="op-form"
                    onSubmit={e => {
                      e.preventDefault();
                      change.mutate({
                        id,
                        version: detail.project.version,
                        status,
                        reason,
                      });
                    }}
                  >
                    <div className="op-fields">
                      <label>
                        {opText(locale, "status")}
                        <select
                          value={status}
                          onChange={e =>
                            setStatus(e.target.value as typeof status)
                          }
                        >
                          {(
                            [
                              "active",
                              "on_hold",
                              "completed",
                              "cancelled",
                            ] as const
                          ).map(s => (
                            <option value={s} key={s}>
                              {opText(locale, s)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Input
                        label="reason"
                        value={reason}
                        onChange={setReason}
                        locale={locale}
                      />
                    </div>
                    <button disabled={change.isPending}>
                      {opText(locale, "save")}
                    </button>
                  </form>
                )}
            </div>
          )
        )}
      </Dialog>
      {detail && form === "wbs" && (
        <WbsForm
          detail={detail}
          locale={locale}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {detail && form === "budget" && (
        <BudgetForm
          detail={detail}
          locale={locale}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {decision && (
        <Dialog
          title={decision.action}
          locale={locale}
          onClose={() => setDecision(null)}
        >
          <form
            className="op-form"
            onSubmit={e => {
              e.preventDefault();
              approve.mutate({ ...decision, reason });
            }}
          >
            <Input
              label="reason"
              value={reason}
              onChange={setReason}
              locale={locale}
            />
            <button disabled={approve.isPending}>
              {opText(locale, "save")}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function ProjectsPage({
  locale,
  canManage,
  canApprove,
  userId,
}: {
  locale: Locale;
  canManage: boolean;
  canApprove: boolean;
  userId: number;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [form, setForm] = useState(false),
    [id, setId] = useState<number | null>(null);
  const query = trpc.projects.list.useQuery({ search, page });
  return (
    <div className="op-page">
      <div className="op-toolbar">
        <input
          aria-label={opText(locale, "search")}
          placeholder={opText(locale, "search")}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        {canManage && (
          <button onClick={() => setForm(true)}>
            {opText(locale, "create")}
          </button>
        )}
      </div>
      <section className="op-panel">
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
                  <th>{opText(locale, "projects")}</th>
                  <th>{opText(locale, "status")}</th>
                  <th>{opText(locale, "details")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.records.map(r => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{opName(r, locale)}</td>
                    <td>{opText(locale, r.status)}</td>
                    <td>
                      <button onClick={() => setId(r.id)}>
                        {opText(locale, "details")}
                      </button>
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
      {form && <ProjectForm locale={locale} onClose={() => setForm(false)} />}{" "}
      {id !== null && (
        <ProjectDetail
          id={id}
          locale={locale}
          canManage={canManage}
          canApprove={canApprove}
          userId={userId}
          onClose={() => setId(null)}
        />
      )}
    </div>
  );
}
