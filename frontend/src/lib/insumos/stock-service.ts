/**
 * INSUMOS — control de stock (Postgres, migración 0090). Mismo modelo que Cajas Genus: libro de movimientos por insumo, baseline por `seq`,
 * descuento recalculado POR RETIRO (alta / corrección / anulación comparten `syncRetiroStock`) y alerta por insumo con episodios.
 *
 * STOCK = STOCK INICIAL + INGRESOS − RETIROS + AJUSTES NETOS (solo lo registrado después del stock inicial vigente).
 * Un retiro NUNCA se bloquea por falta de stock: el consumo real se registra siempre (el stock puede quedar negativo y alerta).
 */
import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { insumoItems, insumoRetiroItems, insumoRetiros, insumoStockAudit, insumoStockConfig, insumoStockMovements, osNotifications } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import { uuidFromKey } from "@/lib/planning/circuit/movements";
import { canAdminInsumos, validateMotivo } from "./insumos-rules";
import { isDayKey } from "./insumos-reports";
import {
  STOCK_KINDS,
  alertDecision,
  alertMessage,
  alertNotificationKey,
  alertTitle,
  computeStock,
  desiredEgress,
  egressDiff,
  isIsoDate,
  isRetiroTracked,
  needsRestock,
  parseAdjustDelta,
  parseIngresoQty,
  parseInitialStock,
  parseMinStock,
  parseObservaciones,
  parseUnit,
  runningBalance,
  stockStatus,
  type LedgerRow,
  type StockKind,
  type StockStatus,
} from "./stock-rules";
import type { InsumoActor } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- misma convención que Cajas Genus: la transacción se pasa entre servicios
type AnyTx = any;

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

function db() {
  if (!isDatabaseConfigured()) throw new OrdersUnavailableError("La base de datos no está configurada: el stock de insumos necesita Postgres.");
  return getDb();
}
function assertAdmin(a: InsumoActor) {
  if (!canAdminInsumos(a.sector)) throw new OrdersForbiddenError("Solo Administración y Dirección pueden consultar y modificar el stock de insumos.");
}

// ───────────────────────── Piezas de bajo nivel ─────────────────────────

