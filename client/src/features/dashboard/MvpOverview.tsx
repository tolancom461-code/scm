import { formatPercent } from "@shared/display";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { opText, opName, type OpLabel } from "../operations/copy";
import { Input, Pager } from "../operations/ui";
import { toast } from "sonner";
import { allowed, type MvpUser } from "../finance/FinancePage";
export function MvpOverview({
  locale,
  user,
}: {
  locale: Locale;
  user: MvpUser;
}) {
  const [id, setId] = useState(0),
    [reason, setReason] = useState(""),
    [orderPage, setOrderPage] = useState(1);
  const list = trpc.projects.list.useQuery({ pageSize: 100 }),
    selected = id || list.data?.records[0]?.id || 0,
    query = trpc.projects.detail.useQuery(
      { id: selected || 1 },
      { enabled: !!selected }
    ),
    utils = trpc.useUtils(),
    save = trpc.projects.progress.useMutation({
      onSuccess: () => {
        void utils.projects.invalidate();
      },
      onError: e => toast.error(e.message),
    });
  const orders = trpc.finance.projectOverview.useQuery(
    { projectId: selected || 1, page: orderPage, pageSize: 20 },
    { enabled: !!selected && allowed(user, "finance.view") }
  );
  return (
    <div className="op-page">
      <h2>{opText(locale, "mvpOverview")}</h2>
      <div className="op-form">
        <label>
          {opText(locale, "projects")}
          <select
            value={selected || ""}
            onChange={e => {
              setId(Number(e.target.value));
              setOrderPage(1);
            }}
          >
            <option value="">{opText(locale, "select")}</option>
            {list.data?.records.map(p => (
              <option value={p.id} key={p.id}>
                {p.code} — {opName(p, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isError || query.isError ? (
        <p role="alert">{opText(locale, "error")}</p>
      ) : query.isLoading && selected ? (
        <p>{opText(locale, "loading")}</p>
      ) : query.data ? (
        <>
          <h3>
            {opName(query.data.project, locale)} —{" "}
            {opText(locale, query.data.project.status)}
          </h3>
          <div className="op-metrics">
            {Object.entries(query.data.metrics).map(([k, v]) => (
              <div className="op-metric" key={k}>
                <span>{opText(locale, k as OpLabel)}</span>
                <strong>
                  {v} {query.data?.project.currency}
                </strong>
              </div>
            ))}
          </div>
          {allowed(user, "projects.manage") && (
            <div className="op-form">
              <Input
                label="reason"
                value={reason}
                onChange={setReason}
                required={false}
                locale={locale}
              />
            </div>
          )}
          <div className="op-table">
            <table>
              <thead>
                <tr>
                  <th>{opText(locale, "wbs")}</th>
                  <th>{opText(locale, "progress")}</th>
                  {(
                    [
                      "budget",
                      "commitment",
                      "received",
                      "actual",
                      "paid",
                    ] as const
                  ).map(k => (
                    <th key={k}>{opText(locale, k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.phaseMetrics.map(({ node, metrics }) => (
                  <tr key={node.id}>
                    <td>
                      {opName(node, locale)}
                      <br />
                      {node.startsAt} — {node.endsAt}
                    </td>
                    <td>
                      {formatPercent(node.progress)}
                      {allowed(user, "projects.manage") && (
                        <form
                          className="op-form"
                          onSubmit={e => {
                            e.preventDefault();
                            const fd = new FormData(e.currentTarget);
                            save.mutate({
                              id: node.id,
                              version: node.progress,
                              progress: Number(fd.get("progress")),
                              reason,
                            });
                          }}
                        >
                          <input
                            name="progress"
                            type="number"
                            min="0"
                            max="100"
                            required
                            aria-label={opText(locale, "progress")}
                            defaultValue={node.progress}
                          />
                          <button
                            disabled={
                              save.isPending || reason.trim().length < 3
                            }
                          >
                            {opText(locale, "save")}
                          </button>
                        </form>
                      )}
                    </td>
                    {(
                      [
                        "budget",
                        "commitment",
                        "received",
                        "actual",
                        "paid",
                      ] as const
                    ).map(k => (
                      <td key={k}>{metrics[k]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allowed(user, "finance.view") && (
            <section className="op-panel">
              <h3>{opText(locale, "orders")}</h3>
              {orders.isError ? (
                <p role="alert">{opText(locale, "error")}</p>
              ) : orders.isLoading ? (
                <p>{opText(locale, "loading")}</p>
              ) : (
                <div className="op-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{opText(locale, "code")}</th>
                        <th>{opText(locale, "description")}</th>
                        <th>{opText(locale, "supplyProgress")}</th>
                        <th>{opText(locale, "cashPaid")}</th>
                        <th>{opText(locale, "status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.data?.records.map(r => (
                        <tr key={r.line.id}>
                          <td>{r.order.number}</td>
                          <td>
                            {r.order.title}
                            <br />
                            {r.line.description}
                          </td>
                          <td>
                            {r.acceptedQuantity} / {r.line.quantity}
                          </td>
                          <td>
                            {r.cashPaid} {r.order.currency}
                          </td>
                          <td>
                            {opText(locale, r.order.status)}{" "}
                            {r.deliveryOverdue && (
                              <p>
                                {opText(locale, "overdue")} —{" "}
                                {opText(locale, "delivery")}
                              </p>
                            )}
                            {r.paymentOverdue && (
                              <p>
                                {opText(locale, "overdue")} —{" "}
                                {opText(locale, "payment")}
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pager
                page={orderPage}
                total={orders.data?.total ?? 0}
                setPage={setOrderPage}
                locale={locale}
              />
            </section>
          )}
        </>
      ) : (
        <p>{opText(locale, "empty")}</p>
      )}
    </div>
  );
}
