import { describe, expect, it, vi } from "vitest";
import {
  cmmsPurchasePayload,
  cmmsPurchaseSettings,
  readCmmsFulfillment,
  readCmmsMaterialCosts,
  sendCmmsPurchase,
} from "./purchase-client";

const request = {
  id: 8,
  number: "MR-26-11-0008",
  approvedAt: new Date("2026-11-15T08:30:00Z"),
};
const item = {
  sequence: 1,
  catalogItemId: "204",
  catalogCode: "000204",
  itemName: "Epoxy",
  quantity: "1.125000000",
  unit: { code: "CMMS_UNIT_7", nameAr: "لتر", nameEn: "Litre", nameUr: "لیٹر" },
  specifications: "Grey",
  notes: "Deliver to the site",
  needDate: "2026-11-20",
  cmmsCategoryId: 39,
  cmmsReviewRole: "construction_procurement_manager",
};
const snapshot = {
  schemaVersion: 1,
  project: {
    id: 12, name: "Building", number: "PRJ-26-11-0001",
    cmmsSiteId: 32, cmmsSectionId: 41, cmmsAssetId: null,
  },
  task: { id: 9, name: "Paint" },
  items: [
    item,
    { ...item, sequence: 2, catalogItemId: null, cmmsCategoryId: 43, cmmsReviewRole: "senior_management" },
  ],
};
const environment = {
  NODE_ENV: "production",
  CMMS_PURCHASE_API_URL: "https://cmms.example.test/api/v1/pscm/purchase-requests",
  CMMS_PURCHASE_API_TOKEN: "fixture-write-token",
  CMMS_PURCHASE_SOURCE_ID: "pscm-production",
};
const settings = cmmsPurchaseSettings(environment)!;
const payload = cmmsPurchasePayload({ ...request, approvedSnapshot: JSON.stringify(snapshot) }, settings.instanceId)!;

describe("PSCM outgoing approved requirements", () => {
  it("sends the approved project references on each item and keeps the per-item choices and exact quantity", () => {
    expect(payload.source).toEqual({
      system: "PSCM", instanceId: "pscm-production", requisitionId: 8,
      requisitionNumber: "MR-26-11-0008", approvedAt: request.approvedAt.toISOString(),
      project: { id: 12, name: "Building", number: "PRJ-26-11-0001" },
      task: { id: 9, name: "Paint" },
    });
    expect(payload.items).toMatchObject([
      { catalogItemId: "204", catalogCode: "000204", quantity: "1.125000000", siteId: 32, sectionId: 41, assetId: null,
        categoryId: 39, reviewRole: "construction_procurement_manager" },
      { sequence: 2, catalogItemId: null, siteId: 32, sectionId: 41, assetId: null,
        categoryId: 43, reviewRole: "senior_management" },
    ]);
    expect(payload.idempotencyKey).toBe("pscm-production:MR-26-11-0008");
    expect(cmmsPurchasePayload({ ...request, approvedSnapshot: JSON.stringify(snapshot) }, settings.instanceId))
      .toEqual(payload);
  });

  it("does not send historical or incomplete snapshots, malformed JSON, or unapproved records", () => {
    expect(cmmsPurchasePayload({ ...request, approvedSnapshot: "{" }, "pscm")).toBeNull();
    expect(cmmsPurchasePayload({ ...request, approvedAt: null, approvedSnapshot: JSON.stringify(snapshot) }, "pscm")).toBeNull();
    expect(cmmsPurchasePayload({ ...request, approvedSnapshot: JSON.stringify({
      ...snapshot, project: { ...snapshot.project, cmmsSectionId: null },
    }) }, "pscm")).toBeNull();
    expect(cmmsPurchasePayload({ ...request, approvedSnapshot: JSON.stringify({
      ...snapshot, items: [{ ...item, cmmsReviewRole: null }],
    }) }, "pscm")).toBeNull();
  });

  it("sends the approved snapshot author as requester and keeps the idempotency key", () => {
    const withAuthor = cmmsPurchasePayload({
      ...request,
      approvedSnapshot: JSON.stringify({
        ...snapshot,
        creatorName: "  أحمد\tالكاتب  ",
        approverName: "خالد المراجع",
      }),
    }, settings.instanceId);
    expect(withAuthor).toEqual({
      ...payload,
      source: { ...payload.source, requesterName: "أحمد الكاتب" },
    });
  });

  it.each([null, "", "   ", "a".repeat(256), "name\u0000value", { name: "legacy" }])(
    "retains the original wire shape when a legacy author label is unavailable or invalid (%j)",
    creatorName => {
      expect(cmmsPurchasePayload({
        ...request,
        approvedSnapshot: JSON.stringify({
          ...snapshot,
          creatorName,
          approverName: "Approval user",
        }),
      }, settings.instanceId)).toEqual(payload);
    }
  );

  it("connects only to an explicitly configured endpoint and validates transport settings", () => {
    expect(cmmsPurchaseSettings({})).toBeNull();
    expect(cmmsPurchaseSettings({ ...environment, CMMS_PURCHASE_API_TOKEN: "" })).toBeNull();
    expect(cmmsPurchaseSettings({ ...environment, CMMS_PURCHASE_API_URL: "http://127.0.0.1:1234/import" })).toBeNull();
    expect(cmmsPurchaseSettings({ ...environment, NODE_ENV: "test", CMMS_PURCHASE_API_URL: "http://127.0.0.1:1234/import" })?.endpoint.port)
      .toBe("1234");
  });

  it("uses a server Bearer credential and the same idempotency key on retries", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(Response.json({
        purchaseRequestId: 45, purchaseRequestNumber: "PR-2026-12450",
        referenceUrl: "https://somewhere-else.example.test",
      }, { status: 201 }));
    await expect(sendCmmsPurchase(settings, payload, fetchMock))
      .resolves.toMatchObject({ ok: false, retryable: true });
    await expect(sendCmmsPurchase(settings, payload, fetchMock)).resolves.toEqual({
      ok: true, number: "PR-2026-12450", referenceUrl: "https://cmms.example.test/purchase-orders/45",
    });
    for (const [endpoint, options] of fetchMock.mock.calls) {
      expect(endpoint).toEqual(settings.endpoint);
      expect(options).toMatchObject({
        method: "POST", redirect: "error",
        headers: {
          Authorization: "Bearer fixture-write-token",
          "Idempotency-Key": payload.idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
    }
  });

  it.each([400, 409, 413, 422])("classifies explicit CMMS rejection %i without exposing its body", async status => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream internal details", { status }));
    const result = await sendCmmsPurchase(settings, payload, fetchMock);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(result)).not.toContain("upstream internal details");
  });

  it("shows a specific failure when CMMS reports a fractional quantity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "unsupported_quantity", detail: "upstream internal details" }, { status: 422 })
    );
    const result = await sendCmmsPurchase(settings, payload, fetchMock);
    expect(result).toMatchObject({ ok: false, retryable: false, message: expect.stringContaining("كمية كسرية") });
    expect(JSON.stringify(result)).not.toContain("upstream internal details");
  });

  it("uses the generic validation failure when the error body exceeds the response limit", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: "unsupported_quantity", detail: " ".repeat(8193) }, { status: 422 })
    );
    const result = await sendCmmsPurchase(settings, payload, fetchMock);
    expect(result).toMatchObject({ ok: false, retryable: false, message: expect.stringContaining("رفض CMMS بيانات الاحتياج") });
  });

  it.each([401, 404, 429, 503])("keeps retryable HTTP status %i queued", async status => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    await expect(sendCmmsPurchase(settings, payload, fetchMock)).resolves.toMatchObject({ ok: false, retryable: true });
  });

  it("keeps malformed or oversized successful acknowledgements queued", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ purchaseRequestId: 45, purchaseRequestNumber: "DFT-2026-0045" }))
      .mockResolvedValueOnce(new Response(" ".repeat(8193)));
    await expect(sendCmmsPurchase(settings, payload, fetchMock)).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(sendCmmsPurchase(settings, payload, fetchMock)).resolves.toMatchObject({ ok: false, retryable: true });
  });
});

