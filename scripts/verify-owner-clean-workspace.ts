import "dotenv/config";
import assert from "node:assert/strict";
import { loadAccess } from "../server/core/policy";
import { appRouter } from "../server/routers";
import { closeDb } from "../server/db";
import type { TrpcContext } from "../server/_core/context";

// Read-only application checks; no fixtures, sessions, grants, or business records created.
try {
  const access = await loadAccess(630001);
  assert(
    access?.user.username === "admin" &&
      access.user.name === "System Owner" &&
      access.user.role === "admin"
  );
  const caller = appRouter.createCaller({
    user: access.user,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
  const [users, state, suppliers, policy] = await Promise.all([
    caller.users.list(),
    caller.phaseOne.state(),
    caller.suppliers.list(),
    caller.policy.catalog(),
  ]);
  assert.equal(users.length, 1);
  assert.equal(users[0].username, "admin");
  for (const key of [
    "projects",
    "suppliers",
    "contracts",
    "certificates",
    "payments",
    "balances",
    "schedules",
    "accounts",
  ] as const)
    assert.equal(state[key].length, 0, `${key} must be empty`);
  assert.equal(state.company, null);
  assert.equal(suppliers.length, 0);
  assert.equal(policy.users.length, 1);
  assert.equal(policy.projects.length, 0);
  assert.equal(policy.permissions.length, 74);
  assert(policy.canManage && policy.canDelegateAll && policy.canDelegateLegacy);
  console.log(
    JSON.stringify({
      applicationChecksPassed: true,
      remainingUser: "admin — System Owner",
      projects: 0,
      suppliers: 0,
      contracts: 0,
      certificates: 0,
      payments: 0,
      ownerCanManageUsersAndPermissions: true,
    })
  );
} finally {
  await closeDb();
}
