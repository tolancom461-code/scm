import "dotenv/config";
import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import mysql from "mysql2/promise";

// Explicit maintenance command: the live application must be stopped first.
const retained = new Set([
  "users",
  "permissions",
  "userPermissions",
  "access_profiles",
  "sessions",
  "document_sequences",
  "__drizzle_migrations",
]);
const quote = name => "`" + name.replaceAll("`", "``") + "`";
const digest = value => createHash("sha256").update(value).digest("hex");
const backupRoot = resolve(".data/backups");
function sameData(actual, expected, message) {
  assert(
    digest(JSON.stringify(actual)) === digest(JSON.stringify(expected)),
    message
  );
}
function backupPath(path) {
  const target = resolve(path),
    inside = relative(backupRoot, target);
  assert(
    inside && !inside.startsWith("..") && !isAbsolute(inside),
    "Backup must be inside this workspace backup directory."
  );
  return target;
}
function dpapi(data, method) {
  assert(["Protect", "Unprotect"].includes(method));
  const script = `Add-Type -AssemblyName System.Security; $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $outputBytes = [System.Security.Cryptography.ProtectedData]::${method}($inputBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      input: data.toString("base64"),
      encoding: "utf8",
      timeout: 30000,
    }
  );
  if (result.status !== 0 || result.error)
    throw new Error(
      "Windows backup key protection failed. No cleanup performed."
    );
  return Buffer.from(result.stdout.trim(), "base64");
}
async function decryptBackup(path) {
  const envelope = JSON.parse(await readFile(backupPath(path), "utf8"));
  assert.equal(envelope.format, "procure-nexus-owner-reset-v1");
  const key = dpapi(Buffer.from(envelope.wrappedKey, "base64"), "Unprotect");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  assert.equal(
    digest(plain),
    envelope.sha256,
    "Backup integrity check failed."
  );
  return JSON.parse(plain.toString("utf8"));
}
const mode = process.argv[2];
if (mode === "--verify-backup") {
  const snapshot = await decryptBackup(process.argv[3]);
  console.log(
    JSON.stringify({
      backupVerified: true,
      tables: snapshot.tables.length,
      rows: snapshot.tables.reduce((n, t) => n + t.rows.length, 0),
    })
  );
  process.exit(0);
}
assert(
  ["--backup", "--execute", "--verify-state"].includes(mode),
  "Use --backup, --execute <backup>, --verify-backup <backup>, or --verify-state."
);
const url = new URL(process.env.DATABASE_URL);
const targetFingerprint = digest(
  `${url.hostname}:${url.port || 3306}${url.pathname}`
);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
let activeTransaction = false;
async function metadata() {
  const [integrity] = await connection.query(
    "SELECT @@SESSION.foreign_key_checks AS enabled"
  );
  assert.equal(
    Number(integrity[0].enabled),
    1,
    "Foreign key checking must stay enabled."
  );
  const [tables] = await connection.query(
    "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
  );
  assert(
    tables.length === 95 && tables.every(t => t.engine === "InnoDB"),
    "Unexpected schema or nontransactional tables."
  );
  const [keys] = await connection.query(
    "SELECT k.TABLE_NAME AS child, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS parent, c.IS_NULLABLE AS nullable FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=k.TABLE_SCHEMA AND c.TABLE_NAME=k.TABLE_NAME AND c.COLUMN_NAME=k.COLUMN_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL"
  );
  const pending = new Set(
      tables.map(t => t.name).filter(name => !retained.has(name))
    ),
    order = [];
  while (pending.size) {
    const leaves = [...pending].filter(
      name =>
        !keys.some(
          k => k.parent === name && k.child !== name && pending.has(k.child)
        )
    );
    assert(
      leaves.length,
      "Cyclic dependencies: cleanup aborted before deletion."
    );
    for (const name of leaves) {
      order.push(name);
      pending.delete(name);
    }
  }
  const self = keys.filter(
    k => k.child === k.parent && order.includes(k.child)
  );
  assert(
    self.every(k => k.nullable === "YES"),
    "Unsupported self reference."
  );
  const [owners] = await connection.query(
    "SELECT * FROM users WHERE username=?",
    ["admin"]
  );
  assert(
    owners.length === 1 &&
      owners[0].name === "System Owner" &&
      owners[0].role === "admin" &&
      Number(owners[0].active) === 1 &&
      owners[0].passwordHash,
    "Expected active admin — System Owner account is missing."
  );
  return { tables, order, self, owner: owners[0] };
}
async function rowsFor(name) {
  const [columns] = await connection.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_KEY='PRI' ORDER BY ORDINAL_POSITION",
    [name]
  );
  const order = columns.length
    ? " ORDER BY " + columns.map(c => quote(c.name)).join(", ")
    : "";
  const [rows] = await connection.query(`SELECT * FROM ${quote(name)}${order}`);
  return rows;
}
async function verifyState(meta, originalOwner) {
  const [owners] = await connection.query("SELECT * FROM users");
  assert.equal(owners.length, 1, "There must be exactly one user.");
  sameData(owners[0], originalOwner, "Owner identity or credentials changed.");
  for (const table of meta.order) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${quote(table)}`
    );
    assert.equal(
      Number(rows[0].count),
      0,
      `Operational table not empty: ${table}`
    );
  }
  for (const [table, field] of [
    ["userPermissions", "userId"],
    ["access_profiles", "user_id"],
    ["sessions", "userId"],
  ]) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${quote(table)} WHERE ${quote(field)} <> ?`,
      [meta.owner.id]
    );
    assert.equal(
      Number(rows[0].count),
      0,
      `Other user records remain in ${table}`
    );
  }
  const [profiles] = await connection.query(
    "SELECT * FROM access_profiles WHERE user_id=?",
    [meta.owner.id]
  );
  assert(
    profiles.length === 1 &&
      Number(profiles[0].all_projects) === 1 &&
      Number(profiles[0].legacy_access) === 1,
    "Owner policy must remain unrestricted."
  );
  const [permissions] = await connection.query(
    "SELECT COUNT(*) AS count FROM permissions"
  );
  assert.equal(
    Number(permissions[0].count),
    77,
    "Permission definitions changed."
  );
  return {
    remainingUsers: [
      { username: "admin", name: "System Owner", role: "admin", active: true },
    ],
    operationalTablesEmpty: meta.order.length,
    passwordUnchanged: true,
    ownerAccessPreserved: true,
    permissionDefinitions: Number(permissions[0].count),
  };
}
try {
  const meta = await metadata();
  if (mode === "--backup") {
    await connection.beginTransaction();
    activeTransaction = true;
    const snapshot = {
      createdAt: new Date().toISOString(),
      targetFingerprint,
      ownerId: meta.owner.id,
      tables: [],
    };
    for (const table of meta.tables) {
      const [ddl] = await connection.query(
        `SHOW CREATE TABLE ${quote(table.name)}`
      );
      snapshot.tables.push({
        name: table.name,
        ddl: ddl[0]["Create Table"],
        rows: await rowsFor(table.name),
      });
    }
    await connection.commit();
    activeTransaction = false;
    const key = randomBytes(32),
      iv = randomBytes(12),
      plain = Buffer.from(JSON.stringify(snapshot));
    const wrappedKey = dpapi(key, "Protect");
    sameData(
      dpapi(wrappedKey, "Unprotect"),
      key,
      "Backup key cannot be recovered."
    );
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const envelope = {
      format: "procure-nexus-owner-reset-v1",
      createdAt: snapshot.createdAt,
      wrappedKey: wrappedKey.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      sha256: digest(plain),
      ciphertext: ciphertext.toString("base64"),
    };
    await mkdir(backupRoot, { recursive: true });
    const path = backupPath(
      resolve(
        backupRoot,
        `owner-reset-${snapshot.createdAt.replaceAll(":", "-")}.encrypted.json`
      )
    );
    await writeFile(path, JSON.stringify(envelope), {
      flag: "wx",
      mode: 0o600,
    });
    sameData(
      await decryptBackup(path),
      snapshot,
      "Saved backup verification failed."
    );
    console.log(
      JSON.stringify({
        backup: path,
        verified: true,
        tables: snapshot.tables.length,
        totalRows: snapshot.tables.reduce((n, t) => n + t.rows.length, 0),
        usersToRemove:
          snapshot.tables.find(t => t.name === "users").rows.length - 1,
        operationalTablesToClear: meta.order.length,
      })
    );
  } else if (mode === "--execute") {
    const snapshot = await decryptBackup(process.argv[3]);
    assert.equal(
      snapshot.targetFingerprint,
      targetFingerprint,
      "Backup belongs to another database."
    );
    assert.equal(snapshot.ownerId, meta.owner.id);
    sameData(
      snapshot.tables.map(t => t.name),
      meta.tables.map(t => t.name),
      "Schema changed since backup."
    );
    const owner = snapshot.tables
      .find(t => t.name === "users")
      .rows.find(u => u.id === meta.owner.id);
    sameData(owner, meta.owner, "Owner changed since backup.");
    await connection.beginTransaction();
    activeTransaction = true;
    for (const table of snapshot.tables)
      sameData(
        await rowsFor(table.name),
        table.rows,
        `Data changed since backup: ${table.name}. Create a fresh backup first.`
      );
    for (const table of meta.order) {
      if (!snapshot.tables.find(t => t.name === table).rows.length) continue;
      for (const key of meta.self.filter(k => k.child === table))
        await connection.query(
          `UPDATE ${quote(table)} SET ${quote(key.columnName)}=NULL WHERE ${quote(key.columnName)} IS NOT NULL`
        );
      await connection.query(`DELETE FROM ${quote(table)}`);
    }
    for (const [table, field] of [
      ["sessions", "userId"],
      ["userPermissions", "userId"],
      ["access_profiles", "user_id"],
    ])
      await connection.query(
        `DELETE FROM ${quote(table)} WHERE ${quote(field)} <> ?`,
        [meta.owner.id]
      );
    const [removed] = await connection.query(
      "DELETE FROM users WHERE id <> ?",
      [meta.owner.id]
    );
    const result = await verifyState(meta, owner);
    for (const table of [
      "permissions",
      "document_sequences",
      "__drizzle_migrations",
    ])
      sameData(
        await rowsFor(table),
        snapshot.tables.find(t => t.name === table).rows,
        `Technical data changed: ${table}`
      );
    const retainedTables = [
      ["userPermissions", "userId"],
      ["access_profiles", "user_id"],
      ["sessions", "userId"],
    ];
    for (const [table, field] of retainedTables)
      sameData(
        await rowsFor(table),
        snapshot.tables
          .find(t => t.name === table)
          .rows.filter(row => row[field] === meta.owner.id),
        `Owner technical data changed: ${table}`
      );
    await connection.commit();
    activeTransaction = false;
    const report = {
      ...result,
      removedUsers: removed.affectedRows,
      backup: backupPath(process.argv[3]),
      completedAt: new Date().toISOString(),
      documentCountersUnchanged: true,
      migrationHistoryUnchanged: true,
      foreignKeysKeptEnabled: true,
    };
    await writeFile(
      resolve(backupRoot, "last-owner-reset-report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report));
  } else console.log(JSON.stringify(await verifyState(meta, meta.owner)));
} finally {
  if (activeTransaction) await connection.rollback();
  await connection.end();
}
