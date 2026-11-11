import { connectDatabase } from "./database-connection.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

function s3Client() {
  const endpoint = process.env.S3_ENDPOINT?.trim(),
    region = process.env.S3_REGION?.trim(),
    accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim(),
    secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim(),
    bucket = process.env.S3_BUCKET?.trim();
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket)
    return null;
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}
const db = await connectDatabase();
try {
  await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  const [tables] = await db.query("SHOW TABLES");
  const snapshot = { schema: {}, data: {}, files: {}, missingFiles: [] },
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
  const remote = s3Client();
  const storedFiles = [
    ...(snapshot.data.documents ?? []).map(file => ({
      ...file,
      entity: "document",
    })),
    ...(snapshot.data.pm_material_catalog_entries ?? [])
      .filter(entry => entry.image_storage_key)
      .map(entry => ({
        id: entry.id,
        storageKey: entry.image_storage_key,
        entity: "catalog_image",
      })),
  ];
  for (const file of storedFiles) {
    if (snapshot.files[file.storageKey]) continue;
    try {
      if (/^local\/[0-9a-f-]{36}$/.test(file.storageKey)) {
        snapshot.files[file.storageKey] = (
          await readFile(
            path.resolve(
              process.env.FILE_STORAGE_DIR || ".data/documents",
              file.storageKey.slice(6)
            )
          )
        ).toString("base64");
      } else if (
        /^s3\/documents\/[0-9a-f-]{36}$/.test(file.storageKey) &&
        remote
      ) {
        const result = await remote.client.send(
          new GetObjectCommand({
            Bucket: remote.bucket,
            Key: file.storageKey.slice(3),
          })
        );
        if (!result.Body) throw Error("Empty S3 object");
        snapshot.files[file.storageKey] = Buffer.from(
          await result.Body.transformToByteArray()
        ).toString("base64");
      } else {
        throw Error("Unsupported or unconfigured attachment storage");
      }
    } catch (error) {
      snapshot.missingFiles.push({
        entity: file.entity,
        id: file.id,
        storageKey: file.storageKey,
        reason:
          error instanceof Error ? error.code || error.message : "UNKNOWN",
      });
    }
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
      missingAttachments: snapshot.missingFiles.length,
    })
  );
  await db.commit();
} finally {
  await db.end();
}
