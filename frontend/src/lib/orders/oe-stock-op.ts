/**
 * Descuento de stock de MP por una OE — servidor. Reutiliza los mecanismos existentes (no hay un segundo descuento):
 *  - `runMpInventoryOp`: transacción con candado de MP donde se leen y escriben los lotes de Stock MP;
 *  - el libro mayor por código (`applyOeConsumption` / `reverseOeConsumption`), en esa misma transacción;
 *  - el repositorio de órdenes, que también escribe en esa transacción (transacción ambiente).
 * O se confirma la entrega (estado de la OE + movimientos + lotes + auditoría) o no se confirma nada.
 *
 * Sin base de datos (pruebas unitarias) usa el inventario y el libro mayor en memoria, en el mismo orden.
 */
import "server-only";

import { isDatabaseConfigured } from "@/lib/db/client";
import type { InventoryActor, InventoryService } from "@/lib/inventory/inventory-service";
import type { MpStockRow } from "@/lib/inventory/types";
import { getMpStockLedger } from "@/lib/mp-stock/mp-stock-ledger";
import {
  buildOeConsumptionPlan,
  lotShortages,
  oePositionKey,
  type ConsumptionIssue,
  normMpCode,
  normMpLote,
  type ConsumptionLine,
  type LotShortage,
  type MpCatalogLot,
} from "@/lib/orders/oe-mp-consumption";
import type { OeMaterialRow, OrdersActor } from "@/lib/orders/types";
import { canAuthorizeOeMpShortage } from "@/lib/orders/rbac";
import { MpConsumptionIncompleteError, OrdersForbiddenError } from "@/lib/orders/types";

/** Sectores que pueden autorizar entregar una OE dejando stock de MP en negativo (con motivo). */
export const canAuthorizeNegativeMp = (sector: string) => canAuthorizeOeMpShortage(sector);

export type OeStockCtx = { inventory: InventoryService; catalog: MpCatalogLot[]; inventoryActor: InventoryActor };

const toCatalog = (rows: MpStockRow[]): MpCatalogLot[] =>
  rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    codigosAnteriores: r.codigosAnteriores,
    descripcion: r.descripcion,
    lote: r.lote,
    cantidadKg: r.cantidadKg,
    archived: r.archived,
    vencimiento: r.vencimiento,
    createdAt: r.createdAt,
    estadoManual: r.estadoStockManual,
    vencimientoEstadoManual: r.estadoVencimientoManual,
  }));

export async function runOeStockOp<T>(actor: OrdersActor, op: (ctx: OeStockCtx) => Promise<T>): Promise<T> {
  const inventoryActor: InventoryActor = {
    email: actor.email,
    sector: actor.sector as InventoryActor["sector"],
    displayName: actor.displayName ?? actor.email,
    isSuperadmin: false,
  };
  if (isDatabaseConfigured()) {
    const { runMpInventoryOp } = await import("@/lib/inventory/mp-planilla-db");
    return runMpInventoryOp(inventoryActor, ({ service, repo }) =>
      op({ inventory: service, catalog: toCatalog(repo.mpStock), inventoryActor })
    );
  }
  const { getInventoryService, memoryInventoryRepo } = await import("@/lib/inventory/get-inventory-service");
  return op({ inventory: getInventoryService(), catalog: toCatalog(memoryInventoryRepo.mpStock), inventoryActor });
}

/**
 * Fila de Stock MP de un movimiento de OE sin fila registrada (consumos de versiones anteriores de GENUS): la del lote
 * si es única; si no, la única fila del código. Si no hay una sola candidata, null (no se adivina).
 */
function legacyLotFor(catalog: MpCatalogLot[], codigo: string, lote: string): string | null {
  const code = normMpCode(codigo);
  const ofCode = catalog.filter(
    (l) => !l.archived && (normMpCode(l.codigo) === code || (l.codigosAnteriores ?? []).some((c) => normMpCode(c) === code))
  );
  const byLote = lote.trim() ? ofCode.filter((l) => normMpLote(l.lote) === normMpLote(lote)) : [];
  if (byLote.length === 1) return byLote[0]!.id;
  if (byLote.length === 0 && ofCode.length === 1) return ofCode[0]!.id;
  return null;
}

