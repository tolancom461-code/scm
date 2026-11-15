import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchApprovedCmmsRequisition } from "./purchase-delivery";

const { database } = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../../core/database", () => ({ database }));

const snapshot = {
  schemaVersion: 1,
  project: { id: 3, name: "Project", number: "PRJ-26-11-0003", cmmsSiteId: 4, cmmsSectionId: 5, cmmsAssetId: 6 },
  task: null,
  items: [{
    sequence: 1, itemName: "Bags", catalogItemId: null, quantity: "2.000000000",
    unit: { code: "BAG", nameAr: "كيس", nameEn: "Bag", nameUr: "تھیلا" },
    specifications: "", notes: "", needDate: "2026-11-20", cmmsCategoryId: 6,
    cmmsReviewRole: "general_maintenance_manager",
  }],
};

const selected = {
  id: 4, number: "MR-26-11-0004", approvedAt: new Date("2026-11-15T08:30:00Z"),
  approvedSnapshot: JSON.stringify(snapshot), attempts: 0, sourceId: null,
};
const dialect = new MySqlDialect();
const query = (condition: Parameters<typeof dialect.sqlToQuery>[0]) => dialect.sqlToQuery(condition);

function mockDatabase(rows: object[][]) {
  const claimWhere = vi.fn(() => ({ for: vi.fn(async () => rows.shift()) }));
  const writeWhere = vi.fn();
  const write = vi.fn(() => ({ where: writeWhere }));
  const locked = {
    select: () => ({ from: () => ({ where: claimWhere }) }),
    update: () => ({ set: write }),
  };
  database.mockResolvedValue({
    transaction: async (action: (tx: typeof locked) => unknown) => action(locked),
    update: locked.update,
  });
  return { claimWhere, write, writeWhere };
}

beforeEach(() => {
  database.mockReset();
  vi.stubEnv("CMMS_PURCHASE_API_URL", "https://cmms.example.test/import");
  vi.stubEnv("CMMS_PURCHASE_API_TOKEN", "fixture-token");
  vi.stubEnv("CMMS_PURCHASE_SOURCE_ID", "first-instance");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Durable CMMS purchase delivery", () => {
  it("does not access the queue while the purchase link is unconfigured", async () => {
    vi.stubEnv("CMMS_PURCHASE_API_TOKEN", "");
    await dispatchApprovedCmmsRequisition(4);
    expect(database).not.toHaveBeenCalled();
  });

  it("does not send a row unless the approved, due, unconfirmed condition acquires a lease", async () => {
    const store = mockDatabase([[]]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await dispatchApprovedCmmsRequisition(4);
    expect(store.write).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const condition = query((store.claimWhere.mock.calls as unknown as [Parameters<typeof query>[0]][])[0][0]);
    expect(condition.sql).toContain("external_pr_number` is null");
    expect(condition.sql).toContain("cmms_dispatch_next_at` <=");
    expect(condition.params).toEqual(expect.arrayContaining([4, "approved", "pending_send", "send_failed", "sending"]));
  });

  it("leases the approval, retries with its persisted source ID and writes the official CMMS number", async () => {
    const store = mockDatabase([[selected], [{ ...selected, sourceId: "first-instance", attempts: 1 }]]);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ purchaseRequestId: 9, purchaseRequestNumber: "PR-2026-0009" }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchApprovedCmmsRequisition(4);
    expect(store.write).toHaveBeenNthCalledWith(1, expect.objectContaining({
      externalStatus: "sending", cmmsDispatchLeaseId: expect.any(String),
      cmmsDispatchSourceId: "first-instance", cmmsDispatchAttempts: 1,
    }));
    expect(store.write).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalStatus: "send_failed", cmmsDispatchLeaseId: null,
      cmmsDispatchNextAt: new Date("2026-11-15T09:00:30Z"),
    }));

    vi.stubEnv("CMMS_PURCHASE_SOURCE_ID", "changed-config");
    vi.setSystemTime(new Date("2026-11-15T09:01:00Z"));
    await dispatchApprovedCmmsRequisition(4);
    const keys = fetchMock.mock.calls.map(([, options]) => new Headers(options?.headers).get("Idempotency-Key"));
    expect(keys).toEqual(["first-instance:MR-26-11-0004", "first-instance:MR-26-11-0004"]);
    expect(store.write).toHaveBeenLastCalledWith(expect.objectContaining({
      externalStatus: "purchase_request_created",
      externalPurchaseRequestNumber: "PR-2026-0009", externalReferenceUrl: "https://cmms.example.test/purchase-orders/9",
      cmmsDispatchLeaseId: null, cmmsDispatchNextAt: null,
    }));
    const lease = (store.write.mock.calls[2] as unknown as [{ cmmsDispatchLeaseId: string }])[0].cmmsDispatchLeaseId;
    const condition = query((store.writeWhere.mock.calls as unknown as [Parameters<typeof query>[0]][])[3][0]);
    expect(condition.params).toEqual([4, lease, "sending"]);
  });
});
