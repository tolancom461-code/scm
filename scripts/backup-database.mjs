import { connectDatabase } from "./database-connection.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
const db = await connectDatabase();
try {
  await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  const [tables] = await db.query("SHOW TABLES");
  const snapshot = { schema: {}, data: {}, files: {} },
    counts = {};
  for (const row of tables) {
    const name = Object.values(row)[0];
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw Error("Invalid table name");
    snapshot.schema[name] = (
      await db.query(`SHOW CREATE TABLE \`${name}\``)
    )[0][0]["Create Table"];
    snapshot.data[name] = (await db.query(`SELECT * FROM \`${name}\``))[0];
    counts[name] = snapshot.data[name].length;
  }
  for (const file of snapshot.data.documents ?? []) {
    if (!/^local\/[0-9a-f-]{36}$/.test(file.storageKey))
      throw Error("Unsupported attachment path");
    snapshot.files[file.storageKey] = (
      await readFile(
        path.resolve(
          process.env.FILE_STORAGE_DIR || ".data/documents",
          file.storageKey.slice(6)
        )
      )
    ).toString("base64");
  }
  const nonce = randomBytes(12),
    key = createHash("sha256")
      .update(process.env.JWT_SECRET || process.env.DATABASE_URL)
      .digest(),
    cipher = createCipheriv("aes-256-gcm", key, nonce),
    data = Buffer.concat([
      cipher.update(JSON.stringify(snapshot)),
      cipher.final(),
    ]);
  await mkdir(".data/backups", { recursive: true });
  const file = `.data/backups/pscm-${Date.now()}.encrypted.json`;
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    })
  );
  console.log(
    JSON.stringify({
      backup: file,
      tables: tables.length,
      rows: counts,
      attachments: Object.keys(snapshot.files).length,
    })
  );
  await db.commit();
} finally {
  await db.end();
}

