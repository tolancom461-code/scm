import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "@playwright/test";

const runId = randomBytes(5).toString("hex"),
  username = `scm_ui_${runId}`,
  password = randomBytes(24).toString("base64url");
const code = `UI-${runId.toUpperCase()}`;
const url = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const base = process.env.SCM_UI_URL || "http://127.0.0.1:3110";
let server, browser, userId;
try {
  const salt = randomBytes(16).toString("hex");
  const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  const [result] = await db.execute(
    "INSERT INTO users (openId, username, passwordHash, name, role, active) VALUES (?, ?, ?, 'SCM UI Test', 'admin', 1)",
    [`local:${username}`, username, hash]
  );
  userId = result.insertId;
  if (!process.env.SCM_UI_URL)
    server = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, NODE_ENV: "development", PORT: "3110" },
      }
    );
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {
      ready = false;
    }
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert(ready, "Test server did not start");
  browser = await chromium.launch({
    channel: process.env.SCM_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.locator(".auth-form").waitFor();
  await page.locator(".auth-form select").selectOption("en");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("SCM UI Test", { exact: true }).waitFor();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Master data", exact: true })
    .click();
  await page
    .locator(".md-tabs")
    .getByRole("button", { name: "Branches", exact: true })
    .click();
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Code", { exact: true }).fill(code);
  await dialog.getByLabel("Arabic name", { exact: true }).fill("فرع اختبار");
  await dialog.getByLabel("English name", { exact: true }).fill("Test branch");
  await dialog.getByLabel("Urdu name", { exact: true }).fill("ٹیسٹ شاخ");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByPlaceholder("Search code or name").fill(code);
  await page.getByRole("button", { name: code, exact: true }).waitFor();
  await page.getByRole("button", { name: code, exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Test branch", { exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("English name", { exact: true })
    .fill("Updated test branch");
  await page
    .getByRole("dialog")
    .getByLabel("Reason for change", { exact: true })
    .fill("UI integration test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("Updated test branch", { exact: true }).waitFor();
  for (const [locale, heading, direction] of [
    ["ar", "البيانات الرئيسية", "rtl"],
    ["ur", "بنیادی ڈیٹا", "rtl"],
    ["en", "Master data", "ltr"],
  ]) {
    await page.locator(".locale-switch select").selectOption(locale);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), direction);
    assert((await page.locator(".md-tabs button.active").count()) === 1);
  }
  await page.screenshot({
    path: resolve("docs/scm-master-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator(".md-tabs").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth), "Mobile tabs extend beyond the viewport");
  await page.locator(".sidebar").evaluate(async element => {
    await Promise.all(
      element.getAnimations().map(animation => animation.finished)
    );
  });
  assert(
    await page
      .locator(".sidebar")
      .evaluate(element => element.getBoundingClientRect().right <= 0),
    "Mobile sidebar overlaps the page"
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    "Mobile page overflows horizontally"
  );
  await page.screenshot({
    path: resolve("docs/scm-master-mobile.png"),
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "SCM UI passed: create, detail, edit, search, AR/EN/UR, RTL/LTR, desktop/mobile. No page errors."
  );
} finally {
  await browser?.close();
  if (userId) {
    const [rows] = await db.execute(
      "SELECT id FROM scm_branches WHERE code = ?",
      [code]
    );
    for (const row of rows) {
      await db.execute(
        "DELETE FROM scm_outbox WHERE entity_type = 'branches' AND entity_id = ?",
        [row.id]
      );
      await db.execute(
        "DELETE FROM scm_audit_events WHERE entity_type = 'branches' AND entity_id = ?",
        [row.id]
      );
      await db.execute("DELETE FROM scm_branches WHERE id = ?", [row.id]);
    }
    await db.execute("DELETE FROM operation_keys WHERE actor_id = ?", [userId]);
    await db.execute("DELETE FROM sessions WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM auditLogs WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM userPermissions WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
  await db.end();
  server?.kill();
}
