import { resolveWorkItemDeliveryPacking, validateDeliveryPacking } from "@/lib/remitos/delivery-packing";
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import {
  operationalEvents,
  productionPedidos,
  productionPedidoStatusEvents,
  workItemDeliveries,
  workItemDeliveryLines,
  workItems,
} from "@/lib/db/schema";
import { loadWorkItemOperationalData } from "@/lib/planning/work-item-operational-data";
import { PlanningForbiddenError, PlanningNotFoundError, PlanningValidationError } from "@/lib/planning/types";
import { isIntegerUnit } from "@/lib/utils/ar-number-parsing";
import { summarizePackingGroups, normalizePackingGroups } from "@/lib/remitos/packing-math";
import {
  assertEnvasadoDeliveryBoxes,
  hasRealPackingGroups,
} from "./packaging-close";
import {
  defaultDeliveryKey,
  formatQty,
  parseQuantity,
  planDeliveryStep,
  resolveDeliveryTarget,
} from "./delivery-math";
import type { CircuitMovement, CircuitMovementType } from "./movements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface DeliveryActor {
  email: string;
  sector: string;
  displayName: string;
}

/** Datos de cierre (lo que antes hacía «Finalizar») que se aplican en la MISMA transacción que la entrega. */
export interface DeliveryCompletion {
  finishedQty?: string | null;
  observation?: string | null;
  /** "Fill-once": solo completa si el trabajo no los tenía. */
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packingGroups?: unknown;
  sampleUnits?: number | null;
  packingMismatchObservation?: string | null;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
}

export interface RecordDeliveryParams {
  workItemId: string;
  actor: DeliveryActor;
  /** Misma clave = misma entrega (doble clic / reintento). Sin clave se deriva una determinística. */
  idempotencyKey?: string | null;
  /** Cantidad entregada ahora. null/undefined = todo el saldo pendiente. */
  quantity?: number | null;
  codigo?: string | null;
  qualityItemId?: string | null;
  plannedDeliveryDate?: string | null;
  actualDeliveredAt?: string | Date | null;
  remito?: string | null;
  receivedBy?: string | null;
  observations?: string | null;
  completion?: DeliveryCompletion | null;
  /** Columnas adicionales de work_items a aplicar en la misma escritura (p. ej. observación de Codificado). */
  extraItemPatch?: Partial<typeof workItems.$inferInsert>;
  /** Trazabilidad del tipo de movimiento. Por defecto se deduce del sector del actor. */
  movementType?: CircuitMovementType;
  /** Saltea la exigencia de cajas (Codificado: recibe solo la cantidad total). Por defecto se deduce. */
  skipBoxValidation?: boolean;
  /** Cajas de ESTA entrega ([{cajas, unidadesPorCaja}], cantidades distintas por caja). Debe sumar la cantidad entregada. */
  deliveryPackingGroups?: unknown;
}

export interface RecordDeliveryResult {
  delivery: typeof workItemDeliveries.$inferSelect;
  line: typeof workItemDeliveryLines.$inferSelect | null;
  item: typeof workItems.$inferSelect;
  replayed: boolean;
  complete: boolean;
  /** Acumulado entregado y saldo luego de esta operación. */
  delivered: number | null;
  pending: number | null;
  target: number | null;
  movement: CircuitMovement | null;
}

const ENVASADO = new Set(["ENVASADO_MASIVO", "ENVASADO_PREMIUM"]);

/**
 * Quién puede registrar una entrega final:
 *  - PRODUCCION / DIRECCION: cualquier trabajo (siguen pudiendo todo).
 *  - ENVASADO_MASIVO / ENVASADO_PREMIUM: solo trabajos que están HOY en su sector.
 *  - CODIFICADO: solo trabajos que están hoy en Codificado.
 *  - Elaboración y el resto: nunca (Elaboración envía a Envasado, no entrega a cliente).
 */
