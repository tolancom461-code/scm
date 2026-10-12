import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getUserByUsername, closeDb } from "../server/db";
import { userCreateInput } from "../shared/users";
import { roleTemplates } from "../shared/policy";
import { ATOMIC_PERMISSIONS } from "../shared/permissions";
import { authorizeRequest, loadAccess, canAccess } from "../server/core/policy";
import { routePolicies } from "../server/core/policy-registry";
import { createUser } from "../server/modules/users/service";
import { verifyPassword } from "../server/localAuth";

// Explicit owner-authorized provisioning. Never resets or overwrites an account.
async function main() {
  const owner = await getUserByUsername("admin");
  assert(
    owner?.active && owner.role === "admin" && owner.name === "System Owner",
    "Active system owner is required."
  );
  const username = "project.manager";
  assert(
    !(await getUserByUsername(username)),
    "This username already exists; no account or password was changed."
  );
  const password = "Project!" + randomBytes(12).toString("base64url") + "9a";
  const data = userCreateInput.parse({
    username,
    name: "مدير المشاريع",
    password,
    locale: "ar",
    accessPolicy: {
      template: "project_manager",
      permissions: [...roleTemplates.project_manager.permissions],
      allProjects: true,
      projectIds: [],
      legacyAccess: true,
    },
  });
  const ownerAccess = await authorizeRequest(owner.id, "users.create", data);
  const created = await createUser(data, ownerAccess);
  const account = (await getUserByUsername(username))!;
  const access = (await loadAccess(created.id))!;
  assert.equal(
    account.role,
    "user",
    "A restricted manager must never receive the admin bypass."
  );
  assert.equal(account.name, "مدير المشاريع");
  assert.equal(account.active, true);
  assert(await verifyPassword(password, account.passwordHash!));
  assert(
    access.scope.allProjects &&
      access.scope.legacyAccess &&
      access.scope.template === "project_manager"
  );
  const excluded = ATOMIC_PERMISSIONS.filter(p =>
    ["users", "policy", "permissions"].includes(p.module)
  ).map(p => p.code);
  for (const code of excluded)
    assert(!canAccess(access, code), "Forbidden grant: " + code);
  for (const code of roleTemplates.project_manager.permissions)
    assert(canAccess(access, code), "Missing operational grant: " + code);
  assert.equal(
    access.user.permissionCodes.length,
    roleTemplates.project_manager.permissions.length
  );
  const blockedRoutes = Object.keys(routePolicies).filter(
    path =>
      (path.startsWith("users.") || path.startsWith("policy.")) &&
      !routePolicies[path].session &&
      !routePolicies[path].public
  );
  for (const path of blockedRoutes) {
    let denied = false;
    try {
      await authorizeRequest(created.id, path, {});
    } catch (e) {
      denied = (e as { code?: string }).code === "FORBIDDEN";
    }
    assert(denied, "Administrative API was not denied: " + path);
  }
  await authorizeRequest(created.id, "phaseOne.state", undefined);
  const currentOwner = (await getUserByUsername("admin"))!;
  assert.equal(currentOwner.passwordHash, owner.passwordHash);
  assert.equal(currentOwner.role, owner.role);
  assert.equal(currentOwner.active, owner.active);
  const report = {
    account: {
      id: created.id,
      username,
      name: account.name,
      role: account.role,
      active: account.active,
    },
    template: access.scope.template,
    allProjects: true,
    legacyBusinessAccess: true,
    operationalPermissions: access.user.permissionCodes.length,
    deniedPermissions: excluded,
    directApiDenials: blockedRoutes,
    loginPasswordVerified: true,
    ownerUnchanged: true,
    verifiedAt: new Date().toISOString(),
  };
  await mkdir(resolve(".data"), { recursive: true });
  await writeFile(
    resolve(".data/project-manager-verification.json"),
    JSON.stringify(report, null, 2)
  );
  // The initial password is delivered once, never saved in a file or audit event.
  console.log(JSON.stringify({ ...report, temporaryPassword: password }));
}
main()
  .catch(e => {
    console.error(
      "Project manager provisioning failed:",
      e instanceof Error ? e.message : "Unknown error"
    );
    process.exitCode = 1;
  })
  .finally(closeDb);
