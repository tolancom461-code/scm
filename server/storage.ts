import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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

let cachedS3:
  | { client: S3Client; fileUploadClient: S3Client; settings: S3Settings }
  | null
  | undefined;

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
  const clientConfig = {
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  };
  return (cachedS3 = {
    settings,
    client: new S3Client(clientConfig),
    fileUploadClient: new S3Client({
      ...clientConfig,
      // R2 expects the known Content-Length for this stream. Optional SDK
      // checksum trailers would change it to aws-chunked framing.
      requestChecksumCalculation: "WHEN_REQUIRED",
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

export async function storeDocumentFromFile(
  filePath: string,
  sizeBytes: number
) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
    throw new Error("Invalid staged document size");
  const file = await open(filePath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== sizeBytes)
      throw new Error("Staged document size does not match");

    const remote = s3Storage();
    if (remote) {
      const key = "s3/documents/" + randomUUID();
      const content = file.createReadStream();
      try {
        await remote.fileUploadClient.send(
          new PutObjectCommand({
            Bucket: remote.settings.bucket,
            Key: remoteObjectKey(key),
            Body: content,
            ContentLength: sizeBytes,
            ContentType: "application/octet-stream",
          })
        );
      } finally {
        content.destroy();
      }
      return { key, url: "/documents/files/" + key };
    }

    const key = "local/" + randomUUID();
    await mkdir(resolve(process.env.FILE_STORAGE_DIR || ".data/documents"), {
      recursive: true,
    });
    const path = localDocumentPath(key);
    const destination = await open(path, "wx", 0o600);
    try {
      await pipeline(file.createReadStream(), destination.createWriteStream());
    } catch (error) {
      await destination.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
    return { key, url: "/documents/files/" + key };
  } finally {
    await file.close();
  }
}

async function getRemoteDocument(key: string) {
  const remote = s3Storage();
  if (!remote) throw new Error("S3 storage is not configured");
  const result = await remote.client.send(
    new GetObjectCommand({
      Bucket: remote.settings.bucket,
      Key: remoteObjectKey(key),
    })
  );
  if (!result.Body) throw new Error("Stored object has no content");
  return { content: result.Body, contentLength: result.ContentLength };
}

export async function readStoredDocument(key: string) {
  if (key.startsWith("local/")) return readFile(localDocumentPath(key));
  const { content } = await getRemoteDocument(key);
  return Buffer.from(await content.transformToByteArray());
}

export async function openRemoteDocument(key: string) {
  const { content, contentLength } = await getRemoteDocument(key);
  if (!(content instanceof Readable))
    throw new Error("Stored object does not have a Node readable stream");
  return { content, contentLength };
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
