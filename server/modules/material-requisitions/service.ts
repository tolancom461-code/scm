import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { z } from "zod";
import * as s from "../../../drizzle/construction";
import { users } from "../../../drizzle/schema";
import { scmAuditEvents } from "../../../drizzle/foundation";
import {
  dateFromLead,
  leadDays,
  materialRequisitionApproveInput,
  materialRequisitionListInput,
  materialRequisitionSaveInput,
  materialUnitSaveInput,
  externalPurchaseRequestUpdateInput,
} from "../../../shared/material-requisitions";
import { database, type Database, type Transaction } from "../../core/database";
import {
  assertConstructionAccess,
  constructionScope,
  type AccessContext,
} from "../../core/policy";
import { allocateRecordNumber } from "../../core/numbering";
import { once } from "../../core/idempotency";
import { recordChange } from "../../core/audit";
import { DomainError } from "../../core/errors";
import { catalogImageUrl } from "./catalog";

function invalid(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
const lockedMessage =
  "الطلب المعتمد مقفل ولا يمكن تعديله / Approved request is locked / منظور شدہ درخواست مقفل ہے۔";
const defaultUnits = [
  ["PCS", "حبة", "Piece", "عدد"],
  ["KG", "كجم", "Kilogram", "کلوگرام"],
  ["TON", "طن", "Ton", "ٹن"],
  ["L", "لتر", "Litre", "لیٹر"],
  ["M", "متر", "Metre", "میٹر"],
  ["M2", "متر مربع", "Square metre", "مربع میٹر"],
  ["M3", "متر مكعب", "Cubic metre", "مکعب میٹر"],
  ["BOX", "كرتون", "Box", "ڈبہ"],
  ["BAG", "كيس", "Bag", "تھیلا"],
  ["SET", "مجموعة", "Set", "سیٹ"],
] as const;
async function ensureDefaultUnits(tx: Transaction) {
  // Do not reactivate or overwrite units edited by an administrator.
  await tx
    .insert(s.materialUnits)
    .values(
      defaultUnits.map(([code, nameAr, nameEn, nameUr]) => ({
        code,
        nameAr,
        nameEn,
        nameUr,
      }))
    )
    .onDuplicateKeyUpdate({ set: { code: sql`VALUES(code)` } });
}
async function source(
  db: Database | Transaction,
  projectId: number,
  taskId: number | null,
  access: AccessContext,
  lock = false
) {
  const query = db
    .select()
    .from(s.constructionProjects)
    .where(
      and(
        eq(s.constructionProjects.id, projectId),
        constructionScope(access, s.constructionProjects.id)
      )
    );
  const [project] = await (lock ? query.for("update") : query);
  if (!project) throw new DomainError("NOT_FOUND");
  if (taskId) {
    const taskQuery = db
      .select()
      .from(s.projectTasks)
      .where(
        and(
          eq(s.projectTasks.id, taskId),
          eq(s.projectTasks.projectId, projectId)
        )
      );
    const [task] = await (lock ? taskQuery.for("update") : taskQuery);
    if (!task) throw new DomainError("INVALID_REFERENCE");
    return { project, task, startDate: task.startDate };
  }
  const startDate = project.actualStartDate ?? project.plannedStartDate;
  if (!startDate)
    invalid(
      "حدد تاريخ بداية المشروع أولًا / Set the project start date first / منصوبے کی تاریخ آغاز پہلے مقرر کریں۔"
    );
  return { project, task: null, startDate };
}

type Item = typeof s.materialRequisitionItems.$inferSelect & {
  unit: typeof s.materialUnits.$inferSelect & { externalId?: string | null };
  catalogItemId: string | null;
  imageUrl: string | null;
};
type Snapshot = {
  schemaVersion: 1;
  project: { id: number; number: string; name: string };
  task: {
    id: number;
    name: string;
    level: number;
    parentId: number | null;
  } | null;
  sourceStartDate: string;
  creatorName: string | null;
  approverName: string | null;
  items: Item[];
};
function snapshot(value: string | null): Snapshot | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Snapshot;
  } catch {
    throw new DomainError("INVALID_INPUT");
  }
}
async function itemsFor(db: Database | Transaction, ids: number[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({
      item: s.materialRequisitionItems,
      unit: s.materialUnits,
      catalog: s.materialCatalogEntries,
    })
    .from(s.materialRequisitionItems)
    .innerJoin(
      s.materialUnits,
      eq(s.materialUnits.id, s.materialRequisitionItems.unitId)
    )
    .leftJoin(
      s.materialCatalogEntries,
      eq(s.materialCatalogEntries.id, s.materialRequisitionItems.catalogEntryId)
    )
    .where(inArray(s.materialRequisitionItems.requisitionId, ids))
    .orderBy(s.materialRequisitionItems.sequence);
  return rows.map(row => ({
    ...row.item,
    unit: row.catalog
      ? (JSON.parse(row.catalog.unitSnapshot) as Item["unit"])
      : row.unit,
    catalogItemId: row.catalog?.externalId ?? null,
    imageUrl: row.catalog?.imageStorageKey
      ? catalogImageUrl(row.catalog.id)
      : null,
  }));
}
function displayItems(
  items: Item[],
  status: string,
  start: string,
  approvedSnapshot: string | null
) {
  const official = status === "approved" ? snapshot(approvedSnapshot) : null;
  return (
    official?.items ??
    items.map(item => ({
      ...item,
      needDate:
        status === "draft" ? dateFromLead(start, item.leadDays) : item.needDate,
    }))
  ).map(item => ({
    ...item,
    catalogEntryId: item.catalogEntryId ?? null,
    catalogCode: item.catalogCode ?? "",
    catalogItemId: item.catalogItemId ?? null,
    imageUrl: item.imageUrl ?? null,
  }));
}
export async function directory(access: AccessContext) {
  const db = await database();
  await db.transaction(ensureDefaultUnits);
  const projects = await db
    .select({
      id: s.constructionProjects.id,
      number: s.constructionProjects.number,
      name: s.constructionProjects.name,
      plannedStartDate: s.constructionProjects.plannedStartDate,
      actualStartDate: s.constructionProjects.actualStartDate,
    })
    .from(s.constructionProjects)
    .where(constructionScope(access, s.constructionProjects.id))
    .orderBy(s.constructionProjects.name);
  const [tasks, units, creators] = await Promise.all([
    db
      .select({
        id: s.projectTasks.id,
        projectId: s.projectTasks.projectId,
        parentId: s.projectTasks.parentId,
        name: s.projectTasks.name,
        level: s.projectTasks.level,
        startDate: s.projectTasks.startDate,
      })
      .from(s.projectTasks)
      .innerJoin(
        s.constructionProjects,
        eq(s.constructionProjects.id, s.projectTasks.projectId)
      )
      .where(constructionScope(access, s.constructionProjects.id))
      .orderBy(s.projectTasks.projectId, s.projectTasks.id),
    db
      .select()
      .from(s.materialUnits)
      .where(eq(s.materialUnits.active, true))
      .orderBy(s.materialUnits.id),
    db
      .selectDistinct({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .innerJoin(
        s.materialRequisitions,
        eq(s.materialRequisitions.createdBy, users.id)
      )
      .where(constructionScope(access, s.materialRequisitions.projectId))
      .orderBy(users.name),
  ]);
  return { projects, tasks, units, creators };
}
export async function allUnits() {
  const db = await database();
  await db.transaction(ensureDefaultUnits);
  return db.select().from(s.materialUnits).orderBy(s.materialUnits.id);
}

export async function list(
  input: z.infer<typeof materialRequisitionListInput>,
  access: AccessContext
) {
  const db = await database();
  const taskStart = sql`COALESCE(${s.projectTasks.startDate},${s.constructionProjects.actualStartDate},${s.constructionProjects.plannedStartDate})`;
  const effectiveDate = sql<string>`CASE WHEN ${s.materialRequisitions.status}='draft' THEN DATE_FORMAT(DATE_SUB(${taskStart}, INTERVAL ${s.materialRequisitionItems.leadDays} DAY),'%Y-%m-%d') ELSE ${s.materialRequisitionItems.needDate} END`;
  const earliest = sql<string>`(SELECT MIN(${effectiveDate}) FROM ${s.materialRequisitionItems} WHERE ${s.materialRequisitionItems.requisitionId}=${s.materialRequisitions.id})`;
  const conditions: (SQL | undefined)[] = [
    constructionScope(access, s.constructionProjects.id),
    input.projectId
      ? eq(s.materialRequisitions.projectId, input.projectId)
      : undefined,
    input.taskId ? eq(s.materialRequisitions.taskId, input.taskId) : undefined,
    input.createdBy
      ? eq(s.materialRequisitions.createdBy, input.createdBy)
      : undefined,
    input.status ? eq(s.materialRequisitions.status, input.status) : undefined,
    input.linkType === "project"
      ? isNull(s.materialRequisitions.taskId)
      : input.linkType === "main_task"
        ? eq(s.projectTasks.level, 1)
        : input.linkType === "subtask"
          ? sql`${s.projectTasks.level}>1`
          : undefined,
    input.createdFrom
      ? gte(
          s.materialRequisitions.createdAt,
          new Date(`${input.createdFrom}T00:00:00+03:00`)
        )
      : undefined,
    input.createdTo
      ? lte(
          s.materialRequisitions.createdAt,
          new Date(`${input.createdTo}T23:59:59+03:00`)
        )
      : undefined,
    input.approvedFrom
      ? gte(
          s.materialRequisitions.approvedAt,
          new Date(`${input.approvedFrom}T00:00:00+03:00`)
        )
      : undefined,
    input.approvedTo
      ? lte(
          s.materialRequisitions.approvedAt,
          new Date(`${input.approvedTo}T23:59:59+03:00`)
        )
      : undefined,
    input.needFrom ? sql`${earliest} >= ${input.needFrom}` : undefined,
    input.needTo ? sql`${earliest} <= ${input.needTo}` : undefined,
    input.q
      ? or(
          like(s.materialRequisitions.number, `%${input.q}%`),
          like(s.constructionProjects.name, `%${input.q}%`),
          like(s.constructionProjects.number, `%${input.q}%`),
          like(s.projectTasks.name, `%${input.q}%`),
          sql`EXISTS (SELECT 1 FROM ${s.materialRequisitionItems} WHERE ${s.materialRequisitionItems.requisitionId}=${s.materialRequisitions.id} AND (${s.materialRequisitionItems.itemName} LIKE ${`%${input.q}%`} OR ${s.materialRequisitionItems.catalogCode} LIKE ${`%${input.q}%`}))`
        )
      : undefined,
  ];
  const ordering =
    input.sort === "created_asc"
      ? [asc(s.materialRequisitions.createdAt)]
      : input.sort === "project"
        ? [
            asc(s.constructionProjects.name),
            asc(s.projectTasks.level),
            asc(s.projectTasks.id),
          ]
        : input.sort === "need_date"
          ? [asc(earliest)]
          : input.sort === "number"
            ? [asc(s.materialRequisitions.number)]
            : input.sort === "status"
              ? [asc(s.materialRequisitions.status)]
              : input.sort === "task_level"
                ? [asc(s.projectTasks.level)]
                : [desc(s.materialRequisitions.createdAt)];
  const filter = and(...conditions);
  const approver = alias(users, "mr_approver");
  const [rows, totals] = await Promise.all([
    db
      .select({
        requisition: s.materialRequisitions,
        projectNumber: s.constructionProjects.number,
        projectName: s.constructionProjects.name,
        taskName: s.projectTasks.name,
        taskLevel: s.projectTasks.level,
        taskParentId: s.projectTasks.parentId,
        sourceStart: sql<string>`${taskStart}`,
        creatorName: users.name,
        approverName: approver.name,
      })
      .from(s.materialRequisitions)
      .innerJoin(
        s.constructionProjects,
        eq(s.constructionProjects.id, s.materialRequisitions.projectId)
      )
      .leftJoin(
        s.projectTasks,
        eq(s.projectTasks.id, s.materialRequisitions.taskId)
      )
      .leftJoin(users, eq(users.id, s.materialRequisitions.createdBy))
      .leftJoin(approver, eq(approver.id, s.materialRequisitions.approvedBy))
      .where(filter)
      .orderBy(...ordering, desc(s.materialRequisitions.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(s.materialRequisitions)
      .innerJoin(
        s.constructionProjects,
        eq(s.constructionProjects.id, s.materialRequisitions.projectId)
      )
      .leftJoin(
        s.projectTasks,
        eq(s.projectTasks.id, s.materialRequisitions.taskId)
      )
      .where(filter),
  ]);
  const items = await itemsFor(
    db,
    rows.map(row => row.requisition.id)
  );
  const taskRows = rows.length
    ? await db
        .select({
          id: s.projectTasks.id,
          name: s.projectTasks.name,
          parentId: s.projectTasks.parentId,
        })
        .from(s.projectTasks)
        .where(
          inArray(s.projectTasks.projectId, [
            ...new Set(rows.map(row => row.requisition.projectId)),
          ])
        )
    : [];
  const taskMap = new Map(taskRows.map(task => [task.id, task]));
  return {
    rows: rows.map(row => {
      const official =
        row.requisition.status === "approved"
          ? snapshot(row.requisition.approvedSnapshot)
          : null;
      const own = displayItems(
        items.filter(item => item.requisitionId === row.requisition.id),
        row.requisition.status,
        row.sourceStart,
        row.requisition.approvedSnapshot
      );
      const taskPath: string[] = [];
      let task = row.requisition.taskId
        ? taskMap.get(row.requisition.taskId)
        : undefined;
      while (task && taskPath.length < 5) {
        taskPath.unshift(task.name);
        task = task.parentId ? taskMap.get(task.parentId) : undefined;
      }
      return {
        ...row.requisition,
        approvedSnapshot: undefined,
        projectNumber: official?.project.number ?? row.projectNumber,
        projectName: official?.project.name ?? row.projectName,
        taskName: official?.task?.name ?? row.taskName,
        taskLevel: official?.task?.level ?? row.taskLevel,
        taskParentId: row.taskParentId,
        taskPath,
        creatorName: official?.creatorName ?? row.creatorName,
        approverName: official?.approverName ?? row.approverName,
        itemCount: own.length,
        earliestNeedDate: own.map(item => item.needDate).sort()[0] ?? null,
        items: own,
      };
    }),
    total: Number(totals[0].count),
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function detail(id: number, access: AccessContext) {
  const db = await database();
  const [row] = await db
    .select()
    .from(s.materialRequisitions)
    .where(eq(s.materialRequisitions.id, id));
  if (!row) throw new DomainError("NOT_FOUND");
  const linked = await source(db, row.projectId, row.taskId, access);
  const items = await itemsFor(db, [id]);
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [row.createdBy, row.approvedBy ?? row.createdBy]));
  const official =
    row.status === "approved" ? snapshot(row.approvedSnapshot) : null;
  const history = await db
    .select({
      id: scmAuditEvents.id,
      action: scmAuditEvents.action,
      createdAt: scmAuditEvents.createdAt,
      actorName: users.name,
    })
    .from(scmAuditEvents)
    .leftJoin(users, eq(users.id, scmAuditEvents.actorId))
    .where(
      and(
        eq(scmAuditEvents.entityType, "pm_material_requisition"),
        eq(scmAuditEvents.entityId, id)
      )
    )
    .orderBy(desc(scmAuditEvents.id));
  return {
    ...row,
    approvedSnapshot: undefined,
    project: { ...linked.project, ...official?.project },
    task: linked.task ? { ...linked.task, ...official?.task } : null,
    creatorName:
      official?.creatorName ??
      people.find(p => p.id === row.createdBy)?.name ??
      null,
    approverName:
      official?.approverName ??
      people.find(p => p.id === row.approvedBy)?.name ??
      null,
    items: displayItems(
      items,
      row.status,
      linked.startDate,
      row.approvedSnapshot
    ),
    history,
  };
}

export async function save(
  input: z.infer<typeof materialRequisitionSaveInput>,
  access: AccessContext
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      access.user.id,
      "materialRequisition.save",
      input.key,
      input,
      async () => {
        const linked = await source(
          tx,
          input.projectId,
          input.taskId,
          access,
          true
        );
        if (
          input.expectedSourceStartDate &&
          input.expectedSourceStartDate !== linked.startDate
        )
          invalid(
            "تغير تاريخ البداية أثناء تحرير الطلب. أعد فتح المسودة / Start date changed while editing; reopen the draft / ترمیم کے دوران تاریخ آغاز بدل گئی؛ مسودہ دوبارہ کھولیں۔"
          );
        await ensureDefaultUnits(tx);
        let id = input.id;
        let before: typeof s.materialRequisitions.$inferSelect | undefined;
        if (id) {
          [before] = await tx
            .select()
            .from(s.materialRequisitions)
            .where(eq(s.materialRequisitions.id, id))
            .for("update");
          if (!before) throw new DomainError("NOT_FOUND");
          await assertConstructionAccess(access, before.projectId, tx);
          if (before.status !== "draft") invalid(lockedMessage);
          if (before.version !== input.version)
            throw new DomainError("CONFLICT");
          if (
            before.projectId !== input.projectId ||
            before.taskId !== input.taskId
          )
            invalid(
              "لا يمكن تغيير مصدر الطلب بعد إنشائه / The request source cannot be changed / درخواست کا اصل ربط تبدیل نہیں ہو سکتا۔"
            );
        }
        const catalogIds = [
          ...new Set(
            input.items.flatMap(item =>
              item.catalogEntryId ? [item.catalogEntryId] : []
            )
          ),
        ];
        const imported = catalogIds.length
          ? await tx
              .select()
              .from(s.materialCatalogEntries)
              .where(inArray(s.materialCatalogEntries.id, catalogIds))
              .for("update")
          : [];
        const oldLinks = before
          ? await tx
              .select({ id: s.materialRequisitionItems.catalogEntryId })
              .from(s.materialRequisitionItems)
              .where(eq(s.materialRequisitionItems.requisitionId, before.id))
          : [];
        if (
          catalogIds.length !== imported.length ||
          imported.some(
            entry =>
              entry.createdBy !== access.user.id &&
              !oldLinks.some(link => link.id === entry.id)
          )
        )
          throw new DomainError("INVALID_REFERENCE");
        const resolvedItems = input.items.map(item => {
          const entry = imported.find(
            entry => entry.id === item.catalogEntryId
          );
          return {
            ...item,
            catalogCode: entry?.catalogCode ?? "",
            itemName: entry?.itemName ?? item.itemName,
            unitId: entry?.unitId ?? item.unitId,
          };
        });
        const unitIds = [...new Set(resolvedItems.map(item => item.unitId))];
        const units = await tx
          .select()
          .from(s.materialUnits)
          .where(inArray(s.materialUnits.id, unitIds))
          .for("update");
        if (units.length !== unitIds.length || units.some(unit => !unit.active))
          throw new DomainError("INVALID_REFERENCE");
        const values = resolvedItems.map((item, index) => {
          const lead = leadDays(linked.startDate, item.needDate);
          if (lead < 3)
            invalid(
              `يجب أن يسبق احتياج «${item.itemName}» البداية بثلاثة أيام على الأقل / Need date must precede start by at least 3 days / ضرورت کی تاریخ آغاز سے کم از کم 3 دن پہلے ہونی چاہیے۔`
            );
          return { sequence: index + 1, ...item, leadDays: lead };
        });
        if (before) {
          await tx
            .update(s.materialRequisitions)
            .set({ version: before.version + 1, updatedAt: new Date() })
            .where(eq(s.materialRequisitions.id, id!));
          await tx
            .delete(s.materialRequisitionItems)
            .where(eq(s.materialRequisitionItems.requisitionId, id!));
        } else {
          const number = await allocateRecordNumber(tx, "materialRequisition");
          const [result] = await tx.insert(s.materialRequisitions).values({
            number,
            projectId: input.projectId,
            taskId: input.taskId,
            createdBy: access.user.id,
          });
          id = Number(result.insertId);
        }
        await tx
          .insert(s.materialRequisitionItems)
          .values(values.map(value => ({ ...value, requisitionId: id! })));
        await recordChange(tx, {
          actorId: access.user.id,
          action: before
            ? "materialRequisition.edited"
            : "materialRequisition.created",
          entityType: "pm_material_requisition",
          entityId: id!,
          before,
          after: {
            projectId: input.projectId,
            taskId: input.taskId,
            items: values,
          },
        });
        return { id: id! };
      }
    )
  );
}

export async function approve(
  input: z.infer<typeof materialRequisitionApproveInput>,
  access: AccessContext
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      access.user.id,
      "materialRequisition.approve",
      input.key,
      input,
      async () => {
        const [candidate] = await tx
          .select()
          .from(s.materialRequisitions)
          .where(eq(s.materialRequisitions.id, input.id));
        if (!candidate) throw new DomainError("NOT_FOUND");
        const linked = await source(
          tx,
          candidate.projectId,
          candidate.taskId,
          access,
          true
        );
        const [row] = await tx
          .select()
          .from(s.materialRequisitions)
          .where(eq(s.materialRequisitions.id, input.id))
          .for("update");
        if (!row || row.status !== "draft") invalid(lockedMessage);
        if (row.version !== input.version) throw new DomainError("CONFLICT");
        const items = await itemsFor(tx, [row.id]);
        if (!items.length || items.length > 20)
          throw new DomainError("INVALID_INPUT");
        const officialItems = items.map(item => ({
          ...item,
          needDate: dateFromLead(linked.startDate, item.leadDays),
        }));
        for (const item of officialItems) {
          if (item.leadDays < 3) throw new DomainError("INVALID_INPUT");
          if (!item.unit.active)
            invalid(
              "إحدى الوحدات غير نشطة. حدّث المسودة أولًا / A unit is inactive; update the draft first / ایک اکائی غیر فعال ہے؛ پہلے مسودہ تبدیل کریں۔"
            );
          await tx
            .update(s.materialRequisitionItems)
            .set({ needDate: item.needDate })
            .where(eq(s.materialRequisitionItems.id, item.id));
        }
        const [creator] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, row.createdBy));
        const approvedSnapshot: Snapshot = {
          schemaVersion: 1,
          project: {
            id: linked.project.id,
            number: linked.project.number,
            name: linked.project.name,
          },
          task: linked.task
            ? {
                id: linked.task.id,
                name: linked.task.name,
                level: linked.task.level,
                parentId: linked.task.parentId,
              }
            : null,
          sourceStartDate: linked.startDate,
          creatorName: creator?.name ?? null,
          approverName: access.user.name,
          items: officialItems,
        };
        const after = {
          status: "approved",
          externalStatus: "pending_send",
          approvedBy: access.user.id,
          approvedAt: new Date(),
          approvedSnapshot: JSON.stringify(approvedSnapshot),
          version: row.version + 1,
          updatedAt: new Date(),
        };
        await tx
          .update(s.materialRequisitions)
          .set(after)
          .where(eq(s.materialRequisitions.id, row.id));
        await recordChange(tx, {
          actorId: access.user.id,
          action: "materialRequisition.approved",
          entityType: "pm_material_requisition",
          entityId: row.id,
          before: row,
          after,
        });
        return { id: row.id };
      }
    )
  );
}

