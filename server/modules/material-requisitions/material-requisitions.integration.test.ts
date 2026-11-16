import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../../routers";
import { database } from "../../core/database";
import { loadAccess } from "../../core/policy";
import { closeDb, createLocalUser, seedPermissions } from "../../db";
import { hashPassword } from "../../localAuth";
import type { TrpcContext } from "../../_core/context";
import * as s from "../../../drizzle/construction";
import { operationKeys, scmAuditEvents } from "../../../drizzle/foundation";
import { users, userPermissions } from "../../../drizzle/schema";
import { dateFromLead } from "../../../shared/material-requisitions";
import {
  accessConstructionProjects,
  accessDenials,
  accessProfiles,
} from "../../../drizzle/policy";

vi.mock("../cmms-integration/references", async importOriginal => ({
  ...(await importOriginal<typeof import("../cmms-integration/references")>()),
  cmmsReferencesConfigured: () => true,
  readCmmsPurchaseOptions: async () => ({
    categories: [{ id: 201, name: "QA purchase category" }],
    reviewRoles: [{ code: "senior_management", name: "Senior management" }],
  }),
}));
vi.mock("../cmms-integration/purchase-delivery", () => ({
  dispatchApprovedCmmsRequisition: vi.fn(),
}));
const purchaseChoice = {
  cmmsCategoryId: 201,
  cmmsReviewRole: "senior_management",
};

