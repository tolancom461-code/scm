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
  isWholeRequisitionQuantity,
  leadDays,
  materialRequisitionApproveInput,
  materialRequisitionListInput,
  materialRequisitionSaveInput,
  materialUnitSaveInput,
  externalPurchaseRequestUpdateInput,
  projectHasCmmsLocation,
} from "../../../shared/material-requisitions";
import { dateInput } from "../../../shared/validation";
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
import {
  cmmsReferencesConfigured,
  readCmmsPurchaseOptions,
} from "../cmms-integration/references";
import {
  cmmsPurchaseSettings,
  readCmmsFulfillment,
  readCmmsMaterialCosts,
  type CmmsPurchaseSettings,
} from "../cmms-integration/purchase-client";
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
  return { project, task: null, startDate: project.plannedStartDate };
}

function requirePlannedStart(startDate: string | null) {
  if (!startDate)
    invalid(
      "حدد تاريخ البداية المخططة للمشروع أولًا / Set the planned project start date first / منصوبے کے آغاز کی طے شدہ تاریخ پہلے مقرر کریں۔"
    );
  return startDate;
}

type Item = typeof s.materialRequisitionItems.$inferSelect & {
  unit: typeof s.materialUnits.$inferSelect & { externalId?: string | null };
  catalogItemId: string | null;
  imageUrl: string | null;
};
type CmmsProjectLocation = Pick<
  typeof s.constructionProjects.$inferSelect,
  | "cmmsSiteId"
  | "cmmsSiteName"
  | "cmmsSectionId"
  | "cmmsSectionName"
  | "cmmsAssetId"
  | "cmmsAssetName"
>;
const projectLocationColumns = {
  cmmsSiteId: s.constructionProjects.cmmsSiteId,
  cmmsSiteName: s.constructionProjects.cmmsSiteName,
  cmmsSectionId: s.constructionProjects.cmmsSectionId,
  cmmsSectionName: s.constructionProjects.cmmsSectionName,
  cmmsAssetId: s.constructionProjects.cmmsAssetId,
  cmmsAssetName: s.constructionProjects.cmmsAssetName,
};
function cmmsProjectLocation(project: Partial<CmmsProjectLocation>) {
  return {
    cmmsSiteId: project.cmmsSiteId ?? null,
    cmmsSiteName: project.cmmsSiteName ?? null,
    cmmsSectionId: project.cmmsSectionId ?? null,
    cmmsSectionName: project.cmmsSectionName ?? null,
    cmmsAssetId: project.cmmsAssetId ?? null,
    cmmsAssetName: project.cmmsAssetName ?? null,
  };
}
type CmmsPurchaseOptions = Awaited<ReturnType<typeof readCmmsPurchaseOptions>>;
type PurchaseReferences = {
  itemName: string;
  cmmsCategoryId?: number | null;
  cmmsReviewRole?: string | null;
};

function cmmsPurchaseReferences(
  item: PurchaseReferences,
  options: CmmsPurchaseOptions | null
) {
  const category = options?.categories.find(
    option => option.id === item.cmmsCategoryId
  );
  const reviewer = options?.reviewRoles.find(
    option => option.code === item.cmmsReviewRole
  );
  if (!category || !reviewer)
    invalid(
      "تحقق من تصنيف وجهة مراجعة الصنف «" +
        item.itemName +
        "» في CMMS / Check the CMMS category and review department for “" +
        item.itemName +
        "” / اس صنف کا CMMS زمرہ اور جائزہ شعبہ چیک کریں۔"
    );
  return {
    cmmsCategoryId: category.id,
    cmmsCategoryName: category.name,
    cmmsReviewRole: reviewer.code,
    cmmsReviewRoleName: reviewer.name,
  };
}

// Fetch once per request before taking database locks. Keep transport failures
// available to the mutation without preventing replays of committed operations.
async function cmmsOptions(
  needed: boolean,
  locale: z.infer<typeof materialRequisitionSaveInput>["locale"]
) {
  if (!needed) return { options: null, failure: null };
  try {
    return { options: await readCmmsPurchaseOptions(locale), failure: null };
  } catch (error) {
    return { options: null, failure: error };
  }
}

