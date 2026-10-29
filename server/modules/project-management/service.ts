import { TRPCError } from "@trpc/server";
import { and, eq, inArray, desc, like, or } from "drizzle-orm";
import type { z } from "zod";
import * as s from "../../../drizzle/construction";
import { users } from "../../../drizzle/schema";
import { accessConstructionProjects } from "../../../drizzle/policy";
import {
  projectSaveInput,
  projectActionInput,
  projectTransition,
  taskInput,
  taskDateConflicts,
  employeeInput,
  statusInput,
} from "../../../shared/construction";
import { database, type Transaction } from "../../core/database";
import {
  assertConstructionAccess,
  constructionScope,
  canAccess,
  type AccessContext,
} from "../../core/policy";
import { allocateRecordNumber } from "../../core/numbering";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { DomainError } from "../../core/errors";
function invalid(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function requirePermission(a: AccessContext, p: string) {
  if (!canAccess(a, p))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا تملك صلاحية هذا الإجراء / Access denied",
    });
}
export async function lockedProject(
  tx: Transaction,
  id: number,
  a: AccessContext
) {
  await assertConstructionAccess(a, id, tx);
  const [p] = await tx
    .select()
    .from(s.constructionProjects)
    .where(eq(s.constructionProjects.id, id))
    .for("update");
  if (!p) throw new DomainError("NOT_FOUND");
  return p;
}
export function assertEditable(p: { status: string }, a: AccessContext) {
  requirePermission(a, "pm.edit");
  if (!["draft", "returned"].includes(p.status))
    invalid(
      "يمكن تعديل المسودة أو المشروع المعاد للتعديل فقط / Only drafts and returned projects can be edited"
    );
}
export async function listProjects(a: AccessContext, q = "", status = "") {
  return (await database())
    .select()
    .from(s.constructionProjects)
    .where(
      and(
        constructionScope(a, s.constructionProjects.id),
        q
          ? or(
              like(s.constructionProjects.name, "%" + q + "%"),
              like(s.constructionProjects.number, "%" + q + "%")
            )
          : undefined,
        status ? eq(s.constructionProjects.status, status) : undefined
      )
    )
    .orderBy(desc(s.constructionProjects.id))
    .limit(200);
}
export async function directory() {
  const db = await database();
  const [employees, statuses] = await Promise.all([
    db.select().from(s.employees).orderBy(s.employees.name),
    db.select().from(s.taskStatuses).orderBy(s.taskStatuses.id),
  ]);
  return { employees, statuses };
}
export async function detail(id: number, a: AccessContext) {
  const project = await assertConstructionAccess(a, id);
  const db = await database();
  const [tasks, assignees, events] = await Promise.all([
    db
      .select()
      .from(s.projectTasks)
      .where(eq(s.projectTasks.projectId, id))
      .orderBy(s.projectTasks.id),
    db
      .select({
        taskId: s.taskAssignees.taskId,
        employeeId: s.taskAssignees.employeeId,
      })
      .from(s.taskAssignees)
      .innerJoin(s.projectTasks, eq(s.taskAssignees.taskId, s.projectTasks.id))
      .where(eq(s.projectTasks.projectId, id)),
    db
      .select({
        id: s.projectEvents.id,
        action: s.projectEvents.action,
        comment: s.projectEvents.comment,
        createdAt: s.projectEvents.createdAt,
        actor: users.name,
      })
      .from(s.projectEvents)
      .leftJoin(users, eq(s.projectEvents.actorId, users.id))
      .where(eq(s.projectEvents.projectId, id))
      .orderBy(desc(s.projectEvents.id)),
  ]);
  return {
    project,
    tasks: tasks.map(t => ({
      ...t,
      employeeIds: assignees
        .filter(e => e.taskId === t.id)
        .map(e => e.employeeId),
    })),
    events,
  };
}
export async function saveProject(
  input: z.infer<typeof projectSaveInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "pm.project.save", input.key, input, async () => {
      if (input.id) {
        const p = await lockedProject(tx, input.id, a);
        assertEditable(p, a);
        if (p.version !== input.version) throw new DomainError("CONFLICT");
        await tx
          .update(s.constructionProjects)
          .set({ ...input.data, version: p.version + 1, updatedAt: new Date() })
          .where(eq(s.constructionProjects.id, p.id));
        await recordChange(tx, {
          actorId: a.user.id,
          action: "pm.project.edited",
          entityType: "pm_project",
          entityId: p.id,
          before: p,
          after: input.data,
        });
        return { id: p.id };
      }
      requirePermission(a, "pm.create");
      const number = await allocateRecordNumber(tx, "project");
      const [result] = await tx
        .insert(s.constructionProjects)
        .values({ ...input.data, number, createdBy: a.user.id });
      const id = Number(result.insertId);
      await tx
        .insert(accessConstructionProjects)
        .values({ userId: a.user.id, projectId: id });
      await recordChange(tx, {
        actorId: a.user.id,
        action: "pm.project.created",
        entityType: "pm_project",
        entityId: id,
        after: { ...input.data, number },
      });
      return { id };
    })
  );
}
export async function projectAction(
  input: z.infer<typeof projectActionInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "pm.project.action", input.key, input, async () => {
      const p = await lockedProject(tx, input.id, a);
      if (p.version !== input.version) throw new DomainError("CONFLICT");
      requirePermission(
        a,
        input.action === "submit"
          ? "pm.submit"
          : input.action === "start"
            ? "pm.start"
            : "pm.review"
      );
      let target: string;
      try {
        target = projectTransition(p.status, input.action);
      } catch {
        throw new DomainError("INVALID_TRANSITION");
      }
      if (
        input.action === "submit" &&
        (!p.site.trim() || !p.description.trim())
      )
        invalid(
          "أكمل الموقع ووصف المشروع قبل الإرسال / Complete the location and description before submitting"
        );
      if (
        ["return", "reject"].includes(input.action) &&
        input.comment.length < 3
      )
        invalid("اكتب سبب طلب التعديل أو الرفض / A reason is required");
      await tx
        .update(s.constructionProjects)
        .set({
          status: target,
          version: p.version + 1,
          updatedAt: new Date(),
          ...(target === "active" ? { startedAt: new Date() } : {}),
        })
        .where(eq(s.constructionProjects.id, p.id));
      await tx.insert(s.projectEvents).values({
        projectId: p.id,
        action: input.action,
        comment: input.comment,
        actorId: a.user.id,
      });
      await recordChange(tx, {
        actorId: a.user.id,
        action: "pm.project." + input.action,
        entityType: "pm_project",
        entityId: p.id,
        before: { status: p.status },
        after: { status: target },
        reason: input.comment,
      });
      return { id: p.id };
    })
  );
}
export async function saveTask(
  input: z.infer<typeof taskInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "pm.task.save", input.key, input, async () => {
      requirePermission(a, "pm.tasks.manage");
      const project = await lockedProject(tx, input.projectId, a);
      if (project.status !== "active")
        invalid(
          "ابدأ تنفيذ المشروع المعتمد قبل إضافة المهام / Start the approved project before adding tasks"
        );
      const tasks = await tx
        .select()
        .from(s.projectTasks)
        .where(eq(s.projectTasks.projectId, project.id));
      const original = input.id
        ? tasks.find(t => t.id === input.id)
        : undefined;
      if (input.id && (!original || original.version !== input.version))
        throw new DomainError("CONFLICT");
      if (original && original.parentId !== input.parentId)
        invalid(
          "لا يمكن تغيير المهمة الأم / The parent task cannot be changed"
        );
      const parent = input.parentId
        ? tasks.find(t => t.id === input.parentId)
        : undefined;
      if (input.parentId && !parent) throw new DomainError("INVALID_REFERENCE");
      const level = parent ? parent.level + 1 : 1;
      if (level > 5)
        invalid(
          "الحد الأقصى مهمة رئيسية وأربعة مستويات فرعية / Maximum: one main task and four sublevels"
        );
      const conflicts = taskDateConflicts(input, tasks);
      if (conflicts.length)
        invalid(
          "التواريخ خارج فترة المهمة الأم أو المهام التابعة: " +
            conflicts.join("، ") +
            " / Task dates conflict with parent or child tasks"
        );
      const [status] = await tx
        .select()
        .from(s.taskStatuses)
        .where(eq(s.taskStatuses.id, input.statusId));
      if (!status) throw new DomainError("INVALID_REFERENCE");
      if (status.code !== "not_started" && parent) {
        const byId = new Map(tasks.map(task => [task.id, task]));
        const ancestors: typeof tasks = [];
        let ancestor = parent;
        while (ancestor) {
          ancestors.push(ancestor);
          ancestor = ancestor.parentId ? byId.get(ancestor.parentId)! : undefined!;
        }
        const ancestorStatuses = await tx.select().from(s.taskStatuses);
        const statusById = new Map(ancestorStatuses.map(item => [item.id, item]));
        const notStarted = ancestors.filter(
          task => statusById.get(task.statusId)?.code === "not_started"
        );
        if (notStarted.length)
          invalid(
            "حدّث حالة المهام الأم أولًا إلى «جاري العمل»: " +
              notStarted.map(task => task.name).join("، ") +
              " / Update parent task statuses to In progress first"
          );
      }
      const responsible = await tx
        .select()
        .from(s.employees)
        .where(inArray(s.employees.id, input.employeeIds));
      if (
        responsible.length !== input.employeeIds.length ||
        responsible.some(e => !e.active)
      )
        invalid(
          "اختر موظفين متاحين من قائمة الموظفين / Choose active employees from the directory"
        );
      const data = {
        projectId: project.id,
        parentId: input.parentId,
        name: input.name,
        statusId: input.statusId,
        startDate: input.startDate,
        endDate: input.endDate,
        priority: input.priority,
        level,
        updatedAt: new Date(),
      };
      let id = input.id;
      if (original) {
        await tx
          .update(s.projectTasks)
          .set({ ...data, version: original.version + 1 })
          .where(eq(s.projectTasks.id, original.id));
        await tx
          .delete(s.taskAssignees)
          .where(eq(s.taskAssignees.taskId, original.id));
      } else {
        const [r] = await tx
          .insert(s.projectTasks)
          .values({ ...data, createdBy: a.user.id });
        id = Number(r.insertId);
      }
      await tx
        .insert(s.taskAssignees)
        .values(
          input.employeeIds.map(employeeId => ({ taskId: id!, employeeId }))
        );
      await recordChange(tx, {
        actorId: a.user.id,
        action: original ? "pm.task.edited" : "pm.task.created",
        entityType: "pm_project",
        entityId: project.id,
        before: original,
        after: { ...data, id, employeeIds: input.employeeIds },
      });
      return { id: id! };
    })
  );
}
export async function saveEmployee(
  input: z.infer<typeof employeeInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "pm.employee.save", input.key, input, async () => {
      const data = {
        name: input.name,
        jobTitle: input.jobTitle,
        active: input.active,
      };
      let id = input.id;
      if (id) {
        const [old] = await tx
          .select()
          .from(s.employees)
          .where(eq(s.employees.id, id))
          .for("update");
        if (!old || old.version !== input.version)
          throw new DomainError("CONFLICT");
        await tx
          .update(s.employees)
          .set({ ...data, version: old.version + 1 })
          .where(eq(s.employees.id, id));
      } else {
        const [r] = await tx.insert(s.employees).values(data);
        id = Number(r.insertId);
      }
      await recordChange(tx, {
        actorId: a.user.id,
        action: "pm.employee.saved",
        entityType: "pm_employee",
        entityId: id!,
        after: data,
      });
      return { id: id! };
    })
  );
}
export async function saveStatus(
  input: z.infer<typeof statusInput>,
  a: AccessContext
) {
  return (await database()).transaction(tx =>
    once(tx, a.user.id, "pm.status.save", input.key, input, async () => {
      const [duplicate] = await tx
        .select()
        .from(s.taskStatuses)
        .where(eq(s.taskStatuses.name, input.name));
      if (duplicate && duplicate.id !== input.id)
        invalid("هذه الحالة موجودة بالفعل / This status already exists");
      let id = input.id;
      if (id) {
        const [old] = await tx
          .select()
          .from(s.taskStatuses)
          .where(eq(s.taskStatuses.id, id))
          .for("update");
        if (!old || old.version !== input.version)
          throw new DomainError("CONFLICT");
        await tx
          .update(s.taskStatuses)
          .set({ name: input.name, version: old.version + 1 })
          .where(eq(s.taskStatuses.id, id));
      } else {
        const [r] = await tx
          .insert(s.taskStatuses)
          .values({ code: "custom-" + input.key, name: input.name });
        id = Number(r.insertId);
      }
      await recordChange(tx, {
        actorId: a.user.id,
        action: "pm.taskStatus.saved",
        entityType: "pm_status",
        entityId: id!,
        after: { name: input.name },
      });
      return { id: id! };
    })
  );
}
