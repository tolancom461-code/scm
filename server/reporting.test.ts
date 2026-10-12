import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ATOMIC_PERMISSIONS } from "./permissions";
vi.mock("./core/policy", async original => ({
  ...(await original<typeof import("./core/policy")>()),
  authorizeRequest: vi.fn(async () => ({
    user: context([]).user,
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

function context(permissionCodes: string[]): TrpcContext {
  return {
    user: {
      id: 99,
      openId: "local:report-viewer",
      username: "report-viewer",
      passwordHash: "x",
      name: "Report Viewer",
      email: null,
      loginMethod: "local",
      role: "user",
      active: true,
      preferredLocale: "ar",
      permissionCodes,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("reports access", () => {
  it("defines a dedicated atomic export permission", () => {
    expect(
      ATOMIC_PERMISSIONS.some(
        permission => permission.code === "reports.export"
      )
    ).toBe(true);
  });

  it("rejects data exports without the report export permission before accessing data", async () => {
    const caller = appRouter.createCaller(context([]));
    await expect(
      caller.reports.data({ module: "requests" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
