import { describe, expect, it, vi } from "vitest";
vi.mock("../../db", () => ({ countUsers: vi.fn(), seedPermissions: vi.fn() }));
import * as db from "../../db";
import { authRouter } from "./router";
import { router } from "../../_core/trpc";
import type { TrpcContext } from "../../_core/context";
const caller = router({ auth: authRouter }).createCaller({
  user: null,
  req: { headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});
describe("landing readiness is read-only", () => {
  it("reports an initialized system without rewriting permissions", async () => {
    vi.mocked(db.countUsers).mockResolvedValue(2);
    expect(await caller.auth.firstRunStatus()).toEqual({ needsSetup: false });
    expect(db.seedPermissions).not.toHaveBeenCalled();
  });
  it("still allows first administrator setup on an empty database", async () => {
    vi.mocked(db.countUsers).mockResolvedValue(0);
    expect(await caller.auth.firstRunStatus()).toEqual({ needsSetup: true });
    expect(db.seedPermissions).not.toHaveBeenCalled();
  });
  it("does not treat a failed database read as an empty system", async () => {
    vi.mocked(db.countUsers).mockRejectedValueOnce(
      new Error("database unavailable")
    );
    await expect(caller.auth.firstRunStatus()).rejects.toThrow(
      "database unavailable"
    );
  });
});
