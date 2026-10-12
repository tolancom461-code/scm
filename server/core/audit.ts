import { randomUUID } from "node:crypto";
import { scmAuditEvents, scmOutbox } from "../../drizzle/foundation";
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
  await tx
    .insert(scmOutbox)
    .values({
      eventId: randomUUID(),
      type: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: { actorId: input.actorId, entityId: input.entityId },
    });
}
