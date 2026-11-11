import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "../../../drizzle/construction";
import { leadDays } from "../../../shared/material-requisitions";
import type { Transaction } from "../../core/database";

export type ApprovedNeedBoundary = {
  number: string;
  taskName: string | null;
  projectName: string;
  itemName: string;
  needDate: string;
  startDate: string | null;
};

/** Approved dates are an external commitment; scheduling cannot consume their lead time. */
export function assertApprovedNeedBoundaries(rows: ApprovedNeedBoundary[]) {
  const conflict = rows.find(
    row => !row.startDate || leadDays(row.startDate, row.needDate) < 3
  );
  if (!conflict) return;
  const source = conflict.taskName ?? conflict.projectName;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `تعذر حفظ الجدولة: طلب الاحتياج الرسمي ${conflict.number} للصنف «${conflict.itemName}» بتاريخ ${conflict.needDate} يجب أن يسبق بداية «${source}» (${conflict.startDate ?? "—"}) بثلاثة أيام على الأقل. بيانات الطلب المعتمد مقفلة. / ` +
      `Schedule blocked: approved requisition ${conflict.number}, item “${conflict.itemName}”, need date ${conflict.needDate} must remain at least three days before “${source}” (${conflict.startDate ?? "—"}). Approved request data is locked. / ` +
      `شیڈول محفوظ نہیں ہوا: منظور شدہ درخواست ${conflict.number} کی ضرورت کی تاریخ ${conflict.needDate}، «${source}» کے آغاز (${conflict.startDate ?? "—"}) سے کم از کم تین دن پہلے ہونی چاہیے۔ منظور شدہ درخواست مقفل ہے۔`,
  });
}

export function assertRequisitionSourceStart(
  request:
    | { number: string; projectName: string; startDate: string | null }
    | undefined
) {
  if (!request || request.startDate) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `لا يمكن إزالة تاريخ بداية المشروع «${request.projectName}» لارتباطه بطلب الاحتياج ${request.number}. / ` +
      `Cannot clear the start date of project “${request.projectName}” while it is linked to material requisition ${request.number}. / ` +
      `منصوبے «${request.projectName}» کی تاریخ آغاز حذف نہیں ہو سکتی کیونکہ یہ مواد کی درخواست ${request.number} سے منسلک ہے۔`,
  });
}

/** Call inside the schedule mutation transaction after all rollups and propagation. */
export async function assertApprovedRequisitionDates(
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
        isNull(s.materialRequisitions.taskId),
        isNull(s.constructionProjects.actualStartDate),
        isNull(s.constructionProjects.plannedStartDate)
      )
    )
    .limit(1)
    .for("update");
  assertRequisitionSourceStart(missingSourceStart);
  const rows = await tx
    .select({
      number: s.materialRequisitions.number,
      taskId: s.materialRequisitions.taskId,
      taskName: s.projectTasks.name,
      taskStartDate: s.projectTasks.startDate,
      projectName: s.constructionProjects.name,
      projectActualStart: s.constructionProjects.actualStartDate,
      projectPlannedStart: s.constructionProjects.plannedStartDate,
      itemName: s.materialRequisitionItems.itemName,
      needDate: s.materialRequisitionItems.needDate,
    })
    .from(s.materialRequisitions)
    .innerJoin(
      s.constructionProjects,
      eq(s.materialRequisitions.projectId, s.constructionProjects.id)
    )
    .leftJoin(
      s.projectTasks,
      eq(s.materialRequisitions.taskId, s.projectTasks.id)
    )
    .innerJoin(
      s.materialRequisitionItems,
      eq(s.materialRequisitionItems.requisitionId, s.materialRequisitions.id)
    )
    .where(
      and(
        inArray(s.materialRequisitions.projectId, ids),
        eq(s.materialRequisitions.status, "approved")
      )
    )
    .for("update");
  assertApprovedNeedBoundaries(
    rows.map(row => ({
      ...row,
      startDate: row.taskId
        ? row.taskStartDate
        : (row.projectActualStart ?? row.projectPlannedStart),
    }))
  );
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
