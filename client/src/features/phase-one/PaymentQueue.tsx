import type { State } from "./Forms";
import type { Locale } from "@/lib/i18n";
import { phaseText } from "./copy";
export function PaymentQueue({
  state,
  contracts,
  locale,
  canRecord,
  record,
  contractDetails,
  paymentDetails,
}: {
  state: State;
  contracts: State["contracts"];
  locale: Locale;
  canRecord: boolean;
  record: (
    contractId: number,
    certificateId?: number,
    kind?: "normal" | "retention"
  ) => void;
  contractDetails: (id: number) => void;
  paymentDetails: (id: number) => void;
}) {
  const p = (k: Parameters<typeof phaseText>[1]) => phaseText(locale, k);
  const money = (s: string, currency = "SAR") =>
    new Intl.NumberFormat(
      locale === "ar" ? "ar-SA" : locale === "ur" ? "ur-PK" : "en-US",
      { style: "currency", currency }
    ).format(Number(s));
  return (
    <div className="p1-payment-queue">
      {contracts.map(c => {
        const b = state.balances.find(b => b.contractId === c.id)!;
        const supplier = state.suppliers.find(s => s.id === c.supplierId);
        const project = state.projects.find(s => s.id === c.projectId);
        const entries = [
          ...(b.upcoming
            ? b.stages
                .filter(m => Number(m.remaining) > 0)
                .map(m => ({
                  key: `stage-${m.id}`,
                  name: m.name,
                  date: m.dueDate,
                  amount: m.amount,
                  ready: b.upcoming?.id === m.id ? b.upcoming.readyAmount : "0",
                  stageId: m.id,
                  certificateId: undefined as number | undefined,
                  installmentId: undefined as number | undefined,
                }))
            : []),
          ...b.certificates
            .filter(q => q.status === "approved" && q.nextInstallment)
            .flatMap(q =>
              q.installments
                .filter(i => Number(i.remaining) > 0)
                .map(i => ({
                  key: `cert-${q.id}-${i.id}`,
                  name: i.name,
                  date: i.dueDate,
                  amount: i.amount,
                  ready:
                    q.nextInstallment?.id === i.id
                      ? q.nextInstallment.readyAmount
                      : "0",
                  certificateId: q.id,
                  installmentId: i.id,
                  stageId: undefined as number | undefined,
                }))
            ),
          ...(Number(b.releasedOutstanding) > 0
            ? [
                {
                  key: "retention",
                  name: p("retentionPayment"),
                  date: "—",
                  amount: b.releasedOutstanding,
                  ready: b.releasedOutstanding,
                  certificateId: undefined,
                  stageId: undefined,
                  installmentId: undefined,
                },
              ]
            : []),
        ];
        if (!entries.length)
          entries.push({
            key: "settled",
            name: p("payments"),
            date: "—",
            amount: "0",
            ready: "0",
            certificateId: undefined,
            stageId: undefined,
            installmentId: undefined,
          });
        return entries.map(e => (
          <details key={`${c.id}-${e.key}`} className="p1-payment-card">
            <summary>
              <div>
                <span className="p1-status">
                  {e.key === "settled"
                    ? p("settled")
                    : Number(e.ready) > 0
                      ? p("ready")
                      : (e.stageId && e.stageId !== b.upcoming?.id) ||
                          (e.installmentId &&
                            e.installmentId !==
                              b.certificates.find(q => q.id === e.certificateId)
                                ?.nextInstallment?.id)
                        ? p("waitingTurn")
                        : p("waiting")}
                </span>
                <h3>
                  {e.name} · {c.title}
                </h3>
                <p>
                  {c.number} · {project?.name}
                </p>
                <p>
                  {supplier?.nameAr}{" "}
                  {e.certificateId &&
                    `· ${b.certificates.find(q => q.id === e.certificateId)?.number}`}
                </p>
              </div>
              <div>
                <span>{p("dueDate")}</span>
                <strong>{e.date}</strong>
              </div>
              <div>
                <span>{p("planned")}</span>
                <strong>{money(e.amount, c.currency)}</strong>
              </div>
              <div>
                <span>{p("readyAmount")}</span>
                <strong>{money(e.ready, c.currency)}</strong>
              </div>
              <span className="p1-card-chevron">⌄</span>
            </summary>
            <div className="p1-payment-card-body">
              <div className="p1-metrics">
                {(
                  [
                    ["paid", b.paid],
                    ["outstanding", b.outstanding],
                    ["retained", b.retained],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <span>{p(k)}</span>
                    <strong>{money(v, c.currency)}</strong>
                  </div>
                ))}
              </div>
              <div className="p1-actions">
                {canRecord && Number(e.ready) > 0 && (
                  <button
                    className="primary"
                    onClick={() =>
                      record(
                        c.id,
                        e.certificateId,
                        e.key === "retention" ? "retention" : "normal"
                      )
                    }
                  >
                    {p("recordPayment")}
                  </button>
                )}
                <button onClick={() => contractDetails(c.id)}>
                  {p("stages")}
                </button>
              </div>
              <h3>{p("payments")}</h3>
              <div className="p1-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "voucher",
                        "date",
                        "stage",
                        "certificate",
                        "amount",
                        "details",
                      ].map(k => (
                        <th key={k}>{p(k as Parameters<typeof p>[0])}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.payments
                      .filter(x => x.contractId === c.id)
                      .map(x => (
                        <tr key={x.id}>
                          <td>
                            {x.voucher}
                            {x.status === "reversed" && " (↶)"}
                          </td>
                          <td>{x.paymentDate}</td>
                          <td>
                            {x.kind === "retention"
                              ? p("retentionPayment")
                              : (state.installments.find(
                                  i => i.id === x.installmentId
                                )?.name ??
                                b.stages.find(m => m.id === x.milestoneId)
                                  ?.name)}
                          </td>
                          <td>
                            {
                              state.certificates.find(
                                q => q.id === x.certificateId
                              )?.number
                            }
                          </td>
                          <td>{money(x.amount, c.currency)}</td>
                          <td>
                            <button onClick={() => paymentDetails(x.id)}>
                              {p("details")}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ));
      })}
    </div>
  );
}
