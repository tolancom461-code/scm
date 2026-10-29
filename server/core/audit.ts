import { scmAuditEvents } from "../../drizzle/foundation";
import type { Transaction } from "./database";

export async function recordChange(
  tx: Transaction,
  input: {
    actorId: number;
    action: string;
    entityType: string;
    entityId: number;
    before?: unknown;
    after?: unknown;
    reason?: string;
  }
) {
  await tx.insert(scmAuditEvents).values(input);
}
