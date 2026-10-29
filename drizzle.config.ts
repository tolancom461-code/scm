import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}
const connection = new URL(connectionString);

export default defineConfig({
  schema: [
    "./drizzle/schema.ts",
    "./drizzle/construction.ts",
    "./drizzle/foundation.ts",
    "./drizzle/phase-one.ts",
    "./drizzle/policy.ts",
  ],
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: connection.hostname,
    port: Number(connection.port || 3306),
    user: decodeURIComponent(connection.username),
    password: decodeURIComponent(connection.password),
    database: decodeURIComponent(connection.pathname.slice(1)),
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  },
});
