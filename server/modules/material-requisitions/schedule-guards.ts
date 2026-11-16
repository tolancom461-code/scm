import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "../../../drizzle/construction";
import type { Transaction } from "../../core/database";

export function assertRequisitionSourceStart(
  request:
    | { number: string; projectName: string; startDate: string | null }
    | undefined
) {
  if (!request || request.startDate) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `لا يمكن إزالة البداية المخططة للمشروع «${request.projectName}» لارتباطها بمسودة طلب الاحتياج ${request.number}. / ` +
      `Cannot clear the planned start of project “${request.projectName}” while it is linked to material requisition draft ${request.number}. / ` +
      `منصوبے «${request.projectName}» کے آغاز کی طے شدہ تاریخ حذف نہیں ہو سکتی کیونکہ یہ مواد کی درخواست کے مسودے ${request.number} سے منسلک ہے۔`,
  });
}

/** Drafts need a planned start. Approved requisition dates are already fixed. */
export async function assertDraftRequisitionSourceStarts(
  tx: Transaction,
  projectIds: number[]
) {
  const ids = [...new Set(projectIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  await lockRequisitionSourceProjects(tx, ids);
  const [missingSourceStart] = await tx
    .select({
      number: s.materialRequisitions.number,
      projectName: s.constructionProjects.name,
      startDate: s.constructionProjects.plannedStartDate,
    })
    .from(s.materialRequisitions)
    .innerJoin(
      s.constructionProjects,
      eq(s.materialRequisitions.projectId, s.constructionProjects.id)
    )
    .where(
      and(
        inArray(s.materialRequisitions.projectId, ids),
        eq(s.materialRequisitions.status, "draft"),
        isNull(s.materialRequisitions.taskId),
        isNull(s.constructionProjects.plannedStartDate)
      )
    )
    .limit(1)
    .for("update");
  assertRequisitionSourceStart(missingSourceStart);
}

/** Approval takes this same lock before its task/request locks. */
export async function lockRequisitionSourceProjects(
  tx: Transaction,
  projectIds: number[]
) {
  const ids = [...new Set(projectIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  await tx
    .select({ id: s.constructionProjects.id })
    .from(s.constructionProjects)
    .where(inArray(s.constructionProjects.id, ids))
    .orderBy(s.constructionProjects.id)
    .for("update");
}

export async function assertTasksWithoutRequisitions(
  tx: Transaction,
  taskIds: number[]
) {
  if (!taskIds.length) return;
  const [request] = await tx
    .select({ number: s.materialRequisitions.number })
    .from(s.materialRequisitions)
    .where(inArray(s.materialRequisitions.taskId, taskIds))
    .limit(1)
    .for("update");
  if (request)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `لا يمكن حذف المهمة لارتباطها بطلب الاحتياج ${request.number}. / ` +
        `Cannot delete a task linked to material requisition ${request.number}. / ` +
        `مواد کی درخواست ${request.number} سے منسلک کام حذف نہیں ہو سکتا۔`,
    });
}
