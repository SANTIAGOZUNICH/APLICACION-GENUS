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
import { ensureOfficialSourcesAndRetireRedundant } from "./official-sources";
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
      ignoredTabs: summary.ignoredTabs ?? null,
      sheetsTotal: summary.sheetsTotal ?? null,
      tabBreakdown: summary.tabBreakdown ?? null,
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
      sheetsTotal: row.sheetsTotal ?? undefined,
      ignoredTabs: (row.ignoredTabs as SyncRunSummary["ignoredTabs"]) ?? undefined,
      tabBreakdown: (row.tabBreakdown as SyncRunSummary["tabBreakdown"]) ?? undefined,
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
 * Ancla mínima para reconocer una fila como "el header" al buscarlo (nunca
 * el chequeo de estructura completa — ver REQUIRED_TAB_HEADER_KEYS abajo,
 * usado solo para clasificar una hoja como válida en el descubrimiento
 * automático). Una fila título como "ASIGNACION DE LOTE SEPTIEMBRE 2026"
 * nunca resuelve ni lote ni producto, así que nunca puede confundirse con
 * el header real.
 */
const HEADER_ROW_ANCHOR_KEYS: readonly (keyof AsignacionLoteMappedRow)[] = ["lote", "producto"];

/**
 * Columnas mínimas que debe reconocer el header de una hoja para
 * considerarla una pestaña real de Asignación de Lotes en el
 * DESCUBRIMIENTO AUTOMÁTICO (pedido explícito): N° LOTE, FECHA, PRODUCTO,
 * CODIGO, MARCA, CANTIDAD, VTO. MM/FECHA ANALISIS/N° ANALISIS/OE/OA/RL/
 * OBSERVACION son opcionales — su ausencia nunca descalifica una hoja.
 * Nunca fuzzy: usa el mismo resolver tolerante de alias (`autoMapColumns` +
 * `ASIGNACION_LOTES_FIELD_ALIASES`) que ya usa el resto del pipeline.
 * NO se aplica a una fuente de hoja explícita (el usuario ya la señaló a
 * mano) ni a previewImport — ahí, como siempre, alcanza con encontrar la
 * fila de header (lote+producto) y dejar que la validación por fila
 * (`processTabRows`) maneje columnas opcionales ausentes.
 */
const REQUIRED_TAB_HEADER_KEYS: readonly (keyof AsignacionLoteMappedRow)[] = [
  "lote",
  "fecha",
  "producto",
  "codigo",
  "marca",
  "cantidades",
  "vto",
];

/**
 * Cuántas filas iniciales se revisan buscando el header real. Hotfix real
 * (Production, 2025/2026 con 21/21 hojas ignoradas — 0 filas procesadas):
 * la hoja real NO tiene el header en la fila 1 — tiene un título fusionado
 * arriba (ej. "ASIGNACION DE LOTE SEPTIEMBRE 2026", confirmado leyendo el
 * dato RAW real de la hoja) y el header recién aparece en la fila 2. Asumir
 * "header = fila 1" hacía que TODAS las columnas quedaran sin mapear en
 * TODAS las hojas — nunca un problema de normalización de alias (esa parte
 * ya funcionaba bien).
 */
const HEADER_SEARCH_MAX_ROWS = 5;

/**
 * Busca la fila de encabezados real dentro de las primeras
 * `HEADER_SEARCH_MAX_ROWS` filas — NUNCA asume que está en la fila 1
 * (pedido explícito, sección 3). Ancla LENIENTE (lote+producto, ver
 * HEADER_ROW_ANCHOR_KEYS): alcanza para distinguir un header real de una
 * fila título, sin exigir todavía la estructura completa — eso lo decide
 * cada caller según corresponda (descubrimiento automático vs. hoja ya
 * señalada a mano).
 */
function locateTabHeader(rows: string[][]): {
  headerRowIndex: number | null;
  header: string[];
  dataRows: string[][];
} {
  const limit = Math.min(rows.length, HEADER_SEARCH_MAX_ROWS);
  for (let i = 0; i < limit; i++) {
    const candidate = rows[i] ?? [];
    const mapping = autoMapColumns(candidate, ASIGNACION_LOTES_FIELD_ALIASES);
    if (HEADER_ROW_ANCHOR_KEYS.every((key) => mapping[key] != null)) {
      return { headerRowIndex: i, header: candidate, dataRows: rows.slice(i + 1) };
    }
  }
  return { headerRowIndex: null, header: rows[0] ?? [], dataRows: [] };
}

