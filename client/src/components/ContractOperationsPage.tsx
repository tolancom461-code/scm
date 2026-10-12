import { Button } from "@/components/ui/button";
import { chrome, t, type Locale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const copy = {
  ar: {
    amendments: "سجل تعديلات العقد",
    certificate: "صافي المستخلص",
    financial: "سجل العمليات المالية",
    valueChange: "تغير القيمة",
    extensionDays: "أيام التمديد",
    amendmentReason: "سبب التعديل",
    deductions: "الخصومات",
    currentValue: "القيمة الحالية",
    previousValue: "القيمة السابقة",
    certificateId: "معرف المستخلص",
    amendmentId: "معرف التعديل",
    netDue: "الصافي المستحق",
    draft: "مسودة",
    recorded: "مسجل",
    supply: "توريد",
    payment: "دفعة",
  },
  en: {
    amendments: "Contract amendment register",
    certificate: "Certificate net due",
    financial: "Financial operations register",
    valueChange: "Value change",
    extensionDays: "Extension days",
    amendmentReason: "Amendment reason",
    deductions: "Deductions",
    currentValue: "Current value",
    previousValue: "Previous value",
    certificateId: "Certificate ID",
    amendmentId: "Amendment ID",
    netDue: "Net due",
    draft: "Draft",
    recorded: "Recorded",
    supply: "Supply",
    payment: "Payment",
  },
  ur: {
    amendments: "معاہدہ ترمیم رجسٹر",
    certificate: "سرٹیفکیٹ خالص واجب",
    financial: "مالی آپریشنز رجسٹر",
    valueChange: "مالیت کی تبدیلی",
    extensionDays: "توسیع کے دن",
    amendmentReason: "ترمیم کی وجہ",
    deductions: "کٹوتیاں",
    currentValue: "موجودہ مالیت",
    previousValue: "سابقہ مالیت",
    certificateId: "سرٹیفکیٹ شناخت",
    amendmentId: "ترمیم شناخت",
    netDue: "خالص واجب",
    draft: "مسودہ",
    recorded: "درج",
    supply: "سپلائی",
    payment: "ادائیگی",
  },
} as const;

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <i> *</i> : null}
      </span>
      {children}
    </label>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="data-panel compact-panel">
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function Table({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <section className="data-panel">
      <div className="table-tools">
        <div className="search-shell">
          <Search size={15} />
          <input aria-label="search" />
        </div>
        <span>{rows.length.toString().padStart(2, "0")}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {headers.map(header => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ContractOperationsPage({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const utils = trpc.useUtils();
  const contracts = trpc.contracts.list.useQuery();
  const suppliers = trpc.suppliers.list.useQuery();
  const amendments = trpc.contracts.amendments.list.useQuery();
  const certificates = trpc.contracts.certificates.list.useQuery();
  const financial = trpc.contracts.financial.list.useQuery();
  const [open, setOpen] = useState(false);
  const [contract, setContract] = useState({
    title: "",
    supplierId: "",
    value: "",
    type: "supply",
  });
  const [amendment, setAmendment] = useState({
    contractId: "",
    type: "extension",
    value: "0",
    extension: "0",
    reason: "",
  });
  const [certificate, setCertificate] = useState({
    contractId: "",
    current: "0",
    previous: "0",
    deductions: "0",
  });
  const [operation, setOperation] = useState({
    supplierId: "",
    contractId: "",
    certificateId: "",
    type: "payment",
    amount: "",
    notes: "",
  });
  const refresh = () => {
    void utils.contracts.list.invalidate();
    void utils.contracts.amendments.list.invalidate();
    void utils.contracts.certificates.list.invalidate();
    void utils.contracts.financial.list.invalidate();
  };
  const create = trpc.contracts.create.useMutation({
    onSuccess: () => {
      refresh();
      setOpen(false);
    },
    onError: error => toast.error(error.message),
  });
  const createAmendment = trpc.contracts.amendments.create.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const submitAmendment = trpc.contracts.amendments.submit.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const approveAmendment = trpc.contracts.amendments.approve.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const me = trpc.auth.me.useQuery();
  const canApprove =
    me.data?.role === "admin" ||
    me.data?.permissions.includes("contracts.approve");
  const canSubmit =
    me.data?.role === "admin" ||
    me.data?.permissions.includes("contracts.amend");
  const createCertificate = trpc.contracts.certificates.create.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const createFinancial = trpc.contracts.financial.create.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const labelStatus = (value: string) =>
    value === "draft"
      ? c.draft
      : value === "recorded"
        ? c.recorded
        : value === "submitted" || value === "reviewed" || value === "effective"
          ? t(locale, value)
          : value;
  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <p className="eyebrow">
            {chrome(locale, "module")} // {t(locale, "contracts")}
          </p>
          <h1>{t(locale, "contracts")}</h1>
        </div>
        <Button className="neo-button" onClick={() => setOpen(true)}>
          <Plus size={16} />
          {t(locale, "newContract")}
        </Button>
      </section>
      <Table
        headers={[
          t(locale, "number"),
          t(locale, "title"),
          t(locale, "type"),
          t(locale, "value"),
          t(locale, "status"),
        ]}
        rows={(contracts.data ?? []).map(item => [
          item.contractNumber,
          item.title,
          item.contractType === "supply" ? c.supply : item.contractType,
          `${item.currentValue} ${item.currency}`,
          labelStatus(item.status),
        ])}
        empty={t(locale, "noData")}
      />
      <section className="rfq-grid">
        <Panel title={c.amendments}>
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              createAmendment.mutate({
                contractId: Number(amendment.contractId),
                type: amendment.type,
                valueChange: Number(amendment.value),
                extensionDays: Number(amendment.extension),
                reason: amendment.reason,
              });
            }}
          >
            <Field label={t(locale, "contracts")} required>
              <select
                value={amendment.contractId}
                onChange={e =>
                  setAmendment({ ...amendment, contractId: e.target.value })
                }
                required
              >
                <option value="">—</option>
                {(contracts.data ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.contractNumber}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t(locale, "type")}>
              <input
                value={amendment.type}
                onChange={e =>
                  setAmendment({ ...amendment, type: e.target.value })
                }
              />
            </Field>
            <Field label={c.valueChange}>
              <input
                type="number"
                step="0.01"
                value={amendment.value}
                onChange={e =>
                  setAmendment({ ...amendment, value: e.target.value })
                }
              />
            </Field>
            <Field label={c.extensionDays}>
              <input
                type="number"
                min="0"
                value={amendment.extension}
                onChange={e =>
                  setAmendment({ ...amendment, extension: e.target.value })
                }
              />
            </Field>
            <Field label={c.amendmentReason} required>
              <textarea
                value={amendment.reason}
                onChange={e =>
                  setAmendment({ ...amendment, reason: e.target.value })
                }
                required
              />
            </Field>
            <Button type="submit" disabled={createAmendment.isPending}>
              {t(locale, "create")}
            </Button>
          </form>
        </Panel>
        <Panel title={c.certificate}>
          <form
            className="form-grid"
            onSubmit={event => {
              event.preventDefault();
              createCertificate.mutate({
                contractId: Number(certificate.contractId),
                currentValue: Number(certificate.current),
                previousValue: Number(certificate.previous),
                deductions: Number(certificate.deductions),
              });
            }}
          >
            <Field label={t(locale, "contracts")} required>
              <select
                value={certificate.contractId}
                onChange={e =>
                  setCertificate({ ...certificate, contractId: e.target.value })
                }
                required
              >
                <option value="">—</option>
                {(contracts.data ?? []).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.contractNumber}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={c.currentValue}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={certificate.current}
                onChange={e =>
                  setCertificate({ ...certificate, current: e.target.value })
                }
              />
            </Field>
            <Field label={c.previousValue}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={certificate.previous}
                onChange={e =>
                  setCertificate({ ...certificate, previous: e.target.value })
                }
              />
            </Field>
            <Field label={c.deductions}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={certificate.deductions}
                onChange={e =>
                  setCertificate({ ...certificate, deductions: e.target.value })
                }
              />
            </Field>
            <Button type="submit" disabled={createCertificate.isPending}>
              {t(locale, "create")}
            </Button>
          </form>
        </Panel>
      </section>
      <Panel title={c.financial}>
        <form
          className="form-grid"
          onSubmit={event => {
            event.preventDefault();
            createFinancial.mutate({
              supplierId: Number(operation.supplierId),
              contractId: operation.contractId
                ? Number(operation.contractId)
                : undefined,
              certificateId: operation.certificateId
                ? Number(operation.certificateId)
                : undefined,
              operationType: operation.type,
              amount: Number(operation.amount),
              notes: operation.notes || undefined,
            });
          }}
        >
          <Field label={t(locale, "supplier")} required>
            <select
              value={operation.supplierId}
              onChange={e =>
                setOperation({ ...operation, supplierId: e.target.value })
              }
              required
            >
              <option value="">—</option>
              {(suppliers.data ?? []).map(item => (
                <option key={item.id} value={item.id}>
                  {item.nameAr}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t(locale, "contracts")}>
            <select
              value={operation.contractId}
              onChange={e =>
                setOperation({ ...operation, contractId: e.target.value })
              }
            >
              <option value="">—</option>
              {(contracts.data ?? []).map(item => (
                <option key={item.id} value={item.id}>
                  {item.contractNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label={c.certificateId}>
            <select
              value={operation.certificateId}
              onChange={e =>
                setOperation({ ...operation, certificateId: e.target.value })
              }
            >
              <option value="">—</option>
              {(certificates.data ?? []).map(item => (
                <option key={item.id} value={item.id}>
                  {item.certificateNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t(locale, "type")}>
            <input
              value={operation.type}
              onChange={e =>
                setOperation({ ...operation, type: e.target.value })
              }
            />
          </Field>
          <Field label={t(locale, "value")} required>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={operation.amount}
              onChange={e =>
                setOperation({ ...operation, amount: e.target.value })
              }
              required
            />
          </Field>
          <Field label={t(locale, "notes")}>
            <textarea
              value={operation.notes}
              onChange={e =>
                setOperation({ ...operation, notes: e.target.value })
              }
            />
          </Field>
          <Button type="submit" disabled={createFinancial.isPending}>
            {t(locale, "create")}
          </Button>
        </form>
      </Panel>
      <Table
        headers={[
          c.amendmentId,
          t(locale, "contracts"),
          c.valueChange,
          t(locale, "status"),
          chrome(locale, "action"),
        ]}
        rows={(amendments.data ?? []).map(item => [
          item.amendmentNumber,
          `#${item.contractId}`,
          item.valueChange,
          labelStatus(item.status),
          item.status === "draft" &&
          item.createdBy === me.data?.id &&
          canSubmit ? (
            <button
              disabled={submitAmendment.isPending}
              className="table-action"
              onClick={() =>
                submitAmendment.mutate({
                  id: item.id,
                  reason: item.reason ?? item.amendmentNumber,
                })
              }
            >
              {t(locale, "submit")}
            </button>
          ) : ["submitted", "reviewed"].includes(item.status) &&
            item.createdBy !== me.data?.id &&
            canApprove ? (
            <button
              disabled={approveAmendment.isPending}
              className="table-action"
              onClick={() =>
                approveAmendment.mutate({
                  id: item.id,
                  to: item.status === "submitted" ? "reviewed" : "effective",
                  reason: item.reason ?? item.amendmentNumber,
                })
              }
            >
              {t(locale, "approve")}
            </button>
          ) : null,
        ])}
        empty={t(locale, "noData")}
      />
      <Table
        headers={[
          t(locale, "number"),
          t(locale, "contracts"),
          c.netDue,
          t(locale, "status"),
        ]}
        rows={(certificates.data ?? []).map(item => [
          item.certificateNumber,
          `#${item.contractId}`,
          item.netDue,
          labelStatus(item.status),
        ])}
        empty={t(locale, "noData")}
      />
      <Table
        headers={[
          t(locale, "number"),
          t(locale, "supplier"),
          t(locale, "value"),
          t(locale, "status"),
        ]}
        rows={(financial.data ?? []).map(item => [
          item.operationNumber,
          `#${item.supplierId}`,
          item.amount,
          labelStatus(item.status),
        ])}
        empty={t(locale, "noData")}
      />
      {open ? (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-head">
              <h2>{t(locale, "newContract")}</h2>
              <button onClick={() => setOpen(false)}>×</button>
            </div>
            <form
              className="form-grid"
              onSubmit={event => {
                event.preventDefault();
                create.mutate({
                  title: contract.title,
                  supplierId: Number(contract.supplierId),
                  type: contract.type,
                  originalValue: Number(contract.value),
                });
              }}
            >
              <Field label={t(locale, "title")} required>
                <input
                  value={contract.title}
                  onChange={e =>
                    setContract({ ...contract, title: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label={t(locale, "supplier")} required>
                <select
                  value={contract.supplierId}
                  onChange={e =>
                    setContract({ ...contract, supplierId: e.target.value })
                  }
                  required
                >
                  <option value="">—</option>
                  {(suppliers.data ?? []).map(item => (
                    <option key={item.id} value={item.id}>
                      {item.nameAr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t(locale, "type")}>
                <select
                  value={contract.type}
                  onChange={e =>
                    setContract({ ...contract, type: e.target.value })
                  }
                >
                  <option value="supply">{c.supply}</option>
                  <option value="services">Services</option>
                </select>
              </Field>
              <Field label={t(locale, "value")} required>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={contract.value}
                  onChange={e =>
                    setContract({ ...contract, value: e.target.value })
                  }
                  required
                />
              </Field>
              <Button type="submit" disabled={create.isPending}>
                {t(locale, "create")}
              </Button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
