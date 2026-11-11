import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as s from "../../../drizzle/construction";
import { database } from "../../core/database";
import type { AccessContext } from "../../core/policy";
import { recordChange } from "../../core/audit";
import { deleteStoredDocument } from "../../storage";
import {
  catalogConfigurationStatus,
  fetchCatalogItems,
  searchCatalog,
} from "./catalog-provider";
import { persistCatalogImage } from "./catalog-media";

export const catalogImageUrl = (id: number) =>
  `/material-requisitions/catalog-images/${id}`;
export const catalogStatus = catalogConfigurationStatus;

function signingKey() {
  const key = process.env.JWT_SECRET;
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "إعدادات الربط غير مكتملة / Integration configuration is incomplete / ربط کی ترتیب مکمل نہیں ہے۔",
    });
  return key;
}

export function previewImageUrl(url: string, userId: number) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(signingKey()).digest(),
    nonce
  );
  const content = Buffer.concat([
    cipher.update(
      JSON.stringify({ url, userId, expires: Date.now() + 5 * 60_000 }),
      "utf8"
    ),
    cipher.final(),
  ]);
  const token = [nonce, content, cipher.getAuthTag()]
    .map(value => value.toString("base64url"))
    .join(".");
  return `/material-requisitions/catalog-preview?token=${token}`;
}

export function validatePreviewToken(
  token: string,
  userId: number
): string | null {
  if (token.length > 5000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const nonce = Buffer.from(parts[0], "base64url"),
      content = Buffer.from(parts[1], "base64url"),
      tag = Buffer.from(parts[2], "base64url");
    if (nonce.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(signingKey()).digest(),
      nonce
    );
    decipher.setAuthTag(tag);
    const data = JSON.parse(
      Buffer.concat([decipher.update(content), decipher.final()]).toString(
        "utf8"
      )
    );
    return data.userId === userId &&
      typeof data.url === "string" &&
      Number.isFinite(data.expires) &&
      data.expires > Date.now()
      ? data.url
      : null;
  } catch {
    return null;
  }
}

export async function catalogSearch(
  input: Parameters<typeof searchCatalog>[0],
  access: AccessContext
) {
  const result = await searchCatalog(input);
  return {
    ...result,
    items: result.items.map(item => ({
      ...item,
      imageUrl: undefined,
      previewUrl: item.imageUrl
        ? previewImageUrl(item.imageUrl, access.user.id)
        : null,
    })),
  };
}

export async function catalogImport(
  ids: string[],
  access: AccessContext,
  locale: "ar" | "en" | "ur" = "ar"
) {
  const remoteItems = await fetchCatalogItems(ids, locale);
  const prepared: {
    item: (typeof remoteItems)[number];
    image: Awaited<ReturnType<typeof persistCatalogImage>> | null;
  }[] = [];
  try {
    for (const item of remoteItems) {
      prepared.push({
        item,
        image: item.imageUrl ? await persistCatalogImage(item.imageUrl) : null,
      });
    }
    return await (
      await database()
    ).transaction(async tx => {
      const result = [];
      const sourceKey = createHash("sha256")
        .update(process.env.CATALOG_API_URL ?? "")
        .digest("hex");
      for (const { item, image } of prepared) {
        // External labels are snapshotted separately, so local master-data changes cannot alter an import.
        await tx
          .insert(s.materialUnits)
          .values({
            code: item.unit.code,
            nameAr: item.unit.nameAr,
            nameEn: item.unit.nameEn,
            nameUr: item.unit.nameUr,
          })
          .onDuplicateKeyUpdate({ set: { code: sql`code` } });
        const [unit] = await tx
          .select()
          .from(s.materialUnits)
          .where(eq(s.materialUnits.code, item.unit.code))
          .for("update");
        if (!unit?.active)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "وحدة الكتالوج معطلة في البرنامج / Catalog unit is inactive / کیٹلاگ کی اکائی غیر فعال ہے۔",
          });
        const importedUnit = {
          ...unit,
          code: item.unit.code,
          nameAr: item.unit.nameAr,
          nameEn: item.unit.nameEn,
          nameUr: item.unit.nameUr,
          externalId: item.unit.id ?? null,
        };
        const [inserted] = await tx.insert(s.materialCatalogEntries).values({
          sourceKey,
          externalId: item.id,
          catalogCode: item.code,
          itemName: item.name,
          unitId: unit.id,
          unitSnapshot: JSON.stringify(importedUnit),
          specifications: item.specifications,
          imageStorageKey: image?.key ?? null,
          imageMimeType: image?.mimeType ?? null,
          imageChecksum: image?.checksum ?? null,
          createdBy: access.user.id,
        });
        const catalogEntryId = Number(inserted.insertId);
        await recordChange(tx, {
          actorId: access.user.id,
          action: "materialCatalog.imported",
          entityType: "pm_material_catalog_entry",
          entityId: catalogEntryId,
          after: {
            externalId: item.id,
            catalogCode: item.code,
            unitId: unit.id,
            imageChecksum: image?.checksum ?? null,
          },
        });
        result.push({
          catalogEntryId,
          catalogCode: item.code,
          itemName: item.name,
          specifications: item.specifications,
          unitId: unit.id,
          unit: importedUnit,
          imageUrl: image ? catalogImageUrl(catalogEntryId) : null,
        });
      }
      return result;
    });
  } catch (error) {
    // Only files created by this failed import are candidates for cleanup.
    await Promise.allSettled(
      prepared.flatMap(row =>
        row.image ? [deleteStoredDocument(row.image.key)] : []
      )
    );
    throw error;
  }
}