/**
 * Descubre las hojas reales de un spreadsheet completo (Google Sheets API —
 * nunca se asumen nombres de mes) y clasifica cada una como compatible
 * (header localizado + estructura mínima completa reconocida) o ignorada
 * (con motivo) — una hoja inválida o con error de lectura nunca rompe el
 * descubrimiento de las demás (sección 3 del pedido).
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
      const located = locateTabHeader(rows);
      if (located.headerRowIndex == null) {
        ignored.push({
          tab,
          reason: `No se encontró una fila de encabezados (con columnas equivalentes a lote/producto) en las primeras ${HEADER_SEARCH_MAX_ROWS} filas.`,
        });
        continue;
      }
      const mapping = autoMapColumns(located.header, ASIGNACION_LOTES_FIELD_ALIASES);
      const missing = REQUIRED_TAB_HEADER_KEYS.filter((key) => mapping[key] == null);
      if (missing.length > 0) {
        ignored.push({
          tab,
          reason: `Estructura no reconocida — faltan columnas equivalentes a: ${missing.join(", ")}.`,
        });
        continue;
      }
      compatible.push(tab);
    } catch (err) {
      ignored.push({ tab, reason: err instanceof Error ? err.message : "No se pudo leer la hoja." });
    }
  }
  return { compatible, ignored };
}

/**
 * Procesa las filas YA LEÍDAS de una hoja — comparte la misma lógica de
 * clasificación/identidad entre el sync de una hoja específica y el loop
 * multi-tab (una sola implementación, nunca dos parsers que puedan
 * divergir). Cada fila cae EXACTAMENTE en uno de estos buckets — ninguna
 * puede "desaparecer" sin pasar por alguno (sección 7, reconciliación):
 * blank | invalid | duplicado-repetido-en-esta-corrida | conflicto | created/updated/unchanged.
 */
