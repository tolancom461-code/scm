import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { AccessContext } from "../../core/policy";
import { taskMaterialSummary } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  settings: vi.fn(),
  fulfillment: vi.fn(),
}));

vi.mock("../../core/database", () => ({ database: mocks.database }));
vi.mock("../../core/policy", () => ({ constructionScope: () => undefined }));
vi.mock("../../core/numbering", () => ({ allocateRecordNumber: vi.fn() }));
vi.mock("../../core/audit", () => ({ recordChange: vi.fn() }));
vi.mock("../../core/idempotency", () => ({ once: vi.fn() }));
vi.mock("./catalog", () => ({ catalogImageUrl: vi.fn() }));
vi.mock("../cmms-integration/references", () => ({
  cmmsReferencesConfigured: vi.fn(),
  readCmmsPurchaseOptions: vi.fn(),
}));
vi.mock("../cmms-integration/purchase-client", () => ({
  cmmsPurchaseSettings: mocks.settings,
  readCmmsFulfillment: mocks.fulfillment,
}));

const access = { user: { id: 8 } } as AccessContext;
const project = { id: 10, plannedStartDate: "2027-04-01" };
const settings = { instanceId: "current" };
const linked = (id: number, taskId: number, instanceId: string | null) => ({
  id,
  taskId,
  instanceId,
  purchaseNumber: `PR-${id}`,
  externalStatus: "purchase_request_created",
});

function stubReads(...reads: unknown[][]) {
  const filters: SQL[] = [];
  mocks.database.mockResolvedValue({
    select: () => ({
      from: () => {
        const query = {
          innerJoin: () => query,
          where: (filter: SQL) => {
            filters.push(filter);
            return Promise.resolve(reads.shift() ?? []);
          },
        };
        return query;
      },
    }),
  });
  return filters;
}

describe("task material summary", () => {
  afterEach(() => vi.resetAllMocks());

  it("counts ready lines by task and keeps requisitions when a CMMS batch fails", async () => {
    const older = Array.from({ length: 101 }, (_, index) =>
      linked(index + 1, 7, "original")
    );
    stubReads(
      [project],
      [
        ...older,
        linked(102, 8, null),
        {
          ...linked(103, 9, null),
          purchaseNumber: null,
          externalStatus: "pending_send",
        },
      ]
    );
    mocks.settings.mockReturnValue(settings);
    mocks.fulfillment.mockImplementation(
      async (_settings, instanceId: string, ids: number[]) => {
        if (instanceId === "current") throw new Error("CMMS unavailable");
        return [
          {
            requisitionId: ids[0],
            sequence: 1,
            issuedQuantity: 1,
            readyQuantity: 1,
          },
          { requisitionId: ids[0], sequence: 2, readyQuantity: 0 },
        ];
      }
    );

    await expect(taskMaterialSummary(10, undefined, access)).resolves.toEqual({
      items: [
        { taskId: 7, requisitionCount: 101, readyItemCount: 2 },
        { taskId: 8, requisitionCount: 1, readyItemCount: 0 },
        { taskId: 9, requisitionCount: 1, readyItemCount: 0 },
      ],
    });
    expect(mocks.fulfillment.mock.calls).toEqual([
      [settings, "original", older.slice(0, 100).map(row => row.id)],
      [settings, "original", [101]],
      [settings, "current", [102]],
    ]);
  });

  it("limits the single-task view to that task and omits live counts without settings", async () => {
    const task = { id: 7, startDate: "2027-04-01" };
    const filters = stubReads([project], [task], [linked(1, 7, null)]);
    mocks.settings.mockReturnValue(null);

    await expect(taskMaterialSummary(10, 7, access)).resolves.toEqual({
      items: [{ taskId: 7, requisitionCount: 1, readyItemCount: 0 }],
    });
    expect(mocks.fulfillment).not.toHaveBeenCalled();
    expect(
      filters.map(filter => new MySqlDialect().sqlToQuery(filter).params)
    ).toEqual([[10], [7, 10], [10, "approved", 7]]);
  });

  it("stops before fulfillment if the project is outside scope", async () => {
    stubReads([]);

    await expect(
      taskMaterialSummary(10, undefined, access)
    ).rejects.toMatchObject({ domainCode: "NOT_FOUND" });
    expect(mocks.fulfillment).not.toHaveBeenCalled();
  });
});
