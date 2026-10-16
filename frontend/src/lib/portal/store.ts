import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";

export type Row = Record<string, unknown>;
export type Db = ReturnType<typeof getDb>;
/** Ejecutor SQL común a la conexión y a una transacción. */
export type SqlExec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

export class PortalError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "PORTAL_ERROR") {
    super(message);
    this.name = "PortalError";
  }
}

export function requireDb(): Db {
  if (!isDatabaseConfigured()) throw new PortalError("El portal requiere la base de datos: no está configurada en este entorno.", 503, "NO_DB");
  return getDb();
}

export const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
export const isoOrNull = (v: unknown): string | null => (v == null ? null : new Date(String(v)).toISOString());

export type AuditInput = {
  clientId?: string | null;
  type: string;
  kind: "CLIENTE" | "STAFF" | "SISTEMA";
  actor?: string | null;
  ipHash?: string | null;
  detail?: Record<string, unknown>;
};

/** Auditoría del portal (accesos, administración, recepciones). Nunca guarda códigos ni la IP en claro. */
export async function audit(db: SqlExec, e: AuditInput): Promise<void> {
  await db.execute(sql`
    insert into portal_audit_events (id, client_id, event_type, actor_kind, actor, ip_hash, detail)
    values (${randomUUID()}::uuid, ${e.clientId ?? null}::uuid, ${e.type}, ${e.kind}, ${e.actor ?? null}, ${e.ipHash ?? null}, ${JSON.stringify(e.detail ?? {})}::jsonb)`);
}

/**
 * Límite por ventana fija, en base (el servidor es serverless: la memoria no se comparte entre instancias).
 * Cuenta CADA intento (válido o no) para que el límite no revele si los datos existían.
 */
export async function rateLimitHit(db: SqlExec, bucket: string, windowSeconds: number, limit: number): Promise<{ allowed: boolean; hits: number }> {
  const ms = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / ms) * ms).toISOString();
  const rows = (await db.execute(sql`
    insert into portal_rate_limits (bucket, window_start, hits) values (${bucket}, ${windowStart}::timestamptz, 1)
    on conflict (bucket, window_start) do update set hits = portal_rate_limits.hits + 1
    returning hits`)).rows as Row[];
  const hits = Number(rows[0]?.hits ?? 1);
  if (Math.random() < 0.01) {
    await db.execute(sql`delete from portal_rate_limits where window_start < now() - interval '2 days'`).catch(() => undefined);
  }
  return { allowed: hits <= limit, hits };
}