async function processTabRows(
  dataRows: string[][],
  tab: string,
  mapping: ReturnType<typeof autoMapColumns>,
  source: AsignacionLoteSource,
  lotesService: ReturnType<typeof getAsignacionLotesService>,
  seenKeysThisRun: Map<string, { signature: string; tab: string }>,
  seenIds: Set<string>,
  summary: SyncRunSummary,
  headerRowIndex = 0
): Promise<void> {
  for (let i = 0; i < dataRows.length; i += 1) {
    // headerRowIndex (0-indexed, ver locateTabHeader) + 1 para pasar a
    // 1-indexed + 1 para la fila siguiente al header + i = número de fila
    // REAL en la Sheet — nunca asume que el header está en la fila 1.
    const rowIndex = headerRowIndex + i + 2;
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

  const explicitTab = source.sheetTab?.trim();

  try {
    const seenIds = new Set<string>();
    // Identidad (lote,código) → firma de contenido — para detectar
    // duplicado EXACTO dentro de la misma hoja (mismo registro, no
    // duplicar) vs conflicto real (mismos datos-clave, contenido distinto
    // → nunca se elige en silencio, se reporta y no se vuelve a escribir).
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();
    // Sección 9/8 del pedido: una hoja que existe en el spreadsheet pero
    // falló/quedó ignorada esta corrida NUNCA puede hacer que sus registros
    // se archiven — solo protege lo ya sincronizado antes; una hoja que se
    // borró del spreadsheet (ya no aparece ni siquiera como ignorada) sí
    // deja archivar sus registros, como siempre.
    const readableTabs = new Set<string>();
    let realTabsThisRun: Set<string> | null = null;

    if (explicitTab) {
      // Hoja específica — comportamiento single-tab preexistente, sin
      // cambios: un error acá SÍ aborta la corrida completa (siempre lo
      // hizo — no hay "otras hojas" que proteger).
      const rows = await sheetsReader.readTab(source.spreadsheetId, explicitTab);
      const located = locateTabHeader(rows);
      if (located.headerRowIndex == null) {
        throw new Error(
          `No se encontró una fila de encabezados (con columnas equivalentes a lote/producto) en las primeras ${HEADER_SEARCH_MAX_ROWS} filas de "${explicitTab}".`
        );
      }
      summary.rowsRead += located.dataRows.length;
      const mapping = autoMapColumns(located.header, ASIGNACION_LOTES_FIELD_ALIASES);
      await processTabRows(
        located.dataRows,
        explicitTab,
        mapping,
        source,
        lotesService,
        seenKeysThisRun,
        seenIds,
        summary,
        located.headerRowIndex
      );
      readableTabs.add(explicitTab);
    } else {
      // Sin hoja específica: descubrir TODAS las hojas reales del
      // spreadsheet (sección 1/2 del pedido — reemplaza "una fuente = una
      // hoja" para estas fuentes oficiales). Una hoja inválida o con error
      // de lectura NUNCA corta las demás — se aísla y se reporta en
      // `ignoredTabs`.
      const { compatible, ignored } = await discoverCompatibleTabs(source.spreadsheetId);
      realTabsThisRun = new Set([...compatible, ...ignored.map((i) => i.tab)]);
      summary.sheetsTotal = realTabsThisRun.size;
      summary.ignoredTabs = ignored;
      const tabBreakdown: NonNullable<SyncRunSummary["tabBreakdown"]> = [];

      for (const tab of compatible) {
        const before = {
          rowsRead: summary.rowsRead,
          createdCount: summary.createdCount,
          updatedCount: summary.updatedCount,
          unchangedCount: summary.unchangedCount,
          invalidCount: summary.invalidCount,
          auxiliaryCount: summary.auxiliaryCount,
          duplicateCount: summary.duplicateCount,
          conflictCount: summary.conflictCount,
        };
        try {
          const rows = await sheetsReader.readTab(source.spreadsheetId, tab);
          const located = locateTabHeader(rows);
          if (located.headerRowIndex == null) {
            // Ya se había clasificado compatible en discoverCompatibleTabs
            // (misma hoja) — un cambio entre esa lectura y esta es
            // extremadamente raro, pero nunca debe romper el resto del
            // spreadsheet: se ignora esta hoja puntual, como cualquier otra.
            summary.ignoredTabs!.push({
              tab,
              reason: `No se encontró una fila de encabezados (con columnas equivalentes a lote/producto) en las primeras ${HEADER_SEARCH_MAX_ROWS} filas.`,
            });
            continue;
          }
          const { header, dataRows } = located;
          summary.rowsRead += dataRows.length;
          const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
          await processTabRows(
            dataRows,
            tab,
            mapping,
            source,
            lotesService,
            seenKeysThisRun,
            seenIds,
            summary,
            located.headerRowIndex
          );
          readableTabs.add(tab);
          tabBreakdown.push({
            tab,
            rowsRead: summary.rowsRead - before.rowsRead,
            createdCount: summary.createdCount - before.createdCount,
            updatedCount: summary.updatedCount - before.updatedCount,
            unchangedCount: summary.unchangedCount - before.unchangedCount,
            invalidCount: summary.invalidCount - before.invalidCount,
            auxiliaryCount: summary.auxiliaryCount - before.auxiliaryCount,
            duplicateCount: summary.duplicateCount - before.duplicateCount,
            conflictCount: summary.conflictCount - before.conflictCount,
          });
        } catch (err) {
          // Una hoja individual que falla al leer (transitorio de Google,
          // permisos puntuales, etc.) nunca puede tumbar la sincronización
          // de las demás.
          summary.ignoredTabs!.push({
            tab,
            reason: err instanceof Error ? err.message : "No se pudo leer la hoja.",
          });
        }
      }
      summary.tabBreakdown = tabBreakdown;
    }

    // Sección 13: lo que pertenecía a esta fuente y no se vio en esta
    // pasada ya no está en la Sheet — se archiva, nunca se borra físico.
    // Sección 9 (guarda anti-pérdida): en modo multi-hoja, un registro
    // NUNCA se archiva si su hoja de origen sigue existiendo en el
    // spreadsheet pero no se pudo leer/clasificar esta corrida.
    const existing = await lotesService.listBySource(source.id);
    for (const record of existing) {
      if (seenIds.has(record.id)) continue;
      const recordTab = record.sourceSheetTab;
      if (realTabsThisRun && recordTab && realTabsThisRun.has(recordTab) && !readableTabs.has(recordTab)) {
        continue; // protegido — la hoja existe pero quedó ignorada/falló esta corrida
      }
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
    } else if ((summary.ignoredTabs?.length ?? 0) > 0 || summary.invalidCount > 0 || summary.conflictCount > 0) {
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

/**
 * Punto de entrada único del motor de sync (cron cada 10 min, "Sincronizar
 * ahora", sync oportunista — una sola implementación, nunca dos). Primero
 * se asegura de que las fuentes oficiales (2025/2026, ver official-sources.ts)
 * existan y de retirar con seguridad cualquier fuente vieja/redundante que
 * apunte al mismo spreadsheet con una hoja individual — server-side,
 * idempotente, sin que nadie tenga que configurar nada desde la UI.
 */
export async function syncAllEnabledSources(
  triggeredBy: string,
  triggerKind: SyncTriggerKind
): Promise<SyncRunSummary[]> {
  await ensureOfficialSourcesAndRetireRedundant(SYNC_ACTOR);
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
    const located = locateTabHeader(rows);
    if (located.headerRowIndex == null) {
      return {
        ok: false,
        ...empty,
        error: `No se encontró una fila de encabezados (con columnas equivalentes a lote/producto) en las primeras ${HEADER_SEARCH_MAX_ROWS} filas de "${tab}".`,
      };
    }
    const { header, dataRows } = located;
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    const lotesService = getAsignacionLotesService();
    const seenKeysThisRun = new Map<string, { signature: string; tab: string }>();

    const result: ImportPreviewResult = { ok: true, ...empty };

    for (let i = 0; i < dataRows.length; i += 1) {
      const rowIndex = located.headerRowIndex + i + 2;
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
