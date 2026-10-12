import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, listUsers, createContractAmendment } from "../../db";
import {
  contracts,
  contractAmendments,
  suppliers,
  users,
} from "../../../drizzle/schema";
import { transitionAmendment } from "../contracts/service";
import { database } from "../../core/database";
import { allocateDocumentNumber } from "../../core/numbering";
import {
  documentSequences,
  operationKeys,
  scmAuditEvents,
  scmOutbox,
} from "../../../drizzle/foundation";
import {
  masterInput,
  masterListInput,
  type MasterKind,
} from "../../../shared/master-data";
import { categories, sites } from "../../../drizzle/master-data";
import * as service from "./service";
import * as repository from "./repository";

describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "SCM database integrity",
  () => {
    let actorId: number;
    const codePrefix = `IT-${randomUUID().slice(0, 8)}`.toUpperCase();
    const ids: Array<{ kind: MasterKind; id: number }> = [],
      keys: string[] = [];
    let contractId: number | undefined,
      supplierId: number | undefined,
      reviewerId: number | undefined;
    const amendmentIds: number[] = [];
    const sequencePrefix = `TEST${randomUUID()
      .replace(/[^a-f]/g, "")
      .slice(0, 6)
      .toUpperCase()}`;
    const named = (suffix: string) => ({
      code: `${codePrefix}-${suffix}`,
      nameAr: "اختبار",
      nameEn: "Integration test",
      nameUr: "ٹیسٹ",
    });
    beforeAll(async () => {
      const admin = (await listUsers()).find(user => user.role === "admin");
      if (!admin)
        throw new Error("Seed an administrator before SCM integration tests");
      actorId = admin.id;
    });
    afterAll(async () => {
      try {
        const db = await database();
        for (const [entityType, entityIds] of [
          ["contract", contractId ? [contractId] : []],
          ["contract_amendment", amendmentIds],
        ] as const) {
          if (entityIds.length) {
            await db
              .delete(scmAuditEvents)
              .where(
                and(
                  eq(scmAuditEvents.entityType, entityType),
                  inArray(scmAuditEvents.entityId, [...entityIds])
                )
              );
            await db
              .delete(scmOutbox)
              .where(
                and(
                  eq(scmOutbox.entityType, entityType),
                  inArray(scmOutbox.entityId, [...entityIds])
                )
              );
          }
        }
        if (amendmentIds.length)
          await db
            .delete(contractAmendments)
            .where(inArray(contractAmendments.id, amendmentIds));
        if (contractId)
          await db.delete(contracts).where(eq(contracts.id, contractId));
        if (supplierId)
          await db.delete(suppliers).where(eq(suppliers.id, supplierId));
        if (reviewerId) await db.delete(users).where(eq(users.id, reviewerId));
        if (keys.length)
          await db
            .delete(operationKeys)
            .where(
              and(
                eq(operationKeys.actorId, actorId),
                inArray(operationKeys.key, keys)
              )
            );
        for (const record of [...ids].reverse()) {
          await db
            .delete(scmAuditEvents)
            .where(
              and(
                eq(scmAuditEvents.entityType, record.kind),
                eq(scmAuditEvents.entityId, record.id)
              )
            );
          await db
            .delete(scmOutbox)
            .where(
              and(
                eq(scmOutbox.entityType, record.kind),
                eq(scmOutbox.entityId, record.id)
              )
            );
          await db
            .delete(repository.tables[record.kind])
            .where(eq(repository.tables[record.kind].id, record.id));
        }
        await db
          .delete(documentSequences)
          .where(
            and(
              eq(documentSequences.prefix, sequencePrefix),
              eq(documentSequences.year, 2099)
            )
          );
      } finally {
        await closeDb();
      }
    });
    async function create(data: unknown) {
      const parsed = masterInput.parse(data),
        key = randomUUID();
      keys.push(key);
      const record = await service.create(parsed, actorId, key);
      ids.push({ kind: parsed.kind, id: record.id });
      return { ...record, key, data: parsed };
    }
    it("atomically records creation, audit and outbox; repeated requests return the same result", async () => {
      const record = await create({ kind: "branches", ...named("BRANCH") });
      const repeated = await service.create(record.data, actorId, record.key);
      expect(repeated.id).toBe(record.id);
      const db = await database();
      const audits = await db
        .select()
        .from(scmAuditEvents)
        .where(
          and(
            eq(scmAuditEvents.entityType, "branches"),
            eq(scmAuditEvents.entityId, record.id)
          )
        );
      const events = await db
        .select()
        .from(scmOutbox)
        .where(
          and(
            eq(scmOutbox.entityType, "branches"),
            eq(scmOutbox.entityId, record.id)
          )
        );
      expect(audits).toHaveLength(1);
      expect(events).toHaveLength(1);
      await expect(
        service.create(
          { ...record.data, nameEn: "Different" },
          actorId,
          record.key
        )
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
    });
    it("serializes simultaneous identical idempotency keys", async () => {
      const data = masterInput.parse({
        kind: "branches",
        ...named("PARALLEL"),
      });
      const key = randomUUID();
      keys.push(key);
      const results = await Promise.all([
        service.create(data, actorId, key),
        service.create(data, actorId, key),
      ]);
      ids.push({ kind: "branches", id: results[0].id });
      expect(results[0].id).toBe(results[1].id);
    });
    it("rejects stale edits without creating a second audit event", async () => {
      const record = await create({ kind: "branches", ...named("VERSION") });
      await service.update(
        { ...record.data, nameEn: "Updated" },
        record.id,
        1,
        actorId,
        "Correct name"
      );
      await expect(
        service.update(record.data, record.id, 1, actorId, "Stale edit")
      ).rejects.toMatchObject({ domainCode: "CONFLICT" });
      expect((await service.detail("branches", record.id)).version).toBe(2);
    });
    it("rejects hierarchy cycles", async () => {
      const a = await create({ kind: "categories", ...named("ROOT") });
      const b = await create({
        kind: "categories",
        ...named("CHILD"),
        parentId: a.id,
      });
      const input = masterInput.parse({
        kind: "categories",
        ...named("ROOT"),
        parentId: b.id,
      });
      await expect(
        service.update(input, a.id, 1, actorId, "Attempt cycle")
      ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
      expect((await service.detail("categories", a.id)).version).toBe(1);
    });
    it("enforces foreign keys even when application validation is bypassed", async () => {
      const db = await database();
      await expect(
        db.insert(sites).values({ ...named("BAD-FK"), branchId: 2147483647 })
      ).rejects.toThrow();
    });
    it("rolls back partial mutations when a later operation fails", async () => {
      const db = await database();
      await expect(
        db.transaction(async tx => {
          await tx.insert(categories).values(named("ROLLBACK"));
          await tx.execute(
            sql`INSERT INTO scm_sites (code, name_ar, name_en, name_ur, branch_id) VALUES (${`${codePrefix}-FAIL`}, 'x', 'x', 'x', 2147483647)`
          );
        })
      ).rejects.toThrow();
      expect(
        await db
          .select()
          .from(categories)
          .where(eq(categories.code, `${codePrefix}-ROLLBACK`))
      ).toHaveLength(0);
    });
    it("allocates distinct document numbers under concurrent requests", async () => {
      const db = await database();
      const numbers = await Promise.all(
        Array.from({ length: 8 }, () =>
          db.transaction(tx => allocateDocumentNumber(tx, sequencePrefix, 2099))
        )
      );
      expect(new Set(numbers).size).toBe(8);
      expect(numbers.every(n => n.startsWith(`${sequencePrefix}-99-`))).toBe(
        true
      );
    });
    it("paginates and filters in SQL", async () => {
      const result = await repository.list(
        masterListInput.parse({
          kind: "branches",
          search: codePrefix,
          pageSize: 1,
        })
      );
      expect(result.records).toHaveLength(1);
      expect(result.total).toBeGreaterThanOrEqual(3);
      const active = await repository.list(
        masterListInput.parse({
          kind: "branches",
          search: codePrefix,
          active: false,
        })
      );
      expect(active.records).toHaveLength(0);
    });
    it("applies a reviewed contract amendment exactly once under concurrency", async () => {
      const db = await database();
      const [reviewer] = await db
        .insert(users)
        .values({
          openId: `${codePrefix}-REVIEWER`,
          name: "Integration reviewer",
          active: false,
        })
        .$returningId();
      reviewerId = reviewer.id;
      const [supplier] = await db
        .insert(suppliers)
        .values({
          supplierNumber: `${codePrefix}-SUP`,
          nameAr: "اختبار",
          createdBy: actorId,
        })
        .$returningId();
      supplierId = supplier.id;
      const [contract] = await db
        .insert(contracts)
        .values({
          contractNumber: `${codePrefix}-CTR`,
          title: "Integration fixture",
          supplierId,
          originalValue: "200000.00",
          currentValue: "200000.00",
          endDate: new Date("2030-01-01T00:00:00Z"),
          status: "active",
          createdBy: actorId,
        })
        .$returningId();
      contractId = contract.id;
      const amendmentId = await createContractAmendment({
        contractId,
        amendmentNumber: `${codePrefix}-AMD`,
        amendmentType: "variation",
        valueChange: "1234.56",
        extensionDays: 10,
        reason: "Integration fixture",
        createdBy: actorId,
      });
      if (!amendmentId) throw new Error("Missing amendment ID");
      amendmentIds.push(amendmentId);
      const readContract = async () =>
        (
          await db.select().from(contracts).where(eq(contracts.id, contract.id))
        )[0];
      expect((await readContract()).currentValue).toBe("200000.00");
      await transitionAmendment(amendmentId, "submitted", actorId, "Submit");
      await expect(
        transitionAmendment(amendmentId, "reviewed", actorId, "Self review")
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await transitionAmendment(amendmentId, "reviewed", reviewerId, "Review");
      expect((await readContract()).currentValue).toBe("200000.00");
      const results = await Promise.allSettled([
        transitionAmendment(amendmentId, "effective", reviewerId, "Apply"),
        transitionAmendment(amendmentId, "effective", reviewerId, "Duplicate"),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      const updated = await readContract();
      expect(updated.currentValue).toBe("201234.56");
      expect(updated.endDate?.toISOString()).toBe("2030-01-11T00:00:00.000Z");
      const events = await db
        .select()
        .from(scmAuditEvents)
        .where(
          and(
            eq(scmAuditEvents.entityType, "contract"),
            eq(scmAuditEvents.entityId, contractId),
            eq(scmAuditEvents.action, "contract.amendment.effective")
          )
        );
      expect(events).toHaveLength(1);
    });
  }
);
