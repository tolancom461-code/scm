import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  materialRequisitionItems,
  materialUnits,
} from "../../../drizzle/construction";
import { materialRequisitionSaveInput } from "../../../shared/material-requisitions";
import type { AccessContext } from "../../core/policy";
import { save } from "./service";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  purchaseOptions: vi.fn(),
}));
vi.mock("../../core/database", () => ({ database: mocks.database }));
vi.mock("../../core/numbering", () => ({
  allocateRecordNumber: vi.fn().mockResolvedValue("MR-1"),
}));
vi.mock("../../core/policy", () => ({
  assertConstructionAccess: vi.fn(),
  constructionScope: () => undefined,
}));
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
  cmmsReferencesConfigured: () => false,
  readCmmsPurchaseOptions: mocks.purchaseOptions,
}));

const actor = { user: { id: 11 } } as AccessContext;
const line = {
  itemName: "Valve",
  catalogEntryId: 31,
  unitId: 5,
  quantity: "2",
  needDate: "2027-03-17",
  cmmsCategoryId: 21,
  cmmsReviewRole: "construction_procurement_manager",
};
const command = {
  key: "ec85b526-7488-4931-ace7-7c6f3abe60f5",
  projectId: 1,
  locale: "en",
  items: [line],
};

function stubSave({ linked = true, edit = false } = {}) {
  const before = {
    id: 18,
    projectId: 1,
    taskId: null,
    version: 2,
    status: "draft",
  };
  const project = {
    id: 1,
    plannedStartDate: "2027-03-20",
    cmmsSiteId: 12,
    cmmsSectionId: linked ? 19 : null,
    cmmsAssetId: null,
  };
  const entry = {
    id: line.catalogEntryId,
    createdBy: actor.user.id,
    catalogCode: "VAL",
    itemName: line.itemName,
    unitId: line.unitId,
  };
  const reads = [
    [project],
    ...(edit ? [[before]] : []),
    [entry],
    ...(edit ? [[line]] : []),
    [{ id: line.unitId, active: true }],
  ];
  const writtenItems = vi.fn();
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = Promise.resolve(reads.shift());
          return Object.assign(result, { for: () => result });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === materialUnits) return { onDuplicateKeyUpdate: vi.fn() };
        if (table === materialRequisitionItems) writtenItems(values);
        return Promise.resolve([{ insertId: before.id }]);
      },
    }),
    update: () => ({ set: () => ({ where: vi.fn() }) }),
    delete: () => ({ where: vi.fn() }),
  };
  mocks.database.mockResolvedValue({
    transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
  });
  return {
    input: {
      ...command,
      ...(edit ? { id: before.id, version: before.version } : {}),
    },
    writtenItems,
  };
}

describe("CMMS requirements on requisition save", () => {
  beforeEach(() => {
    mocks.purchaseOptions.mockReset().mockResolvedValue({
      categories: [{ id: 21, name: "Spare parts" }],
      reviewRoles: [
        { code: "construction_procurement_manager", name: "Construction" },
      ],
    });
  });

  it.each([false, true])(
    "saves using live CMMS labels and accepts a missing asset (edit: %s)",
    async edit => {
      const { input, writtenItems } = stubSave({ edit });
      await expect(
        save(materialRequisitionSaveInput.parse(input), actor)
      ).resolves.toEqual({ id: 18 });
      expect(mocks.purchaseOptions).toHaveBeenCalledWith("en");
      expect(writtenItems).toHaveBeenCalledWith([
        expect.objectContaining({
          cmmsCategoryId: 21,
          cmmsCategoryName: "Spare parts",
          cmmsReviewRole: "construction_procurement_manager",
          cmmsReviewRoleName: "Construction",
        }),
      ]);
    }
  );

  it("requires a project with a saved site and section", async () => {
    const { input, writtenItems } = stubSave({ linked: false });
    await expect(
      save(materialRequisitionSaveInput.parse(input), actor)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("CMMS site and section"),
    });
    expect(writtenItems).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "rejects a fractional draft quantity before any CMMS lookup or write (edit: %s)",
    async edit => {
      const { input, writtenItems } = stubSave({ edit });
      await expect(
        save(
          materialRequisitionSaveInput.parse({
            ...input,
            items: [{ ...line, quantity: "999999999.000000001" }],
          }),
          actor
        )
      ).rejects.toMatchObject({ domainCode: "CMMS_WHOLE_QUANTITY_REQUIRED" });
      expect(mocks.purchaseOptions).not.toHaveBeenCalled();
      expect(writtenItems).not.toHaveBeenCalled();
    }
  );

  it("allows correcting a draft to a whole quantity with trailing zeroes", async () => {
    const { input, writtenItems } = stubSave({ edit: true });
    await expect(
      save(
        materialRequisitionSaveInput.parse({
          ...input,
          items: [{ ...line, quantity: "3.000000000" }],
        }),
        actor
      )
    ).resolves.toEqual({ id: 18 });
    expect(writtenItems).toHaveBeenCalledWith([
      expect.objectContaining({ quantity: "3.000000000" }),
    ]);
  });

  it.each([{ cmmsCategoryId: null }, { cmmsReviewRole: null }])(
    "requires a category and review department for every item (%j)",
    async missing => {
      const { input, writtenItems } = stubSave();
      await expect(
        save(
          materialRequisitionSaveInput.parse({
            ...input,
            items: [line, { ...line, ...missing }],
          }),
          actor
        )
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining(
          "Select a CMMS category and review department"
        ),
      });
      expect(mocks.purchaseOptions).not.toHaveBeenCalled();
      expect(writtenItems).not.toHaveBeenCalled();
    }
  );

  it("rejects a category absent from the current CMMS list", async () => {
    const { input, writtenItems } = stubSave({ edit: true });
    await expect(
      save(
        materialRequisitionSaveInput.parse({
          ...input,
          items: [{ ...line, cmmsCategoryId: 41 }],
        }),
        actor
      )
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Check the CMMS category"),
    });
    expect(writtenItems).not.toHaveBeenCalled();
  });

  it("requires available CMMS lists even when reusing saved choices", async () => {
    const { input, writtenItems } = stubSave({ edit: true });
    mocks.purchaseOptions.mockRejectedValue(
      new TRPCError({ code: "PRECONDITION_FAILED" })
    );
    await expect(
      save(materialRequisitionSaveInput.parse(input), actor)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(writtenItems).not.toHaveBeenCalled();
  });
});
