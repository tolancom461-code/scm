import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, inArray, and } from "drizzle-orm";
import { database } from "../server/core/database";
import { seedPermissions } from "../server/db";
import { hashPassword } from "../server/localAuth";
import { users, suppliers, userPermissions, sessions } from "../drizzle/schema";
import * as m from "../drizzle/master-data";
import * as p from "../drizzle/projects";
import * as s from "../drizzle/procurement";
import * as r from "../drizzle/receiving";
import * as f from "../drizzle/finance";
import * as w from "../drizzle/workflows";
import * as stock from "../drizzle/inventory";
import {
  scmAuditEvents,
  scmOutbox,
  operationKeys,
} from "../drizzle/foundation";
import * as projects from "../server/modules/projects/service";
import * as workflow from "../server/modules/workflows/service";
import * as procurement from "../server/modules/procurement/scm-service";
import * as receiving from "../server/modules/receiving/scm-service";
import * as finance from "../server/modules/finance-control/service";
export const key = () => randomUUID();
export const date = () => new Date().toISOString().slice(0, 10);
export type Fixture = {
  code: string;
  actors: number[];
  buyer: number;
  receiver: number;
  approver: number;
  projectId: number;
  supplierId: number;
  branchId: number;
  siteId: number;
  warehouseId: number;
  receivingId: number;
  storageId: number;
  quarantineId: number;
  itemIds: number[];
  budgetIds: number[];
  wbsIds: number[];
  orders: number[];
  definitions: number[];
  accounts: { username: string; role: string }[];
};
export async function setupFixture(
  code: string,
  password?: string
): Promise<Fixture> {
  const db = await database();
  await seedPermissions();
  const names = {
    nameAr: "مشروع إنشاء وتجهيز فرع تجريبي",
    nameEn: "Demo branch construction & fit-out",
    nameUr: "نمونہ شاخ کی تعمیر اور تیاری",
  };
  const accounts = ["buyer", "receiver", "approver"].map(role => ({
    username: code.toLowerCase().replaceAll("-", "_") + "_" + role,
    role,
  }));
  const ids = await db
    .insert(users)
    .values(
      await Promise.all(
        accounts.map(async a => ({
          openId: "local:" + a.username,
          username: a.username,
          name:
            a.role === "buyer"
              ? "مشتريات النسخة التجريبية"
              : a.role === "receiver"
                ? "مستلم النسخة التجريبية"
                : "معتمد النسخة التجريبية",
          role: "admin" as const,
          active: true,
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        }))
      )
    )
    .$returningId();
  const [buyer, receiver, approver] = ids.map(r => r.id);
  const [branch] = await db
    .select()
    .from(m.branches)
    .where(eq(m.branches.code, "RIYADH"));
  if (!branch) throw new Error("Run db:seed first");
  const [site] = await db
    .select()
    .from(m.sites)
    .where(eq(m.sites.branchId, branch.id));
  const [warehouse] = await db
    .select()
    .from(m.warehouses)
    .where(eq(m.warehouses.siteId, site.id));
  const [center] = await db
    .select()
    .from(m.costCenters)
    .where(eq(m.costCenters.branchId, branch.id));
  const locations = await db
    .select()
    .from(m.warehouseLocations)
    .where(eq(m.warehouseLocations.warehouseId, warehouse.id));
  const fixture: Fixture = {
    code,
    actors: [buyer, receiver, approver],
    buyer,
    receiver,
    approver,
    projectId: 0,
    supplierId: 0,
    branchId: branch.id,
    siteId: site.id,
    warehouseId: warehouse.id,
    receivingId: locations.find(l => l.type === "receiving")!.id,
    storageId: locations.find(l => l.type === "storage")!.id,
    quarantineId: locations.find(l => l.type === "quarantine")!.id,
    itemIds: [],
    budgetIds: [],
    wbsIds: [],
    orders: [],
    definitions: [],
    accounts,
  };
  try {
    fixture.supplierId = (
      await db
        .insert(suppliers)
        .values({
          supplierNumber: code,
          nameAr: "مورد ومقاول تجريبي",
          nameEn: "Demo supplier and contractor",
          nameUr: "نمونہ سپلائر اور ٹھیکیدار",
          createdBy: buyer,
        })
        .$returningId()
    )[0].id;
    for (const entityType of [
      "order",
      "invoice",
      "payment",
      "acceptance",
      "credit",
      "retention",
    ] as const) {
      const record = await workflow.createDefinition(
        {
          code: code + "-" + entityType.toUpperCase(),
          ...names,
          entityType,
          currency: "SAR",
          department: code,
          minAmount: "0",
          maxAmount: null,
          steps: [
            { ...names, approvers: [{ userId: approver, limit: "1000000" }] },
          ],
        },
        approver,
        key()
      );
      fixture.definitions.push(record.id);
    }
    fixture.projectId = (
      await projects.createProject(
        {
          code,
          ...names,
          branchId: branch.id,
          managerId: buyer,
          currency: "SAR",
          startsAt: date(),
          endsAt: "2030-12-31",
        },
        buyer,
        key()
      )
    ).id;
    for (const [index, itemCode] of ["OLIVE-TREE", "PLANTING"].entries()) {
      const [original] = await db
        .select()
        .from(m.items)
        .where(eq(m.items.code, itemCode));
      if (!original) throw new Error("Run db:seed first");
      const { id, createdAt, updatedAt, ...values } = original;
      const item = (
        await db
          .insert(m.items)
          .values({ ...values, code: code + "-" + index, barcode: null })
          .$returningId()
      )[0].id;
      fixture.itemIds.push(item);
      const wbs = (
        await projects.createWbs(
          {
            projectId: fixture.projectId,
            parentId: null,
            code: index === 0 ? "LANDSCAPE" : "FITOUT",
            nameAr: index === 0 ? "زراعة وتجهيز الموقع" : "أعمال التشطيب",
            nameEn: index === 0 ? "Landscaping" : "Fit-out works",
            nameUr: index === 0 ? "باغبانی" : "تزئین کے کام",
            startsAt: date(),
            endsAt: "2030-12-31",
          },
          buyer,
          key()
        )
      ).id;
      fixture.wbsIds.push(wbs);
      const budget = (
        await projects.createBudget(
          {
            projectId: fixture.projectId,
            wbsId: wbs,
            costCenterId: center.id,
            amount: index === 0 ? "200000" : "100000",
            replacesId: null,
            reason: "ميزانية المرحلة التجريبية",
          },
          buyer,
          key()
        )
      ).id;
      fixture.budgetIds.push(budget);
      await projects.approveBudget(
        budget,
        approver,
        "approve",
        "اعتماد ميزانية التجربة"
      );
    }
    await projects.setStatus(
      fixture.projectId,
      1,
      "active",
      buyer,
      "بدء المشروع التجريبي"
    );
    for (const index of [0, 1]) {
      const [item] = await db
        .select()
        .from(m.items)
        .where(eq(m.items.id, fixture.itemIds[index]));
      const order = (
        await procurement.createDirectOrder(
          {
            title: index === 0 ? "توريد 20 شجرة زيتون" : "عقد تشطيب الفرع",
            execution: index === 0 ? "goods" : "works",
            contractReference: code + "-CONTRACT-" + index,
            supplierId: fixture.supplierId,
            department: code,
            currency: "SAR",
            branchId: branch.id,
            priority: "normal",
            requiredDate: date(),
            reason: "تجربة شراء مباشر",
            paymentTerms: "الدفع على مراحل",
            deliveryTerms: "التسليم في الموقع",
            lines: [
              {
                itemId: item.id,
                description:
                  index === 0
                    ? "20 شجرة زيتون"
                    : "أعمال تشطيب — وحدات قياس إنجاز من أصل 100",
                specification: "",
                quantity: index === 0 ? "20" : "100",
                uomId: item.purchasingUomId,
                unitPrice: index === 0 ? "10000" : "1000",
                discountPercent: "0",
                taxPercent: "0",
                requiredDate: date(),
                siteId: site.id,
                warehouseId: warehouse.id,
                projectId: fixture.projectId,
                wbsId: fixture.wbsIds[index],
                costCenterId: center.id,
                budgetId: fixture.budgetIds[index],
              },
            ],
          },
          buyer,
          key()
        )
      ).id;
      fixture.orders.push(order);
      await procurement.submit("order", order, buyer);
      const [header] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, order));
      await procurement.decide(
        "order",
        order,
        header.workflowId!,
        approver,
        "approve",
        "اعتماد التعميد"
      );
    }
    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}