/** Consumo que NO se pudo descontar al entregar (datos incompletos o stock insuficiente): la entrega igual se registra. */
export type OeConsumptionPending = {
  issues: ConsumptionIssue[];
  shortages: LotShortage[];
};

export type OeConsumptionResult = {
  lines: ConsumptionLine[];
  applied: Array<{ codigo: string; lote: string; delta: number; lotId: string | null }>;
  lots: Array<{ lotId: string; codigo: string; lote: string; antes: number; despues: number }>;
  shortages: LotShortage[];
  negativeAuthorized: boolean;
};

/**
 * Valida y descuenta el consumo REAL de la OE. `commitOrder` actualiza la OE (dentro de la misma transacción) y
 * devuelve su nueva versión: solo se llama si todo está en orden.
 */
/** Kg que la OE ya tiene consumidos por (código|lote) según el libro mayor (para repartir sin mover consumos entre lotes). */
async function consumedBeforeOf(oeId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const p of (await getMpStockLedger().oeNetPositions(oeId)).values()) {
    const kg = Math.round(-p.net * 10000) / 10000;
    if (kg > 0) out.set(oePositionKey(p.codigo, p.lote), kg);
  }
  return out;
}

export async function consumeOeStock<O extends { version: number; status: string }>(
  ctx: OeStockCtx,
  actor: OrdersActor,
  params: {
    oeId: string;
    orderNumber: string;
    materials: OeMaterialRow[];
    /** Motivo opcional del stock negativo (solo informativo: ya NO se exige autorización ni motivo). */
    authorizeNegative?: { reason: string } | null;
    /** Producción/Dirección confirmando la entrega: solo vale si hay faltante de MP (stock que quedará negativo). */
    onlyToAuthorizeShortage?: boolean;
    /**
     * Entrega de Elaboración: la falta de datos de ALGUNA fila nunca bloquea. Se registra la entrega (`commitOrder`),
     * se descuenta todo lo identificable y las filas incompletas quedan pendientes de regularización (una sola vez,
     * sin cantidades inventadas). El stock insuficiente NO es un motivo de pendiente: el consumo real se descuenta
     * siempre y el saldo puede quedar negativo (se informa como advertencia).
     */
    soft?: boolean;
    commitOrder: (pending?: OeConsumptionPending) => Promise<O>;
  }
): Promise<{ order: O; result: OeConsumptionResult | null; pending: OeConsumptionPending | null }> {
  const ledger = getMpStockLedger();
  const plan = buildOeConsumptionPlan(params.materials, ctx.catalog, { consumedBefore: await consumedBeforeOf(params.oeId) });
  if (plan.issues.length && !params.soft) throw new MpConsumptionIncompleteError(plan.issues);

  const lotIdOf = (d: { codigo: string; lote: string; lotId: string | null }) => d.lotId ?? legacyLotFor(ctx.catalog, d.codigo, d.lote);

  // Stock: por fila de Stock MP y por código (cada uno contra su propio saldo). Solo informativo: nunca bloquea.
  let deltas = await ledger.planOeConsumptionDeltas(params.oeId, plan.lines);
  // Con filas incompletas no se compensa (devolver stock) lo de filas que dejaron de ser identificables: solo se suma consumo.
  if (plan.issues.length > 0) deltas = deltas.filter((d) => d.delta < 0);
  const withLots = deltas
    .map((d) => ({ ...d, lotId: lotIdOf(d) }))
    .filter((d): d is typeof d & { lotId: string } => Boolean(d.lotId));
  const shortages: LotShortage[] = lotShortages(withLots, ctx.catalog);
  const byCode = new Map<string, number>();
  for (const d of deltas) byCode.set(d.codigo, Math.round(((byCode.get(d.codigo) ?? 0) + d.delta) * 1000) / 1000);
  for (const [codigo, delta] of byCode) {
    if (delta >= 0) continue;
    const disponible = Number(((await ledger.getBalance(codigo))?.stockActual ?? 0).toFixed(4));
    if (disponible + delta < 0) {
      shortages.push({ codigo, lote: "", disponible, requerido: -delta, faltante: Number((-delta - disponible).toFixed(4)), tipo: "codigo" });
    }
  }
  if (params.onlyToAuthorizeShortage && shortages.length === 0) {
    throw new OrdersForbiddenError(
      "No hay faltante de MP para autorizar: la entrega de la OE la confirma Elaboración."
    );
  }
  const negativeAuthorized = shortages.length > 0;
  const pending: OeConsumptionPending | null = plan.issues.length ? { issues: plan.issues, shortages: [] } : null;

  const order = await params.commitOrder(pending ?? undefined);
  const wanted = new Set(deltas.map((d) => `${d.codigo}|${d.lote}`));
  const applied = await ledger.applyOeConsumption(
    { email: actor.email, sector: actor.sector },
    {
      oeId: params.oeId,
      oeVersion: order.version,
      oeStatus: order.status,
      lines: plan.lines,
      // El consumo REAL se descuenta siempre: si no alcanza el stock, el saldo queda negativo (con movimiento trazable).
      allowNegative: true,
      orderNumber: params.orderNumber,
      onlyDeltaKeys: plan.issues.length > 0 ? wanted : undefined,
    }
  );
  const lotDeltas = applied
    .map((a) => ({ lotId: lotIdOf(a), delta: a.delta }))
    .filter((d): d is { lotId: string; delta: number } => Boolean(d.lotId));
  const lots = ctx.inventory.applyOeLotDeltas(ctx.inventoryActor, {
    oeId: params.oeId,
    orderNumber: params.orderNumber,
    reason: negativeAuthorized
      ? `Consumo ${params.orderNumber} (kg reales; el stock queda negativo${params.authorizeNegative?.reason?.trim() ? `: ${params.authorizeNegative.reason.trim()}` : ""})`
      : `Consumo ${params.orderNumber} (kg reales)`,
    deltas: lotDeltas,
  });
  return { order, result: { lines: plan.lines, applied, lots, shortages, negativeAuthorized }, pending };
}