describe("CMMS fulfillment for approved requirements", () => {
  const progress = {
    requisitionId: request.id,
    sequence: 1,
    receivedQuantity: 8,
    readyQuantity: 3,
    issuedQuantity: 5,
    unit: "Piece",
    deliveries: [{ number: "DLV-2026-0001", quantity: 5 }],
  };

  it("reads partial fulfillment using the instance used to submit the requisition", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [progress] }));
    await expect(readCmmsFulfillment(settings, "original-instance", [request.id], fetchMock))
      .resolves.toEqual([progress]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cmms.example.test/api/v1/pscm/fulfillment"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: "Bearer fixture-write-token" }),
        body: JSON.stringify({ instanceId: "original-instance", requisitionIds: [request.id] }),
      })
    );
  });

  it("rejects progress for another requisition or multiple responses for the same item", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [{ ...progress, requisitionId: request.id + 1 }] }))
      .mockResolvedValueOnce(Response.json({ items: [progress, progress] }));
    await expect(readCmmsFulfillment(settings, settings.instanceId, [request.id], fetchMock)).rejects.toThrow();
    await expect(readCmmsFulfillment(settings, settings.instanceId, [request.id], fetchMock)).rejects.toThrow();
  });

  it("keeps a failed response distinct from a successfully reported zero quantity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({
        items: [{ ...progress, receivedQuantity: 0, readyQuantity: 0, issuedQuantity: 0, deliveries: [] }],
      }));
    await expect(readCmmsFulfillment(settings, settings.instanceId, [request.id], fetchMock)).rejects.toThrow();
    await expect(readCmmsFulfillment(settings, settings.instanceId, [request.id], fetchMock))
      .resolves.toMatchObject([{ receivedQuantity: 0, issuedQuantity: 0 }]);
  });
});

describe("CMMS material cost details", () => {
  const cost = {
    requisitionId: request.id,
    complete: true,
    deliveries: [{
      number: "DLV-2026-0001",
      sequence: 1,
      issuedCents: 590,
      returnedCents: 200,
    }],
  };

  it("reads the authorized requisition's recorded issue and return amounts", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(Response.json({ requisitions: [cost] }));
    await expect(readCmmsMaterialCosts(settings, "original-instance", [request.id], fetchMock))
      .resolves.toEqual([cost]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://cmms.example.test/api/v1/pscm/material-costs"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: "Bearer fixture-write-token" }),
        body: JSON.stringify({ instanceId: "original-instance", requisitionIds: [request.id] }),
      })
    );
  });

  it("rejects duplicate or unrelated purchase identities and invalid return values", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ requisitions: [cost, cost] }))
      .mockResolvedValueOnce(Response.json({ requisitions: [{ ...cost, requisitionId: request.id + 1 }] }))
      .mockResolvedValueOnce(Response.json({
        requisitions: [{ ...cost, deliveries: [{ ...cost.deliveries[0], returnedCents: 591 }] }],
      }));
    for (let index = 0; index < 3; index += 1) {
      await expect(readCmmsMaterialCosts(settings, settings.instanceId, [request.id], fetchMock)).rejects.toThrow();
    }
  });
});
