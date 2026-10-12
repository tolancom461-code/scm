import { describe, expect, it } from "vitest";
import { buildCappedExcelWorkbook, buildExcelWorkbook, capReportRows, createPdfAuditFooter, createPdfMetadata, MAX_REPORT_ROWS, reportStatus, safeExcelValue, summarizeReport } from "./reporting";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";

describe("safeExcelValue", () => {
  it("prefixes potentially executable spreadsheet formulas", () => {
    ["=SUM(A1:A2)", "+CMD()", "-1+2", "@external"].forEach(value => expect(safeExcelValue(value)).toBe(`'${value}`));
  });

  it("preserves ordinary report values", () => {
    expect(safeExcelValue("PR-2026-0001")).toBe("PR-2026-0001");
    expect(safeExcelValue("توريد أجهزة")).toBe("توريد أجهزة");
  });

  it("caps reports at the configured maximum row count", () => {
    expect(capReportRows(Array.from({ length: MAX_REPORT_ROWS + 2 }, (_, id) => id))).toHaveLength(MAX_REPORT_ROWS);
  });

  it("translates the full operational status vocabulary used by reports", () => {
    ["draft", "submitted", "approved", "rejected", "cancelled", "open", "active", "expired", "closed", "suspended", "issued", "completed", "delivered", "accepted", "partially_delivered", "partially_accepted", "late", "partial", "compliant", "non_compliant", "awarded", "recorded"].forEach(status => {
      expect(reportStatus(status, "ar")).not.toBe(status);
      expect(reportStatus(status, "en")).not.toBe(status);
      expect(reportStatus(status, "ur")).not.toBe(status);
    });
  });

  it("builds summary metrics from report values and statuses", () => {
    expect(summarizeReport([{ estimatedValue: "100", status: "draft" }, { estimatedValue: "50", status: "approved" }])).toEqual({ recordCount: 2, totalValue: 150, statusCounts: { draft: 1, approved: 1 } });
  });

  it("writes localized headers and records into the generated Excel workbook", () => {
    const workbook = buildExcelWorkbook("Requests", [{ "حوالہ": "PR-2026-01", "حالت": "منظور" }], [["رپورٹ", "Requests"]]);
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const reloaded = XLSX.read(output, { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(reloaded.Sheets[reloaded.SheetNames[0]], { header: 1, raw: false })).toEqual([["حوالہ", "حالت"], ["PR-2026-01", "منظور"]]);
  });

  it("applies the 10,000-row cap in the Excel workbook produced by the export engine", () => {
    const workbook = buildCappedExcelWorkbook("Requests", Array.from({ length: MAX_REPORT_ROWS + 5 }, (_, id) => ({ Reference: `PR-${id}` })), []);
    const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const reloaded = XLSX.read(output, { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(reloaded.Sheets[reloaded.SheetNames[0]], { header: 1 })).toHaveLength(MAX_REPORT_ROWS + 1);
  });

  it("writes report identity, KPI count, and headers into PDF metadata", () => {
    const metadata = createPdfMetadata("requests", 1, ["حوالہ", "حالت"], "PR-2026-01");
    expect(metadata.title).toBe("PROCURE//NEXUS Report Export");
    expect(metadata.subject).toContain("records=1");
    expect(metadata.subject).toContain("headers=");
    expect(metadata.subject).toContain("sample=PR-2026-01");
    const pdf = new jsPDF();
    pdf.setProperties(metadata);
    const auditFooter = createPdfAuditFooter("requests", 1, ["requestNumber", "status"], "PR-2026-01", 1250, 1);
    pdf.setTextColor(51, 65, 85); pdf.setFontSize(8); pdf.text(auditFooter, 10, 20);
    const actualPdf = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
    expect(actualPdf).toContain("PROCURE//NEXUS Report Export");
    expect(actualPdf).toContain("Records: 1");
    expect(actualPdf).toContain("Total: 1250");
    expect(actualPdf).toContain("Fields: requestNumber, status");
    expect(actualPdf).toContain("Sample: PR-2026-01");
  });
});
