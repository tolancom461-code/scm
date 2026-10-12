import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { toast } from "sonner";
import { stockOperationInput } from "@shared/inventory";
import { Dialog, Input, Pager } from "../operations/ui";
import { opText, opName, type OpLabel } from "../operations/copy";
import { ReferencePicker } from "../master-data/MasterDataPage";
import { ProjectPicker } from "../procurement/SourcePicker";
type StockRow =
  inferRouterOutputs<AppRouter>["inventory"]["balances"]["records"][number];
type User = { id: number; role: string; permissions: string[] };
const can = (user: User, p: string) =>
  user.role === "admin" || user.permissions.includes(p);
function OperationForm({
  row,
  locale,
  onClose,
}: {
  row: StockRow;
  locale: Locale;
  onClose: () => void;
}) {
  const [state, setState] = useState({
    type: "issue" as
      | "issue"
      | "transfer"
      | "reserve"
      | "release"
      | "adjustment"
      | "count",
    projectId: 0,
    wbsId: 0,
    department: "",
    reason: "",
    quantity: "1",
    countedQuantity: row.balance.quantity,
    reservationLineId: 0,
    toLocationId: 0,
  });
  const project = trpc.projects.detail.useQuery(
    { id: state.projectId || 1 },
    { enabled: !!state.projectId }
  );
  const reservations = trpc.inventory.operations.useQuery({ pageSize: 100 });
  const [reservationId, setReservationId] = useState(0);
  const reservation = trpc.inventory.detail.useQuery(
    { id: reservationId || 1 },
    { enabled: !!reservationId }
  );
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.inventory.create.useMutation({
    onSuccess: () => {
      void utils.inventory.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="operations" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = stockOperationInput.safeParse({
            type: state.type,
            projectId: state.projectId || null,
            wbsId: state.wbsId || null,
            department: state.department,
            reason: state.reason,
            currency: row.balance.currency,
            lines: [
              {
                itemId: row.item.id,
                batchId: row.batch.id,
                fromLocationId: row.location.id,
                toLocationId: state.toLocationId || null,
                quantity: state.quantity,
                countedQuantity:
                  state.type === "count" ? state.countedQuantity : null,
                balanceVersion:
                  state.type === "count" ? row.balance.version : null,
                reservationLineId: state.reservationLineId || null,
                unitCost: null,
              },
            ],
          });
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <strong>
          {opName(row.item, locale)} — {opName(row.location, locale)} —{" "}
          {row.balance.quantity}
        </strong>
        <label>
          {opText(locale, "type")}
          <select
            value={state.type}
            onChange={e =>
              setState({ ...state, type: e.target.value as typeof state.type })
            }
          >
            {(
              [
                "issue",
                "transfer",
                "reserve",
                "release",
                "adjustment",
                "count",
              ] as const
            ).map(type => (
              <option value={type} key={type}>
                {opText(locale, type)}
              </option>
            ))}
          </select>
        </label>
        <div className="op-fields">
          <Input
            label="quantity"
            value={state.quantity}
            onChange={v => setState({ ...state, quantity: v })}
            locale={locale}
          />
          {state.type === "count" && (
            <Input
              label="countedQuantity"
              value={state.countedQuantity}
              onChange={v => setState({ ...state, countedQuantity: v })}
              locale={locale}
            />
          )}
          <Input
            label="department"
            value={state.department}
            onChange={v => setState({ ...state, department: v })}
            locale={locale}
          />
          <Input
            label="reason"
            value={state.reason}
            onChange={v => setState({ ...state, reason: v })}
            locale={locale}
          />
          <ProjectPicker
            value={state.projectId}
            onChange={v => setState({ ...state, projectId: v, wbsId: 0 })}
            locale={locale}
          />
          <label>
            {opText(locale, "wbs")}
            <select
              value={state.wbsId || ""}
              onChange={e =>
                setState({ ...state, wbsId: Number(e.target.value) })
              }
            >
              <option value="">{opText(locale, "none")}</option>
              {project.data?.wbs.map(w => (
                <option value={w.id} key={w.id}>
                  {w.code} — {opName(w, locale)}
                </option>
              ))}
            </select>
          </label>
          {state.type === "transfer" && (
            <label>
              {opText(locale, "toLocation")}
              <ReferencePicker
                kind="locations"
                value={String(state.toLocationId || "")}
                onChange={v => setState({ ...state, toLocationId: Number(v) })}
                locale={locale}
              />
            </label>
          )}
        </div>
        {(state.type === "release" ||
          (state.type === "issue" && row.balance.status === "reserved")) && (
          <>
            <label>
              {opText(locale, "reservation")}
              <select
                required
                value={reservationId || ""}
                onChange={e => setReservationId(Number(e.target.value))}
              >
                <option value="">{opText(locale, "select")}</option>
                {reservations.data?.records
                  .filter(r => r.type === "reserve" && r.status === "posted")
                  .map(r => (
                    <option key={r.id} value={r.id}>
                      {r.number}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {opText(locale, "sourceLine")}
              <select
                required
                value={state.reservationLineId || ""}
                onChange={e =>
                  setState({
                    ...state,
                    reservationLineId: Number(e.target.value),
                  })
                }
              >
                <option value="">{opText(locale, "select")}</option>
                {reservation.data?.lines
                  .filter(
                    l =>
                      l.itemId === row.item.id &&
                      l.batchId === row.batch.id &&
                      l.fromLocationId === row.location.id
                  )
                  .map(l => (
                    <option value={l.id} key={l.id}>
                      #{l.id} — {l.quantity} / {l.releasedQuantity}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
function OperationDetail({
  id,
  locale,
  user,
  onClose,
}: {
  id: number;
  locale: Locale;
  user: User;
  onClose: () => void;
}) {
  const query = trpc.inventory.detail.useQuery({ id }),
    utils = trpc.useUtils();
  const history = trpc.workflows.history.useQuery(
    { id: query.data?.header.workflowId ?? 1 },
    { enabled: !!query.data?.header.workflowId && can(user, "approvals.view") }
  );
  const [reason, setReason] = useState(""),
    [action, setAction] = useState<"approve" | "reject" | "return">("approve");
  const decide = trpc.inventory.decide.useMutation({
    onSuccess: () => {
      void utils.inventory.invalidate();
      void utils.workflows.invalidate();
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
          <div className="op-page">
            <h3>
              {query.data.header.number} —{" "}
              {opText(locale, query.data.header.type)} —{" "}
              {opText(locale, query.data.header.status)}
            </h3>
            <div className="op-table">
              <table>
                <tbody>
                  {query.data.lines.map(l => (
                    <tr key={l.id}>
                      <td>
                        {opText(locale, "item")} #{l.itemId}
                      </td>
                      <td>
                        {opText(locale, "quantity")} {l.quantity}
                      </td>
                      <td>
                        {opText(locale, "fromLocation")} #{l.fromLocationId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.data?.decisions.map(({ decision, name }) => (
              <p key={decision.id}>
                {name} — {opText(locale, decision.action)} — {decision.reason}
              </p>
            ))}
            {query.data.header.status === "pending" &&
              history.data &&
              can(user, "inventory.approve") &&
              query.data.header.createdBy !== user.id && (
                <form
                  className="op-form"
                  onSubmit={e => {
                    e.preventDefault();
                    decide.mutate({
                      id,
                      instanceId: query.data!.header.workflowId!,
                      expectedPosition: history.data!.instance.currentPosition,
                      action,
                      reason,
                    });
                  }}
                >
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
                  <Input
                    label="reason"
                    value={reason}
                    onChange={setReason}
                    locale={locale}
                  />
                  <button disabled={decide.isPending}>
                    {opText(locale, "save")}
                  </button>
                </form>
              )}
          </div>
        )
      )}
    </Dialog>
  );
}
export function InventoryPage({
  locale,
  user,
}: {
  locale: Locale;
  user: User;
}) {
  const [tab, setTab] = useState<"balances" | "ledger" | "operations">(
      "balances"
    ),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [row, setRow] = useState<StockRow | null>(null),
    [id, setId] = useState<number | null>(null);
  const balances = trpc.inventory.balances.useQuery(
      { page, search },
      { enabled: tab === "balances" }
    ),
    ledger = trpc.inventory.ledger.useQuery(
      { page },
      { enabled: tab === "ledger" }
    ),
    operations = trpc.inventory.operations.useQuery(
      { page, search },
      { enabled: tab === "operations" }
    );
  const query =
    tab === "balances" ? balances : tab === "ledger" ? ledger : operations;
  return (
    <div className="op-page">
      <div className="op-toolbar">
        {(["balances", "ledger", "operations"] as const).map(t => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
            }}
          >
            {opText(locale, t)}
          </button>
        ))}
        <input
          aria-label={opText(locale, "search")}
          placeholder={opText(locale, "search")}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
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
                  <th>{opText(locale, "item")}</th>
                  <th>{opText(locale, "fromLocation")}</th>
                  <th>{opText(locale, "status")}</th>
                  <th>{opText(locale, "quantity")}</th>
                  <th>{opText(locale, "amount")}</th>
                  <th>{opText(locale, "details")}</th>
                </tr>
              </thead>
              <tbody>
                {tab === "balances"
                  ? balances.data?.records.map(r => (
                      <tr key={r.balance.id}>
                        <td>
                          {opName(r.item, locale)}
                          <br />
                          {r.batch.lotCode ??
                            r.batch.serialCode ??
                            r.batch.code}
                        </td>
                        <td>
                          {opName(r.warehouse, locale)} /{" "}
                          {opName(r.location, locale)}
                        </td>
                        <td>
                          {opText(
                            locale,
                            r.balance.status === "available"
                              ? "availableStock"
                              : r.balance.status === "rejected"
                                ? "rejectedQty"
                                : r.balance.status
                          )}
                        </td>
                        <td>{r.balance.quantity}</td>
                        <td>
                          {r.balance.value} {r.balance.currency}
                        </td>
                        <td>
                          {can(user, "inventory.operate") &&
                            ["available", "reserved"].includes(
                              r.balance.status
                            ) && (
                              <button onClick={() => setRow(r)}>
                                {opText(locale, "operations")}
                              </button>
                            )}
                        </td>
                      </tr>
                    ))
                  : tab === "ledger"
                    ? ledger.data?.records.map(r => (
                        <tr key={r.movement.id}>
                          <td>{opName(r.item, locale)}</td>
                          <td>{opName(r.location, locale)}</td>
                          <td>
                            {opText(
                              locale,
                              r.movement.status === "available"
                                ? "availableStock"
                                : r.movement.status === "rejected"
                                  ? "rejectedQty"
                                  : r.movement.status
                            )}
                          </td>
                          <td>{r.movement.quantity}</td>
                          <td>
                            {r.movement.value} {r.movement.currency}
                          </td>
                          <td>
                            {r.movement.sourceType} #{r.movement.sourceId}
                          </td>
                        </tr>
                      ))
                    : operations.data?.records.map(r => (
                        <tr key={r.id}>
                          <td>{r.number}</td>
                          <td>{opText(locale, r.type)}</td>
                          <td>{opText(locale, r.status)}</td>
                          <td>—</td>
                          <td>—</td>
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
      {row && (
        <OperationForm row={row} locale={locale} onClose={() => setRow(null)} />
      )}{" "}
      {id !== null && (
        <OperationDetail
          id={id}
          locale={locale}
          user={user}
          onClose={() => setId(null)}
        />
      )}
    </div>
  );
}
