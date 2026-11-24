/**
 * CAJAS GENUS — stock propio de cajas de Laboratorio Genus (migración 0087).
 *
 *  · Libro de movimientos persistente (`cajas_genus_movements`): STOCK_INICIAL, INGRESO (Depósito), EGRESO_ENTREGA / AJUSTE_ENTREGA (automáticos por la
 *    entrega final al cliente), AJUSTE_MANUAL. Nunca se borra: se anula (con motivo y auditoría). STOCK ACTUAL = stock inicial + ingresos − egresos ± ajustes
 *    registrados DESPUÉS del stock inicial (ver `rules.computeStock`).
 *  · Registro canónico de la entrega final: cada fila ACTIVA de `work_item_delivery_lines` de un sector que entrega producto terminado (Envasado / Codificado).
 *    Es el mismo registro que usa Facturación («ENTREGA REGISTRADA»); las entregas internas entre sectores NO son líneas (viven en las transferencias a Codificado).
 *    `syncDeliveryLine` recalcula, a partir del estado ACTUAL de la línea, cuántas cajas corresponden y registra SOLO la diferencia contra lo ya descontado:
 *    alta → egreso; edición → diferencia; anulación → reversión; ocultar del historial no cambia la línea → no toca el stock; replay → sin movimiento.
 *  · Todo bajo bloqueo por línea (advisory lock) y dentro de la transacción de la entrega (en un savepoint: una falla acá NUNCA frena la entrega real).
 *  · Alerta de stock crítico (≤ umbral, por defecto 300): estado/episodio en `cajas_genus_config`; una sola notificación por episodio.
 */
import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { cajasGenusAudit, cajasGenusClientSettings, cajasGenusConfig, cajasGenusLineReview, cajasGenusMovements, osNotifications } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import { uuidFromKey } from "@/lib/planning/circuit/movements";
import type { SectorId } from "@/types/operational/sector";
import { canAdministerCajas, canRegisterIngreso, canViewCajasReports, canViewIngresos } from "./rbac";
import {
  FINAL_DELIVERY_SECTORS,
  alertDecision,
  boxClientKey,
  classifyClient,
  computeStock,
  criticalMessage,
  decideEgress,
  egressDiff,
  ingresoTotal,
  isIsoDate,
  periodStart,
  runningBalance,
  type CajasMovementKind,
  type ClientSettingLite,
  type LedgerRow,
  type Period,
  type StockSummary,
} from "./rules";

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- las transacciones de los servicios de entregas están tipadas como `any`
type AnyTx = Tx | any;

export type CajasActor = { email: string; sector: SectorId; displayName?: string | null };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

function assertDb() {
  if (!isDatabaseConfigured()) throw new OrdersValidationError("Las cajas Genus necesitan la base de datos configurada: en modo demostración no se registran movimientos.");
}

// ───────────────────────── Piezas de bajo nivel (dentro de una transacción) ─────────────────────────

async function getConfig(tx: AnyTx, lock = false) {
  const q = tx.select().from(cajasGenusConfig).where(eq(cajasGenusConfig.id, "main")).limit(1);
  const [row] = lock ? await q.for("update") : await q;
  if (row) return row as typeof cajasGenusConfig.$inferSelect;
  await tx.insert(cajasGenusConfig).values({ id: "main" }).onConflictDoNothing();
  const [again] = await tx.select().from(cajasGenusConfig).where(eq(cajasGenusConfig.id, "main")).limit(1);
  return again as typeof cajasGenusConfig.$inferSelect;
}

async function loadLedger(tx: AnyTx): Promise<LedgerRow[]> {
  const rows = await tx
    .select({ id: cajasGenusMovements.id, seq: cajasGenusMovements.seq, kind: cajasGenusMovements.kind, delta: cajasGenusMovements.delta, status: cajasGenusMovements.status, occurredOn: cajasGenusMovements.occurredOn, clientName: cajasGenusMovements.clientName })
    .from(cajasGenusMovements);
  return rows.map((r: { id: string; seq: number | string; kind: string; delta: number; status: string; occurredOn: string; clientName: string | null }) => ({ ...r, seq: Number(r.seq), kind: r.kind as CajasMovementKind }));
}

async function audit(tx: AnyTx, actor: { email: string; sector: string }, action: string, targetId: string | null, before: unknown, after: unknown, reason?: string | null) {
  await tx.insert(cajasGenusAudit).values({ action, targetId, before: (before ?? null) as never, after: (after ?? null) as never, reason: reason ?? null, actorEmail: actor.email, actorSector: actor.sector });
}

/**
 * Recalcula el estado de la alerta con el stock REAL del libro. Una notificación por episodio crítico (el id sale del número de episodio): mientras el
 * stock siga ≤ umbral no se repite; al superar el umbral se desactiva y, si vuelve a bajar, se abre un episodio nuevo.
 */
