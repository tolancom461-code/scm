import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { database } from "../server/core/database";
import { closeDb } from "../server/db";
import { loadAccess } from "../server/core/policy";
try {
  const db = await database();
  const [rows] = await db.execute(sql`SELECT
   (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()) AS table_count,
   (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name<>'__drizzle_migrations') AS business_table_count,
   (SELECT COUNT(*) FROM users u LEFT JOIN access_profiles p ON p.user_id=u.id WHERE p.user_id IS NULL) AS missing_profiles,
   (SELECT COUNT(*) FROM users WHERE username LIKE 'p1test-%') AS fixture_users,
   (SELECT COUNT(*) FROM p1_projects WHERE name LIKE 'P1TEST-%') AS fixture_projects,
   (SELECT COUNT(*) FROM p1_contracts WHERE title LIKE 'P1TEST-%') AS fixture_contracts,
   (SELECT COUNT(*) FROM suppliers WHERE supplierNumber LIKE 'P1TEST-%') AS fixture_suppliers,
   (SELECT COUNT(*) FROM users WHERE role='admin' AND username NOT LIKE 'p1test-%' AND username NOT LIKE 'utest_%') AS existing_administrators,
   (SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND username NOT LIKE 'p1test-%' AND username NOT LIKE 'utest_%') AS active_existing_administrators`);
  const result = (rows as unknown as Record<string, number>[])[0];
  assert.equal(Number(result.missing_profiles), 0);
  for (const field of [
    "fixture_users",
    "fixture_projects",
    "fixture_contracts",
    "fixture_suppliers",
  ])
    assert.equal(Number(result[field]), 0, field);
  const owner = await loadAccess(630001);
  assert(
    owner?.user.role === "admin" &&
      owner.scope.allProjects &&
      owner.scope.legacyAccess
  );
  console.log(JSON.stringify({ ...result, owner_access_preserved: true }));
} finally {
  await closeDb();
}
