import { describe, expect, it, vi } from "vitest";
import { masterInput, masterListInput } from "../../../shared/master-data";
import type { Transaction } from "../../core/database";
import { appRouter } from "../../routers";
import type { TrpcContext } from "../../_core/context";
import { validateReferences } from "./service";
import * as repository from "./repository";
vi.mock("../../core/policy", async original => ({
  ...(await original<typeof import("../../core/policy")>()),
  authorizeRequest: vi.fn(async (id: number) => ({
    user: { id, role: "user", permissionCodes: ["master.view"] },
    scope: {
      allProjects: true,
      legacyAccess: true,
      projectIds: [],
      template: "custom",
      version: 1,
    },
  })),
  logAccessDenied: vi.fn(),
}));

vi.mock("./repository", async original => ({
  ...(await original<typeof import("./repository")>()),
  find: vi.fn(),
}));
const named = {
  code: "olive-01",
  nameAr: "زيتون",
  nameEn: "Olive",
  nameUr: "زیتون",
};
const item = {
  ...named,
  kind: "items" as const,
  type: "inventory" as const,
  categoryId: 1,
  baseUomId: 1,
  purchasingUomId: 1,
  trackInventory: true,
};

describe("master data validation", () => {
  it("normalizes codes and requires three translated names", () => {
    expect(masterInput.parse(item).code).toBe("OLIVE-01");
    expect(masterInput.safeParse({ ...item, nameUr: "" }).success).toBe(false);
    expect(masterInput.safeParse({ ...item, code: "bad/code" }).success).toBe(
      false
    );
  });
  it("rejects service stock tracking and expiry without lot tracking", () => {
    expect(masterInput.safeParse({ ...item, type: "service" }).success).toBe(
      false
    );
    expect(
      masterInput.safeParse({ ...item, expiryTracking: true }).success
    ).toBe(false);
    expect(
      masterInput.safeParse({
        ...item,
        trackInventory: false,
        serialTracking: true,
      }).success
    ).toBe(false);
    expect(
      masterInput.safeParse({
        ...item,
        expiryTracking: true,
        lotTracking: true,
      }).success
    ).toBe(true);
  });
  it("rejects zero conversion factors and identity conversions", () => {
    const conversion = {
      ...named,
      kind: "conversions",
      itemId: 1,
      fromUomId: 2,
      toUomId: 1,
      factor: "12",
    };
    expect(masterInput.safeParse(conversion).success).toBe(true);
    expect(
      masterInput.safeParse({ ...conversion, factor: "0.000000" }).success
    ).toBe(false);
    expect(masterInput.safeParse({ ...conversion, toUomId: 2 }).success).toBe(
      false
    );
  });
  it("bounds pagination and rejects unknown modules", () => {
    expect(
      masterListInput.safeParse({ kind: "items", pageSize: 101 }).success
    ).toBe(false);
    expect(masterListInput.safeParse({ kind: "items", page: 0 }).success).toBe(
      false
    );
    expect(masterListInput.safeParse({ kind: "sql" }).success).toBe(false);
  });
});
describe("reference integrity", () => {
  const tx = {} as Transaction;
  it("rejects category cycles before any write", async () => {
    vi.mocked(repository.find).mockResolvedValue({
      id: 2,
      code: "CAT",
      nameAr: "أ",
      nameEn: "A",
      nameUr: "ا",
      active: true,
      version: 1,
      parentId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      validateReferences(
        tx,
        masterInput.parse({ ...named, kind: "categories", parentId: 2 }),
        1
      )
    ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
  });
  it("rejects nonexistent branch references", async () => {
    vi.mocked(repository.find).mockResolvedValue(null);
    await expect(
      validateReferences(
        tx,
        masterInput.parse({ ...named, kind: "sites", branchId: 999 })
      )
    ).rejects.toMatchObject({ domainCode: "INVALID_REFERENCE" });
  });
});
describe("master data API authorization", () => {
  it("rejects unauthenticated access", async () => {
    const caller = appRouter.createCaller({ user: null } as TrpcContext);
    await expect(
      caller.masterData.list({ kind: "items" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("rejects write access for a view-only user", async () => {
    const caller = appRouter.createCaller({
      user: { id: 1, role: "user", permissionCodes: ["master.view"] },
    } as TrpcContext);
    await expect(
      caller.masterData.create({
        data: masterInput.parse(item),
        key: "36c72aa3-3faa-4c72-9e43-1337d1814fea",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
