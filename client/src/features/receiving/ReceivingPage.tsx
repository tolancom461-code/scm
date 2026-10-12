import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { toast } from "sonner";
import { Dialog, Input, Pager } from "../operations/ui";
import { opText, opName } from "../operations/copy";
import {
  ShipmentForm,
  ReceiptForm,
  InspectionForm,
  ReturnForm,
} from "./ReceivingForms";
type Kind = "shipments" | "receipts" | "returns";
type User = { id: number; role: string; permissions: string[] };
const can = (user: User, p: string) =>
  user.role === "admin" || user.permissions.includes(p);
function Detail({
  kind,
  id,
  locale,
  user,
  onClose,
}: {
  kind: Kind;
  id: number;
  locale: Locale;
  user: User;
  onClose: () => void;
}) {
  const query = trpc.receiving.detail.useQuery({ kind, id }),
    utils = trpc.useUtils();
  const [form, setForm] = useState<"inspect" | "return" | null>(null),
    [reason, setReason] = useState(""),
    [arrival, setArrival] = useState(new Date().toISOString().slice(0, 10));
  const update = trpc.receiving.shipmentStatus.useMutation({
    onSuccess: () => void utils.receiving.invalidate(),
    onError: e => toast.error(e.message),
  });
  const data = query.data;
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
              <h3>{data.header.number}</h3>
              {"status" in data.header && (
                <p>{opText(locale, data.header.status)}</p>
              )}
              {data.kind === "receipts" && (
                <div className="op-actions">
                  {data.header.status === "under_inspection" &&
                    can(user, "receiving.inspect") && (
                      <button onClick={() => setForm("inspect")}>
                        {opText(locale, "inspect")}
                      </button>
                    )}
                  {data.header.status === "inspected" &&
                    can(user, "receiving.return") && (
                      <button onClick={() => setForm("return")}>
                        {opText(locale, "returns")}
                      </button>
                    )}
                </div>
              )}
              <div className="op-table">
                <table>
                  <thead>
                    <tr>
                      <th>{opText(locale, "sourceLine")}</th>
                      <th>{opText(locale, "item")}</th>
                      <th>{opText(locale, "quantity")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.kind === "returns"
                      ? data.lines.map(l => (
                          <tr key={l.id}>
                            <td>#{l.allocationId}</td>
                            <td>
                              {opText(
                                locale,
                                l.sourceStatus === "available"
                                  ? "availableStock"
                                  : l.sourceStatus === "rejected"
                                    ? "rejectedQty"
                                    : "quarantine"
                              )}
                            </td>
                            <td>{l.quantity}</td>
                          </tr>
                        ))
                      : data.lines.map(({ line, item }) => (
                          <tr key={line.id}>
                            <td>#{line.orderLineId}</td>
                            <td>{opName(item, locale)}</td>
                            <td>{line.quantity}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              {data.kind === "receipts" && (
                <section className="op-table">
                  <h4>{opText(locale, "allocations")}</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>{opText(locale, "lotCode")}</th>
                        <th>{opText(locale, "accepted")}</th>
                        <th>{opText(locale, "rejectedQty")}</th>
                        <th>{opText(locale, "quarantine")}</th>
                        <th>{opText(locale, "returns")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.allocations.map(({ allocation, batch }) => (
                        <tr key={allocation.id}>
                          <td>
                            {batch.lotCode ?? batch.serialCode ?? batch.code}
                          </td>
                          <td>{allocation.accepted}</td>
                          <td>{allocation.rejected}</td>
                          <td>{allocation.quarantine}</td>
                          <td>
                            {Number(allocation.returnedAccepted) +
                              Number(allocation.returnedRejected) +
                              Number(allocation.returnedQuarantine)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
              {data.kind === "shipments" &&
                data.header.status === "in_transit" &&
                can(user, "receiving.create") && (
                  <form
                    className="op-form"
                    onSubmit={e => {
                      e.preventDefault();
                      update.mutate({
                        id,
                        status: "arrived",
                        actualArrival: arrival,
                        reason,
                      });
                    }}
                  >
                    <Input
                      label="actualArrival"
                      type="date"
                      value={arrival}
                      onChange={setArrival}
                      locale={locale}
                    />
                    <Input
                      label="reason"
                      value={reason}
                      onChange={setReason}
                      locale={locale}
                    />
                    <button disabled={update.isPending}>
                      {opText(locale, "arrived")}
                    </button>
                  </form>
                )}
            </div>
          )
        )}
      </Dialog>
      {form === "inspect" && (
        <InspectionForm id={id} locale={locale} onClose={() => setForm(null)} />
      )}{" "}
      {form === "return" && (
        <ReturnForm id={id} locale={locale} onClose={() => setForm(null)} />
      )}
    </>
  );
}
export function ReceivingPage({
  locale,
  user,
}: {
  locale: Locale;
  user: User;
}) {
  const [kind, setKind] = useState<Kind>("receipts"),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [form, setForm] = useState(false),
    [id, setId] = useState<number | null>(null);
  const query = trpc.receiving.list.useQuery({ kind, page, search });
  return (
    <div className="op-page">
      <div className="op-toolbar">
        {(["shipments", "receipts", "returns"] as const).map(k => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              setPage(1);
            }}
          >
            {opText(locale, k)}
          </button>
        ))}
        <input
          placeholder={opText(locale, "search")}
          aria-label={opText(locale, "search")}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        {kind !== "returns" && can(user, "receiving.create") && (
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
                  <th>{opText(locale, "details")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.records.map(r => (
                  <tr key={r.id}>
                    <td>{r.number}</td>
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
      {form &&
        (kind === "shipments" ? (
          <ShipmentForm locale={locale} onClose={() => setForm(false)} />
        ) : (
          <ReceiptForm locale={locale} onClose={() => setForm(false)} />
        ))}
      {id !== null && (
        <Detail
          kind={kind}
          id={id}
          locale={locale}
          user={user}
          onClose={() => setId(null)}
        />
      )}
    </div>
  );
}
