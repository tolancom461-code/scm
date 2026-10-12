import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb } from "../server/db";
import { database } from "../server/core/database";
import { projects } from "../drizzle/projects";
import * as s from "../drizzle/procurement";
import * as f from "../drizzle/finance";
import * as finance from "../server/modules/finance-control/service";
import {
  setupFixture,
  cleanupFixture,
  acceptTrees,
  approvedInvoice,
  approvePayment,
  key,
  date,
  type Fixture,
} from "./mvp-fixture";
const destination = ".mvp-demo-credentials.json";
async function main() {
  const db = await database();
  let previous: { fixture: Fixture } | undefined;
  try {
    previous = JSON.parse(await readFile(destination, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous) {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, previous.fixture.projectId));
    if (existing) {
      console.log("MVP demo already exists. Account details: " + destination);
      return;
    }
    throw new Error(
      "Demo credential file exists but the project was removed. Inspect it before creating a replacement."
    );
  }
  const code = "MVP-" + randomBytes(4).toString("hex").toUpperCase(),
    password = randomBytes(24).toString("base64url");
  let fx: Fixture | undefined;
  try {
    fx = await setupFixture(code, password);
    await writeFile(
      ".mvp-demo-progress.json",
      JSON.stringify({ status: "seeding", fixture: fx }, null, 2)
    );
    await acceptTrees(fx);
    const invoice = await approvedInvoice(fx, fx.orders[0], "20");
    const schedule = await finance.createSchedule(
      {
        orderId: fx.orders[0],
        milestones: [
          {
            nameAr: "دفعة أولى",
            nameEn: "First payment",
            nameUr: "پہلی ادائیگی",
            percent: "30",
            dueDate: date(),
            condition: "manual",
          },
          {
            nameAr: "دفعة الاستلام",
            nameEn: "Receipt payment",
            nameUr: "وصولی ادائیگی",
            percent: "40",
            dueDate: date(),
            condition: "accepted",
          },
          {
            nameAr: "دفعة نهائية",
            nameEn: "Final payment",
            nameUr: "آخری ادائیگی",
            percent: "30",
            dueDate: date(),
            condition: "manual",
          },
        ],
      },
      fx.buyer,
      key()
    );
    const milestones = (
      await db
        .select()
        .from(f.paymentMilestones)
        .where(eq(f.paymentMilestones.scheduleId, schedule.id))
    ).sort((a, b) => a.position - b.position);
    for (const [index, m] of milestones.entries()) {
      await finance.certifyMilestone(
        m.id,
        fx.receiver,
        "محضر تحقق شرط الدفعة " + (index + 1)
      );
      await approvePayment(fx, {
        orderId: fx.orders[0],
        invoiceId: invoice,
        milestoneId: m.id,
        sourceAdvanceId: null,
        kind: "invoice",
        amount: m.amount,
        reference: code + "-TRANSFER-" + (index + 1),
        reason: "سند دفع تجريبي",
      });
    }
    const [workLine] = await db
      .select()
      .from(s.orderLines)
      .where(eq(s.orderLines.orderId, fx.orders[1]));
    const certificate = await finance.createCertificate(
      {
        orderId: fx.orders[1],
        certificateDate: date(),
        evidence: "محضر إنجاز نصف أعمال التشطيب",
        lines: [{ orderLineId: workLine.id, quantity: "50" }],
      },
      fx.receiver,
      key()
    );
    const [cert] = await db
      .select()
      .from(f.workCertificates)
      .where(eq(f.workCertificates.id, certificate.id));
    await finance.decideCertificate(
      cert.id,
      cert.workflowId!,
      1,
      fx.approver,
      "approve",
      "اعتماد إنجاز 50% من الأعمال"
    );
    const workInvoice = await approvedInvoice(fx, fx.orders[1], "50");
    const workSchedule = await finance.createSchedule(
      {
        orderId: fx.orders[1],
        milestones: [
          {
            nameAr: "مستخلصات الأعمال",
            nameEn: "Work progress payments",
            nameUr: "کام کی ادائیگیاں",
            percent: "100",
            dueDate: date(),
            condition: "manual",
          },
        ],
      },
      fx.buyer,
      key()
    );
    const [workMilestone] = await db
      .select()
      .from(f.paymentMilestones)
      .where(eq(f.paymentMilestones.scheduleId, workSchedule.id));
    await finance.certifyMilestone(
      workMilestone.id,
      fx.receiver,
      "محضر استحقاق المستخلص المعتمد"
    );
    const pending = await finance.requestPayment(
      {
        orderId: fx.orders[1],
        invoiceId: workInvoice,
        milestoneId: workMilestone.id,
        sourceAdvanceId: null,
        kind: "invoice",
        amount: "50000",
        reference: code + "-WORK-PENDING",
        reason: "دفعة مستخلص تنتظر اعتماد المستخدم",
      },
      fx.buyer,
      key()
    );
    await writeFile(
      destination,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          purpose:
            "Local training accounts; assign restricted roles before operational use",
          password,
          accounts: fx.accounts,
          fixture: fx,
          pendingPaymentId: pending.id,
        },
        null,
        2
      ),
      { flag: "wx" }
    );
    await writeFile(
      ".mvp-demo-progress.json",
      JSON.stringify(
        { status: "complete", projectId: fx.projectId, department: code },
        null,
        2
      )
    );
    console.log(
      "MVP demo seeded: 20 trees / SAR 200000 / payments 60000,80000,60000; contractor invoice SAR 50000 pending payment approval. Credentials saved locally in " +
        destination
    );
  } catch (error) {
    if (fx) await cleanupFixture(fx);
    await writeFile(
      ".mvp-demo-progress.json",
      JSON.stringify({
        status: "failed",
        message: "Inspect execution diagnostics before retrying",
      })
    );
    throw error;
  }
}
main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : "MVP seed failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
