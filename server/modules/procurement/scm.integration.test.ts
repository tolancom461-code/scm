import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { database } from "../../core/database";
import { closeDb, seedPermissions } from "../../db";
import { users, suppliers } from "../../../drizzle/schema";
import {
  branches,
  sites,
  warehouses,
  costCenters,
  items,
} from "../../../drizzle/master-data";
import * as w from "../../../drizzle/workflows";
import * as p from "../../../drizzle/projects";
import * as s from "../../../drizzle/procurement";
import {
  operationKeys,
  scmAuditEvents,
  scmOutbox,
} from "../../../drizzle/foundation";
import * as wf from "../workflows/service";
import * as project from "../projects/service";
import * as service from "./scm-service";
import { payloadHash } from "../../core/idempotency";
import * as r from "../../../drizzle/receiving";
import * as stock from "../../../drizzle/inventory";
import * as receiving from "../receiving/scm-service";
import * as inventory from "../inventory/service";
import { warehouseLocations } from "../../../drizzle/master-data";
import { containsAmount, rangesOverlap } from "../workflows/service";

describe("Approval ranges and payload integrity", () => {
  it("uses non-overlapping inclusive minimum / exclusive maximum boundaries", () => {
    expect(containsAmount("0", "10000", "9999.99")).toBe(true);
    expect(containsAmount("0", "10000", "10000")).toBe(false);
    expect(containsAmount("10000", null, "10000")).toBe(true);
    expect(
      rangesOverlap(
        { minAmount: "0", maxAmount: "10000" },
        { minAmount: "10000", maxAmount: null }
      )
    ).toBe(false);
  });
  it("distinguishes delegated periods in idempotency payloads", () =>
    expect(payloadHash({ at: new Date("2030-01-01") })).not.toBe(
      payloadHash({ at: new Date("2030-01-02") })
    ));
});
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "Linked procurement and financial commitments",
  () => {
    const code = "IT-" + randomUUID().slice(0, 8).toUpperCase(),
      department = code;
    let buyer = 0,
      approver = 0,
      delegate = 0,
      supplierId = 0,
      projectId = 0,
      budgetId = 0,
      wbsId = 0,
      requisitionId = 0,
      rfqId = 0,
      quotationId = 0,
      awardId = 0,
      orderId = 0,
      branchId = 0,
      siteId = 0,
      warehouseId = 0,
      costCenterId = 0,
      itemId = 0,
      uomId = 0,
      revisionId = 0;
    let shipmentId = 0,
      receiptId = 0,
      batchId = 0,
      allocationId = 0,
      storageId = 0,
      receivingId = 0,
      quarantineId = 0;
    const stockOpIds: number[] = [];
    const definitions: number[] = [],
      keys: string[] = [];
    const key = () => {
      const k = randomUUID();
      keys.push(k);
      return k;
    };
    const names = {
      nameAr: "اختبار",
      nameEn: "Integration fixture",
      nameUr: "ٹیسٹ",
    };
    beforeAll(async () => {
      const db = await database();
      await seedPermissions();
      const actors = await db
        .insert(users)
        .values(
          ["BUYER", "APPROVER", "DELEGATE"].map(suffix => ({
            openId: code + "-" + suffix,
            name: code + "-" + suffix,
            active: true,
          }))
        )
        .$returningId();
      [buyer, approver, delegate] = actors.map(a => a.id);
      const [branch] = await db
        .select()
        .from(branches)
        .where(eq(branches.code, "RIYADH"));
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.branchId, branch.id));
      const [warehouse] = await db
        .select()
        .from(warehouses)
        .where(eq(warehouses.siteId, site.id));
      const [center] = await db
        .select()
        .from(costCenters)
        .where(eq(costCenters.branchId, branch.id));
      const [item] = await db
        .select()
        .from(items)
        .where(eq(items.code, "OLIVE-TREE"));
      branchId = branch.id;
      siteId = site.id;
      warehouseId = warehouse.id;
      costCenterId = center.id;
      const { id: originalItemId, createdAt, updatedAt, ...itemData } = item;
      itemId = (
        await db
          .insert(items)
          .values({ ...itemData, code: code + "-OLIVE", barcode: null })
          .$returningId()
      )[0].id;
      uomId = item.purchasingUomId;
      const [supplier] = await db
        .insert(suppliers)
        .values({ supplierNumber: code, nameAr: code, createdBy: buyer })
        .$returningId();
      supplierId = supplier.id;
      const locations = await db
        .select()
        .from(warehouseLocations)
        .where(eq(warehouseLocations.warehouseId, warehouseId));
      storageId = locations.find(l => l.type === "storage")!.id;
      receivingId = locations.find(l => l.type === "receiving")!.id;
      quarantineId = locations.find(l => l.type === "quarantine")!.id;
      for (const entityType of [
        "requisition",
        "award",
        "order",
        "adjustment",
      ] as const) {
        const d = await wf.createDefinition(
          {
            code: code + "-" + entityType.toUpperCase(),
            ...names,
            entityType,
            currency: "SAR",
            department,
            minAmount: "0",
            maxAmount: null,
            steps: [
              { ...names, approvers: [{ userId: approver, limit: "1000000" }] },
            ],
          },
          approver,
          key()
        );
        definitions.push(d.id);
      }
    }, 30000);
    afterAll(async () => {
      try {
        const db = await database();
        // Delete only rows created by these isolated actors, in dependency order.
        if (stockOpIds.length) {
          await db
            .delete(stock.stockOperationLines)
            .where(inArray(stock.stockOperationLines.operationId, stockOpIds));
          await db
            .delete(stock.stockOperations)
            .where(inArray(stock.stockOperations.id, stockOpIds));
        }
        if (itemId) {
          const batches = await db
            .select()
            .from(r.stockBatches)
            .where(eq(r.stockBatches.itemId, itemId));
          if (batches.length) {
            await db.delete(stock.stockMovements).where(
              inArray(
                stock.stockMovements.batchId,
                batches.map(b => b.id)
              )
            );
            await db.delete(stock.stockBalances).where(
              inArray(
                stock.stockBalances.batchId,
                batches.map(b => b.id)
              )
            );
          }
        }
        if (receiptId) {
          const returns = await db
            .select()
            .from(r.supplierReturns)
            .where(eq(r.supplierReturns.receiptId, receiptId));
          if (returns.length) {
            await db.delete(r.supplierReturnLines).where(
              inArray(
                r.supplierReturnLines.returnId,
                returns.map(r => r.id)
              )
            );
            await db
              .delete(r.supplierReturns)
              .where(eq(r.supplierReturns.receiptId, receiptId));
          }
          const inspections = await db
            .select()
            .from(r.inspections)
            .where(eq(r.inspections.receiptId, receiptId));
          if (inspections.length) {
            await db.delete(r.inspectionResults).where(
              inArray(
                r.inspectionResults.inspectionId,
                inspections.map(r => r.id)
              )
            );
            await db
              .delete(r.inspections)
              .where(eq(r.inspections.receiptId, receiptId));
          }
          const lines = await db
            .select()
            .from(r.receiptLines)
            .where(eq(r.receiptLines.receiptId, receiptId));
          if (lines.length)
            await db.delete(r.receiptAllocations).where(
              inArray(
                r.receiptAllocations.receiptLineId,
                lines.map(l => l.id)
              )
            );
          await db
            .delete(r.receiptLines)
            .where(eq(r.receiptLines.receiptId, receiptId));
          await db
            .delete(r.goodsReceipts)
            .where(eq(r.goodsReceipts.id, receiptId));
        }
        if (shipmentId) {
          await db
            .delete(r.shipmentLines)
            .where(eq(r.shipmentLines.shipmentId, shipmentId));
          await db.delete(r.shipments).where(eq(r.shipments.id, shipmentId));
        }
        if (itemId)
          await db
            .delete(r.stockBatches)
            .where(eq(r.stockBatches.itemId, itemId));
        if (orderId) {
          const lines = await db
            .select()
            .from(s.orderLines)
            .where(eq(s.orderLines.orderId, orderId));
          if (lines.length)
            await db.delete(s.orderSchedules).where(
              inArray(
                s.orderSchedules.orderLineId,
                lines.map(l => l.id)
              )
            );
          await db
            .delete(s.orderLines)
            .where(eq(s.orderLines.orderId, orderId));
          await db.delete(s.orders).where(eq(s.orders.id, orderId));
        }
        if (awardId) {
          await db
            .delete(s.awardLines)
            .where(eq(s.awardLines.awardId, awardId));
          await db
            .delete(s.sourcingAwards)
            .where(eq(s.sourcingAwards.id, awardId));
        }
        if (quotationId) {
          await db
            .delete(s.quotationEvaluations)
            .where(eq(s.quotationEvaluations.quotationId, quotationId));
          await db
            .delete(s.quotationLines)
            .where(eq(s.quotationLines.quotationId, quotationId));
          await db
            .delete(s.supplierQuotations)
            .where(eq(s.supplierQuotations.id, quotationId));
        }
        if (rfqId) {
          await db
            .delete(s.rfqSuppliers)
            .where(eq(s.rfqSuppliers.rfqId, rfqId));
          await db.delete(s.rfqLines).where(eq(s.rfqLines.rfqId, rfqId));
          await db.delete(s.sourcingRfqs).where(eq(s.sourcingRfqs.id, rfqId));
        }
        if (requisitionId) {
          await db
            .delete(s.requisitionLines)
            .where(eq(s.requisitionLines.requisitionId, requisitionId));
          await db
            .delete(s.requisitions)
            .where(eq(s.requisitions.id, requisitionId));
        }
        if (projectId) {
          const bs = await db
            .select()
            .from(p.budgets)
            .where(eq(p.budgets.projectId, projectId));
          if (bs.length)
            await db.delete(p.budgetLedger).where(
              inArray(
                p.budgetLedger.budgetId,
                bs.map(b => b.id)
              )
            );
          if (revisionId)
            await db.delete(p.budgets).where(eq(p.budgets.id, revisionId));
          await db.delete(p.budgets).where(eq(p.budgets.projectId, projectId));
          await db
            .delete(p.wbsNodes)
            .where(eq(p.wbsNodes.projectId, projectId));
          await db.delete(p.projects).where(eq(p.projects.id, projectId));
        }
        const ins = await db
          .select()
          .from(w.workflowInstances)
          .where(eq(w.workflowInstances.department, department));
        if (ins.length) {
          await db.delete(w.workflowDecisions).where(
            inArray(
              w.workflowDecisions.instanceId,
              ins.map(i => i.id)
            )
          );
          await db.delete(w.workflowInstances).where(
            inArray(
              w.workflowInstances.id,
              ins.map(i => i.id)
            )
          );
        }
        await db
          .delete(w.workflowDelegations)
          .where(eq(w.workflowDelegations.createdBy, buyer));
        if (definitions.length) {
          const steps = await db
            .select()
            .from(w.workflowSteps)
            .where(inArray(w.workflowSteps.definitionId, definitions));
          if (steps.length)
            await db.delete(w.workflowApprovers).where(
              inArray(
                w.workflowApprovers.stepId,
                steps.map(i => i.id)
              )
            );
          await db
            .delete(w.workflowSteps)
            .where(inArray(w.workflowSteps.definitionId, definitions));
          await db
            .delete(w.workflowDefinitions)
            .where(inArray(w.workflowDefinitions.id, definitions));
        }
        if (supplierId)
          await db.delete(suppliers).where(eq(suppliers.id, supplierId));
        if (buyer) {
          if (itemId) await db.delete(items).where(eq(items.id, itemId));
          const actors = [buyer, approver, delegate];
          const audits = await db
            .select()
            .from(scmAuditEvents)
            .where(inArray(scmAuditEvents.actorId, actors));
          for (const a of audits)
            await db
              .delete(scmOutbox)
              .where(
                and(
                  eq(scmOutbox.entityType, a.entityType),
                  eq(scmOutbox.entityId, a.entityId)
                )
              );
          await db
            .delete(scmAuditEvents)
            .where(inArray(scmAuditEvents.actorId, actors));
          await db
            .delete(operationKeys)
            .where(inArray(operationKeys.actorId, actors));
          await db.delete(users).where(inArray(users.id, actors));
        }
      } finally {
        await closeDb();
      }
    }, 30000);
    it("creates an active project, WBS and separately approved budget", async () => {
      projectId = (
        await project.createProject(
          {
            code,
            ...names,
            branchId,
            managerId: buyer,
            currency: "SAR",
            startsAt: null,
            endsAt: null,
          },
          buyer,
          key()
        )
      ).id;
      wbsId = (
        await project.createWbs(
          {
            projectId,
            parentId: null,
            code: "6",
            ...names,
            startsAt: null,
            endsAt: null,
          },
          buyer,
          key()
        )
      ).id;
      budgetId = (
        await project.createBudget(
          {
            projectId,
            wbsId,
            costCenterId,
            amount: "200000",
            replacesId: null,
            reason: "Initial test budget",
          },
          buyer,
          key()
        )
      ).id;
      await expect(
        project.approveBudget(budgetId, buyer, "approve", "Self approval")
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await project.approveBudget(
        budgetId,
        approver,
        "approve",
        "Reviewed budget"
      );
      await project.setStatus(projectId, 1, "active", buyer, "Start project");
      expect((await project.detail(projectId)).metrics.available).toBe(
        "200000.00"
      );
    }, 60000);
    it("links 20 olive trees to the budget and rejects requester approval", async () => {
      requisitionId = (
        await service.createRequisition(
          {
            title: code,
            department,
            branchId,
            currency: "SAR",
            priority: "normal",
            requiredDate: "2030-01-01",
            reason: "Landscaping",
            lines: [
              {
                itemId,
                description: "20 olive trees",
                specification: "Mature",
                quantity: "20",
                uomId,
                unitPrice: "10000",
                requiredDate: "2030-01-01",
                siteId,
                warehouseId,
                projectId,
                wbsId,
                costCenterId,
                budgetId,
              },
            ],
          },
          buyer,
          key()
        )
      ).id;
      await service.submit("requisition", requisitionId, buyer);
      const db = await database();
      const [r] = await db
        .select()
        .from(s.requisitions)
        .where(eq(s.requisitions.id, requisitionId));
      await expect(
        service.decide(
          "requisition",
          requisitionId,
          r.workflowId!,
          buyer,
          "approve",
          "Self approval"
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await expect(
        service.decide(
          "requisition",
          requisitionId,
          r.workflowId!,
          delegate,
          "approve",
          "Not assigned"
        )
      ).rejects.toMatchObject({ domainCode: "APPROVER_INELIGIBLE" });
      const delegation = await wf.delegate(
        {
          fromUserId: approver,
          toUserId: delegate,
          entityType: "requisition",
          startsAt: new Date(Date.now() - 60000),
          endsAt: new Date(Date.now() + 60000),
          reason: "Temporary delegate",
        },
        buyer,
        key()
      );
      await service.decide(
        "requisition",
        requisitionId,
        r.workflowId!,
        delegate,
        "approve",
        "Delegate approval"
      );
      await wf.revoke(delegation.id, buyer, "End delegation");
      expect(
        (
          await db
            .select()
            .from(w.workflowDecisions)
            .where(eq(w.workflowDecisions.instanceId, r.workflowId!))
        )[0].onBehalfOf
      ).toBe(approver);
    }, 60000);
    it("enforces sourcing quantities and quotation evaluation", async () => {
      const db = await database();
      const [line] = await db
        .select()
        .from(s.requisitionLines)
        .where(eq(s.requisitionLines.requisitionId, requisitionId));
      const input = {
        title: code,
        currency: "SAR",
        opensAt: "2026-01-01",
        closesAt: "2030-01-01",
        terms: "Delivery to site",
        supplierIds: [supplierId],
        lines: [{ requisitionLineId: line.id, quantity: "20" }],
      };
      rfqId = (await service.createRfq(input, buyer, key())).id;
      await expect(
        service.createRfq(input, buyer, key())
      ).rejects.toMatchObject({ domainCode: "QUANTITY_EXCEEDED" });
      await service.rfqStatus(rfqId, "open", buyer, "Open competition");
      const [rline] = await db
        .select()
        .from(s.rfqLines)
        .where(eq(s.rfqLines.rfqId, rfqId));
      quotationId = (
        await service.createQuotation(
          {
            rfqId,
            supplierId,
            supplierReference: code,
            validUntil: "2030-01-01",
            currency: "SAR",
            paymentTerms: "30/40/20/10",
            deliveryTerms: "Site delivery",
            lines: [
              {
                rfqLineId: rline.id,
                quantity: "20",
                unitPrice: "10000",
                discountPercent: "0",
                taxPercent: "0",
                brand: "",
                model: "",
                deliveryDays: 10,
                warranty: "One year",
                notes: "",
              },
            ],
          },
          buyer,
          key()
        )
      ).id;
      await expect(
        service.evaluate(
          {
            quotationId,
            technical: 90,
            commercial: 80,
            delivery: 100,
            eligible: "yes",
            reason: "Evaluation",
          },
          buyer
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await service.evaluate(
        {
          quotationId,
          technical: 90,
          commercial: 80,
          delivery: 100,
          eligible: "yes",
          reason: "Qualified",
        },
        approver
      );
      await service.rfqStatus(rfqId, "closed", buyer, "Competition closed");
    }, 60000);
    it("creates a line award and a scheduled PO; commits the budget only on final approval", async () => {
      const db = await database();
      const [qline] = await db
        .select()
        .from(s.quotationLines)
        .where(eq(s.quotationLines.quotationId, quotationId));
      awardId = (
        await service.createAward(
          {
            rfqId,
            department,
            reason: "Best compliant offer",
            lines: [{ quotationLineId: qline.id, quantity: "20" }],
          },
          buyer,
          key()
        )
      ).id;
      await service.submit("award", awardId, buyer);
      const [a] = await db
        .select()
        .from(s.sourcingAwards)
        .where(eq(s.sourcingAwards.id, awardId));
      await service.decide(
        "award",
        awardId,
        a.workflowId!,
        approver,
        "approve",
        "Award approved"
      );
      const [aline] = await db
        .select()
        .from(s.awardLines)
        .where(eq(s.awardLines.awardId, awardId));
      orderId = (
        await service.createOrder(
          {
            supplierId,
            department,
            paymentTerms: "30/40/20/10",
            deliveryTerms: "Site",
            lines: [
              {
                awardLineId: aline.id,
                quantity: "20",
                schedules: [
                  {
                    quantity: "20",
                    dueDate: "2030-01-01",
                    warehouseId,
                    siteId,
                  },
                ],
              },
            ],
          },
          buyer,
          key()
        )
      ).id;
      expect((await project.detail(projectId)).metrics.commitment).toBe("0.00");
      await service.submit("order", orderId, buyer);
      const [o] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, orderId));
      const results = await Promise.allSettled([
        service.decide(
          "order",
          orderId,
          o.workflowId!,
          approver,
          "approve",
          "Approved"
        ),
        service.decide(
          "order",
          orderId,
          o.workflowId!,
          approver,
          "approve",
          "Duplicate"
        ),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      const metrics = (await project.detail(projectId)).metrics;
      expect(metrics.commitment).toBe("200000.00");
      expect(metrics.available).toBe("0.00");
      expect(metrics.actual).toBe("0.00");
      expect(metrics.paid).toBe("0.00");
    }, 60000);
    it("receives 20 into inspection, accepts 18 and returns 2 rejected trees", async () => {
      const db = await database();
      const [line] = await db
        .select()
        .from(s.orderLines)
        .where(eq(s.orderLines.orderId, orderId));
      const [schedule] = await db
        .select()
        .from(s.orderSchedules)
        .where(eq(s.orderSchedules.orderLineId, line.id));
      const date = new Date().toISOString().slice(0, 10);
      shipmentId = (
        await receiving.createShipment(
          {
            orderId,
            carrier: "Test carrier",
            trackingNumber: code,
            shipDate: date,
            expectedArrival: date,
            freight: "0",
            insurance: "0",
            customs: "0",
            lines: [{ orderLineId: line.id, quantity: "20" }],
          },
          buyer,
          key()
        )
      ).id;
      const data = {
        orderId,
        shipmentId,
        warehouseId,
        receivedAt: new Date(),
        lines: [
          {
            orderLineId: line.id,
            scheduleId: schedule.id,
            quantity: "20",
            receivedLocationId: receivingId,
            allocations: [
              {
                baseQuantity: "20",
                lotCode: null,
                serialCode: null,
                expiresAt: null,
              },
            ],
          },
        ],
      };
      await expect(
        receiving.createReceipt(data, buyer, key())
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      receiptId = (await receiving.createReceipt(data, delegate, key())).id;
      const [allocation] = await db
        .select({ allocation: r.receiptAllocations })
        .from(r.receiptAllocations)
        .innerJoin(
          r.receiptLines,
          eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
        )
        .where(eq(r.receiptLines.receiptId, receiptId));
      batchId = allocation.allocation.batchId;
      allocationId = allocation.allocation.id;
      expect(
        (
          await db
            .select()
            .from(stock.stockBalances)
            .where(
              and(
                eq(stock.stockBalances.batchId, batchId),
                eq(stock.stockBalances.status, "inspection")
              )
            )
        )[0].quantity
      ).toBe("20.000000");
      await receiving.inspect(
        {
          receiptId,
          notes: "18 compliant, 2 damaged",
          lines: [
            {
              allocationId,
              accepted: "18",
              rejected: "2",
              quarantine: "0",
              defects: "Two damaged trees",
              storageLocationId: storageId,
              rejectedLocationId: quarantineId,
              quarantineLocationId: quarantineId,
            },
          ],
        },
        delegate,
        key()
      );
      expect(
        (
          await db
            .select()
            .from(stock.stockBalances)
            .where(
              and(
                eq(stock.stockBalances.batchId, batchId),
                eq(stock.stockBalances.status, "available")
              )
            )
        )[0].quantity
      ).toBe("18.000000");
      await receiving.returnToSupplier(
        {
          receiptId,
          reason: "Rejected inspection",
          resolution: "replacement",
          lines: [
            {
              allocationId,
              locationId: quarantineId,
              quantity: "2",
              sourceStatus: "rejected",
            },
          ],
        },
        delegate,
        key()
      );
      expect((await project.detail(projectId)).metrics.received).toBe(
        "180000.00"
      );
    }, 25000);
    it("reserves, releases and issues stock without editing balances directly", async () => {
      const base = {
        projectId,
        wbsId,
        reason: "Project stock use",
        currency: "SAR",
        department,
      };
      const line = {
        itemId,
        batchId,
        fromLocationId: storageId,
        toLocationId: null,
        quantity: "3",
        countedQuantity: null,
        balanceVersion: null,
        reservationLineId: null,
        unitCost: null,
      };
      const reserved = await inventory.create(
        { ...base, type: "reserve", lines: [line] },
        buyer,
        key()
      );
      stockOpIds.push(reserved.id);
      const db = await database();
      const [reservation] = await db
        .select()
        .from(stock.stockOperationLines)
        .where(eq(stock.stockOperationLines.operationId, reserved.id));
      const released = await inventory.create(
        {
          ...base,
          type: "release",
          lines: [
            { ...line, quantity: "1", reservationLineId: reservation.id },
          ],
        },
        buyer,
        key()
      );
      stockOpIds.push(released.id);
      const issued = await inventory.create(
        {
          ...base,
          type: "issue",
          lines: [
            { ...line, quantity: "1", reservationLineId: reservation.id },
          ],
        },
        buyer,
        key()
      );
      stockOpIds.push(issued.id);
      await expect(
        inventory.create(
          { ...base, type: "issue", lines: [{ ...line, quantity: "30" }] },
          buyer,
          key()
        )
      ).rejects.toMatchObject({ domainCode: "INSUFFICIENT_STOCK" });
      const balances = await db
        .select()
        .from(stock.stockBalances)
        .where(eq(stock.stockBalances.batchId, batchId));
      expect(balances.find(b => b.status === "available")!.quantity).toBe(
        "16.000000"
      );
      expect(balances.find(b => b.status === "reserved")!.quantity).toBe(
        "1.000000"
      );
    }, 60000);
    it("rejects budget reduction below commitments and rolls back approval", async () => {
      revisionId = (
        await project.createBudget(
          {
            projectId,
            wbsId,
            costCenterId,
            amount: "190000",
            replacesId: budgetId,
            reason: "Attempt reduction",
          },
          buyer,
          key()
        )
      ).id;
      await expect(
        project.approveBudget(revisionId, approver, "approve", "Too low")
      ).rejects.toMatchObject({ domainCode: "BUDGET_EXCEEDED" });
      const db = await database();
      expect(
        (await db.select().from(p.budgets).where(eq(p.budgets.id, budgetId)))[0]
          .status
      ).toBe("approved");
      expect(
        (
          await db.select().from(p.budgets).where(eq(p.budgets.id, revisionId))
        )[0].status
      ).toBe("draft");
    }, 10000);
  }
);
