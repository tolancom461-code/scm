import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { operationKeys } from "../../drizzle/foundation";
import type { Transaction } from "./database";
import { DomainError } from "./errors";

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export function payloadHash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
/** Must run inside the SAME transaction as the business mutation. */
export async function once(
  tx: Transaction,
  actorId: number,
  operation: string,
  key: string,
  payload: unknown,
  execute: () => Promise<{ id: number }>
) {
  const hash = payloadHash(payload);
  await tx
    .insert(operationKeys)
    .values({ actorId, operation, key, payloadHash: hash })
    .onDuplicateKeyUpdate({ set: { key } });
  const filter = and(
    eq(operationKeys.actorId, actorId),
    eq(operationKeys.operation, operation),
    eq(operationKeys.key, key)
  );
  const [existing] = await tx
    .select()
    .from(operationKeys)
    .where(filter)
    .for("update");
  if (!existing || existing.payloadHash !== hash)
    throw new DomainError("CONFLICT");
  if (existing.result) return existing.result;
  const result = await execute();
  await tx.update(operationKeys).set({ result }).where(filter);
  return result;
}
