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
      blankCount: summary.blankCount,
      auxiliaryCount: summary.auxiliaryCount,
      duplicateCount: summary.duplicateCount,
      reconciled: summary.reconciled,
      conflictSamples: summary.conflictSamples,
      invalidSamples: summary.invalidSamples,
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
      blankCount: row.blankCount,
      auxiliaryCount: row.auxiliaryCount,
      duplicateCount: row.duplicateCount,
      reconciled: row.reconciled,
      conflictSamples: (row.conflictSamples as SyncRunSummary["conflictSamples"]) ?? [],
      invalidSamples: (row.invalidSamples as SyncRunSummary["invalidSamples"]) ?? [],
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
 * Sección 7 (reconciliación obligatoria): suma de todos los buckets en los
 * que puede caer una fila leída. Exportada como función pura (sin efectos)
 * para poder testear la ecuación en sí, además de a través de un sync
 * completo — nunca debe cerrar en falso salvo que el pipeline tenga un bug.
 */
export function reconciliationTotal(
  summary: Pick<
    SyncRunSummary,
    | "blankCount"
    | "auxiliaryCount"
    | "invalidCount"
    | "duplicateCount"
    | "conflictCount"
    | "createdCount"
    | "updatedCount"
    | "unchangedCount"
  >
): number {
  return (
    summary.blankCount +
    summary.auxiliaryCount +
    summary.invalidCount +
    summary.duplicateCount +
    summary.conflictCount +
    summary.createdCount +
    summary.updatedCount +
    summary.unchangedCount
  );
}

/**
 * Procesa las filas YA LEÍDAS de la hoja de la fuente (una fuente = una
 * hoja). Cada fila cae EXACTAMENTE en uno de estos buckets — ninguna puede
 * "desaparecer" sin pasar por alguno (sección 7, reconciliación):
 * blank | invalid | duplicado-repetido-en-la-hoja | conflicto | created/updated/unchanged.
 */
