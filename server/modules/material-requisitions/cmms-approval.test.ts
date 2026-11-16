import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  materialRequisitionItems,
  materialRequisitions,
} from "../../../drizzle/construction";
import type { AccessContext } from "../../core/policy";
import { approve } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  configured: vi.fn(),
  purchaseOptions: vi.fn(),
}));

vi.mock("../../core/database", () => ({ database: mocks.database }));
vi.mock("../../core/numbering", () => ({ allocateRecordNumber: vi.fn() }));
vi.mock("../../core/policy", () => ({ constructionScope: () => undefined }));
vi.mock("../../core/audit", () => ({ recordChange: vi.fn() }));
vi.mock("../../core/idempotency", () => ({
  once: (
    _tx: unknown,
    _actor: number,
    _name: string,
    _key: string,
    _input: unknown,
    run: () => unknown
  ) => run(),
}));
vi.mock("./catalog", () => ({ catalogImageUrl: vi.fn() }));
vi.mock("../cmms-integration/references", () => ({
  cmmsReferencesConfigured: mocks.configured,
  readCmmsPurchaseOptions: mocks.purchaseOptions,
}));

function query(rows: unknown[]) {
  const result = Promise.resolve(rows);
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    for: () => chain,
    then: result.then.bind(result),
  };
  return chain;
}

const approver = { user: { id: 11, name: "Reviewer" } } as AccessContext;
const command = {
  key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
  id: 8,
  version: 0,
  locale: "en" as const,
};
const defaultItem = {
  id: 9,
  itemName: "Valve",
  leadDays: 3,
  quantity: "3.000000000",
  cmmsCategoryId: 21,
  cmmsReviewRole: "construction_procurement_manager",
};

function stubApproval(mapped: boolean, item = defaultItem) {
  const project = {
    id: 1,
    name: "Water works",
    number: "P-1",
    actualStartDate: "2027-03-27",
    plannedStartDate: "2027-03-20",
    cmmsSiteId: mapped ? 37 : null,
    cmmsSiteName: mapped ? "Plant" : null,
    cmmsSectionId: mapped ? 51 : null,
    cmmsSectionName: mapped ? "Maintenance" : null,
    cmmsAssetId: null,
    cmmsAssetName: null,
  };
  const requisition = {
    id: 8,
    status: "draft",
    version: 0,
    projectId: 1,
    taskId: null,
    createdBy: 5,
  };
  const reads = [
    [requisition],
    [project],
    [requisition],
    [{ item, unit: { active: true }, catalog: null }],
    [{ name: "Creator" }],
  ];
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    select: () => query(reads.shift() ?? []),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          writes.push({ table, values });
        },
      }),
    }),
  };
  mocks.database.mockResolvedValue({
    select: () => query([project]),
    transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
  });
  return writes;
}

describe("CMMS requisition approval", () => {
  beforeEach(() => {
    mocks.configured.mockReset().mockReturnValue(true);
    mocks.purchaseOptions.mockReset().mockResolvedValue({
      categories: [{ id: 21, name: "Spare parts" }],
      reviewRoles: [
        { code: "construction_procurement_manager", name: "Construction" },
      ],
    });
  });

  it.each([
    [0, "2027-03-20"],
    [-2, "2027-03-22"],
  ])(
    "queues and freezes a need date with a stored lead of %s days",
    async (leadDays, needDate) => {
      const writes = stubApproval(true, { ...defaultItem, leadDays });
      await expect(approve(command, approver)).resolves.toEqual({ id: 8 });
      expect(writes).toContainEqual({
        table: materialRequisitionItems,
        values: { needDate },
      });
      const approval = writes.find(
        write => write.table === materialRequisitions
      )?.values;
      expect(approval?.cmmsDispatchNextAt).toBeInstanceOf(Date);
      expect(JSON.parse(String(approval?.approvedSnapshot))).toMatchObject({
        sourceStartDate: "2027-03-20",
        items: [{ needDate }],
      });
    }
  );

  it("queues a mapped approval and captures the location and live item choices", async () => {
    const writes = stubApproval(true);
    await expect(approve(command, approver)).resolves.toEqual({ id: 8 });
    expect(mocks.purchaseOptions).toHaveBeenCalledTimes(1);
    expect(mocks.purchaseOptions).toHaveBeenCalledWith("en");
    const approval = writes.find(
      write => write.table === materialRequisitions
    )?.values;
    expect(approval).toMatchObject({
      externalStatus: "pending_send",
      cmmsDispatchNextAt: expect.any(Date),
    });
    expect(JSON.parse(String(approval?.approvedSnapshot))).toMatchObject({
      creatorName: "Creator",
      approverName: "Reviewer",
      project: {
        cmmsSiteId: 37,
        cmmsSiteName: "Plant",
        cmmsSectionId: 51,
        cmmsSectionName: "Maintenance",
        cmmsAssetId: null,
      },
      items: [
        {
          cmmsCategoryId: 21,
          cmmsCategoryName: "Spare parts",
          cmmsReviewRole: "construction_procurement_manager",
          cmmsReviewRoleName: "Construction",
          needDate: "2027-03-17",
          quantity: "3.000000000",
        },
      ],
    });
  });

  it("keeps approval local for a historical project without a CMMS location", async () => {
    const writes = stubApproval(false, { ...defaultItem, quantity: "1.125000000" });
    await expect(approve(command, approver)).resolves.toEqual({ id: 8 });
    expect(mocks.purchaseOptions).not.toHaveBeenCalled();
    expect(
      writes.find(write => write.table === materialRequisitions)?.values
    ).toMatchObject({
      status: "approved",
      cmmsDispatchNextAt: null,
    });
  });

  it.each(["1.125000000", "999999999.000000001"])(
    "keeps a mapped requisition with fractional quantity %s as a draft",
    async quantity => {
      const writes = stubApproval(true, { ...defaultItem, quantity });
      await expect(approve(command, approver)).rejects.toMatchObject({
        domainCode: "CMMS_WHOLE_QUANTITY_REQUIRED",
      });
      expect(writes).toEqual([]);
    }
  );

  it("rejects a mapped approval with a category that CMMS no longer offers", async () => {
    const writes = stubApproval(true, { ...defaultItem, cmmsCategoryId: 35 });
    await expect(approve(command, approver)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(writes).toEqual([]);
  });

  it("keeps a mapped requisition as a draft when CMMS references were disabled", async () => {
    mocks.configured.mockReturnValue(false);
    const writes = stubApproval(true);
    await expect(approve(command, approver)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.purchaseOptions).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
