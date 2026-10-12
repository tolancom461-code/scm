import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { routePolicies } from "./policy-registry";
import {
  permissionAllowed,
  isKnownPermission,
  completePermissions,
  accessProfileInput,
  roleTemplates,
  scopeAllows,
  togglePermission,
} from "../../shared/policy";

describe("central access policy", () => {
  it("gives the project manager operational authority without user or policy administration", () => {
    const manager = {
      role: "user",
      permissionCodes: [...roleTemplates.project_manager.permissions],
    };
    for (const code of [
      "p1.projects.create",
      "p1.contracts.create",
      "p1.certificates.approve",
      "p1.payments.record",
      "p1.retention.release",
      "p1.company.manage",
      "reports.export",
      "documents.view_confidential",
    ])
      expect(permissionAllowed(manager, code), code).toBe(true);
    for (const code of [
      "users.view",
      "users.create",
      "users.edit",
      "users.password.reset",
      "users.status.manage",
      "policy.view",
      "policy.manage",
      "permissions.manage",
    ])
      expect(permissionAllowed(manager, code), code).toBe(false);
    expect(completePermissions(manager.permissionCodes).sort()).toEqual(
      [...manager.permissionCodes].sort()
    );
  });
  it("registers every API action explicitly and uses only known permissions", () => {
    expect(Object.keys(routePolicies).sort()).toEqual(
      Object.keys(appRouter._def.procedures).sort()
    );
    for (const [path, policy] of Object.entries(routePolicies)) {
      expect(
        policy.public || policy.session || !!policy.any?.length,
        path
      ).toBe(true);
      for (const code of policy.any ?? [])
        expect(isKnownPermission(code), `${path}: ${code}`).toBe(true);
    }
  });
  it("keeps only authentication actions public", () => {
    expect(
      Object.entries(routePolicies)
        .filter(([, r]) => r.public)
        .map(([p]) => p)
        .sort()
    ).toEqual([
      "auth.bootstrap",
      "auth.firstRunStatus",
      "auth.login",
      "auth.logout",
      "auth.me",
    ]);
  });
  it("denies unknown permissions even for an administrator and denies inactive users", () => {
    const owner = { role: "admin", permissionCodes: [] };
    expect(permissionAllowed(owner, "p1.contracts.view")).toBe(true);
    expect(permissionAllowed(owner, "future.unregistered")).toBe(false);
    expect(
      permissionAllowed({ ...owner, active: false }, "p1.contracts.view")
    ).toBe(false);
    expect(
      permissionAllowed(
        { role: "user", permissionCodes: ["future.unregistered"] },
        "future.unregistered"
      )
    ).toBe(false);
  });
  it("separates the preparer, approver and accountant duties", () => {
    const allowed = (role: keyof typeof roleTemplates, code: string) =>
      permissionAllowed(
        { role: "user", permissionCodes: [...roleTemplates[role].permissions] },
        code
      );
    expect(allowed("preparer", "p1.certificates.create")).toBe(true);
    expect(allowed("preparer", "p1.certificates.approve")).toBe(false);
    expect(allowed("preparer", "p1.payments.view")).toBe(false);
    expect(allowed("approver", "p1.certificates.approve")).toBe(true);
    expect(allowed("approver", "p1.payments.record")).toBe(false);
    expect(allowed("accountant", "p1.payments.record")).toBe(true);
    expect(allowed("accountant", "p1.certificates.approve")).toBe(false);
    expect(allowed("accountant", "p1.retention.release")).toBe(false);
  });
  it("adds transitive viewing dependencies without granting unrelated actions", () => {
    const result = completePermissions(["p1.payments.record"]);
    expect(result).toEqual(
      expect.arrayContaining([
        "p1.payments.view",
        "p1.certificates.view",
        "p1.contracts.view",
        "p1.projects.view",
      ])
    );
    expect(result).not.toContain("p1.certificates.approve");
    expect(result).not.toContain("p1.retention.release");
  });
  it("rejects unregistered grants and invalid project identifiers", () => {
    const config = {
      userId: 1,
      version: 1,
      template: "custom",
      allProjects: false,
      legacyAccess: false,
      permissions: [],
      projectIds: [1, 1, 2],
    };
    expect(accessProfileInput.parse(config).projectIds).toEqual([1, 2]);
    expect(
      accessProfileInput.safeParse({
        ...config,
        permissions: ["unknown.permission"],
      }).success
    ).toBe(false);
    expect(
      accessProfileInput.safeParse({ ...config, projectIds: [0] }).success
    ).toBe(false);
  });
  it("removes template grants per user and cascades prerequisite removal", () => {
    const before = [...roleTemplates.accountant.permissions];
    const result = togglePermission(before, "p1.payments.record", false);
    expect(result).not.toContain("p1.payments.record");
    expect(result).toContain("p1.payments.view");
    expect(roleTemplates.accountant.permissions).toContain(
      "p1.payments.record"
    );
    const noFinancial = togglePermission(before, "p1.payments.view", false);
    expect(noFinancial).not.toContain("p1.payments.view");
    expect(noFinancial).not.toContain("p1.payments.record");
    expect(noFinancial).toContain("p1.contracts.view");
    expect(togglePermission([], "p1.retention.release", true)).toContain(
      "p1.payments.view"
    );
  });
  it("has no fallback to all projects for an empty scope", () => {
    const scope = {
      allProjects: false,
      legacyAccess: false,
      projectIds: [],
      template: "custom" as const,
      version: 1,
    };
    expect(scopeAllows(scope, 5)).toBe(false);
    expect(scopeAllows({ ...scope, projectIds: [5] }, 5)).toBe(true);
    expect(scopeAllows({ ...scope, projectIds: [5] }, 6)).toBe(false);
    expect(scopeAllows({ ...scope, allProjects: true }, 6)).toBe(true);
  });
});
