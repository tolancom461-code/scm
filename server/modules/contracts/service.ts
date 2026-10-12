import { eq } from "drizzle-orm";
import { contractAmendments, contracts } from "../../../drizzle/schema";
import { decimal, formatDecimal } from "../../../shared/decimal";
import { database } from "../../core/database";
import { DomainError } from "../../core/errors";
import { recordChange } from "../../core/audit";
import { calculateContractEndDate } from "../../contracts";

export type AmendmentTarget = "submitted" | "reviewed" | "effective";
export function assertAmendmentTransition(
  current: string,
  to: AmendmentTarget,
  creatorId: number,
  actorId: number
) {
  const allowed: Record<AmendmentTarget, string> = {
    submitted: "draft",
    reviewed: "submitted",
    effective: "reviewed",
  };
  if (current !== allowed[to]) throw new DomainError("INVALID_TRANSITION");
  if (to === "submitted" && actorId !== creatorId)
    throw new DomainError("DUTY_CONFLICT");
  if (to !== "submitted" && creatorId === actorId)
    throw new DomainError("DUTY_CONFLICT");
}
export async function transitionAmendment(
  id: number,
  to: AmendmentTarget,
  actorId: number,
  reason: string
) {
  return (await database()).transaction(async tx => {
    const [amendment] = await tx
      .select()
      .from(contractAmendments)
      .where(eq(contractAmendments.id, id))
      .for("update");
    if (!amendment) throw new DomainError("NOT_FOUND");
    assertAmendmentTransition(
      amendment.status,
      to,
      amendment.createdBy,
      actorId
    );
    const [contract] = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, amendment.contractId))
      .for("update");
    if (!contract) throw new DomainError("NOT_FOUND");
    if (["cancelled", "closed", "terminated"].includes(contract.status))
      throw new DomainError("INVALID_TRANSITION");
    if (to === "effective") {
      const nextValue =
        decimal(contract.currentValue) + decimal(amendment.valueChange);
      if (nextValue < 0n) throw new DomainError("INVALID_INPUT");
      const after = {
        currentValue: formatDecimal(nextValue),
        endDate: calculateContractEndDate(
          contract.endDate,
          amendment.extensionDays
        ),
      };
      await tx
        .update(contracts)
        .set(after)
        .where(eq(contracts.id, contract.id));
      await recordChange(tx, {
        actorId,
        action: "contract.amendment.effective",
        entityType: "contract",
        entityId: contract.id,
        before: {
          currentValue: contract.currentValue,
          endDate: contract.endDate,
        },
        after,
        reason,
      });
    }
    await tx
      .update(contractAmendments)
      .set({ status: to })
      .where(eq(contractAmendments.id, id));
    await recordChange(tx, {
      actorId,
      action: `amendment.${to}`,
      entityType: "contract_amendment",
      entityId: id,
      before: { status: amendment.status },
      after: { status: to },
      reason,
    });
    return { id };
  });
}
