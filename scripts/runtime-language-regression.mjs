import assert from "node:assert/strict";
import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mysql from "mysql2/promise";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";

const scrypt = promisify(scryptCallback);
const execFileAsync = promisify(execFile);
const baseUrl = process.env.RUNTIME_TEST_URL || "http://127.0.0.1:3050";
const testToken = randomBytes(8).toString("hex");
const username = `runtime_ui_${testToken}`;
const password = `Runtime-${testToken}!Secure`;
const reportSource = `runtime-${testToken}`;
const reportRowCount = Math.max(1, Number.parseInt(process.env.RUNTIME_REPORT_ROW_COUNT ?? "1", 10) || 1);
let server;
let db;
let userId;
let supplierId;
let artifactsDir;
let existingRequestRows = 0;
let runtimeRfqId;
let runtimeContractId;
let runtimeOrderId;
let excludedRfqId;
let excludedContractId;
let excludedOrderId;
const reportRequestNumber = `RPT-${testToken}`;
const supplierNumber = `SUP-RUNTIME-${testToken}`;

async function isServerReady() {
  try { return (await fetch(baseUrl)).ok; } catch { return false; }
}

async function ensureServer() {
  if (await isServerReady()) return;
  server = spawn("pnpm", ["run", "dev"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "development" }, stdio: "ignore" });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (await isServerReady()) return;
  }
  throw new Error("Runtime test server did not start in time");
}

