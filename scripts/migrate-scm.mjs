import "dotenv/config";
import mysql from "mysql2/promise";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
// Validate generated names before issuing any DDL; MySQL and TiDB allow 64 characters.
for(const migration of readMigrationFiles({migrationsFolder:"drizzle"}))for(const statement of migration.sql)for(const match of statement.matchAll(/(?:CONSTRAINT|INDEX|KEY)\s+`([^`]+)`/gi))if(match[1].length>64)throw new Error("Migration identifier exceeds 64 characters: "+match[1]);
const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const identifier = name => `\`${String(name).replaceAll("`", "``")}\``;
const normalizeType = value =>
  value
    .toLowerCase()
    .replace(/\bint\(\d+\)/g, "int")
    .replace(/^boolean$/, "tinyint")
    .replace(/^tinyint\(1\)$/, "tinyint")
    .replaceAll(" ", "");
try {
  const [tables] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  const businessTables = tables.filter(t => t.name !== "__drizzle_migrations");
  // Back up every current CREATE TABLE statement before any schema mutation.
  const backup = [];
  for (const table of businessTables) {
    const [rows] = await connection.query(
      `SHOW CREATE TABLE ${identifier(table.name)}`
    );
    backup.push({ table: table.name, sql: rows[0]["Create Table"] });
  }
  const backupDir = resolve("docs", "baseline-scm", "database");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  await writeFile(
    resolve(backupDir, `${stamp}-schema.json`),
    JSON.stringify(backup, null, 2)
  );

  await connection.query(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)"
  );
  const [history] = await connection.query(
    "SELECT id, created_at FROM __drizzle_migrations ORDER BY created_at DESC"
  );
  if (
    (!history.length || Number(history[0].created_at) < 1787768322788) &&
    businessTables.length
  ) {
    if (!process.argv.includes("--baseline-prototype"))
      throw new Error(
        "Existing schema has no migration history. Inspect it, then use --baseline-prototype; schema drift will abort."
      );
    const expected = JSON.parse(
      await readFile("drizzle/meta/0004_snapshot.json", "utf8")
    );
    const differences = [];
    for (const table of Object.values(expected.tables)) {
      const [columns] = await connection.query(
        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        [table.name]
      );
      if (!columns.length) {
        differences.push(`${table.name}: missing table`);
        continue;
      }
      if (columns.length !== Object.keys(table.columns).length)
        differences.push(`${table.name}: column count differs`);
      for (const column of Object.values(table.columns)) {
        const actual = columns.find(c => c.name === column.name);
        if (
          !actual ||
          normalizeType(actual.type) !== normalizeType(column.type) ||
          (actual.nullable === "NO") !== column.notNull ||
          actual.extra.includes("auto_increment") !==
            Boolean(column.autoincrement)
        )
          differences.push(
            `${table.name}.${column.name}: column contract differs`
          );
      }
      const [indexes] = await connection.query(
        "SELECT INDEX_NAME AS name, COLUMN_NAME AS col, SEQ_IN_INDEX AS position, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        [table.name]
      );
      const required = [
        ...Object.values(table.indexes).map(i => ({
          columns: i.columns,
          unique: i.isUnique,
        })),
        ...Object.values(table.uniqueConstraints ?? {}).map(i => ({
          columns: i.columns,
          unique: true,
        })),
        ...Object.values(table.compositePrimaryKeys ?? {}).map(i => ({
          columns: i.columns,
          unique: true,
        })),
      ];
      for (const requiredIndex of required) {
        const groups = [...new Set(indexes.map(i => i.name))].map(n =>
          indexes.filter(i => i.name === n)
        );
        if (
          !groups.some(
            g =>
              JSON.stringify(g.map(i => i.col)) ===
                JSON.stringify(requiredIndex.columns) &&
              (!requiredIndex.unique || Number(g[0].nonUnique) === 0)
          )
        )
          differences.push(
            `${table.name}: required index missing (${requiredIndex.columns.join(",")})`
          );
      }
    }
    if (differences.length)
      throw new Error(
        `Prototype baseline mismatch:\n${differences.join("\n")}`
      );
    // Mark only verified historical migrations. No existing rows or tables are deleted.
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    await connection.beginTransaction();
    try {
      for (const migration of migrations.slice(0, 5)) {
        if (!history.some(h => Number(h.created_at) === migration.folderMillis))
          await connection.query(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
            [migration.hash, migration.folderMillis]
          );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    console.log(
      "Verified and registered the existing prototype baseline (5 migrations)."
    );
  }
  // Apply Drizzle-generated SQL explicitly. MySQL DDL is not transactional; record a
  // migration only after every statement succeeds. Never silently skip failed DDL.
  const [applied] = await connection.query(
    "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1"
  );
  const lastApplied = Number(applied[0]?.created_at ?? 0);
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8")
  );
  for (const [migrationIndex, migration] of readMigrationFiles({
    migrationsFolder: "drizzle",
  }).entries()) {
    if (migration.folderMillis <= lastApplied) continue;
    const resume = process.argv.includes("--resume-verified");
    const snapshot = resume
      ? JSON.parse(
          await readFile(
            "drizzle/meta/" +
              String(journal.entries[migrationIndex].idx).padStart(4, "0") +
              "_snapshot.json",
            "utf8"
          )
        )
      : null;
    for (const statement of migration.sql) {
      if (!statement.trim()) continue;
      // Recovery is opt-in. Existing DDL is skipped only after inspecting its shape.
      const create = statement.trim().match(/^CREATE TABLE `([^`]+)`/);
      if (resume && create) {
        const [columns] = await connection.query(
          "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
          [create[1]]
        );
        if (columns.length) {
          const expected = Object.values(snapshot.tables[create[1]].columns);
          if (
            columns.length !== expected.length ||
            expected.some(
              c =>
                !columns.some(
                  a =>
                    a.name === c.name &&
                    normalizeType(a.type) === normalizeType(c.type) &&
                    (a.nullable === "NO") === c.notNull
                )
            )
          )
            throw new Error("Partial migration schema mismatch: " + create[1]);
          const [indexes] = await connection.query(
            "SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY SEQ_IN_INDEX",
            [create[1]]
          );
          const primary = expected.filter(c => c.primaryKey).map(c => c.name);
          if (
            primary.length &&
            JSON.stringify(
              indexes.filter(i => i.name === "PRIMARY").map(i => i.col)
            ) !== JSON.stringify(primary)
          )
            throw new Error("Primary key mismatch: " + create[1]);
          for (const idx of Object.values(
            snapshot.tables[create[1]].indexes
          ).filter(i => i.isUnique)) {
            const existing = indexes.filter(i => i.name === idx.name);
            if (
              !existing.length ||
              existing.some(i => Number(i.nonUnique) !== 0) ||
              JSON.stringify(existing.map(i => i.col)) !==
                JSON.stringify(idx.columns)
            )
              throw new Error("Unique key mismatch: " + idx.name);
          }
          continue;
        }
      }
      const fk = statement
        .trim()
        .match(
          /^ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)`\(`([^`]+)`\)/
        );
      if (resume && fk) {
        const [existing] = await connection.query(
          "SELECT COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refCol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?",
          [fk[1], fk[2]]
        );
        if (existing.length) {
          if (
            existing.length !== 1 ||
            existing[0].col !== fk[3] ||
            existing[0].refTable !== fk[4] ||
            existing[0].refCol !== fk[5]
          )
            throw new Error("Foreign key mismatch: " + fk[2]);
          continue;
        }
      }
      await connection.query(statement);
    }
    await connection.query(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      [migration.hash, migration.folderMillis]
    );
  }
  console.log(
    "SCM migrations applied; existing business data retained. Schema backup saved."
  );
} finally {
  await connection.end();
}
