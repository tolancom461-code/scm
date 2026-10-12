import { useState } from "react";
import { localDateTime } from "@shared/date";
import { trpc } from "@/lib/trpc";
import type { Locale } from "@/lib/i18n";
import { toast } from "sonner";
import type { z } from "zod";
import {
  shipmentInput,
  receiptInput,
  inspectionInput,
  returnInput,
} from "@shared/receiving";
import { decimal, formatDecimal, multiply } from "@shared/decimal";
import { Dialog, Input } from "../operations/ui";
import { opText, opName } from "../operations/copy";
import { SourcePicker } from "../procurement/SourcePicker";
import { ReferencePicker } from "../master-data/MasterDataPage";
export function ShipmentForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    orderId: 0,
    carrier: "",
    trackingNumber: "",
    shipDate: "",
    expectedArrival: "",
    freight: "0",
    insurance: "0",
    customs: "0",
    lines: [] as { orderLineId: number; quantity: string }[],
  });
  const plan = trpc.receiving.orderPlan.useQuery(
    { id: data.orderId || 1 },
    { enabled: !!data.orderId }
  );
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.receiving.shipment.useMutation({
    onSuccess: () => {
      void utils.receiving.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="shipments" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = shipmentInput.safeParse(data);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <SourcePicker
          kind="orders"
          status="approved"
          value={data.orderId}
          onChange={v => setData({ ...data, orderId: v, lines: [] })}
          locale={locale}
        />
        <div className="op-fields">
          {(
            [
              "carrier",
              "trackingNumber",
              "freight",
              "insurance",
              "customs",
            ] as const
          ).map(k => (
            <Input
              key={k}
              label={k}
              value={data[k]}
              required={k !== "trackingNumber"}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
          {(["shipDate", "expectedArrival"] as const).map(k => (
            <Input
              key={k}
              label={k}
              type="date"
              value={data[k]}
              onChange={v => setData({ ...data, [k]: v })}
              locale={locale}
            />
          ))}
        </div>
        {plan.data?.lines.map(({ line, item }) => (
          <div className="op-actions" key={line.id}>
            <span>
              {opName(item, locale)} — {line.quantity}
            </span>
            <button
              type="button"
              onClick={() => {
                if (!data.lines.some(l => l.orderLineId === line.id))
                  setData({
                    ...data,
                    lines: [
                      ...data.lines,
                      { orderLineId: line.id, quantity: line.quantity },
                    ],
                  });
              }}
            >
              {opText(locale, "addLine")}
            </button>
          </div>
        ))}
        {data.lines.map((line, index) => (
          <div className="op-step" key={line.orderLineId}>
            <strong>#{line.orderLineId}</strong>
            <Input
              label="quantity"
              value={line.quantity}
              onChange={v =>
                setData({
                  ...data,
                  lines: data.lines.map((l, i) =>
                    i === index ? { ...l, quantity: v } : l
                  ),
                })
              }
              locale={locale}
            />
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  lines: data.lines.filter((_, i) => i !== index),
                })
              }
            >
              {opText(locale, "remove")}
            </button>
          </div>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
type ReceiptLine = z.infer<typeof receiptInput>["lines"][number];
const blankAllocation = () => ({
  baseQuantity: "1",
  lotCode: null as string | null,
  serialCode: null as string | null,
  expiresAt: null as string | null,
});
export function ReceiptForm({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const [data, setData] = useState({
    orderId: 0,
    shipmentId: null as number | null,
    warehouseId: 0,
    receivedAt: localDateTime(),
    lines: [] as ReceiptLine[],
  });
  const plan = trpc.receiving.orderPlan.useQuery(
    { id: data.orderId || 1 },
    { enabled: !!data.orderId }
  );
  const shipments = trpc.receiving.list.useQuery({
    kind: "shipments",
    pageSize: 100,
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.receiving.receipt.useMutation({
    onSuccess: () => {
      void utils.receiving.invalidate();
      void utils.inventory.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  const change = (index: number, line: ReceiptLine) =>
    setData({
      ...data,
      lines: data.lines.map((l, i) => (i === index ? line : l)),
    });
  return (
    <Dialog title="receipts" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = receiptInput.safeParse({
            ...data,
            receivedAt: new Date(data.receivedAt),
          });
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <SourcePicker
          kind="orders"
          status="approved"
          value={data.orderId}
          onChange={v => setData({ ...data, orderId: v, lines: [] })}
          locale={locale}
        />
        <div className="op-fields">
          <Input
            label="receivedAt"
            type="datetime-local"
            value={data.receivedAt}
            onChange={v => setData({ ...data, receivedAt: v })}
            locale={locale}
          />
          <label>
            {opText(locale, "shipments")}
            <select
              value={data.shipmentId ?? ""}
              onChange={e =>
                setData({ ...data, shipmentId: Number(e.target.value) || null })
              }
            >
              <option value="">{opText(locale, "none")}</option>
              {shipments.data?.records.map(s => (
                <option value={s.id} key={s.id}>
                  {s.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            {opText(locale, "warehouse")}
            <ReferencePicker
              kind="warehouses"
              value={String(data.warehouseId || "")}
              onChange={v => setData({ ...data, warehouseId: Number(v) })}
              locale={locale}
            />
          </label>
        </div>
        {plan.data?.lines.map(
          ({ line, item, schedules, factor, received, accepted, returned }) => (
            <section className="op-step" key={line.id}>
              <strong>{opName(item, locale)}</strong>
              <p>
                {opText(locale, "quantity")}: {line.quantity} /{" "}
                {opText(locale, "received")}: {received} /{" "}
                {opText(locale, "accepted")}: {accepted} /{" "}
                {opText(locale, "returns")}: {returned}
              </p>
              {schedules.map(schedule => (
                <div className="op-actions" key={schedule.id}>
                  <span>
                    {schedule.dueDate} — {schedule.quantity} — #
                    {schedule.warehouseId}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!data.lines.some(l => l.scheduleId === schedule.id))
                        setData({
                          ...data,
                          warehouseId: schedule.warehouseId,
                          lines: [
                            ...data.lines,
                            {
                              orderLineId: line.id,
                              scheduleId: schedule.id,
                              quantity: schedule.quantity,
                              receivedLocationId: 0,
                              allocations: [
                                {
                                  ...blankAllocation(),
                                  baseQuantity: formatDecimal(
                                    multiply(
                                      decimal(schedule.quantity),
                                      decimal(factor)
                                    ),
                                    6
                                  ),
                                },
                              ],
                            },
                          ],
                        });
                    }}
                  >
                    {opText(locale, "addLine")}
                  </button>
                </div>
              ))}
            </section>
          )
        )}
        {data.lines.map((line, index) => {
          const source = plan.data?.lines.find(
            l => l.line.id === line.orderLineId
          );
          return (
            <section className="op-step" key={line.scheduleId}>
              <h4>{source && opName(source.item, locale)}</h4>
              <div className="op-fields">
                <Input
                  label="quantity"
                  value={line.quantity}
                  onChange={v => change(index, { ...line, quantity: v })}
                  locale={locale}
                />
                <label>
                  {opText(locale, "receivedLocation")}
                  <ReferencePicker
                    kind="locations"
                    value={String(line.receivedLocationId || "")}
                    onChange={v =>
                      change(index, { ...line, receivedLocationId: Number(v) })
                    }
                    locale={locale}
                  />
                </label>
              </div>
              <h4>{opText(locale, "allocations")}</h4>
              {line.allocations.map((allocation, ai) => (
                <div className="op-fields" key={ai}>
                  <Input
                    label="baseQuantity"
                    value={allocation.baseQuantity}
                    onChange={v =>
                      change(index, {
                        ...line,
                        allocations: line.allocations.map((a, i) =>
                          i === ai ? { ...a, baseQuantity: v } : a
                        ),
                      })
                    }
                    locale={locale}
                  />
                  {source?.item.lotTracking && (
                    <Input
                      label="lotCode"
                      value={allocation.lotCode ?? ""}
                      onChange={v =>
                        change(index, {
                          ...line,
                          allocations: line.allocations.map((a, i) =>
                            i === ai ? { ...a, lotCode: v } : a
                          ),
                        })
                      }
                      locale={locale}
                    />
                  )}{" "}
                  {source?.item.serialTracking && (
                    <Input
                      label="serialCode"
                      value={allocation.serialCode ?? ""}
                      onChange={v =>
                        change(index, {
                          ...line,
                          allocations: line.allocations.map((a, i) =>
                            i === ai ? { ...a, serialCode: v } : a
                          ),
                        })
                      }
                      locale={locale}
                    />
                  )}{" "}
                  {source?.item.expiryTracking && (
                    <Input
                      label="expiresAt"
                      type="date"
                      value={allocation.expiresAt ?? ""}
                      onChange={v =>
                        change(index, {
                          ...line,
                          allocations: line.allocations.map((a, i) =>
                            i === ai ? { ...a, expiresAt: v } : a
                          ),
                        })
                      }
                      locale={locale}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      change(index, {
                        ...line,
                        allocations: line.allocations.filter(
                          (_, i) => i !== ai
                        ),
                      })
                    }
                  >
                    {opText(locale, "remove")}
                  </button>
                </div>
              ))}
              <div className="op-actions">
                <button
                  type="button"
                  onClick={() =>
                    change(index, {
                      ...line,
                      allocations: [...line.allocations, blankAllocation()],
                    })
                  }
                >
                  {opText(locale, "addAllocation")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setData({
                      ...data,
                      lines: data.lines.filter((_, i) => i !== index),
                    })
                  }
                >
                  {opText(locale, "remove")}
                </button>
              </div>
            </section>
          );
        })}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
export function InspectionForm({
  id,
  locale,
  onClose,
}: {
  id: number;
  locale: Locale;
  onClose: () => void;
}) {
  const query = trpc.receiving.detail.useQuery({ kind: "receipts", id });
  if (!query.data || query.data.kind !== "receipts")
    return (
      <Dialog title="inspect" locale={locale} onClose={onClose}>
        <p>{opText(locale, query.isError ? "error" : "loading")}</p>
      </Dialog>
    );
  return (
    <InspectionEditor data={query.data} locale={locale} onClose={onClose} />
  );
}
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
type ReceiptDetail = Extract<
  inferRouterOutputs<AppRouter>["receiving"]["detail"],
  { kind: "receipts" }
>;
function InspectionEditor({
  data,
  locale,
  onClose,
}: {
  data: ReceiptDetail;
  locale: Locale;
  onClose: () => void;
}) {
  const [state, setState] = useState({
    receiptId: data.header.id,
    notes: "",
    lines: data.allocations.map(({ allocation }) => ({
      allocationId: allocation.id,
      accepted: allocation.quantity,
      rejected: "0",
      quarantine: "0",
      defects: "",
      storageLocationId: 0,
      rejectedLocationId: 0,
      quarantineLocationId: 0,
    })),
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.receiving.inspect.useMutation({
    onSuccess: () => {
      void utils.receiving.invalidate();
      void utils.inventory.invalidate();
      void utils.projects.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="inspect" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = inspectionInput.safeParse(state);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <Input
          label="defects"
          value={state.notes}
          onChange={v => setState({ ...state, notes: v })}
          locale={locale}
        />
        {state.lines.map((line, index) => (
          <section className="op-step" key={line.allocationId}>
            <strong>
              #{line.allocationId} — {data.allocations[index].batch.code} —{" "}
              {data.allocations[index].allocation.quantity}
            </strong>
            <div className="op-fields">
              {(["accepted", "rejected", "quarantine"] as const).map(k => (
                <Input
                  key={k}
                  label={k === "rejected" ? "rejectedQty" : k}
                  value={line[k]}
                  onChange={v =>
                    setState({
                      ...state,
                      lines: state.lines.map((l, i) =>
                        i === index ? { ...l, [k]: v } : l
                      ),
                    })
                  }
                  locale={locale}
                />
              ))}
              <Input
                label="defects"
                required={false}
                value={line.defects}
                onChange={v =>
                  setState({
                    ...state,
                    lines: state.lines.map((l, i) =>
                      i === index ? { ...l, defects: v } : l
                    ),
                  })
                }
                locale={locale}
              />
              {(
                [
                  "storageLocationId",
                  "rejectedLocationId",
                  "quarantineLocationId",
                ] as const
              ).map(k => (
                <label key={k}>
                  {opText(
                    locale,
                    k === "storageLocationId"
                      ? "storageLocation"
                      : "quarantineLocation"
                  )}
                  <ReferencePicker
                    kind="locations"
                    value={String(line[k] || "")}
                    onChange={v =>
                      setState({
                        ...state,
                        lines: state.lines.map((l, i) =>
                          i === index ? { ...l, [k]: Number(v) } : l
                        ),
                      })
                    }
                    locale={locale}
                  />
                </label>
              ))}
            </div>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
export function ReturnForm({
  id,
  locale,
  onClose,
}: {
  id: number;
  locale: Locale;
  onClose: () => void;
}) {
  const query = trpc.receiving.detail.useQuery({ kind: "receipts", id });
  const [state, setState] = useState({
    receiptId: id,
    reason: "",
    resolution: "replacement" as "replacement" | "credit",
    lines: [] as z.infer<typeof returnInput>["lines"],
  });
  const [key] = useState(() => crypto.randomUUID());
  const utils = trpc.useUtils();
  const save = trpc.receiving.return.useMutation({
    onSuccess: () => {
      void utils.receiving.invalidate();
      void utils.inventory.invalidate();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog title="returns" locale={locale} onClose={onClose}>
      <form
        className="op-form"
        onSubmit={e => {
          e.preventDefault();
          const parsed = returnInput.safeParse(state);
          if (!parsed.success) {
            toast.error(opText(locale, "invalid"));
            return;
          }
          save.mutate({ data: parsed.data, key });
        }}
      >
        <Input
          label="reason"
          value={state.reason}
          onChange={v => setState({ ...state, reason: v })}
          locale={locale}
        />
        <label>
          {opText(locale, "resolution")}
          <select
            value={state.resolution}
            onChange={e =>
              setState({
                ...state,
                resolution: e.target.value as typeof state.resolution,
              })
            }
          >
            <option value="replacement">{opText(locale, "replacement")}</option>
            <option value="credit">{opText(locale, "credit")}</option>
          </select>
        </label>
        {query.data?.kind === "receipts" &&
          query.data.allocations.map(({ allocation, batch }) => (
            <div className="op-actions" key={allocation.id}>
              <span>
                {batch.code} — {opText(locale, "rejectedQty")}:{" "}
                {allocation.rejected} — {opText(locale, "quarantine")}:{" "}
                {allocation.quarantine}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!state.lines.some(l => l.allocationId === allocation.id))
                    setState({
                      ...state,
                      lines: [
                        ...state.lines,
                        {
                          allocationId: allocation.id,
                          locationId: 0,
                          quantity: allocation.rejected,
                          sourceStatus: "rejected",
                        },
                      ],
                    });
                }}
              >
                {opText(locale, "addLine")}
              </button>
            </div>
          ))}
        {state.lines.map((line, index) => (
          <section className="op-step" key={line.allocationId}>
            <strong>#{line.allocationId}</strong>
            <Input
              label="quantity"
              value={line.quantity}
              onChange={v =>
                setState({
                  ...state,
                  lines: state.lines.map((l, i) =>
                    i === index ? { ...l, quantity: v } : l
                  ),
                })
              }
              locale={locale}
            />
            <label>
              {opText(locale, "status")}
              <select
                value={line.sourceStatus}
                onChange={e =>
                  setState({
                    ...state,
                    lines: state.lines.map((l, i) =>
                      i === index
                        ? {
                            ...l,
                            sourceStatus: e.target
                              .value as typeof line.sourceStatus,
                          }
                        : l
                    ),
                  })
                }
              >
                <option value="rejected">
                  {opText(locale, "rejectedQty")}
                </option>
                <option value="available">{opText(locale,"availableStock")}</option>
                <option value="quarantine">
                  {opText(locale, "quarantine")}
                </option>
              </select>
            </label>
            <label>
              {opText(locale, line.sourceStatus==="available"?"storageLocation":"quarantineLocation")}
              <ReferencePicker
                kind="locations"
                value={String(line.locationId || "")}
                onChange={v =>
                  setState({
                    ...state,
                    lines: state.lines.map((l, i) =>
                      i === index ? { ...l, locationId: Number(v) } : l
                    ),
                  })
                }
                locale={locale}
              />
            </label>
          </section>
        ))}
        <button disabled={save.isPending}>{opText(locale, "save")}</button>
      </form>
    </Dialog>
  );
}
