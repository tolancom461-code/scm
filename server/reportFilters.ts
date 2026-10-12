export type ReportFilters = {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  supplierId?: number;
  status?: string;
};

export type FilterableReportModule = "requests" | "rfqs" | "contracts" | "orders" | "deliveries";

type FilterableRecord = Record<string, unknown>;

function asDateKey(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function applyReportFilters<T extends FilterableRecord>(rows: T[], filters: ReportFilters, dateKeys: string[] = ["createdAt"]) {
  return rows.filter(row => {
    if (filters.department && String(row.department ?? "") !== filters.department) return false;
    if (filters.supplierId && Number(row.supplierId) !== filters.supplierId) return false;
    if (filters.status && String(row.status ?? "") !== filters.status) return false;
    if (filters.dateFrom || filters.dateTo) {
      const dateKey = dateKeys.map(key => asDateKey(row[key])).find(Boolean);
      if (!dateKey) return false;
      if (filters.dateFrom && dateKey < filters.dateFrom) return false;
      if (filters.dateTo && dateKey > filters.dateTo) return false;
    }
    return true;
  });
}

export function normalizeReportFilters(filters?: ReportFilters): ReportFilters {
  const clean = Object.fromEntries(Object.entries(filters ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "")) as ReportFilters;
  if (clean.dateFrom && clean.dateTo && clean.dateFrom > clean.dateTo) throw new Error("FILTER_DATE_RANGE_INVALID");
  return clean;
}

export function filtersForReportModule(module: FilterableReportModule, filters?: ReportFilters) {
  const normalized = normalizeReportFilters(filters);
  return module === "requests" ? normalized : { ...normalized, department: undefined };
}

export const REPORT_STATUS_OPTIONS: Record<FilterableReportModule, string[]> = {
  requests: ["draft", "submitted", "approved", "rejected", "cancelled"],
  rfqs: ["draft", "open", "closed", "awarded", "cancelled"],
  contracts: ["draft", "active", "expired", "closed", "suspended"],
  orders: ["draft", "issued", "partially_delivered", "completed", "cancelled"],
  deliveries: ["delivered", "accepted", "rejected", "partially_accepted"],
};
