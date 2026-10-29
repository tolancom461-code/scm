import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { appRouter } from "../../routers";
import { loadAccess } from "../../core/policy";
import { database } from "../../core/database";
import { createLocalUser, seedPermissions, closeDb } from "../../db";
import { hashPassword } from "../../localAuth";
import type { TrpcContext } from "../../_core/context";
import * as s from "../../../drizzle/construction";
import {
  users,
  documents,
  userPermissions,
  sessions,
} from "../../../drizzle/schema";
import { operationKeys, scmAuditEvents } from "../../../drizzle/foundation";
import { localDocumentPath } from "../../storage";
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "Project module integrated workflow",
  () => {
    const prefix = "PMQA-" + randomUUID().slice(0, 8),
      keys: string[] = [],
      projectIds: number[] = [],
      employeeIds: number[] = [];
    let statusId = 0,
      regularId = 0,
      projectId = 0;
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
    beforeAll(async () => {
      await seedPermissions();
      const db = await database();
      const [admin] = await db
        .select()
        .from(users)
        .where(eq(users.username, "admin"));
      if (!admin) throw Error("Existing owner required");
      owner = await caller(admin.id);
      regularId = await createLocalUser({
        username: prefix.toLowerCase(),
        name: prefix,
        passwordHash: await hashPassword(randomUUID()),
        permissionCodes: [
          "pm.view",
          "pm.create",
          "pm.edit",
          "pm.submit",
          "pm.tasks.manage",
          "documents.view",
          "documents.upload",
        ],
      });
      regular = await caller(regularId);
    }, 60000);
    afterAll(async () => {
      try {
        const db = await database();
        const files = projectIds.length
          ? await db
              .select()
              .from(documents)
              .where(
                and(
                  eq(documents.entityType, "pm_project"),
                  inArray(documents.entityId, projectIds)
                )
              )
          : [];
        await db.transaction(async tx => {
          if (projectIds.length) {
            const tasks = await tx
              .select({ id: s.projectTasks.id })
              .from(s.projectTasks)
              .where(inArray(s.projectTasks.projectId, projectIds));
            if (tasks.length) {
              await tx.delete(s.taskAssignees).where(
                inArray(
                  s.taskAssignees.taskId,
                  tasks.map(t => t.id)
                )
              );
              await tx
                .update(s.projectTasks)
                .set({ parentId: null })
                .where(inArray(s.projectTasks.projectId, projectIds));
              await tx
                .delete(s.projectTasks)
                .where(inArray(s.projectTasks.projectId, projectIds));
            }
            await tx
              .delete(documents)
              .where(
                and(
                  eq(documents.entityType, "pm_project"),
                  inArray(documents.entityId, projectIds)
                )
              );
            await tx
              .delete(s.projectEvents)
              .where(inArray(s.projectEvents.projectId, projectIds));
            await tx
              .delete(s.constructionProjects)
              .where(inArray(s.constructionProjects.id, projectIds));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_project"),
                  inArray(scmAuditEvents.entityId, projectIds)
                )
              );
          }
          if (employeeIds.length) {
            await tx
              .delete(s.employees)
              .where(inArray(s.employees.id, employeeIds));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_employee"),
                  inArray(scmAuditEvents.entityId, employeeIds)
                )
              );
          }
          if (statusId) {
            await tx
              .delete(s.taskStatuses)
              .where(eq(s.taskStatuses.id, statusId));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_status"),
                  eq(scmAuditEvents.entityId, statusId)
                )
              );
          }
          if (keys.length)
            await tx
              .delete(operationKeys)
              .where(inArray(operationKeys.key, keys));
          if (regularId) {
            await tx.delete(sessions).where(eq(sessions.userId, regularId));
            await tx
              .delete(userPermissions)
              .where(eq(userPermissions.userId, regularId));
            await tx.delete(users).where(eq(users.id, regularId));
          }
        });
        for (const file of files)
          await unlink(localDocumentPath(file.storageKey)).catch(() => {});
      } finally {
        await closeDb();
      }
    }, 90000);
    const detail = () => regular.projectManagement.detail({ id: projectId });
    it("saves an incomplete draft once and assigns its creator project access", async () => {
      const input = { key: key(), data: { name: prefix + " Project" } };
      const first = await regular.projectManagement.save(input);
      projectId = first.id;
      projectIds.push(first.id);
      expect(await regular.projectManagement.save(input)).toEqual(first);
      expect((await detail()).project.status).toBe("draft");
      const p = (await detail()).project;
      await expect(
        regular.projectManagement.action({
          key: key(),
          id: projectId,
          version: p.version,
          action: "submit",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        regular.projectManagement.action({
          key: key(),
          id: projectId,
          version: p.version,
          action: "start",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }, 60000);
    it("uploads valid PDF and DWG, prevents disguised content and closes editing after submission", async () => {
      const p = (await detail()).project;
      await regular.projectManagement.save({
        key: key(),
        id: projectId,
        version: p.version,
        data: {
          name: p.name,
          site: "Riyadh",
          description: "New construction project",
          requirements: "Approved drawings",
        },
      });
      for (const [fileName, content] of [
        ["plan.pdf", "%PDF-1.7\nQA"],
        ["plan.dwg", "AC1027QA"],
      ])
        await regular.documents.upload({
          entityType: "pm_project",
          entityId: projectId,
          title: fileName,
          fileName,
          mimeType: "application/octet-stream",
          base64: Buffer.from(content).toString("base64"),
        });
      await expect(
        regular.documents.upload({
          entityType: "pm_project",
          entityId: projectId,
          title: "Bad file",
          fileName: "bad.dwg",
          mimeType: "application/acad",
          base64: Buffer.from("<html>").toString("base64"),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await regular.documents.list({
          entityType: "pm_project",
          entityId: projectId,
        })
      ).toHaveLength(2);
      await regular.projectManagement.action({
        key: key(),
        id: projectId,
        version: (await detail()).project.version,
        action: "submit",
      });
      await expect(
        regular.projectManagement.save({
          key: key(),
          id: projectId,
          version: (await detail()).project.version,
          data: { name: "Blocked edit" },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }, 60000);
    it("returns a project for revision, resubmits it, approves and starts execution independently", async () => {
      await expect(
        regular.projectManagement.action({
          key: key(),
          id: projectId,
          version: (await detail()).project.version,
          action: "approve",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.projectManagement.action({
          key: key(),
          id: projectId,
          version: (await detail()).project.version,
          action: "return",
          comment: "",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await owner.projectManagement.action({
        key: key(),
        id: projectId,
        version: (await detail()).project.version,
        action: "return",
        comment: "Complete requirements",
      });
      const p = (await detail()).project;
      await regular.projectManagement.save({
        key: key(),
        id: projectId,
        version: p.version,
        data: {
          name: p.name,
          site: p.site,
          description: p.description,
          requirements: "Updated requirements",
        },
      });
      await regular.projectManagement.action({
        key: key(),
        id: projectId,
        version: (await detail()).project.version,
        action: "submit",
      });
      await owner.projectManagement.action({
        key: key(),
        id: projectId,
        version: (await detail()).project.version,
        action: "approve",
      });
      expect((await detail()).project.status).toBe("approved");
      await owner.projectManagement.action({
        key: key(),
        id: projectId,
        version: (await detail()).project.version,
        action: "start",
      });
      expect((await detail()).events.map(e => e.action)).toEqual([
        "start",
        "approve",
        "submit",
        "return",
        "submit",
      ]);
    }, 60000);
    it("rejects a separate proposal and denies cross-project reads and attachment access", async () => {
      const other = await owner.projectManagement.save({
        key: key(),
        data: {
          name: prefix + " Other",
          site: "QA",
          description: "Other scope",
        },
      });
      projectIds.push(other.id);
      const p = (await owner.projectManagement.detail({ id: other.id }))
        .project;
      await owner.projectManagement.action({
        key: key(),
        id: other.id,
        version: p.version,
        action: "submit",
      });
      await owner.projectManagement.action({
        key: key(),
        id: other.id,
        version: p.version + 1,
        action: "reject",
        comment: "Proposal rejected",
      });
      expect(
        (await owner.projectManagement.detail({ id: other.id })).project.status
      ).toBe("rejected");
      await expect(
        regular.projectManagement.detail({ id: other.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        regular.documents.list({ entityType: "pm_project", entityId: other.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await regular.projectManagement.list()).map(p => p.id)).toEqual([
        projectId,
      ]);
    }, 60000);
    it("stores employees, five levels and multiple assignees, and denies a sixth level", async () => {
      for (const name of ["Engineer", "Supervisor"])
        employeeIds.push(
          (
            await owner.projectManagement.saveEmployee({
              key: key(),
              name: prefix + " " + name,
            })
          ).id
        );
      statusId = (
        await owner.projectManagement.saveStatus({
          key: key(),
          name: prefix + " New status",
        })
      ).id;
      let parentId: number | null = null;
      for (let level = 1; level <= 5; level++) {
        const task = await owner.projectManagement.saveTask({
          key: key(),
          projectId,
          parentId,
          name: prefix + " Level " + level,
          statusId,
          startDate: "2026-10-01",
          endDate: "2026-10-20",
          priority: "high",
          employeeIds,
        });
        parentId = task.id;
      }
      await expect(
        owner.projectManagement.saveTask({
          key: key(),
          projectId,
          parentId,
          name: "Level six",
          statusId,
          startDate: "2026-10-01",
          endDate: "2026-10-20",
          priority: "medium",
          employeeIds,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const tasks = (await detail()).tasks;
      expect(tasks.map(t => t.level)).toEqual([1, 2, 3, 4, 5]);
      expect(tasks.every(t => t.employeeIds.length === 2)).toBe(true);
    }, 60000);
    it("blocks parent shortening, child overflow and stale writes without altering existing tasks", async () => {
      const tasks = (await detail()).tasks,
        main = tasks[0],
        child = tasks[1];
      const save = (task: typeof main, change: Partial<typeof main>) =>
        owner.projectManagement.saveTask({
          key: key(),
          ...task,
          ...change,
          priority: (change.priority ?? task.priority) as
            | "critical"
            | "high"
            | "medium"
            | "low",
        });
      await expect(save(main, { endDate: "2026-10-17" })).rejects.toMatchObject(
        { code: "BAD_REQUEST" }
      );
      await expect(
        save(child, { startDate: "2026-09-30" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await save(main, { priority: "low" });
      await expect(save(main, { priority: "critical" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const after = (await detail()).tasks;
      expect(after[0].endDate).toBe("2026-10-20");
      expect(after[1].startDate).toBe("2026-10-01");
    }, 60000);
  }
);
