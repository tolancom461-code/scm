import "dotenv/config";
import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  setupUsersFixture,
  cleanupUsersFixture,
  type UsersFixture,
} from "./users-fixture";
import { closeDb } from "../server/db";

let fixture: UsersFixture | undefined,
  server: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const base = process.env.USERS_UI_URL ?? "http://127.0.0.1:3124",
  errors: string[] = [];
const user = (kind: string) => fixture!.accounts.find(a => a.kind === kind)!;
async function login(page: Page, username: string, password: string) {
  await page.goto(base);
  await page.locator(".auth-form select").selectOption("ar");
  await page.getByLabel("اسم المستخدم").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.locator(".sidebar").waitFor();
}
async function nav(page: Page) {
  if (await page.locator(".mobile-menu").isVisible())
    await page.locator(".mobile-menu").click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "المستخدمون والصلاحيات", exact: true })
    .click();
  if (await page.locator(".mobile-menu").isVisible())
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0
    );
}
async function identity(page: Page) {
  return (await (await page.request.get(base + "/api/trpc/auth.me")).json())
    .result.data.json;
}
async function tryLogin(page: Page, username: string, password: string) {
  return page.request.post(base + "/api/trpc/auth.login", {
    data: { json: { username, password } },
  });
}
try {
  fixture = await setupUsersFixture();
  if (!process.env.USERS_UI_URL)
    server = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, NODE_ENV: "development", PORT: "3124" },
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
  assert(ready, "Users UI server failed to start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  admin.setDefaultTimeout(30000);
  admin.on("pageerror", e => errors.push(e.message));
  await login(admin, user("adminA").username, fixture.password);
  await nav(admin);
  const ownRow = admin
    .locator("tbody tr")
    .filter({ hasText: user("adminA").username });
  assert(
    await ownRow
      .getByRole("button", { name: "تعطيل المستخدم", exact: true })
      .isDisabled()
  );
  let row = admin
    .locator("tbody tr")
    .filter({ hasText: user("target").username });
  await row
    .getByRole("button", { name: "تعديل البيانات", exact: true })
    .click();
  let dialog = admin.getByRole("dialog");
  const renamed = fixture.code + "_edited",
    name = fixture.code + " اسم معدل";
  await dialog.getByLabel("اسم المستخدم").fill(renamed);
  await dialog.getByLabel("الاسم الكامل").fill(name);
  await dialog.getByLabel("البريد الإلكتروني").fill("fixture@example.test");
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  row = admin.locator("tbody tr").filter({ hasText: renamed });
  await row.getByText(name, { exact: true }).waitFor();
  await row
    .getByRole("button", { name: "تعديل البيانات", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("اسم المستخدم").fill(user("adminA").username);
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await admin
    .getByText("اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.", { exact: true })
    .waitFor();
  await dialog.getByRole("button", { name: "إلغاء", exact: true }).click();
  const target = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  target.on("pageerror", e => errors.push(e.message));
  await login(target, renamed, fixture.password);
  assert.equal((await identity(target)).id, user("target").id);
  await row
    .getByRole("button", { name: "تغيير كلمة المرور", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  const newPassword = "Changed-" + randomUUID();
  await dialog.getByLabel("كلمة المرور الجديدة").fill(newPassword);
  await dialog.getByLabel("تأكيد كلمة المرور").fill(newPassword + "x");
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await admin
    .getByText("كلمة المرور وتأكيدها غير متطابقين.", { exact: true })
    .waitFor();
  await dialog.getByLabel("تأكيد كلمة المرور").fill(newPassword);
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await identity(target),
    null,
    "Reset did not revoke the existing session"
  );
  assert.equal(
    (await tryLogin(target, renamed, fixture.password)).status(),
    401,
    "Old password was accepted"
  );
  await login(target, renamed, newPassword);
  await row
    .getByRole("button", { name: "تعطيل المستخدم", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "تعطيل المستخدم", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await row.getByText("معطل", { exact: true }).waitFor();
  assert.equal(
    await identity(target),
    null,
    "Deactivation did not revoke the session"
  );
  assert.equal(
    (await tryLogin(target, renamed, newPassword)).status(),
    401,
    "Inactive account could sign in"
  );
  await row
    .getByRole("button", { name: "تفعيل المستخدم", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "تفعيل المستخدم", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await row.getByText("نشط", { exact: true }).waitFor();
  assert.equal(
    await identity(target),
    null,
    "Reactivation revived a revoked session"
  );
  await login(target, renamed, newPassword);
  assert.equal((await identity(target)).id, user("target").id);
  await mkdir("docs/users", { recursive: true });
  await row.screenshot({ path: "docs/users/user-actions.png" });
  const viewer = await browser.newPage();
  viewer.on("pageerror", e => errors.push(e.message));
  await login(viewer, user("viewer").username, fixture.password);
  await viewer.locator(".users-page tbody tr").first().waitFor();
  assert.equal(
    await viewer
      .locator(".users-page")
      .getByRole("button", { name: "تعديل البيانات", exact: true })
      .count(),
    0
  );
  assert.equal(
    await viewer
      .locator(".users-page")
      .getByRole("button", { name: "تغيير كلمة المرور", exact: true })
      .count(),
    0
  );
  assert.equal(
    await viewer
      .locator(".users-page")
      .getByRole("button", { name: "إضافة مستخدم", exact: true })
      .count(),
    0
  );
  const forbidden = await viewer.request.post(
    base + "/api/trpc/users.setActive",
    { data: { json: { userId: user("target").id, active: false } } }
  );
  assert.equal(forbidden.status(), 403);
  for (const [locale, button] of [
    ["en", "Change password"],
    ["ur", "پاس ورڈ تبدیل کریں"],
    ["ar", "تغيير كلمة المرور"],
  ]) {
    await admin.locator(".topbar select").selectOption(locale);
    await row.getByRole("button", { name: button, exact: true }).waitFor();
  }
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.waitForFunction(
    () => document.querySelector(".sidebar")!.getBoundingClientRect().right <= 0
  );
  await row
    .getByRole("button", { name: "تغيير كلمة المرور", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  await dialog.getByLabel("كلمة المرور الجديدة").waitFor();
  assert.equal(
    await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2),
    false,
    "Password form overflows on mobile"
  );
  await dialog.screenshot({ path: "docs/users/password-mobile.png" });
  await dialog.getByRole("button", { name: "إلغاء", exact: true }).click();
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await ownRow
    .getByRole("button", { name: "تغيير كلمة المرور", exact: true })
    .click();
  dialog = admin.getByRole("dialog");
  const ownPassword = "Self-Changed-" + randomUUID();
  await dialog.getByLabel("كلمة المرور الجديدة").fill(ownPassword);
  await dialog.getByLabel("تأكيد كلمة المرور").fill(ownPassword);
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await admin.locator(".auth-form").waitFor();
  await login(admin, user("adminA").username, ownPassword);
  assert.equal((await identity(admin)).id, user("adminA").id);
  assert.deepEqual(errors, []);
  console.log(
    "Users UI passed: edit, duplicate username, password confirmation, old password and session rejection, deactivate/reactivate, read-only permissions, self password change, AR/EN/UR and mobile."
  );
} catch (error) {
  await mkdir("docs/users", { recursive: true });
  for (const page of browser?.contexts().flatMap(c => c.pages()) ?? [])
    await page
      .screenshot({ path: "docs/users/failure.png", fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  try {
    if (fixture) await cleanupUsersFixture(fixture);
  } finally {
    await closeDb();
  }
}