type Snapshot = {
  schemaVersion: 1;
  project: {
    id: number;
    number: string;
    name: string;
  } & Partial<CmmsProjectLocation>;
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
  start: string | null,
  approvedSnapshot: string | null
) {
  const official = status === "approved" ? snapshot(approvedSnapshot) : null;
  return (
    official?.items ??
    items.map(item => ({
      ...item,
      needDate:
        status === "draft" && start
          ? dateFromLead(start, item.leadDays)
          : item.needDate,
    }))
  ).map(item => ({
    ...item,
    catalogEntryId: item.catalogEntryId ?? null,
    catalogCode: item.catalogCode ?? "",
    catalogItemId: item.catalogItemId ?? null,
    imageUrl: item.imageUrl ?? null,
    cmmsCategoryId: item.cmmsCategoryId ?? null,
    cmmsCategoryName: item.cmmsCategoryName ?? null,
    cmmsReviewRole: item.cmmsReviewRole ?? null,
    cmmsReviewRoleName: item.cmmsReviewRoleName ?? null,
  }));
}

const purchaseDispatchColumns = {
  id: s.materialRequisitions.id,
  purchaseNumber: s.materialRequisitions.externalPurchaseRequestNumber,
  externalStatus: s.materialRequisitions.externalStatus,
  instanceId: s.materialRequisitions.cmmsDispatchSourceId,
};

type PurchaseDispatch = {
  id: number;
  purchaseNumber: string | null;
  externalStatus: string | null;
  instanceId: string | null;
};

async function readRequisitionPurchases<Result>(
  requisitions: Pick<PurchaseDispatch, "id" | "instanceId">[],
  read: (
    settings: CmmsPurchaseSettings,
    instanceId: string,
    ids: number[]
  ) => Promise<Result[]>
) {
  const rows: Result[] = [];
  const settings = cmmsPurchaseSettings();
  if (!settings) return rows;

  const dispatches = new Map<string, number[]>();
  for (const row of requisitions) {
    const instanceId = row.instanceId ?? settings.instanceId;
    const ids = dispatches.get(instanceId) ?? [];
    ids.push(row.id);
    dispatches.set(instanceId, ids);
  }

  const maxIdsPerRequest = 100;
  const concurrency = 4;
  const batches: { instanceId: string; ids: number[] }[] = [];
  for (const [instanceId, ids] of dispatches) {
    for (let index = 0; index < ids.length; index += maxIdsPerRequest) {
      batches.push({
        instanceId,
        ids: ids.slice(index, index + maxIdsPerRequest),
      });
    }
  }
  for (let index = 0; index < batches.length; index += concurrency) {
    const results = await Promise.allSettled(
      batches
        .slice(index, index + concurrency)
        .map(({ instanceId, ids }) => read(settings, instanceId, ids))
    );
    for (const result of results) {
      // Keep requisitions visible when a CMMS request fails.
      if (result.status === "fulfilled") rows.push(...result.value);
    }
  }
  return rows;
}

async function readRequisitionFulfillment(requisitions: PurchaseDispatch[]) {
  const rows = await readRequisitionPurchases(
    requisitions.filter(
      row => row.purchaseNumber && row.externalStatus === "purchase_request_created"
    ),
    readCmmsFulfillment
  );
  return new Map(
    rows.map(item => [`${item.requisitionId}:${item.sequence}`, item])
  );
}