/** Candado de transacción por insumo, en orden estable (sin interbloqueos): serializa «leer stock → decidir → escribir» entre sectores y dispositivos. */
async function lockInsumos(tx: AnyTx, ids: Iterable<string>): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`insumos-stock:${id}`}))`);
}

async function getConfig(tx: AnyTx) {
  const [row] = await tx.select().from(insumoStockConfig).where(eq(insumoStockConfig.id, "main")).limit(1);
  if (row) return row as typeof insumoStockConfig.$inferSelect;
  await tx.insert(insumoStockConfig).values({ id: "main" }).onConflictDoNothing();
  const [again] = await tx.select().from(insumoStockConfig).where(eq(insumoStockConfig.id, "main")).limit(1);
  return again as typeof insumoStockConfig.$inferSelect;
}

type LedgerDb = LedgerRow & { insumoId: string };
async function loadLedger(tx: AnyTx, insumoId?: string): Promise<LedgerDb[]> {
  const q = tx
    .select({ id: insumoStockMovements.id, seq: insumoStockMovements.seq, insumoId: insumoStockMovements.insumoId, kind: insumoStockMovements.kind, delta: insumoStockMovements.delta, status: insumoStockMovements.status, occurredOn: insumoStockMovements.occurredOn })
    .from(insumoStockMovements);
  const rows = insumoId ? await q.where(eq(insumoStockMovements.insumoId, insumoId)) : await q;
  return rows.map((r: { id: string; seq: number | string; insumoId: string; kind: string; delta: number; status: string; occurredOn: string }) => ({ ...r, seq: Number(r.seq), kind: r.kind as StockKind }));
}

async function audit(tx: AnyTx, actor: InsumoActor, a: { action: string; insumoId?: string | null; targetId?: string | null; before?: unknown; after?: unknown; reason?: string | null }) {
  await tx.insert(insumoStockAudit).values({
    action: a.action,
    insumoId: a.insumoId ?? null,
    targetId: a.targetId ?? null,
    beforeData: (a.before ?? null) as never,
    afterData: (a.after ?? null) as never,
    reason: a.reason ?? null,
    actorEmail: actor.email,
    actorName: actor.displayName,
    actorSector: actor.sector,
  });
}

async function insertMovement(
  tx: AnyTx,
  m: { insumoId: string; kind: StockKind; delta: number; occurredOn: string; key: string; actor: { email: string; sector: string; displayName?: string | null }; retiroId?: string | null; note?: string | null; detail?: unknown }
): Promise<{ id: string; created: boolean }> {
  const [row] = await tx
    .insert(insumoStockMovements)
    .values({
      insumoId: m.insumoId,
      kind: m.kind,
      delta: m.delta,
      occurredOn: m.occurredOn,
      idempotencyKey: m.key,
      retiroId: m.retiroId ?? null,
      note: m.note ?? null,
      detail: (m.detail ?? {}) as never,
      createdBy: m.actor.email,
      createdByName: m.actor.displayName ?? null,
      createdBySector: m.actor.sector,
    })
    .onConflictDoNothing()
    .returning({ id: insumoStockMovements.id });
  if (row) return { id: row.id as string, created: true };
  const [existing] = await tx.select({ id: insumoStockMovements.id }).from(insumoStockMovements).where(eq(insumoStockMovements.idempotencyKey, m.key)).limit(1);
  return { id: existing.id as string, created: false };
}

/**
 * Recalcula la alerta de UN insumo con su stock REAL. Una notificación por insumo y por episodio (id determinístico): mientras siga bajo no se repite;
 * al superar el mínimo se cierra el episodio y, si vuelve a caer, se abre uno nuevo y se notifica otra vez. Requiere el candado del insumo.
 */
export async function refreshInsumoAlert(tx: AnyTx, insumoId: string): Promise<{ critical: boolean; notified: boolean }> {
  const [item] = await tx.select().from(insumoItems).where(eq(insumoItems.id, insumoId)).limit(1);
  if (!item) return { critical: false, notified: false };
  const s = computeStock(await loadLedger(tx, insumoId));
  const d = alertDecision({ active: item.active, configured: s.configured, stock: s.stock, minStock: item.minStock, state: item.alertState === "CRITICO" ? "CRITICO" : "NORMAL" });
  if (d.next !== item.alertState || d.notify) {
    const episode = d.notify ? item.alertEpisode + 1 : item.alertEpisode;
    await tx
      .update(insumoItems)
      .set({ alertState: d.next, alertEpisode: episode, alertSince: d.next === "CRITICO" ? (d.notify ? new Date() : (item.alertSince ?? new Date())) : null })
      .where(eq(insumoItems.id, insumoId));
    if (d.notify && s.stock != null && d.level) {
      await tx
        .insert(osNotifications)
        .values({
          id: uuidFromKey(alertNotificationKey(insumoId, episode)),
          kind: "insumos_stock_bajo",
          title: alertTitle(d.level),
          message: alertMessage({ name: item.name, stock: s.stock, minStock: item.minStock, unit: item.unit, level: d.level }),
          sectors: ["ADMINISTRACION"],
          href: "/insumos-stock",
          readBy: [],
          dismissedBy: [],
          deletedBy: [],
        })
        .onConflictDoNothing();
    }
  }
  return { critical: d.critical, notified: d.notify };
}

// ───────────────────────── Descuento automático por retiro ─────────────────────────

export type SyncRetiroResult = { retiroId: string; tracked: boolean; moved: Array<{ insumoId: string; delta: number }> };

/**
 * Deja el libro de stock consistente con el ESTADO ACTUAL de UN retiro (alta, corrección y anulación usan esta única lógica):
 * egreso deseado por insumo vs ya descontado → movimiento de la DIFERENCIA. Idempotente (replay = sin movimientos) y segura ante concurrencia
 * (candado por retiro y por insumo). Corre dentro de la transacción del retiro.
 */
export async function syncRetiroStock(tx: AnyTx, retiroId: string, actor: { email: string; sector: string; displayName?: string | null }): Promise<SyncRetiroResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`insumos-retiro:${retiroId}`}))`);
  const [retiro] = await tx.select().from(insumoRetiros).where(eq(insumoRetiros.id, retiroId)).limit(1);
  if (!retiro) return { retiroId, tracked: false, moved: [] };
  const lines = (await tx.select().from(insumoRetiroItems).where(eq(insumoRetiroItems.retiroId, retiroId))) as Array<{ insumoId: string; cantidad: number }>;
  const prior = (await tx
    .select({ insumoId: insumoStockMovements.insumoId, delta: insumoStockMovements.delta })
    .from(insumoStockMovements)
    .where(and(eq(insumoStockMovements.retiroId, retiroId), eq(insumoStockMovements.status, "ACTIVO")))) as Array<{ insumoId: string; delta: number }>;
  const cfg = await getConfig(tx);
  if (!isRetiroTracked(new Date(retiro.createdAt), new Date(cfg.trackingStartedAt), prior.length > 0)) return { retiroId, tracked: false, moved: [] };

  const desired = desiredEgress({ status: retiro.status, lines });
  const ids = [...new Set([...desired.keys(), ...prior.map((p) => p.insumoId)])].sort();
  await lockInsumos(tx, ids);

  const moved: SyncRetiroResult["moved"] = [];
  for (const insumoId of ids) {
    const mine = prior.filter((p) => p.insumoId === insumoId);
    const already = -mine.reduce((a, p) => a + p.delta, 0);
    const diff = egressDiff(already, desired.get(insumoId) ?? 0);
    if (!diff) continue;
    const m = await insertMovement(tx, {
      insumoId,
      kind: diff.kind,
      delta: diff.delta,
      occurredOn: today(),
      key: `retiro:${retiroId}:${insumoId}:n${mine.length + 1}`,
      actor,
      retiroId,
      detail: { cantidad: desired.get(insumoId) ?? 0, anterior: already, estadoRetiro: retiro.status, sector: retiro.sector },
    });
    if (m.created) {
      moved.push({ insumoId, delta: diff.delta });
      await refreshInsumoAlert(tx, insumoId);
    }
  }
  return { retiroId, tracked: true, moved };
}

