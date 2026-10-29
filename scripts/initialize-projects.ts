import { once } from "../server/core/idempotency";
import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { seedPermissions, closeDb } from "../server/db";
import { database } from "../server/core/database";
import { permissions, userPermissions, users } from "../drizzle/schema";
import { accessProfiles } from "../drizzle/policy";
try {
  await seedPermissions();
  const db = await database();
  const managers = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(accessProfiles, eq(users.id, accessProfiles.userId))
    .where(eq(accessProfiles.template, "project_manager"));
  const codes = await db
    .select()
    .from(permissions)
    .where(
      inArray(permissions.code, [
        "pm.view",
        "pm.create",
        "pm.edit",
        "pm.submit",
        "pm.review",
        "pm.start",
        "pm.tasks.manage",
        "pm.employees.manage",
        "pm.statuses.manage",
      ])
    );
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true)))
    .limit(1);
  if (!owner && managers.length)
    throw Error(
      "An active system owner is required to initialize existing profiles."
    );
  if (owner)
    await db.transaction(tx =>
      once(
        tx,
        owner.id,
        "pm.module.initialize",
        "existing-managers-v1",
        { version: 1 },
        async () => {
          for (const manager of managers) {
            const old = await tx
              .select()
              .from(userPermissions)
              .where(
                and(
                  eq(userPermissions.userId, manager.id),
                  inArray(
                    userPermissions.permissionId,
                    codes.map(p => p.id)
                  )
                )
              );
            const added = codes.filter(
              p => !old.some(g => g.permissionId === p.id)
            );
            if (added.length)
              await tx
                .insert(userPermissions)
                .values(
                  added.map(p => ({ userId: manager.id, permissionId: p.id }))
                );
          }
          return { id: owner.id };
        }
      )
    );
  console.log(
    JSON.stringify({
      permissionsInitialized: codes.length,
      projectManagerProfiles: managers.length,
      credentialsChanged: false,
    })
  );
} finally {
  await closeDb();
}
