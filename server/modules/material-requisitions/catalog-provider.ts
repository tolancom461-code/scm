import { TRPCError } from "@trpc/server";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { z } from "zod";

const remoteId = z.string().min(1).max(160);
export const catalogItemSchema = z.object({
  id: remoteId,
  code: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  specifications: z.string().max(5000).default(""),
  unit: z.object({
    id: remoteId.optional(),
    code: z.string().min(1).max(100),
    nameAr: z.string().min(1).max(100),
    nameEn: z.string().min(1).max(100),
    nameUr: z.string().min(1).max(100),
  }),
  imageUrl: z.string().url().max(2000).nullable().optional().default(null),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogSearchInput = {
  q?: string;
  page?: number;
  pageSize?: number;
  locale?: "ar" | "en" | "ur";
};
const responseSchema = z.object({
  items: z.array(catalogItemSchema).max(100),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
});
type Failure = "configuration" | "unavailable" | "response" | "image";
const messages: Record<Failure, string> = {
  configuration:
    "ربط الكتالوج غير مهيأ. يلزم إعداد عنوان API في الخادم / Catalog connection is not configured; set the server API URL / کیٹلاگ کا ربط مقرر نہیں؛ سرور پر API کا پتہ درج کریں۔",
  unavailable:
    "تعذر الاتصال بالكتالوج الخارجي. أعد المحاولة / External catalog is unavailable; please retry / بیرونی کیٹلاگ دستیاب نہیں؛ دوبارہ کوشش کریں۔",
  response:
    "بيانات الكتالوج الخارجي غير متوافقة مع الربط / External catalog data does not match the integration contract / بیرونی کیٹلاگ کا ڈیٹا ربط کے معاہدے سے مطابقت نہیں رکھتا۔",
  image:
    "تعذر استيراد صورة الصنف من مصدر الكتالوج المعتمد / The item image could not be imported from the approved catalog source / منظور شدہ کیٹلاگ سے صنف کی تصویر درآمد نہیں ہو سکی۔",
};
export function catalogFailure(kind: Failure): never {
  throw new TRPCError({
    code: kind === "configuration" ? "PRECONDITION_FAILED" : "BAD_REQUEST",
    message: messages[kind],
  });
}

/** Configuration stays server-side; no token or remote endpoint is returned to the browser. */
export function catalogSettings() {
  const raw = process.env.CATALOG_API_URL?.trim();
  if (!raw) return catalogFailure("configuration");
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return catalogFailure("configuration");
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    return catalogFailure("configuration");
  const allowedOrigins = new Set([endpoint.origin]);
  for (const value of (process.env.CATALOG_IMAGE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return catalogFailure("configuration");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return catalogFailure("configuration");
    allowedOrigins.add(parsed.origin);
  }
  return {
    endpoint,
    token: process.env.CATALOG_API_TOKEN?.trim() ?? "",
    allowedOrigins,
  };
}
export function catalogConfigurationStatus() {
  if (!process.env.CATALOG_API_URL?.trim()) return { configured: false };
  try {
    catalogSettings();
    return { configured: true };
  } catch {
    return { configured: false };
  }
}

function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  // Only globally routed IPv6 is eligible for a separately allowed image host.
  const normalized = address.toLowerCase();
  return (
    isIP(address) === 6 &&
    /^[23]/.test(normalized) &&
    !normalized.startsWith("2001:db8:") &&
    !normalized.startsWith("2001:0:") &&
    !normalized.startsWith("2001::") &&
    !normalized.startsWith("2002:")
  );
}

async function pinnedPublicLookup(url: URL): Promise<LookupFunction> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address)))
    return catalogFailure("image");
  const chosen = addresses[0];
  // Prevent a second DNS lookup from resolving a public name to a private target.
  return ((
    _: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void
  ) => {
    if (options.all) callback(null, [chosen]);
    else callback(null, chosen.address, chosen.family);
  }) as LookupFunction;
}