async function processTabRows(
  dataRows: string[][],
  tab: string,
  mapping: ReturnType<typeof autoMapColumns>,
  source: AsignacionLoteSource,
  lotesService: ReturnType<typeof getAsignacionLotesService>,
  seenKeysThisRun: Map<string, { signature: string; tab: string }>,
  seenIds: Set<string>,
  summary: SyncRunSummary
): Promise<void> {
  for (let i = 0; i < dataRows.length; i += 1) {
    const rowIndex = i + 2; // +1 header, +1 base-1 para que coincida con el número de fila real de la Sheet
    const mapped = rowToObject(dataRows[i]!, mapping) as Partial<AsignacionLoteMappedRow>;

    if (!mapped.lote?.trim() && !mapped.producto?.trim()) {
      summary.blankCount += 1; // fila vacía — intencional, nunca cuenta como inválida
      continue;
    }

    if (!mapped.lote?.trim()) {
      // Fila sin N° LOTE pero con algo de contenido (ej. "AGU DEL SECTOR DE
      // ELABORACION") — no es una asignación real, es una nota/fila
      // auxiliar de la planilla. Se ignora justificadamente, nunca se
      // cuenta como inválida (no es un dato mal cargado, simplemente no
      // tiene forma de asignación) — pero sí cuenta en la reconciliación.
      summary.auxiliaryCount += 1;
      continue;
    }

    const issues = validateAsignacionLoteRow(mapped, rowIndex);
    const hasBlockingError = issues.some((issue) => issue.severity === "error");
    if (hasBlockingError || !mapped.producto?.trim()) {
      // Carga flexible tolera celdas vacías salvo lote/producto — sin eso
      // no hay nada determinístico que vincular después.
      summary.invalidCount += 1;
      if (summary.invalidSamples.length < 20) {
        summary.invalidSamples.push({
          tab,
          rowIndex,
          lote: mapped.lote?.trim() ?? "",
          producto: mapped.producto?.trim() ?? "",
          motivo: issues.map((issue) => issue.message).join("; ") || "Falta producto.",
        });
      }
      continue;
    }

    const input = buildAsignacionLoteFromMappedRow(mapped, SYNC_ACTOR.email);
    const key = `${mapped.lote.trim().toLowerCase()}::${(mapped.codigo ?? "").trim().toLowerCase()}`;
    const signature = rowContentSignature(input);
    const seenBefore = seenKeysThisRun.get(key);
    if (seenBefore) {
      // Mismo lote+código repetido DENTRO de la misma hoja, en esta misma
      // corrida. Idéntico → ya está, no duplica (no se vuelve a escribir,
      // pero cuenta en la reconciliación). Distinto → conflicto real, nunca
      // se elige en silencio cuál vale: se reporta y se deja tal cual quedó
      // con la primera fila procesada.
      if (seenBefore.signature !== signature) {
        summary.conflictCount += 1;
        if (summary.conflictSamples.length < 20) {
          summary.conflictSamples.push({
            lote: input.lote,
            codigo: input.codigo,
            producto: input.producto,
            motivo: `Fila repetida con datos distintos dentro de la misma hoja "${tab}".`,
          });
        }
      } else {
        summary.duplicateCount += 1;
      }
      continue;
    }
    seenKeysThisRun.set(key, { signature, tab });

    const conflict = await lotesService.findConflictingRecord(source.id, mapped.lote, mapped.codigo ?? "");
    if (conflict) {
      summary.conflictCount += 1;
      if (summary.conflictSamples.length < 20) {
        summary.conflictSamples.push({
          lote: input.lote,
          codigo: input.codigo,
          producto: input.producto,
          motivo: `Ya existe con datos distintos en otro origen (${conflict.sourceId ? "otra fuente Google Sheets" : "manual/Excel"}).`,
        });
      }
      continue;
    }

    const { record, created, changed } = await lotesService.upsertFromSource(source.id, SYNC_ACTOR, input, tab);
    seenIds.add(record.id);
    if (created) summary.createdCount += 1;
    else if (changed) summary.updatedCount += 1;
    else summary.unchangedCount += 1;
  }
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
    blankCount: 0,
    auxiliaryCount: 0,
    duplicateCount: 0,
    reconciled: true,
    conflictSamples: [],
    invalidSamples: [],
    errorMessage: null,
    triggeredBy,
    triggerKind,
  };

  const tab = source.sheetTab?.trim();
  if (!tab) {
    // Una fuente = una hoja (decisión de producto) — nunca se descubre
    // automáticamente. Una fuente legacy sin hoja configurada no sincroniza
    // hasta que se le asigna una explícitamente (editar fuente).
    summary.status = "error";
    summary.errorMessage = "Esta fuente no tiene una hoja específica configurada — editá la fuente y asigná la hoja (tab) a sincronizar.";
    summary.finishedAt = new Date().toISOString();
    await sourcesService.recordSyncOutcome(source.id, { ok: false, error: summary.errorMessage });
    await recordRun(summary);
    return summary;
  }

  try {
    const seenIds = new Set<string>();
    // Identidad (lote,código) → firma de contenido — para detectar
    // duplicado EXACTO dentro de la misma hoja (mismo registro, no
    // duplicar) vs conflicto real (mismos datos-clave, contenido distinto
    // → nunca se elige en silencio, se reporta y no se vuelve a escribir).
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();

    const rows = await sheetsReader.readTab(source.spreadsheetId, tab);
    const header = rows[0] ?? [];
    const dataRows = rows.slice(1);
    summary.rowsRead += dataRows.length;
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    await processTabRows(dataRows, tab, mapping, source, lotesService, seenKeysThisRun, seenIds, summary);

    // Sección 13: lo que pertenecía a esta fuente y no se vio en esta
    // pasada ya no está en la Sheet — se archiva, nunca se borra físico.
    const existing = await lotesService.listBySource(source.id);
    for (const record of existing) {
      if (seenIds.has(record.id)) continue;
      await lotesService.archiveRemovedFromSource(record.id, source.name);
      summary.archivedCount += 1;
    }

    // Sección 7 (reconciliación obligatoria): toda fila leída debe caer en
    // EXACTAMENTE un bucket conocido. Si no cierra, nunca se afirma éxito.
    const reconciledTotal = reconciliationTotal(summary);
    summary.reconciled = reconciledTotal === summary.rowsRead;

    if (!summary.reconciled) {
      summary.status = "inconsistente";
      summary.errorMessage = `Se leyeron ${summary.rowsRead} filas pero solo ${reconciledTotal} pudieron ser reconciliadas. ${summary.rowsRead - reconciledTotal} fila(s) no tienen resultado conocido.`;
    } else if (summary.invalidCount > 0 || summary.conflictCount > 0) {
      summary.status = "parcial";
    } else {
      summary.status = "ok";
    }
    summary.finishedAt = new Date().toISOString();
    await sourcesService.recordSyncOutcome(source.id, { ok: summary.status !== "inconsistente", error: summary.errorMessage ?? undefined });
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
export async function previewImport(
  spreadsheetUrlOrId: string,
  sheetTab: string
): Promise<ImportPreviewResult> {
  const empty: Omit<ImportPreviewResult, "ok" | "error"> = {
    rowsFound: 0,
    nuevas: 0,
    existentes: 0,
    conflictos: 0,
    invalidas: 0,
    auxiliares: 0,
    conflictSamples: [],
  };

  const spreadsheetId = extractSpreadsheetId(spreadsheetUrlOrId);
  if (!spreadsheetId) {
    return { ok: false, ...empty, error: "No se pudo reconocer el spreadsheetId a partir de la URL." };
  }
  const tab = sheetTab?.trim();
  if (!tab) {
    return { ok: false, ...empty, error: "La hoja (tab) es obligatoria." };
  }

  try {
    const rows = await sheetsReader.readTab(spreadsheetId, tab);
    const header = rows[0] ?? [];
    const dataRows = rows.slice(1);
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    const lotesService = getAsignacionLotesService();
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();

    const result: ImportPreviewResult = { ok: true, ...empty };

    for (let i = 0; i < dataRows.length; i += 1) {
      const rowIndex = i + 2;
      const mapped = rowToObject(dataRows[i]!, mapping) as Partial<AsignacionLoteMappedRow>;
      if (!mapped.lote?.trim() && !mapped.producto?.trim()) continue;
      result.rowsFound += 1;

      if (!mapped.lote?.trim()) {
        // Fila sin N° LOTE pero con contenido — nota/fila auxiliar de la
        // planilla, no una asignación real. Nunca cuenta como inválida.
        result.auxiliares += 1;
        continue;
      }

      const issues = validateAsignacionLoteRow(mapped, rowIndex);
      const hasBlockingError = issues.some((issue) => issue.severity === "error");
      if (hasBlockingError || !mapped.producto?.trim()) {
        result.invalidas += 1;
        continue;
      }

      const input = buildAsignacionLoteFromMappedRow(mapped, "preview");
      const key = `${mapped.lote.trim().toLowerCase()}::${(mapped.codigo ?? "").trim().toLowerCase()}`;
      const signature = rowContentSignature(input);
      const seenBefore = seenKeysThisRun.get(key);
      if (seenBefore) {
        if (seenBefore.signature !== signature) {
          result.conflictos += 1;
          if (result.conflictSamples.length < 20) {
            result.conflictSamples.push({
              lote: input.lote,
              codigo: input.codigo,
              producto: input.producto,
              motivo: `Fila repetida con datos distintos dentro de la misma hoja "${tab}".`,
            });
          }
        } else {
          result.existentes += 1;
        }
        continue;
      }
      seenKeysThisRun.set(key, { signature, tab });

      const existing = await lotesService.findExistingRecordByKey(input.lote, input.codigo);
      if (!existing) {
        result.nuevas += 1;
        continue;
      }
      if (fieldsDiffer(existing, input)) {
        result.conflictos += 1;
        if (result.conflictSamples.length < 20) {
          result.conflictSamples.push({
            lote: input.lote,
            codigo: input.codigo,
            producto: input.producto,
            motivo: `Ya existe con datos distintos (ej. VTO/producto/cantidad) — origen actual: ${existing.sourceId ? "otra fuente Google Sheets" : "manual/Excel"}.`,
          });
        }
      } else {
        result.existentes += 1;
      }
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      ...empty,
      error: err instanceof Error ? err.message : "No se pudo leer la planilla.",
    };
  }
}
