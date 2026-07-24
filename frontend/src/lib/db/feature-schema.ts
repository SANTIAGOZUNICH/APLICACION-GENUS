/**
 * Gate para features de migración 0005.
 * Sin tablas aplicadas: lecturas vacías + writes bloqueados (sin memoria silenciosa).
 * En tests (vitest) se permite memoria explícita.
 */
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";

export class SchemaPendingError extends Error {
  readonly code = "SCHEMA_PENDING_0005" as const;
  constructor(
    message = "Base de datos pendiente de actualización. Los cambios están deshabilitados."
  ) {
    super(message);
    this.name = "SchemaPendingError";
  }
}

export function isFeatureMemoryAllowed(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.GENUS_FEATURE_MEMORY === "1"
  );
}

let cachedReady: boolean | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

/** Invalida cache (tests / tras aplicar migración). */
export function resetFeatureSchemaCache(): void {
  cachedReady = null;
  cachedAt = 0;
}

export async function isFeatureSchemaReady(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return true;
  if (!isDatabaseConfigured()) return false;
  const now = Date.now();
  if (cachedReady != null && now - cachedAt < TTL_MS) return cachedReady;
  try {
    const db = getDb();
    await db.execute(sql`select 1 from os_internal_messages limit 1`);
    await db.execute(sql`select 1 from mp_stock_movements limit 1`);
    await db.execute(sql`select 1 from coa_folders limit 1`);
    cachedReady = true;
  } catch {
    cachedReady = false;
  }
  cachedAt = now;
  return cachedReady;
}

export async function assertFeatureWritesEnabled(): Promise<void> {
  if (isFeatureMemoryAllowed()) return;
  const ready = await isFeatureSchemaReady();
  if (!ready) throw new SchemaPendingError();
}

export function schemaPendingResponse() {
  return {
    error: "Base de datos pendiente de actualización. Los cambios están deshabilitados.",
    schemaPending: true as const,
    persistenceReady: false as const,
  };
}
