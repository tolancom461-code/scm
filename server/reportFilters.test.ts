import { describe, expect, it } from "vitest";
import { applyReportFilters, filtersForReportModule, normalizeReportFilters } from "./reportFilters";

const rows = [
  { id: 1, department: "Operations", supplierId: 3, createdAt: new Date("2026-02-10T10:00:00Z") },
  { id: 2, department: "Finance", supplierId: 4, createdAt: new Date("2026-03-15T10:00:00Z") },
  { id: 3, department: "Operations", supplierId: 4, createdAt: new Date("2026-04-20T10:00:00Z") },
];

describe("report filters", () => {
  it("combines the date, department, and supplier filters", () => {
    expect(applyReportFilters(rows, { dateFrom: "2026-02-01", dateTo: "2026-03-31", department: "Operations", supplierId: 3 }).map(row => row.id)).toEqual([1]);
  });

  it("keeps rows in an inclusive date boundary", () => {
    expect(applyReportFilters(rows, { dateFrom: "2026-03-15", dateTo: "2026-03-15" }).map(row => row.id)).toEqual([2]);
  });

  it("normalizes empty values and rejects an inverted date range", () => {
    expect(normalizeReportFilters({ department: "", supplierId: undefined })).toEqual({});
    expect(() => normalizeReportFilters({ dateFrom: "2026-04-01", dateTo: "2026-03-01" })).toThrow("FILTER_DATE_RANGE_INVALID");
  });

  it("only permits the department filter for purchase request reports", () => {
    expect(filtersForReportModule("requests", { department: "Operations", supplierId: 3 })).toEqual({ department: "Operations", supplierId: 3 });
    expect(filtersForReportModule("contracts", { department: "Operations", supplierId: 3 })).toEqual({ department: undefined, supplierId: 3 });
    expect(filtersForReportModule("rfqs", { department: "Operations" })).toEqual({ department: undefined });
  });

  it("filters representative RFQ, contract, order, and delivery rows by date and supplier", () => {
    const moduleRows = [
      { id: "rfq", supplierId: 8, createdAt: new Date("2026-05-01T00:00:00Z") },
      { id: "contract", supplierId: 8, createdAt: new Date("2026-05-02T00:00:00Z") },
      { id: "order", supplierId: 8, createdAt: new Date("2026-05-03T00:00:00Z") },
      { id: "delivery", supplierId: 8, deliveredAt: new Date("2026-05-04T00:00:00Z") },
      { id: "other-supplier", supplierId: 9, createdAt: new Date("2026-05-02T00:00:00Z") },
    ];
    expect(applyReportFilters(moduleRows.slice(0, 4), { supplierId: 8, dateFrom: "2026-05-01", dateTo: "2026-05-03" }, ["deliveredAt", "createdAt"]).map(row => row.id)).toEqual(["rfq", "contract", "order"]);
    expect(applyReportFilters(moduleRows, { supplierId: 8 }, ["deliveredAt", "createdAt"]).map(row => row.id)).toEqual(["rfq", "contract", "order", "delivery"]);
  });

  it("filters by current operational status", () => {
    const statusRows = [{ id: 1, status: "draft" }, { id: 2, status: "approved" }, { id: 3, status: "approved" }];
    expect(applyReportFilters(statusRows, { status: "approved" }).map(row => row.id)).toEqual([2, 3]);
  });
});