/** Devuelve TODO lo descontado por la OE (libro mayor + lotes). `commitOrder` cambia el estado en la misma transacción. */
export async function reverseOeStock<O extends { version: number }>(
  ctx: OeStockCtx,
  actor: OrdersActor,
  params: { oeId: string; orderNumber: string; reason: string; commitOrder: () => Promise<O> }
): Promise<{ order: O; applied: Array<{ codigo: string; lote: string; delta: number; lotId: string | null }>; lots: OeConsumptionResult["lots"] }> {
  const order = await params.commitOrder();
  const applied = await getMpStockLedger().reverseOeConsumption(
    { email: actor.email, sector: actor.sector },
    params.oeId,
    order.version,
    params.orderNumber
  );
  const lotDeltas = applied
    .map((a) => ({ lotId: a.lotId ?? legacyLotFor(ctx.catalog, a.codigo, a.lote), delta: a.delta }))
    .filter((d): d is { lotId: string; delta: number } => Boolean(d.lotId));
  const lots = ctx.inventory.applyOeLotDeltas(ctx.inventoryActor, {
    oeId: params.oeId,
    orderNumber: params.orderNumber,
    reason: `Reverso consumo ${params.orderNumber}: ${params.reason}`,
    deltas: lotDeltas,
  });
  return { order, applied, lots };
}

/** Resultado de registrar el consumo real al «Guardar avance» (informativo; nunca bloquea el guardado). */
export type OeProgressConsumption = {
  /** Movimientos registrados ahora (solo diferencias contra lo ya contabilizado de esta OE). */
  applied: Array<{ codigo: string; lote: string; delta: number }>;
  /** Filas con kg reales que no se pudieron contabilizar (falta código/lote o no existe en Stock MP): quedan pendientes. */
  pendingIssues: string[];
  /** Advertencia: el stock de estas MP queda NEGATIVO tras el descuento (el consumo igual se registró). */
  shortages: LotShortage[];
};