export async function refreshAlert(tx: AnyTx): Promise<{ state: "NORMAL" | "CRITICO"; stock: number | null; notified: boolean }> {
  const cfg = await getConfig(tx, true);
  const summary = computeStock(await loadLedger(tx));
  const d = alertDecision({ configured: summary.configured, stock: summary.stock, threshold: cfg.lowStockThreshold, state: cfg.alertState === "CRITICO" ? "CRITICO" : "NORMAL" });
  if (d.next !== cfg.alertState || d.notify) {
    const episode = d.notify ? cfg.alertEpisode + 1 : cfg.alertEpisode;
    await tx
      .update(cajasGenusConfig)
      .set({ alertState: d.next, alertEpisode: episode, alertSince: d.next === "CRITICO" ? (d.notify ? new Date() : (cfg.alertSince ?? new Date())) : null, updatedAt: new Date() })
      .where(eq(cajasGenusConfig.id, "main"));
    if (d.notify && summary.stock != null) {
      await tx
        .insert(osNotifications)
        .values({
          id: uuidFromKey(`cajas-genus:critico:${episode}`),
          kind: "cajas_genus_critico",
          title: "STOCK CRÍTICO DE CAJAS GENUS",
          message: criticalMessage(summary.stock),
          sectors: ["ADMINISTRACION"],
          href: "/cajas-genus",
          readBy: [],
          dismissedBy: [],
          deletedBy: [],
        })
        .onConflictDoNothing();
    }
  }
  return { state: d.next, stock: summary.stock, notified: d.notify };
}

async function insertMovement(
  tx: AnyTx,
  m: { kind: CajasMovementKind; delta: number; occurredOn: string; key: string; actor: { email: string; sector: string }; bultos?: number; cantidad?: number; lineId?: string; workItemId?: string | null; clientKey?: string | null; clientName?: string | null; detail?: unknown; note?: string | null }
): Promise<{ id: string; created: boolean }> {
  const [row] = await tx
    .insert(cajasGenusMovements)
    .values({
      kind: m.kind,
      delta: m.delta,
      occurredOn: m.occurredOn,
      idempotencyKey: m.key,
      bultos: m.bultos ?? null,
      cantidadPorBulto: m.cantidad ?? null,
      deliveryLineId: m.lineId ?? null,
      workItemId: m.workItemId ?? null,
      clientKey: m.clientKey ?? null,
      clientName: m.clientName ?? null,
      detail: (m.detail ?? {}) as never,
      note: m.note ?? null,
      createdBy: m.actor.email,
      createdBySector: m.actor.sector,
    })
    .onConflictDoNothing()
    .returning({ id: cajasGenusMovements.id });
  if (row) return { id: row.id as string, created: true };
  const [existing] = await tx.select({ id: cajasGenusMovements.id }).from(cajasGenusMovements).where(eq(cajasGenusMovements.idempotencyKey, m.key)).limit(1);
  return { id: existing.id as string, created: false };
}

// ───────────────────────── Clientes ─────────────────────────

async function loadSettings(tx: AnyTx): Promise<Map<string, ClientSettingLite & { displayName: string; portalClientId: string | null }>> {
  const rows = await tx.select().from(cajasGenusClientSettings);
  return new Map(rows.map((r: typeof cajasGenusClientSettings.$inferSelect) => [r.clientKey, { clientKey: r.clientKey, usesOwnBoxes: r.usesOwnBoxes, displayName: r.displayName, portalClientId: r.portalClientId }]));
}

/** Claves del cliente del maestro (nombre + alias) al que apunta este nombre de entrega, si el maestro lo conoce. */
async function masterKeysFor(tx: AnyTx, rawClient: string): Promise<{ keys: string[]; portalClientId: string | null }> {
  const fold = rawClient.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const res = await tx.execute(sql`
    select c.id::text as id, c.display_name as name, coalesce(array_agg(a2.name_key) filter (where a2.name_key is not null), '{}') as keys
      from portal_client_aliases a
      join portal_clients c on c.id = a.client_id
      left join portal_client_aliases a2 on a2.client_id = c.id and a2.removed_at is null
     where a.name_key = ${fold} and a.removed_at is null
     group by c.id, c.display_name limit 1`);
  const r = (res.rows as Array<{ id: string; name: string; keys: string[] }>)[0];
  if (!r) return { keys: [], portalClientId: null };
  const keys = [r.name, ...(r.keys ?? [])].map((k) => boxClientKey(k)).filter((k): k is string => Boolean(k));
  return { keys: [...new Set(keys)], portalClientId: r.id };
}

// ───────────────────────── Sincronización de una entrega ─────────────────────────