export async function saveUnit(
  input: z.infer<typeof materialUnitSaveInput>,
  access: AccessContext
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      access.user.id,
      "materialUnit.save",
      input.key,
      input,
      async () => {
        const [duplicate] = await tx
          .select()
          .from(s.materialUnits)
          .where(eq(s.materialUnits.code, input.code));
        if (duplicate && duplicate.id !== input.id)
          invalid(
            "رمز الوحدة مستخدم / Unit code is already used / اکائی کا کوڈ پہلے سے موجود ہے۔"
          );
        let id = input.id;
        const values = {
          code: input.code,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          nameUr: input.nameUr,
          active: input.active,
        };
        if (id) {
          const [row] = await tx
            .select()
            .from(s.materialUnits)
            .where(eq(s.materialUnits.id, id))
            .for("update");
          if (!row || row.version !== input.version)
            throw new DomainError("CONFLICT");
          await tx
            .update(s.materialUnits)
            .set({ ...values, version: row.version + 1 })
            .where(eq(s.materialUnits.id, id));
        } else {
          const [result] = await tx.insert(s.materialUnits).values(values);
          id = Number(result.insertId);
        }
        await recordChange(tx, {
          actorId: access.user.id,
          action: "materialUnit.saved",
          entityType: "pm_material_unit",
          entityId: id!,
          after: values,
        });
        return { id: id! };
      }
    )
  );
}