/** Bounded, no-redirect server request, shared by JSON and image import. */
export async function readCatalogResource(
  url: URL,
  options: { maxBytes: number; accept: string; kind: "api" | "image" }
) {
  const config = catalogSettings();
  const sameApiOrigin = url.origin === config.endpoint.origin;
  if (
    url.username ||
    url.password ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (options.kind === "api" && !sameApiOrigin) ||
    (options.kind === "image" &&
      (!config.allowedOrigins.has(url.origin) ||
        (!sameApiOrigin && url.protocol !== "https:")))
  )
    return catalogFailure(options.kind === "image" ? "image" : "configuration");
  let pinned: LookupFunction | undefined;
  try {
    if (!sameApiOrigin) pinned = await pinnedPublicLookup(url);
  } catch {
    return catalogFailure("image");
  }
  const headers: Record<string, string> = { Accept: options.accept };
  if (sameApiOrigin && config.token)
    headers.Authorization = `Bearer ${config.token}`;
  try {
    return await new Promise<{ content: Buffer; contentType: string }>(
      (resolve, reject) => {
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = request(
          url,
          {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(12000),
            agent: false,
            ...(pinned ? { lookup: pinned } : {}),
          },
          response => {
            const status = response.statusCode ?? 0;
            const contentLength = Number(response.headers["content-length"]);
            if (
              status < 200 ||
              status >= 300 ||
              (Number.isFinite(contentLength) &&
                contentLength > options.maxBytes)
            ) {
              response.destroy();
              reject(new Error("REMOTE_REJECTED"));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > options.maxBytes) {
                response.destroy(new Error("REMOTE_TOO_LARGE"));
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            response.on("end", () =>
              resolve({
                content: Buffer.concat(chunks),
                contentType: String(response.headers["content-type"] ?? "")
                  .split(";")[0]
                  .trim()
                  .toLowerCase(),
              })
            );
            response.on("error", reject);
          }
        );
        req.on("error", reject);
        req.end();
      }
    );
  } catch {
    return catalogFailure(options.kind === "image" ? "image" : "unavailable");
  }
}

async function catalogResponse(url: URL) {
  const response = await readCatalogResource(url, {
    maxBytes: 1_000_000,
    accept: "application/json",
    kind: "api",
  });
  if (!/^application\/(?:[a-z0-9.-]+\+)?json$/.test(response.contentType))
    return catalogFailure("response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content.toString("utf8"));
  } catch {
    return catalogFailure("response");
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) return catalogFailure("response");
  if (
    new Set(result.data.items.map(item => item.id)).size !==
    result.data.items.length
  )
    return catalogFailure("response");
  return result.data;
}

export async function searchCatalog(input: CatalogSearchInput) {
  const query = z
    .object({
      q: z.string().trim().max(150).default(""),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      locale: z.enum(["ar", "en", "ur"]).default("ar"),
    })
    .parse(input);
  const url = new URL(catalogSettings().endpoint);
  url.searchParams.set("q", query.q);
  url.searchParams.set("page", String(query.page));
  url.searchParams.set("pageSize", String(query.pageSize));
  url.searchParams.set("locale", query.locale);
  url.searchParams.delete("ids");
  const result = await catalogResponse(url);
  if (
    result.page !== query.page ||
    result.pageSize !== query.pageSize ||
    result.items.length > query.pageSize ||
    result.total < result.items.length
  )
    return catalogFailure("response");
  return result;
}

/** Read the selected identities again; the browser cannot supply trusted item/unit data. */
export async function fetchCatalogItems(
  ids: string[],
  locale: "ar" | "en" | "ur" = "ar"
) {
  const wanted = z.array(remoteId).min(1).max(20).parse(ids);
  if (new Set(wanted).size !== wanted.length) return catalogFailure("response");
  const url = new URL(catalogSettings().endpoint);
  url.searchParams.delete("q");
  url.searchParams.set("ids", JSON.stringify(wanted));
  url.searchParams.set("locale", locale);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(wanted.length));
  const result = await catalogResponse(url);
  if (
    result.items.length !== wanted.length ||
    result.items.some(item => !wanted.includes(item.id))
  )
    return catalogFailure("response");
  const byId = new Map(result.items.map(item => [item.id, item]));
  return wanted.map(id => byId.get(id)!);
}
