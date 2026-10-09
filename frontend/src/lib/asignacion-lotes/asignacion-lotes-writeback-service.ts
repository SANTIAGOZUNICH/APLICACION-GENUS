/**
 * Orquestador del write-back (opción C): edición por celda de filas
 * sincronizadas desde Google Sheets → escribe SOLO esa celda en la Sheet y
 * recién después la refleja en Neon. Google sigue siendo la única fuente de
 * verdad: Neon nunca guarda un valor que Google no confirmó.
 *
 * Secuencia por celda (idempotente y reanudable, ver writeback-ops.ts):
 *  1. validar (permisos/tipos/versión/duplicados) sin escribir  (patchCells dryRun)
 *  2. op `pending` con clave de idempotencia
 *  3. releer la hoja, relocalizar la fila POR IDENTIDAD (nunca por n° de fila
 *     guardado: soporta inserciones/borrados/reordenamientos) y verificar que
 *     el valor remoto sea el último que GENUS leyó (si no → conflicto, no se escribe)
 *  4. rechazar fórmulas; escribir UNA celda; releer para confirmar
 *  5. reflejar en Neon (+ auditoría) → op `confirmed`
 *  Si Google confirma y Neon falla → `google_done` (pendiente, reconciliable);
 *  si Google falla → `failed` y Neon no se toca. Éxito solo si ambos quedaron consistentes.
 */
import "server-only";

import { autoMapColumns, rowToObject } from "@/features/os/operational/lib/clipboard-import";
import {
  ASIGNACION_LOTES_FIELD_ALIASES,
  buildAsignacionLoteFromMappedRow,
} from "@/features/os/operational/lib/asignacion-lotes-import";
import { formatDateDisplay } from "@/features/os/operational/lib/delivery-date";
import { getAsignacionLoteSourcesService } from "./asignacion-lote-sources-service";
import { AsignacionCellPatchError, getAsignacionLotesService } from "./asignacion-lotes-service";
import { locateTabHeader } from "./asignacion-lotes-sync-service";
import {
  ASIGNACION_CELL_KIND,
  MAX_GOOGLE_CELL_CHANGES_PER_REQUEST,
  isAsignacionCellField,
  validateCellValue,
  type AsignacionCellChange,
  type AsignacionCellFailure,
  type AsignacionCellField,
} from "./cell-edit";
import {
  createOp,
  findOpByKey,
  findOtherOpenOp,
  idempotencyKeyFor,
  isWritebackEnabledFor,
  listOpenOps,
  updateOp,
  WritebackBusyError,
  type WritebackOp,
} from "./writeback-ops";
import { GoogleSheetCellGateway, type SheetCellGateway } from "./writeback-gateway";
import type { AsignacionLote, AsignacionLotesActor } from "./types";
import { OrdersValidationError } from "@/lib/orders/types";

let gatewayOverride: SheetCellGateway | null = null;
/** Solo tests: inyecta una Sheet en memoria. */
export function setWritebackGatewayForTests(gateway: SheetCellGateway | null): void {
  gatewayOverride = gateway;
}
function gateway(): SheetCellGateway {
  return gatewayOverride ?? new GoogleSheetCellGateway();
}

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const norm = (v: string) => v.trim().toLowerCase();
const identityKey = (lote: string, codigo: string, producto: string) => `${norm(lote)}::${norm(codigo)}::${norm(producto)}`;

/** Valor normalizado (texto comparable) de lo que hay en una celda de la Sheet. */
function comparable(field: AsignacionCellField, text: string): string {
  const trimmed = text.trim();
  if (ASIGNACION_CELL_KIND[field] === "number" && !trimmed) return "0";
  const v = validateCellValue(field, trimmed);
  if (!v.ok) return `raw:${trimmed}`;
  return v.value === null ? "" : String(v.value);
}
function storedComparable(record: AsignacionLote, field: AsignacionCellField): string {
  const v = record[field];
  return v === null || v === undefined ? "" : String(v);
}

