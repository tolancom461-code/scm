import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { accessProfiles } from "../drizzle/policy";
import { permissions, userPermissions, users } from "../drizzle/schema";
import { seedPermissions, closeDb } from "../server/db";
import { database } from "../server/core/database";
import { recordChange } from "../server/core/audit";

try {
  await seedPermissions();
  const db = await database();
  const added = await db.transaction(async tx => {
    const [owner] = await tx
      .select()
      .from(users)
      .where(eq(users.role, "admin"));
    if (!owner) throw Error("System owner required");
    const managers = await tx
      .select({ id: accessProfiles.userId })
      .from(accessProfiles)
      .where(eq(accessProfiles.template, "project_manager"));
    const catalog = (await tx.select().from(permissions)).filter(p =>
      p.code.startsWith("materialRequisitions.")
    );
    let count = 0;
    for (const manager of managers) {
      const existing = await tx
        .select()
        .from(userPermissions)
        .where(
          and(
            eq(userPermissions.userId, manager.id),
            inArray(
              userPermissions.permissionId,
              catalog.map(p => p.id)
            )
          )
        );
      const missing = catalog.filter(
        p => !existing.some(g => g.permissionId === p.id)
      );
      if (!missing.length) continue;
      await tx.insert(userPermissions).values(
        missing.map(p => ({
          userId: manager.id,
          permissionId: p.id,
          scopeType: "global",
        }))
      );
      await tx
        .update(accessProfiles)
        .set({
          version:
            (
              await tx
                .select()
                .from(accessProfiles)
                .where(eq(accessProfiles.userId, manager.id))
            )[0].version + 1,
        })
        .where(eq(accessProfiles.userId, manager.id));
      await recordChange(tx, {
        actorId: owner.id,
        action: "materialRequisitions.module.enabled",
        entityType: "user",
        entityId: manager.id,
        after: { permissionsAdded: missing.map(p => p.code) },
      });
      count += missing.length;
    }
    return count;
  });
  console.log(
    JSON.stringify({ module: "materialRequisitions", grantsAdded: added })
  );
} finally {
  await closeDb();
}