export async function taskMaterialSummary(
  projectId: number,
  taskId: number | undefined,
  access: AccessContext
) {
  const db = await database();
  await source(db, projectId, taskId ?? null, access);
  const requisitions = await db
    .select({ ...purchaseDispatchColumns, taskId: s.projectTasks.id })
    .from(s.materialRequisitions)
    .innerJoin(
      s.projectTasks,
      and(
        eq(s.materialRequisitions.taskId, s.projectTasks.id),
        eq(s.projectTasks.projectId, projectId)
      )
    )
    .where(
      and(
        eq(s.materialRequisitions.projectId, projectId),
        eq(s.materialRequisitions.status, "approved"),
        taskId === undefined
          ? undefined
          : eq(s.materialRequisitions.taskId, taskId)
      )
    );

  type Summary = {
    taskId: number;
    requisitionCount: number;
    readyItemCount: number;
  };
  const summaries = new Map<number, Summary>();
  const summariesByRequisition = new Map<number, Summary>();
  for (const row of requisitions) {
    const summary = summaries.get(row.taskId) ?? {
      taskId: row.taskId,
      requisitionCount: 0,
      readyItemCount: 0,
    };
    summary.requisitionCount += 1;
    summaries.set(row.taskId, summary);
    summariesByRequisition.set(row.id, summary);
  }

  const progress = await readRequisitionFulfillment(requisitions);
  for (const item of progress.values()) {
    const summary = summariesByRequisition.get(item.requisitionId);
    if (summary && item.readyQuantity > 0) summary.readyItemCount += 1;
  }
  return { items: [...summaries.values()] };
}

type MaterialCostTotals = {
  issuedCents: number;
  returnedCents: number;
  netCents: number;
};
type MaterialDeliveryCost = MaterialCostTotals & {
  number: string;
  sequence: number | null;
};
const zeroMaterialCosts: MaterialCostTotals = {
  issuedCents: 0,
  returnedCents: 0,
  netCents: 0,
};

function addMaterialCosts(
  current: MaterialCostTotals | null,
  added: MaterialCostTotals | null
): MaterialCostTotals | null {
  if (!current || !added) return null;
  const issuedCents = current.issuedCents + added.issuedCents;
  const returnedCents = current.returnedCents + added.returnedCents;
  if (!Number.isSafeInteger(issuedCents) || !Number.isSafeInteger(returnedCents))
    return null;
  return { issuedCents, returnedCents, netCents: issuedCents - returnedCents };
}

export async function taskMaterialCosts(
  projectId: number,
  taskId: number | undefined,
  access: AccessContext
) {
  const db = await database();
  await source(db, projectId, taskId ?? null, access);
  const requisitions = await db
    .select({
      ...purchaseDispatchColumns,
      taskId: s.materialRequisitions.taskId,
      taskName: s.projectTasks.name,
      nextDispatchAt: s.materialRequisitions.cmmsDispatchNextAt,
      dispatchAttempts: s.materialRequisitions.cmmsDispatchAttempts,
    })
    .from(s.materialRequisitions)
    .leftJoin(
      s.projectTasks,
      and(
        eq(s.materialRequisitions.taskId, s.projectTasks.id),
        eq(s.projectTasks.projectId, projectId)
      )
    )
    .where(
      and(
        eq(s.materialRequisitions.projectId, projectId),
        eq(s.materialRequisitions.status, "approved"),
        taskId === undefined
          ? undefined
          : eq(s.materialRequisitions.taskId, taskId)
      )
    )
    .orderBy(asc(s.materialRequisitions.taskId), asc(s.materialRequisitions.id));

  const remote = await readRequisitionPurchases(
    requisitions.filter(
      row =>
        (row.taskId === null || row.taskName !== null) &&
        (row.purchaseNumber || row.instanceId)
    ),
    readCmmsMaterialCosts
  );
  const byRequisition = new Map(remote.map(row => [row.requisitionId, row]));
  const seenNumbers = new Set<string>();
  const ambiguousNumbers = new Set<string>();
  for (const row of remote) {
    for (const delivery of row.deliveries) {
      if (seenNumbers.has(delivery.number)) ambiguousNumbers.add(delivery.number);
      seenNumbers.add(delivery.number);
    }
  }

  let totals: MaterialCostTotals | null = zeroMaterialCosts;
  let direct: MaterialCostTotals | null = zeroMaterialCosts;
  const tasks = new Map<
    number,
    { taskId: number; taskName: string; totals: MaterialCostTotals | null }
  >();
  const details: {
    requisitionId: number;
    totals: MaterialCostTotals | null;
    deliveries: MaterialDeliveryCost[];
  }[] = [];

  for (const row of requisitions) {
    const reported = byRequisition.get(row.id);
    const deliveries = (reported?.deliveries ?? [])
      .filter(
        delivery =>
          !ambiguousNumbers.has(delivery.number) &&
          (row.taskId === null) === (delivery.sequence === null)
      )
      .map(delivery => ({
        ...delivery,
        netCents: delivery.issuedCents - delivery.returnedCents,
      }));
    // Scheduled or attempted sends may have created a purchase before an acknowledgement arrived.
    const localOnly =
      !row.purchaseNumber &&
      !row.instanceId &&
      row.dispatchAttempts === 0 &&
      row.nextDispatchAt === null &&
      (row.externalStatus === null || row.externalStatus === "pending_send");
    const known = row.taskId === null || row.taskName !== null;
    const complete =
      known &&
      (reported
        ? reported.complete && reported.deliveries.length === deliveries.length
        : localOnly);
    const cost = complete
      ? deliveries.reduce<MaterialCostTotals | null>(
          addMaterialCosts,
          zeroMaterialCosts
        )
      : null;

    totals = addMaterialCosts(totals, cost);
    if (taskId !== undefined) {
      details.push({ requisitionId: row.id, totals: cost, deliveries });
    } else if (row.taskId === null) {
      direct = addMaterialCosts(direct, cost);
    } else if (row.taskName !== null) {
      const task = tasks.get(row.taskId) ?? {
        taskId: row.taskId,
        taskName: row.taskName,
        totals: zeroMaterialCosts,
      };
      task.totals = addMaterialCosts(task.totals, cost);
      tasks.set(row.taskId, task);
    }
  }

  return {
    totals,
    direct: taskId === undefined ? direct : null,
    tasks: [...tasks.values()],
    requisitions: details,
  };
}