/** Cómo se escribe el valor en la Sheet (locale es-AR, USER_ENTERED). */
export function sheetTextFor(field: AsignacionCellField, normalized: string | number | null): string {
  if (normalized === null) return "";
  const kind = ASIGNACION_CELL_KIND[field];
  if (kind === "date") return formatDateDisplay(String(normalized));
  if (kind === "number") return String(normalized).replace(".", ",");
  return String(normalized);
}

type Located =
  | { ok: true; rowNumber: number; colIndex: number; a1: string; remoteText: string }
  | { ok: false; code: "NOT_FOUND" | "AMBIGUOUS" | "NO_COLUMN"; message: string };

async function locateCell(
  gw: SheetCellGateway,
  spreadsheetId: string,
  tab: string,
  record: AsignacionLote,
  field: AsignacionCellField
): Promise<Located> {
  const rows = await gw.readTab(spreadsheetId, tab);
  const located = locateTabHeader(rows);
  if (located.headerRowIndex == null) {
    return { ok: false, code: "NOT_FOUND", message: `No se encontró la fila de encabezados en "${tab}".` };
  }
  const mapping = autoMapColumns(located.header, ASIGNACION_LOTES_FIELD_ALIASES);
  const colIndex = mapping[field];
  if (colIndex === null || colIndex === undefined) {
    return { ok: false, code: "NO_COLUMN", message: `La hoja "${tab}" no tiene una columna para ${field}.` };
  }
  const wanted = identityKey(record.lote, record.codigo, record.producto);
  const hits: number[] = [];
  located.dataRows.forEach((row, i) => {
    const mapped = rowToObject(row, mapping);
    if (!mapped.lote?.trim()) return;
    const input = buildAsignacionLoteFromMappedRow(mapped as never, "writeback");
    if (identityKey(mapped.lote, mapped.codigo ?? "", input.producto) === wanted) hits.push(i);
  });
  if (hits.length === 0) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "La fila ya no está en la Sheet (se movió, cambió su identidad o fue eliminada). Esperá la próxima sincronización.",
    };
  }
  if (hits.length > 1) {
    return { ok: false, code: "AMBIGUOUS", message: "Hay más de una fila con el mismo lote/código/producto en la Sheet: no se puede elegir cuál escribir." };
  }
  const rowNumber = located.headerRowIndex + hits[0]! + 2;
  return {
    ok: true,
    rowNumber,
    colIndex,
    a1: `${columnLetter(colIndex)}${rowNumber}`,
    remoteText: rows[rowNumber - 1]?.[colIndex] ?? "",
  };
}

export type CellResult =
  | { index: number; status: "confirmed" }
  | { index: number; status: "failed" | "pending"; code: AsignacionCellFailure["code"]; message: string };

interface Ctx {
  actor: AsignacionLotesActor;
  record: AsignacionLote;
  spreadsheetId: string;
  tab: string;
  field: AsignacionCellField;
  rawValue: string;
  normalized: string | number | null;
}

async function applyToNeon(ctx: Pick<Ctx, "actor" | "record" | "field" | "rawValue">): Promise<void> {
  const svc = getAsignacionLotesService();
  const latest = await svc.get(ctx.actor, ctx.record.id);
  if (!latest) throw new Error("El registro ya no existe en GENUS.");
  await svc.patchCells(
    ctx.actor,
    [{ id: ctx.record.id, field: ctx.field, value: ctx.rawValue, expectedVersion: latest.updatedAt }],
    { bypassSourceProtection: new Set([ctx.record.id]) }
  );
}

