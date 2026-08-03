/**
 * Gate independiente para features de migración 0007 (work_view_archives).
 * NO reutiliza isFeatureSchemaReady (0005) ni remito (0006) — sonda solo work_view_archives.
 */
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isFeatureMemoryAllowed } from "@/lib/db/feature-schema";

export class WorkViewArchiveSchemaPendingError extends Error {
  readonly code = "SCHEMA_PENDING_0007" as const;
  constructor(
    message = "Base de datos pendiente de actualización (archivar de mi vista). Los cambios están deshabilitados."
  ) {
    super(message);
    this.name = "WorkViewArchiveSchemaPendingError";
  }
}

let cachedReady: boolean | null = null;
let cachedAt = 0;
const TTL_MS = 30_000;

export function resetWorkViewArchiveSchemaCache(): void {
  cachedReady = null;
  cachedAt = 0;
}

export async function isWorkViewArchiveSchemaReady(): Promise<boolean> {
  if (isFeatureMemoryAllowed()) return true;
  if (!isDatabaseConfigured()) return false;
  const now = Date.now();
  if (cachedReady != null && now - cachedAt < TTL_MS) return cachedReady;
  try {
    const db = getDb();
    await db.execute(sql`select 1 from work_view_archives limit 1`);
    cachedReady = true;
  } catch {
    cachedReady = false;
  }
  cachedAt = now;
  return cachedReady;
}

export async function assertWorkViewArchiveWritesEnabled(): Promise<void> {
  if (isFeatureMemoryAllowed()) return;
  const ready = await isWorkViewArchiveSchemaReady();
  if (!ready) throw new WorkViewArchiveSchemaPendingError();
}

export function workViewArchiveSchemaPendingResponse() {
  return {
    error:
      "Base de datos pendiente de actualización (archivar de mi vista). Los cambios están deshabilitados.",
    schemaPending: true as const,
    persistenceReady: false as const,
  };
}