export async function exportApproved(id: number, access: AccessContext) {
  const db = await database();
  const [row] = await db
    .select()
    .from(s.materialRequisitions)
    .where(eq(s.materialRequisitions.id, id));
  if (!row) throw new DomainError("NOT_FOUND");
  await assertConstructionAccess(access, row.projectId);
  if (row.status !== "approved" || !row.approvedSnapshot)
    invalid(
      "يمكن إرسال الطلبات المعتمدة فقط / Only approved requests can be exported / صرف منظور شدہ درخواستیں بھیجی جا سکتی ہیں۔"
    );
  return {
    ...snapshot(row.approvedSnapshot)!,
    requisitionNumber: row.number,
    idempotencyKey: row.number,
    approvedAt: row.approvedAt,
  };
}

export async function updateExternal(
  input: z.infer<typeof externalPurchaseRequestUpdateInput>,
  access: AccessContext
) {
  return (await database()).transaction(tx =>
    once(
      tx,
      access.user.id,
      "materialRequisition.external",
      input.key,
      input,
      async () => {
        const [row] = await tx
          .select()
          .from(s.materialRequisitions)
          .where(eq(s.materialRequisitions.number, input.requisitionNumber))
          .for("update");
        if (!row || row.status !== "approved")
          throw new DomainError("NOT_FOUND");
        await assertConstructionAccess(access, row.projectId, tx);
        if (
          row.externalPurchaseRequestNumber &&
          input.purchaseRequestNumber &&
          row.externalPurchaseRequestNumber !== input.purchaseRequestNumber
        )
          invalid(
            "رقم طلب الشراء الخارجي لا يطابق الرقم المسجل / External purchase request number mismatch / بیرونی خریداری درخواست نمبر مختلف ہے۔"
          );
        if (
          row.externalPurchaseRequestNumber &&
          input.status !== "purchase_request_created"
        )
          invalid(
            "لا يمكن إعادة حالة الطلب بعد إنشاء طلب الشراء / Purchase request creation is final / خریداری درخواست بننے کے بعد حالت واپس نہیں ہو سکتی۔"
          );
        const after = {
          externalStatus: input.status,
          externalPurchaseRequestNumber:
            input.purchaseRequestNumber ?? row.externalPurchaseRequestNumber,
          externalReferenceUrl: input.referenceUrl ?? row.externalReferenceUrl,
          externalMessage: input.message,
          externalUpdatedAt: new Date(),
          version: row.version + 1,
          updatedAt: new Date(),
        };
        await tx
          .update(s.materialRequisitions)
          .set(after)
          .where(eq(s.materialRequisitions.id, row.id));
        await recordChange(tx, {
          actorId: access.user.id,
          action: "materialRequisition.external.updated",
          entityType: "pm_material_requisition",
          entityId: row.id,
          before: row,
          after,
        });
        return { id: row.id };
      }
    )
  );
}
