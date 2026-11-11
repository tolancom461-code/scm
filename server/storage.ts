import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type S3Settings = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

let cachedS3: { client: S3Client; settings: S3Settings } | null | undefined;

function s3Storage() {
  if (cachedS3 !== undefined) return cachedS3;
  const values = {
    endpoint: process.env.S3_ENDPOINT?.trim() ?? "",
    region: process.env.S3_REGION?.trim() ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() ?? "",
    bucket: process.env.S3_BUCKET?.trim() ?? "",
  };
  const configured = Object.values(values).filter(Boolean).length;
  if (!configured) return (cachedS3 = null);
  if (configured !== Object.keys(values).length)
    throw new Error("S3 storage configuration is incomplete");
  const settings: S3Settings = {
    ...values,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  };
  return (cachedS3 = {
    settings,
    client: new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }),
  });
}

function remoteObjectKey(key: string) {
  const match = /^s3\/documents\/([0-9a-f-]{36})$/.exec(key);
  if (!match) throw new Error("Invalid S3 storage key");
  return "documents/" + match[1];
}

export function localDocumentPath(key: string) {
  if (!/^local\/[0-9a-f-]{36}$/.test(key))
    throw new Error("Invalid local storage key");
  return resolve(
    process.env.FILE_STORAGE_DIR || ".data/documents",
    key.slice(6)
  );
}
export async function storeDocument(content: Buffer) {
  const remote = s3Storage();
  if (remote) {
    const id = randomUUID();
    await remote.client.send(
      new PutObjectCommand({
        Bucket: remote.settings.bucket,
        Key: "documents/" + id,
        Body: content,
        ContentType: "application/octet-stream",
      })
    );
    const key = "s3/documents/" + id;
    return { key, url: "/documents/files/" + key };
  }
  const key = "local/" + randomUUID();
  await mkdir(resolve(process.env.FILE_STORAGE_DIR || ".data/documents"), {
    recursive: true,
  });
  await writeFile(localDocumentPath(key), content, { flag: "wx" });
  return { key, url: "/documents/files/" + key };
}

export async function readStoredDocument(key: string) {
  if (key.startsWith("local/")) return readFile(localDocumentPath(key));
  const remote = s3Storage();
  if (!remote) throw new Error("S3 storage is not configured");
  const result = await remote.client.send(
    new GetObjectCommand({
      Bucket: remote.settings.bucket,
      Key: remoteObjectKey(key),
    })
  );
  if (!result.Body) throw new Error("Stored object has no content");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteStoredDocument(key: string) {
  if (key.startsWith("local/")) {
    await unlink(localDocumentPath(key));
    return;
  }
  const remote = s3Storage();
  if (!remote) throw new Error("S3 storage is not configured");
  await remote.client.send(
    new DeleteObjectCommand({
      Bucket: remote.settings.bucket,
      Key: remoteObjectKey(key),
    })
  );
}

export async function verifyDocumentStorage() {
  const remote = s3Storage();
  if (!remote) return { mode: "local" as const };
  await remote.client.send(
    new HeadBucketCommand({ Bucket: remote.settings.bucket })
  );
  return { mode: "s3" as const, bucket: remote.settings.bucket };
}