// ───────────────────────── Consultas ─────────────────────────

export type StockRowView = {
  insumoId: string;
  name: string;
  unit: string;
  minStock: number;
  active: boolean;
  /** Hay stock inicial (conteo) cargado. false ≠ stock 0. */
  configured: boolean;
  baseline: number | null;
  stock: number | null;
  ingresos: number;
  retiros: number;
  ajustes: number;
  status: StockStatus;
  /** Requiere reposición (alerta visible): stock inicial cargado, insumo activo y stock ≤ mínimo. */
  alert: boolean;
  alertSince: string | null;
};
export type StockSummaryView = { items: StockRowView[]; alertCount: number; trackingStartedAt: string; generatedAt: string };

export function buildStockRows(
  items: Array<{ id: string; name: string; unit: string; minStock: number; active: boolean; alertSince: Date | null; sortOrder: number }>,
  ledger: readonly LedgerDb[]
): StockRowView[] {
  const byInsumo = new Map<string, LedgerDb[]>();
  for (const r of ledger) byInsumo.set(r.insumoId, [...(byInsumo.get(r.insumoId) ?? []), r]);
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"))
    .map((it) => {
      const s = computeStock(byInsumo.get(it.id) ?? []);
      const status = stockStatus({ configured: s.configured, stock: s.stock, minStock: it.minStock });
      return {
        insumoId: it.id,
        name: it.name,
        unit: it.unit,
        minStock: it.minStock,
        active: it.active,
        configured: s.configured,
        baseline: s.baseline,
        stock: s.stock,
        // Con stock inicial se muestra lo que explica el stock (desde el conteo); sin él, lo registrado en total.
        ingresos: s.configured ? s.ingresosDesdeBase : s.totalIngresos,
        retiros: s.configured ? s.retirosDesdeBase : s.totalRetiros,
        ajustes: s.ajustesNetosDesdeBase,
        status,
        alert: it.active && needsRestock(status),
        alertSince: it.alertSince ? it.alertSince.toISOString() : null,
      };
    });
}

/** Stock por insumo y cantidad de insumos que requieren reposición (calculado en el servidor, no sale de la campana). Solo Administración y Dirección. */
export async function getStockSummary(actor: InsumoActor): Promise<StockSummaryView> {
  assertAdmin(actor);
  const d = db();
  const [items, ledger, cfg] = await Promise.all([d.select().from(insumoItems), loadLedger(d), getConfig(d)]);
  const rows = buildStockRows(items, ledger);
  return { items: rows, alertCount: rows.filter((r) => r.alert).length, trackingStartedAt: cfg.trackingStartedAt.toISOString(), generatedAt: new Date().toISOString() };
}

