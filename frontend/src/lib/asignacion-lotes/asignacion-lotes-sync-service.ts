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
import { fieldsDiffer, getAsignacionLotesService } from "./asignacion-lotes-service";
import { extractSpreadsheetId } from "./spreadsheet-url";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLoteSyncRuns } from "@/lib/db/schema";
import type {
  AsignacionLoteSource,
  ImportPreviewResult,
  ImportPreviewSheetBreakdown,
  SyncRunSummary,
  SyncTriggerKind,
} from "./source-types";

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
/** Firma de contenido de una fila mapeada — para detectar duplicado exacto entre hojas vs conflicto real. */
function rowContentSignature(input: ReturnType<typeof buildAsignacionLoteFromMappedRow>): string {
  return JSON.stringify({
    fecha: input.fecha,
    producto: input.producto,
    marca: input.marca,
    cantidades: input.cantidades,
    vto: input.vto,
    muestras: input.muestras,
    cjMuestra: input.cjMuestra,
    fechaAnalisis: input.fechaAnalisis,
    observaciones: input.observaciones,
  });
}

/**
 * Descubre las hojas reales del spreadsheet (Google Sheets API — nunca se
 * asumen nombres de mes) y clasifica cada una como compatible (mapea al
 * menos lote+producto) o ignorada (con motivo) — una hoja inválida nunca
 * rompe la importación de las demás.
 */
async function discoverCompatibleTabs(
  spreadsheetId: string
): Promise<{ compatible: string[]; ignored: Array<{ tab: string; reason: string }> }> {
  const allTabs = await sheetsReader.listTabs(spreadsheetId);
  const compatible: string[] = [];
  const ignored: Array<{ tab: string; reason: string }> = [];
  for (const tab of allTabs) {
    try {
      const rows = await sheetsReader.readTab(spreadsheetId, tab);
      const header = rows[0] ?? [];
      const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
      if (mapping.lote != null && mapping.producto != null) {
        compatible.push(tab);
      } else {
        ignored.push({ tab, reason: "no se reconocieron las columnas mínimas (lote/producto)." });
      }
    } catch (err) {
      ignored.push({ tab, reason: err instanceof Error ? err.message : "no se pudo leer la hoja." });
    }
  }
  return { compatible, ignored };
}

