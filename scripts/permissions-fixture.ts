import { database } from "../server/core/database";
import { userPermissions, permissions } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
/** Fixture-only raw grants for testing server revalidation. */
export async function setFixturePermissions(userId: number, codes: string[]) {
  await (
    await database()
  ).transaction(async tx => {
    const grants = codes.length
      ? await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(inArray(permissions.code, codes))
      : [];
    if (grants.length !== new Set(codes).size)
      throw Error("Unknown fixture permission");
    await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
    if (grants.length)
      await tx
        .insert(userPermissions)
        .values(grants.map(p => ({ userId, permissionId: p.id })));
  });
}
