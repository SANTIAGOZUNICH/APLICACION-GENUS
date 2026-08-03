/**
 * Gate independiente para features de migración 0006 (remitos).
 * NO reutiliza isFeatureSchemaReady (0005) — sonda solo la tabla remitos.
 */
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";

export class RemitoSchemaPendingError extends Error {
  readonly code = "SCHEMA_PENDING_0006" as const;
  constructor(
    message = "Base de datos pendiente de actualización (remitos). Los cambios están deshabilitados."
  ) {
    super(message);
    this.name = "RemitoSchemaPendingError";
  }
}

let cachedReady: boolean | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export function resetRemitoSchemaCache(): void {
  cachedReady = null;
  cachedAt = 0;
}

export async function isRemitoSchemaReady(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return true;
  if (!isDatabaseConfigured()) return false;
  const now = Date.now();
  if (cachedReady != null && now - cachedAt < TTL_MS) return cachedReady;
  try {
    const db = getDb();
    await db.execute(sql`select 1 from remitos limit 1`);
    cachedReady = true;
  } catch {
    cachedReady = false;
  }
  cachedAt = now;
  return cachedReady;
}

export async function assertRemitoWritesEnabled(): Promise<void> {
  if (isFeatureMemoryAllowed()) return;
  const ready = await isRemitoSchemaReady();
  if (!ready) throw new RemitoSchemaPendingError();
}

export function remitoSchemaPendingResponse() {
  return {
    error:
      "Base de datos pendiente de actualización (remitos). Los cambios están deshabilitados.",
    schemaPending: true as const,
    persistenceReady: false as const,
  };
}