/** Lista de hojas a sincronizar — respeta compatibilidad (sección 12): sheetTab fijo = solo esa hoja, igual que antes de 0033. */
async function resolveTabsToSync(
  source: AsignacionLoteSource
): Promise<{ tabs: string[]; ignored: Array<{ tab: string; reason: string }> }> {
  if (source.sheetTab?.trim()) return { tabs: [source.sheetTab.trim()], ignored: [] };
  const { compatible, ignored } = await discoverCompatibleTabs(source.spreadsheetId);
  return { tabs: compatible, ignored };
}

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
    const { tabs } = await resolveTabsToSync(source);
    const seenIds = new Set<string>();
    // Identidad (lote,código) → firma de contenido + hoja de origen — para
    // detectar duplicado EXACTO entre hojas (mismo registro, no duplicar)
    // vs conflicto real entre hojas (mismos datos-clave, contenido distinto
    // → nunca se elige en silencio, se reporta y no se vuelve a escribir).
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();

    for (const tab of tabs) {
      const rows = await sheetsReader.readTab(source.spreadsheetId, tab);
      const header = rows[0] ?? [];
      const dataRows = rows.slice(1);
      summary.rowsRead += dataRows.length;

      const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);

      for (let i = 0; i < dataRows.length; i += 1) {
        const rowIndex = i + 2; // +1 header, +1 base-1 para que coincida con el número de fila real de la Sheet
        const mapped = rowToObject(dataRows[i]!, mapping) as Partial<AsignacionLoteMappedRow>;
        if (!mapped.lote?.trim() && !mapped.producto?.trim()) continue; // fila vacía — no cuenta como inválida

        const issues = validateAsignacionLoteRow(mapped, rowIndex);
        const hasBlockingError = issues.some((issue) => issue.severity === "error");
        if (hasBlockingError || !mapped.lote?.trim() || !mapped.producto?.trim()) {
          // Carga flexible tolera celdas vacías salvo lote/producto — sin
          // eso no hay nada determinístico que vincular después.
          summary.invalidCount += 1;
          continue;
        }

        const input = buildAsignacionLoteFromMappedRow(mapped, SYNC_ACTOR.email);
        const key = `${mapped.lote.trim().toLowerCase()}::${(mapped.codigo ?? "").trim().toLowerCase()}`;
        const signature = rowContentSignature(input);
        const seenBefore = seenKeysThisRun.get(key);
        if (seenBefore) {
          // Sección 10: mismo lote+código visto en OTRA hoja de esta misma
          // fuente, en esta misma corrida. Idéntico → ya está, no duplica
          // (no se vuelve a escribir). Distinto → conflicto ENTRE hojas,
          // nunca se elige en silencio cuál vale: se reporta y se deja tal
          // cual quedó con la primera hoja procesada.
          if (seenBefore.signature !== signature) summary.conflictCount += 1;
          continue;
        }
        seenKeysThisRun.set(key, { signature, tab });

        const conflict = await lotesService.findConflictingRecord(source.id, mapped.lote, mapped.codigo ?? "");
        if (conflict) {
          summary.conflictCount += 1;
          continue;
        }

        const { record, created, changed } = await lotesService.upsertFromSource(
          source.id,
          SYNC_ACTOR,
          input,
          tab
        );
        seenIds.add(record.id);
        if (created) summary.createdCount += 1;
        else if (changed) summary.updatedCount += 1;
        else summary.unchangedCount += 1;
      }
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

/**
 * Vista previa de importación — "importación inicial de 2025" del pedido:
 * antes de conectar definitivamente una fuente (o antes de una fuente que
 * puede traer muchos registros históricos), mostrar cuántas filas son
 * nuevas, cuántas ya existen igual (manual/Excel/otra fuente), cuántas
 * tienen datos en conflicto y cuántas son inválidas — SIN persistir nada.
 * No asume que, por venir de una fuente nueva, todos los registros son
 * nuevos: compara cada fila contra TODA Asignación de Lotes existente por
 * lote+código (misma identidad que usa el sync real).
 */
async function previewOneTab(
  spreadsheetId: string,
  tab: string,
  lotesService: ReturnType<typeof getAsignacionLotesService>,
  seenKeysThisRun: Map<string, { signature: string; tab: string }>,
  conflictSamples: ImportPreviewResult["conflictSamples"]
): Promise<Omit<ImportPreviewSheetBreakdown, "compatible" | "ignoredReason">> {
  const rows = await sheetsReader.readTab(spreadsheetId, tab);
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);

  const counts = { tab, rowsFound: 0, nuevas: 0, existentes: 0, conflictos: 0, invalidas: 0 };

  for (let i = 0; i < dataRows.length; i += 1) {
    const rowIndex = i + 2;
    const mapped = rowToObject(dataRows[i]!, mapping) as Partial<AsignacionLoteMappedRow>;
    if (!mapped.lote?.trim() && !mapped.producto?.trim()) continue;
    counts.rowsFound += 1;

    const issues = validateAsignacionLoteRow(mapped, rowIndex);
    const hasBlockingError = issues.some((issue) => issue.severity === "error");
    if (hasBlockingError || !mapped.lote?.trim() || !mapped.producto?.trim()) {
      counts.invalidas += 1;
      continue;
    }

    const input = buildAsignacionLoteFromMappedRow(mapped, "preview");
    const key = `${mapped.lote.trim().toLowerCase()}::${(mapped.codigo ?? "").trim().toLowerCase()}`;
    const signature = rowContentSignature(input);
    const seenBefore = seenKeysThisRun.get(key);
    if (seenBefore) {
      if (seenBefore.signature !== signature) {
        counts.conflictos += 1;
        if (conflictSamples.length < 20) {
          conflictSamples.push({
            lote: input.lote,
            codigo: input.codigo,
            producto: input.producto,
            motivo: `Conflicto entre hojas — datos distintos en "${seenBefore.tab}" y "${tab}".`,
            tabs: [seenBefore.tab, tab],
          });
        }
      } else {
        counts.existentes += 1;
      }
      continue;
    }
    seenKeysThisRun.set(key, { signature, tab });

    const existing = await lotesService.findExistingRecordByKey(input.lote, input.codigo);
    if (!existing) {
      counts.nuevas += 1;
      continue;
    }
    if (fieldsDiffer(existing, input)) {
      counts.conflictos += 1;
      if (conflictSamples.length < 20) {
        conflictSamples.push({
          lote: input.lote,
          codigo: input.codigo,
          producto: input.producto,
          motivo: `Ya existe con datos distintos (ej. VTO/producto/cantidad) — origen actual: ${existing.sourceId ? "otra fuente Google Sheets" : "manual/Excel"}.`,
        });
      }
    } else {
      counts.existentes += 1;
    }
  }

  return counts;
}

