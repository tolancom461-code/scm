import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  FileText,
  CircleDollarSign,
  Users2,
  Settings,
  Menu,
  LogOut,
  Globe2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { localeMeta, type Locale } from "@/lib/i18n";
import { UsersPage } from "../users/UsersPage";
import { PolicyCenter } from "../policy/PolicyCenter";
import { LinkedDocuments } from "../documents/LinkedDocuments";
import {
  Field,
  Modal,
  ContractForm,
  CertificateForm,
  PaymentForm,
  ContractCorrectionForm,
  type State,
} from "./Forms";
import { phaseText, type PhaseLabel } from "./copy";
import "./phase-one.css";
import { PaymentQueue } from "./PaymentQueue";
import { decimal, formatDecimal } from "@shared/decimal";
import { businessDate, addCalendarDays } from "@shared/date";
import {
  financeText,
  ContractSchedule,
  ScheduleForm,
  HandoverForm,
  PaymentCorrection,
  ReversalReview,
} from "./FinanceControls";
type User = {
  id: number;
  name: string | null;
  username: string | null;
  role: string;
  permissions: string[];
  policy?: {
    landing: string;
    allProjects: boolean;
    legacyAccess: boolean;
    version: number;
  };
};
type Page =
  | "contracts"
  | "certificates"
  | "accounts"
  | "suppliers"
  | "settings"
  | "policy"
  | "users";
