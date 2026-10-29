import { and, eq } from "drizzle-orm";
import { documentSequences } from "../../drizzle/foundation";
import { database, type Transaction } from "./database";
import { DomainError } from "./errors";
import {
  documentPeriod,
  documentPrefixes,
  formatDocumentNumber,
  type NumberedDocument,
} from "../../shared/numbering";

export async function allocateDocumentNumber(
  tx: Transaction,
  prefix: string,
  period?: number | Date
) {
  const issued = documentPeriod(period instanceof Date ? period : undefined);
  const year = typeof period === "number" ? period : issued.year;
  // WORKFLOW/0 is an internal mutex, not a public document number.
  const internal = prefix === "WORKFLOW" && year === 0;
  if (
    !/^[A-Z]{2,12}$/.test(prefix) ||
    (!internal && (!Number.isInteger(year) || year < 2000 || year > 2099))
  )
    throw new DomainError("INVALID_INPUT");
  // The unique key serializes creation of a previously unseen sequence.
  await tx
    .insert(documentSequences)
    .values({ prefix, year })
    .onDuplicateKeyUpdate({ set: { prefix } });
  const filter = and(
    eq(documentSequences.prefix, prefix),
    eq(documentSequences.year, year)
  );
  const [row] = await tx
    .select()
    .from(documentSequences)
    .where(filter)
    .for("update");
  if (!row) throw new DomainError("SERVICE_UNAVAILABLE");
  if (row.nextValue < 1 || row.nextValue >= 2147483647)
    throw new DomainError("SERVICE_UNAVAILABLE");
  await tx
    .update(documentSequences)
    .set({ nextValue: row.nextValue + 1 })
    .where(filter);
  return internal
    ? `${prefix}-0-${String(row.nextValue).padStart(6, "0")}`
    : formatDocumentNumber(prefix, year, issued.month, row.nextValue);
}
export function allocateRecordNumber(
  tx: Transaction,
  document: NumberedDocument,
  issuedAt = new Date()
) {
  return allocateDocumentNumber(tx, documentPrefixes[document], issuedAt);
}
/** Allocates a standalone supplier or attachment reference. */
export async function nextDocumentNumber(prefix: string) {
  return (await database()).transaction(tx =>
    allocateDocumentNumber(tx, prefix)
  );
}
