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
  type ConsumptionIssue,
  normMpCode,
  normMpLote,
  type ConsumptionLine,
  type LotShortage,
  type MpCatalogLot,
} from "@/lib/orders/oe-mp-consumption";
import type { OeMaterialRow, OrdersActor } from "@/lib/orders/types";
import { canAuthorizeOeMpShortage } from "@/lib/orders/rbac";
import { MpConsumptionIncompleteError, MpStockShortageError, OrdersForbiddenError } from "@/lib/orders/types";

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
export async function consumeOeStock<O extends { version: number; status: string }>(
  ctx: OeStockCtx,
  actor: OrdersActor,
  params: {
    oeId: string;
    orderNumber: string;
    materials: OeMaterialRow[];
    authorizeNegative?: { reason: string } | null;
    /** Producción/Dirección confirmando la entrega: solo vale si hay faltante de MP que autorizar. */
    onlyToAuthorizeShortage?: boolean;
    /**
     * Entrega de Elaboración: la falta de datos o de stock NUNCA bloquea. Se registra la entrega (`commitOrder`) y el
     * descuento queda pendiente (sin movimientos parciales ni cantidades inventadas); se regulariza después, una sola vez.
     */
    soft?: boolean;
    commitOrder: (pending?: OeConsumptionPending) => Promise<O>;
  }
): Promise<{ order: O; result: OeConsumptionResult | null; pending: OeConsumptionPending | null }> {
  const ledger = getMpStockLedger();
  const plan = buildOeConsumptionPlan(params.materials, ctx.catalog);
  if (plan.issues.length) {
    if (params.soft) {
      const pending = { issues: plan.issues, shortages: [] };
      return { order: await params.commitOrder(pending), result: null, pending };
    }
    throw new MpConsumptionIncompleteError(plan.issues);
  }

  const lotIdOf = (d: { codigo: string; lote: string; lotId: string | null }) => d.lotId ?? legacyLotFor(ctx.catalog, d.codigo, d.lote);

  // Stock: por fila de Stock MP y por código (cada uno contra su propio saldo; no se concilian entre sí).
  const deltas = await ledger.planOeConsumptionDeltas(params.oeId, plan.lines);
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
  const canAuthorize = canAuthorizeNegativeMp(actor.sector);
  const negativeAuthorized = shortages.length > 0 && canAuthorize && Boolean(params.authorizeNegative?.reason?.trim());
  if (shortages.length > 0 && !negativeAuthorized && params.soft) {
    const pending = { issues: [], shortages };
    return { order: await params.commitOrder(pending), result: null, pending };
  }
  if (shortages.length > 0 && !negativeAuthorized) {
    const detail = shortages
      .map((s) =>
        s.tipo === "lote"
          ? `${s.codigo} lote ${s.lote}: hay ${s.disponible} kg, se necesitan ${s.requerido} kg (faltan ${s.faltante})`
          : `${s.codigo} (stock del código): hay ${s.disponible} kg, se necesitan ${s.requerido} kg (faltan ${s.faltante})`
      )
      .join("; ");
    throw new MpStockShortageError(
      `Stock de MP insuficiente: ${detail}. No se entregó ni se descontó nada.${
        canAuthorize ? " Podés autorizar la entrega con stock negativo indicando el motivo." : " Avisá a Producción o a Materia Prima."
      }`,
      shortages,
      canAuthorize
    );
  }

  const order = await params.commitOrder();
  const applied = await ledger.applyOeConsumption(
    { email: actor.email, sector: actor.sector },
    {
      oeId: params.oeId,
      oeVersion: order.version,
      oeStatus: order.status,
      lines: plan.lines,
      allowNegative: negativeAuthorized,
      orderNumber: params.orderNumber,
    }
  );
  const lotDeltas = applied
    .map((a) => ({ lotId: lotIdOf(a), delta: a.delta }))
    .filter((d): d is { lotId: string; delta: number } => Boolean(d.lotId));
  const lots = ctx.inventory.applyOeLotDeltas(ctx.inventoryActor, {
    oeId: params.oeId,
    orderNumber: params.orderNumber,
    reason: negativeAuthorized
      ? `Consumo ${params.orderNumber} (stock negativo autorizado: ${params.authorizeNegative!.reason.trim()})`
      : `Consumo ${params.orderNumber} (kg reales)`,
    deltas: lotDeltas,
  });
  return { order, result: { lines: plan.lines, applied, lots, shortages, negativeAuthorized }, pending: null };
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
