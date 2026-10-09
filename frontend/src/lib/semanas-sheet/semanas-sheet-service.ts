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
import { and, eq } from "drizzle-orm";
import { isProtectedOriginalSpreadsheet } from "@/lib/google/protected-spreadsheets";
import { parseFlexibleDate, formatDateDisplay } from "@/features/os/operational/lib/delivery-date";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { sheetCellEdits } from "@/lib/db/schema";
import { GoogleSheetCellGateway, type SheetGridGateway } from "@/lib/asignacion-lotes/writeback-gateway";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";
import { dayWidths, findCalendarCell, parseA1, parseWeeklyCalendar, type CalendarWeek, type SheetFormats } from "./calendar-model";
import { loadOperationalLocks, norm, UNVERIFIABLE, type OperationalLocks } from "./operational-locks";
import { isPriority } from "./priorities";
import { listPriorityEvents, loadPriorities, reconcilePriorities, setTaskPriority, type PrioritiesPayload } from "./semanas-priorities-service";
import { linkTask, listLinkEvents, loadTaskLinks, loadWorkItemPriorities, reconcileLinks, suggestLinkCandidates, unlinkTask, type LinkActor } from "./semanas-links-service";
import { filterBySectors, isPlanSector, PLAN_SECTOR_TAB, projectPlanTasks, seesWholePlan, viewablePlanSectors, type PlanSector, type PlanTask } from "./plan-tasks";
import { PREVIEW_SPREADSHEET_ID, getPreviewGateway, isPreviewSourceAllowed } from "./preview-source";
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

/**
 * ¿Se usa la copia XLSX de Preview? Solo en Preview/desarrollo (jamás Production), cuando NO hay una copia de Google
 * configurada explícitamente (SEMANAS_SHEET_ID) ni el fixture local. Así Preview nunca lee ni toca la planilla original.
 */
export function usesPreviewSource(env: Record<string, string | undefined> = process.env): boolean {
  if (!isPreviewSourceAllowed(env)) return false;
  if (env.SEMANAS_SHEET_ID?.trim() || env.GENUS_SEMANAS_FIXTURE_XLSX?.trim()) return false;
  return env.VERCEL_ENV === "preview" || env.GENUS_SEMANAS_PREVIEW_SOURCE === "1";
}

async function gateway(): Promise<SheetGridGateway> {
  if (gatewayOverride) return gatewayOverride;
  if (usesPreviewSource()) return (await getPreviewGateway()).gateway;
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
  if (!gatewayOverride && usesPreviewSource()) return PREVIEW_SPREADSHEET_ID;
  const override = process.env.SEMANAS_SHEET_ID?.trim();
  if (override) return override;
  if (process.env.GENUS_SEMANAS_FIXTURE_XLSX?.trim() && process.env.NODE_ENV !== "production") return "fixture-semanas-2026";
  const { operationsDocumentRepository } = await import("@/lib/adapters/drive/operations-document-repository");
  const ref = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");
  if (!ref) throw new OrdersValidationError("SEMANAS 2026 no está indexada ni configurada (SEMANAS_SHEET_ID).");
  return ref.fileId;
}

/**
 * ¿Es la SEMANAS 2026 ORIGINAL (la indexada en Drive)? Fail-closed: si no se puede averiguar, se trata como original.
 * La copia local de pruebas (fixture) nunca es la original.
 */
async function isIndexedOriginalSemanas(sheetId: string): Promise<boolean> {
  if (sheetId === "fixture-semanas-2026") return false;
  try {
    const { operationsDocumentRepository } = await import("@/lib/adapters/drive/operations-document-repository");
    const ref = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");
    return !ref || ref.fileId === sheetId;
  } catch {
    return true;
  }
}

