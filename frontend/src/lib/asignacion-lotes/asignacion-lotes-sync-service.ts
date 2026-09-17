/**
 * Motor de sincronización Google Sheets → Asignación de Lotes (0032).
 *
 * Arquitectura (pedido explícito): Google Sheets es una FUENTE EXTERNA.
 * Ninguna pantalla operativa lee Google en cada request — este servicio es
 * el ÚNICO lugar que lee Sheets, y solo escribe en asignacion_lotes vía
 * `AsignacionLotesService.upsertFromSource`, que hereda gratis toda la
 * protección ya existente (carga flexible, fill-once de WorkItem, resolver
 * tolerante de PR #95, detección de inconsistencia). Si Google está caído,
 * GENUS OS sigue funcionando con la última sincronización válida — nunca
 * lanza un error que tumbe una pantalla, siempre se degrada a
 * "syncStatus: error" + lastError, dejando los datos previos intactos.
 *
 * Reutiliza EL MISMO pipeline de mapeo/validación que "Pegar desde Excel"
 * (asignacion-lotes-import.ts) — una fila de Sheets y una fila pegada son
 * estructuralmente lo mismo (header + string[][]), así que no hay un
 * segundo parser que mantener.
 */
import "server-only";

import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { autoMapColumns, rowToObject } from "@/features/os/operational/lib/clipboard-import";
import {
  ASIGNACION_LOTES_FIELD_ALIASES,
  buildAsignacionLoteFromMappedRow,
  validateAsignacionLoteRow,
  type AsignacionLoteMappedRow,
} from "@/features/os/operational/lib/asignacion-lotes-import";
import { getAsignacionLoteSourcesService } from "./asignacion-lote-sources-service";
import { getAsignacionLotesService } from "./asignacion-lotes-service";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLoteSyncRuns } from "@/lib/db/schema";
import type { AsignacionLoteSource, SyncRunSummary, SyncTriggerKind } from "./source-types";

const SYNC_ACTOR = { email: "asignacion-lotes-sync@sistema", displayName: "Sincronización Google Sheets" };