/** Ejecuta/reanuda una operación. Nunca lanza: devuelve el estado final de la celda. */
async function runOp(op: WritebackOp, ctx: Ctx, index: number): Promise<CellResult> {
  const gw = gateway();
  // Reabre (pending) para que el índice único parcial vuelva a reservar la celda durante el reintento.
  await updateOp(op.id, { attempts: op.attempts + 1, lastError: null, ...(op.status === "google_done" ? {} : { status: "pending" as const }) });
  try {
    if (op.status !== "google_done") {
      const loc = await locateCell(gw, ctx.spreadsheetId, ctx.tab, ctx.record, ctx.field);
      if (!loc.ok) {
        await updateOp(op.id, { status: "failed", lastError: loc.message });
        return { index, status: "failed", code: "GOOGLE_ERROR", message: loc.message };
      }
      const newCmp = comparable(ctx.field, sheetTextFor(ctx.field, ctx.normalized));
      const remoteCmp = comparable(ctx.field, loc.remoteText);
      const alreadyWritten = remoteCmp === newCmp && remoteCmp !== storedComparable(ctx.record, ctx.field);
      if (!alreadyWritten) {
        // Último valor que GENUS leyó == lo que hay hoy en Google, si no alguien lo cambió en la Sheet.
        if (remoteCmp !== storedComparable(ctx.record, ctx.field)) {
          const message = "El valor en Google Sheets cambió desde la última sincronización. No se escribió nada: esperá la sincronización y reintentá.";
          await updateOp(op.id, { status: "conflict", a1: loc.a1, lastError: message });
          return { index, status: "failed", code: "GOOGLE_CONFLICT", message };
        }
        const formula = await gw.readFormula(ctx.spreadsheetId, ctx.tab, loc.a1);
        if (formula) {
          const message = `La celda ${loc.a1} es una fórmula en la Sheet: no se sobrescribe.`;
          await updateOp(op.id, { status: "failed", a1: loc.a1, lastError: message });
          return { index, status: "failed", code: "GOOGLE_ERROR", message };
        }
        await gw.writeCell(ctx.spreadsheetId, ctx.tab, loc.a1, sheetTextFor(ctx.field, ctx.normalized));
      }
      const back = await gw.readCell(ctx.spreadsheetId, ctx.tab, loc.a1);
      if (comparable(ctx.field, back) !== newCmp) {
        const message = "Google no confirmó el valor escrito. Se reintentará/reconciliará; no se guardó en GENUS.";
        await updateOp(op.id, { status: "pending", a1: loc.a1, lastError: message });
        return { index, status: "pending", code: "GOOGLE_PENDING", message };
      }
      await updateOp(op.id, { status: "google_done", a1: loc.a1 });
    }
    try {
      await applyToNeon(ctx);
    } catch (err) {
      const message = `Guardado en Google, pero GENUS no pudo reflejarlo (${err instanceof Error ? err.message : "error"}). Queda pendiente y se reconcilia automáticamente.`;
      await updateOp(op.id, { status: "google_done", lastError: message });
      return { index, status: "pending", code: "GOOGLE_PENDING", message };
    }
    await updateOp(op.id, { status: "confirmed", lastError: null });
    return { index, status: "confirmed" };
  } catch (err) {
    // Google rechazó/falló: Neon NO se toca y no se informa éxito.
    const message = `Google Sheets rechazó o no respondió: ${err instanceof Error ? err.message : "error"}. No se guardó.`;
    await updateOp(op.id, { status: "failed", lastError: message });
    return { index, status: "failed", code: "GOOGLE_ERROR", message };
  }
}

export interface MixedPatchResult {
  items: AsignacionLote[];
  results: CellResult[];
  /** true solo si TODAS las celdas quedaron consistentes en Google y Neon. */
  ok: boolean;
}

