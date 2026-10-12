import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  setupPhaseOne,
  cleanupPhaseOne,
  type PhaseFixture,
} from "./phase-one-fixture";
import { closeDb } from "../server/db";
import { database } from "../server/core/database";
import {
  simpleProjects,
  simpleContracts,
  simpleCertificates,
  simplePayments,
} from "../drizzle/phase-one";
import { businessDate } from "../shared/date";
let fixture: PhaseFixture | undefined,
  server: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const base = process.env.PHASE_ONE_UI_URL ?? "http://127.0.0.1:3121",
  errors: string[] = [];
async function login(page: Page, role: string) {
  await page.goto(base);
  await page.locator(".auth-form select").selectOption("ar");
  await page
    .getByLabel("اسم المستخدم")
    .fill(fixture!.accounts.find(a => a.role === role)!.username);
  await page.getByLabel("كلمة المرور").fill(fixture!.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.locator(".sidebar").waitFor();
}
async function nav(page: Page, label: string) {
  if (await page.locator(".mobile-menu").isVisible())
    await page.locator(".mobile-menu").click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: label, exact: true })
    .click();
}
try {
  fixture = await setupPhaseOne();
  if (!process.env.PHASE_ONE_UI_URL)
    server = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, NODE_ENV: "development", PORT: "3121" },
      }
    );
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert(ready, "UI server failed to start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const engineer = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  engineer.setDefaultTimeout(30000);
  engineer.on("pageerror", e => errors.push(e.message));
  await login(engineer, "engineer");
  const [numberedProject] = await (await database())
    .select()
    .from(simpleProjects)
    .where(eq(simpleProjects.id, fixture.projectId));
  assert.match(numberedProject.number, /^PRJ-\d{2}-\d{2}-\d{4,}$/);
  await nav(engineer, "تهيئة البيانات");
  await engineer
    .locator("tbody tr")
    .filter({ hasText: fixture.code + " مشروع" })
    .getByText(numberedProject.number, { exact: true })
    .waitFor();
  await nav(engineer, "المشاريع والعقود");
  await engineer
    .getByRole("button", { name: "إضافة عقد", exact: true })
    .click();
  let dialog = engineer.getByRole("dialog");
  const title = fixture.code + " UI";
  await dialog
    .getByLabel("المشروع", { exact: true })
    .selectOption(String(fixture.projectId));
  await dialog
    .getByLabel("المورد / المقاول", { exact: true })
    .selectOption(String(fixture.supplierId));
  await dialog.getByLabel("عنوان العقد", { exact: true }).fill(title);
  await dialog
    .getByLabel("وصف البند", { exact: true })
    .fill("أعمال تجهيز نموذجية");
  await dialog.getByLabel("الكمية", { exact: true }).fill("2");
  await dialog.getByLabel("سعر الوحدة (ريال)", { exact: true }).fill("100");
  await dialog.getByLabel("ضمان الأعمال المحتجز %", { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const [numberedContract] = await (await database())
    .select()
    .from(simpleContracts)
    .where(eq(simpleContracts.title, title));
  assert.match(numberedContract.number, /^CTR-\d{2}-\d{2}-\d{4,}$/);
  // The project number is searchable, not just a decoration in the print view.
  await engineer.locator(".p1-filter").fill(numberedProject.number);
  await engineer.locator("tbody tr").filter({ hasText: title }).waitFor();
  await engineer.locator(".p1-filter").fill(title);
  let row = engineer.locator("tbody tr").filter({ hasText: title });
  await row.getByRole("button", { name: "التفاصيل", exact: true }).click();
  dialog = engineer.getByRole("dialog");
  const contractPrint = await dialog.locator(".p1-print").textContent();
  assert(contractPrint?.includes(numberedContract.number));
  assert(contractPrint?.includes(numberedProject.number));
  await mkdir("docs/phase-one", { recursive: true });
  await engineer.emulateMedia({ media: "print" });
  await engineer.pdf({
    path: "docs/phase-one/contract-print.pdf",
    format: "A4",
    preferCSSPageSize: true,
  });
  await engineer.emulateMedia({ media: "screen" });
  await dialog
    .getByRole("button", { name: "إعداد مستخلص", exact: true })
    .click();
  await dialog.getByLabel("الإنجاز التراكمي %", { exact: true }).fill("100");
  await dialog
    .getByLabel("خصومات إضافية لهذا المستخلص (ريال)", { exact: true })
    .fill("10");
  await dialog
    .getByLabel("سبب الخصم الإضافي", { exact: true })
    .fill("اختبار جودة");
  await dialog
    .getByRole("button", { name: "إرسال للاعتماد", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await nav(engineer, "المستخلصات");
  await engineer.locator(".p1-filter").fill(title);
  await engineer
    .locator("tbody tr")
    .filter({ hasText: title })
    .getByRole("button", { name: "التفاصيل", exact: true })
    .click();
  assert.equal(
    await engineer
      .getByRole("button", { name: "اعتماد المستخلص", exact: true })
      .count(),
    0
  );
  await engineer
    .getByRole("dialog")
    .getByRole("button", { name: "Close / إغلاق", exact: true })
    .click();
  const approver = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  approver.on("pageerror", e => errors.push(e.message));
  await login(approver, "approver");
  await nav(approver, "المستخلصات");
  await approver.locator(".p1-filter").fill(title);
  await approver
    .locator("tbody tr")
    .filter({ hasText: title })
    .getByRole("button", { name: "التفاصيل", exact: true })
    .click();
  dialog = approver.getByRole("dialog");
  const [numberedCertificate] = await (await database())
    .select()
    .from(simpleCertificates)
    .where(eq(simpleCertificates.contractId, numberedContract.id));
  assert.match(numberedCertificate.number, /^IPC-\d{2}-\d{2}-\d{4,}$/);
  const certificatePrint = await dialog.locator(".p1-print").textContent();
  const ordinalLabel = "ترتيب المستخلص في العقد";
  const printedOrdinal = await dialog
    .locator(".p1-detail-list p")
    .filter({ hasText: ordinalLabel })
    .textContent();
  assert.equal(printedOrdinal?.replace(ordinalLabel, "").trim(), "1");
  for (const number of [
    numberedProject.number,
    numberedContract.number,
    numberedCertificate.number,
  ])
    assert(
      certificatePrint?.includes(number),
      `Missing printed reference: ${number}`
    );
  await dialog
    .locator(".p1-print")
    .getByText("150.00 SAR", { exact: true })
    .waitFor();
  await mkdir("docs/phase-one", { recursive: true });
  await approver.emulateMedia({ media: "print" });
  await approver.pdf({
    path: "docs/phase-one/certificate-print.pdf",
    format: "A4",
    preferCSSPageSize: true,
  });
  await approver.screenshot({
    path: "docs/phase-one/certificate-print.png",
    fullPage: true,
  });
  await approver.emulateMedia({ media: "screen" });
  await dialog
    .getByLabel("سبب الإجراء", { exact: true })
    .fill("اعتماد الإنجاز بعد المراجعة");
  await dialog
    .getByRole("button", { name: "اعتماد المستخلص", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const accountant = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  accountant.on("pageerror", e => errors.push(e.message));
  await login(accountant, "accountant");
  await accountant
    .getByRole("heading", { name: "حسابات الموردين والدفعات", exact: true })
    .waitFor();
  await accountant.locator(".p1-filter").fill(title);
  let panel = accountant.locator("section.p1-panel").filter({ hasText: title });
  await panel.getByText("جاهزة للصرف", { exact: false }).waitFor();
  await panel
    .getByRole("button", { name: "تسجيل مبلغ مصروف", exact: true })
    .click();
  dialog = accountant.getByRole("dialog");
  await dialog.getByLabel("المبلغ المصروف (ريال)", { exact: true }).fill("50");
  const voucher = fixture.code + "-UI-PV";
  await dialog
    .getByLabel("رقم سند الصرف المحاسبي", { exact: true })
    .fill(voucher);
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await panel.getByText("مدفوعة جزئيًا", { exact: true }).waitFor();
  await panel
    .locator(".p1-metrics>div")
    .filter({ hasText: "المستحق المتبقي" })
    .getByText("100.00 SAR", { exact: true })
    .waitFor();
  await panel
    .getByRole("button", { name: "تسجيل مبلغ مصروف", exact: true })
    .click();
  dialog = accountant.getByRole("dialog");
  await dialog
    .getByLabel("رقم سند الصرف المحاسبي", { exact: true })
    .fill(voucher);
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await accountant
    .getByText("تغيّر السجل أو استُخدم هذا الرمز مسبقًا. حدّث البيانات.", {
      exact: true,
    })
    .waitFor();
  assert(await dialog.isVisible());
  await dialog
    .getByLabel("رقم سند الصرف المحاسبي", { exact: true })
    .fill(voucher + "-2");
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await panel
    .locator(".p1-metrics>div")
    .filter({ hasText: "المستحق المتبقي" })
    .getByText("0.00 SAR", { exact: true })
    .waitFor();
  await panel
    .locator("tbody tr")
    .filter({ hasText: voucher + "-2" })
    .getByRole("button", { name: "التفاصيل", exact: true })
    .click();
  dialog = accountant.getByRole("dialog");
  await dialog.getByLabel("العنوان", { exact: true }).fill("سند صرف تجريبي");
  await dialog.locator("input[type=file]").setInputFiles({
    name: "voucher.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Phase-one isolated voucher"),
  });
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog
    .getByRole("link", { name: "سند صرف تجريبي — voucher.txt", exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: "Close / إغلاق", exact: true })
    .click();
  await accountant.screenshot({
    path: "docs/phase-one/accountant-desktop.png",
    fullPage: true,
  });
  await accountant.setViewportSize({ width: 390, height: 844 });
  await accountant.waitForFunction(
    () => document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0
  );
  await accountant
    .getByRole("button", { name: "Menu / القائمة", exact: true })
    .click();
  await accountant.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".sidebar")!.getBoundingClientRect().left
      ) < 1
  );
  await accountant
    .locator(".sidebar")
    .getByRole("button", { name: "حسابات الموردين والدفعات", exact: true })
    .click();
  await accountant.waitForFunction(
    () => document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0
  );
  await accountant.screenshot({
    path: "docs/phase-one/accountant-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await accountant
      .locator(".content-area")
      .evaluate(el => el.scrollWidth > el.clientWidth + 2),
    false,
    "Mobile main content overflow"
  );
  for (const locale of ["en", "ur", "ar"]) {
    await accountant.locator(".topbar select").selectOption(locale);
    assert.equal(
      await accountant.locator("html").getAttribute("dir"),
      locale === "en" ? "ltr" : "rtl"
    );
    await accountant.locator(".p1-metrics strong").first().waitFor();
  }
  const connection = await database(),
    [contract] = await connection
      .select()
      .from(simpleContracts)
      .where(eq(simpleContracts.title, title));
  const payments = await connection
    .select()
    .from(simplePayments)
    .where(eq(simplePayments.contractId, contract.id));
  assert.equal(payments.length, 2);
  assert.deepEqual(
    payments.map(x => x.paymentDate),
    [businessDate(), businessDate()]
  );
  assert.deepEqual(errors, []);
  console.log(
    "Phase-one UI passed: automatic project/contract/certificate numbers, project-number search, printed references, contract entry, certificate calculation, independent approval, next installment, partial payment, duplicate voucher, attachment, Arabic/English/Urdu and mobile layout."
  );
} catch (error) {
  await mkdir("docs/phase-one", { recursive: true });
  const contexts = browser?.contexts() ?? [];
  for (let i = 0; i < contexts.length; i++)
    for (const page of contexts[i].pages())
      await page
        .screenshot({ path: `docs/phase-one/failure-${i}.png`, fullPage: true })
        .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  try {
    if (fixture) await cleanupPhaseOne(fixture);
  } finally {
    await closeDb();
  }
}
