/**
 * Producción → Semanas: lectura y edición POR CELDA de SEMANAS 2026.
 *
 * - La Sheet es la ÚNICA fuente de verdad: GENUS la lee en vivo y escribe una
 *   celda por vez; no hay copia editable en Neon (el sync existente seguirá
 *   leyéndola hacia work-items). Neon solo guarda la bitácora de ediciones.
 * - Cada escritura: relee, verifica que el valor remoto sea el que el usuario
 *   vio (si no → conflicto, nada se escribe), rechaza celdas combinadas no
 *   ancladas / fórmulas / encabezados / períodos cerrados, escribe UNA celda,
 *   relee para confirmar y recién ahí informa éxito.
 * - Lectura permitida a quien vea Producción; escritura solo Producción y solo
 *   en spreadsheets de la allowlist (SEMANAS_WRITEBACK_SPREADSHEET_IDS) con
 *   SEMANAS_WRITEBACK=1. Por defecto NADA se escribe en la planilla productiva.
 */
import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { parseFlexibleDate, formatDateDisplay } from "@/features/os/operational/lib/delivery-date";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { sheetCellEdits } from "@/lib/db/schema";
import { GoogleSheetCellGateway, type SheetGridGateway } from "@/lib/asignacion-lotes/writeback-gateway";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { findCalendarCell, parseA1, parseWeeklyCalendar, type CalendarWeek } from "./calendar-model";
import { findFlatCell, parseFlatTable, type FlatTable } from "./flat-model";

import { SEMANAS_TABS, isSemanasTabKey, type SemanasTabKey } from "./semanas-tabs";
export { SEMANAS_TABS, isSemanasTabKey, type SemanasTabKey };

export function canEditSemanas(sector: SectorId | null | undefined): boolean {
  return sector === "PRODUCCION";
}

let gatewayOverride: SheetGridGateway | null = null;
export function setSemanasGatewayForTests(g: SheetGridGateway | null): void {
  gatewayOverride = g;
}
let fixture: SheetGridGateway | null = null;

async function gateway(): Promise<SheetGridGateway> {
  if (gatewayOverride) return gatewayOverride;
  const file = process.env.GENUS_SEMANAS_FIXTURE_XLSX?.trim();
  if (file && process.env.NODE_ENV !== "production") {
    if (!fixture) {
      const { XlsxFixtureGateway } = await import("./xlsx-grid");
      fixture = new XlsxFixtureGateway(file);
    }
    return fixture;
  }
  return new GoogleSheetCellGateway();
}

async function spreadsheetId(): Promise<string> {
  const override = process.env.SEMANAS_SHEET_ID?.trim();
  if (override) return override;
  if (process.env.GENUS_SEMANAS_FIXTURE_XLSX?.trim() && process.env.NODE_ENV !== "production") return "fixture-semanas-2026";
  const { operationsDocumentRepository } = await import("@/lib/adapters/drive/operations-document-repository");
  const ref = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");
  if (!ref) throw new OrdersValidationError("SEMANAS 2026 no está indexada ni configurada (SEMANAS_SHEET_ID).");
  return ref.fileId;
}