export type MovementView = {
  id: string;
  seq: number;
  insumoId: string;
  insumoName: string;
  unit: string;
  kind: StockKind;
  delta: number;
  occurredOn: string;
  occurredAt: string;
  status: string;
  note: string | null;
  retiroId: string | null;
  retiroSector: string | null;
  retiroResponsable: string | null;
  createdBy: string;
  createdByName: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  /** Saldo del insumo después del movimiento (null = anterior al stock inicial vigente). */
  balance: number | null;
};
export type MovementFilters = { insumoId?: string; kind?: string; from?: string; to?: string; includeVoided?: boolean; limit?: number };
export const MAX_MOVEMENTS = 1000;

export async function listStockMovements(actor: InsumoActor, f: MovementFilters = {}): Promise<{ items: MovementView[]; truncated: boolean }> {
  assertAdmin(actor);
  if (f.from && !isDayKey(f.from)) throw new OrdersValidationError("La fecha «desde» no es válida.");
  if (f.to && !isDayKey(f.to)) throw new OrdersValidationError("La fecha «hasta» no es válida.");
  if (f.kind && !(STOCK_KINDS as readonly string[]).includes(f.kind)) throw new OrdersValidationError("Tipo de movimiento inválido.");
  const d = db();
  const conds = [];
  if (f.insumoId) conds.push(eq(insumoStockMovements.insumoId, f.insumoId));
  const rows = await d
    .select({
      m: insumoStockMovements,
      itemName: insumoItems.name,
      unit: insumoItems.unit,
      retiroSector: insumoRetiros.sector,
      retiroResponsable: insumoRetiros.responsableName,
    })
    .from(insumoStockMovements)
    .innerJoin(insumoItems, eq(insumoItems.id, insumoStockMovements.insumoId))
    .leftJoin(insumoRetiros, eq(insumoRetiros.id, insumoStockMovements.retiroId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(insumoStockMovements.seq));
  // Saldo acumulado por insumo sobre TODO el libro del insumo (no solo lo filtrado).
  const perInsumo = new Map<string, LedgerRow[]>();
  for (const r of rows) perInsumo.set(r.m.insumoId, [...(perInsumo.get(r.m.insumoId) ?? []), { seq: Number(r.m.seq), kind: r.m.kind as StockKind, delta: r.m.delta, status: r.m.status }]);
  const balances = new Map<string, Map<number, number | null>>();
  for (const [id, led] of perInsumo) balances.set(id, runningBalance(led));
  const out: MovementView[] = [];
  for (const r of rows) {
    const m = r.m;
    if (f.kind && m.kind !== f.kind) continue;
    if (f.from && m.occurredOn < f.from) continue;
    if (f.to && m.occurredOn > f.to) continue;
    if (f.includeVoided === false && m.status !== "ACTIVO") continue;
    out.push({
      id: m.id,
      seq: Number(m.seq),
      insumoId: m.insumoId,
      insumoName: r.itemName,
      unit: r.unit,
      kind: m.kind as StockKind,
      delta: m.delta,
      occurredOn: m.occurredOn,
      occurredAt: m.occurredAt.toISOString(),
      status: m.status,
      note: m.note,
      retiroId: m.retiroId,
      retiroSector: r.retiroSector ?? null,
      retiroResponsable: r.retiroResponsable ?? null,
      createdBy: m.createdBy,
      createdByName: m.createdByName,
      voidedAt: m.voidedAt ? m.voidedAt.toISOString() : null,
      voidedBy: m.voidedBy,
      voidReason: m.voidReason,
      balance: balances.get(m.insumoId)?.get(Number(m.seq)) ?? null,
    });
  }
  const cap = Math.min(Math.max(1, f.limit ?? MAX_MOVEMENTS), MAX_MOVEMENTS);
  return { items: out.slice(0, cap), truncated: out.length > cap };
}

export type StockAuditView = { id: string; action: string; insumoId: string | null; targetId: string | null; before: unknown; after: unknown; reason: string | null; actorEmail: string; actorName: string | null; actorSector: string; createdAt: string };
export async function listStockAudit(actor: InsumoActor, f: { insumoId?: string; targetId?: string; limit?: number } = {}): Promise<StockAuditView[]> {
  assertAdmin(actor);
  const conds = [];
  if (f.insumoId) conds.push(eq(insumoStockAudit.insumoId, f.insumoId));
  if (f.targetId) conds.push(eq(insumoStockAudit.targetId, f.targetId));
  const rows = await db().select().from(insumoStockAudit).where(conds.length ? and(...conds) : undefined).orderBy(desc(insumoStockAudit.createdAt)).limit(Math.min(f.limit ?? 200, 500));
  return rows.map((r) => ({ id: r.id, action: r.action, insumoId: r.insumoId, targetId: r.targetId, before: r.beforeData, after: r.afterData, reason: r.reason, actorEmail: r.actorEmail, actorName: r.actorName, actorSector: r.actorSector, createdAt: r.createdAt.toISOString() }));
}

// ───────────────────────── Administración: stock inicial, ingresos, ajustes, configuración ─────────────────────────

const requireKey = (k: unknown): string => {
  const key = typeof k === "string" ? k.trim() : "";
  if (!key || key.length > 120) throw new OrdersValidationError("Falta la clave de la operación (evita duplicados al reintentar).");
  return key;
};
const requireFecha = (raw: unknown): string => {
  const f = typeof raw === "string" && raw.trim() ? raw.trim() : today();
  if (!isIsoDate(f)) throw new OrdersValidationError("Fecha inválida.");
  return f;
};
async function requireItem(tx: AnyTx, insumoId: unknown) {
  if (typeof insumoId !== "string" || !insumoId) throw new OrdersValidationError("Elegí el insumo.");
  const [item] = await tx.select().from(insumoItems).where(eq(insumoItems.id, insumoId)).limit(1);
  if (!item) throw new OrdersNotFoundError("No existe ese insumo.");
  return item as typeof insumoItems.$inferSelect;
}
async function rowFor(tx: AnyTx, insumoId: string): Promise<StockRowView> {
  const [item] = await tx.select().from(insumoItems).where(eq(insumoItems.id, insumoId)).limit(1);
  return buildStockRows([item], await loadLedger(tx, insumoId))[0]!;
}

/** Conteo físico de partida del insumo. Auditado; el vigente es el último. NO descuenta retiros anteriores (solo cuenta lo registrado después). */
export async function setInitialStock(actor: InsumoActor, input: { insumoId: unknown; quantity: unknown; fecha?: unknown; note?: unknown; key: unknown }): Promise<StockRowView> {
  assertAdmin(actor);
  const q = parseInitialStock(input.quantity);
  if (!q.ok) throw new OrdersValidationError(q.error);
  const note = parseObservaciones(input.note);
  if (!note.ok) throw new OrdersValidationError(note.error);
  const fecha = requireFecha(input.fecha);
  const key = requireKey(input.key);
  return db().transaction(async (tx) => {
    const item = await requireItem(tx, input.insumoId);
    await lockInsumos(tx, [item.id]);
    const before = computeStock(await loadLedger(tx, item.id));
    const m = await insertMovement(tx, { insumoId: item.id, kind: "STOCK_INICIAL", delta: q.value, occurredOn: fecha, key: `inicial:${key}`, actor, note: note.value, detail: { stockAnterior: before.stock } });
    if (m.created) await audit(tx, actor, { action: "STOCK_INICIAL", insumoId: item.id, targetId: m.id, before: { stock: before.stock, configurado: before.configured }, after: { stock: q.value, fecha }, reason: note.value });
    await refreshInsumoAlert(tx, item.id);
    return rowFor(tx, item.id);
  });
}

export type IngresoResult = { id: string; replayed: boolean; row: StockRowView; stockAntes: number | null };

/** Ingreso de insumos (compra / reposición). Reintentos con la misma clave no duplican. */
export async function registerIngreso(actor: InsumoActor, input: { insumoId: unknown; cantidad: unknown; fecha?: unknown; observaciones?: unknown; key: unknown }): Promise<IngresoResult> {
  assertAdmin(actor);
  const q = parseIngresoQty(input.cantidad);
  if (!q.ok) throw new OrdersValidationError(q.error);
  const obs = parseObservaciones(input.observaciones);
  if (!obs.ok) throw new OrdersValidationError(obs.error);
  const fecha = requireFecha(input.fecha);
  const key = requireKey(input.key);
  return db().transaction(async (tx) => {
    const item = await requireItem(tx, input.insumoId);
    await lockInsumos(tx, [item.id]);
    const before = computeStock(await loadLedger(tx, item.id));
    const m = await insertMovement(tx, { insumoId: item.id, kind: "INGRESO", delta: q.value, occurredOn: fecha, key: `ingreso:${key}`, actor, note: obs.value, detail: { unidad: item.unit } });
    if (m.created) await audit(tx, actor, { action: "INGRESO_REGISTRADO", insumoId: item.id, targetId: m.id, before: null, after: { cantidad: q.value, fecha, observaciones: obs.value } });
    await refreshInsumoAlert(tx, item.id);
    return { id: m.id, replayed: !m.created, row: await rowFor(tx, item.id), stockAntes: before.stock };
  });
}

/** Corrige un ingreso (cantidad, fecha, observaciones) con motivo. Queda el antes/después en la auditoría. */
export async function correctIngreso(actor: InsumoActor, id: string, input: { cantidad?: unknown; fecha?: unknown; observaciones?: unknown; reason: unknown }): Promise<StockRowView> {
  assertAdmin(actor);
  const reason = validateMotivo(input.reason);
  if (!reason.ok) throw new OrdersValidationError(reason.message);
  return db().transaction(async (tx) => {
    const [peek] = await tx.select().from(insumoStockMovements).where(eq(insumoStockMovements.id, id)).limit(1);
    if (!peek) throw new OrdersNotFoundError("No se encontró el ingreso.");
    await lockInsumos(tx, [peek.insumoId]);
    const [m] = await tx.select().from(insumoStockMovements).where(eq(insumoStockMovements.id, id)).for("update");
    if (m.kind !== "INGRESO") throw new OrdersValidationError("Solo se corrigen ingresos.");
    if (m.status !== "ACTIVO") throw new OrdersValidationError("Un ingreso anulado no se puede corregir.");
    let delta = m.delta;
    if (input.cantidad !== undefined) {
      const q = parseIngresoQty(input.cantidad);
      if (!q.ok) throw new OrdersValidationError(q.error);
      delta = q.value;
    }
    const fecha = input.fecha !== undefined ? requireFecha(input.fecha) : m.occurredOn;
    let note = m.note;
    if (input.observaciones !== undefined) {
      const o = parseObservaciones(input.observaciones);
      if (!o.ok) throw new OrdersValidationError(o.error);
      note = o.value;
    }
    if (delta === m.delta && fecha === m.occurredOn && note === m.note) throw new OrdersValidationError("No hay cambios para guardar.");
    await tx.update(insumoStockMovements).set({ delta, occurredOn: fecha, note, updatedAt: new Date() }).where(eq(insumoStockMovements.id, id));
    await audit(tx, actor, { action: "INGRESO_CORREGIDO", insumoId: m.insumoId, targetId: id, before: { cantidad: m.delta, fecha: m.occurredOn, observaciones: m.note }, after: { cantidad: delta, fecha, observaciones: note }, reason: reason.value });
    await refreshInsumoAlert(tx, m.insumoId);
    return rowFor(tx, m.insumoId);
  });
}

/** Anula un ingreso, un ajuste manual o un stock inicial (con motivo, sin borrar). Los descuentos por retiro se corrigen desde el retiro. */
export async function voidMovement(actor: InsumoActor, id: string, rawReason: unknown): Promise<StockRowView> {
  assertAdmin(actor);
  const reason = validateMotivo(rawReason);
  if (!reason.ok) throw new OrdersValidationError(reason.message);
  return db().transaction(async (tx) => {
    const [peek] = await tx.select().from(insumoStockMovements).where(eq(insumoStockMovements.id, id)).limit(1);
    if (!peek) throw new OrdersNotFoundError("No se encontró el movimiento.");
    await lockInsumos(tx, [peek.insumoId]);
    const [m] = await tx.select().from(insumoStockMovements).where(eq(insumoStockMovements.id, id)).for("update");
    if (m.status !== "ACTIVO") throw new OrdersValidationError("El movimiento ya estaba anulado.");
    if (m.kind === "EGRESO_RETIRO" || m.kind === "AJUSTE_RETIRO") throw new OrdersValidationError("Los descuentos por retiro se corrigen desde el retiro (corregir o anular): no se anulan a mano.");
    await tx.update(insumoStockMovements).set({ status: "ANULADO", voidedAt: new Date(), voidedBy: actor.email, voidReason: reason.value, updatedAt: new Date() }).where(eq(insumoStockMovements.id, id));
    await audit(tx, actor, { action: "MOVIMIENTO_ANULADO", insumoId: m.insumoId, targetId: id, before: { kind: m.kind, delta: m.delta, status: m.status }, after: { status: "ANULADO" }, reason: reason.value });
    await refreshInsumoAlert(tx, m.insumoId);
    return rowFor(tx, m.insumoId);
  });
}

/** Ajuste manual (±) con motivo obligatorio. */
export async function manualAdjust(actor: InsumoActor, input: { insumoId: unknown; delta: unknown; reason: unknown; fecha?: unknown; key: unknown }): Promise<StockRowView> {
  assertAdmin(actor);
  const d = parseAdjustDelta(input.delta);
  if (!d.ok) throw new OrdersValidationError(d.error);
  const reason = validateMotivo(input.reason);
  if (!reason.ok) throw new OrdersValidationError("El motivo del ajuste es obligatorio.");
  const fecha = requireFecha(input.fecha);
  const key = requireKey(input.key);
  return db().transaction(async (tx) => {
    const item = await requireItem(tx, input.insumoId);
    await lockInsumos(tx, [item.id]);
    const before = computeStock(await loadLedger(tx, item.id));
    if (!before.configured) throw new OrdersValidationError("Cargá primero el stock inicial de este insumo: un ajuste necesita un stock de partida.");
    const m = await insertMovement(tx, { insumoId: item.id, kind: "AJUSTE_MANUAL", delta: d.value, occurredOn: fecha, key: `ajuste:${key}`, actor, note: reason.value });
    if (m.created) await audit(tx, actor, { action: "AJUSTE_MANUAL", insumoId: item.id, targetId: m.id, before: { stock: before.stock }, after: { delta: d.value, stock: (before.stock ?? 0) + d.value, fecha }, reason: reason.value });
    await refreshInsumoAlert(tx, item.id);
    return rowFor(tx, item.id);
  });
}

/** Stock mínimo y/o unidad de medida del insumo (auditado). Cambiar el mínimo puede abrir o cerrar la alerta. */
export async function updateStockConfig(actor: InsumoActor, insumoId: string, patch: { minStock?: unknown; unit?: unknown }): Promise<StockRowView> {
  assertAdmin(actor);
  const set: Partial<typeof insumoItems.$inferInsert> = {};
  if (patch.minStock !== undefined) {
    const m = parseMinStock(patch.minStock);
    if (!m.ok) throw new OrdersValidationError(m.error);
    set.minStock = m.value;
  }
  if (patch.unit !== undefined) {
    const u = parseUnit(patch.unit);
    if (!u.ok) throw new OrdersValidationError(u.error);
    set.unit = u.value;
  }
  if (Object.keys(set).length === 0) throw new OrdersValidationError("No hay cambios para guardar.");
  return db().transaction(async (tx) => {
    const item = await requireItem(tx, insumoId);
    await lockInsumos(tx, [item.id]);
    await tx.update(insumoItems).set({ ...set, updatedBy: actor.email, updatedAt: new Date() }).where(eq(insumoItems.id, item.id));
    await audit(tx, actor, { action: "CONFIGURACION", insumoId: item.id, before: { minStock: item.minStock, unit: item.unit }, after: { minStock: set.minStock ?? item.minStock, unit: set.unit ?? item.unit } });
    await refreshInsumoAlert(tx, item.id);
    return rowFor(tx, item.id);
  });
}

/** Usado por el catálogo: al dar de baja / reactivar un insumo se recalcula su alerta (un insumo de baja no alerta). */
export async function refreshAlertAfterCatalogChange(insumoId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await lockInsumos(tx, [insumoId]);
    await refreshInsumoAlert(tx, insumoId);
  });
}
