import { z } from "zod";
import { dateInput } from "../../../shared/validation";

const id = z.number().int().min(1).max(2147483647);
const name = z.string().trim().min(1).max(255);
const requesterNameSchema = name.refine(value => !/\p{Cc}/u.test(value));
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  creatorName: z.unknown().optional(),
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
  const { creatorName, project, task, items } = snapshot.data;
  const requesterName = requesterNameSchema.safeParse(
    typeof creatorName === "string" ? creatorName.replace(/\s+/g, " ") : creatorName
  );
  return {
    schemaVersion: 1 as const,
    idempotencyKey: `${instanceId}:${request.number}`,
    source: {
      system: "PSCM" as const,
      instanceId,
      requisitionId: request.id,
      requisitionNumber: request.number,
      approvedAt: approvedAt.toISOString(),
      ...(requesterName.success ? { requesterName: requesterName.data } : {}),
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
const unsupportedQuantitySchema = z.object({ error: z.literal("unsupported_quantity") });

export type CmmsPurchaseResponse =
  | { ok: true; number: string; referenceUrl: string }
  | { ok: false; retryable: boolean; message: string };

const unavailable = { ok: false, retryable: true, message: "تعذر الاتصال بخدمة الشراء في CMMS. ستتم إعادة المحاولة." } as const;
const invalidConfirmation = { ok: false, retryable: true, message: "لم يعد CMMS رقم طلب شراء صالحًا. ستتم إعادة المحاولة." } as const;

async function readPurchaseResponse(response: Response, maxBytes = 8192): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const fulfillmentQuantity = z.number().nonnegative();
const fulfillmentItem = z.object({
  requisitionId: id,
  sequence: id,
  receivedQuantity: fulfillmentQuantity,
  readyQuantity: fulfillmentQuantity,
  issuedQuantity: fulfillmentQuantity,
  unit: z.string().trim().min(1).max(100),
  deliveries: z.array(z.object({
    number: z.string().trim().min(1).max(100),
    quantity: fulfillmentQuantity,
    recipientName: z.string().trim().min(1).max(300).nullish(),
  })),
});
const fulfillmentResponse = z.object({ items: z.array(fulfillmentItem) });

export type CmmsFulfillmentItem = z.infer<typeof fulfillmentItem>;

async function readCmmsPurchaseData(
  path: "fulfillment" | "material-costs",
  settings: CmmsPurchaseSettings,
  instanceId: string,
  requisitionIds: number[],
  request: typeof fetch
) {
  const response = await request(
    new URL(`/api/v1/pscm/${path}`, settings.endpoint),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instanceId, requisitionIds }),
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    }
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`CMMS ${path} unavailable`);
  }
  return readPurchaseResponse(response, 1_000_000);
}

export async function readCmmsFulfillment(
  settings: CmmsPurchaseSettings,
  instanceId: string,
  requisitionIds: number[],
  request: typeof fetch = fetch
): Promise<CmmsFulfillmentItem[]> {
  const parsed = fulfillmentResponse.safeParse(
    await readCmmsPurchaseData(
      "fulfillment",
      settings,
      instanceId,
      requisitionIds,
      request
    )
  );
  if (!parsed.success) throw new Error("Invalid CMMS fulfillment response");
  const requestedIds = new Set(requisitionIds);
  const seen = new Set<string>();
  for (const { requisitionId, sequence } of parsed.data.items) {
    const key = `${requisitionId}:${sequence}`;
    if (!requestedIds.has(requisitionId) || seen.has(key)) {
      throw new Error("Invalid CMMS fulfillment reference");
    }
    seen.add(key);
  }
  return parsed.data.items;
}

const costCents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const materialCostRequisition = z.object({
  requisitionId: id,
  complete: z.boolean(),
  deliveries: z.array(
    z
      .object({
        number: z.string().trim().min(1).max(100),
        sequence: id.nullable(),
        issuedCents: costCents,
        returnedCents: costCents,
      })
      .refine(delivery => delivery.returnedCents <= delivery.issuedCents)
  ),
});
const materialCostsResponse = z.object({
  requisitions: z.array(materialCostRequisition),
});

export type CmmsMaterialCostRequisition = z.infer<typeof materialCostRequisition>;

export async function readCmmsMaterialCosts(
  settings: CmmsPurchaseSettings,
  instanceId: string,
  requisitionIds: number[],
  request: typeof fetch = fetch
): Promise<CmmsMaterialCostRequisition[]> {
  const parsed = materialCostsResponse.safeParse(
    await readCmmsPurchaseData(
      "material-costs",
      settings,
      instanceId,
      requisitionIds,
      request
    )
  );
  if (!parsed.success) throw new Error("Invalid CMMS material costs response");
  const requestedIds = new Set(requisitionIds);
  for (const { requisitionId } of parsed.data.requisitions) {
    if (!requestedIds.delete(requisitionId))
      throw new Error("Invalid CMMS material costs reference");
  }
  return parsed.data.requisitions;
}

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
      if (response.status === 422) {
        const rejection = await readPurchaseResponse(response);
        if (unsupportedQuantitySchema.safeParse(rejection).success) {
          return {
            ok: false,
            retryable: false,
            message: "تعذّر إرسال طلب الاحتياج إلى CMMS لأن أحد بنوده يحتوي على كمية كسرية. يتطلب CMMS كميات صحيحة.",
          };
        }
      } else {
        await response.body?.cancel();
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, retryable: true, message: "رفض CMMS رمز ربط الشراء. راجع إعدادات الاتصال." };
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        return { ok: false, retryable: false, message: "رفض CMMS بيانات الاحتياج. راجع بيانات البنود وسجل التكامل." };
      }
      return unavailable;
    }
    const confirmed = confirmationSchema.safeParse(await readPurchaseResponse(response));
    if (!confirmed.success) return invalidConfirmation;
    const { purchaseRequestId, purchaseRequestNumber } = confirmed.data;
    return {
      ok: true,
      number: purchaseRequestNumber,
      referenceUrl: new URL(`/purchase-orders/${purchaseRequestId}`, settings.endpoint).href,
    };
  } catch {
    return unavailable;
  }
}
