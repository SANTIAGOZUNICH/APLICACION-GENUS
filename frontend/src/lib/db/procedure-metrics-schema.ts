/**
 * Gate independiente para migración 0009 (procedimientos + métricas).
 * Sonda procedure_folders y packaging_metrics.
 */
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";

export class ProcedureMetricsSchemaPendingError extends Error {
  readonly code = "SCHEMA_PENDING_0009" as const;
  constructor(
    message = "Base de datos pendiente de actualización. Los cambios están deshabilitados."
  ) {
    super(message);
    this.name = "ProcedureMetricsSchemaPendingError";
  }
}

let cachedReady: boolean | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export function resetProcedureMetricsSchemaCache(): void {
  cachedReady = null;
  cachedAt = 0;
}

export async function isProcedureMetricsSchemaReady(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return true;
  if (!isDatabaseConfigured()) return false;
  const now = Date.now();
  if (cachedReady != null && now - cachedAt < TTL_MS) return cachedReady;
  try {
    const db = getDb();
    await db.execute(sql`select 1 from procedure_folders limit 1`);
    await db.execute(sql`select 1 from packaging_metrics limit 1`);
    cachedReady = true;
  } catch {
    cachedReady = false;
  }
  cachedAt = now;
  return cachedReady;
}

export async function assertProcedureMetricsWritesEnabled(): Promise<void> {
  if (isFeatureMemoryAllowed()) return;
  const ready = await isProcedureMetricsSchemaReady();
  if (!ready) throw new ProcedureMetricsSchemaPendingError();
}

export function procedureMetricsSchemaPendingResponse() {
  return {
    error:
      "Base de datos pendiente de actualización. Los cambios están deshabilitados.",
    schemaPending: true as const,
    persistenceReady: false as const,
  };
}
