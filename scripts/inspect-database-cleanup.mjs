import "dotenv/config";
import mysql from "mysql2/promise";
const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.slice(1)),
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});
const quote = name => "`" + name.replaceAll("`", "``") + "`";
try {
  const [accounts] = await connection.query(
    "SELECT id, username, name, role, active FROM users WHERE username = ?",
    ["admin"]
  );
  if (
    accounts.length !== 1 ||
    accounts[0].role !== "admin" ||
    !accounts[0].active
  )
    throw new Error("A unique active admin account is required.");
  const [tables] = await connection.query(
    "SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME"
  );
  const [keys] = await connection.query(
    "SELECT TABLE_NAME AS child, COLUMN_NAME AS childColumn, REFERENCED_TABLE_NAME AS parent, REFERENCED_COLUMN_NAME AS parentColumn, CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL"
  );
  const counts = [];
  for (const table of tables) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${quote(table.name)}`
    );
    counts.push({ ...table, count: Number(rows[0].count) });
  }
  const keep = [
    "users",
    "permissions",
    "userPermissions",
    "access_profiles",
    "sessions",
    "document_sequences",
    "__drizzle_migrations",
  ];
  const pending = new Set(
    tables.map(t => t.name).filter(name => !keep.includes(name))
  );
  const order = [];
  while (pending.size) {
    const leaves = [...pending].filter(
      name =>
        !keys.some(
          k => k.parent === name && k.child !== name && pending.has(k.child)
        )
    );
    if (!leaves.length) break;
    for (const name of leaves) {
      order.push(name);
      pending.delete(name);
    }
  }
  const self = keys.filter(k => k.child === k.parent);
  console.log(
    JSON.stringify(
      {
        owner: accounts[0],
        nonemptyTables: counts.filter(t => t.count),
        tableCount: counts.length,
        technicalTables: keep,
        deleteOrder: order,
        cycles: [...pending],
        selfReferences: self,
      },
      null,
      2
    )
  );
} finally {
  await connection.end();
}