type Dialog = {
  kind:
    | "contract"
    | "certificate"
    | "payment"
    | "contractView"
    | "certificateView"
    | "paymentView"
    | "schedule"
    | "handover"
    | "replacement"
    | "terms"
    | "cancel"
    | "restore";
  id: number;
  certificateId?: number;
  paymentKind?: "normal" | "retention";
} | null;
function GridTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="p1-table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function PhaseOneWorkspace({
  user,
  locale,
  setLocale,
  previous,
}: {
  user: User;
  locale: Locale;
  setLocale: (l: Locale) => void;
  previous: () => void;
}) {
  const p = (key: PhaseLabel) => phaseText(locale, key),
    can = (permission: string) => user.permissions.includes(permission);
  const pages = [
    {
      page: "contracts" as const,
      label: "contracts" as const,
      icon: Building2,
      permission: "p1.contracts.view",
    },
    {
      page: "certificates" as const,
      label: "certificates" as const,
      icon: FileText,
      permission: "p1.certificates.view",
    },
    {
      page: "accounts" as const,
      label: "accounts" as const,
      icon: CircleDollarSign,
      permission: "p1.payments.view",
    },
    {
      page: "suppliers" as const,
      label: "suppliers" as const,
      icon: Users2,
      permission: "suppliers.view",
    },
    {
      page: "settings" as const,
      label: "settings" as const,
      icon: Settings,
      permission: "p1.projects.view",
    },
    {
      page: "users" as const,
      label: "users" as const,
      icon: Users2,
      permission: "users.view",
    },
    {
      page: "policy" as const,
      label: "policy" as const,
      icon: ShieldCheck,
      permission: "policy.view",
    },
  ].filter(
    x => can(x.permission) || (x.page === "settings" && can("p1.company.view"))
  );
  const [selected, setPage] = useState<Page>(
      (user.policy?.landing ?? "contracts") as Page
    ),
    page = pages.some(x => x.page === selected) ? selected : pages[0]?.page;
  const [sidebar, setSidebar] = useState(false),
    [dialog, setDialog] = useState<Dialog>(null),
    [policyTarget, setPolicyTarget] = useState(0),
    [filter, setFilter] = useState("");
  const query = trpc.phaseOne.state.useQuery(undefined, {
    enabled: [
      "p1.projects.view",
      "p1.contracts.view",
      "p1.certificates.view",
      "p1.payments.view",
      "p1.company.view",
    ].some(can),
  });
  const utils = trpc.useUtils(),
    done = () => {
      void utils.phaseOne.state.invalidate();
      setDialog(null);
      toast.success(p("done"));
    };
  const policyKey = JSON.stringify([user.permissions, user.policy]);
  useEffect(() => {
    void utils.phaseOne.state.invalidate();
    setDialog(null);
  }, [policyKey, utils]);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => window.location.reload(),
  });
  const decision = trpc.phaseOne.decideCertificate.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    }),
    release = trpc.phaseOne.releaseRetention.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    });
  const [reason, setReason] = useState("");
  const ft = (ar: string, en: string, ur: string) =>
    financeText(locale, ar, en, ur);
  const [releaseDate, setReleaseDate] = useState(businessDate());
  const state = query.data,
    contract = [
      ...(state?.contracts ?? []),
      ...(state?.cancelledContracts ?? []),
    ].find(c => c.id === dialog?.id),
    certificate = state?.certificates.find(c => c.id === dialog?.id);
  const money = (v: string, currency = "SAR") =>
    new Intl.NumberFormat(localeMeta[locale].formatting, {
      numberingSystem: "latn",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(v)) +
    " " +
    currency;
  const vendor = (id: number) =>
      state?.suppliers.find(s => s.id === id)?.nameAr ?? "—",
    project = (id: number) => {
      const row = state?.projects.find(s => s.id === id);
      return row ? `${row.number} — ${row.name}` : "—";
    },
    projectNumber = (id: number) =>
      state?.projects.find(s => s.id === id)?.number ?? "—";
  const contracts = (state?.contracts ?? []).filter(c =>
    [c.number, c.reference, c.title, project(c.projectId), vendor(c.supplierId)]
      .join(" ")
      .toLowerCase()
      .includes(filter.toLowerCase())
  );
  const certificatePosition = (c: { id: number; contractId: number }) =>
    String(
      state?.certificates.filter(
        x => x.contractId === c.contractId && x.id <= c.id
      ).length ?? 0
    );
  const filteredAccounts = (state?.accounts ?? []).flatMap(a => {
    const ids = new Set(
      contracts
        .filter(c => c.supplierId === a.supplierId && c.currency === a.currency)
        .map(c => c.id)
    );
    const rows = (state?.balances ?? []).filter(b => ids.has(b.contractId));
    if (!rows.length) return [];
    const total = (key: "paid" | "outstanding" | "retained") =>
      formatDecimal(rows.reduce((sum, b) => sum + decimal(b[key]), 0n));
    return [
      {
        ...a,
        paid: total("paid"),
        outstanding: total("outstanding"),
        retained: total("retained"),
      },
    ];
  });
  const open = (kind: NonNullable<Dialog>["kind"], id: number) => {
    setReason("");
    setReleaseDate(businessDate());
    setDialog({ kind, id });
  };
  const metrics = (paid: string, outstanding: string, retained: string) => (
    <div className="p1-metrics">
      {(
        [
          ["paid", paid],
          ["outstanding", outstanding],
          ["retained", retained],
        ] as const
      ).map(([k, v]) => (
        <div key={k}>
          <span>{p(k)}</span>
          <strong>{money(v)}</strong>
        </div>
      ))}
    </div>
  );
  function printHeader(title: string) {
    return (
      <>
        <div className="p1-print-header">
          <div>
            <h2>{state?.company?.name ?? p("brand")}</h2>
            <p>{state?.company?.address}</p>
            <p>
              {p("registration")}: {state?.company?.registration || "—"}
              {" · "}
              {p("taxNumber")}: {state?.company?.taxNumber || "—"}
            </p>
          </div>
          {state?.company?.logo && (
            <img className="p1-logo" src={state.company.logo} alt={p("logo")} />
          )}
        </div>
        <h2>{title}</h2>
        <hr />
      </>
    );
  }
  return (
    <div className="app-shell p1-shell" dir={localeMeta[locale].direction}>
      <aside id="p1-sidebar" className={`sidebar ${sidebar ? "open" : ""}`}>
        <button
          type="button"
          className="mobile-menu icon-button p1-sidebar-close"
          aria-label="Close menu / إغلاق القائمة"
          onClick={() => setSidebar(false)}
        >
          <Menu size={19} />
        </button>
        <div className="brand-lockup">
          <Building2 size={30} />
          <div>
            <strong>Procure Nexus</strong>
            <small>{p("brand")}</small>
          </div>
        </div>
        <nav className="p1-side-nav">
          {pages.map(x => (
            <button
              key={x.page}
              className={page === x.page ? "active" : ""}
              onClick={() => {
                setPage(x.page);
                setFilter("");
                setSidebar(false);
              }}
            >
              <x.icon size={18} />
              <span>{p(x.label)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {user.policy?.legacyAccess && user.policy.allProjects && (
            <button className="profile-row" onClick={previous}>
              <FileText size={15} />
              <span>{p("previous")}</span>
            </button>
          )}
          <button className="profile-row" onClick={() => logout.mutate()}>
            <div>{user.name?.slice(0, 1) ?? "U"}</div>
            <span>
              {user.name}
              <small>@{user.username}</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Menu / القائمة"
            aria-expanded={sidebar}
            aria-controls="p1-sidebar"
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={19} />
          </button>
          <b>{page ? p(page) : p("brand")}</b>
          <div className="locale-switch">
            <Globe2 size={15} />
            <select
              aria-label="اللغة / Language"
              value={locale}
              onChange={e => setLocale(e.target.value as Locale)}
            >
              {(Object.keys(localeMeta) as Locale[]).map(l => (
                <option key={l} value={l}>
                  {localeMeta[l].label}
                </option>
              ))}
            </select>
          </div>
        </header>
        <main className="content-area p1-page">
          {!page ? (
            <p role="status">{p("noAccess")}</p>
          ) : page === "policy" ? (
            <PolicyCenter
              locale={locale}
              targetId={policyTarget}
              clearTarget={() => setPolicyTarget(0)}
            />
          ) : page === "suppliers" ? (
            <SimpleSuppliers
              locale={locale}
              canCreate={can("suppliers.create")}
              canEdit={can("suppliers.edit")}
            />
          ) : page === "users" ? (
            <UsersPage
              locale={locale}
              managePolicy={
                can("policy.manage")
                  ? id => {
                      setPolicyTarget(id);
                      setPage("policy");
                    }
                  : undefined
              }
            />
          ) : query.isLoading ? (
            <p aria-live="polite">…</p>
          ) : query.isError ? (
            <div role="alert">
              {p("error")}{" "}
              <button onClick={() => query.refetch()}>{p("retry")}</button>
            </div>
          ) : (
            state && (
              <>
                <h1>{page ? p(page) : p("brand")}</h1>
                {(page === "contracts" ||
                  page === "certificates" ||
                  page === "accounts") && (
                  <input
                    className="p1-filter"
                    aria-label={p("project") + " / " + p("supplier")}
                    placeholder={p("project") + " / " + p("supplier")}
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                )}
                {page === "contracts" && (
                  <>
                    <div className="p1-actions">
                      {can("p1.contracts.create") && (
                        <button
                          className="primary"
                          onClick={() => open("contract", 0)}
                        >
                          {p("newContract")}
                        </button>
                      )}
                    </div>
                    <GridTable
                      headers={[
                        p("number"),
                        p("project"),
                        p("title"),
                        p("supplier"),
                        p("total"),
                        p("details"),
                      ]}
                    >
                      {contracts.map(c => (
                        <tr key={c.id}>
                          <td>
                            {c.number}
                            <br />
                            {c.reference}
                          </td>
                          <td>{project(c.projectId)}</td>
                          <td>{c.title}</td>
                          <td>{vendor(c.supplierId)}</td>
                          <td>{money(c.total)}</td>
                          <td>
                            <button onClick={() => open("contractView", c.id)}>
                              {p("details")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </GridTable>
                    {!contracts.length && <p>{p("noData")}</p>}
                    {!!state.cancelledContracts.length && (
                      <details>
                        <summary>
                          {p("cancelledContracts")} (
                          {state.cancelledContracts.length})
                        </summary>
                        {state.cancelledContracts
                          .filter(c =>
                            [
                              c.number,
                              c.title,
                              project(c.projectId),
                              vendor(c.supplierId),
                            ]
                              .join(" ")
                              .toLowerCase()
                              .includes(filter.toLowerCase())
                          )
                          .map(c => (
                            <p key={c.id}>
                              {c.number} — {c.title} — {money(c.total)}{" "}
                              <button
                                onClick={() => open("contractView", c.id)}
                              >
                                {p("details")}
                              </button>
                            </p>
                          ))}
                      </details>
                    )}
                  </>
                )}
                {page === "certificates" && (
                  <>
                    {can("p1.certificates.create") && (
                      <div className="p1-actions">
                        {contracts.map(c => (
                          <button
                            key={c.id}
                            disabled={state.certificates.some(
                              x =>
                                x.contractId === c.id && x.status === "pending"
                            )}
                            onClick={() => open("certificate", c.id)}
                          >
                            {p("newCertificate")} — {c.title}
                          </button>
                        ))}
                      </div>
                    )}
                    <GridTable
                      headers={[
                        p("number"),
                        p("title"),
                        p("date"),
                        p("net"),
                        p("status"),
                        p("details"),
                      ]}
                    >
                      {state.certificates
                        .filter(c => contracts.some(x => x.id === c.contractId))
                        .reverse()
                        .map(c => (
                          <tr key={c.id}>
                            <td>{c.number}</td>
                            <td>
                              {
                                state.contracts.find(x => x.id === c.contractId)
                                  ?.title
                              }
                            </td>
                            <td>{c.certificateDate}</td>
                            <td>{money(c.net)}</td>
                            <td>
                              <span className={"p1-status " + c.status}>
                                {p(
                                  c.status as
                                    | "pending"
                                    | "approved"
                                    | "rejected"
                                )}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => open("certificateView", c.id)}
                              >
                                {p("details")}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </GridTable>
                  </>
                )}
                {page === "accounts" && (
                  <>
                    <p className="p1-hint">{p("accountHint")}</p>
                    <div className="p1-supplier-cards">
                      {[
                        ...new Set(filteredAccounts.map(a => a.supplierId)),
                      ].map(supplierId => {
                        const accounts = filteredAccounts.filter(
                          a => a.supplierId === supplierId
                        );
                        const supplierContracts = contracts.filter(
                          c => c.supplierId === supplierId
                        );
                        return (
                          <details
                            className="p1-supplier-card"
                            key={supplierId}
                          >
                            <summary>
                              <div className="p1-supplier-identity">
                                <span>{p("supplier")}</span>
                                <h2>{accounts[0].name}</h2>
                                <small>
                                  {ft(
                                    "اضغط لعرض العقود والدفعات وسجل الصرف",
                                    "Open contracts, installments and payment history",
                                    "معاہدے، اقساط اور ادائیگی کی تاریخ دیکھیں"
                                  )}
                                </small>
                              </div>
                              {(
                                ["paid", "outstanding", "retained"] as const
                              ).map(k => (
                                <div className="p1-supplier-total" key={k}>
                                  <span>{p(k)}</span>
                                  {accounts.map(a => (
                                    <strong key={a.currency}>
                                      {money(a[k], a.currency)}
                                    </strong>
                                  ))}
                                </div>
                              ))}
                              <span
                                className="p1-supplier-chevron"
                                aria-hidden="true"
                              >
                                ⌄
                              </span>
                            </summary>
                            <div className="p1-supplier-body">
                              <PaymentQueue
                                state={state}
                                contracts={supplierContracts}
                                locale={locale}
                                canRecord={can("p1.payments.record")}
                                record={(id, certificateId, paymentKind) => {
                                  open("payment", id);
                                  setDialog({
                                    kind: "payment",
                                    id,
                                    certificateId,
                                    paymentKind,
                                  });
                                }}
                                contractDetails={id => open("contractView", id)}
                                paymentDetails={id => open("paymentView", id)}
                              />
                            </div>
                          </details>
                        );
                      })}
                    </div>
                    <p className="p1-hint">{p("previousHint")}</p>
                  </>
                )}
                {page === "settings" && (
                  <Setup
                    state={state}
                    locale={locale}
                    canManage={can("p1.company.manage")}
                    canProject={can("p1.projects.create")}
                    done={() => {
                      void utils.phaseOne.state.invalidate();
                      toast.success(p("done"));
                    }}
                  />
                )}
              </>
            )
          )}
        </main>
      </div>
      {state && page === "certificates" && state.reversals.length > 0 && (
        <section className="p1-panel">
          <h2>
            {ft(
              "طلبات عكس سجلات الصرف",
              "Disbursement reversal requests",
              "ادائیگی کی واپسی کی درخواستیں"
            )}
          </h2>
          {state.reversals.map(r => (
            <ReversalReview
              key={r.id}
              request={r}
              locale={locale}
              done={done}
              userId={user.id}
              canApprove={can("p1.payments.reverse.approve")}
            />
          ))}
        </section>
      )}
      {state && dialog && (
        <Modal
          title={
            dialog.kind === "schedule"
              ? ft(
                  "جدول دفعات المستخلص",
                  "Certificate installments",
                  "مستخلص کی اقساط"
                )
              : dialog.kind === "handover"
                ? ft(
                    "التسليم النهائي والضمان",
                    "Final handover and warranty",
                    "آخری حوالگی اور ضمانت"
                  )
                : dialog.kind === "replacement"
                  ? ft(
                      "تسجيل سند بديل مرتبط",
                      "Record linked replacement",
                      "مربوط متبادل درج کریں"
                    )
                  : p(
                      dialog.kind === "contract"
                        ? "newContract"
                        : dialog.kind === "certificate"
                          ? "newCertificate"
                          : dialog.kind === "payment"
                            ? "recordPayment"
                            : dialog.kind === "certificateView"
                              ? "certificate"
                              : dialog.kind === "paymentView"
                                ? "payments"
                                : "contracts"
                    )
          }
          close={() => setDialog(null)}
        >
          {dialog.kind === "schedule" && certificate ? (
            <ScheduleForm
              certificate={certificate}
              state={state}
              locale={locale}
              done={done}
            />
          ) : dialog.kind === "handover" && contract ? (
            <HandoverForm contract={contract} locale={locale} done={done} />
          ) : dialog.kind === "replacement" ? (
            <PaymentForm
              initialCertificateId={dialog.certificateId}
              initialKind={dialog.paymentKind}
              state={state}
              contractId={
                state.payments.find(x => x.id === dialog.id)!.contractId
              }
              replacement={state.payments.find(x => x.id === dialog.id)!}
              locale={locale}
              done={done}
            />
          ) : ["terms", "cancel", "restore"].includes(dialog.kind) &&
            contract ? (
            <ContractCorrectionForm
              contract={contract}
              action={dialog.kind as "terms" | "cancel" | "restore"}
              locale={locale}
              done={done}
            />
          ) : dialog.kind === "contract" ? (
            <ContractForm state={state} locale={locale} done={done} />
          ) : dialog.kind === "certificate" ? (
            <CertificateForm
              state={state}
              contractId={dialog.id}
              locale={locale}
              done={done}
            />
          ) : dialog.kind === "payment" ? (
            <PaymentForm
              state={state}
              contractId={dialog.id}
              locale={locale}
              done={done}
            />
          ) : dialog.kind === "contractView" && contract ? (
            <>
              <div className="p1-actions">
                {can("p1.print") && (
                  <button onClick={() => window.print()}>{p("print")}</button>
                )}
                {can("p1.certificates.create") &&
                  contract.status === "active" && (
                    <button onClick={() => open("certificate", contract.id)}>
                      {p("newCertificate")}
                    </button>
                  )}
                {can("p1.contracts.create") && contract.status === "active" && (
                  <button onClick={() => open("terms", contract.id)}>
                    {p("correctTerms")}
                  </button>
                )}
                {can("p1.contracts.create") &&
                  !state.certificates.some(
                    c => c.contractId === contract.id
                  ) && (
                    <button
                      onClick={() =>
                        open(
                          contract.status === "active" ? "cancel" : "restore",
                          contract.id
                        )
                      }
                    >
                      {p(
                        contract.status === "active"
                          ? "cancelContract"
                          : "restoreContract"
                      )}
                    </button>
                  )}
              </div>
              <div className="p1-print" dir={localeMeta[locale].direction}>
                {printHeader(contract.title)}
                {can("p1.contracts.handover") &&
                  contract.status === "active" &&
                  state.certificates.some(
                    q =>
                      q.contractId === contract.id &&
                      q.status === "approved" &&
                      Number(q.progress) === 100
                  ) &&
                  !state.certificates.some(
                    q =>
                      q.contractId === contract.id &&
                      Number(q.releasedAmount) > 0
                  ) && (
                    <button onClick={() => open("handover", contract.id)}>
                      {ft(
                        "اعتماد التسليم النهائي",
                        "Approve final handover",
                        "آخری حوالگی منظور کریں"
                      )}
                    </button>
                  )}
                <p>
                  {ft("التسليم النهائي", "Final handover", "آخری حوالگی")}:{" "}
                  {contract.handoverDate ?? "—"} ·{" "}
                  {ft("انتهاء الضمان", "Warranty expiry", "ضمانت کا اختتام")}:{" "}
                  {contract.handoverDate
                    ? addCalendarDays(
                        contract.handoverDate,
                        contract.warrantyDays
                      )
                    : "—"}
                </p>
                {contract.status === "cancelled" && (
                  <p className="p1-hint">{p("cancelledContracts")}</p>
                )}
                <div className="p1-detail-list">
                  {(
                    [
                      ["contractNumber", contract.number],
                      ["reference", contract.reference],
                      ["projectNumber", projectNumber(contract.projectId)],
                      ["project", project(contract.projectId)],
                      ["supplier", vendor(contract.supplierId)],
                      ["contractDate", contract.contractDate],
                      ["siteDate", contract.siteDate],
                      ["duration", String(contract.durationDays)],
                      ["warranty", String(contract.warrantyDays)],
                      ["retentionPercent", contract.retentionPercent],
                      ["dailyPenalty", money(contract.dailyPenalty)],
                    ] as const
                  ).map(([k, v]) => (
                    <p key={k}>
                      <b>{p(k)}</b>
                      {v}
                    </p>
                  ))}
                </div>
                <h3>{p("scope")}</h3>
                <p className="p1-pre">{contract.scope}</p>
                <GridTable
                  headers={[
                    p("description"),
                    p("quantity"),
                    p("unit"),
                    p("price"),
                  ]}
                >
                  {contract.items.map((i, n) => (
                    <tr key={n}>
                      <td>{i.description}</td>
                      <td>{i.quantity}</td>
                      <td>{i.unit}</td>
                      <td>{money(i.unitPrice)}</td>
                    </tr>
                  ))}
                </GridTable>
                <p>
                  <b>
                    {p("subtotal")}: {money(contract.subtotal)}
                  </b>
                </p>
                <p>
                  <b>
                    {p("total")}: {money(contract.total)}
                  </b>
                </p>
                <h3>
                  {state.certificates.some(
                    q => q.contractId === contract.id && q.scheduleVersion > 0
                  )
                    ? ft(
                        "جدول العقد الأصلي — الجداول الحالية داخل المستخلصات",
                        "Original contract schedule — current schedules are in certificates",
                        "اصل معاہدے کا شیڈول — موجودہ شیڈول مستخلص میں ہیں"
                      )
                    : p("stages")}
                </h3>
                <GridTable
                  headers={[
                    p("stage"),
                    p("percent"),
                    p("planned"),
                    p("dueDate"),
                    p("minProgress"),
                  ]}
                >
                  {state.schedules
                    .find(b => b.contractId === contract.id)
                    ?.stages.map(m => (
                      <tr key={m.id}>
                        <td>
                          {m.position} — {m.name}
                        </td>
                        <td>{m.percent}</td>
                        <td>{money(m.amount)}</td>
                        <td>{m.dueDate}</td>
                        <td>{m.minProgress}</td>
                      </tr>
                    ))}
                </GridTable>
                <p className="p1-hint">{p("scheduleHint")}</p>
                <h3>{p("terms")}</h3>
                <p className="p1-pre">{contract.terms}</p>
                {contract.revision > 0 && (
                  <>
                    <p>
                      {p("revision")}: {contract.revision} —{" "}
                      {contract.correctionReason}
                    </p>
                    <details className="p1-no-print">
                      <summary>{p("history")}</summary>
                      {state.corrections
                        .filter(c => c.contractId === contract.id)
                        .map(c => (
                          <div key={c.id}>
                            <p>
                              {new Date(c.createdAt).toLocaleString(
                                localeMeta[locale].formatting
                              )}{" "}
                              —{" "}
                              {p(
                                c.action === "p1.contract.terms"
                                  ? "correctTerms"
                                  : c.action === "p1.contract.cancel"
                                    ? "cancelContract"
                                    : "restoreContract"
                              )}{" "}
                              — #{c.actorId} — {c.reason}
                            </p>
                            {c.action === "p1.contract.terms" && (
                              <p className="p1-pre">
                                {String(
                                  (c.before as { terms?: string } | null)
                                    ?.terms ?? ""
                                )}
                              </p>
                            )}
                          </div>
                        ))}
                    </details>
                  </>
                )}
                <hr />
                <div className="p1-detail-list p1-signatures">
                  <p>
                    <b>{p("representative")}</b>
                    {state.company?.representative}
                    <br />
                    ……………………
                  </p>
                  <p>
                    {vendor(contract.supplierId)}
                    <br />
                    ……………………
                  </p>
                </div>
              </div>
              <LinkedDocuments
                entityType="p1_contract"
                entityId={contract.id}
                locale={locale}
                user={user}
              />
            </>
          ) : dialog.kind === "certificateView" && certificate ? (
            (() => {
              const c = state.contracts.find(
                c => c.id === certificate.contractId
              )!;
              return (
                <>
                  {can("p1.print") && (
                    <button onClick={() => window.print()}>{p("print")}</button>
                  )}
                  <div className="p1-print" dir={localeMeta[locale].direction}>
                    {printHeader(p("certificate") + " — " + certificate.number)}
                    <div className="p1-detail-list">
                      {(
                        [
                          ["title", c.title],
                          ["certificateNumber", certificate.number],
                          [
                            "certificatePosition",
                            certificatePosition(certificate),
                          ],
                          ["contractNumber", c.number],
                          ["reference", c.reference],
                          ["projectNumber", projectNumber(c.projectId)],
                          ["project", project(c.projectId)],
                          ["supplier", vendor(c.supplierId)],
                          ["certificateDate", certificate.certificateDate],
                          ["progress", certificate.progress],
                          ["delayDays", String(certificate.delayDays)],
                          [
                            "status",
                            p(
                              certificate.status as
                                | "pending"
                                | "approved"
                                | "rejected"
                            ),
                          ],
                        ] as const
                      ).map(([k, v]) => (
                        <p key={k}>
                          <b>{p(k)}</b>
                          {v}
                        </p>
                      ))}
                    </div>
                    <hr />
                    <GridTable
                      headers={[
                        p("description"),
                        p("quantity"),
                        p("completed"),
                        p("price"),
                      ]}
                    >
                      {c.items.map((i, n) => (
                        <tr key={n}>
                          <td>{i.description}</td>
                          <td>
                            {i.quantity} {i.unit}
                          </td>
                          <td>{certificate.quantities[n]}</td>
                          <td>{money(i.unitPrice)}</td>
                        </tr>
                      ))}
                    </GridTable>
                    <GridTable headers={[p("description"), p("value")]}>
                      {(
                        [
                          "cumulativeGross",
                          "previousGross",
                          "gross",
                          "tax",
                          "retention",
                          "penalty",
                          "otherDeduction",
                          "net",
                        ] as const
                      ).map(k => (
                        <tr key={k}>
                          <td>{p(k)}</td>
                          <td>
                            <strong>{money(certificate[k])}</strong>
                          </td>
                        </tr>
                      ))}
                    </GridTable>
                    <p className="p1-pre">{certificate.deductionReason}</p>
                    {state.corrections.some(
                      x =>
                        x.contractId === c.id &&
                        x.action === "p1.contract.terms"
                    ) && (
                      <>
                        <h3>{p("correctedTerms")}</h3>
                        <p className="p1-pre">{c.terms}</p>
                      </>
                    )}
                    <p className="p1-pre">{certificate.notes}</p>
                    {certificate.scheduleVersion === 0 ? (
                      <>
                        <h3>{p("followContract")}</h3>
                        <ContractSchedule
                          state={state}
                          contractId={certificate.contractId}
                          locale={locale}
                        />
                      </>
                    ) : (
                      <>
                        <h3>
                          {ft(
                            "جدول دفعات المستخلص",
                            "Certificate installment schedule",
                            "مستخلص کی اقساط کا شیڈول"
                          )}
                        </h3>
                        <GridTable
                          headers={[
                            p("stage"),
                            p("percent"),
                            p("planned"),
                            p("dueDate"),
                            ...(can("p1.payments.view")
                              ? [p("paid"), p("outstanding")]
                              : []),
                          ]}
                        >
                          {state.installments
                            .filter(
                              i =>
                                i.certificateId === certificate.id &&
                                i.version === certificate.scheduleVersion
                            )
                            .map(i => {
                              const paid = state.payments
                                .filter(
                                  x =>
                                    x.installmentId === i.id &&
                                    x.status === "active"
                                )
                                .reduce((n, x) => n + decimal(x.amount), 0n);
                              return (
                                <tr key={i.id}>
                                  <td>
                                    {i.position} — {i.name}
                                  </td>
                                  <td>{i.percent}%</td>
                                  <td>{money(i.amount)}</td>
                                  <td>{i.dueDate}</td>
                                  {can("p1.payments.view") && (
                                    <>
                                      <td>{money(formatDecimal(paid))}</td>
                                      <td>
                                        {money(
                                          formatDecimal(
                                            decimal(i.amount) - paid
                                          )
                                        )}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                        </GridTable>
                      </>
                    )}
                    {certificate.scheduleVersion === 0 && (
                      <p>
                        {ft(
                          "هذا المستخلص يتبع جدول العقد الأصلي حتى اعتماد جدول مستقل.",
                          "This certificate follows the original contract schedule until an independent schedule is approved.",
                          "آزاد شیڈول کی منظوری تک اصل معاہدے کا شیڈول نافذ ہے۔"
                        )}
                      </p>
                    )}
                    <p>
                      {certificate.scheduleReason === "Initial certificate plan"
                        ? ft(
                            "الجدول المرفق عند إعداد المستخلص",
                            "Schedule attached when the certificate was prepared",
                            "مستخلص کی تیاری کے وقت منسلک شیڈول"
                          )
                        : certificate.scheduleReason}
                    </p>
                    {state.installments.some(
                      i =>
                        i.certificateId === certificate.id &&
                        i.version < certificate.scheduleVersion
                    ) && (
                      <details>
                        <summary>
                          {ft(
                            "إصدارات جدول الدفعات السابقة",
                            "Previous installment schedule versions",
                            "اقساط کے شیڈول کے پچھلے نسخے"
                          )}
                        </summary>
                        {state.installments
                          .filter(
                            i =>
                              i.certificateId === certificate.id &&
                              i.version < certificate.scheduleVersion
                          )
                          .map(i => (
                            <p key={i.id}>
                              {p("revision")}: {i.version} · {i.position} —{" "}
                              {i.name} · {i.percent}% · {money(i.amount)} ·{" "}
                              {i.dueDate}
                            </p>
                          ))}
                      </details>
                    )}
                    {can("p1.certificates.schedule") &&
                      certificate.status === "approved" &&
                      certificate.createdBy !== user.id && (
                        <button
                          onClick={() => open("schedule", certificate.id)}
                        >
                          {ft(
                            "اعتماد أو تعديل جدول الدفعات",
                            "Approve or amend installment schedule",
                            "اقساط کا شیڈول منظور یا تبدیل کریں"
                          )}
                        </button>
                      )}
                    <p>
                      {ft(
                        "انتهاء الضمان",
                        "Warranty expiry",
                        "ضمانت کا اختتام"
                      )}
                      :{" "}
                      {c.handoverDate
                        ? addCalendarDays(c.handoverDate, c.warrantyDays)
                        : ft(
                            "بانتظار التسليم النهائي",
                            "Awaiting final handover",
                            "آخری حوالگی منتظر"
                          )}
                    </p>
                    {certificate.releaseDate && (
                      <p>
                        {p("releaseDate")}: {certificate.releaseDate} —{" "}
                        {certificate.releaseReason}
                      </p>
                    )}
                    <hr />
                    <p>
                      {p("status")}:{" "}
                      {p(
                        certificate.status as
                          | "pending"
                          | "approved"
                          | "rejected"
                      )}{" "}
                      · {certificate.decisionReason}
                    </p>
                  </div>
                  {certificate.status === "pending" &&
                    can("p1.certificates.approve") &&
                    (certificate.createdBy !== user.id ||
                      user.role === "admin") && (
                      <div className="p1-form">
                        {certificate.createdBy === user.id && (
                          <p>
                            {ft(
                              "استثناء مالك النظام: أنت مُعدّ هذا المستخلص. أدخل سبب الاعتماد الذاتي؛ سيُحفظ في سجل التدقيق.",
                              "System owner exception: you prepared this certificate. Enter the self-approval reason; it will be recorded in the audit log.",
                              "سسٹم مالک کی رعایت: آپ نے یہ سرٹیفکیٹ تیار کیا ہے۔ خود منظوری کی وجہ درج کریں؛ یہ آڈٹ لاگ میں محفوظ ہوگی۔"
                            )}
                          </p>
                        )}
                        <Field
                          label={p("reason")}
                          value={reason}
                          set={setReason}
                        />
                        <div className="p1-actions">
                          <button
                            disabled={
                              reason.trim().length < 3 || decision.isPending
                            }
                            onClick={() =>
                              decision.mutate({
                                id: certificate.id,
                                action: "approve",
                                reason,
                              })
                            }
                          >
                            {p("approve")}
                          </button>
                          <button
                            disabled={
                              certificate.createdBy === user.id ||
                              reason.trim().length < 3 ||
                              decision.isPending
                            }
                            onClick={() =>
                              decision.mutate({
                                id: certificate.id,
                                action: "reject",
                                reason,
                              })
                            }
                          >
                            {p("reject")}
                          </button>
                        </div>
                      </div>
                    )}
                  {certificate.status === "approved" &&
                    Number(certificate.retention) > 0 &&
                    (Number(certificate.releasedAmount) === 0 ||
                      !certificate.releaseDate) &&
                    can("p1.retention.release") &&
                    certificate.createdBy !== user.id && (
                      <div className="p1-form">
                        <Field
                          label={p("releaseDate")}
                          type="date"
                          value={releaseDate}
                          set={setReleaseDate}
                        />
                        <Field
                          label={p("reason")}
                          value={reason}
                          set={setReason}
                        />
                        <button
                          disabled={
                            reason.trim().length < 3 ||
                            release.isPending ||
                            !c.handoverDate ||
                            releaseDate <
                              addCalendarDays(c.handoverDate, c.warrantyDays)
                          }
                          onClick={() =>
                            release.mutate({
                              id: certificate.id,
                              reason,
                              releaseDate,
                            })
                          }
                        >
                          {p("release")}
                        </button>
                      </div>
                    )}
                  <LinkedDocuments
                    entityType="p1_certificate"
                    entityId={certificate.id}
                    locale={locale}
                    user={user}
                  />
                </>
              );
            })()
          ) : dialog.kind === "paymentView" ? (
            <>
              <PaymentCorrection
                payment={state.payments.find(p => p.id === dialog.id)!}
                state={state}
                locale={locale}
                canRecord={can("p1.payments.record")}
                done={done}
                replace={() => open("replacement", dialog.id)}
              />
              <LinkedDocuments
                entityType="p1_payment"
                entityId={dialog.id}
                locale={locale}
                user={user}
              />
            </>
          ) : null}
        </Modal>
      )}
    </div>
  );
}
function Setup({
  state,
  locale,
  canManage,
  canProject,
  done,
}: {
  state: State;
  locale: Locale;
  canManage: boolean;
  canProject: boolean;
  done: () => void;
}) {
  const p = (k: PhaseLabel) => phaseText(locale, k),
    [company, setCompany] = useState(
      state.company ?? {
        name: "",
        address: "",
        registration: "",
        taxNumber: "",
        representative: "",
        logo: "",
      }
    ),
    [project, setProject] = useState({ name: "", site: "" }),
    [projectKey, setProjectKey] = useState(() => crypto.randomUUID());
  const save = trpc.phaseOne.saveCompany.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    }),
    create = trpc.phaseOne.createProject.useMutation({
      onSuccess: () => {
        setProject({ name: "", site: "" });
        setProjectKey(crypto.randomUUID());
        done();
      },
      onError: e => toast.error(e.message),
    });
  return (
    <>
      <h2>{p("company")}</h2>
      <form
        className="p1-form"
        onSubmit={e => {
          e.preventDefault();
          save.mutate(company);
        }}
      >
        {(
          [
            "name",
            "address",
            "registration",
            "taxNumber",
            "representative",
          ] as const
        ).map(k => (
          <Field
            key={k}
            label={p(k)}
            value={company[k]}
            required={k === "name"}
            set={v => setCompany({ ...company, [k]: v })}
          />
        ))}
        <label>
          {p("logo")}
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={!canManage}
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (
                file.size > 250000 ||
                !["image/png", "image/jpeg"].includes(file.type)
              ) {
                toast.error("PNG / JPEG ≤ 250 KB");
                return;
              }
              const reader = new FileReader();
              reader.onload = () =>
                setCompany({ ...company, logo: String(reader.result) });
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {canManage && <button disabled={save.isPending}>{p("save")}</button>}
      </form>
      <h2>{p("project")}</h2>
      <GridTable headers={[p("projectNumber"), p("name"), p("site")]}>
        {state.projects.map(x => (
          <tr key={x.id}>
            <td>
              <bdi>{x.number}</bdi>
            </td>
            <td>{x.name}</td>
            <td>{x.site}</td>
          </tr>
        ))}
      </GridTable>
      {canProject && (
        <form
          className="p1-form"
          onSubmit={e => {
            e.preventDefault();
            create.mutate({ ...project, key: projectKey });
          }}
        >
          <Field
            label={p("name")}
            value={project.name}
            set={v => setProject({ ...project, name: v })}
          />
          <Field
            label={p("site")}
            value={project.site}
            required={false}
            set={v => setProject({ ...project, site: v })}
          />
          <button disabled={create.isPending}>{p("addProject")}</button>
          <p className="p1-hint">{p("automaticNumber")}</p>
        </form>
      )}
      <p className="p1-hint">{p("previousHint")}</p>
    </>
  );
}
function SimpleSuppliers({
  locale,
  canCreate,
  canEdit,
}: {
  locale: Locale;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const p = (k: PhaseLabel) => phaseText(locale, k),
    query = trpc.suppliers.list.useQuery(),
    utils = trpc.useUtils(),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState(0);
  const empty = {
      nameAr: "",
      phone: "",
      email: "",
      commercialRegistration: "",
      taxNumber: "",
      notes: "",
    },
    [data, set] = useState(empty);
  const done = () => {
    void utils.suppliers.invalidate();
    void utils.phaseOne.invalidate();
    setOpen(false);
    toast.success(p("done"));
  };
  const create = trpc.suppliers.create.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    }),
    update = trpc.suppliers.update.useMutation({
      onSuccess: done,
      onError: e => toast.error(e.message),
    });
  return (
    <>
      <h1>{p("suppliers")}</h1>
      {canCreate && (
        <button
          onClick={() => {
            setEditing(0);
            set(empty);
            setOpen(true);
          }}
        >
          {p("newSupplier")}
        </button>
      )}
      {query.isError && <p role="alert">{p("error")}</p>}
      <GridTable
        headers={[
          p("number"),
          p("name"),
          p("phone"),
          p("registration"),
          p("details"),
        ]}
      >
        {query.data?.map(s => (
          <tr key={s.id}>
            <td>{s.supplierNumber}</td>
            <td>{s.nameAr}</td>
            <td>{s.phone}</td>
            <td>{s.commercialRegistration}</td>
            <td>
              {canEdit && (
                <button
                  onClick={() => {
                    setEditing(s.id);
                    set({
                      nameAr: s.nameAr,
                      phone: s.phone ?? "",
                      email: s.email ?? "",
                      commercialRegistration: s.commercialRegistration ?? "",
                      taxNumber: s.taxNumber ?? "",
                      notes: s.notes ?? "",
                    });
                    setOpen(true);
                  }}
                >
                  {p("details")}
                </button>
              )}
            </td>
          </tr>
        ))}
      </GridTable>
      {open && (
        <Modal title={p("supplier")} close={() => setOpen(false)}>
          <form
            className="p1-form"
            onSubmit={e => {
              e.preventDefault();
              const fields = { ...data, email: data.email || undefined };
              if (editing) update.mutate({ id: editing, ...fields });
              else create.mutate(fields);
            }}
          >
            {(
              [
                "nameAr",
                "phone",
                "email",
                "commercialRegistration",
                "taxNumber",
                "notes",
              ] as const
            ).map(k => (
              <Field
                key={k}
                label={p(
                  k === "nameAr"
                    ? "name"
                    : k === "commercialRegistration"
                      ? "registration"
                      : k
                )}
                value={data[k]}
                required={k === "nameAr"}
                type={
                  k === "email" ? "email" : k === "notes" ? "textarea" : "text"
                }
                set={v => set({ ...data, [k]: v })}
              />
            ))}
            <button disabled={create.isPending || update.isPending}>
              {p("save")}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