export function isSemanasWritable(sheetId: string): boolean {
  const allow = (process.env.SEMANAS_WRITEBACK_SPREADSHEET_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return process.env.SEMANAS_WRITEBACK === "1" && allow.includes(sheetId);
}

/** SEMANAS_TODAY_OVERRIDE existe solo para probar con la copia local del libro (nunca en producción). */
const todayIso = () =>
  (process.env.NODE_ENV !== "production" && process.env.SEMANAS_TODAY_OVERRIDE?.trim()) || new Date().toISOString().slice(0, 10);
const YEAR = () => Number(process.env.SEMANAS_YEAR ?? 2026);

export interface SemanasViewPayload {
  spreadsheetId: string;
  tabKey: SemanasTabKey;
  tab: string;
  label: string;
  kind: "CALENDAR" | "FLAT";
  /** La Sheet permite escribir desde GENUS (flag + allowlist). El permiso por usuario se evalúa aparte. */
  writable: boolean;
  weeks?: CalendarWeek[];
  table?: FlatTable;
  /** Valor de lectura "como lo vio el usuario": base del chequeo de conflicto. */
  readAt: string;
  today: string;
}

export async function loadSemanasView(tabKey: SemanasTabKey, today = todayIso()): Promise<SemanasViewPayload> {
  const def = SEMANAS_TABS[tabKey];
  const gw = await gateway();
  const id = await spreadsheetId();
  const [rows, merges, formulaCells] = await Promise.all([
    gw.readTab(id, def.tab),
    gw.readMerges(id, def.tab),
    gw.readFormulaCells(id, def.tab),
  ]);
  const base = { spreadsheetId: id, tabKey, tab: def.tab, label: def.label, kind: def.kind, writable: isSemanasWritable(id), readAt: new Date().toISOString(), today };
  if (def.kind === "CALENDAR") {
    return { ...base, weeks: parseWeeklyCalendar(rows, merges, { year: YEAR(), formulaCells, today }) };
  }
  return { ...base, table: parseFlatTable(tabKey === "ENTREGAS" ? "ENTREGAS" : "CDIA", rows, merges, { formulaCells, today }) };
}

// ---------- bitácora ----------
interface EditOp {
  id: string; idempotencyKey: string; spreadsheetId: string; sheetTab: string; a1: string;
  oldValue: string | null; newValue: string | null; status: string; lastError: string | null;
  actorEmail: string; actorSector: string; actorName: string; createdAt: string; confirmedAt: string | null;
}
const g = globalThis as unknown as { __genusSheetCellEdits?: EditOp[] };
export function getSheetCellEditsMemory(): EditOp[] {
  if (!g.__genusSheetCellEdits) g.__genusSheetCellEdits = [];
  return g.__genusSheetCellEdits;
}

async function findEdit(key: string): Promise<EditOp | null> {
  if (isDatabaseConfigured()) {
    const [row] = await getDb().select().from(sheetCellEdits).where(eq(sheetCellEdits.idempotencyKey, key));
    return row ? { ...row, createdAt: row.createdAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null } : null;
  }
  return getSheetCellEditsMemory().find((o) => o.idempotencyKey === key) ?? null;
}
async function saveEdit(op: EditOp): Promise<void> {
  if (isDatabaseConfigured()) {
    await getDb()
      .insert(sheetCellEdits)
      .values({ ...op, createdAt: new Date(op.createdAt), confirmedAt: op.confirmedAt ? new Date(op.confirmedAt) : null })
      .onConflictDoUpdate({
        target: sheetCellEdits.idempotencyKey,
        set: { status: op.status, lastError: op.lastError, confirmedAt: op.confirmedAt ? new Date(op.confirmedAt) : null },
      });
    return;
  }
  const list = getSheetCellEditsMemory();
  const i = list.findIndex((o) => o.idempotencyKey === op.idempotencyKey);
  if (i >= 0) list[i] = op;
  else list.push(op);
}

// ---------- escritura ----------
export interface SemanasCellEdit {
  tabKey: SemanasTabKey;
  a1: string;
  /** Lo que el usuario veía en la celda (control de conflicto). */
  expectedValue: string;
  value: string;
}
export type SemanasEditResult =
  | { ok: true; idempotent?: boolean; a1: string; value: string }
  | { ok: false; code: "FORBIDDEN" | "NOT_WRITABLE" | "PROTECTED" | "INVALID" | "CONFLICT" | "GOOGLE_ERROR" | "GOOGLE_PENDING"; message: string };

function normalizeForColumn(tabKey: SemanasTabKey, columnTitle: string | null, raw: string): { ok: true; text: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (value.startsWith("=")) return { ok: false, message: "No se permiten fórmulas desde GENUS (empieza con '=')." };
  if (value.length > 300) return { ok: false, message: "Máximo 300 caracteres." };
  const title = (columnTitle ?? "").toLowerCase();
  if (tabKey === "ENTREGAS" || tabKey === "CDIA") {
    if (title === "fecha" && value) {
      const iso = parseFlexibleDate(value);
      if (!iso) return { ok: false, message: "Fecha inválida. Usá dd/mm/aaaa." };
      return { ok: true, text: formatDateDisplay(iso) };
    }
    if (title === "cantidad" && value) {
      const n = Number(value.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return { ok: false, message: "Cantidad inválida (número ≥ 0)." };
      return { ok: true, text: String(n).replace(".", ",") };
    }
  }
  return { ok: true, text: value };
}

export async function writeSemanasCell(
  actor: { email: string; sector: SectorId; displayName: string },
  edit: SemanasCellEdit,
  today = todayIso()
): Promise<SemanasEditResult> {
  if (!canEditSemanas(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede editar Semanas.");
  if (!isSemanasTabKey(edit.tabKey) || !parseA1(edit.a1)) throw new OrdersValidationError("Celda inválida.");
  const def = SEMANAS_TABS[edit.tabKey];
  const a1 = edit.a1.toUpperCase();
  const gw = await gateway();
  const id = await spreadsheetId();
  if (!isSemanasWritable(id)) {
    return { ok: false, code: "NOT_WRITABLE", message: "La escritura a esta planilla no está habilitada (solo copias de prueba autorizadas)." };
  }

  // Modelo VIVO: la protección se decide en el servidor, nunca por lo que diga el cliente.
  const view = await loadSemanasView(edit.tabKey, today);
  let protection: string | null;
  let columnTitle: string | null = null;
  if (view.kind === "CALENDAR") {
    const found = findCalendarCell(view.weeks ?? [], a1);
    protection = found ? found.cell.protection : "La celda no pertenece a un bloque de semana.";
  } else {
    const found = findFlatCell(view.table!, a1);
    protection = found ? found.protection : "La celda no pertenece a la tabla (no se crean filas nuevas desde la grilla).";
    columnTitle = view.table!.columns.find((c) => a1.startsWith(c.letter) && /^\d+$/.test(a1.slice(c.letter.length)))?.title ?? null;
  }
  if (protection) return { ok: false, code: "PROTECTED", message: protection };

  const normalized = normalizeForColumn(edit.tabKey, columnTitle, edit.value);
  if (!normalized.ok) return { ok: false, code: "INVALID", message: normalized.message };

  const key = createHash("sha256").update(`${id}\u0000${def.tab}\u0000${a1}\u0000${edit.expectedValue.trim()}\u0000${normalized.text}`).digest("hex").slice(0, 40);
  const existing = await findEdit(key);
  if (existing?.status === "confirmed") return { ok: true, idempotent: true, a1, value: normalized.text };

  const op: EditOp = existing ?? {
    id: `sce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: key, spreadsheetId: id, sheetTab: def.tab, a1,
    oldValue: edit.expectedValue, newValue: normalized.text, status: "pending", lastError: null,
    actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName,
    createdAt: new Date().toISOString(), confirmedAt: null,
  };
  const fail = async (status: string, code: Extract<SemanasEditResult, { ok: false }>["code"], message: string) => {
    await saveEdit({ ...op, status, lastError: message });
    return { ok: false as const, code, message };
  };

  try {
    const remote = (await gw.readCell(id, def.tab, a1)).trim();
    if (remote === normalized.text) {
      // Una escritura previa pudo haber llegado a Google sin registrarse: no se reescribe, se confirma.
    } else if (remote !== edit.expectedValue.trim()) {
      return await fail("conflict", "CONFLICT", "La celda cambió en Google Sheets mientras la editabas. No se escribió nada: recargá para ver el valor actual.");
    } else {
      if (await gw.readFormula(id, def.tab, a1)) return await fail("failed", "PROTECTED", "La celda es una fórmula: no se sobrescribe.");
      await gw.writeCell(id, def.tab, a1, normalized.text);
    }
    const back = (await gw.readCell(id, def.tab, a1)).trim();
    if (back !== normalized.text) {
      return await fail("pending", "GOOGLE_PENDING", "Google no confirmó el valor escrito. No se informa como guardado; recargá y reintentá.");
    }
    await saveEdit({ ...op, status: "confirmed", lastError: null, confirmedAt: new Date().toISOString() });
    return { ok: true, a1, value: normalized.text };
  } catch (err) {
    return await fail("failed", "GOOGLE_ERROR", `Google Sheets rechazó o no respondió: ${err instanceof Error ? err.message : "error"}. No se guardó.`);
  }
}
