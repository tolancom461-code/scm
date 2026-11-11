import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { appRouter } from "../../routers";
import { database } from "../../core/database";
import { closeDb, createLocalUser, seedPermissions } from "../../db";
import { hashPassword } from "../../localAuth";
import { loadAccess } from "../../core/policy";
import type { TrpcContext } from "../../_core/context";
import * as s from "../../../drizzle/construction";
import { operationKeys, scmAuditEvents } from "../../../drizzle/foundation";
import { users, userPermissions } from "../../../drizzle/schema";
import {
  accessConstructionProjects,
  accessDenials,
  accessProfiles,
} from "../../../drizzle/policy";
import type { CatalogItem } from "./catalog-provider";

const remote = vi.hoisted(() => ({
  items: new Map<string, CatalogItem>(),
  fetch: vi.fn(),
  image: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("./catalog-provider", () => ({
  catalogConfigurationStatus: () => ({ configured: true }),
  fetchCatalogItems: remote.fetch,
  searchCatalog: vi.fn(),
}));
vi.mock("./catalog-media", () => ({ persistCatalogImage: remote.image }));
vi.mock("../../storage", async importOriginal => ({
  ...(await importOriginal<typeof import("../../storage")>()),
  deleteStoredDocument: remote.deleted,
}));

vi.setConfig({ testTimeout: 90000 });
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "Catalog-backed material requisitions",
  () => {
    const prefix = `CATQA-${randomUUID().slice(0, 8)}`;
    const keys: string[] = [],
      unitIds = new Set<number>();
    let projectId = 0,
      regularId = 0,
      manualUnitId = 0,
      importedId = 0,
      approvedId = 0;
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
    const source: CatalogItem = {
      id: `${prefix}-external-id`,
      code: "000045-EPOXY",
      name: prefix + " imported epoxy",
      specifications: "Imported engineering specification",
      unit: {
        id: "external-unit-0007",
        code: prefix.replace(/-/g, ""),
        nameAr: "عبوة الكتالوج",
        nameEn: "Catalog pack",
        nameUr: "کیٹلاگ پیک",
      },
      imageUrl: "https://catalog.example/original-image.png",
    };

    beforeAll(async () => {
      remote.fetch.mockImplementation(async (ids: string[]) =>
        ids.map(id => {
          const item = remote.items.get(id);
          if (!item) throw Error("Unrecognized test catalog identity");
          return structuredClone(item);
        })
      );
      remote.image.mockImplementation(async () => ({
        key: `local/${randomUUID()}`,
        url: "/unused-test-object",
        mimeType: "image/png",
        checksum: "a".repeat(64),
        sizeBytes: 8,
      }));
      await seedPermissions();
      const db = await database();
      const [admin] = await db
        .select()
        .from(users)
        .where(eq(users.username, "admin"));
      if (!admin) throw Error("Existing system owner required");
      owner = await caller(admin.id);
      regularId = await createLocalUser({
        username: prefix.toLowerCase(),
        name: prefix,
        passwordHash: await hashPassword(randomUUID()),
        permissionCodes: [
          "pm.view",
          "materialRequisitions.view",
          "materialRequisitions.create",
        ],
      });
      regular = await caller(regularId);
      const [project] = await db
        .insert(s.constructionProjects)
        .values({
          number: prefix,
          name: prefix,
          site: "QA",
          description: "QA",
          requirements: "QA",
          status: "active",
          plannedStartDate: "2030-12-10",
          plannedEndDate: "2030-12-31",
          createdBy: admin.id,
        });
      projectId = Number(project.insertId);
      await db
        .insert(accessConstructionProjects)
        .values({ userId: regularId, projectId });
      const manualUnit = await owner.materialRequisitions.saveUnit({
        key: key(),
        code: prefix.replace(/-/g, "") + "MANUAL",
        nameAr: "وحدة يدوية",
        nameEn: "Manual unit",
        nameUr: "دستی اکائی",
      });
      manualUnitId = manualUnit.id;
      unitIds.add(manualUnitId);
      remote.items.set(source.id, structuredClone(source));
    }, 90000);

    afterAll(async () => {
      try {
        const db = await database();
        await db.transaction(async tx => {
          // All cleanup targets belong to this exact fixture, including partially completed tests.
          const requests = projectId
            ? await tx
                .select({ id: s.materialRequisitions.id })
                .from(s.materialRequisitions)
                .where(eq(s.materialRequisitions.projectId, projectId))
            : [];
          if (requests.length) {
            const ids = requests.map(row => row.id);
            await tx
              .delete(s.materialRequisitions)
              .where(inArray(s.materialRequisitions.id, ids));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_material_requisition"),
                  inArray(scmAuditEvents.entityId, ids)
                )
              );
          }
          const imports = await tx
            .select()
            .from(s.materialCatalogEntries)
            .where(like(s.materialCatalogEntries.externalId, prefix + "%"));
          if (imports.length) {
            imports.forEach(row => unitIds.add(row.unitId));
            await tx.delete(s.materialCatalogEntries).where(
              inArray(
                s.materialCatalogEntries.id,
                imports.map(row => row.id)
              )
            );
            await tx.delete(scmAuditEvents).where(
              and(
                eq(scmAuditEvents.entityType, "pm_material_catalog_entry"),
                inArray(
                  scmAuditEvents.entityId,
                  imports.map(row => row.id)
                )
              )
            );
          }
          if (projectId) {
            await tx
              .delete(accessConstructionProjects)
              .where(eq(accessConstructionProjects.projectId, projectId));
            await tx
              .delete(s.constructionProjects)
              .where(eq(s.constructionProjects.id, projectId));
          }
          if (unitIds.size) {
            await tx
              .delete(s.materialUnits)
              .where(inArray(s.materialUnits.id, [...unitIds]));
            await tx
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, "pm_material_unit"),
                  inArray(scmAuditEvents.entityId, [...unitIds])
                )
              );
          }
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
    }, 90000);

    it("uses server catalog metadata and images, preserving codes and external unit identity", async () => {
      const [item] = await owner.materialRequisitions.catalogImport({
        ids: [source.id],
      });
      importedId = item.catalogEntryId;
      unitIds.add(item.unitId);
      expect(item.catalogCode).toBe("000045-EPOXY");
      expect(item.unit).toMatchObject({
        externalId: "external-unit-0007",
        code: source.unit.code,
      });
      expect(item.imageUrl).toBe(
        `/material-requisitions/catalog-images/${importedId}`
      );
      const saved = await owner.materialRequisitions.save({
        key: key(),
        projectId,
        items: [
          {
            catalogEntryId: importedId,
            catalogCode: "spoofed",
            itemName: "Spoofed name",
            unitId: manualUnitId,
            quantity: "0.123456789",
            needDate: "2030-12-07",
          },
        ],
      });
      approvedId = saved.id;
      const detail = await owner.materialRequisitions.detail({ id: saved.id });
      expect(detail.items[0]).toMatchObject({
        catalogEntryId: importedId,
        catalogItemId: source.id,
        catalogCode: source.code,
        itemName: source.name,
        unitId: item.unitId,
        imageUrl: item.imageUrl,
        quantity: "0.123456789",
      });
    });

    it("allows scoped editors to retain linked imports but rejects reuse of another user's import in a new request", async () => {
      const existing = await regular.materialRequisitions.detail({
        id: approvedId,
      });
      const row = existing.items[0];
      await expect(
        regular.materialRequisitions.save({
          key: key(),
          projectId,
          items: [
            {
              catalogEntryId: importedId,
              itemName: row.itemName,
              unitId: row.unitId,
              quantity: "1",
              needDate: "2030-12-07",
            },
          ],
        })
      ).rejects.toThrow();
      await regular.materialRequisitions.save({
        key: key(),
        id: existing.id,
        version: existing.version,
        projectId,
        items: [
          {
            catalogEntryId: importedId,
            itemName: row.itemName,
            unitId: row.unitId,
            quantity: "2",
            notes: "Scoped editor updated quantity",
            needDate: "2030-12-07",
          },
        ],
      });
      expect(
        (await owner.materialRequisitions.detail({ id: approvedId })).items[0]
          .quantity
      ).toBe("2.000000000");
    });

    it("freezes official catalog code, unit and image while a new import captures later source changes", async () => {
      const before = await owner.materialRequisitions.detail({
        id: approvedId,
      });
      await owner.materialRequisitions.approve({
        key: key(),
        id: before.id,
        version: before.version,
      });
      remote.items.set(source.id, {
        ...structuredClone(source),
        code: "000099-REVISED",
        name: "Revised catalog item",
        imageUrl: "https://catalog.example/replacement.png",
        unit: { ...source.unit, nameEn: "Revised catalog pack" },
      });
      const [newImport] = await owner.materialRequisitions.catalogImport({
        ids: [source.id],
      });
      expect(newImport.catalogEntryId).not.toBe(importedId);
      expect(newImport.imageUrl).not.toBe(before.items[0].imageUrl);
      expect(newImport.unit.nameEn).toBe("Revised catalog pack");
      const official = await owner.materialRequisitions.detail({
        id: before.id,
      });
      expect(official.items[0]).toMatchObject({
        catalogCode: "000045-EPOXY",
        itemName: source.name,
        imageUrl: `/material-requisitions/catalog-images/${importedId}`,
      });
      expect(official.items[0].unit.nameEn).toBe("Catalog pack");
      const exported = await owner.materialRequisitions.exportApproved({
        id: before.id,
      });
      expect(exported.items[0]).toMatchObject({
        catalogCode: "000045-EPOXY",
        catalogItemId: source.id,
        unit: { externalId: "external-unit-0007", nameEn: "Catalog pack" },
        imageUrl: official.items[0].imageUrl,
      });
      await expect(
        owner.materialRequisitions.save({
          key: key(),
          id: before.id,
          version: official.version,
          projectId,
          items: [
            {
              catalogEntryId: newImport.catalogEntryId,
              itemName: newImport.itemName,
              unitId: newImport.unitId,
              quantity: "2",
              needDate: "2030-12-07",
            },
          ],
        })
      ).rejects.toThrow();
    });

    it("keeps manual rows compatible and rejects a 21-item catalog import before calling the provider", async () => {
      const manual = await owner.materialRequisitions.save({
        key: key(),
        projectId,
        items: [
          {
            itemName: "Manual item",
            catalogCode: "untrusted-code",
            unitId: manualUnitId,
            quantity: "1",
            needDate: "2030-12-07",
          },
        ],
      });
      const row = (await owner.materialRequisitions.detail({ id: manual.id }))
        .items[0];
      expect(row).toMatchObject({
        catalogEntryId: null,
        catalogCode: "",
        catalogItemId: null,
        imageUrl: null,
      });
      const calls = remote.fetch.mock.calls.length;
      await expect(
        owner.materialRequisitions.catalogImport({
          ids: Array.from({ length: 21 }, (_, i) => `${source.id}-${i}`),
        })
      ).rejects.toThrow();
      expect(remote.fetch.mock.calls.length).toBe(calls);
    });
  }
);
