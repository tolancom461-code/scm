import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const cmmsReferenceId = z.number().int().positive().max(2_147_483_647);
export const cmmsReferenceLocale = z.enum(["ar", "en", "ur"]);
type Locale = z.infer<typeof cmmsReferenceLocale>;

const name = z
  .string()
  .min(1)
  .max(255)
  .refine(value => !!value.trim());
const referenceList = z
  .array(z.object({ id: cmmsReferenceId, name }))
  .max(10_000)
  .refine(items => new Set(items.map(item => item.id)).size === items.length);
const purchaseOptions = z.object({
  categories: referenceList,
  reviewRoles: z
    .array(z.object({ code: z.string().regex(/^[a-z0-9_]{1,80}$/), name }))
    .max(100)
    .refine(
      items => new Set(items.map(item => item.code)).size === items.length
    ),
});

const maxResponseBytes = 1_000_000;

function referenceSettings() {
  const url = process.env.CMMS_REFERENCE_API_URL?.trim();
  const token = process.env.CMMS_REFERENCE_API_TOKEN?.trim();
  if (!url || !token || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(token)) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    return null;
  }
  const localHttp =
    process.env.NODE_ENV !== "production" &&
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !localHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    return null;
  return { endpoint, token };
}

export function cmmsReferencesConfigured() {
  return referenceSettings() !== null;
}

function invalidResponse(): never {
  throw new TRPCError({
    code: "BAD_GATEWAY",
    message:
      "بيانات القوائم من CMMS لا تطابق صيغة الربط. / CMMS reference data does not match the integration contract. / CMMS کا حوالہ ڈیٹا انضمام کے معاہدے سے میل نہیں کھاتا۔",
  });
}

function unavailable(): never {
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "تعذّر جلب القوائم من CMMS. أعد المحاولة. / CMMS reference data is unavailable. Please try again. / CMMS کا حوالہ ڈیٹا دستیاب نہیں ہے۔ دوبارہ کوشش کریں۔",
  });
}

async function readReferenceBody(response: Response) {
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();
  const length = Number(response.headers.get("content-length"));
  if (
    !response.body ||
    !/^application\/(?:[a-z0-9.-]+\+)?json$/i.test(contentType ?? "") ||
    length > maxResponseBytes
  ) {
    await response.body?.cancel().catch(() => {});
    return invalidResponse();
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        return invalidResponse();
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    return unavailable();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    return invalidResponse();
  }
}

async function readReferences<T>(
  type: "sites" | "sections" | "assets" | "purchaseOptions",
  schema: z.ZodType<T>,
  locale: Locale,
  parent?: { siteId: number; sectionId?: number }
): Promise<T> {
  const settings = referenceSettings();
  if (!settings) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "ربط القوائم مع CMMS غير مهيّأ. / CMMS reference integration is not configured. / CMMS حوالہ انضمام ترتیب نہیں دیا گیا۔",
    });
  }
  const { endpoint, token } = settings;
  endpoint.searchParams.set("type", type);
  endpoint.searchParams.set("locale", locale);
  if (parent) endpoint.searchParams.set("siteId", String(parent.siteId));
  if (parent?.sectionId !== undefined) {
    endpoint.searchParams.set("sectionId", String(parent.sectionId));
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return unavailable();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return unavailable();
  }
  const result = schema.safeParse(await readReferenceBody(response));
  if (!result.success) return invalidResponse();
  return result.data;
}

export function readCmmsSites(locale: Locale = "ar") {
  return readReferences("sites", referenceList, locale);
}

export function readCmmsSections(siteId: number, locale: Locale = "ar") {
  return readReferences("sections", referenceList, locale, { siteId });
}

export function readCmmsAssets(
  siteId: number,
  sectionId: number,
  locale: Locale = "ar"
) {
  return readReferences("assets", referenceList, locale, { siteId, sectionId });
}

export function readCmmsPurchaseOptions(locale: Locale = "ar") {
  return readReferences("purchaseOptions", purchaseOptions, locale);
}
