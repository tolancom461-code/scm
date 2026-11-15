import { z } from "zod";
import { dateInput } from "../../../shared/validation";

const id = z.number().int().min(1).max(2147483647);
const name = z.string().trim().min(1).max(255);
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    id,
    number: z.string().min(1).max(50),
    name,
    cmmsSiteId: id,
    cmmsSectionId: id,
    cmmsAssetId: id.nullish(),
  }),
  task: z.object({ id, name }).nullable(),
  items: z.array(z.object({
    sequence: id,
    itemName: name,
    catalogItemId: z.string().min(1).max(160).nullish(),
    catalogCode: z.string().max(255).default(""),
    quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,9})?$/).refine(value => Number(value) > 0),
    unit: z.object({
      code: z.string().min(1).max(100),
      nameAr: z.string().min(1).max(100),
      nameEn: z.string().min(1).max(100),
      nameUr: z.string().min(1).max(100),
    }),
    specifications: z.string().max(5000),
    notes: z.string().max(5000),
    needDate: dateInput,
    cmmsCategoryId: id,
    cmmsReviewRole: z.string().min(1).max(80),
  })).min(1).max(20),
});

export type CmmsPurchaseSettings = { endpoint: URL; token: string; instanceId: string };

export function cmmsPurchaseSettings(env = process.env): CmmsPurchaseSettings | null {
  const rawUrl = env.CMMS_PURCHASE_API_URL?.trim();
  const token = env.CMMS_PURCHASE_API_TOKEN?.trim();
  const instanceId = env.CMMS_PURCHASE_SOURCE_ID?.trim() || "pscm";
  if (!rawUrl || !token || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(token) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) return null;
  try {
    const endpoint = new URL(rawUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    const allowLocal = env.NODE_ENV !== "production" && local && endpoint.protocol === "http:";
    if (
      (!allowLocal && endpoint.protocol !== "https:") ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    ) return null;
    return { endpoint, token, instanceId };
  } catch {
    return null;
  }
}

type ApprovedRequest = {
  id: number;
  number: string;
  approvedAt: Date | null;
  approvedSnapshot: string | null;
};

export function cmmsPurchasePayload(request: ApprovedRequest, instanceId: string) {
  const { approvedSnapshot, approvedAt } = request;
  if (!approvedSnapshot || !approvedAt) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(approvedSnapshot);
  } catch {
    return null;
  }
  const snapshot = snapshotSchema.safeParse(raw);
  if (!snapshot.success) return null;
  const { project, task, items } = snapshot.data;
  return {
    schemaVersion: 1 as const,
    idempotencyKey: `${instanceId}:${request.number}`,
    source: {
      system: "PSCM" as const,
      instanceId,
      requisitionId: request.id,
      requisitionNumber: request.number,
      approvedAt: approvedAt.toISOString(),
      project: { id: project.id, number: project.number, name: project.name },
      task,
    },
    items: items.map(({ cmmsCategoryId, cmmsReviewRole, ...item }) => ({
      ...item,
      catalogItemId: item.catalogItemId ?? null,
      siteId: project.cmmsSiteId,
      sectionId: project.cmmsSectionId,
      assetId: project.cmmsAssetId ?? null,
      categoryId: cmmsCategoryId,
      reviewRole: cmmsReviewRole,
    })),
  };
}

const confirmationSchema = z.object({
  purchaseRequestId: id,
  purchaseRequestNumber: z.string().regex(/^PR-\d{4}-\d{4,}$/).max(100),
});

export type CmmsPurchaseResponse =
  | { ok: true; number: string; referenceUrl: string }
  | { ok: false; retryable: boolean; message: string };

const unavailable = { ok: false, retryable: true, message: "تعذر الاتصال بخدمة الشراء في CMMS. ستتم إعادة المحاولة." } as const;
const invalidConfirmation = { ok: false, retryable: true, message: "لم يعد CMMS رقم طلب شراء صالحًا. ستتم إعادة المحاولة." } as const;

export async function sendCmmsPurchase(
  settings: CmmsPurchaseSettings,
  payload: NonNullable<ReturnType<typeof cmmsPurchasePayload>>,
  request: typeof fetch = fetch
): Promise<CmmsPurchaseResponse> {
  try {
    const response = await request(settings.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": payload.idempotencyKey,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        return { ok: false, retryable: true, message: "رفض CMMS رمز ربط الشراء. راجع إعدادات الاتصال." };
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        return { ok: false, retryable: false, message: "رفض CMMS بيانات الاحتياج. راجع بيانات البنود وسجل التكامل." };
      }
      return unavailable;
    }
    const reader = response.body?.getReader();
    if (!reader) return invalidConfirmation;
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          return invalidConfirmation;
        }
        chunks.push(Buffer.from(value));
      }
      const confirmed = confirmationSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!confirmed.success) return invalidConfirmation;
      const { purchaseRequestId, purchaseRequestNumber } = confirmed.data;
      return {
        ok: true,
        number: purchaseRequestNumber,
        referenceUrl: new URL(`/purchase-orders/${purchaseRequestId}`, settings.endpoint).href,
      };
    } catch {
      return invalidConfirmation;
    } finally {
      reader.releaseLock();
    }
  } catch {
    return unavailable;
  }
}