/**
 * «Guardar avance» de una OE EN CURSO: contabiliza en Stock MP el consumo REAL ya informado (KG REAL UTILIZADO, código MP y
 * lote). No es la entrega: la OE sigue en su estado. Es un descuento por DIFERENCIA contra lo ya registrado de esta OE
 * (mismo libro mayor que usa la entrega): guardar de nuevo sin cambios no descuenta nada, aumentar descuenta solo la
 * diferencia y reducir registra una compensación auditada. ENTREGAR después reconoce lo ya descontado (misma regla).
 * Nunca lanza por datos incompletos o stock insuficiente: lo identificable se descuenta siempre (el saldo puede quedar negativo) y
 * lo incompleto queda pendiente de regularización, sin movimientos inventados.
 * `orderVersion` = versión de la OE ya guardada (clave idempotente por versión + código + lote).
 */
export async function registerOeProgressConsumption(
  ctx: OeStockCtx,
  actor: OrdersActor,
  params: { oeId: string; orderNumber: string; orderVersion: number; orderStatus: string; materials: OeMaterialRow[] }
): Promise<OeProgressConsumption> {
  const ledger = getMpStockLedger();
  const plan = buildOeConsumptionPlan(params.materials, ctx.catalog, { progress: true, consumedBefore: await consumedBeforeOf(params.oeId) });
  const pendingIssues = plan.issues.map((i) => i.message);
  const lotIdOf = (d: { codigo: string; lote: string; lotId: string | null }) => d.lotId ?? legacyLotFor(ctx.catalog, d.codigo, d.lote);

  let deltas = await ledger.planOeConsumptionDeltas(params.oeId, plan.lines);
  // Con filas incompletas no se compensa (devolver stock) lo de filas que dejaron de ser identificables: solo se suma consumo.
  if (plan.issues.length > 0) deltas = deltas.filter((d) => d.delta < 0);
  if (deltas.length === 0) return { applied: [], pendingIssues, shortages: [] };

  const withLots = deltas.map((d) => ({ ...d, lotId: lotIdOf(d) })).filter((d): d is typeof d & { lotId: string } => Boolean(d.lotId));
  const shortages: LotShortage[] = lotShortages(withLots, ctx.catalog);
  const byCode = new Map<string, number>();
  for (const d of deltas) byCode.set(d.codigo, Math.round(((byCode.get(d.codigo) ?? 0) + d.delta) * 1000) / 1000);
  for (const [codigo, delta] of byCode) {
    if (delta >= 0) continue;
    const disponible = Number(((await ledger.getBalance(codigo))?.stockActual ?? 0).toFixed(4));
    if (disponible + delta < 0) shortages.push({ codigo, lote: "", disponible, requerido: -delta, faltante: Number((-delta - disponible).toFixed(4)), tipo: "codigo" });
  }
  // El stock insuficiente NO bloquea: el consumo real se descuenta y el saldo puede quedar negativo (advertencia en `shortages`).
  const wanted = new Set(deltas.map((d) => `${d.codigo}|${d.lote}`));
  const applied = await ledger.applyOeConsumption(
    { email: actor.email, sector: actor.sector },
    {
      oeId: params.oeId,
      oeVersion: params.orderVersion,
      oeStatus: params.orderStatus,
      lines: plan.lines,
      orderNumber: params.orderNumber,
      progress: true,
      allowNegative: true,
      onlyDeltaKeys: plan.issues.length > 0 ? wanted : undefined,
    }
  );
  const lotDeltas = applied
    .map((a) => ({ lotId: lotIdOf(a), delta: a.delta }))
    .filter((d): d is { lotId: string; delta: number } => Boolean(d.lotId));
  ctx.inventory.applyOeLotDeltas(ctx.inventoryActor, {
    oeId: params.oeId,
    orderNumber: params.orderNumber,
    reason: `Consumo ${params.orderNumber} al guardar avance (kg reales)`,
    deltas: lotDeltas,
  });
  return { applied: applied.map((a) => ({ codigo: a.codigo, lote: a.lote, delta: a.delta })), pendingIssues, shortages };
}