/** Entrada única del PATCH por celdas: filas manuales (atómico en Neon) + filas de Google (write-back). */
export async function patchCellsWithWriteback(
  actor: AsignacionLotesActor,
  changes: AsignacionCellChange[]
): Promise<MixedPatchResult> {
  const svc = getAsignacionLotesService();
  const records = new Map<string, AsignacionLote>();
  for (const id of new Set(changes.map((c) => String(c?.id ?? "")))) {
    const rec = await svc.get(actor, id);
    if (rec) records.set(id, rec);
  }
  const sources = getAsignacionLoteSourcesService();
  const writableCache = new Map<string, { spreadsheetId: string; tab: string | null } | null>();
  // 0043: solo van a Google las filas de una fuente con escritura de vuelta HABILITADA (opción C). Las demás filas
  // sincronizadas se editan en GENUS y quedan registradas como «editado en GENUS» (el sync no las pisa).
  for (const rec of records.values()) {
    if (!rec.sourceId || writableCache.has(rec.sourceId)) continue;
    const src = await sources.getForSync(rec.sourceId);
    writableCache.set(rec.sourceId, src && isWritebackEnabledFor(src.spreadsheetId) ? { spreadsheetId: src.spreadsheetId, tab: src.sheetTab } : null);
  }
  const isGoogle = (c: AsignacionCellChange) => {
    const sourceId = records.get(c.id)?.sourceId;
    return Boolean(sourceId && writableCache.get(sourceId));
  };

  const manual = changes.map((c, i) => ({ c, i })).filter(({ c }) => !isGoogle(c));
  const google = changes.map((c, i) => ({ c, i })).filter(({ c }) => isGoogle(c));
  if (google.length > MAX_GOOGLE_CELL_CHANGES_PER_REQUEST) {
    throw new OrdersValidationError(`Máximo ${MAX_GOOGLE_CELL_CHANGES_PER_REQUEST} celdas de filas de Google por operación.`);
  }

  const results: CellResult[] = new Array(changes.length);
  const items = new Map<string, AsignacionLote>();

  if (manual.length > 0) {
    try {
      const res = await svc.patchCells(actor, manual.map(({ c }) => c));
      res.items.forEach((it) => items.set(it.id, it));
      manual.forEach(({ i }) => (results[i] = { index: i, status: "confirmed" }));
    } catch (err) {
      if (!(err instanceof AsignacionCellPatchError)) throw err;
      manual.forEach(({ i }, k) => {
        const f = err.failures.find((x) => x.index === k);
        results[i] = {
          index: i,
          status: "failed",
          code: f?.code ?? "INVALID_VALUE",
          message: f?.message ?? "No se guardó: otra celda del mismo pegado fue rechazada.",
        };
      });
    }
  }

  const ownVersion = new Map<string, string>(); // id → versión tras nuestras propias escrituras
  const originalVersion = new Map<string, string>();
  for (const { c, i } of google) {
    const fail = (code: AsignacionCellFailure["code"], message: string) => {
      results[i] = { index: i, status: "failed", code, message };
    };
    const record = records.get(c.id);
    if (!record || !isAsignacionCellField(c.field)) {
      fail("INVALID_FIELD", "Celda inválida.");
      continue;
    }
    const sourceId = record.sourceId!;
    if (!writableCache.has(sourceId)) {
      const src = await sources.getForSync(sourceId);
      writableCache.set(
        sourceId,
        src && isWritebackEnabledFor(src.spreadsheetId) ? { spreadsheetId: src.spreadsheetId, tab: src.sheetTab } : null
      );
    }
    const target = writableCache.get(sourceId);
    if (!target) {
      fail("PROTECTED_SOURCE", "La escritura a esta Google Sheet no está habilitada. Corregilo en la Sheet.");
      continue;
    }
    const tab = record.sourceSheetTab ?? target.tab;
    if (!tab) {
      fail("GOOGLE_ERROR", "No se conoce la pestaña de origen de este registro.");
      continue;
    }

    // Versión: dentro de un mismo pegado, ediciones de la misma fila encadenan sobre nuestra propia versión.
    if (!originalVersion.has(c.id)) originalVersion.set(c.id, c.expectedVersion);
    const expectedVersion =
      ownVersion.has(c.id) && c.expectedVersion === originalVersion.get(c.id) ? ownVersion.get(c.id)! : c.expectedVersion;

    const key = idempotencyKeyFor({ recordId: c.id, field: c.field, newValue: c.value.trim(), expectedVersion: originalVersion.get(c.id)! });
    const existing = await findOpByKey(key);
    if (existing?.status === "confirmed") {
      results[i] = { index: i, status: "confirmed" }; // reintento de algo ya guardado: idempotente
      continue;
    }

    const current = (await svc.get(actor, c.id)) ?? record;
    try {
      await svc.patchCells(actor, [{ ...c, expectedVersion }], {
        bypassSourceProtection: new Set([c.id]),
        dryRun: true,
      });
    } catch (err) {
      if (err instanceof AsignacionCellPatchError) fail(err.failures[0]!.code, err.failures[0]!.message);
      else throw err;
      continue;
    }
    const validation = validateCellValue(c.field, c.value);
    if (!validation.ok) {
      fail("INVALID_VALUE", validation.message);
      continue;
    }

    if (existing) {
      // Reintento de una operación fallida/en conflicto: hay que volver a reservar la celda.
      if (await findOtherOpenOp(c.id, c.field, key)) {
        fail("GOOGLE_CONFLICT", new WritebackBusyError().message);
        continue;
      }
    }
    let op: WritebackOp;
    try {
      op =
      existing ??
      (await createOp({
        idempotencyKey: key,
        recordId: c.id,
        lote: current.lote,
        field: c.field,
        spreadsheetId: target.spreadsheetId,
        sheetTab: tab,
        a1: null,
        oldValue: storedComparable(current, c.field),
        newValue: String(validation.value ?? ""),
        actorEmail: actor.email,
        actorSector: actor.sector,
        actorName: actor.displayName,
      }));
    } catch (err) {
      if (err instanceof WritebackBusyError) {
        fail("GOOGLE_CONFLICT", err.message);
        continue;
      }
      throw err;
    }
    results[i] = await runOp(
      op,
      { actor, record: current, spreadsheetId: target.spreadsheetId, tab, field: c.field, rawValue: c.value, normalized: validation.value },
      i
    );
    const after = await svc.get(actor, c.id);
    if (after) {
      ownVersion.set(c.id, after.updatedAt);
      items.set(after.id, after);
    }
  }

  return { items: [...items.values()], results, ok: results.every((r) => r?.status === "confirmed") };
}

