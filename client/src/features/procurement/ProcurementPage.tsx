import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n";
import { procurementKinds, type ProcurementKind } from "@shared/procurement";
import { Dialog, Input, Pager } from "../operations/ui";
import { opText, opName, type OpLabel } from "../operations/copy";
import { RequisitionForm } from "./RequisitionForm";
import { RfqForm, QuotationForm, AwardForm } from "./SourcingForms";
import { OrderForm } from "./OrderForm";
import { LinkedDocuments } from "../documents/LinkedDocuments";
type User = { id: number; role: string; permissions: string[] };
const permitted = (user: User, permission: string) =>
  user.role === "admin" || user.permissions.includes(permission);
function ApprovalPanel({
  kind,
  id,
  instanceId,
  locale,
  user,
  onDone,
}: {
  kind: "requisitions" | "awards" | "orders";
  id: number;
  instanceId: number;
  locale: Locale;
  user: User;
  onDone: () => void;
}) {
  const history = trpc.workflows.history.useQuery(
    { id: instanceId },
    { enabled: permitted(user, "approvals.view") }
  );
  const [reason, setReason] = useState(""),
    [action, setAction] = useState<"approve" | "reject" | "return">("approve");
  const config = {
    onSuccess: onDone,
    onError: (e: { message: string }) => toast.error(e.message),
  };
  const request = trpc.procurement.decideRequisition.useMutation(config),
    award = trpc.procurement.decideAward.useMutation(config),
    order = trpc.procurement.decideOrder.useMutation(config);
  const permission =
    kind === "requisitions"
      ? "requests.approve"
      : kind === "awards"
        ? "awards.approve"
        : "orders.approve";
  const mutation =
    kind === "requisitions" ? request : kind === "awards" ? award : order;
  return (
    <section className="op-step">
      <h3>{opText(locale, "history")}</h3>
      {history.data?.decisions.map(({ decision, name, username }) => (
        <p key={decision.id}>
          {name ?? username} — {opText(locale, decision.action)} —{" "}
          {decision.reason}
        </p>
      ))}
      {history.data?.instance.status === "pending" &&
        permitted(user, permission) &&
        !history.data.instance.blockedActorIds.includes(user.id) && (
          <form
            className="op-form"
            onSubmit={e => {
              e.preventDefault();
              mutation.mutate({
                id,
                instanceId,
                expectedPosition: history.data!.instance.currentPosition,
                action,
                reason,
              });
            }}
          >
            <label>
              {opText(locale, "status")}
              <select
                value={action}
                onChange={e => setAction(e.target.value as typeof action)}
              >
                {(["approve", "reject", "return"] as const).map(a => (
                  <option value={a} key={a}>
                    {opText(locale, a)}
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
            <button disabled={mutation.isPending}>
              {opText(locale, "save")}
            </button>
          </form>
        )}
      {history.isError && <p role="alert">{opText(locale, "error")}</p>}
    </section>
  );
}
function EvaluationForm({
  id,
  locale,
  onClose,
}: {
  id: number;
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    quotationId: id,
    technical: 0,
    commercial: 0,
    delivery: 0,
    eligible: "yes" as "yes" | "no",
    reason: "",
  });
  const utils = trpc.useUtils();
  const save = trpc.procurement.evaluate.useMutation({
    onSuccess: () => {
      void utils.procurement.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="evaluate" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          save.mutate(data);
        }}
      >
        <div className="op-fields">
          {(["technical", "commercial", "delivery"] as const).map(k => (
            <Input
              key={k}
              label={k}
              type="number"
              value={String(data[k])}
              onChange={v => setData({ ...data, [k]: Number(v) })}
              locale={locale}
            />
          ))}
          <label>
            {opText(locale, "eligible")}
            <select
              value={data.eligible}
              onChange={e =>
                setData({ ...data, eligible: e.target.value as "yes" | "no" })
              }
            >
              <option value="yes">{opText(locale, "yes")}</option>
              <option value="no">{opText(locale, "no")}</option>
            </select>
          </label>
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
export function Detail({
  kind,
  id,
  locale,
  user,
  onClose,
  onOpen,
}: {
  kind: ProcurementKind;
  id: number;
  locale: Locale;
  user: User;
  onClose: () => void;
  onOpen: (kind: ProcurementKind, id: number) => void;
}) {
  const query = trpc.procurement.detail.useQuery({ kind, id });
  const utils = trpc.useUtils();
  const [reason, setReason] = useState(""),
    [edit, setEdit] = useState(false),
    [evaluate, setEvaluate] = useState(false);
  const done = () => {
    void utils.procurement.invalidate();
    void utils.workflows.invalidate();
    void utils.projects.invalidate();
  };
  const config = {
    onSuccess: done,
    onError: (e: { message: string }) => toast.error(e.message),
  };
  const req = trpc.procurement.submitRequisition.useMutation(config),
    award = trpc.procurement.submitAward.useMutation(config),
    order = trpc.procurement.submitOrder.useMutation(config),
    rfq = trpc.procurement.rfqStatus.useMutation(config),
    cancelOrder=trpc.procurement.cancelOrder.useMutation(config);
  const data = query.data;
  const status = data?.header.status;
  const creator = data?.header.createdBy === user.id;
  const canSubmit =
    creator &&
    (status === "draft" || status === "returned") &&
    (kind === "requisitions"
      ? permitted(user, "requests.submit")
      : kind === "awards"
        ? permitted(user, "awards.create")
        : kind === "orders"
          ? permitted(user, "orders.create")
          : false);
  const submit = () => {
    if (kind === "requisitions") req.mutate({ id });
    else if (kind === "awards") award.mutate({ id });
    else if (kind === "orders") order.mutate({ id });
  };
  const flowId =
    data && "workflowId" in data.header ? data.header.workflowId : null;
  return (
    <>
      <Dialog title="details" locale={locale} onClose={onClose}>
        {query.isLoading ? (
          <p>{opText(locale, "loading")}</p>
        ) : query.isError ? (
          <p role="alert">{opText(locale, "error")}</p>
        ) : (
          data && (
            <div className="op-page">
              <h3>
                {data.header.number} —{" "}
                {opText(
                  locale,
                  data.header.status === "received"
                    ? "receivedQuote"
                    : (data.header.status as OpLabel)
                )}
              </h3>
              {"total" in data.header && (
                <p>
                  {opText(locale, "total")}: {data.header.total}{" "}
                  {data.header.currency}
                </p>
              )}
              <div className="op-actions">
                {data.kind==="orders"&&creator&&["draft","returned","rejected"].includes(data.header.status)&&permitted(user,"orders.create")&&<><Input label="reason" value={reason} onChange={setReason} locale={locale} required={false}/><button disabled={cancelOrder.isPending||reason.trim().length<3} onClick={()=>cancelOrder.mutate({id,reason})}>{opText(locale,"cancelled")}</button></>}
                {canSubmit && (
                  <button
                    disabled={
                      req.isPending || award.isPending || order.isPending
                    }
                    onClick={submit}
                  >
                    {opText(locale, "submit")}
                  </button>
                )}
                {data.kind === "requisitions" &&
                  creator &&
                  ["draft", "returned", "rejected"].includes(
                    data.header.status
                  ) &&
                  permitted(user, "requests.create") && (
                    <button onClick={() => setEdit(true)}>
                      {opText(locale, "revise")}
                    </button>
                  )}
                {data.kind === "quotations" &&
                  data.header.status === "received" &&
                  !creator &&
                  permitted(user, "quotations.evaluate") && (
                    <button onClick={() => setEvaluate(true)}>
                      {opText(locale, "evaluate")}
                    </button>
                  )}
              </div>
              <div className="op-table">
                <table>
                  <thead>
                    <tr>
                      <th>{opText(locale, "sourceLine")}</th>
                      <th>{opText(locale, "description")}</th>
                      <th>{opText(locale, "quantity")}</th>
                      <th>{opText(locale, "total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.kind === "requisitions"
                      ? data.lines.map(({ line, item }) => (
                          <tr key={line.id}>
                            <td>#{line.id}</td>
                            <td>
                              {opName(item, locale)}
                              <br />
                              {line.description}
                            </td>
                            <td>{line.quantity}</td>
                            <td>{line.amount}</td>
                          </tr>
                        ))
                      : data.kind === "rfqs"
                        ? data.lines.map(({ line, item, source }) => (
                            <tr key={line.id}>
                              <td>
                                #{line.id}
                                <button
                                  onClick={() =>
                                    onOpen("requisitions", source.requisitionId)
                                  }
                                >
                                  PR #{source.requisitionId}
                                </button>
                              </td>
                              <td>{opName(item, locale)}</td>
                              <td>{line.quantity}</td>
                              <td>—</td>
                            </tr>
                          ))
                        : data.kind === "quotations"
                          ? data.lines.map(line => (
                              <tr key={line.id}>
                                <td>#{line.id}</td>
                                <td>
                                  <button
                                    onClick={() =>
                                      onOpen("rfqs", data.header.rfqId)
                                    }
                                  >
                                    RFQ #{data.header.rfqId}
                                  </button>
                                </td>
                                <td>
                                  {line.quantity} × {line.unitPrice}
                                </td>
                                <td>{line.total}</td>
                              </tr>
                            ))
                          : data.kind === "awards"
                            ? data.lines.map(({ line, quotation }) => (
                                <tr key={line.id}>
                                  <td>#{line.id}</td>
                                  <td>
                                    <button
                                      onClick={() =>
                                        onOpen("quotations", quotation.id)
                                      }
                                    >
                                      {quotation.number}
                                    </button>
                                  </td>
                                  <td>{line.quantity}</td>
                                  <td>{line.total}</td>
                                </tr>
                              ))
                            : data.lines.map(
                                ({
                                  line,
                                  item,
                                  requisition,
                                  rfq,
                                  quotation,
                                  award,
                                }) => (
                                  <tr key={line.id}>
                                    <td>#{line.id}</td>
                                    <td>
                                      {opName(item, locale)}
                                      {requisition && rfq && quotation && award && (
                                      <div className="op-actions">
                                        <button
                                          onClick={() =>
                                            onOpen(
                                              "requisitions",
                                              requisition.id
                                            )
                                          }
                                        >
                                          {requisition.number}
                                        </button>
                                        <button
                                          onClick={() => onOpen("rfqs", rfq.id)}
                                        >
                                          {rfq.number}
                                        </button>
                                        <button
                                          onClick={() =>
                                            onOpen("quotations", quotation.id)
                                          }
                                        >
                                          {quotation.number}
                                        </button>
                                        <button
                                          onClick={() =>
                                            onOpen("awards", award.id)
                                          }
                                        >
                                          {award.number}
                                        </button>
                                      </div>
                                      )}
                                    </td>
                                    <td>
                                      {line.quantity} × {line.unitPrice}
                                    </td>
                                    <td>{line.total}</td>
                                  </tr>
                                )
                              )}
                  </tbody>
                </table>
              </div>
              {data.kind === "orders" && (
                <section>
                  <LinkedDocuments entityType="scm_order" entityId={id} locale={locale} user={user}/>
                  <h4>{opText(locale, "schedule")}</h4>
                  {data.schedules.map(({ schedule }) => (
                    <p key={schedule.id}>
                      #{schedule.orderLineId} — {schedule.quantity} —{" "}
                      {schedule.dueDate} — {opText(locale, "warehouse")} #
                      {schedule.warehouseId}
                    </p>
                  ))}
                </section>
              )}
              {data.kind === "quotations" && data.evaluation && (
                <p>
                  {opText(locale, "evaluate")}: {data.evaluation.overall} —{" "}
                  {data.evaluation.reason}
                </p>
              )}
              {data.kind === "rfqs" &&
                permitted(user, "rfqs.create") &&
                ["draft", "open"].includes(data.header.status) && (
                  <form
                    className="op-form"
                    onSubmit={e => {
                      e.preventDefault();
                      rfq.mutate({
                        id,
                        status:
                          data.header.status === "draft" ? "open" : "closed",
                        reason,
                      });
                    }}
                  >
                    <Input
                      label="reason"
                      value={reason}
                      onChange={setReason}
                      locale={locale}
                    />
                    <button disabled={rfq.isPending}>
                      {opText(
                        locale,
                        data.header.status === "draft" ? "open" : "closed"
                      )}
                    </button>
                  </form>
                )}
              {flowId &&
                (kind === "requisitions" ||
                  kind === "awards" ||
                  kind === "orders") && (
                  <ApprovalPanel
                    kind={kind}
                    id={id}
                    instanceId={flowId}
                    locale={locale}
                    user={user}
                    onDone={done}
                  />
                )}
            </div>
          )
        )}
      </Dialog>
      {edit && data?.kind === "requisitions" && (
        <RequisitionForm
          locale={locale}
          onClose={() => setEdit(false)}
          existing={{
            id,
            version: data.header.version,
            data: {
              ...data.header,
              lines: data.lines.map(({ line }) => ({
                ...line,
                specification: line.specification ?? "",
              })),
            },
          }}
        />
      )}{" "}
      {evaluate && (
        <EvaluationForm
          id={id}
          locale={locale}
          onClose={() => setEvaluate(false)}
        />
      )}
    </>
  );
}
export function ProcurementPage({
  locale,
  user,
}: {
  locale: Locale;
  user: User;
}) {
  const [kind, setKind] = useState<ProcurementKind>("requisitions"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [form, setForm] = useState(false),
    [detail, setDetail] = useState<{
      kind: ProcurementKind;
      id: number;
    } | null>(null);
  const query = trpc.procurement.list.useQuery({
    kind,
    search,
    page,
    status: status || undefined,
  });
  const createPermission = {
    requisitions: "requests.create",
    rfqs: "rfqs.create",
    quotations: "quotations.create",
    awards: "awards.create",
    orders: "orders.create",
  }[kind];
  const statuses =
    kind === "rfqs"
      ? ["draft", "open", "closed", "cancelled"]
      : kind === "quotations"
        ? ["received", "evaluated", "disqualified"]
        : ["draft", "pending", "approved", "rejected", "returned", "cancelled"];
  return (
    <div className="op-page">
      <div className="op-toolbar">
        {procurementKinds.map(k => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setPage(1);
              setStatus("");
            }}
            className={kind === k ? "active" : ""}
          >
            {opText(locale, k)}
          </button>
        ))}
      </div>
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
        <select
          aria-label={opText(locale, "status")}
          value={status}
          onChange={e => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{opText(locale, "status")}</option>
          {statuses.map(s => (
            <option value={s} key={s}>
              {opText(
                locale,
                s === "received" ? "receivedQuote" : (s as OpLabel)
              )}
            </option>
          ))}
        </select>
        {permitted(user, createPermission) && (
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
                  <th>{opText(locale, "status")}</th>
                  <th>{opText(locale, "currency")}</th>
                  <th>{opText(locale, "details")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.records.map(r => (
                  <tr key={r.id}>
                    <td>{r.number}</td>
                    <td>
                      {opText(
                        locale,
                        r.status === "received"
                          ? "receivedQuote"
                          : (r.status as OpLabel)
                      )}
                    </td>
                    <td>{r.currency}</td>
                    <td>
                      <button onClick={() => setDetail({ kind, id: r.id })}>
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
      {form &&
        (kind === "requisitions" ? (
          <RequisitionForm locale={locale} onClose={() => setForm(false)} />
        ) : kind === "rfqs" ? (
          <RfqForm locale={locale} onClose={() => setForm(false)} />
        ) : kind === "quotations" ? (
          <QuotationForm locale={locale} onClose={() => setForm(false)} />
        ) : kind === "awards" ? (
          <AwardForm locale={locale} onClose={() => setForm(false)} />
        ) : (
          <OrderForm locale={locale} onClose={() => setForm(false)} />
        ))}
      {detail && (
        <Detail
          key={detail.kind + "-" + detail.id}
          {...detail}
          locale={locale}
          user={user}
          onClose={() => setDetail(null)}
          onOpen={(kind, id) => setDetail({ kind, id })}
        />
      )}
    </div>
  );
}
