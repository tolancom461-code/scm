import "dotenv/config";
import mysql from "mysql2/promise";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
// Separate disposable tables: never modify application tables or counters.
const token = randomUUID().replaceAll("-", "").slice(0, 12);
const projects = `nrtest_projects_${token}`,
  sequences = `nrtest_sequences_${token}`;
assert.match(projects, /^nrtest_projects_[a-f0-9]{12}$/);
assert.match(sequences, /^nrtest_sequences_[a-f0-9]{12}$/);
try {
  await connection.query("SET time_zone = '+00:00'");
  await connection.query(
    `CREATE TABLE \`${projects}\` (id int PRIMARY KEY, created_at timestamp NOT NULL)`
  );
  await connection.query(
    `CREATE TABLE \`${sequences}\` (prefix varchar(12) NOT NULL, year int NOT NULL, next_value int NOT NULL, UNIQUE(prefix, year))`
  );
  await connection.query(
    `INSERT INTO \`${projects}\` VALUES (1, '2026-10-01 00:00:00'), (2, '2026-11-01 00:00:00'), (3, '2026-12-31 21:00:00'), (4, '2025-01-01 00:00:00')`
  );
  await connection.query(
    `INSERT INTO \`${sequences}\` VALUES ('PRJ', 2026, 6), ('PRJ', 2025, 10000)`
  );
  const migration = (await readFile("drizzle/0011_uneven_bug.sql", "utf8"))
    .replaceAll("`p1_projects`", `\`${projects}\``)
    .replaceAll("`document_sequences`", `\`${sequences}\``);
  for (const statement of migration.split("--> statement-breakpoint"))
    if (statement.trim()) await connection.query(statement);
  const [rows] = await connection.query(
    `SELECT id, number FROM \`${projects}\` ORDER BY id`
  );
  assert.deepEqual(
    rows.map(r => r.number),
    ["PRJ-26-10-0006", "PRJ-26-11-0007", "PRJ-27-01-0001", "PRJ-25-01-10000"]
  );
  const [counters] = await connection.query(
    `SELECT year, next_value FROM \`${sequences}\` ORDER BY year`
  );
  assert.deepEqual(
    counters.map(r => [r.year, r.next_value]),
    [
      [2025, 10001],
      [2026, 8],
      [2027, 2],
    ]
  );
  await assert.rejects(
    connection.query(
      `INSERT INTO \`${projects}\` VALUES (5, '2026-10-01 00:00:00', 'PRJ-26-10-0006')`
    ),
    e => e.code === "ER_DUP_ENTRY"
  );
  console.log(
    "Numbering migration passed on populated isolated tables: Riyadh dates, annual sequence continuity, existing counter offsets, serials above 9999 and unique constraint."
  );
} finally {
  try {
    await connection.query(`DROP TABLE IF EXISTS \`${projects}\``);
    await connection.query(`DROP TABLE IF EXISTS \`${sequences}\``);
  } finally {
    await connection.end();
  }
}