function makeRunId(): string {
  return `alsr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const memRuns: SyncRunSummary[] = [];

async function recordRun(summary: SyncRunSummary): Promise<void> {
  if (isDatabaseConfigured()) {
    const db = getDb();
    await db.insert(asignacionLoteSyncRuns).values({
      id: summary.id,
      sourceId: summary.sourceId,
      startedAt: new Date(summary.startedAt),
      finishedAt: summary.finishedAt ? new Date(summary.finishedAt) : null,
      status: summary.status,
      rowsRead: summary.rowsRead,
      createdCount: summary.createdCount,
      updatedCount: summary.updatedCount,
      unchangedCount: summary.unchangedCount,
      invalidCount: summary.invalidCount,
      archivedCount: summary.archivedCount,
      conflictCount: summary.conflictCount,
      errorMessage: summary.errorMessage,
      triggeredBy: summary.triggeredBy,
      triggerKind: summary.triggerKind,
    });
    return;
  }
  memRuns.unshift(summary);
}

export async function listSyncRuns(sourceId: string, limit = 20): Promise<SyncRunSummary[]> {
  if (isDatabaseConfigured()) {
    const { desc, eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(asignacionLoteSyncRuns)
      .where(eq(asignacionLoteSyncRuns.sourceId, sourceId))
      .orderBy(desc(asignacionLoteSyncRuns.startedAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId ?? sourceId,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      status: row.status as SyncRunSummary["status"],
      rowsRead: row.rowsRead,
      createdCount: row.createdCount,
      updatedCount: row.updatedCount,
      unchangedCount: row.unchangedCount,
      invalidCount: row.invalidCount,
      archivedCount: row.archivedCount,
      conflictCount: row.conflictCount,
      errorMessage: row.errorMessage,
      triggeredBy: row.triggeredBy,
      triggerKind: row.triggerKind as SyncTriggerKind,
    }));
  }
  return memRuns.filter((r) => r.sourceId === sourceId).slice(0, limit);
}

/**
 * Sincroniza UNA fuente. Nunca lanza — cualquier falla (Sheets caído, hoja
 * borrada, credenciales) se captura y se persiste como syncStatus="error" +
 * lastError, dejando los datos existentes sin tocar.
 */
export async function syncSource(
  source: AsignacionLoteSource,
  triggeredBy: string,
  triggerKind: SyncTriggerKind
): Promise<SyncRunSummary> {
  const startedAt = new Date().toISOString();
  const runId = makeRunId();
  const sourcesService = getAsignacionLoteSourcesService();
  const lotesService = getAsignacionLotesService();

  const summary: SyncRunSummary = {
    id: runId,
    sourceId: source.id,
    startedAt,
    finishedAt: null,
    status: "en_progreso",
    rowsRead: 0,
    createdCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    invalidCount: 0,
    archivedCount: 0,
    conflictCount: 0,
    errorMessage: null,
    triggeredBy,
    triggerKind,
  };

  try {
    const rows = await sheetsReader.readTab(source.spreadsheetId, source.sheetTab);
    const header = rows[0] ?? [];
    const dataRows = rows.slice(1);
    summary.rowsRead = dataRows.length;

    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    const seenIds = new Set<string>();

    for (let i = 0; i < dataRows.length; i += 1) {
      const rowIndex = i + 2; // +1 header, +1 base-1 para que coincida con el número de fila real de la Sheet
      const mapped = rowToObject(dataRows[i]!, mapping) as Partial<AsignacionLoteMappedRow>;
      if (!mapped.lote?.trim() && !mapped.producto?.trim()) continue; // fila vacía — no cuenta como inválida

      const issues = validateAsignacionLoteRow(mapped, rowIndex);
      const hasBlockingError = issues.some((issue) => issue.severity === "error");
      if (hasBlockingError) {
        summary.invalidCount += 1;
        continue;
      }
      if (!mapped.lote?.trim() || !mapped.producto?.trim()) {
        // Carga flexible tolera celdas vacías salvo estas dos — sin lote o
        // sin producto no hay nada determinístico que vincular después.
        summary.invalidCount += 1;
        continue;
      }

      const conflict = await lotesService.findConflictingRecord(source.id, mapped.lote, mapped.codigo ?? "");
      if (conflict) {
        summary.conflictCount += 1;
        continue;
      }

      const input = buildAsignacionLoteFromMappedRow(mapped, SYNC_ACTOR.email);
      const { record, created, changed } = await lotesService.upsertFromSource(source.id, SYNC_ACTOR, input);
      seenIds.add(record.id);
      if (created) summary.createdCount += 1;
      else if (changed) summary.updatedCount += 1;
      else summary.unchangedCount += 1;
    }

    // Sección 13: lo que pertenecía a esta fuente y no se vio en esta
    // pasada ya no está en la Sheet — se archiva, nunca se borra físico.
    const existing = await lotesService.listBySource(source.id);
    for (const record of existing) {
      if (!seenIds.has(record.id)) {
        await lotesService.archiveRemovedFromSource(record.id, source.name);
        summary.archivedCount += 1;
      }
    }

    summary.status = summary.invalidCount > 0 || summary.conflictCount > 0 ? "parcial" : "ok";
    summary.finishedAt = new Date().toISOString();
    await sourcesService.recordSyncOutcome(source.id, { ok: true });
  } catch (err) {
    summary.status = "error";
    summary.errorMessage = err instanceof Error ? err.message : "Error desconocido durante la sincronización.";
    summary.finishedAt = new Date().toISOString();
    await sourcesService.recordSyncOutcome(source.id, { ok: false, error: summary.errorMessage });
  }

  await recordRun(summary);
  return summary;
}

export async function syncSourceById(
  sourceId: string,
  triggeredBy: string,
  triggerKind: SyncTriggerKind
): Promise<SyncRunSummary | null> {
  const source = await getAsignacionLoteSourcesService().getForSync(sourceId);
  if (!source) return null;
  return syncSource(source, triggeredBy, triggerKind);
}

export async function syncAllEnabledSources(
  triggeredBy: string,
  triggerKind: SyncTriggerKind
): Promise<SyncRunSummary[]> {
  const sources = await getAsignacionLoteSourcesService().listEnabledForSync();
  const results: SyncRunSummary[] = [];
  for (const source of sources) {
    results.push(await syncSource(source, triggeredBy, triggerKind));
  }
  return results;
}

/** Sección 6: sync oportunista — a lo sumo cada `minIntervalMs`, no en cada request. */
export function isDueForOpportunisticSync(source: AsignacionLoteSource, minIntervalMs: number): boolean {
  if (!source.enabled) return false;
  if (!source.lastSyncAt) return true;
  return Date.now() - new Date(source.lastSyncAt).getTime() >= minIntervalMs;
}
