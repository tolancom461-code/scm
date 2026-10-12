import "dotenv/config";
import { readFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "@playwright/test";
const demo = JSON.parse(await readFile(".mvp-demo-credentials.json", "utf8")),
  fx = demo.fixture,
  code = "UI-MVP-" + randomBytes(4).toString("hex"),
  base = process.env.SCM_UI_URL || "http://127.0.0.1:3112";
const url = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
let server, browser, page, orderId, invoiceId, documentId, localFile;
const errors = [];
const nav = {
  en: {
    overview: "Operations Command",
    procurement: "Procurement cycle",
    finance: "Invoices & payments",
    projects: "Projects & budgets",
    receiving: "Receiving & inspection",
    inventory: "Inventory",
  },
  ar: {
    overview: "المركز التشغيلي",
    procurement: "دورة الشراء",
    finance: "الفواتير والدفعات",
    projects: "المشاريع والميزانيات",
    receiving: "الشحن والاستلام والفحص",
    inventory: "المخزون",
  },
  ur: {
    overview: "آپریشنز کمانڈ",
    procurement: "خریداری کا چکر",
    finance: "رسیدیں اور ادائیگیاں",
    projects: "منصوبے اور بجٹ",
    receiving: "وصولی اور معائنہ",
    inventory: "اسٹاک",
  },
};
async function navigate(page, name) {
  if (await page.locator(".mobile-menu").isVisible())
    await page.locator(".mobile-menu").click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name, exact: true })
    .click();
  if (await page.locator(".mobile-menu").isVisible())
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar").getBoundingClientRect().right <= 0
    );
}
async function login(page, role) {
  await page.goto(base);
  await page.locator(".auth-form select").selectOption("en");
  await page
    .getByLabel("Username")
    .fill(demo.accounts.find(a => a.role === role).username);
  await page.getByLabel("Password").fill(demo.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".sidebar").waitFor();
  await page.locator(".sidebar").getByRole("button",{name:"Previous workflow",exact:true}).click();
}
try {
  if (!process.env.SCM_UI_URL)
    server = spawn(
      process.execPath,
      ["--import", "tsx", "server/_core/index.ts"],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, NODE_ENV: "development", PORT: "3112" },
      }
    );
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      ready = (await fetch(base)).ok;
    } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert(ready, "MVP test server did not start");
  browser = await chromium.launch({
    channel: process.env.SCM_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", e => errors.push(e.message));
  await login(page, "buyer");
  await navigate(page, nav.en.procurement);
  await page
    .getByRole("heading", { name: "Direct contract / order", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Supplier", exact: true })
    .selectOption(String(fx.supplierId));
  await dialog.getByLabel("Title", { exact: true }).fill(code);
  await dialog.getByLabel("Department", { exact: true }).fill(fx.code);
  await dialog
    .getByLabel("Payment terms", { exact: true })
    .fill("Staged payments");
  await dialog
    .getByLabel("Delivery terms", { exact: true })
    .fill("Delivery to site");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Browser verification");
  await dialog
    .getByLabel("Required date", { exact: true })
    .first()
    .fill(new Date().toISOString().slice(0, 10));
  await dialog
    .getByRole("combobox", { name: "Branches", exact: true })
    .selectOption(String(fx.branchId));
  const [item] = (
    await db.execute(
      "SELECT purchasing_uom_id AS unitId FROM scm_items WHERE id=?",
      [fx.itemIds[0]]
    )
  )[0];
  await dialog
    .getByRole("combobox", { name: "Items & services", exact: true })
    .selectOption(String(fx.itemIds[0]));
  await dialog.getByLabel("Description", { exact: true }).fill("One QA tree");
  await dialog
    .getByRole("combobox", { name: "Units of measure", exact: true })
    .selectOption(String(item.unitId));
  await dialog.getByLabel("Unit price", { exact: true }).fill("1");
  await dialog
    .getByLabel("Required date", { exact: true })
    .last()
    .fill(new Date().toISOString().slice(0, 10));
  await dialog
    .getByRole("combobox", { name: "Projects & budgets", exact: true })
    .selectOption(String(fx.projectId));
  await dialog
    .getByLabel("Approved budget", { exact: true })
    .selectOption(String(fx.budgetIds[0]));
  await dialog
    .getByRole("combobox", { name: "Sites", exact: true })
    .selectOption(String(fx.siteId));
  await dialog
    .getByRole("combobox", { name: "Warehouses", exact: true })
    .selectOption(String(fx.warehouseId));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const [qaOrders] = await db.execute(
    "SELECT id,number FROM scm_orders WHERE title=?",
    [code]
  );
  assert.equal(qaOrders.length, 1);
  orderId = qaOrders[0].id;
  await page
    .getByRole("button", { name: qaOrders[0].number, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("1.000000 × 1.00", { exact: true }).waitFor();
  const attachments = dialog
    .locator("section.op-step")
    .filter({ hasText: "Attachments" });
  await attachments
    .getByLabel("Title", { exact: true })
    .fill(code + " attachment");
  await attachments.locator('input[type="file"]').setInputFiles({
    name: "qa.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("MVP attachment verification"),
  });
  await attachments.getByRole("button", { name: "Save", exact: true }).click();
  const link = attachments.getByRole("link", {
    name: code + " attachment — qa.txt",
    exact: true,
  });
  await link.waitFor();
  const href = await link.getAttribute("href");
  const download = await context.request.get(base + href);
  assert.equal(download.status(), 200);
  assert.equal(await download.text(), "MVP attachment verification");
  const unauthenticated = await browser.newContext();
  assert.equal((await unauthenticated.request.get(base + href)).status(), 401);
  await unauthenticated.close();
  const [documents] = await db.execute(
    "SELECT id,storageKey FROM documents WHERE entityType='scm_order' AND entityId=?",
    [orderId]
  );
  documentId = documents[0].id;
  if (/^local\/[0-9a-f-]{36}$/.test(documents[0].storageKey))
    localFile = resolve(
      process.env.FILE_STORAGE_DIR || ".data/documents",
      documents[0].storageKey.slice(6)
    );
  await dialog.getByLabel("Reason", { exact: true }).fill("Cancel QA draft");
  await dialog.getByRole("button", { name: "Cancelled", exact: true }).click();
  await dialog
    .getByRole("heading", {
      name: new RegExp(qaOrders[0].number + ".*Cancelled"),
    })
    .waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await navigate(page, nav.en.finance);
  await page
    .getByRole("heading", { name: "Invoices & payments", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Purchase order", exact: true })
    .selectOption(String(fx.orders[0]));
  await dialog.getByLabel("Supplier reference", { exact: true }).fill(code);
  await dialog.locator('input[type="checkbox"]').check();
  await dialog.getByLabel("Quantity", { exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const [invoices] = await db.execute(
    "SELECT id,number FROM scm_invoices WHERE supplier_reference=?",
    [code]
  );
  invoiceId = invoices[0].id;
  await page
    .getByRole("button", { name: invoices[0].number, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Match", exact: true }).click();
  await dialog
    .getByText(/Quantity exceeds accepted unbilled quantity/)
    .waitFor();
  await dialog.getByLabel("Reason", { exact: true }).fill("Cancel QA mismatch");
  await dialog.getByRole("button", { name: "Cancelled", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  for (const locale of ["ar", "en", "ur"]) {
    await page.locator(".locale-switch select").selectOption(locale);
    assert.equal(
      await page.locator("html").getAttribute("dir"),
      locale === "en" ? "ltr" : "rtl"
    );
    for (const section of [
      "overview",
      "procurement",
      "finance",
      "projects",
      "receiving",
      "inventory",
    ]) {
      await navigate(page, nav[locale][section]);
      await page.locator("main").waitFor();
      await page.locator("main .op-table tbody tr").first().waitFor();
      if (section === "overview") {
        await page
          .locator("main .op-form select")
          .selectOption(String(fx.projectId));
        await page
          .locator("main .op-metric strong")
          .filter({ hasText: "250000" })
          .first()
          .waitFor();
        await page
          .locator("main section.op-panel tbody tr")
          .filter({ hasText: "20.000000 / 20.000000" })
          .waitFor();
        await page
          .locator("main section.op-panel tbody tr")
          .filter({ hasText: "50.000000 / 100.000000" })
          .waitFor();
      }
      assert.equal(
        await page.locator('main [role="alert"]').count(),
        0,
        "Error in " + section + " / " + locale
      );
    }
    await navigate(page, nav[locale].overview);
    await page
      .locator("main .op-form select")
      .selectOption(String(fx.projectId));
    await page
      .locator("main section.op-panel tbody tr")
      .filter({ hasText: "20.000000 / 20.000000" })
      .waitFor();
    await page.screenshot({
      path: resolve("docs", "mvp-" + locale + "-desktop.png"),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".locale-switch select").selectOption("ar");
  await navigate(page, nav.ar.finance);
  await page
    .getByRole("heading", { name: "الفواتير والدفعات", exact: true })
    .waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2
    ),
    "Page overflows phone width"
  );
  await page.screenshot({
    path: resolve("docs", "mvp-ar-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "MVP browser checks passed: project budgets / accepted quantities / paid totals, direct order form, invoice mismatch, cancellation, authenticated attachment, AR/EN/UR and mobile."
  );
} catch (error) {
  if (page) {
    await page.screenshot({
      path: resolve("docs", "mvp-ui-failure.png"),
      fullPage: true,
    });
    console.error((await page.locator("body").innerText()).slice(-1600));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  if (documentId)
    await db.execute("DELETE FROM documents WHERE id=?", [documentId]);
  if (localFile) await unlink(localFile).catch(() => {});
  if (invoiceId) {
    await db.execute("DELETE FROM scm_invoice_matches WHERE invoice_id=?", [
      invoiceId,
    ]);
    await db.execute("DELETE FROM scm_invoice_lines WHERE invoice_id=?", [
      invoiceId,
    ]);
    await db.execute("DELETE FROM scm_invoices WHERE id=?", [invoiceId]);
  }
  if (orderId) {
    await db.execute(
      "DELETE FROM scm_order_schedules WHERE order_line_id IN (SELECT id FROM scm_order_lines WHERE order_id=?)",
      [orderId]
    );
    await db.execute("DELETE FROM scm_order_lines WHERE order_id=?", [orderId]);
    await db.execute("DELETE FROM scm_orders WHERE id=?", [orderId]);
  }
  await db.end();
}
