import "dotenv/config";
import mysql from "mysql2/promise";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";

const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const baselinePath = ".data/numbering-migration-baseline.json";
try {
  await connection.query("SET time_zone = '+00:00'");
  const [projects] = await connection.query(
    "SELECT id FROM p1_projects ORDER BY id"
  );
  const [contracts] = await connection.query(
    "SELECT id, number FROM p1_contracts ORDER BY id"
  );
  const [certificates] = await connection.query(
    "SELECT id, number FROM p1_certificates ORDER BY id"
  );
  if (process.argv.includes("--before")) {
    await mkdir(".data", { recursive: true });
    await writeFile(
      baselinePath,
      JSON.stringify({ projects, contracts, certificates })
    );
    console.log(
      `Baseline captured: ${projects.length} projects, ${contracts.length} contracts, ${certificates.length} certificates.`
    );
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    assert.deepEqual(projects, baseline.projects);
    assert.deepEqual(contracts, baseline.contracts);
    assert.deepEqual(certificates, baseline.certificates);
    const [rows] = await connection.query(`SELECT number,
      DATE_FORMAT(DATE_ADD(created_at, INTERVAL 3 HOUR), '%y-%m') AS period,
      YEAR(DATE_ADD(created_at, INTERVAL 3 HOUR)) AS issueYear FROM p1_projects`);
    const [counters] = await connection.query(
      "SELECT year, next_value FROM document_sequences WHERE prefix='PRJ'"
    );
    const [columns] = await connection.query(
      "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='p1_projects' AND COLUMN_NAME='number'"
    );
    assert.equal(columns[0].IS_NULLABLE, "NO");
    assert.equal(new Set(rows.map(r => r.number)).size, rows.length);
    for (const row of rows) {
      assert.match(row.number, new RegExp(`^PRJ-${row.period}-[0-9]{4,}$`));
      assert(
        counters.find(c => c.year === row.issueYear)?.next_value >
          Number(row.number.split("-").at(-1))
      );
    }
    await unlink(baselinePath);
    console.log(
      `Migration verified: ${rows.length} project numbers; existing contract/certificate numbers unchanged; counters advanced; NOT NULL enforced.`
    );
  }
} finally {
  await connection.end();
}