/** El write-back NUNCA se habilita en Producción (VERCEL_ENV=production), sin importar flags ni allowlist. */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export function isSemanasWritable(sheetId: string): boolean {
  if (isProductionDeployment()) return false;
  if (sheetId === PREVIEW_SPREADSHEET_ID) return false; // copia XLSX de Preview: solo lectura (no hay dónde persistir)
  if (isProtectedOriginalSpreadsheet(sheetId)) return false;
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
  /** De dónde salen los datos: Google, copia XLSX de Preview o fixture local. */
  source: "GOOGLE" | "PREVIEW_XLSX" | "LOCAL_FIXTURE";
  /** La Sheet permite escribir desde GENUS (flag + allowlist). El permiso por usuario se evalúa aparte. */
  writable: boolean;
  weeks?: CalendarWeek[];
  /** Prioridades operativas guardadas en GENUS (nunca en la Sheet), por clave de tarea. Solo calendarios. */
  priorities?: PrioritiesPayload;
  /** Ancho (px) de Lun..Vie en la Sheet original (solo calendarios). */
  dayWidths?: number[];
  table?: FlatTable;
  /** Valor de lectura "como lo vio el usuario": base del chequeo de conflicto. */
  readAt: string;
  today: string;
  /** false = estado operativo no verificable (ENTREGAS y C/DIA quedan bloqueadas por seguridad). */
  locksKnown: boolean;
  /** Fechas anteriores a hoy requieren motivo para editarse (trazabilidad). */
  reasonRequiredBefore: string;
}

function calendarCellLock(locks: OperationalLocks) {
  return ({ value, date }: { a1: string; value: string; date: string | null }) => locks.plannedProductionLock({ date, product: value });
}

function flatRowLock(locks: OperationalLocks) {
  return ({ kind, date, values, columns }: { kind: "ENTREGAS" | "CDIA"; date: string | null; values: string[]; columns: Array<{ title: string }> }) => {
    if (!locks.known) return UNVERIFIABLE;
    const at = (title: string) => values[columns.findIndex((c) => norm(c.title) === title)] ?? "";
    return kind === "ENTREGAS"
      ? locks.deliveryLock({ date, client: at("cliente"), product: at("producto") })
      : locks.dayRecordLock({ date, product: at("producto") });
  };
}

export async function loadSemanasView(tabKey: SemanasTabKey, today = todayIso()): Promise<SemanasViewPayload> {
  const def = SEMANAS_TABS[tabKey];
  const gw = await gateway();
  const id = await spreadsheetId();
  const [rows, merges, formulaCells, locks, formats] = await Promise.all([
    gw.readTab(id, def.tab),
    gw.readMerges(id, def.tab),
    gw.readFormulaCells(id, def.tab),
    loadOperationalLocks(),
    // El formato es solo presentación: si no se puede leer, se muestra sin colores (nunca bloquea la vista).
    def.kind === "CALENDAR" && gw.readFormats ? gw.readFormats(id, def.tab).catch((): SheetFormats | undefined => undefined) : Promise.resolve(undefined),
  ]);
  const base = {
    spreadsheetId: id, tabKey, tab: def.tab, label: def.label, kind: def.kind,
    source: (id === PREVIEW_SPREADSHEET_ID ? "PREVIEW_XLSX" : id === "fixture-semanas-2026" ? "LOCAL_FIXTURE" : "GOOGLE") as SemanasViewPayload["source"],
    writable: isSemanasWritable(id), readAt: new Date().toISOString(), today,
    locksKnown: locks.known, reasonRequiredBefore: today,
  };
  if (def.kind === "CALENDAR") {
    const weeks = parseWeeklyCalendar(rows, merges, { year: YEAR(), formulaCells, formats, cellLock: calendarCellLock(locks) });
    return { ...base, dayWidths: dayWidths(formats), weeks, priorities: await loadPriorities(id, def.tab, weeks) };
  }
  return { ...base, table: parseFlatTable(tabKey === "ENTREGAS" ? "ENTREGAS" : "CDIA", rows, merges, { formulaCells, rowLock: flatRowLock(locks) }) };
}

// ---------- bitácora ----------
interface EditOp {
  id: string; idempotencyKey: string; spreadsheetId: string; sheetTab: string; a1: string;
  oldValue: string | null; newValue: string | null; status: string; lastError: string | null;
  actorEmail: string; actorSector: string; actorName: string;
  reason: string | null; affectsIndicators: boolean;
  createdAt: string; updatedAt: string; confirmedAt: string | null;
}
const g = globalThis as unknown as { __genusSheetCellEdits?: EditOp[] };
export function getSheetCellEditsMemory(): EditOp[] {
  if (!g.__genusSheetCellEdits) g.__genusSheetCellEdits = [];
  return g.__genusSheetCellEdits;
}

