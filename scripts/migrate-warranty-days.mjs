import "dotenv/config";
import mysql from "mysql2/promise";
import { randomBytes, createCipheriv, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
const url = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
try {
  const [before] = await db.query("SELECT * FROM p1_contracts ORDER BY id");
  await mkdir(".data/backups", { recursive: true });
  const nonce = randomBytes(12),
    key = createHash("sha256")
      .update(process.env.JWT_SECRET || process.env.DATABASE_URL)
      .digest(),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(before), "utf8"),
    cipher.final(),
  ]);
  await writeFile(
    `.data/backups/warranty-days-${Date.now()}.encrypted.json`,
    JSON.stringify({
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: bytes.toString("base64"),
    })
  );
  const [cols] = await db.query(
    "SHOW COLUMNS FROM p1_contracts LIKE 'warranty_days'"
  );
  if (!cols.length)
    await db.query(
      "ALTER TABLE p1_contracts ADD COLUMN warranty_days INT NULL"
    );
  // Preserve exact legacy expiry for accepted handovers. Without a handover,
  // use the site date as the conversion anchor; no accepted expiry exists yet.
  await db.query(
    "UPDATE p1_contracts SET warranty_days=DATEDIFF(DATE_ADD(COALESCE(handover_date, site_date), INTERVAL warranty_months MONTH), COALESCE(handover_date, site_date)) WHERE warranty_days IS NULL"
  );
  const [invalid] = await db.query(
    "SELECT id FROM p1_contracts WHERE warranty_days IS NULL OR warranty_days<0"
  );
  if (invalid.length)
    throw new Error("Warranty conversion verification failed");
  for (const c of before.filter(
    c => c.handover_date && c.warranty_days == null
  )) {
    const [check] = await db.query(
      "SELECT DATE_ADD(handover_date, INTERVAL warranty_days DAY)=DATE_ADD(handover_date, INTERVAL warranty_months MONTH) AS same FROM p1_contracts WHERE id=?",
      [c.id]
    );
    if (!check[0].same) throw new Error("Accepted expiry changed");
  }
  await db.query(
    "ALTER TABLE p1_contracts MODIFY warranty_days INT NOT NULL DEFAULT 0, MODIFY warranty_months INT NOT NULL DEFAULT 0"
  );
  const migration = readMigrationFiles({ migrationsFolder: "drizzle" }).find(
    m => m.sql.some(s => s.includes("ADD `warranty_days`"))
  );
  if (!migration) throw new Error("Missing warranty migration");
  const [registered] = await db.query(
    "SELECT hash FROM __drizzle_migrations WHERE created_at=?",
    [migration.folderMillis]
  );
  if (registered.length && registered[0].hash !== migration.hash)
    throw new Error("Migration hash mismatch");
  if (!registered.length)
    await db.query(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [migration.hash, migration.folderMillis]
    );
  console.log(
    JSON.stringify({
      convertedContracts: before.length,
      acceptedExpiryPreserved: true,
    })
  );
} finally {
  await db.end();
}
