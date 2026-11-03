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

/**
 * Ejecuta `fn` con candados de aplicación (advisory locks de SESIÓN de Postgres) tomados en una conexión dedicada, en orden estable
 * (sin interbloqueos). Sirve para serializar secuencias «verificar → escribir» que usan varias consultas/servicios (p. ej. no remitir dos
 * veces las mismas unidades): dos usuarios, incluso en instancias distintas, esperan su turno. Sin base configurada solo ejecuta `fn`.
 */
export async function withAdvisoryLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const unique = [...new Set(keys.filter(Boolean))].sort();
  if (unique.length === 0 || !isDatabaseConfigured()) return fn();
  getDb();
  const client = await pool!.connect();
  const taken: string[] = [];
  try {
    for (const k of unique) {
      await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [k]);
      taken.push(k);
    }
    return await fn();
  } finally {
    for (const k of taken.reverse()) await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [k]).catch(() => undefined);
    client.release();
  }
}

/** Clave del candado de remitos de UNA entrega (renglón de entrega a Producción). */
export const remitoLineLockKey = (deliveryLineId: string) => `remito-dl:${deliveryLineId}`;