vi.setConfig({ testTimeout: 90000 });
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "Material requisition integrated workflow",
  () => {
    const prefix = `MRQA-${randomUUID().slice(0, 8)}`;
    const keys: string[] = [],
      requestIds: number[] = [],
      catalogEntryIds: number[] = [];
    let projectId = 0,
      taskId = 0,
      employeeId = 0,
      unitId = 0,
      catalogEntryId = 0,
      ownerId = 0,
      regularId = 0,
      statusId = 0;
    let owner: ReturnType<typeof appRouter.createCaller>, regular: typeof owner;
    const key = () => {
      const value = randomUUID();
      keys.push(value);
      return value;
    };
    const caller = async (id: number) =>
      appRouter.createCaller({
        user: (await loadAccess(id))!.user,
        req: { headers: {}, protocol: "http" },
        res: {},
      } as TrpcContext);
    const seedCatalog = async (
      suffix: string,
      unit: typeof s.materialUnits.$inferSelect
    ) => {
      const [entry] = await (await database())
        .insert(s.materialCatalogEntries)
        .values({
          sourceKey: createHash("sha256").update(prefix).digest("hex"),
          externalId: prefix + "-" + suffix,
          catalogCode: prefix + "-" + suffix,
          itemName: prefix + " " + suffix,
          unitId: unit.id,
          unitSnapshot: JSON.stringify(unit),
          specifications: "",
          createdBy: ownerId,
        });
      const id = Number(entry.insertId);
      catalogEntryIds.push(id);
      return id;
    };
    const taskDetail = () => owner.projectManagement.detail({ id: projectId });
    const move = async (startDate: string) => {
      const task = (await taskDetail()).tasks.find(row => row.id === taskId)!;
      return owner.projectManagement.saveTask({
        key: key(),
        id: taskId,
        version: task.version,
        projectId,
        parentId: null,
        name: task.name,
        statusId,
        priority: "medium",
        startDate,
        endDate: "2026-12-20",
        employeeIds: [employeeId],
      });
    };
    beforeAll(async () => {
      await seedPermissions();
      const db = await database();
      const [admin] = await db
        .select()
        .from(users)
        .where(eq(users.username, "admin"));
      if (!admin) throw Error("Existing owner required");
      ownerId = admin.id;
      owner = await caller(ownerId);
      regularId = await createLocalUser({
        username: prefix.toLowerCase(),
        name: prefix,
        passwordHash: await hashPassword(randomUUID()),
        permissionCodes: ["pm.view", "materialRequisitions.view"],
      });
      regular = await caller(regularId);
      const [status] = await db
        .select()
        .from(s.taskStatuses)
        .where(eq(s.taskStatuses.code, "not_started"));
      statusId = status.id;
      const [employee] = await db.insert(s.employees).values({ name: prefix });
      employeeId = Number(employee.insertId);
      const [project] = await db.insert(s.constructionProjects).values({
        number: prefix,
        name: prefix,
        description: "QA",
        requirements: "QA",
        site: "QA",
        cmmsSiteId: 101,
        cmmsSiteName: "QA",
        cmmsSectionId: 102,
        cmmsSectionName: "QA section",
        plannedStartDate: "2026-12-01",
        plannedEndDate: "2026-12-31",
        status: "active",
        createdBy: admin.id,
      });
      projectId = Number(project.insertId);
      const [task] = await db.insert(s.projectTasks).values({
        projectId,
        name: prefix + " task",
        statusId,
        startDate: "2026-12-10",
        endDate: "2026-12-20",
        level: 1,
        createdBy: admin.id,
      });
      taskId = Number(task.insertId);
      await db.insert(s.taskAssignees).values({ taskId, employeeId });
      const unit = await owner.materialRequisitions.saveUnit({
        key: key(),
        code: prefix.replace(/-/g, ""),
        nameAr: "وحدة اختبار",
        nameEn: "QA unit",
        nameUr: "آزمائشی اکائی",
      });
      unitId = unit.id;
      const [savedUnit] = await db
        .select()
        .from(s.materialUnits)
        .where(eq(s.materialUnits.id, unitId));
      catalogEntryId = await seedCatalog("Epoxy", savedUnit);
    }, 60000);
    afterAll(async () => {
      try {
        const db = await database();
        await db.transaction(async tx => {
          if (requestIds.length) {
            await tx
              .delete(s.materialRequisitions)
              .where(inArray(s.materialRequisitions.id, requestIds));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_material_requisition"),
                  inArray(scmAuditEvents.entityId, requestIds)
                )
              );
          }
          if (catalogEntryIds.length)
            await tx
              .delete(s.materialCatalogEntries)
              .where(inArray(s.materialCatalogEntries.id, catalogEntryIds));
          if (taskId) {
            await tx
              .delete(s.ganttTaskSettings)
              .where(eq(s.ganttTaskSettings.taskId, taskId));
            await tx
              .delete(s.taskAssignees)
              .where(eq(s.taskAssignees.taskId, taskId));
            await tx
              .delete(s.projectTasks)
              .where(eq(s.projectTasks.id, taskId));
          }
          if (projectId) {
            await tx
              .delete(s.ganttStudioStates)
              .where(eq(s.ganttStudioStates.projectId, projectId));
            await tx
              .delete(s.projectEvents)
              .where(eq(s.projectEvents.projectId, projectId));
            await tx
              .delete(accessConstructionProjects)
              .where(eq(accessConstructionProjects.projectId, projectId));
            await tx
              .delete(s.constructionProjects)
              .where(eq(s.constructionProjects.id, projectId));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_project"),
                  eq(scmAuditEvents.entityId, projectId)
                )
              );
          }
          if (unitId) {
            await tx
              .delete(s.materialUnits)
              .where(eq(s.materialUnits.id, unitId));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_material_unit"),
                  eq(scmAuditEvents.entityId, unitId)
                )
              );
          }
          if (employeeId)
            await tx.delete(s.employees).where(eq(s.employees.id, employeeId));
          if (keys.length)
            await tx
              .delete(operationKeys)
              .where(inArray(operationKeys.key, keys));
          if (regularId) {
            await tx
              .delete(accessDenials)
              .where(eq(accessDenials.actorId, regularId));
            await tx
              .delete(userPermissions)
              .where(eq(userPermissions.userId, regularId));
            await tx
              .delete(accessProfiles)
              .where(eq(accessProfiles.userId, regularId));
            await tx
              .delete(scmAuditEvents)
              .where(eq(scmAuditEvents.actorId, regularId));
            await tx.delete(users).where(eq(users.id, regularId));
          }
        });
      } finally {
        await closeDb();
      }
    }, 60000);

    it("allows multiple numbered requests for one task, enforces 20 rows and idempotency", async () => {
      const item = {
        itemName: prefix + " Epoxy",
        ...purchaseChoice,
        catalogEntryId,
        quantity: "0.123456789",
        unitId,
        needDate: "2026-12-07",
      };
      const input = { key: key(), projectId, taskId, items: [item] };
      const first = await owner.materialRequisitions.save(input);
      requestIds.push(first.id);
      expect(await owner.materialRequisitions.save(input)).toEqual(first);
      const second = await owner.materialRequisitions.save({
        ...input,
        key: key(),
        items: Array.from({ length: 20 }, () => item),
      });
      requestIds.push(second.id);
      await expect(
        owner.materialRequisitions.save({
          ...input,
          key: key(),
          items: Array.from({ length: 21 }, () => item),
        })
      ).rejects.toThrow();
      const data = await owner.materialRequisitions.list({ projectId, taskId });
      expect(data.total).toBe(2);
      expect(data.rows.map(row => row.number)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^MR-\d{2}-\d{2}-\d{4,}$/),
        ])
      );
      expect(data.rows[0].items[0].quantity).toBe("0.123456789");
      await expect(
        owner.materialRequisitions.save({
          ...input,
          key: key(),
          items: [{ ...item, needDate: "2026-12-08" }],
        })
      ).rejects.toThrow();
    });
    it("moves draft dates with Gantt/PM start, freezes official data and rolls back conflicts", async () => {
      await move("2026-12-12");
      const first = await owner.materialRequisitions.detail({
        id: requestIds[0],
      });
      expect(first.items[0].needDate).toBe("2026-12-09");
      const approveInput = { key: key(), id: first.id, version: first.version };
      await owner.materialRequisitions.approve(approveInput);
      await owner.materialRequisitions.approve(approveInput);
      await move("2026-12-14");
      const official = await owner.materialRequisitions.detail({
        id: first.id,
      });
      expect(official.items[0].needDate).toBe("2026-12-09");
      expect(
        (await owner.materialRequisitions.detail({ id: requestIds[1] }))
          .items[0].needDate
      ).toBe("2026-12-11");
      await expect(move("2026-12-11")).rejects.toThrow();
      expect(
        (await taskDetail()).tasks.find(row => row.id === taskId)?.startDate
      ).toBe("2026-12-14");
      await expect(
        owner.materialRequisitions.save({
          key: key(),
          id: first.id,
          version: official.version,
          projectId,
          taskId,
          items: [
            {
              itemName: "Changed",
              ...purchaseChoice,
              catalogEntryId,
              quantity: "1",
              unitId,
              needDate: "2026-12-01",
            },
          ],
        })
      ).rejects.toThrow();
      const unit = (await owner.materialRequisitions.allUnits()).find(
        row => row.id === unitId
      )!;
      await owner.materialRequisitions.saveUnit({
        key: key(),
        ...unit,
        nameEn: "New unit label",
        active: false,
      });
      await owner.materialRequisitions.directory();
      expect(
        (await owner.materialRequisitions.allUnits()).find(
          row => row.id === unitId
        )?.active
      ).toBe(false);
      expect(
        (await owner.materialRequisitions.detail({ id: first.id })).items[0]
          .unit.nameEn
      ).toBe("QA unit");
      const exported = await owner.materialRequisitions.exportApproved({
        id: first.id,
      });
      expect(exported.idempotencyKey).toBe(official.number);
      expect(exported.items[0].needDate).toBe("2026-12-09");
    });
    it("filters and paginates in SQL and prevents access beyond project scope", async () => {
      const result = await owner.materialRequisitions.list({
        projectId,
        q: prefix + " Epoxy",
        needFrom: "2026-12-09",
        needTo: "2026-12-11",
        pageSize: 1,
      });
      expect(result.total).toBe(2);
      expect(result.rows).toHaveLength(1);
      expect(
        (
          await owner.materialRequisitions.list({
            projectId,
            page: 2,
            pageSize: 1,
          })
        ).rows
      ).toHaveLength(1);
      expect((await regular.materialRequisitions.list({})).total).toBe(0);
      await expect(
        regular.materialRequisitions.detail({ id: requestIds[0] })
      ).rejects.toThrow();
    });
    it("accepts an idempotent return PR reference without changing the official document", async () => {
      const db = await database();
      const [source] = await db
        .select({
          approvedAt: s.materialRequisitions.approvedAt,
          approvedSnapshot: s.materialRequisitions.approvedSnapshot,
        })
        .from(s.materialRequisitions)
        .where(eq(s.materialRequisitions.id, requestIds[0]));
      const [legacy] = await db.insert(s.materialRequisitions).values({
        number: prefix + "-LEGACY",
        projectId,
        taskId,
        status: "approved",
        createdBy: ownerId,
        approvedBy: ownerId,
        ...source,
      });
      const legacyId = Number(legacy.insertId);
      requestIds.push(legacyId);
      const request = await owner.materialRequisitions.detail({
        id: legacyId,
      });
      const input = {
        key: key(),
        requisitionNumber: request.number,
        status: "purchase_request_created" as const,
        purchaseRequestNumber: prefix + "-PR",
      };
      await owner.materialRequisitions.updateExternal(input);
      await owner.materialRequisitions.updateExternal(input);
      expect(
        (await owner.materialRequisitions.detail({ id: request.id }))
          .externalPurchaseRequestNumber
      ).toBe(input.purchaseRequestNumber);
      await expect(
        owner.materialRequisitions.updateExternal({
          ...input,
          key: key(),
          purchaseRequestNumber: "different",
        })
      ).rejects.toThrow();
      expect(
        (await owner.materialRequisitions.detail({ id: request.id })).items
      ).toEqual(request.items);
    });
    it("Gantt API moves draft dates and atomically rejects an official conflict", async () => {
      const original = (await taskDetail()).tasks.find(
        row => row.id === taskId
      )!;
      const activeUnit = (await owner.materialRequisitions.directory())
        .units[0];
      const ganttCatalogEntryId = await seedCatalog("Gantt", activeUnit);
      const input = {
        projectId,
        taskId,
        items: [
          {
            itemName: prefix + " Gantt",
            ...purchaseChoice,
            catalogEntryId: ganttCatalogEntryId,
            quantity: "1",
            unitId: activeUnit.id,
            needDate: dateFromLead(original.startDate, 3),
          },
        ],
      };
      const official = await owner.materialRequisitions.save({
        key: key(),
        ...input,
      });
      requestIds.push(official.id);
      const draft = await owner.materialRequisitions.save({
        key: key(),
        ...input,
      });
      requestIds.push(draft.id);
      await owner.materialRequisitions.approve({
        key: key(),
        id: official.id,
        version: 0,
      });
      const update = (startDate: string, version: number) => ({
        key: key(),
        projectId,
        updates: [
          {
            taskId,
            version,
            startDate,
            endDate: original.endDate,
            notBefore: null,
            isMilestone: false,
          },
        ],
      });
      const shifted = dateFromLead(original.startDate, -2);
      await owner.gantt.saveSchedule(update(shifted, original.version));
      expect(
        (await owner.materialRequisitions.detail({ id: draft.id })).items[0]
          .needDate
      ).toBe(dateFromLead(shifted, 3));
      const current = (await taskDetail()).tasks.find(
        row => row.id === taskId
      )!;
      await expect(
        owner.gantt.saveSchedule(
          update(dateFromLead(original.startDate, 1), current.version)
        )
      ).rejects.toThrow();
      expect(
        (await taskDetail()).tasks.find(row => row.id === taskId)?.startDate
      ).toBe(shifted);
      expect(
        (await owner.materialRequisitions.detail({ id: official.id })).items[0]
          .needDate
      ).toBe(input.items[0].needDate);
    });
  }
);
