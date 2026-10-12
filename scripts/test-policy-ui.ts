import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  setupPolicyFixture,
  cleanupPolicyFixture,
  callerFor,
  configure,
  type PolicyFixture,
} from "./policy-fixture";
import { simpleCertificateInput } from "../shared/phase-one";
import { closeDb } from "../server/db";

let fixture: PolicyFixture | undefined,
  server: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const base = process.env.POLICY_UI_URL ?? "http://127.0.0.1:3125",
  errors: string[] = [];
async function login(page: Page, role: string) {
  await page.goto(base);
  await page.locator(".auth-form select").selectOption("ar");
  await page
    .getByLabel("اسم المستخدم")
    .fill(fixture!.a.accounts.find(a => a.role === role)!.username);
  await page.getByLabel("كلمة المرور").fill(fixture!.a.password);
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
async function state(page: Page) {
  const response = await page.request.get(base + "/api/trpc/phaseOne.state");
  return { status: response.status(), body: await response.json() };
}
try {
  fixture = await setupPolicyFixture();
  const { a, b, extra } = fixture,
    owner = await callerFor(extra.owner),
    preparer = await callerFor(a.actors[0]),
    approver = await callerFor(a.actors[1]),
    accountant = await callerFor(a.actors[2]);
  const certificateId = (
    await preparer.phaseOne.createCertificate({
      key: randomUUID(),
      data: simpleCertificateInput.parse({
        contractId: a.contractId,
        certificateDate: a.date,
        mode: "percent",
        progress: "100",
      }),
    })
  ).id;
  await approver.phaseOne.decideCertificate({
    id: certificateId,
    action: "approve",
    reason: "UI fixture review",
  });
  const snapshot = await accountant.phaseOne.state();
  const paymentId = (
    await accountant.phaseOne.recordPayment({
      key: randomUUID(),
      data: {
        contractId: a.contractId,
        certificateId,
        milestoneId: snapshot.balances[0].upcoming!.id,
        kind: "normal",
        amount: "100",
        paymentDate: a.date,
        voucher: a.code + "-UI",
      },
    })
  ).id;
  const upload = (entityType: string, entityId: number) =>
    owner.documents.upload({
      entityType,
      entityId,
      title: "Policy UI document",
      fileName: "policy.txt",
      mimeType: "text/plain",
      base64: Buffer.from("UI attachment check").toString("base64"),
    });
  const ownDoc = await upload("p1_contract", a.contractId),
    otherDoc = await upload("p1_contract", b.contractId),
    paymentDoc = await upload("p1_payment", paymentId);
  if (!process.env.POLICY_UI_URL)
    server = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, NODE_ENV: "development", PORT: "3125" },
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
  assert(ready, "Policy UI server failed to start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const ownerPage = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    prepPage = await browser.newPage(),
    viewerPage = await browser.newPage(),
    accountantPage = await browser.newPage();
  for (const page of [ownerPage, prepPage, viewerPage, accountantPage]) {
    page.setDefaultTimeout(45000);
    page.on("pageerror", e => errors.push(e.message));
  }
  await login(prepPage, "engineer");
  assert.equal(
    await prepPage
      .locator(".sidebar")
      .getByRole("button", { name: "حسابات الموردين والدفعات", exact: true })
      .count(),
    0
  );
  assert.equal(
    await prepPage
      .locator(".sidebar")
      .getByRole("button", { name: "الدورة السابقة", exact: true })
      .count(),
    0
  );
  const prepState = await state(prepPage);
  assert.equal(prepState.status, 200);
  assert.equal(prepState.body.result.data.json.payments.length, 0);
  assert.equal(prepState.body.result.data.json.accounts.length, 0);
  assert.deepEqual(
    prepState.body.result.data.json.contracts.map((c: { id: number }) => c.id),
    [a.contractId]
  );
  assert.equal((await prepPage.request.get(base + ownDoc.url)).status(), 200);
  assert.equal((await prepPage.request.get(base + otherDoc.url)).status(), 404);
  assert.equal(
    (await prepPage.request.get(base + paymentDoc.url)).status(),
    404
  );
  await login(accountantPage, "accountant");
  await accountantPage
    .getByRole("heading", { name: "حسابات الموردين والدفعات", exact: true })
    .waitFor();
  await accountantPage.locator(".p1-metrics strong").first().waitFor();
  assert.equal(
    (await accountantPage.request.get(base + paymentDoc.url)).status(),
    200
  );
  await login(ownerPage, "owner");
  await nav(ownerPage, "مركز الصلاحيات");
  await ownerPage
    .getByRole("heading", { name: "مركز السياسات والصلاحيات", exact: true })
    .waitFor();
  const targetUsername = a.accounts.find(a => a.role === "viewer")!.username;
  await ownerPage
    .locator(".policy-center tbody tr")
    .filter({ hasText: targetUsername })
    .getByRole("button", { name: "إعداد الصلاحيات", exact: true })
    .click();
  let dialog = ownerPage.getByRole("dialog");
  await dialog.getByLabel("الدور", { exact: true }).selectOption("approver");
  await dialog
    .locator("label")
    .filter({ hasText: a.code + " مشروع" })
    .locator("input")
    .uncheck();
  await dialog
    .locator("label")
    .filter({ hasText: b.code + " مشروع" })
    .locator("input")
    .check();
  await dialog
    .getByRole("button", { name: "حفظ السياسة", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await login(viewerPage, "viewer");
  await viewerPage
    .getByRole("heading", { name: "المستخلصات", exact: true })
    .waitFor();
  const viewerState = await state(viewerPage);
  assert.deepEqual(
    viewerState.body.result.data.json.contracts.map(
      (c: { id: number }) => c.id
    ),
    [b.contractId]
  );
  assert.equal(
    await viewerPage
      .locator(".sidebar")
      .getByRole("button", { name: "حسابات الموردين والدفعات", exact: true })
      .count(),
    0
  );
  // The currently authenticated viewer must immediately lose access after revocation.
  await configure(extra.owner, extra.viewer, "custom", []);
  assert.equal((await state(viewerPage)).status, 403);
  await viewerPage.reload();
  await viewerPage
    .getByRole("status")
    .filter({ hasText: "لم تُحدد صلاحياتك بعد" })
    .waitFor();
  await nav(ownerPage, "المستخدمون والصلاحيات");
  await ownerPage
    .getByRole("button", { name: "إضافة مستخدم", exact: true })
    .click();
  dialog = ownerPage.getByRole("dialog");
  const username = a.code.toLowerCase() + "-created",
    name = a.code + " created";
  await dialog.getByLabel("اسم المستخدم").fill(username);
  await dialog.getByLabel("الاسم الكامل").fill(name);
  await dialog.getByLabel("كلمة المرور").fill(a.password);
  await dialog.getByLabel("الدور", { exact: true }).selectOption("accountant");
  await dialog.getByLabel("تسجيل الصرف الفعلي", { exact: true }).uncheck();
  await dialog
    .locator("label")
    .filter({ hasText: a.code + " مشروع" })
    .locator("input")
    .check();
  await dialog.getByRole("button", { name: "إنشاء", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const created = (await owner.users.list()).find(u => u.username === username);
  assert(created, "UI-created user not found");
  a.actors.push(created.id);
  a.accounts.push({ role: "created", username });
  let createdPolicy = await owner.policy.user({ userId: created.id });
  assert.equal(createdPolicy.template, "accountant");
  assert(!createdPolicy.permissions.includes("p1.payments.record"));
  assert(createdPolicy.permissions.includes("p1.payments.view"));
  const createdRow = ownerPage
    .locator(".users-page tbody tr")
    .filter({ hasText: username });
  await createdRow
    .getByRole("button", { name: "تعديل البيانات", exact: true })
    .click();
  dialog = ownerPage.getByRole("dialog");
  await dialog.getByLabel("الدور", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("الدور", { exact: true }).inputValue(),
    "accountant"
  );
  assert(
    !(await dialog
      .getByLabel("تسجيل الصرف الفعلي", { exact: true })
      .isChecked())
  );
  await dialog.getByLabel("الدور", { exact: true }).selectOption("approver");
  await dialog
    .getByLabel("عرض المصروف والأرصدة والدفعة القادمة", { exact: true })
    .check();
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  createdPolicy = await owner.policy.user({ userId: created.id });
  assert.equal(createdPolicy.template, "approver");
  assert(createdPolicy.permissions.includes("p1.payments.view"));
  assert(createdPolicy.permissions.includes("p1.certificates.approve"));
  assert(!createdPolicy.permissions.includes("p1.payments.record"));
  await createdRow
    .getByRole("button", { name: "تعديل البيانات", exact: true })
    .click();
  dialog = ownerPage.getByRole("dialog");
  await dialog.getByLabel("الدور", { exact: true }).waitFor();
  assert.equal(
    await dialog.getByLabel("الدور", { exact: true }).inputValue(),
    "approver"
  );
  assert(
    await dialog
      .getByLabel("عرض المصروف والأرصدة والدفعة القادمة", { exact: true })
      .isChecked()
  );
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2),
    false,
    "Role and permission editor overflows mobile dialog"
  );
  await mkdir("docs/policy-center", { recursive: true });
  await dialog.screenshot({ path: "docs/policy-center/user-role-mobile.png" });
  await dialog.getByRole("button", { name: "إلغاء", exact: true }).click();
  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  await nav(ownerPage, "مركز الصلاحيات");
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  for (const [locale, title] of [
    ["en", "Policy & access center"],
    ["ur", "پالیسی اور رسائی کا مرکز"],
    ["ar", "مركز السياسات والصلاحيات"],
  ]) {
    await ownerPage.locator(".topbar select").selectOption(locale);
    await ownerPage
      .getByRole("heading", { name: title, exact: true })
      .waitFor();
    assert.equal(
      await ownerPage.locator("html").getAttribute("dir"),
      locale === "en" ? "ltr" : "rtl"
    );
    assert.equal(
      await ownerPage
        .locator(".content-area")
        .evaluate(el => el.scrollWidth > el.clientWidth + 2),
      false,
      "Policy center overflows mobile content"
    );
  }
  await ownerPage
    .locator(".policy-center tbody tr")
    .filter({ hasText: targetUsername })
    .getByRole("button", { name: "إعداد الصلاحيات", exact: true })
    .click();
  await ownerPage
    .getByRole("dialog")
    .getByLabel("الدور", { exact: true })
    .waitFor();
  assert.equal(
    await ownerPage
      .getByRole("dialog")
      .getByLabel("الدور", { exact: true })
      .inputValue(),
    "custom",
    "Reopened policy must load fresh settings after revocation"
  );
  assert.equal(
    await ownerPage
      .getByRole("dialog")
      .evaluate(el => el.scrollWidth > el.clientWidth + 2),
    false,
    "Policy form overflows mobile dialog"
  );
  await mkdir("docs/policy-center", { recursive: true });
  await ownerPage.screenshot({
    path: "docs/policy-center/mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Policy UI passed: role dropdowns on account creation and editing, per-user template grant removal and additions retained on reopen, project scope, server financial redaction, protected attachment downloads, accountant landing, live revocation, Arabic/English/Urdu, mobile role editor and no JavaScript errors."
  );
} catch (error) {
  await mkdir("docs/policy-center", { recursive: true });
  for (const [index, context] of (browser?.contexts() ?? []).entries())
    for (const page of context.pages())
      await page
        .screenshot({
          path: `docs/policy-center/failure-${index}.png`,
          fullPage: true,
        })
        .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  try {
    if (fixture) await cleanupPolicyFixture(fixture);
  } finally {
    await closeDb();
  }
}
