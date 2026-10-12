export type ReportModule = "requests" | "rfqs" | "contracts" | "orders" | "deliveries";
export const MAX_REPORT_ROWS = 10_000;

import * as XLSX from "xlsx";

/** Prevent spreadsheet applications from evaluating a cell as a formula. */
export function safeExcelValue(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function capReportRows<T>(rows: T[]) { return rows.slice(0, MAX_REPORT_ROWS); }

const statuses = {
  ar: { draft: "مسودة", submitted: "مُرسل", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغى", pending: "قيد الانتظار", active: "نشط", expired: "منتهٍ", closed: "مغلق", suspended: "معلّق", issued: "صادر", completed: "مكتمل", delivered: "تم التوريد", accepted: "مقبول", partially_delivered: "مورد جزئياً", partially_accepted: "مقبول جزئياً", partial: "توريد جزئي", late: "متأخر", compliant: "مطابق", non_compliant: "غير مطابق", awarded: "مرسى", open: "مفتوح", recorded: "مسجل", supply: "توريد", payment: "دفعة" },
  en: { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", pending: "Pending", active: "Active", expired: "Expired", closed: "Closed", suspended: "Suspended", issued: "Issued", completed: "Completed", delivered: "Delivered", accepted: "Accepted", partially_delivered: "Partially delivered", partially_accepted: "Partially accepted", partial: "Partial delivery", late: "Late", compliant: "Compliant", non_compliant: "Non-compliant", awarded: "Awarded", open: "Open", recorded: "Recorded", supply: "Supply", payment: "Payment" },
  ur: { draft: "مسودہ", submitted: "جمع شدہ", approved: "منظور", rejected: "مسترد", cancelled: "منسوخ", pending: "زیر التواء", active: "فعال", expired: "ختم شدہ", closed: "بند", suspended: "معطل", issued: "جاری شدہ", completed: "مکمل", delivered: "ڈیلیور شدہ", accepted: "قبول شدہ", partially_delivered: "جزوی طور پر ڈیلیور", partially_accepted: "جزوی طور پر قبول", partial: "جزوی ڈیلیوری", late: "تاخیر سے", compliant: "مطابق", non_compliant: "غیر مطابق", awarded: "ایوارڈ شدہ", open: "کھلا", recorded: "درج", supply: "سپلائی", payment: "ادائیگی" },
} as const;

export type ReportLocale = keyof typeof statuses;
export function reportStatus(value: unknown, locale: ReportLocale) {
  if (typeof value !== "string") return String(value ?? "—");
  return (statuses[locale] as Record<string, string>)[value] ?? value.replace(/_/g, " ");
}

export function summarizeReport(rows: Array<Record<string, unknown>>) {
  const valueKeys = ["estimatedValue", "currentValue", "totalAmount", "deliveredValue"];
  const totalValue = rows.reduce((sum, row) => {
    const key = valueKeys.find(candidate => row[candidate] !== undefined);
    return sum + (key ? Number(row[key]) || 0 : 0);
  }, 0);
  const statusCounts = rows.reduce<Record<string, number>>((result, row) => {
    const status = typeof row.status === "string" ? row.status : "unknown";
    result[status] = (result[status] ?? 0) + 1;
    return result;
  }, {});
  return { recordCount: rows.length, totalValue, statusCounts };
}

export function buildExcelWorkbook(sheetName: string, rows: Array<Record<string, string>>, summaryRows: string[][]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? {});
  worksheet["!cols"] = headers.map(header => ({ wch: Math.max(14, header.length + 4) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 28));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
  return workbook;
}

export function buildCappedExcelWorkbook(sheetName: string, rows: Array<Record<string, string>>, summaryRows: string[][]) {
  return buildExcelWorkbook(sheetName, capReportRows(rows), summaryRows);
}

export function createPdfMetadata(module: ReportModule, recordCount: number, headers: string[], sampleRecord = "") {
  return { title: "PROCURE//NEXUS Report Export", subject: `module=${module};records=${recordCount};headers=${headers.join("|")};sample=${sampleRecord}` };
}

export function createPdfAuditFooter(module: ReportModule, recordCount: number, headers: string[], sampleRecord = "", totalValue = 0, statusCount = 0, appliedFilters = "—") {
  return `Procure Nexus | ${module} | Records: ${recordCount} | Total: ${totalValue} | Status groups: ${statusCount} | Filters: ${appliedFilters} | Fields: ${headers.join(", ")} | Sample: ${sampleRecord}`;
}