export async function taskMaterialProgress(
  projectId: number,
  taskId: number,
  beforeId: number | undefined,
  access: AccessContext
) {
  const db = await database();
  await source(db, projectId, taskId, access);

  const pageSize = 10;
  const requisitions = await db
    .select({
      ...purchaseDispatchColumns,
      number: s.materialRequisitions.number,
      approvedSnapshot: s.materialRequisitions.approvedSnapshot,
    })
    .from(s.materialRequisitions)
    .where(and(
      eq(s.materialRequisitions.projectId, projectId),
      eq(s.materialRequisitions.taskId, taskId),
      eq(s.materialRequisitions.status, "approved"),
      beforeId === undefined ? undefined : lte(s.materialRequisitions.id, beforeId)
    ))
    .orderBy(desc(s.materialRequisitions.id))
    .limit(pageSize + 1);

  const page = requisitions.slice(0, pageSize);
  const [savedItems, progress] = await Promise.all([
    itemsFor(
      db,
      page.filter(row => !row.approvedSnapshot).map(row => row.id)
    ),
    readRequisitionFulfillment(page),
  ]);

  return {
    requisitions: page.map(row => ({
      id: row.id,
      number: row.number,
      purchaseNumber: row.purchaseNumber,
      externalStatus: row.externalStatus,
      items: (snapshot(row.approvedSnapshot)?.items ?? savedItems.filter(item => item.requisitionId === row.id))
        .map(item => ({
          sequence: item.sequence,
          name: item.itemName,
          requestedQuantity: Number(item.quantity),
          unit: {
            ar: item.unit.nameAr,
            en: item.unit.nameEn,
            ur: item.unit.nameUr,
          },
          progress: progress.get(`${row.id}:${item.sequence}`) ?? null,
        })),
    })),
    nextBeforeId: requisitions[pageSize]?.id ?? null,
  };
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
      ...projectLocationColumns,
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
  const sourceStart = sql<string | null>`COALESCE(${s.projectTasks.startDate},${s.constructionProjects.plannedStartDate})`;
  const effectiveDate = sql<string>`
    CASE WHEN ${s.materialRequisitions.status} = 'draft' AND ${sourceStart} IS NOT NULL
      THEN DATE_FORMAT(DATE_SUB(${sourceStart}, INTERVAL ${s.materialRequisitionItems.leadDays} DAY), '%Y-%m-%d')
      ELSE ${s.materialRequisitionItems.needDate}
    END`;
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
        ...projectLocationColumns,
        taskName: s.projectTasks.name,
        taskLevel: s.projectTasks.level,
        taskParentId: s.projectTasks.parentId,
        sourceStart,
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
        cmmsDispatchSourceId: undefined,
        cmmsDispatchLeaseId: undefined,
        cmmsDispatchAttempts: undefined,
        projectNumber: official?.project.number ?? row.projectNumber,
        projectName: official?.project.name ?? row.projectName,
        ...cmmsProjectLocation(official?.project ?? row),
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
    cmmsDispatchEnabled: cmmsPurchaseSettings() !== null,
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
    cmmsDispatchSourceId: undefined,
    cmmsDispatchLeaseId: undefined,
    cmmsDispatchAttempts: undefined,
    cmmsDispatchEnabled: cmmsPurchaseSettings() !== null,
    project: {
      ...linked.project,
      ...official?.project,
      ...cmmsProjectLocation(official?.project ?? linked.project),
    },
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
  const missingPurchaseFields = input.items.find(
    item => item.cmmsCategoryId == null || item.cmmsReviewRole == null
  );
  const invalidQuantity = input.items.some(
    item => !isWholeRequisitionQuantity(item.quantity)
  );
  const { options, failure } = await cmmsOptions(
    !missingPurchaseFields && !invalidQuantity,
    input.locale
  );
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
        const startDate = requirePlannedStart(linked.startDate);
        if (
          input.expectedSourceStartDate &&
          input.expectedSourceStartDate !== startDate
        )
          invalid(
            "تغير تاريخ البداية أثناء تحرير الطلب. أعد فتح المسودة / Start date changed while editing; reopen the draft / ترمیم کے دوران تاریخ آغاز بدل گئی؛ مسودہ دوبارہ کھولیں۔"
          );
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
        if (!projectHasCmmsLocation(linked.project))
          invalid(
            "حدد موقع المشروع وقسمه من CMMS قبل حفظ طلب الاحتياج / Select the project’s CMMS site and section before saving the requisition / ضرورت کی درخواست محفوظ کرنے سے پہلے منصوبے کا CMMS مقام اور شعبہ منتخب کریں۔"
          );
        if (invalidQuantity)
          throw new DomainError("CMMS_WHOLE_QUANTITY_REQUIRED");
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
              .select({
                catalogEntryId: s.materialRequisitionItems.catalogEntryId,
                itemName: s.materialRequisitionItems.itemName,
                unitId: s.materialRequisitionItems.unitId,
              })
              .from(s.materialRequisitionItems)
              .where(eq(s.materialRequisitionItems.requisitionId, before.id))
          : [];
        if (
          catalogIds.length !== imported.length ||
          imported.some(
            entry =>
              entry.createdBy !== access.user.id &&
              !oldLinks.some(link => link.catalogEntryId === entry.id)
          )
        )
          throw new DomainError("INVALID_REFERENCE");
        const legacyItems = oldLinks.filter(
          link => link.catalogEntryId === null
        );
        for (const item of input.items) {
          if (item.catalogEntryId !== null) continue;
          const existing = legacyItems.findIndex(
            link =>
              link.itemName === item.itemName && link.unitId === item.unitId
          );
          if (existing === -1)
            invalid(
              "أضف الأصناف الجديدة من الكتالوج / Add new items from the catalog / نئی اشیاء کیٹلاگ سے شامل کریں۔"
            );
          legacyItems.splice(existing, 1);
        }
        if (missingPurchaseFields)
          invalid(
            "اختر التصنيف وجهة المراجعة للصنف «" +
              missingPurchaseFields.itemName +
              "» من CMMS / Select a CMMS category and review department for “" +
              missingPurchaseFields.itemName +
              "” / اس صنف کے لیے CMMS سے زمرہ اور جائزہ شعبہ منتخب کریں۔"
          );
        if (failure) throw failure;
        const resolvedItems = input.items.map(item => {
          const entry = imported.find(
            entry => entry.id === item.catalogEntryId
          );
          return {
            ...item,
            catalogCode: entry?.catalogCode ?? "",
            itemName: entry?.itemName ?? item.itemName,
            unitId: entry?.unitId ?? item.unitId,
            ...cmmsPurchaseReferences(item, options),
          };
        });
        await ensureDefaultUnits(tx);
        const unitIds = [...new Set(resolvedItems.map(item => item.unitId))];
        const units = await tx
          .select()
          .from(s.materialUnits)
          .where(inArray(s.materialUnits.id, unitIds))
          .for("update");
        if (units.length !== unitIds.length || units.some(unit => !unit.active))
          throw new DomainError("INVALID_REFERENCE");
        const values = resolvedItems.map((item, index) => ({
          sequence: index + 1,
          ...item,
          leadDays: leadDays(startDate, item.needDate),
        }));
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
  const referencesConfigured = cmmsReferencesConfigured();
  const db = await database();
  const [mappedProject] = referencesConfigured
    ? await db
        .select({
          cmmsSiteId: s.constructionProjects.cmmsSiteId,
          cmmsSectionId: s.constructionProjects.cmmsSectionId,
        })
        .from(s.materialRequisitions)
        .innerJoin(
          s.constructionProjects,
          eq(s.constructionProjects.id, s.materialRequisitions.projectId)
        )
        .where(
          and(
            eq(s.materialRequisitions.id, input.id),
            eq(s.materialRequisitions.status, "draft"),
            eq(s.materialRequisitions.version, input.version),
            constructionScope(access, s.constructionProjects.id)
          )
        )
    : [];
  const { options, failure } = await cmmsOptions(
    projectHasCmmsLocation(mappedProject),
    input.locale
  );
  return db.transaction(tx =>
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
        const startDate = requirePlannedStart(linked.startDate);
        const items = await itemsFor(tx, [row.id]);
        if (!items.length || items.length > 20)
          throw new DomainError("INVALID_INPUT");
        const sendToCmms = projectHasCmmsLocation(linked.project);
        if (
          sendToCmms &&
          items.some(item => !isWholeRequisitionQuantity(item.quantity))
        ) {
          throw new DomainError("CMMS_WHOLE_QUANTITY_REQUIRED");
        }
        if (sendToCmms && !referencesConfigured) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "أعد تفعيل ربط قوائم CMMS قبل اعتماد احتياج هذا المشروع / Restore CMMS reference access before approving this project's requisition / اس منصوبے کی درخواست منظور کرنے سے پہلے CMMS حوالہ رابطہ بحال کریں۔",
          });
        }
        if (sendToCmms && failure) throw failure;
        if (sendToCmms && !options) throw new DomainError("CONFLICT");
        const officialItems = items.map(item => ({
          ...item,
          needDate: dateFromLead(startDate, item.leadDays),
          ...(sendToCmms ? cmmsPurchaseReferences(item, options) : {}),
        }));
        for (const item of officialItems) {
          if (!dateInput.safeParse(item.needDate).success)
            invalid(
              `تاريخ الاحتياج المحسوب للصنف «${item.itemName}» غير صالح. حدّث فرق الأيام في المسودة. / The calculated need date for “${item.itemName}” is invalid. Update the day offset in the draft. / آئٹم «${item.itemName}» کی حساب شدہ ضرورت کی تاریخ درست نہیں ہے۔ مسودے میں دنوں کا فرق درست کریں۔`
            );
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
            ...cmmsProjectLocation(linked.project),
          },
          task: linked.task
            ? {
                id: linked.task.id,
                name: linked.task.name,
                level: linked.task.level,
                parentId: linked.task.parentId,
              }
            : null,
          sourceStartDate: startDate,
          creatorName: creator?.name ?? null,
          approverName: access.user.name,
          items: officialItems,
        };
        const after = {
          status: "approved",
          externalStatus: "pending_send",
          cmmsDispatchNextAt: sendToCmms ? new Date() : null,
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
        if (row.cmmsDispatchNextAt != null || row.cmmsDispatchAttempts > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "يدير الإرسال التلقائي حالة الربط لهذا الطلب / Automatic delivery manages this requisition's integration status / اس درخواست کی انضمام حالت خودکار ارسال کے زیر انتظام ہے۔",
          });
        }
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
