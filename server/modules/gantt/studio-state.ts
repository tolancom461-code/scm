import { sql } from "drizzle-orm";
import { ganttStudioStates } from "../../../drizzle/construction";
import type { Transaction } from "../../core/database";

/** Advance the edit revision while retaining Studio-only notes and baselines. */
export async function touchGanttStudioStates(
  tx: Transaction,
  projectIds: Iterable<number>,
  actorId: number
) {
  const ids = [...new Set(projectIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  const updatedAt = new Date();
  await tx
    .insert(ganttStudioStates)
    .values(
      ids.map(projectId => ({
        projectId,
        stateJson: "null",
        version: 1,
        updatedBy: actorId,
        updatedAt,
      }))
    )
    .onDuplicateKeyUpdate({
      set: {
        version: sql`${ganttStudioStates.version} + 1`,
        updatedBy: actorId,
        updatedAt,
      },
    });
}