export async function acceptTrees(
  fx: Fixture,
  quantity = "20",
  accepted = "20"
) {
  const db = await database(),
    orderId = fx.orders[0];
  const [line] = await db
    .select()
    .from(s.orderLines)
    .where(eq(s.orderLines.orderId, orderId));
  const [schedule] = await db
    .select()
    .from(s.orderSchedules)
    .where(eq(s.orderSchedules.orderLineId, line.id));
  const receipt = await receiving.createReceipt(
    {
      orderId,
      shipmentId: null,
      warehouseId: fx.warehouseId,
      receivedAt: new Date(),
      lines: [
        {
          orderLineId: line.id,
          scheduleId: schedule.id,
          quantity,
          receivedLocationId: fx.receivingId,
          allocations: [
            {
              baseQuantity: quantity,
              lotCode: null,
              serialCode: null,
              expiresAt: null,
            },
          ],
        },
      ],
    },
    fx.receiver,
    key()
  );
  const [allocation] = await db
    .select({ allocation: r.receiptAllocations })
    .from(r.receiptAllocations)
    .innerJoin(
      r.receiptLines,
      eq(r.receiptAllocations.receiptLineId, r.receiptLines.id)
    )
    .where(eq(r.receiptLines.receiptId, receipt.id));
  await receiving.inspect(
    {
      receiptId: receipt.id,
      notes: "محضر فحص تجريبي",
      lines: [
        {
          allocationId: allocation.allocation.id,
          accepted,
          rejected: String(Number(quantity) - Number(accepted)),
          quarantine: "0",
          defects: "فحص التجربة",
          storageLocationId: fx.storageId,
          rejectedLocationId: fx.quarantineId,
          quarantineLocationId: fx.quarantineId,
        },
      ],
    },
    fx.receiver,
    key()
  );
  return {
    receiptId: receipt.id,
    allocationId: allocation.allocation.id,
    line,
  };
}
export async function approvedInvoice(
  fx: Fixture,
  orderId: number,
  quantity: string,
  retentionPercent = "0"
) {
  const db = await database();
  const [line] = await db
    .select()
    .from(s.orderLines)
    .where(eq(s.orderLines.orderId, orderId));
  const record = await finance.createInvoice(
    {
      orderId,
      supplierReference: fx.code + "-INV-" + key(),
      invoiceDate: date(),
      dueDate: date(),
      retentionPercent,
      lines: [
        {
          orderLineId: line.id,
          quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          taxPercent: line.taxPercent,
        },
      ],
    },
    fx.buyer,
    key()
  );
  await finance.matchInvoice(record.id, fx.buyer, true);
  const [header] = await db
    .select()
    .from(f.invoices)
    .where(eq(f.invoices.id, record.id));
  await finance.decideInvoice(
    record.id,
    header.workflowId!,
    1,
    fx.approver,
    "approve",
    "مطابقة واعتماد الفاتورة"
  );
  return record.id;
}
export async function approvePayment(
  fx: Fixture,
  data: Parameters<typeof finance.requestPayment>[0]
) {
  const record = await finance.requestPayment(data, fx.buyer, key());
  const db = await database();
  const [header] = await db
    .select()
    .from(f.payments)
    .where(eq(f.payments.id, record.id));
  await finance.decidePayment(
    record.id,
    header.workflowId!,
    1,
    fx.approver,
    "approve",
    "اعتماد سند الدفعة"
  );
  return record.id;
}
export async function cleanupFixture(fx: Fixture) {
  const db = await database(),
    actors = fx.actors;
  const invoices = await db
      .select({ id: f.invoices.id })
      .from(f.invoices)
      .where(inArray(f.invoices.createdBy, actors)),
    invoiceIds = invoices.map(i => i.id);
  const credits = await db
    .select({ id: f.creditNotes.id })
    .from(f.creditNotes)
    .where(inArray(f.creditNotes.createdBy, actors));
  if (credits.length)
    await db.delete(f.creditLines).where(
      inArray(
        f.creditLines.creditId,
        credits.map(c => c.id)
      )
    );
  await db
    .delete(f.creditNotes)
    .where(inArray(f.creditNotes.createdBy, actors));
  await db
    .delete(f.payments)
    .where(
      and(
        inArray(f.payments.createdBy, actors),
        eq(f.payments.kind, "recovery")
      )
    );
  await db.delete(f.payments).where(inArray(f.payments.createdBy, actors));
  await db
    .delete(f.retentionReleases)
    .where(inArray(f.retentionReleases.createdBy, actors));
  if (invoiceIds.length) {
    await db
      .delete(f.invoiceMatches)
      .where(inArray(f.invoiceMatches.invoiceId, invoiceIds));
    await db
      .delete(f.invoiceLines)
      .where(inArray(f.invoiceLines.invoiceId, invoiceIds));
    await db.delete(f.invoices).where(inArray(f.invoices.id, invoiceIds));
  }
  const schedules = await db
    .select({ id: f.paymentSchedules.id })
    .from(f.paymentSchedules)
    .where(inArray(f.paymentSchedules.createdBy, actors));
  if (schedules.length)
    await db.delete(f.paymentMilestones).where(
      inArray(
        f.paymentMilestones.scheduleId,
        schedules.map(s => s.id)
      )
    );
  await db
    .delete(f.paymentSchedules)
    .where(inArray(f.paymentSchedules.createdBy, actors));
  const certs = await db
    .select({ id: f.workCertificates.id })
    .from(f.workCertificates)
    .where(inArray(f.workCertificates.createdBy, actors));
  if (certs.length)
    await db.delete(f.workCertificateLines).where(
      inArray(
        f.workCertificateLines.certificateId,
        certs.map(c => c.id)
      )
    );
  await db
    .delete(f.workCertificates)
    .where(inArray(f.workCertificates.createdBy, actors));
  if (fx.itemIds.length) {
    await db
      .delete(stock.stockMovements)
      .where(inArray(stock.stockMovements.itemId, fx.itemIds));
    await db
      .delete(stock.stockBalances)
      .where(inArray(stock.stockBalances.itemId, fx.itemIds));
  }
  const receipts = await db
    .select({ id: r.goodsReceipts.id })
    .from(r.goodsReceipts)
    .where(inArray(r.goodsReceipts.receivedBy, actors));
  for (const receipt of receipts) {
    const returns = await db
      .select({ id: r.supplierReturns.id })
      .from(r.supplierReturns)
      .where(eq(r.supplierReturns.receiptId, receipt.id));
    if (returns.length)
      await db.delete(r.supplierReturnLines).where(
        inArray(
          r.supplierReturnLines.returnId,
          returns.map(t => t.id)
        )
      );
    await db
      .delete(r.supplierReturns)
      .where(eq(r.supplierReturns.receiptId, receipt.id));
    const inspections = await db
      .select({ id: r.inspections.id })
      .from(r.inspections)
      .where(eq(r.inspections.receiptId, receipt.id));
    if (inspections.length)
      await db.delete(r.inspectionResults).where(
        inArray(
          r.inspectionResults.inspectionId,
          inspections.map(i => i.id)
        )
      );
    await db
      .delete(r.inspections)
      .where(eq(r.inspections.receiptId, receipt.id));
    const lines = await db
      .select({ id: r.receiptLines.id })
      .from(r.receiptLines)
      .where(eq(r.receiptLines.receiptId, receipt.id));
    if (lines.length)
      await db.delete(r.receiptAllocations).where(
        inArray(
          r.receiptAllocations.receiptLineId,
          lines.map(l => l.id)
        )
      );
    await db
      .delete(r.receiptLines)
      .where(eq(r.receiptLines.receiptId, receipt.id));
    await db.delete(r.goodsReceipts).where(eq(r.goodsReceipts.id, receipt.id));
  }
  if (fx.itemIds.length)
    await db
      .delete(r.stockBatches)
      .where(inArray(r.stockBatches.itemId, fx.itemIds));
  for (const order of fx.orders) {
    const lines = await db
      .select({ id: s.orderLines.id })
      .from(s.orderLines)
      .where(eq(s.orderLines.orderId, order));
    if (lines.length)
      await db.delete(s.orderSchedules).where(
        inArray(
          s.orderSchedules.orderLineId,
          lines.map(l => l.id)
        )
      );
    await db.delete(s.orderLines).where(eq(s.orderLines.orderId, order));
    await db.delete(s.orders).where(eq(s.orders.id, order));
  }
  if (fx.projectId) {
    if (fx.budgetIds.length)
      await db
        .delete(p.budgetLedger)
        .where(inArray(p.budgetLedger.budgetId, fx.budgetIds));
    await db.delete(p.budgets).where(eq(p.budgets.projectId, fx.projectId));
    await db.delete(p.wbsNodes).where(eq(p.wbsNodes.projectId, fx.projectId));
    await db.delete(p.projects).where(eq(p.projects.id, fx.projectId));
  }
  if (fx.itemIds.length)
    await db.delete(m.items).where(inArray(m.items.id, fx.itemIds));
  if (fx.supplierId)
    await db.delete(suppliers).where(eq(suppliers.id, fx.supplierId));
  const instances = await db
    .select({ id: w.workflowInstances.id })
    .from(w.workflowInstances)
    .where(inArray(w.workflowInstances.requesterId, actors));
  if (instances.length)
    await db.delete(w.workflowDecisions).where(
      inArray(
        w.workflowDecisions.instanceId,
        instances.map(i => i.id)
      )
    );
  await db
    .delete(w.workflowInstances)
    .where(inArray(w.workflowInstances.requesterId, actors));
  if (fx.definitions.length) {
    const steps = await db
      .select({ id: w.workflowSteps.id })
      .from(w.workflowSteps)
      .where(inArray(w.workflowSteps.definitionId, fx.definitions));
    if (steps.length)
      await db.delete(w.workflowApprovers).where(
        inArray(
          w.workflowApprovers.stepId,
          steps.map(s => s.id)
        )
      );
    await db
      .delete(w.workflowSteps)
      .where(inArray(w.workflowSteps.definitionId, fx.definitions));
    await db
      .delete(w.workflowDefinitions)
      .where(inArray(w.workflowDefinitions.id, fx.definitions));
  }
  const audits = await db
    .select()
    .from(scmAuditEvents)
    .where(inArray(scmAuditEvents.actorId, actors));
  for (const audit of audits)
    await db
      .delete(scmOutbox)
      .where(
        and(
          eq(scmOutbox.entityType, audit.entityType),
          eq(scmOutbox.entityId, audit.entityId)
        )
      );
  await db
    .delete(scmAuditEvents)
    .where(inArray(scmAuditEvents.actorId, actors));
  await db.delete(operationKeys).where(inArray(operationKeys.actorId, actors));
  await db
    .delete(userPermissions)
    .where(inArray(userPermissions.userId, actors));
  await db.delete(sessions).where(inArray(sessions.userId, actors));
  await db.delete(users).where(inArray(users.id, actors));
}
