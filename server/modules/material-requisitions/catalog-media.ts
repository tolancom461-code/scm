import { createHash } from "node:crypto";
import { storeDocument } from "../../storage";
import { catalogFailure, readCatalogResource } from "./catalog-provider";

export function catalogImageMime(content: Uint8Array): string | null {
  const header = Buffer.from(content.subarray(0, 16));
  if (
    header.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => header[i] === value)
  )
    return "image/png";
  if (
    header.length >= 3 &&
    header[0] === 255 &&
    header[1] === 216 &&
    header[2] === 255
  )
    return "image/jpeg";
  if (/^GIF8[79]a/.test(header.toString("ascii"))) return "image/gif";
  if (
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

export async function fetchCatalogImage(imageUrl: string) {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return catalogFailure("image");
  }
  const { content } = await readCatalogResource(url, {
    maxBytes: 5_000_000,
    accept: "image/png,image/jpeg,image/webp,image/gif",
    kind: "image",
  });
  const mimeType = catalogImageMime(content);
  if (!content.length || !mimeType) return catalogFailure("image");
  return { content, mimeType };
}

/** A fresh immutable object is captured at import, using PSCM's configured S3/local storage. */
export async function persistCatalogImage(imageUrl: string) {
  const { content, mimeType } = await fetchCatalogImage(imageUrl);
  try {
    const stored = await storeDocument(content);
    return {
      ...stored,
      mimeType,
      checksum: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.length,
    };
  } catch {
    return catalogFailure("image");
  }
}
