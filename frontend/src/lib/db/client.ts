import "server-only";

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/lib/db/schema";

neonConfig.webSocketConstructor = ws;

export type GenusDb = NeonDatabase<typeof schema>;

let pool: Pool | null = null;
let db: GenusDb | null = null;

export function getDatabaseUrl(): string | null {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    null
  );
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/** Lazy init — seguro en build time (no tira si falta DATABASE_URL hasta el primer uso). */
export function getDb(): GenusDb {
  if (db) return db;
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL no configurada (Neon Preview).");
  }
  pool = new Pool({ connectionString: url });
  db = drizzle(pool, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