/**
 * Reconciliación Google ↔ Neon (la llama el cron antes de sincronizar y puede
 * invocarse a mano): completa en Neon lo que Google ya confirmó y resuelve
 * operaciones colgadas.
 */
export async function reconcileWritebacks(
  options: { pendingGraceMs?: number } = {}
): Promise<{ confirmed: number; failed: number; stillPending: number }> {
  const grace = options.pendingGraceMs ?? 60_000;
  const out = { confirmed: 0, failed: 0, stillPending: 0 };
  const svc = getAsignacionLotesService();
  for (const op of await listOpenOps()) {
    const actor: AsignacionLotesActor = {
      email: op.actorEmail,
      sector: op.actorSector as AsignacionLotesActor["sector"],
      displayName: op.actorName,
    };
    const record = await svc.get(actor, op.recordId);
    const field = op.field as AsignacionCellField;
    if (!record || !isAsignacionCellField(field)) {
      await updateOp(op.id, { status: "failed", lastError: "El registro ya no existe." });
      out.failed += 1;
      continue;
    }
    const raw = op.newValue ?? "";
    try {
      if (op.status === "google_done") {
        // Si el sync ya trajo el valor desde Google, Neon ya lo tiene: nada que aplicar.
        if (comparable(field, storedComparable(record, field)) !== comparable(field, raw)) {
          await applyToNeon({ actor, record, field, rawValue: raw });
        }
        await updateOp(op.id, { status: "confirmed", lastError: null });
        out.confirmed += 1;
        continue;
      }
      if (Date.now() - new Date(op.updatedAt).getTime() < grace) {
        out.stillPending += 1;
        continue;
      }
      const loc = await locateCell(gateway(), op.spreadsheetId, op.sheetTab, record, field);
      if (loc.ok && comparable(field, loc.remoteText) === comparable(field, raw)) {
        if (comparable(field, storedComparable(record, field)) !== comparable(field, raw)) {
          await applyToNeon({ actor, record, field, rawValue: raw });
        }
        await updateOp(op.id, { status: "confirmed", a1: loc.a1, lastError: null });
        out.confirmed += 1;
      } else {
        await updateOp(op.id, { status: "failed", lastError: "La escritura nunca llegó a Google: no se aplicó en GENUS." });
        out.failed += 1;
      }
    } catch (err) {
      await updateOp(op.id, { lastError: err instanceof Error ? err.message : "error de reconciliación" });
      out.stillPending += 1;
    }
  }
  return out;
}