async function createTestUser() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the runtime test fixture");
  await fetch(`${baseUrl}/api/trpc/auth.firstRunStatus?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null } }))}`);
  db = await mysql.createConnection(process.env.DATABASE_URL);
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt}$${derived.toString("hex")}`;
  await db.execute(
    "INSERT INTO users (openId, username, passwordHash, name, email, loginMethod, role, active, preferredLocale, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, 'local', 'admin', 1, 'ar', NOW(), NOW(), NOW())",
    [`runtime-${testToken}`, username, passwordHash, "Runtime UI Test", `${username}@local.invalid`],
  );
  const [users] = await db.execute("SELECT id FROM users WHERE username = ?", [username]);
  userId = users[0]?.id;
  if (!userId) throw new Error("Runtime test user could not be retrieved");
  await db.execute("INSERT IGNORE INTO userPermissions (userId, permissionId, scopeType) SELECT ?, id, 'global' FROM permissions", [userId]);
  await db.execute("INSERT INTO suppliers (supplierNumber, nameAr, nameEn, nameUr, supplierStatus, createdBy, createdAt) VALUES (?, ?, ?, ?, 'active', ?, NOW())", [supplierNumber, `مورد اختبار ${testToken}`, `Runtime supplier ${testToken}`, `رَن ٹائم سپلائر ${testToken}`, userId]);
  const [suppliers] = await db.execute("SELECT id FROM suppliers WHERE supplierNumber = ?", [supplierNumber]); supplierId = suppliers[0]?.id;
  if (!supplierId) throw new Error("Runtime filter supplier could not be retrieved");
  const [existingRows] = await db.execute("SELECT COUNT(*) AS total FROM purchaseRequests"); existingRequestRows = Number(existingRows[0]?.total ?? 0);
  for (let offset = 0; offset < reportRowCount; offset += 500) {
    const count = Math.min(500, reportRowCount - offset);
    const placeholders = Array.from({ length: count }, () => "(?, ?, ?, ?, 'normal', 1250.00, 'SAR', 'approved', ?, NOW(), NOW())").join(",");
    const values = Array.from({ length: count }, (_, index) => {
      const row = offset + index; return [`${reportRequestNumber}-${row}`, `Runtime export report record ${row}`, "Quality assurance", reportSource, supplierId, userId];
    }).flat();
    await db.execute(`INSERT INTO purchaseRequests (requestNumber, title, department, source, supplierId, requestPriority, estimatedValue, currency, requestStatus, createdBy, createdAt, updatedAt) VALUES ${placeholders.replaceAll("?, 'normal'", "?, ?, 'normal'")}`, values);
  }
  await db.execute("INSERT INTO purchaseRequests (requestNumber, title, department, source, supplierId, requestPriority, estimatedValue, currency, requestStatus, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'normal', 1250.00, 'SAR', 'rejected', ?, NOW(), NOW())", [`RPT-X-${testToken}`, "Runtime excluded purchase request", "Quality assurance", reportSource, supplierId, userId]);
  await db.execute("INSERT INTO rfqs (rfqNumber, title, rfqStatus, createdBy, createdAt) VALUES (?, ?, 'open', ?, NOW())", [`RFQ-${testToken}`, "Runtime filter RFQ", userId]);
  const [rfqs] = await db.execute("SELECT id FROM rfqs WHERE rfqNumber = ?", [`RFQ-${testToken}`]); runtimeRfqId = rfqs[0]?.id;
  await db.execute("INSERT INTO quotations (rfqId, supplierId, totalAmount, currency, quotationStatus, createdAt) VALUES (?, ?, 1250.00, 'SAR', 'received', NOW())", [runtimeRfqId, supplierId]);
  await db.execute("INSERT INTO rfqs (rfqNumber, title, rfqStatus, createdBy, createdAt) VALUES (?, ?, 'draft', ?, NOW())", [`RFQ-X-${testToken}`, "Runtime excluded RFQ", userId]);
  const [excludedRfqs] = await db.execute("SELECT id FROM rfqs WHERE rfqNumber = ?", [`RFQ-X-${testToken}`]); excludedRfqId = excludedRfqs[0]?.id;
  await db.execute("INSERT INTO quotations (rfqId, supplierId, totalAmount, currency, quotationStatus, createdAt) VALUES (?, ?, 1250.00, 'SAR', 'received', NOW())", [excludedRfqId, supplierId]);
  await db.execute("INSERT INTO contracts (contractNumber, title, supplierId, contractType, originalValue, currentValue, currency, contractStatus, createdBy, createdAt) VALUES (?, ?, ?, 'supply', 1250.00, 1250.00, 'SAR', 'active', ?, NOW())", [`CTR-${testToken}`, "Runtime filter contract", supplierId, userId]);
  const [contracts] = await db.execute("SELECT id FROM contracts WHERE contractNumber = ?", [`CTR-${testToken}`]); runtimeContractId = contracts[0]?.id;
  await db.execute("INSERT INTO contracts (contractNumber, title, supplierId, contractType, originalValue, currentValue, currency, contractStatus, createdBy, createdAt) VALUES (?, ?, ?, 'supply', 1250.00, 1250.00, 'SAR', 'draft', ?, NOW())", [`CTR-X-${testToken}`, "Runtime excluded contract", supplierId, userId]);
  const [excludedContracts] = await db.execute("SELECT id FROM contracts WHERE contractNumber = ?", [`CTR-X-${testToken}`]); excludedContractId = excludedContracts[0]?.id;
  await db.execute("INSERT INTO purchaseOrders (poNumber, supplierId, contractId, totalAmount, currency, poStatus, createdBy, createdAt) VALUES (?, ?, ?, 1250.00, 'SAR', 'issued', ?, NOW())", [`PO-${testToken}`, supplierId, runtimeContractId, userId]);
  const [orders] = await db.execute("SELECT id FROM purchaseOrders WHERE poNumber = ?", [`PO-${testToken}`]); runtimeOrderId = orders[0]?.id;
  await db.execute("INSERT INTO purchaseOrders (poNumber, supplierId, contractId, totalAmount, currency, poStatus, createdBy, createdAt) VALUES (?, ?, ?, 1250.00, 'SAR', 'draft', ?, NOW())", [`PO-X-${testToken}`, supplierId, excludedContractId, userId]);
  const [excludedOrders] = await db.execute("SELECT id FROM purchaseOrders WHERE poNumber = ?", [`PO-X-${testToken}`]); excludedOrderId = excludedOrders[0]?.id;
  await db.execute("INSERT INTO deliveries (deliveryNumber, poId, supplierId, deliveredAt, deliveredValue, acceptedValue, rejectedValue, deliveryStatus, createdBy, createdAt) VALUES (?, ?, ?, NOW(), 1250.00, 1250.00, 0.00, 'delivered', ?, NOW())", [`DEL-${testToken}`, runtimeOrderId, supplierId, userId]);
  await db.execute("INSERT INTO deliveries (deliveryNumber, poId, supplierId, deliveredAt, deliveredValue, acceptedValue, rejectedValue, deliveryStatus, createdBy, createdAt) VALUES (?, ?, ?, NOW(), 1250.00, 0.00, 1250.00, 'rejected', ?, NOW())", [`DEL-X-${testToken}`, excludedOrderId, supplierId, userId]);
}

async function cleanup() {
  if (db) {
    await db.execute("DELETE FROM purchaseRequests WHERE source = ?", [reportSource]);
    if (runtimeRfqId) await db.execute("DELETE FROM quotations WHERE rfqId IN (?, ?)", [runtimeRfqId, excludedRfqId]);
    if (runtimeOrderId) await db.execute("DELETE FROM deliveries WHERE poId IN (?, ?)", [runtimeOrderId, excludedOrderId]);
    if (runtimeOrderId) await db.execute("DELETE FROM purchaseOrders WHERE id IN (?, ?)", [runtimeOrderId, excludedOrderId]);
    if (runtimeContractId) await db.execute("DELETE FROM contracts WHERE id IN (?, ?)", [runtimeContractId, excludedContractId]);
    if (runtimeRfqId) await db.execute("DELETE FROM rfqs WHERE id IN (?, ?)", [runtimeRfqId, excludedRfqId]);
    await db.execute("DELETE FROM suppliers WHERE supplierNumber = ?", [supplierNumber]);
  }
  if (db && userId) {
    await db.execute("DELETE FROM sessions WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM auditLogs WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM userPermissions WHERE userId = ?", [userId]);
    await db.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
  db?.destroy();
  if (artifactsDir) await rm(artifactsDir, { recursive: true, force: true });
  if (server) server.kill("SIGTERM");
}

async function run() {
  await ensureServer();
  await createTestUser();
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
    const inputs = page.locator("input");
    await inputs.nth(0).fill(username);
    await inputs.nth(1).fill(password);
    await page.locator("form .neo-button.full").click();
    await page.getByText("Runtime UI Test", { exact: true }).waitFor({ timeout: 30000 });
    await page.locator("button").filter({ hasText: "طلبات عروض الأسعار" }).click();
    await page.getByRole("heading", { name: "طلبات عروض الأسعار" }).waitFor();
    const locale = page.locator("select").filter({ has: page.locator('option[value="en"]') }).first();
    await locale.selectOption("en");
    await page.getByRole("heading", { name: "Requests for Quotation" }).waitFor();
    await page.getByRole("button", { name: "Contracts" }).click();
    await page.getByRole("heading", { name: "Contracts" }).waitFor();
    await locale.selectOption("ur");
    await page.getByRole("heading", { name: "معاہدے" }).waitFor();
    const body = await page.locator("body").innerText();
    assert.ok(body.includes("معاہدے"), "Contracts workspace should remain open after locale switch");
    assert.ok(!body.includes("SYNCING SYSTEM"), "Runtime switch must not return to a loading/blank page");
    await page.locator("button").filter({ hasText: "رپورٹس اور برآمد" }).click();
    await locale.selectOption("en");
    await page.getByRole("button", { name: "Export Excel" }).waitFor();
    const reportOptions = async module => page.evaluate(async currentModule => {
      const input = encodeURIComponent(JSON.stringify({ 0: { json: { module: currentModule } } }));
      const response = await fetch(`/api/trpc/reports.options?batch=1&input=${input}`);
      return { status: response.status, body: await response.text() };
    }, module);
    const requestOptions = await reportOptions("requests"); const nonRequestOptions = await Promise.all(["rfqs", "contracts", "orders", "deliveries"].map(reportOptions));
    assert.equal(requestOptions.status, 200, "Report options route must allow purchase request filter options"); assert.match(requestOptions.body, /Quality assurance/, "Request report options must return its department");
    nonRequestOptions.forEach((result, index) => { assert.equal(result.status, 200, "Report options route must allow non-request filter options"); assert.doesNotMatch(result.body, /Quality assurance/, `Non-request module ${index} must not return purchase request departments`); });
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("From date").fill(today); await page.getByLabel("To date").fill(today);
    await page.getByLabel("Department").selectOption("Quality assurance"); await page.getByLabel("Supplier").selectOption(String(supplierId)); await page.getByLabel("Status").selectOption("approved");
    if (reportRowCount === 1) await page.getByText("Runtime export report record 0", { exact: true }).first().waitFor();
    else await page.locator("tbody tr").first().waitFor();
    assert.equal(await page.getByText("Runtime excluded purchase request", { exact: true }).count(), 0, "Request status filter must exclude a record with the same supplier, department, and date");
    await page.getByRole("columnheader", { name: "Reference" }).waitFor();
    const moduleSelect = page.getByLabel("Report module");
    artifactsDir = await mkdtemp(join(tmpdir(), "procure-report-"));
    for (const [module, expectedTitle, expectedStatus, excludedTitle, expectedReference] of [["rfqs", "Runtime filter RFQ", "open", "Runtime excluded RFQ", `RFQ-${testToken}`], ["contracts", "Runtime filter contract", "active", "Runtime excluded contract", `CTR-${testToken}`], ["orders", `PO-${testToken}`, "issued", `PO-X-${testToken}`, `PO-${testToken}`], ["deliveries", `DEL-${testToken}`, "delivered", `DEL-X-${testToken}`, `DEL-${testToken}`]]) {
      await moduleSelect.selectOption(module); await page.getByLabel("Supplier").selectOption(String(supplierId)); await page.getByLabel("Status").selectOption(expectedStatus);
      await page.getByText(expectedTitle, { exact: true }).first().waitFor();
      assert.equal(await page.getByText(excludedTitle, { exact: true }).count(), 0, `${module} status filter must exclude non-matching records`);
      assert.equal(await page.getByLabel("Department").count(), 0, `Department filter must be hidden for ${module}`);
      const [moduleExcelDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]); const moduleExcelPath = join(artifactsDir, `${module}.xlsx`); await moduleExcelDownload.saveAs(moduleExcelPath); const moduleWorkbook = XLSX.read(await readFile(moduleExcelPath), { type: "buffer" }); const moduleRows = XLSX.utils.sheet_to_json(moduleWorkbook.Sheets[moduleWorkbook.SheetNames[0]], { header: 1, raw: false }); assert.ok(moduleRows.flat().includes(expectedReference), `${module} Excel must contain the matching record`); assert.ok(!moduleRows.flat().includes(excludedTitle), `${module} Excel must exclude non-matching status data`);
      const [modulePdfDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]); const modulePdfPath = join(artifactsDir, `${module}.pdf`); await modulePdfDownload.saveAs(modulePdfPath); const modulePdfTextPath = join(artifactsDir, `${module}.txt`); await execFileAsync("pdftotext", [modulePdfPath, modulePdfTextPath]); const modulePdfText = await readFile(modulePdfTextPath, "utf8"); assert.match(modulePdfText, new RegExp(`Procure Nexus \\| ${module} \\| Records: 1`), `${module} PDF must reflect only the matching status record`); assert.match(modulePdfText, new RegExp(`Sample:\\s*${expectedReference}`), `${module} PDF must use the matching record as its sample`);
    }
    await moduleSelect.selectOption("rfqs"); await page.getByLabel("Supplier").selectOption(String(supplierId)); await page.getByLabel("Status").selectOption("open"); await page.getByText("Runtime filter RFQ", { exact: true }).waitFor();
    const [rfqExcelDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]);
    const rfqExcelPath = join(artifactsDir, "rfq-report.xlsx"); await rfqExcelDownload.saveAs(rfqExcelPath);
    const rfqWorkbook = XLSX.read(await readFile(rfqExcelPath), { type: "buffer" }); const rfqRows = XLSX.utils.sheet_to_json(rfqWorkbook.Sheets[rfqWorkbook.SheetNames[0]], { header: 1, raw: false });
    assert.ok(rfqRows[0].includes("Reference"), "Filtered RFQ Excel must contain its header"); assert.ok(rfqRows.flat().includes(`RFQ-${testToken}`), "Filtered RFQ Excel must contain the matching RFQ"); assert.ok(!rfqRows.flat().includes(`${reportRequestNumber}-0`), "Filtered RFQ Excel must exclude purchase request rows");
    await moduleSelect.selectOption("requests"); await page.getByLabel("Department").waitFor(); await page.getByLabel("Department").selectOption("Quality assurance"); await page.getByLabel("Supplier").selectOption(String(supplierId)); await page.getByLabel("Status").selectOption("approved");
    const [excelDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Excel" }).click()]);
    const excelPath = join(artifactsDir, "report.xlsx"); await excelDownload.saveAs(excelPath);
    const workbook = XLSX.read(await readFile(excelPath), { type: "buffer" }); const excelRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false });
    const expectedRows = Math.min(10000, reportRowCount);
    assert.equal(excelRows.length, expectedRows + 1, "Excel export must enforce the 10,000-row data limit");
    assert.ok(excelRows[0].includes("Reference"), "Excel export must contain the localized reference header");
    if (reportRowCount === 1) assert.ok(excelRows.flat().includes(`${reportRequestNumber}-0`), "Excel export must contain the first report record");
    else assert.ok(excelRows.slice(1).some(row => row.some(cell => String(cell).startsWith("RPT-"))), "Excel export must contain runtime report data");
    assert.ok(!excelRows.flat().includes("Runtime excluded purchase request"), "Excel export must exclude the non-matching request status");
    if (reportRowCount > 10000) assert.ok(reportRowCount > excelRows.length - 1, "Excel export must exclude source records beyond the cap");
    if (reportRowCount === 1) {
      const [pdfDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]); const pdfPath = join(artifactsDir, "report.pdf"); await pdfDownload.saveAs(pdfPath);
      assert.match((await readFile(pdfPath)).subarray(0, 4).toString("latin1"), /%PDF/, "Expected a valid PDF file");
      const extractedPdfPath = join(artifactsDir, "report.txt"); await execFileAsync("pdftotext", [pdfPath, extractedPdfPath]);
      const pdfText = await readFile(extractedPdfPath, "utf8");
      assert.match(pdfText, /Procure Nexus \| requests/, "PDF must contain the visible report identity"); assert.match(pdfText, /Status: Approved/, "PDF must contain the localized applied status filter");
      const recordCountMatch = pdfText.match(/Records:\s*(\d+)/); assert.equal(Number(recordCountMatch?.[1]), reportRowCount, "PDF KPI must exclude the non-matching request status"); assert.match(pdfText, /Total:\s*\d+/, "PDF must contain the visible value KPI"); assert.match(pdfText, /Fields:\s*requestNumber, title, department, estimatedValue, status, createdAt/, "PDF must contain the exported table headers"); assert.match(pdfText, new RegExp(`Sample:\\s*${reportRequestNumber}-0`), "PDF must contain the report record reference");
      let auditPayload = {}; for (let attempt = 0; attempt < 20; attempt += 1) { const [auditRows] = await db.execute("SELECT newValue FROM auditLogs WHERE userId = ? AND action = 'report.export.pdf' ORDER BY id DESC LIMIT 1", [userId]); auditPayload = JSON.parse(auditRows[0]?.newValue ?? "{}"); if (auditPayload.filters?.status === "approved") break; await new Promise(resolve => setTimeout(resolve, 150)); } assert.equal(auditPayload.filters?.status, "approved", "Audit export must retain the applied status filter");
    }
    assert.deepEqual(pageErrors, [], "Report exports should not cause client-side errors");
    console.log("Runtime locale regression test passed");
  } finally {
    await context.close();
    await browser.close();
  }
}

try { await run(); } finally { await cleanup(); }
