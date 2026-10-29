import "dotenv/config";
import mysql from "mysql2/promise";
export async function connectDatabase() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  const u = new URL(process.env.DATABASE_URL);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    dateStrings: true,
  });
}