/** Una operación `pending` más vieja que esto se considera abandonada (se puede retomar la celda). */
export const OPEN_EDIT_TTL_MS = 2 * 60 * 1000;

function rowToEdit(row: typeof sheetCellEdits.$inferSelect): EditOp {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null };
}

async function findEdit(key: string): Promise<EditOp | null> {
  if (isDatabaseConfigured()) {
    const [row] = await getDb().select().from(sheetCellEdits).where(eq(sheetCellEdits.idempotencyKey, key));
    return row ? rowToEdit(row) : null;
  }
  return getSheetCellEditsMemory().find((o) => o.idempotencyKey === key) ?? null;
}

async function findOpenEdit(spreadsheetId: string, tab: string, a1: string): Promise<EditOp | null> {
  if (isDatabaseConfigured()) {
    const [row] = await getDb()
      .select()
      .from(sheetCellEdits)
      .where(and(eq(sheetCellEdits.spreadsheetId, spreadsheetId), eq(sheetCellEdits.sheetTab, tab), eq(sheetCellEdits.a1, a1), eq(sheetCellEdits.status, "pending")));
    return row ? rowToEdit(row) : null;
  }
  return getSheetCellEditsMemory().find((o) => o.spreadsheetId === spreadsheetId && o.sheetTab === tab && o.a1 === a1 && o.status === "pending") ?? null;
}

async function saveEdit(op: EditOp): Promise<void> {
  const now = new Date();
  if (isDatabaseConfigured()) {
    await getDb()
      .insert(sheetCellEdits)
      .values({ ...op, createdAt: new Date(op.createdAt), updatedAt: now, confirmedAt: op.confirmedAt ? new Date(op.confirmedAt) : null })
      .onConflictDoUpdate({
        target: sheetCellEdits.idempotencyKey,
        set: { status: op.status, lastError: op.lastError, updatedAt: now, confirmedAt: op.confirmedAt ? new Date(op.confirmedAt) : null },
      });
    return;
  }
  const list = getSheetCellEditsMemory();
  const i = list.findIndex((o) => o.idempotencyKey === op.idempotencyKey);
  const next = { ...op, updatedAt: now.toISOString() };
  if (i >= 0) list[i] = next;
  else list.push(next);
}

/**
 * Reserva la celda: a lo sumo UNA edición `pending` por celda (índice único parcial en Neon).
 * Devuelve false si otro usuario la está editando ahora mismo.
 */
async function claimCell(op: EditOp): Promise<boolean> {
  const open = await findOpenEdit(op.spreadsheetId, op.sheetTab, op.a1);
  if (open && open.idempotencyKey !== op.idempotencyKey) {
    if (Date.now() - new Date(open.updatedAt).getTime() < OPEN_EDIT_TTL_MS) return false;
    await saveEdit({ ...open, status: "failed", lastError: "Operación abandonada (timeout): la celda se retomó." });
  }
  try {
    // En memoria el chequeo + alta es síncrono (sin await en medio de la sección crítica del claim).
    if (!isDatabaseConfigured()) {
      const again = getSheetCellEditsMemory().find((o) => o.spreadsheetId === op.spreadsheetId && o.sheetTab === op.sheetTab && o.a1 === op.a1 && o.status === "pending" && o.idempotencyKey !== op.idempotencyKey);
      if (again) return false;
    }
    await saveEdit(op);
    return true;
  } catch (err) {
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") return false; // índice único parcial: otro la reservó primero
    throw err;
  }
}

// ---------- escritura ----------
export interface SemanasCellEdit {
  tabKey: SemanasTabKey;
  a1: string;
  /** Lo que el usuario veía en la celda (control de conflicto). */
  expectedValue: string;
  value: string;
  /** Motivo (obligatorio para fechas anteriores a hoy — trazabilidad de ediciones históricas). */
  reason?: string;
}
export type SemanasEditResult =
  | { ok: true; idempotent?: boolean; a1: string; value: string }
  | { ok: false; code: "FORBIDDEN" | "NOT_WRITABLE" | "PROTECTED" | "INVALID" | "REASON_REQUIRED" | "CONFLICT" | "BUSY" | "GOOGLE_ERROR" | "GOOGLE_PENDING"; message: string };

