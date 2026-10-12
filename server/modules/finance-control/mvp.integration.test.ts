import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  setupFixture,
  cleanupFixture,
  acceptTrees,
  approvedInvoice,
  approvePayment,
  key,
  date,
  type Fixture,
} from "../../../scripts/mvp-fixture";
import { database } from "../../core/database";
import { closeDb } from "../../db";
import * as finance from "./service";
import * as f from "../../../drizzle/finance";
import * as s from "../../../drizzle/procurement";
import * as project from "../projects/service";
import * as receiving from "../receiving/scm-service";
import { paymentInput, scheduleInput } from "../../../shared/finance";
import { businessDate } from "../../../shared/date";
describe("MVP input boundaries", () => {
  it("uses Riyadh business dates across the UTC midnight boundary", () =>
    expect(businessDate(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08"));
  it("rejects incomplete payment references at the service boundary", () => {
    expect(
      paymentInput.safeParse({
        orderId: 1,
        invoiceId: null,
        milestoneId: null,
        sourceAdvanceId: null,
        kind: "advance",
        amount: "-1",
        reference: "abc",
        reason: "abc",
      }).success
    ).toBe(false);
    expect(
      scheduleInput.safeParse({ orderId: 1, milestones: [] }).success
    ).toBe(false);
  });
});
describe.runIf(process.env.SCM_INTEGRATION === "1")(
  "MVP direct orders, work acceptance and staged payments",
  () => {
    let fx: Fixture,
      receipt: { receiptId: number; allocationId: number },
      invoiceId = 0,
      workInvoice = 0;
    let milestones: number[] = [],
      workMilestoneId = 0;
    beforeAll(async () => {
      fx = await setupFixture("ITM-" + randomUUID().slice(0, 8).toUpperCase());
    }, 90000);
    afterAll(async () => {
      try {
        if (fx) await cleanupFixture(fx);
      } finally {
        await closeDb();
      }
    }, 90000);
    it("creates a direct goods order and contractor agreement without fabricated sourcing documents", async () => {
      const db = await database();
      const [a] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, fx.orders[0]));
      const [b] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, fx.orders[1]));
      const [line] = await db
        .select()
        .from(s.orderLines)
        .where(eq(s.orderLines.orderId, a.id));
      expect(line.awardLineId).toBeNull();
      expect(a.total).toBe("200000.00");
      expect(b.execution).toBe("works");
      expect((await project.detail(fx.projectId)).metrics.commitment).toBe(
        "300000.00"
      );
    }, 15000);
    it("blocks invoicing 20 when only 18 trees are accepted and blocks inspection actor financial approval", async () => {
      receipt = await acceptTrees(fx, "20", "18");
      const db = await database();
      const [line] = await db
        .select()
        .from(s.orderLines)
        .where(eq(s.orderLines.orderId, fx.orders[0]));
      const create = (quantity: string, price = line.unitPrice) =>
        finance.createInvoice(
          {
            orderId: fx.orders[0],
            supplierReference: fx.code + key(),
            invoiceDate: date(),
            dueDate: date(),
            retentionPercent: "0",
            lines: [
              {
                orderLineId: line.id,
                quantity,
                unitPrice: price,
                discountPercent: "0",
                taxPercent: "0",
              },
            ],
          },
          fx.buyer,
          key()
        );
      const invalid = await create("20");
      expect(
        (await finance.matchInvoice(invalid.id, fx.buyer, true)).issues[0]
          .result
      ).toBe("quantity_exceeded");
      const wrongPrice = await create("18", "9999");
      expect(
        (await finance.matchInvoice(wrongPrice.id, fx.buyer, true)).issues[0]
          .result
      ).toBe("price_mismatch");
      await finance.cancelInvoice(
        invalid.id,
        fx.buyer,
        "إلغاء مطالبة غير مطابقة"
      );
      await finance.cancelInvoice(
        wrongPrice.id,
        fx.buyer,
        "إلغاء السعر الخاطئ"
      );
      const valid = await create("18");
      invoiceId = valid.id;
      await finance.matchInvoice(valid.id, fx.buyer, true);
      const [header] = await db
        .select()
        .from(f.invoices)
        .where(eq(f.invoices.id, valid.id));
      await expect(
        finance.decideInvoice(
          valid.id,
          header.workflowId!,
          1,
          fx.receiver,
          "approve",
          "اعتماد مستلم المواد"
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      const decisions = await Promise.allSettled([
        finance.decideInvoice(
          valid.id,
          header.workflowId!,
          1,
          fx.approver,
          "approve",
          "الاعتماد الأول"
        ),
        finance.decideInvoice(
          valid.id,
          header.workflowId!,
          1,
          fx.approver,
          "approve",
          "اعتماد مكرر"
        ),
      ]);
      expect(decisions.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await project.detail(fx.projectId)).metrics.actual).toBe(
        "180000.00"
      );
    }, 60000);
    it("records an advance once, allocates it without counting it as a second cash payment, and rejects overpayment", async () => {
      const schedule = await finance.createSchedule(
        {
          orderId: fx.orders[0],
          milestones: [
            {
              nameAr: "مقدم",
              nameEn: "Advance",
              nameUr: "پیشگی",
              percent: "30",
              dueDate: date(),
              condition: "advance",
            },
            {
              nameAr: "استلام",
              nameEn: "Receipt",
              nameUr: "وصولی",
              percent: "40",
              dueDate: date(),
              condition: "accepted",
            },
            {
              nameAr: "زراعة",
              nameEn: "Planting",
              nameUr: "پودے",
              percent: "20",
              dueDate: date(),
              condition: "planting",
            },
            {
              nameAr: "نهائية",
              nameEn: "Final",
              nameUr: "آخری",
              percent: "10",
              dueDate: date(),
              condition: "manual",
            },
          ],
        },
        fx.buyer,
        key()
      );
      const db = await database();
      milestones = (
        await db
          .select()
          .from(f.paymentMilestones)
          .where(eq(f.paymentMilestones.scheduleId, schedule.id))
      )
        .sort((a, b) => a.position - b.position)
        .map(m => m.id);
      const data = {
        orderId: fx.orders[0],
        invoiceId: null,
        milestoneId: milestones[0],
        sourceAdvanceId: null,
        kind: "advance" as const,
        amount: "60000",
        reference: fx.code + "ADV",
        reason: "دفعة مقدمة",
      };
      const operationKey = key(),
        advance = await finance.requestPayment(data, fx.buyer, operationKey);
      expect(
        await finance.requestPayment(data, fx.buyer, operationKey)
      ).toEqual(advance);
      const [record] = await db
        .select()
        .from(f.payments)
        .where(eq(f.payments.id, advance.id));
      await expect(
        finance.decidePayment(
          advance.id,
          record.workflowId!,
          1,
          fx.buyer,
          "approve",
          "اعتماد ذاتي"
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await finance.decidePayment(
        advance.id,
        record.workflowId!,
        1,
        fx.approver,
        "approve",
        "مقدم معتمد"
      );
      await approvePayment(fx, {
        ...data,
        invoiceId,
        milestoneId: null,
        sourceAdvanceId: advance.id,
        kind: "recovery",
        reference: fx.code + "REC",
      });
      expect((await project.detail(fx.projectId)).metrics.paid).toBe(
        "60000.00"
      );
      await expect(
        finance.requestPayment(
          {
            ...data,
            invoiceId,
            milestoneId: null,
            sourceAdvanceId: advance.id,
            kind: "recovery",
            amount: "1",
            reference: fx.code + "REC2",
          },
          fx.buyer,
          key()
        )
      ).rejects.toMatchObject({ domainCode: "PAYMENT_EXCEEDED" });
      await finance.certifyMilestone(
        milestones[1],
        fx.receiver,
        "محضر الاستلام والفحص"
      );
      await finance.certifyMilestone(
        milestones[2],
        fx.receiver,
        "محضر إتمام الزراعة"
      );
      await approvePayment(fx, {
        ...data,
        kind: "invoice",
        invoiceId,
        milestoneId: milestones[1],
        amount: "80000",
        reference: fx.code + "PAY80",
      });
      await approvePayment(fx, {
        ...data,
        kind: "invoice",
        invoiceId,
        milestoneId: milestones[2],
        amount: "40000",
        reference: fx.code + "PAY40",
      });
      expect((await project.detail(fx.projectId)).metrics.paid).toBe(
        "180000.00"
      );
      expect(
        (await db.transaction(tx => finance.invoiceBalance(tx, invoiceId))).due
      ).toBe("0.00");
      await expect(
        finance.requestPayment(
          {
            ...data,
            kind: "invoice",
            invoiceId,
            milestoneId: milestones[1],
            amount: "1",
            reference: fx.code + "EXCESS",
          },
          fx.buyer,
          key()
        )
      ).rejects.toMatchObject({ domainCode: "PAYMENT_EXCEEDED" });
    }, 90000);
    it("receives replacements and closes the remaining payable independently from the original full delivery", async () => {
      await receiving.returnToSupplier(
        {
          receiptId: receipt.receiptId,
          reason: "إعادة شجرتين مرفوضتين للاستبدال",
          resolution: "replacement",
          lines: [
            {
              allocationId: receipt.allocationId,
              locationId: fx.quarantineId,
              quantity: "2",
              sourceStatus: "rejected",
            },
          ],
        },
        fx.receiver,
        key()
      );
      await acceptTrees(fx, "2", "2");
      const second = await approvedInvoice(fx, fx.orders[0], "2");
      await finance.certifyMilestone(
        milestones[3],
        fx.receiver,
        "تسوية التوريد والاستبدال"
      );
      await approvePayment(fx, {
        orderId: fx.orders[0],
        invoiceId: second,
        milestoneId: milestones[3],
        sourceAdvanceId: null,
        kind: "invoice",
        amount: "20000",
        reference: fx.code + "PAY20",
        reason: "الدفعة الختامية",
      });
      const metrics = (await project.detail(fx.projectId)).metrics;
      expect(metrics.received).toBe("200000.00");
      expect(metrics.actual).toBe("200000.00");
      expect(metrics.paid).toBe("200000.00");
    }, 60000);
    it("matches contractor invoices against approved work and holds retention until a separately approved release", async () => {
      const db = await database();
      const [line] = await db
        .select()
        .from(s.orderLines)
        .where(eq(s.orderLines.orderId, fx.orders[1]));
      const cert = await finance.createCertificate(
        {
          orderId: fx.orders[1],
          certificateDate: date(),
          evidence: "محضر إنجاز 50 من 100 وحدة أعمال",
          lines: [{ orderLineId: line.id, quantity: "50" }],
        },
        fx.receiver,
        key()
      );
      const [header] = await db
        .select()
        .from(f.workCertificates)
        .where(eq(f.workCertificates.id, cert.id));
      await expect(
        finance.decideCertificate(
          cert.id,
          header.workflowId!,
          1,
          fx.buyer,
          "approve",
          "معد العقد"
        )
      ).rejects.toMatchObject({ domainCode: "DUTY_CONFLICT" });
      await finance.decideCertificate(
        cert.id,
        header.workflowId!,
        1,
        fx.approver,
        "approve",
        "اعتماد الإنجاز الجزئي"
      );
      workInvoice = await approvedInvoice(fx, fx.orders[1], "50", "10");
      expect(
        (await db.transaction(tx => finance.invoiceBalance(tx, workInvoice)))
          .due
      ).toBe("45000.00");
      const schedule = await finance.createSchedule(
        {
          orderId: fx.orders[1],
          milestones: [
            {
              nameAr: "أعمال",
              nameEn: "Works",
              nameUr: "کام",
              percent: "100",
              dueDate: date(),
              condition: "accepted",
            },
          ],
        },
        fx.buyer,
        key()
      );
      const [m] = await db
        .select()
        .from(f.paymentMilestones)
        .where(eq(f.paymentMilestones.scheduleId, schedule.id));
      workMilestoneId = m.id;
      await expect(
        finance.certifyMilestone(
          m.id,
          fx.receiver,
          "لا يكفي إنجاز النصف للمرحلة الكاملة"
        )
      ).rejects.toMatchObject({ domainCode: "MATCHING_FAILED" });
      const second = await finance.createCertificate(
        {
          orderId: fx.orders[1],
          certificateDate: date(),
          evidence: "محضر إنجاز النصف المتبقي",
          lines: [{ orderLineId: line.id, quantity: "50" }],
        },
        fx.receiver,
        key()
      );
      const [secondHeader] = await db
        .select()
        .from(f.workCertificates)
        .where(eq(f.workCertificates.id, second.id));
      await finance.decideCertificate(
        second.id,
        secondHeader.workflowId!,
        1,
        fx.approver,
        "approve",
        "اعتماد كامل الإنجاز"
      );
      await finance.certifyMilestone(m.id, fx.receiver, "اكتمال أعمال المقاول");
      const payment = {
        orderId: fx.orders[1],
        invoiceId: workInvoice,
        milestoneId: m.id,
        sourceAdvanceId: null,
        kind: "invoice" as const,
        amount: "50000",
        reference: fx.code + "WORK",
        reason: "مستخلص أعمال",
      };
      await expect(
        finance.requestPayment(payment, fx.buyer, key())
      ).rejects.toMatchObject({ domainCode: "PAYMENT_EXCEEDED" });
      await approvePayment(fx, { ...payment, amount: "45000" });
      const release = await finance.releaseRetention(
        workInvoice,
        "انتهاء فترة الضمان ومحضر التسليم",
        fx.buyer,
        key()
      );
      const [r] = await db
        .select()
        .from(f.retentionReleases)
        .where(eq(f.retentionReleases.id, release.id));
      await finance.decideRetention(
        release.id,
        r.workflowId!,
        1,
        fx.approver,
        "approve",
        "اعتماد فك المحتجز"
      );
      await approvePayment(fx, {
        ...payment,
        amount: "5000",
        reference: fx.code + "RET",
      });
      expect(
        (await db.transaction(tx => finance.invoiceBalance(tx, workInvoice)))
          .outstanding
      ).toBe("0.00");
    }, 90000);
    it("resubmits a returned payment with the same reference and closes only a fully settled contractor agreement", async () => {
      await expect(
        finance.closeOrder(
          fx.orders[1],
          fx.approver,
          "إغلاق قبل تسوية كافة الأعمال"
        )
      ).rejects.toMatchObject({ domainCode: "INVALID_TRANSITION" });
      const invoiceId = await approvedInvoice(fx, fx.orders[1], "50"),
        db = await database();
      const payment = await finance.requestPayment(
        {
          orderId: fx.orders[1],
          invoiceId,
          milestoneId: workMilestoneId,
          sourceAdvanceId: null,
          kind: "invoice",
          amount: "50000",
          reference: fx.code + "WORK-RETURN",
          reason: "مستخلص المرحلة المتبقية",
        },
        fx.buyer,
        key()
      );
      const [first] = await db
        .select()
        .from(f.payments)
        .where(eq(f.payments.id, payment.id));
      await finance.decidePayment(
        payment.id,
        first.workflowId!,
        1,
        fx.approver,
        "return",
        "إعادة الطلب للمراجعة"
      );
      await finance.resubmit(
        "payment",
        payment.id,
        fx.buyer,
        "إعادة إرسال بنفس مرجع السند"
      );
      const [second] = await db
        .select()
        .from(f.payments)
        .where(eq(f.payments.id, payment.id));
      expect(second.workflowId).not.toBe(first.workflowId);
      await finance.decidePayment(
        payment.id,
        second.workflowId!,
        1,
        fx.approver,
        "approve",
        "اعتماد التسوية النهائية"
      );
      await finance.closeOrder(
        fx.orders[1],
        fx.approver,
        "إقفال عقد منفذ ومسدد بالكامل"
      );
      expect(
        (
          await db.select().from(s.orders).where(eq(s.orders.id, fx.orders[1]))
        )[0].status
      ).toBe("closed");
    }, 60000);
    it("requires approved credit before returning accepted invoiced stock", async () => {
      const db = await database();
      await expect(
        receiving.returnToSupplier(
          {
            receiptId: receipt.receiptId,
            reason: "مرتجع مفوتر",
            resolution: "credit",
            lines: [
              {
                allocationId: receipt.allocationId,
                locationId: fx.storageId,
                quantity: "1",
                sourceStatus: "available",
              },
            ],
          },
          fx.receiver,
          key()
        )
      ).rejects.toMatchObject({ domainCode: "MATCHING_FAILED" });
      const [line] = await db
        .select()
        .from(f.invoiceLines)
        .where(eq(f.invoiceLines.invoiceId, invoiceId));
      const credit = await finance.createCredit(
        {
          invoiceId,
          supplierReference: fx.code + "CREDIT",
          returnId: null,
          reason: "اعتماد خصم شجرة مرتجعة",
          lines: [{ invoiceLineId: line.id, quantity: "1" }],
        },
        fx.buyer,
        key()
      );
      const [header] = await db
        .select()
        .from(f.creditNotes)
        .where(eq(f.creditNotes.id, credit.id));
      await finance.decideCredit(
        credit.id,
        header.workflowId!,
        1,
        fx.approver,
        "approve",
        "اعتماد إشعار المورد الدائن"
      );
      await receiving.returnToSupplier(
        {
          receiptId: receipt.receiptId,
          reason: "مرتجع بعد إشعار دائن معتمد",
          resolution: "credit",
          lines: [
            {
              allocationId: receipt.allocationId,
              locationId: fx.storageId,
              quantity: "1",
              sourceStatus: "available",
            },
          ],
        },
        fx.receiver,
        key()
      );
      expect(
        (await db.transaction(tx => finance.invoiceBalance(tx, invoiceId)))
          .supplierCredit
      ).toBe("10000.00");
    }, 25000);
  }
);
