import "dotenv/config";
import { inArray } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { database } from "../server/core/database";
import { documents } from "../drizzle/schema";
import { localDocumentPath } from "../server/storage";
import * as db from "../server/db";
import { hashPassword } from "../server/localAuth";
import { loadAccess } from "../server/core/policy";
import { savePolicy, userPolicy } from "../server/modules/policy/service";
import { roleTemplates, type AccessTemplate } from "../shared/policy";
import {
  setupPhaseOne,
  cleanupPhaseOne,
  type PhaseFixture,
} from "./phase-one-fixture";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

export async function callerFor(id: number) {
  return appRouter.createCaller({
    user: (await loadAccess(id))!.user,
    req: { headers: {}, protocol: "http" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}
export async function configure(
  ownerId: number,
  userId: number,
  template: AccessTemplate,
  projectIds: number[],
  permissions: string[] = []
) {
  const owner = (await loadAccess(ownerId))!;
  const before = await userPolicy(userId, owner);
  return savePolicy(
    {
      ...before,
      template,
      permissions: [...roleTemplates[template].permissions, ...permissions],
      projectIds,
      allProjects: false,
    },
    owner
  );
}
export async function setupPolicyFixture() {
  let a: PhaseFixture | undefined, b: PhaseFixture | undefined;
  try {
    a = await setupPhaseOne();
    b = await setupPhaseOne();
    const extra: Record<string, number> = {};
    for (const role of ["owner", "viewer", "empty", "manager"]) {
      const username = a.code.toLowerCase() + "-" + role;
      extra[role] = await db.createLocalUser({
        username,
        passwordHash: await hashPassword(a.password),
        name: a.code + " " + role,
        role: role === "owner" ? "admin" : "user",
        locale: "ar",
      });
      a.actors.push(extra[role]);
      a.accounts.push({ role, username });
    }
    for (const [index, template] of [
      "preparer",
      "approver",
      "accountant",
    ].entries())
      await configure(
        extra.owner,
        a.actors[index],
        template as AccessTemplate,
        [a.projectId]
      );
    await configure(extra.owner, extra.viewer, "viewer", [a.projectId]);
    await configure(
      extra.owner,
      extra.manager,
      "custom",
      [a.projectId],
      [
        ...roleTemplates.preparer.permissions,
        "policy.manage",
        "users.create",
        "users.password.reset",
      ]
    );
    return { a, b, extra };
  } catch (error) {
    if (a) await cleanupPhaseOne(a);
    if (b) await cleanupPhaseOne(b);
    throw error;
  }
}
export type PolicyFixture = Awaited<ReturnType<typeof setupPolicyFixture>>;
export async function cleanupPolicyFixture(f: PolicyFixture) {
  const connection = await database();
  const files = await connection
    .select({ id: documents.id, key: documents.storageKey })
    .from(documents)
    .where(inArray(documents.uploadedBy, [...f.a.actors, ...f.b.actors]));
  // The owner from A creates a certificate in B: remove B's records before A's users.
  await cleanupPhaseOne(f.b);
  await cleanupPhaseOne(f.a);
  for (const file of files)
    if (file.key.startsWith("local/"))
      await unlink(localDocumentPath(file.key)).catch(() => {});
}