export type SyncResult = { lineId: string; tracked: boolean; desired: number; already: number; moved: number; review: string | null; exempt: string | null };

type LineRow = { id: string; status: string; packing_groups: unknown; source_sector: string; created_at: Date | string; work_item_id: string; client: string | null; deleted: boolean };

/**
 * Deja el libro de cajas de UNA entrega final consistente con su estado actual. Idempotente y segura ante concurrencia.
 * Se llama en el alta, edición y anulación de entregas; también la barre `reconcileCajas`.
 */
export async function syncDeliveryLine(tx: AnyTx, lineId: string, actor: { email: string; sector: string } = { email: "sistema", sector: "SISTEMA" }): Promise<SyncResult | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cajas-genus-line:${lineId}`}))`);
  const lineRes = await tx.execute(sql`
    select l.id::text as id, l.status, l.packing_groups, l.source_sector, l.created_at, l.work_item_id::text as work_item_id,
           coalesce(nullif(btrim(w.client), ''), nullif(btrim(d.client), '')) as client, (w.deleted_at is not null) as deleted
      from work_item_delivery_lines l
      join work_items w on w.id = l.work_item_id
      left join work_item_deliveries d on d.id = l.delivery_id
     where l.id = ${lineId}::uuid`);
  const line = (lineRes.rows as LineRow[])[0];
  if (!line) return null;
  const cfg = await getConfig(tx);
  const settings = await loadSettings(tx);
  const master = line.client ? await masterKeysFor(tx, line.client) : { keys: [], portalClientId: null };
  const client = classifyClient(line.client, settings, master.keys);
  const decision = decideEgress({
    lineStatus: line.status,
    workItemDeleted: Boolean(line.deleted),
    sourceSector: line.source_sector,
    lineCreatedAt: new Date(line.created_at),
    trackingStartedAt: cfg.trackingStartedAt,
    packingGroups: line.packing_groups,
    client,
  });

  const prior = await tx
    .select({ kind: cajasGenusMovements.kind, delta: cajasGenusMovements.delta })
    .from(cajasGenusMovements)
    .where(and(eq(cajasGenusMovements.deliveryLineId, lineId), eq(cajasGenusMovements.status, "ACTIVO")));
  const nMovements = prior.length;
  const already = -prior.reduce((a: number, m: { delta: number }) => a + m.delta, 0);
  const clientName = line.client;
  const base = { lineId, workItemId: line.work_item_id, clientKey: client.status === "SIN_CLIENTE" ? null : client.key, clientName, actor };

  let desired = decision.cajas;
  // Pendiente de revisión: no se inventa ni se revierte lo ya descontado; queda anotado para Administración.
  if (decision.review) {
    if (already > 0) desired = already;
    await tx
      .insert(cajasGenusLineReview)
      .values({ deliveryLineId: lineId, workItemId: line.work_item_id, reason: decision.review, clientName, detail: { sourceSector: line.source_sector } as never })
      .onConflictDoUpdate({ target: cajasGenusLineReview.deliveryLineId, set: { reason: decision.review, clientName, resolvedAt: null, resolvedBy: null, resolution: null, updatedAt: new Date() } });
  } else {
    await tx
      .update(cajasGenusLineReview)
      .set({ resolvedAt: new Date(), resolvedBy: actor.email, resolution: "AUTOMATICA", updatedAt: new Date() })
      .where(and(eq(cajasGenusLineReview.deliveryLineId, lineId), isNull(cajasGenusLineReview.resolvedAt)));
  }

  let moved = 0;
  const diff = egressDiff(already, desired);
  if (diff) {
    const m = await insertMovement(tx, {
      ...base,
      kind: diff.kind,
      delta: diff.delta,
      occurredOn: today(),
      key: `line:${lineId}:n${nMovements + 1}`,
      detail: { cajas: desired, anterior: already, grupos: decision.groups, motivo: decision.exempt },
    });
    if (m.created) moved = diff.delta;
  } else if (decision.tracked && nMovements === 0 && !decision.review && decision.exempt !== "ENTREGA_ANULADA") {
    // Entrega que se sigue pero no descuenta (cliente con cajas propias): queda un renglón en 0 para que el historial lo muestre.
    await insertMovement(tx, { ...base, kind: "EGRESO_ENTREGA", delta: 0, occurredOn: today(), key: `line:${lineId}:n1`, detail: { cajas: 0, motivo: decision.exempt } });
  }
  if (moved !== 0) await refreshAlert(tx);
  return { lineId, tracked: decision.tracked, desired, already, moved, review: decision.review, exempt: decision.exempt };
}

/**
 * Gancho para los flujos de entrega: corre en un SAVEPOINT dentro de la transacción de la entrega. Si algo falla acá se registra y la entrega
 * real sigue su curso; la barrida (`reconcileCajas`) lo recupera después.
 */
