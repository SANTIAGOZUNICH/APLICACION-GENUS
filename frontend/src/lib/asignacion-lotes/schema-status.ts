/**
 * ¿La base tiene la migración 0043 (capa de ediciones de GENUS sobre filas sincronizadas)?
 *
 * El código de Asignación de lotes posterior al PR #112 lee `asignacion_lotes.source_lote/source_codigo/
 * source_producto`, `asignacion_lotes_cell_audit.reason` y la tabla `asignacion_lotes_local_edits`. Sin ellas,
 * listar y guardar fallan. Este chequeo (solo lectura de `information_schema`) permite:
 *   - responder con un motivo claro en la API (503, nunca un 500 genérico),
 *   - mostrarlo en la pantalla y en /api/v1/env-check para verificar Production sin tocar datos.
 * No aplica ni modifica nada: las migraciones las aplica solo el build (scripts/migrate-if-database.mjs).
 */
import "server-only";

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { isMissingSchemaError, sqlStateOf } from "@/lib/db/missing-schema";
import { ordersErrorResponse } from "@/lib/orders/http";

export const LOCAL_EDITS_MIGRATION = "0043_asignacion_lotes_local_edits";

/** Objetos que crea 0043 (tabla.columna, o solo tabla). */
export const LOCAL_EDITS_REQUIRED_OBJECTS = [
  "asignacion_lotes.source_lote",
  "asignacion_lotes.source_codigo",
  "asignacion_lotes.source_producto",
  "asignacion_lotes_cell_audit.reason",
  "asignacion_lotes_local_edits",
] as const;

export const LOCAL_EDITS_SCHEMA_PENDING_MESSAGE =
  "La base de datos todavía no tiene la migración 0043 (ediciones de GENUS sobre filas de Google). Asignación de lotes " +
  "no puede listar ni guardar cambios hasta que el deploy la aplique. No se guardó nada.";

export interface LocalEditsSchemaStatus {
  ready: boolean;
  missing: string[];
  migration: typeof LOCAL_EDITS_MIGRATION;
}

let cached: { status: LocalEditsSchemaStatus; at: number } | null = null;
const TTL_MS = 30_000;

export function resetLocalEditsSchemaStatusCache(): void {
  cached = null;
}

/** Faltantes a partir de las filas de information_schema (función pura, testeable). */
export function missingLocalEditsObjects(present: Iterable<string>): string[] {
  const have = new Set(present);
  return LOCAL_EDITS_REQUIRED_OBJECTS.filter((o) => !have.has(o));
}

export async function getLocalEditsSchemaStatus(): Promise<LocalEditsSchemaStatus | null> {
  if (!isDatabaseConfigured()) return null;
  // Una vez lista no puede "desaparecer" (0043 es aditiva): se cachea para siempre; si falta, se reintenta cada 30 s.
  if (cached && (cached.status.ready || Date.now() - cached.at < TTL_MS)) return cached.status;
  const res = await getDb().execute(sql`
    select table_name || '.' || column_name as obj from information_schema.columns
     where table_schema = current_schema()
       and ((table_name = 'asignacion_lotes' and column_name in ('source_lote','source_codigo','source_producto'))
         or (table_name = 'asignacion_lotes_cell_audit' and column_name = 'reason'))
    union all
    select table_name as obj from information_schema.tables
     where table_schema = current_schema() and table_name = 'asignacion_lotes_local_edits'`);
  const rows = (res as unknown as { rows?: { obj: string }[] }).rows ?? (res as unknown as { obj: string }[]);
  const missing = missingLocalEditsObjects(rows.map((r) => r.obj));
  const status: LocalEditsSchemaStatus = { ready: missing.length === 0, missing, migration: LOCAL_EDITS_MIGRATION };
  cached = { status, at: Date.now() };
  return status;
}

/**
 * Respuesta de error de las rutas de Asignación de lotes: si falta 0043, 503 con el motivo exacto y los objetos
 * faltantes; el resto, como siempre.
 */
export async function asignacionLotesErrorResponse(err: unknown): Promise<NextResponse> {
  if (isMissingSchemaError(err)) {
    let status: LocalEditsSchemaStatus | null = null;
    try {
      resetLocalEditsSchemaStatusCache();
      status = await getLocalEditsSchemaStatus();
    } catch {
      status = null;
    }
    console.error(
      `[asignacion-lotes] esquema pendiente (SQLSTATE ${sqlStateOf(err)}); faltan: ${status?.missing.join(", ") || "?"}`
    );
    return NextResponse.json(
      {
        error: LOCAL_EDITS_SCHEMA_PENDING_MESSAGE,
        code: "ASIGNACION_LOTES_SCHEMA_PENDING",
        schemaPending: true,
        migration: LOCAL_EDITS_MIGRATION,
        missing: status?.missing ?? [],
      },
      { status: 503 }
    );
  }
  return ordersErrorResponse(err);
}

/** Commit desplegado en el servidor (Vercel lo expone en runtime). Vacío fuera de Vercel. */
export function serverBuildSha(): string {
  return (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").trim();
}