export const MIN_REASON_LENGTH = 8;
/** Columnas de C/DIA que alimentan el dashboard DB (SUMIFS sobre QACONDDIA!D y !E). */
const INDICATOR_COLUMNS = new Set(["cantidad", "responsable"]);

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
    return { ok: false, code: "NOT_WRITABLE", message: isProductionDeployment() ? "El write-back está deshabilitado en Production." : "La escritura a esta planilla no está habilitada (solo copias de prueba autorizadas)." };
  }
  if (await isIndexedOriginalSemanas(id)) {
    return { ok: false, code: "NOT_WRITABLE", message: "Es la SEMANAS 2026 original: GENUS solo escribe en copias de prueba." };
  }

  // Modelo VIVO + estado operativo real: la protección se decide en el servidor, nunca por lo que diga el cliente.
  const view = await loadSemanasView(edit.tabKey, today);
  let protection: string | null;
  let columnTitle: string | null = null;
  let cellDate: string | null = null;
  if (view.kind === "CALENDAR") {
    const found = findCalendarCell(view.weeks ?? [], a1);
    protection = found ? found.cell.protection : "La celda no pertenece a un bloque de semana.";
    cellDate = found?.cell.date ?? null;
  } else {
    const found = findFlatCell(view.table!, a1);
    protection = found ? found.protection : "La celda no pertenece a la tabla (no se crean filas nuevas desde la grilla).";
    columnTitle = view.table!.columns.find((c) => a1.startsWith(c.letter) && /^\d+$/.test(a1.slice(c.letter.length)))?.title ?? null;
    cellDate = view.table!.rows.find((r) => r.rowNumber === parseA1(a1)!.row)?.date ?? null;
  }
  if (protection) return { ok: false, code: "PROTECTED", message: protection };

  const normalized = normalizeForColumn(edit.tabKey, columnTitle, edit.value);
  if (!normalized.ok) return { ok: false, code: "INVALID", message: normalized.message };

  // Trazabilidad de ediciones históricas: motivo obligatorio; marca si alimenta indicadores del dashboard DB.
  const historic = Boolean(cellDate && cellDate < today);
  const affectsIndicators = edit.tabKey === "CDIA" && INDICATOR_COLUMNS.has((columnTitle ?? "").toLowerCase());
  const reason = (edit.reason ?? "").trim();
  if (historic && reason.length < MIN_REASON_LENGTH) {
    return { ok: false, code: "REASON_REQUIRED", message: `Editar una fecha anterior a hoy requiere un motivo (mín. ${MIN_REASON_LENGTH} caracteres)${affectsIndicators ? " — esta celda alimenta los indicadores del dashboard DB" : ""}.` };
  }

  const key = createHash("sha256").update(`${id}\u0000${def.tab}\u0000${a1}\u0000${edit.expectedValue.trim()}\u0000${normalized.text}`).digest("hex").slice(0, 40);
  const existing = await findEdit(key);
  if (existing?.status === "confirmed") return { ok: true, idempotent: true, a1, value: normalized.text };

  const nowIso = new Date().toISOString();
  const op: EditOp = {
    id: existing?.id ?? `sce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: key, spreadsheetId: id, sheetTab: def.tab, a1,
    oldValue: edit.expectedValue, newValue: normalized.text, status: "pending", lastError: null,
    actorEmail: actor.email, actorSector: actor.sector, actorName: actor.displayName,
    reason: reason || null, affectsIndicators,
    createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso, confirmedAt: null,
  };
  if (!(await claimCell(op))) {
    return { ok: false, code: "BUSY", message: "Otro usuario está editando esta celda en este momento. Esperá unos segundos, recargá y reintentá." };
  }
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
      return await fail("pending_unconfirmed", "GOOGLE_PENDING", "Google no confirmó el valor escrito. No se informa como guardado; recargá y reintentá.");
    }
    await saveEdit({ ...op, status: "confirmed", lastError: null, confirmedAt: new Date().toISOString() });
    return { ok: true, a1, value: normalized.text };
  } catch (err) {
    return await fail("failed", "GOOGLE_ERROR", `Google Sheets rechazó o no respondió: ${err instanceof Error ? err.message : "error"}. No se guardó.`);
  }
}

/** Cambia la prioridad de una tarea (dato de GENUS; no escribe en la Sheet). Relee la planilla para validar que la tarea existe. */
export async function updateTaskPriority(
  actor: { email: string; sector: SectorId; displayName: string },
  input: { tabKey: string; taskKey: string; priority: string; expectedVersion: number }
) {
  if (!isSemanasTabKey(input.tabKey) || SEMANAS_TABS[input.tabKey].kind !== "CALENDAR") throw new OrdersValidationError("Solo ELABORACION y ACONDICIONAMIENTO tienen prioridades.");
  if (!isPriority(input.priority)) throw new OrdersValidationError("Prioridad inválida (URGENTE, IMPORTANTE o NORMAL).");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new OrdersValidationError("expectedVersion inválida.");
  const view = await loadSemanasView(input.tabKey);
  return setTaskPriority(actor, { spreadsheetId: view.spreadsheetId, tab: view.tab, taskKey: input.taskKey, priority: input.priority, expectedVersion: input.expectedVersion }, view.weeks ?? []);
}

/** Tras editar celdas: re-asocia prioridades de tareas cuyo texto se corrigió (mejor esfuerzo). */
export async function reconcileSemanasPriorities(tabKeys: string[]): Promise<void> {
  for (const key of new Set(tabKeys)) {
    if (!isSemanasTabKey(key) || SEMANAS_TABS[key].kind !== "CALENDAR") continue;
    try {
      const view = await loadSemanasView(key);
      await reconcilePriorities(view.spreadsheetId, view.tab, view.weeks ?? []);
      await reconcileLinks(view.spreadsheetId, view.tab, calendarTasksOf(view));
    } catch {
      /* no bloquea la edición */
    }
  }
}

// ---------- planificación por sector (solo lectura) ----------
export interface SectorPlanPayload {
  /** Sectores incluidos en la respuesta (siempre dentro de lo que el usuario puede ver). */
  sectors: PlanSector[];
  /** Sectores que el usuario puede consultar (para el selector). */
  allowed: PlanSector[];
  weeks: Array<{ id: string; label: string; dates: (string | null)[]; hidden: boolean; tabKey: PlanTask["tabKey"] }>;
  tasks: PlanTask[];
  prioritiesAvailable: boolean;
  source: SemanasViewPayload["source"];
  readAt: string;
  today: string;
}

/**
 * Planificación de Semanas para una pantalla de sector (Semanas / Día a día / Modo TV). SOLO LECTURA.
 * La autorización se decide acá (servidor), nunca por lo que pida el cliente: un sector solo recibe las tareas que le
 * corresponden; Producción/Dirección pueden elegir cualquiera. No se envían celdas (A1) ni el resto de la planilla.
 */
export async function loadSectorPlan(viewer: SectorId, requested: string | null | undefined, today = todayIso()): Promise<SectorPlanPayload> {
  const allowed = viewablePlanSectors(viewer);
  if (allowed.length === 0) throw new OrdersForbiddenError("Tu sector no tiene planificación en Semanas.");
  const want = (requested ?? "").trim().toUpperCase();
  let sectors: PlanSector[];
  if (!want || want === "ALL" || want === "TODOS") sectors = allowed;
  else if (isPlanSector(want) && allowed.includes(want)) sectors = [want];
  else throw new OrdersForbiddenError("No tenés permiso para ver la planificación de ese sector.");
  const tabs = [...new Set(sectors.map((s) => PLAN_SECTOR_TAB[s]))];
  const views = await Promise.all(tabs.map((t) => loadSemanasView(t, today)));
  const whole = seesWholePlan(viewer) && sectors.length === allowed.length;
  const tasks: PlanTask[] = [];
  const weeks: SectorPlanPayload["weeks"] = [];
  for (const v of views) {
    const tabKey = v.tabKey as PlanTask["tabKey"];
    tasks.push(...filterBySectors(projectPlanTasks(tabKey, v.weeks ?? [], v.tab, v.priorities), sectors, whole));
    for (const w of v.weeks ?? []) weeks.push({ id: w.id, label: w.label, dates: w.dates, hidden: Boolean(w.hidden), tabKey });
  }
  return {
    sectors, allowed, weeks, tasks,
    prioritiesAvailable: views.every((v) => v.priorities?.available !== false),
    source: views[0]?.source ?? "GOOGLE",
    readAt: new Date().toISOString(),
    today,
  };
}

/** Historial de una tarea (auditoría): cambios de prioridad y de vínculo con trabajos operativos. */
export async function loadPriorityHistory(tabKey: string, taskKey: string) {
  if (!isSemanasTabKey(tabKey) || SEMANAS_TABS[tabKey].kind !== "CALENDAR") throw new OrdersValidationError("Solo ELABORACION y ACONDICIONAMIENTO tienen prioridades.");
  const id = await spreadsheetId();
  const [events, linkEvents] = await Promise.all([listPriorityEvents(id, SEMANAS_TABS[tabKey].tab, taskKey), listLinkEvents(id, SEMANAS_TABS[tabKey].tab, taskKey)]);
  return { events, linkEvents };
}

// ---------- vínculos tarea de Semanas ↔ trabajo operativo (0042) ----------
type CalendarTabKey = "ELABORACION" | "ACONDICIONAMIENTO";
function calendarTabKey(tabKey: string): CalendarTabKey {
  if (tabKey !== "ELABORACION" && tabKey !== "ACONDICIONAMIENTO") throw new OrdersValidationError("Solo ELABORACION y ACONDICIONAMIENTO tienen tareas vinculables.");
  return tabKey;
}
/** Tareas ACTUALES (con prioridad) de una vista de calendario: la misma proyección que Semanas, Día a día y TV. */
function calendarTasksOf(view: SemanasViewPayload): PlanTask[] {
  return projectPlanTasks(view.tabKey as CalendarTabKey, view.weeks ?? [], view.tab, view.priorities);
}

/** Vínculos de la pestaña para la Lista de Producción (se agregan a la lectura de la grilla). */
export async function loadLinksForView(view: SemanasViewPayload) {
  if (view.kind !== "CALENDAR") return undefined;
  return loadTaskLinks(view.spreadsheetId, view.tab, calendarTasksOf(view));
}

export async function suggestSemanasLinks(tabKey: string, taskKey: string) {
  const view = await loadSemanasView(calendarTabKey(tabKey));
  const task = calendarTasksOf(view).find((t) => t.key === taskKey);
  if (!task) throw new OrdersValidationError("La tarea ya no está en la planilla. Recargá.");
  return suggestLinkCandidates(task, view.spreadsheetId);
}

export async function linkSemanasTask(actor: LinkActor, input: { tabKey: string; taskKey: string; workItemId: string; replace?: { linkId: string; expectedVersion: number }; reason?: string }) {
  if (!canEditSemanas(actor.sector)) throw new OrdersForbiddenError("Solo Producción puede vincular tareas de Semanas con trabajos.");
  const view = await loadSemanasView(calendarTabKey(input.tabKey));
  return linkTask(actor, { spreadsheetId: view.spreadsheetId, tab: view.tab, taskKey: input.taskKey, workItemId: input.workItemId, replace: input.replace, reason: input.reason }, calendarTasksOf(view));
}

export async function unlinkSemanasTask(actor: LinkActor, input: { linkId: string; expectedVersion: number; reason: string }) {
  return unlinkTask(actor, input);
}

/** Prioridad de Semanas de los trabajos de «Mi trabajo» que el usuario puede ver (solo los vinculados por Producción). */
export async function loadSemanasWorkItemPriorities(viewer: SectorId, today = todayIso()) {
  const id = await spreadsheetId();
  const byTab = Object.fromEntries((["ELABORACION", "ACONDICIONAMIENTO"] as const).map((k) => [SEMANAS_TABS[k].tab, k]));
  return loadWorkItemPriorities(viewer, id, async (tab) => {
    const key = byTab[tab];
    return key ? calendarTasksOf(await loadSemanasView(key, today)) : [];
  });
}