export function canActorDeliverItem(actorSector: string, itemSector: string): boolean {
  const a = String(actorSector ?? "").toUpperCase();
  if (a === "PRODUCCION" || a === "DIRECCION") return true;
  if (a === "ENVASADO_MASIVO" || a === "ENVASADO_PREMIUM") return a === itemSector;
  if (a === "CODIFICADO") return itemSector === "CODIFICADO";
  return false;
}

export const DELIVERY_FORBIDDEN_MESSAGE =
  "No tenés permiso para entregar este trabajo: solo Producción, Dirección o el sector que lo tiene asignado (Envasado/Codificado) pueden registrar su entrega.";

function nonEmpty(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function defaultMovementType(actorSector: string): CircuitMovementType {
  const a = actorSector.toUpperCase();
  if (ENVASADO.has(a)) return "ENVASADO_ENTREGA";
  if (a === "CODIFICADO") return "CODIFICADO_ENTREGA";
  return "PRODUCCION_ENTREGA";
}

/**
 * Registra una entrega (total o parcial) de un trabajo, en la transacción recibida. Idempotente por clave.
 *
 * Garantías:
 *  - bloquea la fila del trabajo (FOR UPDATE): dos entregas simultáneas del mismo trabajo se serializan;
 *  - misma `idempotencyKey` → misma entrega (devuelve la ya registrada, sin duplicar unidades);
 *  - nunca entrega más que el saldo; una entrega menor al total es PARCIAL: el trabajo NO queda «entregado»;
 *  - al completarse la cantidad: operational_status → entregado y, si todos los trabajos del pedido están
 *    entregados, el pedido pasa a ENTREGADO (monótono, con evento de estado);
 *  - una sola fila agregada ENTREGADO por trabajo (índice único existente) + una línea por entrega física;
 *  - NO toca inventario ni el consumo de MP (eso cuelga de la entrega de la OE, no de work_items).
 */
export async function recordDeliveryInTx(tx: Tx, params: RecordDeliveryParams): Promise<RecordDeliveryResult> {
  const { actor } = params;
  const [row] = await tx.select().from(workItems).where(eq(workItems.id, params.workItemId)).for("update").limit(1);
  if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
  if (!canActorDeliverItem(actor.sector, row.sector)) {
    throw new PlanningForbiddenError(DELIVERY_FORBIDDEN_MESSAGE);
  }
  if (row.deletedAt) throw new PlanningValidationError("Este trabajo fue borrado por Producción.");
  if (row.operationalStatus === "cancelado") {
    throw new PlanningValidationError("Este trabajo está cancelado: no se puede entregar.");
  }

  const [active] = await tx
    .select()
    .from(workItemDeliveries)
    .where(
      and(
        eq(workItemDeliveries.workItemId, params.workItemId),
        eq(workItemDeliveries.status, "ENTREGADO"),
        eq(workItemDeliveries.archived, false)
      )
    )
    .limit(1);

  // Acumulado de lo ya entregado en la entrega vigente (solo líneas ACTIVAS de ESA fila agregada).
  let alreadyDelivered = 0;
  let lineCount = 0;
  if (active) {
    const lines = await tx
      .select({ quantity: workItemDeliveryLines.quantity })
      .from(workItemDeliveryLines)
      .where(and(eq(workItemDeliveryLines.deliveryId, active.id), eq(workItemDeliveryLines.status, "ACTIVA")));
    lineCount = lines.length;
    alreadyDelivered = lines.reduce((s: number, l: { quantity: number }) => s + Number(l.quantity), 0);
  }

  const requested = params.quantity != null && Number.isFinite(Number(params.quantity)) ? Number(params.quantity) : null;
  let key =
    nonEmpty(params.idempotencyKey) ??
    defaultDeliveryKey({ workItemId: params.workItemId, alreadyDelivered, requested });
  if (key.length > 160) throw new PlanningValidationError("idempotencyKey demasiado larga.");

  // Replay: misma clave → misma entrega (solo si esa línea sigue ACTIVA).
  const [priorLine] = await tx
    .select()
    .from(workItemDeliveryLines)
    .where(and(eq(workItemDeliveryLines.workItemId, params.workItemId), eq(workItemDeliveryLines.idempotencyKey, key)))
    .limit(1);
  if (priorLine && priorLine.status !== "ACTIVA") {
    // La entrega con esa clave fue ANULADA: re-entregar es una entrega NUEVA (no un replay). El índice único
    // (trabajo, clave) incluye las anuladas, así que se deriva una clave de «generación» a partir de cuántas líneas
    // (de cualquier estado) tiene el trabajo; es determinística para los reintentos de ESTA re-entrega.
    const all = await tx
      .select({ id: workItemDeliveryLines.id })
      .from(workItemDeliveryLines)
      .where(eq(workItemDeliveryLines.workItemId, params.workItemId));
    key = `${key}~g${all.length}`;
    if (key.length > 160) throw new PlanningValidationError("idempotencyKey demasiado larga.");
  }
  const replayLine = priorLine && priorLine.status === "ACTIVA" ? priorLine : null;
  if (replayLine) {
    const [delivery] = await tx
      .select()
      .from(workItemDeliveries)
      .where(eq(workItemDeliveries.id, replayLine.deliveryId ?? active?.id ?? ""))
      .limit(1);
    const priorComplete = replayLine.kind === "FINAL";
    return {
      delivery: delivery ?? active,
      line: replayLine,
      item: row,
      replayed: true,
      complete: delivery ? Boolean(delivery.deliveryComplete) : true,
      delivered: replayLine.cumulativeAfter ?? null,
      pending: replayLine.pendingAfter ?? null,
      target: null,
      // Se reconstruye el movimiento para que el reintento pueda re-emitir el aviso (idempotente por id).
      movement: {
        type: params.movementType ?? defaultMovementType(actor.sector),
        workItemId: params.workItemId,
        eventKey: key,
        fromSector: replayLine.sourceSector,
        toSector: null,
        client: row.client,
        product: row.product,
        quantity: isIntegerUnit(row.unit) ? String(Math.round(replayLine.quantity)) : formatQty(replayLine.quantity),
        unit: row.unit,
        lote: row.packagingLote ?? null,
        at: replayLine.createdAt,
        actorName: replayLine.deliveredBy,
        actorEmail: actor.email,
        delivered: replayLine.cumulativeAfter ?? null,
        pending: replayLine.pendingAfter ?? null,
        complete: priorComplete,
      },
    };
  }

  // Entrega histórica ya completa (sin líneas): comportamiento previo — idempotente, devuelve la existente.
  if (active && active.deliveryComplete && lineCount === 0) {
    return {
      delivery: active,
      line: null,
      item: row,
      replayed: true,
      complete: true,
      delivered: null,
      pending: 0,
      target: null,
      movement: null,
    };
  }
  if (active && active.deliveryComplete && lineCount > 0) {
    // Ya se entregó todo: un reintento con otra clave no entrega de más.
    return {
      delivery: active,
      line: null,
      item: row,
      replayed: true,
      complete: true,
      delivered: alreadyDelivered,
      pending: 0,
      target: alreadyDelivered,
      movement: null,
    };
  }

  const now = new Date();
  const actorName = actor.displayName || actor.email;
  const unit = row.unit as string;

  // ── Cierre (lo que antes hacía «Finalizar») aplicado en la misma transacción ─────────────────────
  const c = params.completion ?? null;
  const patch: Partial<typeof workItems.$inferInsert> = { ...(params.extraItemPatch ?? {}) };
  const finishedText = c?.finishedQty != null ? String(c.finishedQty).trim() : null;
  if (finishedText) patch.finishedQty = finishedText;
  if (c?.observation != null && c.observation.trim()) patch.operationalObservation = c.observation.trim();
  if (c?.packagingTotalUnits !== undefined && c.packagingTotalUnits !== null) patch.packagingTotalUnits = c.packagingTotalUnits;
  if (c?.packingGroups !== undefined && c.packingGroups !== null) patch.packingGroups = c.packingGroups;
  if (c?.sampleUnits !== undefined && c.sampleUnits !== null) patch.sampleUnits = c.sampleUnits;
  if (c?.packingMismatchObservation !== undefined && c.packingMismatchObservation !== null)
    patch.packingMismatchObservation = c.packingMismatchObservation;
  if (c?.bulkRemainderKg !== undefined && c.bulkRemainderKg !== null) patch.bulkRemainderKg = c.bulkRemainderKg;
  if (c?.bulkRemainderObservation !== undefined && c.bulkRemainderObservation !== null)
    patch.bulkRemainderObservation = c.bulkRemainderObservation;
  if (c?.bulkRemainderId !== undefined && c.bulkRemainderId !== null) patch.bulkRemainderId = c.bulkRemainderId;
  const filledLote = !row.packagingLote && nonEmpty(c?.packagingLote) ? nonEmpty(c?.packagingLote) : null;
  const filledVto = !row.packagingVto && nonEmpty(c?.packagingVto) ? nonEmpty(c?.packagingVto) : null;
  if (filledLote) patch.packagingLote = filledLote;
  if (filledVto) patch.packagingVto = filledVto;

  const nextGroups = patch.packingGroups !== undefined ? patch.packingGroups : row.packingGroups;
  const nextSamples = patch.sampleUnits !== undefined ? patch.sampleUnits : row.sampleUnits;
  const nextFinishedText = (patch.finishedQty as string | undefined) ?? row.finishedQty ?? null;
  const nextTotal = patch.packagingTotalUnits !== undefined ? patch.packagingTotalUnits : row.packagingTotalUnits;
  const nextMismatchObs =
    (patch.packingMismatchObservation as string | null | undefined) ?? row.packingMismatchObservation ?? null;

  // Cajas: Envasado entrega SU trabajo → distribución obligatoria y validada. Codificado (recibe solo el total) y
  // Producción/Dirección (registran sobre trabajos históricos) no la exigen; si hay distribución REAL consistente se
  // conserva y fija lo embalado.
  const enforceBoxes = !params.skipBoxValidation && ENVASADO.has(actor.sector.toUpperCase());
  const finishedNum =
    parseQuantity(nextFinishedText, unit) ?? (nextTotal != null ? Number(nextTotal) : null);
  if (enforceBoxes) {
    const close = assertEnvasadoDeliveryBoxes({
      finishedQty: finishedNum,
      sampleUnits: nextSamples,
      packingGroups: nextGroups,
      observation: (c?.observation ?? row.operationalObservation ?? "") || nextMismatchObs,
    });
    patch.deliverableUnits = close.packedUnits;
    patch.packagingClosedAt = now;
    patch.packagingClosedBy = actorName;
  } else if (c && hasRealPackingGroups(nextGroups) && finishedNum != null) {
    const packed = summarizePackingGroups(normalizePackingGroups(nextGroups as never)).totalEmbalado;
    // Trabajos históricos (Producción registra la entrega): lo entregable es lo físicamente embalado. Trabajos
    // enviados a Codificado sin desglose completo: la cantidad total declarada manda; una distribución parcial NO
    // achica la entrega (no se «pierden» unidades por un desglose incompleto).
    if (packed === finishedNum || !row.viaCodificado) {
      patch.deliverableUnits = packed;
      patch.packagingClosedAt = row.packagingClosedAt ?? now;
      patch.packagingClosedBy = row.packagingClosedBy ?? actorName;
    }
  }

  // ── Cantidad objetivo y paso de entrega ──────────────────────────────────────────────────────────
  const target = resolveDeliveryTarget({
    unit,
    deliverableUnits:
      patch.deliverableUnits !== undefined ? (patch.deliverableUnits as number | null) : row.deliverableUnits,
    packagingTotalUnits: nextTotal != null ? Number(nextTotal) : null,
    finishedQty: nextFinishedText,
    plannedQuantity: row.plannedQuantity,
  });

  let stepQuantity: number | null = null;
  let cumulative: number | null = null;
  let pending: number | null = null;
  let complete = true;
  if (target != null) {
    const step = planDeliveryStep({ target, alreadyDelivered, requested, unit });
    if (!step.ok) throw new PlanningValidationError(step.error);
    stepQuantity = step.quantity;
    cumulative = step.cumulative;
    pending = step.pending;
    complete = step.complete;
  } else if (requested != null && requested > 0) {
    // Sin cantidad objetivo numérica: se registra lo declarado y se considera completa.
    stepQuantity = requested;
    cumulative = alreadyDelivered + requested;
    pending = 0;
  }

  // Cajas de ESTA entrega: si vienen, deben sumar exactamente lo entregado ahora.
  const deliveryPacking = validateDeliveryPacking(params.deliveryPackingGroups ?? null, stepQuantity);
  if (!deliveryPacking.ok) throw new PlanningValidationError(deliveryPacking.error);

  // ── Snapshot canónico (relee la fila ya con el patch de cierre aplicado) ─────────────────────────
  if (Object.keys(patch).length > 0 || filledLote || filledVto) {
    await tx.update(workItems).set({ ...patch, updatedAt: now }).where(eq(workItems.id, params.workItemId));
  }
  const canonical = await loadWorkItemOperationalData(tx, params.workItemId);
  if (!canonical) throw new PlanningNotFoundError("Trabajo no encontrado.");

  const quantityText =
    cumulative != null
      ? isIntegerUnit(unit)
        ? String(Math.round(cumulative))
        : formatQty(cumulative)
      : canonical.deliverableUnits != null
        ? String(canonical.deliverableUnits)
        : (canonical.finishedQty ?? canonical.plannedQuantity);

  const aggregateValues = {
    qualityItemId: params.qualityItemId ?? null,
    product: canonical.product,
    codigo: params.codigo ?? null,
    client: canonical.client,
    lote: canonical.packagingLote,
    vto: canonical.packagingVto,
    orderNumber: canonical.orderNumber,
    packingGroups: canonical.packingGroups,
    plannedQuantity: canonical.plannedQuantity,
    finishedQty: canonical.finishedQty,
    sampleUnits: canonical.sampleUnits,
    deliverableUnits: canonical.deliverableUnits,
    bulkRemainderKg: canonical.bulkRemainderKg,
    bulkRemainderObservation: canonical.bulkRemainderObservation,
    productionPedidoId: canonical.productionPedidoId,
    pedidoOp: canonical.pedidoOp,
    sourceSector: row.sector as string,
    quantity: quantityText,
    unit: canonical.unit,
    plannedDeliveryDate: params.plannedDeliveryDate ?? null,
    actualDeliveredAt: params.actualDeliveredAt ? new Date(params.actualDeliveredAt) : now,
    remito: nonEmpty(params.remito),
    receivedBy: nonEmpty(params.receivedBy),
    observations: nonEmpty(params.observations),
    deliveredBy: actorName,
    deliveredBySector: actor.sector,
    deliveryComplete: complete,
    pendingBalance: complete ? null : pending,
  };

  let delivery: typeof workItemDeliveries.$inferSelect;
  if (active) {
    const [updated] = await tx
      .update(workItemDeliveries)
      .set({
        ...aggregateValues,
        // Conserva lo ya cargado si esta entrega no trae el dato.
        codigo: aggregateValues.codigo ?? active.codigo,
        remito: aggregateValues.remito ?? active.remito,
        receivedBy: aggregateValues.receivedBy ?? active.receivedBy,
        observations: aggregateValues.observations ?? active.observations,
        plannedDeliveryDate: aggregateValues.plannedDeliveryDate ?? active.plannedDeliveryDate,
        updatedAt: now,
      })
      .where(eq(workItemDeliveries.id, active.id))
      .returning();
    delivery = updated;
  } else {
    const [inserted] = await tx
      .insert(workItemDeliveries)
      .values({ workItemId: params.workItemId, status: "ENTREGADO", ...aggregateValues })
      .returning();
    delivery = inserted;
  }

  let line: typeof workItemDeliveryLines.$inferSelect | null = null;
  // Cajas de esta entrega: las que se cargaron en el diálogo o, si no se cargaron, las ya registradas en el trabajo
  // (Envasado/Codificado) cuando son inequívocas (ver resolveWorkItemDeliveryPacking). Nunca se inventan ni se dividen.
  let linePacking: Array<{ cajas: number; unidadesPorCaja: number }> = deliveryPacking.groups;
  if (stepQuantity != null && linePacking.length === 0) {
    const prior = await tx
      .select({ id: workItemDeliveryLines.id, quantity: workItemDeliveryLines.quantity, packingGroups: workItemDeliveryLines.packingGroups })
      .from(workItemDeliveryLines)
      .where(and(eq(workItemDeliveryLines.workItemId, params.workItemId), eq(workItemDeliveryLines.status, "ACTIVA")));
    const resolved = resolveWorkItemDeliveryPacking({
      workItemGroups: canonical.packingGroups,
      lines: [
        ...prior.map((l: { id: string; quantity: number; packingGroups: unknown }) => ({ id: l.id, quantity: Number(l.quantity), groups: Array.isArray(l.packingGroups) ? (l.packingGroups as never) : null })),
        { id: "__new__", quantity: stepQuantity, groups: null },
      ],
    }).get("__new__");
    if (resolved && resolved.source === "TRABAJO") linePacking = resolved.groups;
  }
  if (stepQuantity != null) {
    const [insertedLine] = await tx
      .insert(workItemDeliveryLines)
      .values({
        workItemId: params.workItemId,
        deliveryId: delivery.id,
        idempotencyKey: key,
        sequence: lineCount + 1,
        quantity: stepQuantity,
        unit: canonical.unit,
        kind: complete ? "FINAL" : "PARCIAL",
        status: "ACTIVA",
        sourceSector: row.sector as string,
        deliveredBy: actorName,
        deliveredBySector: actor.sector,
        actualDeliveredAt: aggregateValues.actualDeliveredAt,
        remito: aggregateValues.remito,
        receivedBy: aggregateValues.receivedBy,
        observations: aggregateValues.observations,
        cumulativeAfter: cumulative,
        pendingAfter: complete ? 0 : pending,
        packingGroups: linePacking.length > 0 ? linePacking : null,
      })
      .returning();
    line = insertedLine;
  }

  // ── Estado del trabajo ───────────────────────────────────────────────────────────────────────────
  const fromStatus = row.operationalStatus as string;
  const toStatus = complete ? "entregado" : fromStatus === "revision" ? "revision" : "en_curso";
  const itemSet: Partial<typeof workItems.$inferInsert> = {
    operationalStatus: toStatus,
    progressUpdatedAt: now,
    progressUpdatedBy: actorName,
    reworkRequestedAt: null,
    reworkRequestedBy: null,
    reworkRequestedBySector: null,
    reworkReason: null,
    version: Number(row.version) + 1,
    updatedAt: now,
  };
  if (complete) {
    itemSet.completedAt = row.completedAt ?? now;
    itemSet.completedBy = row.completedBy ?? actorName;
    if (row.sector === "CODIFICADO") {
      itemSet.deliveredFromCodificadoAt = row.deliveredFromCodificadoAt ?? now;
      itemSet.deliveredFromCodificadoBy = row.deliveredFromCodificadoBy ?? actorName;
    }
  }
  const [updatedItem] = await tx.update(workItems).set(itemSet).where(eq(workItems.id, params.workItemId)).returning();

  await tx.insert(operationalEvents).values({
    workItemId: params.workItemId,
    planningWeekId: row.planningWeekId,
    type: complete ? "WORK_DELIVERED" : "WORK_DELIVERED_PARTIAL",
    fromStatus,
    toStatus,
    actorEmail: actor.email,
    actorSector: actor.sector,
    note:
      `delivery:${key} | cantidad=${stepQuantity ?? "s/d"} | acumulado=${cumulative ?? "s/d"} | saldo=${
        complete ? 0 : (pending ?? "s/d")
      }`.slice(0, 500),
  });

  if (complete) {
    await closePedidoIfAllDelivered(tx, updatedItem, actor);
  }

  return {
    delivery,
    line,
    item: updatedItem,
    replayed: false,
    complete,
    delivered: cumulative,
    pending: complete ? 0 : pending,
    target,
    movement: {
      type: params.movementType ?? defaultMovementType(actor.sector),
      workItemId: params.workItemId,
      eventKey: key,
      fromSector: row.sector as string,
      toSector: null,
      client: canonical.client,
      product: canonical.product,
      quantity: stepQuantity != null ? (isIntegerUnit(unit) ? String(Math.round(stepQuantity)) : formatQty(stepQuantity)) : quantityText,
      unit: canonical.unit,
      lote: canonical.packagingLote,
      at: now,
      actorName,
      actorEmail: actor.email,
      delivered: cumulative,
      pending: complete ? 0 : pending,
      complete,
    },
  };
}

/**
 * Cuando TODOS los trabajos de despacho (Envasado/Codificado, no cancelados ni borrados) de un pedido están
 * entregados, el pedido pasa a ENTREGADO. Monótono: nunca retrocede ni repite (si ya está ENTREGADO no hace nada)
 * y deja un evento en production_pedido_status_events. Elaboración no entrega a cliente: no cuenta.
 */
export async function closePedidoIfAllDelivered(
  tx: Tx,
  item: { id: string; productionPedidoId?: string | null },
  actor: DeliveryActor
): Promise<boolean> {
  const pedidoId = item.productionPedidoId;
  if (!pedidoId) return false;
  const [pedido] = await tx
    .select()
    .from(productionPedidos)
    .where(and(eq(productionPedidos.id, pedidoId), sql`${productionPedidos.deletedAt} IS NULL`))
    // Serializa entregas finales concurrentes de trabajos hermanos: la segunda espera el commit de la primera y
    // entonces ve a la hermana ya `entregado` (sin esto ninguna de las dos cerraba el pedido).
    .for("update")
    .limit(1);
  if (!pedido || pedido.estado === "ENTREGADO") return false;

  const siblings = await tx
    .select({ id: workItems.id, operationalStatus: workItems.operationalStatus, sector: workItems.sector })
    .from(workItems)
    .where(
      and(
        eq(workItems.productionPedidoId, pedidoId),
        sql`${workItems.deletedAt} IS NULL`,
        sql`${workItems.sector} IN ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM', 'CODIFICADO')`,
        sql`${workItems.operationalStatus} <> 'cancelado'`,
        sql`${workItems.status} <> 'CANCELADO'`
      )
    );
  if (siblings.length === 0) return false;
  if (!siblings.every((s: { operationalStatus: string }) => s.operationalStatus === "entregado")) return false;

  const now = new Date();
  await tx
    .update(productionPedidos)
    .set({ estado: "ENTREGADO", updatedBy: actor.email, updatedAt: now })
    .where(eq(productionPedidos.id, pedidoId));
  await tx.insert(productionPedidoStatusEvents).values({
    pedidoId,
    workItemId: item.id,
    fromEstado: pedido.estado,
    toEstado: "ENTREGADO",
    actorEmail: actor.email,
    actorSector: actor.sector,
    event: "ALL_WORK_DELIVERED",
    motivo: null,
  });
  return true;
}

/** Suma de lo entregado (líneas ACTIVAS de la entrega vigente) — para vistas y tests. */
export async function sumActiveDeliveredUnits(tx: Tx, workItemId: string): Promise<number> {
  const [active] = await tx
    .select({ id: workItemDeliveries.id })
    .from(workItemDeliveries)
    .where(
      and(
        eq(workItemDeliveries.workItemId, workItemId),
        eq(workItemDeliveries.status, "ENTREGADO"),
        eq(workItemDeliveries.archived, false)
      )
    )
    .limit(1);
  if (!active) return 0;
  const lines = await tx
    .select({ quantity: workItemDeliveryLines.quantity })
    .from(workItemDeliveryLines)
    .where(and(eq(workItemDeliveryLines.deliveryId, active.id), eq(workItemDeliveryLines.status, "ACTIVA")));
  return lines.reduce((s: number, l: { quantity: number }) => s + Number(l.quantity), 0);
}
