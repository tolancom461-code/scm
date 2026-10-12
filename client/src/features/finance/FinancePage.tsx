import { useState } from "react";
import { businessDate } from "@shared/date";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { Dialog, Input, Pager } from "../operations/ui";
import { opText, opName, type OpLabel } from "../operations/copy";
import { SourcePicker } from "../procurement/SourcePicker";
import { LinkedDocuments } from "../documents/LinkedDocuments";
import {
  InvoiceForm,
  PaymentForm,
  ScheduleForm,
  CertificateForm,
  CreditForm,
} from "./FinanceForms";
export type MvpUser = { id: number; role: string; permissions: string[] };
export const allowed = (user: MvpUser, p: string) =>
  user.role === "admin" || user.permissions.includes(p);
type Entity = "invoice" | "payment" | "acceptance" | "credit" | "retention";
export function FinanceApproval({
  entity,
  id,
  instanceId,
  user,
  locale,
  onDone,
}: {
  entity: Entity;
  id: number;
  instanceId: number;
  user: MvpUser;
  locale: Locale;
  onDone: () => void;
}) {
  const history = trpc.workflows.history.useQuery(
      { id: instanceId },
      { enabled: allowed(user, "approvals.view") }
    ),
    [reason, setReason] = useState(""),
    [action, setAction] = useState<"approve" | "reject" | "return">("approve");
  const config = {
    onSuccess: onDone,
    onError: (e: { message: string }) => toast.error(e.message),
  };
  const invoice = trpc.finance.decideInvoice.useMutation(config),
    payment = trpc.finance.decidePayment.useMutation(config),
    certificate = trpc.finance.decideCertificate.useMutation(config),
    credit = trpc.finance.decideCredit.useMutation(config),
    retention = trpc.finance.decideRetention.useMutation(config);
  const resubmit = trpc.finance.resubmit.useMutation(config);
  const mutation =
      entity === "invoice"
        ? invoice
        : entity === "payment"
          ? payment
          : entity === "acceptance"
            ? certificate
            : entity === "credit"
              ? credit
              : retention,
    permission =
      entity === "payment"
        ? "payments.approve"
        : entity === "acceptance"
          ? "receiving.inspect"
          : "finance.approve";
  return (
    <section className="op-step">
      <h4>{opText(locale, "history")}</h4>
      {history.data?.decisions.map(({ decision, name, username }) => (
        <p key={decision.id}>
          {name ?? username} — {opText(locale, decision.action)} —{" "}
          {decision.reason}
        </p>
      ))}
      {history.isError && <p role="alert">{opText(locale, "error")}</p>}
      {entity !== "invoice" &&
        history.data &&
        ["returned", "rejected"].includes(history.data.instance.status) &&
        history.data.instance.requesterId === user.id &&
        allowed(
          user,
          entity === "payment"
            ? "payments.create"
            : entity === "acceptance"
              ? "receiving.create"
              : "finance.create"
        ) && (
          <form
            className="op-form"
            onSubmit={e => {
              e.preventDefault();
              resubmit.mutate({ kind: entity, id, reason });
            }}
          >
            <Input
              label="reason"
              value={reason}
              onChange={setReason}
              locale={locale}
            />
            <button disabled={resubmit.isPending}>
              {opText(locale, "submit")}
            </button>
          </form>
        )}
      {history.data?.instance.status === "pending" &&
        allowed(user, permission) &&
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
                {(["approve", "reject", "return"] as const).map(k => (
                  <option value={k} key={k}>
                    {opText(locale, k)}
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
    </section>
  );
}
export function OrderFinance({
  id,
  locale,
  user,
}: {
  id: number;
  locale: Locale;
  user: MvpUser;
}) {
  const query = trpc.finance.orderSummary.useQuery({ id }),
    utils = trpc.useUtils(),
    [evidence, setEvidence] = useState(""),
    [form, setForm] = useState<
      "invoice" | "payment" | "schedule" | "certificate" | null
    >(null);
  const certify = trpc.finance.certify.useMutation({
    onSuccess: () => {
      void utils.finance.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const closeOrder = trpc.finance.closeOrder.useMutation({
    onSuccess: () => {
      void utils.finance.invalidate();
      void utils.procurement.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const data = query.data;
  if (query.isLoading) return <p>{opText(locale, "loading")}</p>;
  if (query.isError || !data)
    return <p role="alert">{opText(locale, "error")}</p>;
  return (
    <div className="op-page">
      <h3>
        {data.order.number} — {data.order.title} —{" "}
        {opText(locale, data.order.execution)}
      </h3>
      <div className="op-metrics">
        {Object.entries(data.metrics).map(([key, value]) => (
          <div className="op-metric" key={key}>
            <span>{opText(locale, key as OpLabel)}</span>
            <strong>
              {value} {data.order.currency}
            </strong>
          </div>
        ))}
      </div>
      <div className="op-actions">
        {data.order.status === "approved" &&
          allowed(user, "orders.approve") && (
            <>
              <Input
                label="reason"
                value={evidence}
                onChange={setEvidence}
                required={false}
                locale={locale}
              />
              <button
                disabled={closeOrder.isPending || evidence.trim().length < 3}
                onClick={() => closeOrder.mutate({ id, reason: evidence })}
              >
                {opText(locale, "closeOrder")}
              </button>
            </>
          )}
        {data.order.status === "approved" &&
          allowed(user, "finance.create") && (
            <>
              <button onClick={() => setForm("invoice")}>
                {opText(locale, "invoice")}
              </button>
              {!data.schedule && (
                <button onClick={() => setForm("schedule")}>
                  {opText(locale, "paymentSchedule")}
                </button>
              )}
            </>
          )}
        {data.order.status === "approved" &&
          allowed(user, "payments.create") && (
            <button onClick={() => setForm("payment")}>
              {opText(locale, "payment")}
            </button>
          )}
        {data.order.status === "approved" &&
          data.order.execution === "works" &&
          allowed(user, "receiving.create") && (
            <button onClick={() => setForm("certificate")}>
              {opText(locale, "certificates")}
            </button>
          )}
      </div>
      <div className="op-table">
        <table>
          <thead>
            <tr>
              <th>{opText(locale, "description")}</th>
              <th>{opText(locale, "quantity")}</th>
              <th>{opText(locale, "received")}</th>
              <th>{opText(locale, "eligibleQuantity")}</th>
              <th>{opText(locale, "total")}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map(({ line, eligibleQuantity, acceptedQuantity }) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.quantity}</td>
                <td>{acceptedQuantity}</td>
                <td>{eligibleQuantity}</td>
                <td>{line.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{opText(locale, "paymentSchedule")}</h4>
      {allowed(user, "receiving.inspect") && (
        <div className="op-form">
          <Input
            label="evidence"
            value={evidence}
            onChange={setEvidence}
            locale={locale}
            required={false}
          />
        </div>
      )}
      <div className="op-table">
        <table>
          <thead>
            <tr>
              <th>{opText(locale, "milestone")}</th>
              <th>{opText(locale, "amount")}</th>
              <th>{opText(locale, "paid")}</th>
              <th>{opText(locale, "paymentDue")}</th>
              <th>{opText(locale, "status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.milestones.map(m => (
              <tr key={m.id}>
                <td>
                  {opName(m, locale)} — {opText(locale, m.condition)}
                </td>
                <td>{m.amount}</td>
                <td>{m.paid}</td>
                <td>{m.dueDate}</td>
                <td>
                  {opText(locale, m.status)}{" "}
                  {m.status === "planned" &&
                    allowed(user, "receiving.inspect") && (
                      <button
                        disabled={
                          certify.isPending || evidence.trim().length < 3
                        }
                        onClick={() => certify.mutate({ id: m.id, evidence })}
                      >
                        {opText(locale, "certify")}
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>{opText(locale, "invoices")}</h4>
      {data.invoiceBalances.map(({ invoice, balance }) => (
        <p key={invoice.id}>
          {invoice.number} — {opText(locale, invoice.status)} —{" "}
          {opText(locale, "outstanding")}: {balance.outstanding} —{" "}
          {opText(locale, "retained")}: {balance.retained}
          {invoice.status === "approved" &&
            invoice.dueDate < businessDate() &&
            Number(balance.outstanding) > 0 && (
              <> — {opText(locale, "overdue")}</>
            )}
        </p>
      ))}
      {form === "invoice" && (
        <InvoiceForm
          locale={locale}
          initialOrder={id}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {form === "payment" && (
        <PaymentForm
          locale={locale}
          initialOrder={id}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {form === "schedule" && (
        <ScheduleForm
          locale={locale}
          initialOrder={id}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {form === "certificate" && (
        <CertificateForm
          locale={locale}
          initialOrder={id}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
function InvoiceDetail({
  id,
  locale,
  user,
  onClose,
}: {
  id: number;
  locale: Locale;
  user: MvpUser;
  onClose: () => void;
}) {
  const query = trpc.finance.invoiceDetail.useQuery({ id }),
    utils = trpc.useUtils(),
    [reason, setReason] = useState(""),
    [credit, setCredit] = useState(false),
    [key] = useState(() => crypto.randomUUID());
  const done = () => {
      void utils.finance.invalidate();
      void utils.workflows.invalidate();
      void utils.projects.invalidate();
    },
    config = {
      onSuccess: done,
      onError: (e: { message: string }) => toast.error(e.message),
    },
    match = trpc.finance.matchInvoice.useMutation(config),
    cancel = trpc.finance.cancelInvoice.useMutation(config),
    release = trpc.finance.releaseRetention.useMutation(config);
  const data = query.data;
  return (
    <>
      <Dialog title="invoice" locale={locale} onClose={onClose}>
        {query.isLoading ? (
          <p>{opText(locale, "loading")}</p>
        ) : query.isError ? (
          <p role="alert">{opText(locale, "error")}</p>
        ) : (
          data && (
            <div className="op-page">
              <h3>
                {data.header.number} — {opText(locale, data.header.status)}
              </h3>
              <p>
                {data.header.supplierReference} — {data.header.total}{" "}
                {data.header.currency}
              </p>
              <div className="op-metrics">
                {Object.entries(data.balance).map(([k, v]) => (
                  <div key={k} className="op-metric">
                    <span>{opText(locale, k as OpLabel)}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div className="op-table">
                <table>
                  <thead>
                    <tr>
                      <th>{opText(locale, "description")}</th>
                      <th>{opText(locale, "quantity")}</th>
                      <th>{opText(locale, "total")}</th>
                      <th>{opText(locale, "match")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map(({ line, source }) => {
                      const result = data.matches.find(
                        m => m.invoiceLineId === line.id
                      );
                      return (
                        <tr key={line.id}>
                          <td>{source.description}</td>
                          <td>{line.quantity}</td>
                          <td>{line.total}</td>
                          <td>
                            {result && (
                              <>
                                {opText(locale, result.result)} —{" "}
                                {result.eligibleQuantity}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {allowed(user, "finance.create") &&
                [
                  "draft",
                  "blocked",
                  "matched",
                  "returned",
                  "rejected",
                ].includes(data.header.status) && (
                  <div className="op-actions">
                    <button
                      disabled={match.isPending}
                      onClick={() => match.mutate({ id, submit: false })}
                    >
                      {opText(locale, "match")}
                    </button>
                    {data.header.createdBy === user.id && (
                      <>
                        <button
                          disabled={match.isPending}
                          onClick={() => match.mutate({ id, submit: true })}
                        >
                          {opText(locale, "submit")}
                        </button>
                        <Input
                          label="reason"
                          value={reason}
                          onChange={setReason}
                          required={false}
                          locale={locale}
                        />
                        <button
                          disabled={
                            cancel.isPending || reason.trim().length < 3
                          }
                          onClick={() => cancel.mutate({ id, reason })}
                        >
                          {opText(locale, "cancelled")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              {data.header.status === "approved" &&
                allowed(user, "finance.create") && (
                  <div className="op-actions">
                    <button onClick={() => setCredit(true)}>
                      {opText(locale, "credit")}
                    </button>
                    {Number(data.balance.retained) > 0 &&
                      !data.releases.length && (
                        <>
                          <Input
                            label="evidence"
                            value={reason}
                            onChange={setReason}
                            locale={locale}
                            required={false}
                          />
                          <button
                            disabled={
                              release.isPending || reason.trim().length < 3
                            }
                            onClick={() =>
                              release.mutate({ id, key, evidence: reason })
                            }
                          >
                            {opText(locale, "releaseRetention")}
                          </button>
                        </>
                      )}
                  </div>
                )}
              {data.header.workflowId && (
                <FinanceApproval
                  entity="invoice"
                  id={id}
                  instanceId={data.header.workflowId}
                  user={user}
                  locale={locale}
                  onDone={done}
                />
              )}{" "}
              <LinkedDocuments
                entityType="scm_invoice"
                entityId={id}
                locale={locale}
                user={user}
              />
              {data.releases.map(r => (
                <section key={r.id}>
                  <p>
                    {opText(locale, "retention")} — {r.amount} —{" "}
                    {opText(locale, r.status)}
                  </p>
                  {r.workflowId && (
                    <FinanceApproval
                      entity="retention"
                      id={r.id}
                      instanceId={r.workflowId}
                      user={user}
                      locale={locale}
                      onDone={done}
                    />
                  )}
                </section>
              ))}
            </div>
          )
        )}
      </Dialog>
      {credit && (
        <CreditForm
          invoiceId={id}
          locale={locale}
          onClose={() => setCredit(false)}
        />
      )}
    </>
  );
}
function OtherDetail({
  kind,
  id,
  locale,
  user,
  onClose,
}: {
  kind: "payments" | "certificates" | "credits";
  id: number;
  locale: Locale;
  user: MvpUser;
  onClose: () => void;
}) {
  const payment = trpc.finance.paymentDetail.useQuery(
      { id },
      { enabled: kind === "payments" }
    ),
    certificate = trpc.finance.certificateDetail.useQuery(
      { id },
      { enabled: kind === "certificates" }
    ),
    credit = trpc.finance.creditDetail.useQuery(
      { id },
      { enabled: kind === "credits" }
    );
  const query =
      kind === "payments"
        ? payment
        : kind === "certificates"
          ? certificate
          : credit,
    data = query.data,
    utils = trpc.useUtils();
  return (
    <Dialog title="details" locale={locale} onClose={onClose}>
      {query.isLoading ? (
        <p>{opText(locale, "loading")}</p>
      ) : query.isError ? (
        <p role="alert">{opText(locale, "error")}</p>
      ) : (
        data && (
          <div className="op-page">
            <h3>
              {data.header.number} — {opText(locale, data.header.status)}
            </h3>
            <p>
              {"amount" in data.header ? data.header.amount : data.header.total}
            </p>
            {"reason" in data.header && <p>{data.header.reason}</p>}
            {"evidence" in data.header && <p>{data.header.evidence}</p>}
            {certificate.data && (
              <LinkedDocuments
                entityType="scm_certificate"
                entityId={id}
                locale={locale}
                user={user}
              />
            )}
            {certificate.data &&
              kind === "certificates" &&
              certificate.data.lines.map(({ line, source }) => (
                <p key={line.id}>
                  {source.description} — {line.quantity} — {line.total}
                </p>
              ))}
            {data.header.workflowId && (
              <FinanceApproval
                entity={
                  kind === "payments"
                    ? "payment"
                    : kind === "certificates"
                      ? "acceptance"
                      : "credit"
                }
                id={id}
                instanceId={data.header.workflowId}
                locale={locale}
                user={user}
                onDone={() => {
                  void utils.finance.invalidate();
                  void utils.projects.invalidate();
                  void utils.workflows.invalidate();
                }}
              />
            )}
          </div>
        )
      )}
    </Dialog>
  );
}
export function FinancePage({
  locale,
  user,
}: {
  locale: Locale;
  user: MvpUser;
}) {
  const [kind, setKind] = useState<
      "invoices" | "payments" | "certificates" | "credits"
    >("invoices"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<number | null>(null),
    [orderId, setOrderId] = useState(0),
    [form, setForm] = useState<"invoice" | "payment" | "certificate" | null>(
      null
    );
  const query = trpc.finance.list.useQuery({
    kind,
    search,
    page,
    pageSize: 20,
  });
  return (
    <div className="op-page">
      <h2>{opText(locale, "finance")}</h2>
      <div className="op-form">
        <SourcePicker
          kind="orders"
          label="order"
          value={orderId}
          onChange={setOrderId}
          locale={locale}
        />
      </div>
      {orderId > 0 && (
        <section className="op-panel">
          <OrderFinance
            key={orderId}
            id={orderId}
            locale={locale}
            user={user}
          />
        </section>
      )}
      <div className="op-actions">
        {(["invoices", "payments", "certificates", "credits"] as const).map(
          k => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setPage(1);
                setDetail(null);
              }}
            >
              {opText(locale, k)}
            </button>
          )
        )}
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
        {kind === "invoices" && allowed(user, "finance.create") && (
          <button onClick={() => setForm("invoice")}>
            {opText(locale, "create")}
          </button>
        )}
        {kind === "payments" && allowed(user, "payments.create") && (
          <button onClick={() => setForm("payment")}>
            {opText(locale, "create")}
          </button>
        )}
        {kind === "certificates" && allowed(user, "receiving.create") && (
          <button onClick={() => setForm("certificate")}>
            {opText(locale, "create")}
          </button>
        )}
      </div>
      {query.isError ? (
        <p role="alert">{opText(locale, "error")}</p>
      ) : query.isLoading ? (
        <p>{opText(locale, "loading")}</p>
      ) : (
        <div className="op-table">
          <table>
            <thead>
              <tr>
                <th>{opText(locale, "code")}</th>
                <th>{opText(locale, "status")}</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.records.map(r => (
                <tr key={r.id}>
                  <td>
                    <button onClick={() => setDetail(r.id)}>{r.number}</button>
                  </td>
                  <td>{opText(locale, r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!query.data?.records.length && <p>{opText(locale, "empty")}</p>}
        </div>
      )}
      <Pager
        page={page}
        total={query.data?.total ?? 0}
        setPage={setPage}
        locale={locale}
      />
      {detail !== null &&
        (kind === "invoices" ? (
          <InvoiceDetail
            id={detail}
            locale={locale}
            user={user}
            onClose={() => setDetail(null)}
          />
        ) : (
          <OtherDetail
            kind={kind}
            id={detail}
            locale={locale}
            user={user}
            onClose={() => setDetail(null)}
          />
        ))}
      {form === "invoice" && (
        <InvoiceForm
          initialOrder={orderId}
          locale={locale}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {form === "payment" && (
        <PaymentForm
          initialOrder={orderId}
          locale={locale}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {form === "certificate" && (
        <CertificateForm
          initialOrder={orderId}
          locale={locale}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
