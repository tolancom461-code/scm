import { connectDatabase } from "./database-connection.mjs";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const db = await connectDatabase();
try {
  const [tables] = await db.query("SHOW TABLES");
  const names = tables.map(t => Object.values(t)[0]);
  if (names.length && !names.includes("__drizzle_migrations"))
    throw Error(
      "Existing untracked schema: do not apply a fresh baseline to populated tables."
    );
  if (names.includes("__drizzle_migrations")) {
    const [rows] = await db.query(
      "SELECT hash FROM __drizzle_migrations ORDER BY created_at"
    );
    const baselineHash = createHash("sha256")
      .update(await readFile("drizzle/0000_pscm_canonical.sql", "utf8"))
      .digest("hex");
    if (rows.length && rows[0].hash !== baselineHash)
      throw Error(
        "Historical database requires explicit unification; see docs/system-unification.md."
      );
  }
  await migrate(drizzle(db), { migrationsFolder: "drizzle" });
  console.log("Canonical PSCM migrations applied.");
} finally {
  await db.end();
}