export async function previewImport(
  spreadsheetUrlOrId: string,
  sheetTab?: string | null
): Promise<ImportPreviewResult> {
  const empty: Omit<ImportPreviewResult, "ok" | "error"> = {
    rowsFound: 0,
    nuevas: 0,
    existentes: 0,
    conflictos: 0,
    invalidas: 0,
    conflictSamples: [],
  };

  const spreadsheetId = extractSpreadsheetId(spreadsheetUrlOrId);
  if (!spreadsheetId) {
    return { ok: false, ...empty, error: "No se pudo reconocer el spreadsheetId a partir de la URL." };
  }

  try {
    const lotesService = getAsignacionLotesService();
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();
    const conflictSamples: ImportPreviewResult["conflictSamples"] = [];

    const tab = sheetTab?.trim();
    if (tab) {
      // Hoja específica — comportamiento single-tab preexistente, sin cambios.
      const counts = await previewOneTab(spreadsheetId, tab, lotesService, seenKeysThisRun, conflictSamples);
      const result: ImportPreviewResult = { ok: true, ...empty };
      result.rowsFound = counts.rowsFound;
      result.nuevas = counts.nuevas;
      result.existentes = counts.existentes;
      result.conflictos = counts.conflictos;
      result.invalidas = counts.invalidas;
      result.conflictSamples = conflictSamples;
      return result;
    }

    // Sin hoja específica: descubrir TODAS las hojas reales (Google Sheets
    // API — nunca se asumen nombres) y previsualizar cada una compatible.
    const { compatible, ignored } = await discoverCompatibleTabs(spreadsheetId);
    const result: ImportPreviewResult = { ok: true, ...empty };
    const sheets: ImportPreviewSheetBreakdown[] = [];

    for (const compatibleTab of compatible) {
      const counts = await previewOneTab(spreadsheetId, compatibleTab, lotesService, seenKeysThisRun, conflictSamples);
      sheets.push({ ...counts, compatible: true });
      result.rowsFound += counts.rowsFound;
      result.nuevas += counts.nuevas;
      result.existentes += counts.existentes;
      result.conflictos += counts.conflictos;
      result.invalidas += counts.invalidas;
    }
    for (const { tab: ignoredTab, reason } of ignored) {
      sheets.push({
        tab: ignoredTab,
        compatible: false,
        ignoredReason: reason,
        rowsFound: 0,
        nuevas: 0,
        existentes: 0,
        conflictos: 0,
        invalidas: 0,
      });
    }
    result.sheets = sheets;
    result.conflictSamples = conflictSamples;
    return result;
  } catch (err) {
    return {
      ok: false,
      ...empty,
      error: err instanceof Error ? err.message : "No se pudo leer la planilla.",
    };
  }
}
