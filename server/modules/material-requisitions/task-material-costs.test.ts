import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { AccessContext } from "../../core/policy";
import { taskMaterialCosts } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  settings: vi.fn(),
  costs: vi.fn(),
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
  readCmmsMaterialCosts: mocks.costs,
}));

const access = { user: { id: 8 } } as AccessContext;
const project = { id: 10, plannedStartDate: "2027-04-01" };
const settings = { instanceId: "current" };
const linked = (
  id: number,
  taskId: number | null,
  instanceId = "original"
) => ({
  id,
  taskId,
  taskName: taskId === null ? null : `Task ${taskId}`,
  instanceId,
  purchaseNumber: `PR-${id}`,
  externalStatus: "purchase_request_created",
  nextDispatchAt: null,
  dispatchAttempts: 1,
});
const totals = (issuedCents = 0, returnedCents = 0) => ({
  issuedCents,
  returnedCents,
  netCents: issuedCents - returnedCents,
});
const delivery = (number: string, issuedCents: number, returnedCents = 0) => ({
  number,
  sequence: 1,
  issuedCents,
  returnedCents,
});

function stubReads(...reads: unknown[][]) {
  const filters: (SQL | undefined)[] = [];
  mocks.database.mockResolvedValue({
    select: () => ({
      from: () => {
        const result = Promise.resolve(reads.shift() ?? []);
        const query = {
          leftJoin: () => query,
          where: (filter: SQL | undefined) => {
            filters.push(filter);
            return query;
          },
          orderBy: () => query,
          then: result.then.bind(result),
        };
        return query;
      },
    }),
  });
  return filters;
}

describe("task material costs", () => {
  afterEach(() => vi.resetAllMocks());

  it("adds each task and direct project issue once, net of returns", async () => {
    stubReads(
      [project],
      [linked(1, 7), linked(2, 7), linked(3, 8), linked(4, null)]
    );
    mocks.settings.mockReturnValue(settings);
    mocks.costs.mockResolvedValue([
      {
        requisitionId: 1,
        complete: true,
        deliveries: [delivery("DLV-1", 525, 225)],
      },
      { requisitionId: 2, complete: true, deliveries: [delivery("DLV-2", 35)] },
      { requisitionId: 3, complete: true, deliveries: [] },
      {
        requisitionId: 4,
        complete: true,
        deliveries: [{ ...delivery("DLV-3", 92), sequence: null }],
      },
    ]);

    await expect(taskMaterialCosts(10, undefined, access)).resolves.toEqual({
      totals: totals(652, 225),
      direct: totals(92),
      tasks: [
        { taskId: 7, taskName: "Task 7", totals: totals(560, 225) },
        { taskId: 8, taskName: "Task 8", totals: totals() },
      ],
      requisitions: [],
    });
    expect(mocks.costs).toHaveBeenCalledWith(
      settings,
      "original",
      [1, 2, 3, 4]
    );
  });

  it("scopes the task and keeps verified deliveries when another response is missing", async () => {
    const filters = stubReads(
      [project],
      [{ id: 7 }],
      [linked(1, 7), linked(2, 7), linked(3, 7)]
    );
    mocks.settings.mockReturnValue(settings);
    mocks.costs.mockResolvedValue([
      {
        requisitionId: 1,
        complete: false,
        deliveries: [delivery("DLV-1", 89, 20)],
      },
      { requisitionId: 3, complete: true, deliveries: [] },
    ]);

    await expect(taskMaterialCosts(10, 7, access)).resolves.toEqual({
      totals: null,
      direct: null,
      tasks: [],
      requisitions: [
        {
          requisitionId: 1,
          totals: null,
          deliveries: [{ ...delivery("DLV-1", 89, 20), netCents: 69 }],
        },
        { requisitionId: 2, totals: null, deliveries: [] },
        { requisitionId: 3, totals: totals(), deliveries: [] },
      ],
    });
    const dialect = new MySqlDialect();
    expect(filters.map(filter => dialect.sqlToQuery(filter!).params)).toEqual([
      [10],
      [7, 10],
      [10, "approved", 7],
    ]);
  });

  it("does not book duplicated delivery references across CMMS batches", async () => {
    stubReads(
      [project],
      [{ id: 7 }],
      [linked(1, 7, "old"), linked(2, 7, "new")]
    );
    mocks.settings.mockReturnValue(settings);
    mocks.costs
      .mockResolvedValueOnce([
        {
          requisitionId: 1,
          complete: true,
          deliveries: [delivery("DLV-1", 125)],
        },
      ])
      .mockResolvedValueOnce([
        {
          requisitionId: 2,
          complete: true,
          deliveries: [delivery("DLV-1", 125)],
        },
      ]);

    await expect(taskMaterialCosts(10, 7, access)).resolves.toMatchObject({
      totals: null,
      requisitions: [
        { requisitionId: 1, totals: null, deliveries: [] },
        { requisitionId: 2, totals: null, deliveries: [] },
      ],
    });
  });

  it("leaves task costs unknown when CMMS can only attribute a delivery to the project", async () => {
    stubReads([project], [{ id: 7 }], [linked(1, 7)]);
    mocks.settings.mockReturnValue(settings);
    mocks.costs.mockResolvedValue([
      {
        requisitionId: 1,
        complete: true,
        deliveries: [{ ...delivery("DLV-1", 125), sequence: null }],
      },
    ]);

    await expect(taskMaterialCosts(10, 7, access)).resolves.toMatchObject({
      totals: null,
      requisitions: [{ requisitionId: 1, totals: null, deliveries: [] }],
    });
  });

  it("distinguishes locally approved requests from pending sends and lookup failures", async () => {
    const local = {
      ...linked(1, null),
      purchaseNumber: null,
      instanceId: null,
      externalStatus: "pending_send",
      dispatchAttempts: 0,
    };
    stubReads(
      [project],
      [
        local,
        {
          ...local,
          id: 2,
          taskId: 7,
          taskName: "Task 7",
          nextDispatchAt: new Date(),
        },
        linked(3, 8),
      ]
    );
    mocks.settings.mockReturnValue(settings);
    mocks.costs.mockRejectedValue(new Error("CMMS unavailable"));

    await expect(taskMaterialCosts(10, undefined, access)).resolves.toEqual({
      totals: null,
      direct: totals(),
      tasks: [
        { taskId: 7, taskName: "Task 7", totals: null },
        { taskId: 8, taskName: "Task 8", totals: null },
      ],
      requisitions: [],
    });
    expect(mocks.costs).toHaveBeenCalledTimes(1);
    expect(mocks.costs).toHaveBeenCalledWith(settings, "original", [3]);
  });

  it("does not request costs for a task outside the project scope", async () => {
    stubReads([project], []);
    await expect(taskMaterialCosts(10, 99, access)).rejects.toMatchObject({
      domainCode: "INVALID_REFERENCE",
    });
    expect(mocks.costs).not.toHaveBeenCalled();
  });
});
