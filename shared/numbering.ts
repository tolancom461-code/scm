import { businessDate } from "./date";

/** Public document types share one engine, with an independent annual counter. */
export const documentPrefixes = {
  project: "PRJ",
  contract: "CTR",
  certificate: "IPC",
  inspection: "FIR",
} as const;
export type NumberedDocument = keyof typeof documentPrefixes;

export function documentPeriod(issuedAt = new Date()) {
  const date = businessDate(issuedAt);
  return { year: Number(date.slice(0, 4)), month: date.slice(5, 7) };
}

export function formatDocumentNumber(
  prefix: string,
  year: number,
  month: string,
  sequence: number
) {
  if (
    !/^[A-Z]{2,12}$/.test(prefix) ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2099 ||
    !/^(0[1-9]|1[0-2])$/.test(month) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  )
    throw new RangeError("Invalid document number components");
  // Do not truncate sequences above 9999. Two-digit years are limited to this century.
  return `${prefix}-${String(year).slice(-2)}-${month}-${String(sequence).padStart(4, "0")}`;
}
