import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
export function localDocumentPath(key: string) {
  if (!/^local\/[0-9a-f-]{36}$/.test(key))
    throw new Error("Invalid local storage key");
  return resolve(
    process.env.FILE_STORAGE_DIR || ".data/documents",
    key.slice(6)
  );
}
export async function storeDocument(content: Buffer) {
  const key = "local/" + randomUUID();
  await mkdir(resolve(process.env.FILE_STORAGE_DIR || ".data/documents"), {
    recursive: true,
  });
  await writeFile(localDocumentPath(key), content, { flag: "wx" });
  return { key, url: "/documents/files/" + key };
}