export async function syncDeliveryLineSafe(tx: AnyTx, lineId: string | null | undefined, actor?: { email: string; sector: string }): Promise<void> {
  if (!lineId) return;
  try {
    await tx.transaction(async (sp: AnyTx) => {
      await syncDeliveryLine(sp, lineId, actor);
    });
  } catch (error) {
    console.error("[cajas-genus] no se pudo sincronizar la entrega (la entrega ya quedó registrada)", { lineId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function syncWorkItemLinesSafe(tx: AnyTx, workItemId: string, actor?: { email: string; sector: string }): Promise<void> {
  try {
    const rows = await tx.execute(sql`select id::text as id from work_item_delivery_lines where work_item_id = ${workItemId}::uuid`);
    for (const r of rows.rows as Array<{ id: string }>) await syncDeliveryLineSafe(tx, r.id, actor);
  } catch (error) {
    console.error("[cajas-genus] no se pudieron listar las entregas del trabajo", { workItemId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Barrida explícita e idempotente: recalcula las entregas posteriores al inicio del seguimiento (las anteriores NO se descuentan solas). Con `onlyMissing`
 * revisa solo las que no tienen movimiento ni pendiente (red de seguridad liviana). `clientKey` limita a un cliente (reclasificación).
 */
export async function reconcileCajas(actor: CajasActor | null, opts: { onlyMissing?: boolean; clientKey?: string; limit?: number } = {}): Promise<{ checked: number; moved: number; reviews: number }> {
  assertDb();
  if (actor && !canAdministerCajas(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección pueden recalcular las cajas.");
  const db = getDb();
  const cfg = await getConfig(db);
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const missing = opts.onlyMissing
    ? sql`and not exists (select 1 from cajas_genus_movements m where m.delivery_line_id = l.id) and not exists (select 1 from cajas_genus_line_review r where r.delivery_line_id = l.id and r.resolved_at is null)`
    : sql``;
  const res = await db.execute(sql`
    select l.id::text as id, coalesce(nullif(btrim(w.client), ''), nullif(btrim(d.client), '')) as client
      from work_item_delivery_lines l
      join work_items w on w.id = l.work_item_id
      left join work_item_deliveries d on d.id = l.delivery_id
     where l.created_at >= ${cfg.trackingStartedAt.toISOString()}::timestamptz
       and l.source_sector in (${sql.join(FINAL_DELIVERY_SECTORS.map((s) => sql`${s}`), sql`, `)}) ${missing}
     order by l.created_at desc limit ${limit}`);
  let ids = (res.rows as Array<{ id: string; client: string | null }>);
  if (opts.clientKey) ids = ids.filter((r) => boxClientKey(r.client) === opts.clientKey);
  const by = actor ? { email: actor.email, sector: actor.sector } : { email: "sistema", sector: "SISTEMA" };
  let moved = 0;
  let reviews = 0;
  for (const r of ids) {
    const out = await db.transaction(async (tx) => syncDeliveryLine(tx, r.id, by));
    if (out) {
      moved += out.moved !== 0 ? 1 : 0;
      reviews += out.review ? 1 : 0;
    }
  }
  return { checked: ids.length, moved, reviews };
}

// ───────────────────────── Ingresos (Depósito) ─────────────────────────

export type IngresoRowInput = { fecha?: string; bultos: unknown; cantidad: unknown; key?: string };
export type IngresoResult = { id: string; fecha: string; bultos: number; cantidad: number; total: number; replayed: boolean };

/** Registra uno o varios ingresos de cajas en UNA transacción. El total se calcula siempre acá (BULTOS × CANTIDAD); reintentos con la misma clave no duplican. */
export async function registerIngresos(actor: CajasActor, rows: IngresoRowInput[], batchKey?: string): Promise<{ results: IngresoResult[]; stock: StockSummary }> {
  assertDb();
  if (!canRegisterIngreso(actor.sector)) throw new OrdersForbiddenError("Solo Depósito registra ingresos de Cajas Genus.");
  if (!Array.isArray(rows) || rows.length === 0) throw new OrdersValidationError("Cargá al menos un ingreso.");
  if (rows.length > 100) throw new OrdersValidationError("Demasiados ingresos en una sola operación (máx. 100).");
  const parsed = rows.map((r, i) => {
    const fecha = r.fecha && String(r.fecha).trim() ? String(r.fecha).trim() : today();
    if (!isIsoDate(fecha)) throw new OrdersValidationError(`Fila ${i + 1}: fecha inválida.`);
    const t = ingresoTotal(r.bultos, r.cantidad);
    if (!t.ok) throw new OrdersValidationError(`Fila ${i + 1}: ${t.error}`);
    const key = (r.key && String(r.key).trim()) || (batchKey ? `${String(batchKey).trim()}:${i}` : "");
    if (!key) throw new OrdersValidationError("Falta la clave de la operación (evita duplicados al reintentar).");
    return { fecha, ...t, key: `ingreso:${key}` };
  });
  const db = getDb();
  return db.transaction(async (tx) => {
    const results: IngresoResult[] = [];
    for (const p of parsed) {
      const m = await insertMovement(tx, { kind: "INGRESO", delta: p.total, occurredOn: p.fecha, key: p.key, actor, bultos: p.bultos, cantidad: p.cantidad, clientName: null, detail: { insumo: "CAJAS GENUS", total: p.total } });
      if (m.created) await audit(tx, actor, "INGRESO_REGISTRADO", m.id, null, { fecha: p.fecha, bultos: p.bultos, cantidad: p.cantidad, total: p.total });
      results.push({ id: m.id, fecha: p.fecha, bultos: p.bultos, cantidad: p.cantidad, total: p.total, replayed: !m.created });
    }
    await refreshAlert(tx);
    return { results, stock: computeStock(await loadLedger(tx)) };
  });
}

// ───────────────────────── Administración: stock inicial, ajustes, anulaciones ─────────────────────────

function assertAdmin(actor: CajasActor) {
  if (!canAdministerCajas(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección pueden hacer esta acción sobre las cajas Genus.");
}

/** Define el stock real de partida (conteo físico). Movimiento auditado; el vigente es el último. Desde acá cuentan los ingresos y egresos posteriores. */
export async function setInitialStock(actor: CajasActor, input: { quantity: unknown; fecha?: string; note?: string; key: string }): Promise<StockSummary> {
  assertDb();
  assertAdmin(actor);
  const q = Number(input.quantity);
  if (!Number.isInteger(q) || q < 0) throw new OrdersValidationError("El stock inicial debe ser un número entero de cero o más.");
  const fecha = input.fecha && input.fecha.trim() ? input.fecha.trim() : today();
  if (!isIsoDate(fecha)) throw new OrdersValidationError("Fecha inválida.");
  if (!input.key?.trim()) throw new OrdersValidationError("Falta la clave de la operación.");
  return getDb().transaction(async (tx) => {
    const before = computeStock(await loadLedger(tx));
    const m = await insertMovement(tx, { kind: "STOCK_INICIAL", delta: q, occurredOn: fecha, key: `inicial:${input.key.trim()}`, actor, note: input.note?.trim() || null, detail: { stockAnterior: before.stock } });
    if (m.created) await audit(tx, actor, "STOCK_INICIAL", m.id, { stock: before.stock }, { stock: q, fecha }, input.note ?? null);
    await refreshAlert(tx);
    return computeStock(await loadLedger(tx));
  });
}

/** Ajuste manual (± cajas) con motivo obligatorio: corrige diferencias de inventario sin tocar el historial. */
export async function manualAdjust(actor: CajasActor, input: { delta: unknown; reason: string; fecha?: string; key: string }): Promise<StockSummary> {
  assertDb();
  assertAdmin(actor);
  const d = Number(input.delta);
  if (!Number.isInteger(d) || d === 0) throw new OrdersValidationError("El ajuste debe ser un número entero distinto de cero (positivo suma, negativo resta).");
  if (!input.reason?.trim()) throw new OrdersValidationError("El motivo del ajuste es obligatorio.");
  const fecha = input.fecha && input.fecha.trim() ? input.fecha.trim() : today();
  if (!isIsoDate(fecha)) throw new OrdersValidationError("Fecha inválida.");
  if (!input.key?.trim()) throw new OrdersValidationError("Falta la clave de la operación.");
  return getDb().transaction(async (tx) => {
    const m = await insertMovement(tx, { kind: "AJUSTE_MANUAL", delta: d, occurredOn: fecha, key: `ajuste:${input.key.trim()}`, actor, note: input.reason.trim() });
    if (m.created) await audit(tx, actor, "AJUSTE_MANUAL", m.id, null, { delta: d, fecha }, input.reason.trim());
    await refreshAlert(tx);
    return computeStock(await loadLedger(tx));
  });
}

/** Anula un ingreso, un ajuste manual o un stock inicial (con motivo). Los egresos por entrega no se anulan acá: salen de la entrega. */
export async function voidMovement(actor: CajasActor, id: string, reason: string): Promise<StockSummary> {
  assertDb();
  assertAdmin(actor);
  if (!reason?.trim()) throw new OrdersValidationError("El motivo de la anulación es obligatorio.");
  return getDb().transaction(async (tx) => {
    const [m] = await tx.select().from(cajasGenusMovements).where(eq(cajasGenusMovements.id, id)).for("update");
    if (!m) throw new OrdersNotFoundError("No se encontró el movimiento.");
    if (m.status !== "ACTIVO") throw new OrdersValidationError("El movimiento ya estaba anulado.");
    if (m.kind === "EGRESO_ENTREGA" || m.kind === "AJUSTE_ENTREGA") throw new OrdersValidationError("Los egresos por entrega se corrigen desde la entrega (edición o anulación): no se anulan a mano.");
    await tx.update(cajasGenusMovements).set({ status: "ANULADO", voidedAt: new Date(), voidedBy: actor.email, voidReason: reason.trim() }).where(eq(cajasGenusMovements.id, id));
    await audit(tx, actor, "MOVIMIENTO_ANULADO", id, { kind: m.kind, delta: m.delta, status: m.status }, { status: "ANULADO" }, reason.trim());
    await refreshAlert(tx);
    return computeStock(await loadLedger(tx));
  });
}

// ───────────────────────── Consultas ─────────────────────────

export type CajasSummary = StockSummary & {
  threshold: number;
  alertState: "NORMAL" | "CRITICO";
  /** Alerta visible: stock configurado y ≤ umbral (0 o negativo incluidos). */
  critical: boolean;
  pendingReviews: number;
  trackingStartedAt: string;
  negative: boolean;
};

export async function getSummary(actor: CajasActor): Promise<CajasSummary> {
  assertDb();
  if (!canViewIngresos(actor.sector)) throw new OrdersForbiddenError("No tenés permiso para ver las cajas Genus.");
  const db = getDb();
  const cfg = await getConfig(db);
  const s = computeStock(await loadLedger(db));
  const [pend] = await db.select({ n: sql<number>`count(*)::int` }).from(cajasGenusLineReview).where(isNull(cajasGenusLineReview.resolvedAt));
  const critical = s.configured && s.stock != null && s.stock <= cfg.lowStockThreshold;
  return { ...s, threshold: cfg.lowStockThreshold, alertState: critical ? "CRITICO" : "NORMAL", critical, pendingReviews: Number(pend?.n ?? 0), trackingStartedAt: cfg.trackingStartedAt.toISOString(), negative: s.stock != null && s.stock < 0 };
}

export type MovementView = {
  id: string; seq: number; kind: CajasMovementKind; delta: number; fecha: string; at: string; status: string;
  bultos: number | null; cantidad: number | null; clientName: string | null; deliveryLineId: string | null; workItemId: string | null;
  note: string | null; createdBy: string; createdBySector: string; saldo: number | null; voidReason: string | null; voidedBy: string | null; detail: unknown;
};
export type MovementFilters = { from?: string; to?: string; client?: string; kind?: string; includeVoided?: boolean };

export async function listMovements(actor: CajasActor, f: MovementFilters = {}): Promise<{ items: MovementView[]; summary: CajasSummary }> {
  assertDb();
  if (!canViewIngresos(actor.sector)) throw new OrdersForbiddenError("No tenés permiso para ver las cajas Genus.");
  const adminView = canViewCajasReports(actor.sector);
  const db = getDb();
  const all = await db.select().from(cajasGenusMovements).orderBy(asc(cajasGenusMovements.seq));
  const ledger: LedgerRow[] = all.map((m) => ({ id: m.id, seq: Number(m.seq), kind: m.kind as CajasMovementKind, delta: m.delta, status: m.status, occurredOn: m.occurredOn as string, clientName: m.clientName }));
  const saldo = runningBalance(ledger);
  const ck = f.client ? boxClientKey(f.client) : null;
  const items = all
    .filter((m) => (adminView ? true : m.kind === "INGRESO")) // Depósito solo ve ingresos
    .filter((m) => (f.includeVoided ? true : m.status === "ACTIVO"))
    .filter((m) => (f.from ? (m.occurredOn as string) >= f.from : true) && (f.to ? (m.occurredOn as string) <= f.to : true))
    .filter((m) => (f.kind && f.kind !== "TODOS" ? m.kind === f.kind : true))
    .filter((m) => (ck ? boxClientKey(m.clientName) === ck : true))
    .map<MovementView>((m) => ({
      id: m.id, seq: Number(m.seq), kind: m.kind as CajasMovementKind, delta: m.delta, fecha: m.occurredOn as string, at: m.createdAt.toISOString(), status: m.status,
      bultos: m.bultos, cantidad: m.cantidadPorBulto, clientName: m.clientName, deliveryLineId: m.deliveryLineId, workItemId: m.workItemId,
      note: m.note, createdBy: m.createdBy, createdBySector: m.createdBySector, saldo: saldo.get(Number(m.seq)) ?? null, voidReason: m.voidReason, voidedBy: m.voidedBy, detail: m.detail,
    }))
    .sort((a, b) => b.seq - a.seq);
  return { items, summary: await getSummary(actor) };
}

export type CajasReport = {
  porCliente: Array<{ cliente: string; cajas: number; entregas: number }>;
  porPeriodo: Array<{ periodo: string; ingresos: number; egresos: number }>;
  period: Period;
};

/** Consumo de cajas (egresos netos por entrega) por cliente y serie diaria/semanal/mensual, respetando los filtros. */
export async function report(actor: CajasActor, f: MovementFilters & { period?: Period } = {}): Promise<CajasReport> {
  if (!canViewCajasReports(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección ven los reportes de cajas.");
  const { items } = await listMovements(actor, { ...f, includeVoided: false });
  const period = f.period ?? "dia";
  const cli = new Map<string, { cajas: number; lines: Set<string> }>();
  const per = new Map<string, { ingresos: number; egresos: number }>();
  for (const m of items) {
    const key = periodStart(m.fecha, period);
    const slot = per.get(key) ?? { ingresos: 0, egresos: 0 };
    if (m.kind === "INGRESO") slot.ingresos += m.delta;
    if (m.kind === "EGRESO_ENTREGA" || m.kind === "AJUSTE_ENTREGA") {
      slot.egresos += -m.delta;
      const name = m.clientName?.trim() || "(sin cliente)";
      const c = cli.get(name) ?? { cajas: 0, lines: new Set<string>() };
      c.cajas += -m.delta;
      if (m.deliveryLineId) c.lines.add(m.deliveryLineId);
      cli.set(name, c);
    }
    per.set(key, slot);
  }
  return {
    period,
    porCliente: [...cli.entries()].map(([cliente, v]) => ({ cliente, cajas: v.cajas, entregas: v.lines.size })).sort((a, b) => b.cajas - a.cajas),
    porPeriodo: [...per.entries()].map(([periodo, v]) => ({ periodo, ...v })).sort((a, b) => a.periodo.localeCompare(b.periodo)),
  };
}

export type PendingView = { deliveryLineId: string; workItemId: string | null; reason: string; client: string | null; product: string | null; orderNumber: string | null; quantity: number | null; deliveredAt: string | null; since: string };
export async function listPending(actor: CajasActor): Promise<PendingView[]> {
  assertDb();
  if (!canViewCajasReports(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección ven los pendientes de revisión.");
  const res = await getDb().execute(sql`
    select r.delivery_line_id::text as id, r.work_item_id::text as wid, r.reason, coalesce(r.client_name, w.client) as client, w.product, w.order_number,
           l.quantity::float8 as quantity, l.actual_delivered_at, r.created_at
      from cajas_genus_line_review r
      left join work_item_delivery_lines l on l.id = r.delivery_line_id
      left join work_items w on w.id = r.work_item_id
     where r.resolved_at is null order by r.created_at desc limit 200`);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    deliveryLineId: String(r.id), workItemId: r.wid ? String(r.wid) : null, reason: String(r.reason), client: r.client ? String(r.client) : null, product: r.product ? String(r.product) : null,
    orderNumber: r.order_number ? String(r.order_number) : null, quantity: r.quantity == null ? null : Number(r.quantity), deliveredAt: r.actual_delivered_at ? new Date(String(r.actual_delivered_at)).toISOString() : null, since: new Date(String(r.created_at)).toISOString(),
  }));
}

// ───────────────────────── Clientes con cajas propias ─────────────────────────

export type ClientSettingView = { clientKey: string; displayName: string; usesOwnBoxes: boolean; portalClientId: string | null; source: string; updatedBy: string | null; updatedAt: string };
export type ClientVariantHint = { name: string; key: string; similarTo: string };

export async function listClientSettings(actor: CajasActor): Promise<{ items: ClientSettingView[]; variants: ClientVariantHint[]; known: Array<{ name: string; key: string; usesOwnBoxes: boolean; configured: boolean }> }> {
  assertDb();
  if (!canViewCajasReports(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección ven la configuración de clientes.");
  const db = getDb();
  const settings = await loadSettings(db);
  // Vincula con el maestro de clientes (ids reales) los que todavía no tienen vínculo: solo por clave idéntica (nunca por parecido).
  const master = await db.execute(sql`select c.id::text as id, c.display_name as name from portal_clients c`);
  const masterByKey = new Map<string, { id: string; name: string }>();
  for (const r of master.rows as Array<{ id: string; name: string }>) {
    const k = boxClientKey(r.name);
    if (k) masterByKey.set(k, r);
  }
  for (const s of settings.values()) {
    const m = masterByKey.get(s.clientKey);
    if (m && s.portalClientId !== m.id) {
      await db.update(cajasGenusClientSettings).set({ portalClientId: m.id }).where(eq(cajasGenusClientSettings.clientKey, s.clientKey));
      s.portalClientId = m.id;
    }
  }
  const rows = await db.select().from(cajasGenusClientSettings).orderBy(asc(cajasGenusClientSettings.displayName));
  const names = await db.execute(sql`
    select name, count(*)::int as n from (
      select btrim(client) as name from work_items where client is not null and btrim(client) <> '' and deleted_at is null
      union all select btrim(cliente) from production_pedidos where cliente is not null and btrim(cliente) <> '' and deleted_at is null
      union all select display_name from portal_clients
    ) x group by name order by n desc limit 400`);
  const known = new Map<string, { name: string; key: string; usesOwnBoxes: boolean; configured: boolean }>();
  const seed = [...settings.values()].filter((s) => s.usesOwnBoxes);
  const variants: ClientVariantHint[] = [];
  for (const r of names.rows as Array<{ name: string }>) {
    const key = boxClientKey(r.name);
    if (!key || known.has(key)) continue;
    const st = settings.get(key);
    known.set(key, { name: r.name, key, usesOwnBoxes: Boolean(st?.usesOwnBoxes), configured: Boolean(st) });
    if (!st) {
      // Posible variante de un cliente con cajas propias (contiene o está contenido): se sugiere revisar, NUNCA se aplica sola.
      const near = seed.find((s) => key !== s.clientKey && (key.includes(s.clientKey) || s.clientKey.includes(key)) && Math.min(key.length, s.clientKey.length) >= 3);
      if (near) variants.push({ name: r.name, key, similarTo: near.displayName });
    }
  }
  return {
    items: rows.map((r) => ({ clientKey: r.clientKey, displayName: r.displayName, usesOwnBoxes: r.usesOwnBoxes, portalClientId: r.portalClientId, source: r.source, updatedBy: r.updatedBy, updatedAt: r.updatedAt.toISOString() })),
    variants,
    known: [...known.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Cambia «UTILIZA CAJAS PROPIAS» de un cliente (auditado). Afecta las entregas FUTURAS; el historial solo cambia con «reclasificar» (movimientos auditados). */
export async function setClientOwnBoxes(actor: CajasActor, input: { name: string; usesOwnBoxes: boolean }): Promise<ClientSettingView> {
  assertDb();
  assertAdmin(actor);
  const key = boxClientKey(input.name);
  if (!key) throw new OrdersValidationError("Indicá el nombre del cliente.");
  const displayName = input.name.replace(/\s+/g, " ").trim();
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(cajasGenusClientSettings).where(eq(cajasGenusClientSettings.clientKey, key)).limit(1);
    const [row] = await tx
      .insert(cajasGenusClientSettings)
      .values({ clientKey: key, displayName: before?.displayName ?? displayName, usesOwnBoxes: Boolean(input.usesOwnBoxes), source: "ADMIN", updatedBy: actor.email })
      .onConflictDoUpdate({ target: cajasGenusClientSettings.clientKey, set: { usesOwnBoxes: Boolean(input.usesOwnBoxes), updatedBy: actor.email, updatedAt: new Date() } })
      .returning();
    await audit(tx, actor, "CLIENTE_CAJAS_PROPIAS", key, before ? { usesOwnBoxes: before.usesOwnBoxes } : null, { usesOwnBoxes: Boolean(input.usesOwnBoxes), displayName: row.displayName });
    return { clientKey: row.clientKey, displayName: row.displayName, usesOwnBoxes: row.usesOwnBoxes, portalClientId: row.portalClientId, source: row.source, updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString() };
  });
}

/** Reaplica la clasificación vigente a las entregas ya registradas de un cliente (posteriores al inicio del seguimiento): movimientos de diferencia auditados. */
export async function reclassifyClient(actor: CajasActor, name: string): Promise<{ checked: number; moved: number }> {
  assertDb();
  assertAdmin(actor);
  const key = boxClientKey(name);
  if (!key) throw new OrdersValidationError("Indicá el nombre del cliente.");
  const out = await reconcileCajas(actor, { clientKey: key, limit: 5000 });
  await audit(getDb(), actor, "CLIENTE_RECLASIFICADO", key, null, out);
  return { checked: out.checked, moved: out.moved };
}

export async function listAudit(actor: CajasActor, limit = 100) {
  assertDb();
  if (!canViewCajasReports(actor.sector)) throw new OrdersForbiddenError("Solo Administración o Dirección ven la auditoría.");
  const rows = await getDb().select().from(cajasGenusAudit).orderBy(desc(cajasGenusAudit.createdAt)).limit(Math.min(limit, 500));
  return rows.map((r) => ({ id: r.id, action: r.action, targetId: r.targetId, before: r.before, after: r.after, reason: r.reason, actorEmail: r.actorEmail, actorSector: r.actorSector, at: r.createdAt.toISOString() }));
}
