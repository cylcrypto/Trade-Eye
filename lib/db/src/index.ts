import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  max: 3,
});

pool.on("error", (err) => {
  console.error("[DB] Pool error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
