import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  operationalEvents,
  productionPedidos,
  productionPedidoStatusEvents,
  workItemDeliveries,
  workItems,
} from "@/lib/db/schema";
import { normalizeOptionalReason } from "@/lib/lifecycle/reason";
import { canReopenCodificadoDelivery } from "@/features/os/operational/lib/codificado-flow";
import { parseQuantity } from "@/lib/planning/circuit/delivery-math";
import { closeForCodificadoTransfer } from "@/lib/planning/circuit/packaging-close";
import { emitBillingForDelivery } from "@/lib/notifications/billing-notifications";
import { recordDeliveryInTx, sumActiveDeliveredUnits } from "@/lib/planning/circuit/delivery-core";
import { emitCircuitNotification } from "@/lib/planning/circuit/circuit-notifications";
import type { CircuitMovement } from "@/lib/planning/circuit/movements";
import type { PlanningActor, PlanningSector, PlanningWorkItemRecord } from "@/lib/planning/types";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";

export type CodificadoOriginSector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

export type HandoffCodificadoInput = {
  workItemId: string;
  totalUnits: number;
  observation?: string | null;
  /**
   * Handoff Envasado→Codificado es principalmente un cambio de estado —
   * "fill-once" igual que saveWorkProgressDurable: si la fila YA tiene un
   * valor persistido (cargado por Producción o completado antes vía
   * "Guardar avance"), este campo se ignora en silencio y jamás lo
   * sobreescribe ni lo borra. Si está vacío, Envasado puede completarlo acá
   * mismo al enviar. Para corregir un valor ya cargado, el único camino
   * sigue siendo updateWorkItemLoteVtoDurable (Producción, con motivo
   * auditado).
   */
  packagingLote?: string | null;
  /** ver packagingLote. */
  packagingVto?: string | null;
  packingGroups?: unknown;
  /** Unidades producidas pero no entregables (PARTE A). null = no informado. */
  sampleUnits?: number | null;
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
};

export type CancelCodificadoInput = {
  workItemId: string;
  reason?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
  /** Forzar retiro aunque Codificado ya haya terminado su parte, sin entrega registrada (RBAC). */
  forceWithdrawDelivery?: boolean;
};

function normalizeWorkItemId(raw: string): string {
  const t = String(raw ?? "").trim();
  if (t.startsWith("native:")) return t.slice("native:".length);
  return t;
}

export function mapItem(row: typeof workItems.$inferSelect): PlanningWorkItemRecord {
  return {
    id: row.id,
    planningWeekId: row.planningWeekId,
    plannedDate: String(row.plannedDate),
    plannedDateTo: row.plannedDateTo ? String(row.plannedDateTo) : null,
    client: row.client,
    product: row.product,
    plannedQuantity: row.plannedQuantity,
    unit: row.unit,
    sector: row.sector,
    line: row.line,
    branchOwner: row.branchOwner,
    priority: row.priority,
    notes: row.notes,
    packagingLote: row.packagingLote ?? null,
    packagingVto: row.packagingVto ?? null,
    packagingTotalUnits:
      row.packagingTotalUnits == null ? null : Number(row.packagingTotalUnits),
    packingGroups: (row.packingGroups as PlanningWorkItemRecord["packingGroups"]) ?? null,
    orderId: row.orderId ?? null,
    orderNumber: row.orderNumber ?? null,
    deliveryDate: row.deliveryDate ? String(row.deliveryDate) : null,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdBy: row.createdBy,
    source: row.source,
    originRef: row.originRef,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    viaCodificado: Boolean(row.viaCodificado),
    sentToCodificadoAt: row.sentToCodificadoAt
      ? row.sentToCodificadoAt.toISOString()
      : null,
    sentToCodificadoBy: row.sentToCodificadoBy ?? null,
    codificadoOriginSector: row.codificadoOriginSector ?? null,
    deliveredFromCodificadoAt: row.deliveredFromCodificadoAt
      ? row.deliveredFromCodificadoAt.toISOString()
      : null,
    deliveredFromCodificadoBy: row.deliveredFromCodificadoBy ?? null,
    codificadoObservation: row.codificadoObservation ?? null,
    bulkRemainderKg:
      row.bulkRemainderKg == null ? null : Number(row.bulkRemainderKg),
    bulkRemainderObservation: row.bulkRemainderObservation ?? null,
    bulkRemainderId: row.bulkRemainderId ?? null,
    homeLine: row.homeLine ?? null,
    homeBranchOwner: row.homeBranchOwner ?? null,
    codificadoRevision: Number(row.codificadoRevision ?? 0),
    codificadoCancelledAt: row.codificadoCancelledAt
      ? row.codificadoCancelledAt.toISOString()
      : null,
    productionPedidoId: row.productionPedidoId ?? null,
    // Avance operativo durable (0023) — faltaba en este mapper local desde
    // esa fase; sin esto la respuesta de send/deliver no reflejaba el
    // estado real hasta el próximo GET /work-items.
    operationalStatus: row.operationalStatus ?? "pendiente",
    finishedQty: row.finishedQty ?? null,
    operationalObservation: row.operationalObservation ?? null,
    packingMismatchObservation: row.packingMismatchObservation ?? null,
    progressUpdatedAt: row.progressUpdatedAt ? row.progressUpdatedAt.toISOString() : null,
    progressUpdatedBy: row.progressUpdatedBy ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completedBy: row.completedBy ?? null,
    operationalCancelledAt: row.operationalCancelledAt
      ? row.operationalCancelledAt.toISOString()
      : null,
    operationalCancelledBy: row.operationalCancelledBy ?? null,
    operationalCancelReason: row.operationalCancelReason ?? null,
    qualityStatus: row.qualityStatus ?? "pendiente",
    qualityDecidedAt: row.qualityDecidedAt ? row.qualityDecidedAt.toISOString() : null,
    qualityDecidedBy: row.qualityDecidedBy ?? null,
    qualityDecidedBySector: row.qualityDecidedBySector ?? null,
    qualityObservation: row.qualityObservation ?? null,
    qualityChangeReason: row.qualityChangeReason ?? null,
    // Cierre físico de acondicionamiento (0024 — PARTE A).
    sampleUnits: row.sampleUnits ?? null,
    deliverableUnits: row.deliverableUnits == null ? null : Number(row.deliverableUnits),
    packagingClosedAt: row.packagingClosedAt ? row.packagingClosedAt.toISOString() : null,
    packagingClosedBy: row.packagingClosedBy ?? null,
  };
}

/**
 * Quién puede ENVIAR a Codificado: el Envasado (Masivo/Premium) dueño del trabajo, o Producción/Dirección (mismo
 * criterio que el resto de las mutaciones: supervisan y pueden operar «pendientes de definir»). El resto, no.
 */
function assertCanSendToCodificado(actor: PlanningActor): string {
  const s = String(actor.sector ?? "").toUpperCase();
  if (s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM" || s === "PRODUCCION" || s === "DIRECCION") {
    return s;
  }
  throw new PlanningForbiddenError("No tenés permiso para enviar a Codificado.");
}

async function touchPedidoEnEnvasado(
  tx: ReturnType<typeof getDb>,
  workItemId: string,
  pedidoId: string | null | undefined,
  actor: PlanningActor,
  event: string
) {
  if (!pedidoId) return;
  const [pedido] = await tx
    .select()
    .from(productionPedidos)
    .where(and(eq(productionPedidos.id, pedidoId), sql`${productionPedidos.deletedAt} IS NULL`))
    .limit(1);
  if (!pedido) return;
  if (pedido.estado === "ENTREGADO") return;
  const from = pedido.estado;
  if (from === "EN_ENVASADO") return;
  await tx
    .update(productionPedidos)
    .set({ estado: "EN_ENVASADO", updatedBy: actor.email, updatedAt: new Date() })
    .where(eq(productionPedidos.id, pedidoId));
  await tx.insert(productionPedidoStatusEvents).values({
    pedidoId,
    workItemId,
    fromEstado: from,
    toEstado: "EN_ENVASADO",
    actorEmail: actor.email,
    actorSector: actor.sector,
    event,
    motivo: normalizeOptionalReason(null),
  });
}

/**
 * Cuerpo transaccional del envío a Codificado — extraído tal cual de handoffToCodificadoDurable para que el envío
 * masivo (bulk-pending-actions-service) lo ejecute dentro de UNA transacción propia con las MISMAS reglas.
 */
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function handoffToCodificadoInTx(
  tx: DbTx,
  input: HandoffCodificadoInput,
  actor: PlanningActor,
  operationId: string
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const actorSectorUpper = assertCanSendToCodificado(actor);
  const id = normalizeWorkItemId(input.workItemId);
  const key = input.idempotencyKey.trim();
  const idemRef = `codificado:send:${key}`;
  const [priorEvent] = await tx
    .select()
    .from(operationalEvents)
    .where(
      and(
        eq(operationalEvents.type, "SENT_TO_CODIFICADO"),
        eq(operationalEvents.note, idemRef)
      )
    )
    .limit(1);
  if (priorEvent?.workItemId) {
    const [existing] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, priorEvent.workItemId))
      .limit(1);
    if (existing) {
      return { item: mapItem(existing), replayed: true, operationId };
    }
  }

  // FOR UPDATE: serializa con una entrega concurrente; sin esto podía pisarse un `entregado` recién commiteado
  // con el operationalStatus viejo.
  const [row] = await tx
    .select()
    .from(workItems)
    .where(eq(workItems.id, id))
    .for("update")
    .limit(1);
  if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
  if (row.status !== "PUBLICADO") {
    throw new PlanningValidationError("Solo se pueden enviar trabajos publicados.");
  }
  if (row.operationalStatus === "entregado") {
    throw new PlanningValidationError("Este trabajo ya está entregado: no se puede enviar a Codificado.");
  }
  const [activeDelivery] = await tx
    .select({ id: workItemDeliveries.id, deliveryComplete: workItemDeliveries.deliveryComplete })
    .from(workItemDeliveries)
    .where(
      and(
        eq(workItemDeliveries.workItemId, id),
        eq(workItemDeliveries.status, "ENTREGADO"),
        eq(workItemDeliveries.archived, false)
      )
    )
    .limit(1);
  if (activeDelivery && activeDelivery.deliveryComplete) {
    throw new PlanningValidationError("Este trabajo ya tiene su entrega completa: no se puede enviar a Codificado.");
  }
  // Con una parcial ya entregada desde Envasado, lo que se envía a Codificado es el RESTO: el total no puede ser
  // menor a lo ya entregado (se perderían unidades de la cuenta) y el saldo debe quedar coherente.
  const alreadyDelivered = activeDelivery ? await sumActiveDeliveredUnits(tx, id) : 0;
  if (alreadyDelivered > 0 && input.totalUnits < alreadyDelivered - 1e-6) {
    throw new PlanningValidationError(
      `La cantidad total (${input.totalUnits}) es menor a lo ya entregado desde Envasado (${alreadyDelivered}). Indicá un total igual o mayor.`
    );
  }
  if (row.deliveredFromCodificadoAt) {
    throw new PlanningValidationError(
      "Este trabajo ya fue entregado desde Codificado."
    );
  }
  if (
    input.expectedVersion != null &&
    Number(input.expectedVersion) !== Number(row.version)
  ) {
    throw new PlanningConflictError(
      "El trabajo cambió. Recargá e intentá de nuevo.",
      mapItem(row)
    );
  }

  // Idempotente: ya en Codificado vía handoff activo.
  if (
    row.sector === "CODIFICADO" &&
    row.viaCodificado &&
    row.sentToCodificadoAt &&
    !row.codificadoCancelledAt
  ) {
    return { item: mapItem(row), replayed: true, operationId };
  }

  const fromSector = row.viaCodificado
    ? (row.codificadoOriginSector as PlanningSector | null) ?? row.sector
    : row.sector;

  if (fromSector !== "ENVASADO_MASIVO" && fromSector !== "ENVASADO_PREMIUM") {
    if (row.sector === "CODIFICADO" && !row.viaCodificado) {
      throw new PlanningValidationError(
        "Este trabajo fue asignado directo a Codificado; no se reenvía desde Envasado."
      );
    }
    throw new PlanningValidationError(
      "Solo trabajos de Envasado Masivo/Premium pueden enviarse a Codificado."
    );
  }

  // Solo el Envasado propietario (o Producción/Dirección) puede enviar; reenviar respeta el origen.
  if (
    actorSectorUpper !== "PRODUCCION" &&
    actorSectorUpper !== "DIRECCION" &&
    actorSectorUpper !== fromSector
  ) {
    throw new PlanningForbiddenError(
      "Solo el Envasado propietario puede enviar este trabajo a Codificado."
    );
  }

  // Validación mínima y única del total: debe ser compatible con las cantidades disponibles del trabajo (lo
  // producido declarado y, si todavía no se declaró, lo planificado). Sin cajas ni desglose.
  const availableQty =
    parseQuantity(row.finishedQty, row.unit) ?? parseQuantity(row.plannedQuantity, row.unit);
  if (availableQty != null && availableQty > 0 && input.totalUnits > availableQty + 1e-6) {
    throw new PlanningValidationError(
      `La cantidad total (${input.totalUnits}) supera la cantidad disponible del trabajo (${availableQty}). Registrá primero lo realmente producido con «Guardar avance».`
    );
  }

  const isResend = Boolean(row.viaCodificado && row.codificadoCancelledAt);
  const homeLine = row.homeLine ?? row.line;
  const homeBranch = row.homeBranchOwner ?? row.branchOwner;
  const now = new Date();
  const nextRevision = isResend
    ? Number(row.codificadoRevision ?? 0) + 1
    : Math.max(1, Number(row.codificadoRevision ?? 0) || 1);

  const nextPackingGroups =
    input.packingGroups != null ? input.packingGroups : row.packingGroups;
  const nextSampleUnits = input.sampleUnits != null ? input.sampleUnits : row.sampleUnits;
  const nextObservation = input.observation?.trim() || row.codificadoObservation || null;
  // EXCEPCIÓN DE CAJAS (solo Envasado→Codificado): NO se exigen cajas, distribución ni unidades por caja y NO se
  // valida la distribución; alcanza la cantidad total (validada arriba: > 0). Si el trabajo trae una distribución
  // REAL que coincide con el total se registra el cierre; si no, no se inventa ni se rechaza nada. Reglas de
  // muestras intactas (sampleUnits se conserva como metadata).
  const close = closeForCodificadoTransfer({
    totalUnits: input.totalUnits,
    sampleUnits: nextSampleUnits,
    packingGroups: nextPackingGroups,
  });
  const closedByName = actor.displayName || actor.email;

  // Lote/VTO "fill-once": si ya hay un valor persistido, se preserva tal
  // cual (nunca se sobreescribe). Si está vacío, Envasado puede
  // completarlo en el momento de enviar a Codificado — se persiste en el
  // MISMO work item, sin depender de haber pasado antes por "Guardar
  // avance".
  const filledLote =
    !row.packagingLote && input.packagingLote?.trim() ? input.packagingLote.trim() : null;
  const filledVto =
    !row.packagingVto && input.packagingVto?.trim() ? input.packagingVto.trim() : null;

  const [updated] = await tx
    .update(workItems)
    .set({
      sector: "CODIFICADO",
      line: null,
      branchOwner: null,
      homeLine,
      homeBranchOwner: homeBranch,
      viaCodificado: true,
      codificadoOriginSector: fromSector,
      sentToCodificadoAt: now,
      sentToCodificadoBy: actor.displayName || actor.email,
      packagingTotalUnits: input.totalUnits,
      packagingLote: filledLote ?? row.packagingLote,
      packagingVto: filledVto ?? row.packagingVto,
      packingGroups: nextPackingGroups,
      sampleUnits: nextSampleUnits,
      deliverableUnits: close.deliverableUnits === undefined ? row.deliverableUnits : close.deliverableUnits,
      packagingClosedAt: close.closed ? now : row.packagingClosedAt,
      packagingClosedBy: close.closed ? closedByName : row.packagingClosedBy,
      // Un trabajo «pendiente de definir» (terminado sin destino) que se envía a Codificado vuelve a estar en curso.
      operationalStatus:
        row.operationalStatus === "revision" || row.operationalStatus === "completo"
          ? "en_curso"
          : row.operationalStatus,
      completedAt: row.operationalStatus === "revision" || row.operationalStatus === "completo" ? null : row.completedAt,
      completedBy: row.operationalStatus === "revision" || row.operationalStatus === "completo" ? null : row.completedBy,
      codificadoObservation: nextObservation,
      bulkRemainderKg:
        input.bulkRemainderKg != null
          ? input.bulkRemainderKg
          : row.bulkRemainderKg,
      bulkRemainderObservation:
        input.bulkRemainderObservation?.trim() ||
        row.bulkRemainderObservation ||
        null,
      bulkRemainderId: input.bulkRemainderId ?? row.bulkRemainderId,
      codificadoRevision: nextRevision,
      codificadoCancelledAt: null,
      codificadoCancelledBy: null,
      codificadoCancelReason: null,
      version: Number(row.version) + 1,
      updatedAt: now,
    })
    .where(eq(workItems.id, id))
    .returning();

  await tx.insert(operationalEvents).values({
    workItemId: id,
    planningWeekId: row.planningWeekId,
    type: isResend ? "RESENT_TO_CODIFICADO" : "SENT_TO_CODIFICADO",
    fromStatus: row.sector,
    toStatus: "EN_CODIFICADO",
    actorEmail: actor.email,
    actorSector: actor.sector,
    note: idemRef,
  });

  if (filledLote || filledVto) {
    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "LOTE_VTO_FILLED",
      fromStatus: JSON.stringify({
        lote: row.packagingLote ?? null,
        vto: row.packagingVto ?? null,
      }),
      toStatus: JSON.stringify({
        lote: updated.packagingLote ?? null,
        vto: updated.packagingVto ?? null,
      }),
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: "Completado por Envasado al enviar a Codificado — Producción no lo había cargado.",
    });
  }

  await touchPedidoEnEnvasado(
    tx as unknown as ReturnType<typeof getDb>,
    id,
    updated.productionPedidoId,
    actor,
    isResend ? "RESENT_TO_CODIFICADO" : "SENT_TO_CODIFICADO"
  );

  return { item: mapItem(updated), replayed: false, operationId };
}

/**
 * Envasado → Codificado durable. Mismo workItemId; sector actual = CODIFICADO.
 */
export async function handoffToCodificadoDurable(
  input: HandoffCodificadoInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const actorSectorUpper = assertCanSendToCodificado(actor);
  const id = normalizeWorkItemId(input.workItemId);
  if (!id) throw new PlanningValidationError("workItemId requerido.");
  if (!Number.isFinite(input.totalUnits) || input.totalUnits <= 0) {
    throw new PlanningValidationError("La cantidad total debe ser mayor que 0.");
  }
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new PlanningValidationError("idempotencyKey inválida (8–128).");
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => handoffToCodificadoInTx(tx, input, actor, operationId));

  // Aviso a Producción fuera de la transacción (un fallo del aviso nunca bloquea el envío). Se emite también en
  // el replay: el id es determinístico, así que no duplica y recupera un aviso que hubiera fallado antes.
  const movement: CircuitMovement = {
    type: result.item.codificadoRevision && result.item.codificadoRevision > 1 ? "CODIFICADO_REENVIO" : "ENVASADO_A_CODIFICADO",
    workItemId: id,
    eventKey: key,
    fromSector: result.item.codificadoOriginSector ?? actorSectorUpper,
    toSector: "CODIFICADO",
    client: result.item.client,
    product: result.item.product,
    quantity: input.totalUnits,
    unit: result.item.unit,
    lote: result.item.packagingLote ?? null,
    at: new Date(),
    actorName: actor.displayName || actor.email,
    actorEmail: actor.email,
  };
  await emitCircuitNotification(movement);
  return result;
}

/**
 * Cancela envío a Codificado y devuelve el trabajo al Envasado de origen.
 */
export async function cancelCodificadoHandoffDurable(
  input: CancelCodificadoInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const sector = String(actor.sector ?? "").toUpperCase();
  const isSuper =
    sector === "DIRECCION" || sector === "PRODUCCION" || sector === "SUPERADMIN";
  const id = normalizeWorkItemId(input.workItemId);
  if (!id) throw new PlanningValidationError("workItemId requerido.");
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new PlanningValidationError("idempotencyKey inválida (8–128).");
  }
  const reason = normalizeOptionalReason(input.reason);

  const db = getDb();
  return db.transaction(async (tx) => {
    const idemRef = `codificado:cancel:${key}`;
    const [priorEvent] = await tx
      .select()
      .from(operationalEvents)
      .where(
        and(
          or(
            eq(operationalEvents.type, "CANCEL_CODIFICADO_HANDOFF"),
            eq(operationalEvents.type, "WITHDRAW_CODIFICADO_DELIVERY")
          ),
          eq(operationalEvents.note, idemRef)
        )
      )
      .limit(1);
    if (priorEvent?.workItemId) {
      const [existing] = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.id, priorEvent.workItemId))
        .limit(1);
      if (existing) {
        return { item: mapItem(existing), replayed: true, operationId };
      }
    }

    const [row] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");

    if (row.codificadoCancelledAt && row.sector !== "CODIFICADO") {
      return { item: mapItem(row), replayed: true, operationId };
    }

    if (!row.viaCodificado || !row.sentToCodificadoAt) {
      throw new PlanningValidationError(
        "Este trabajo no tiene un envío activo a Codificado."
      );
    }

    const origin = String(row.codificadoOriginSector ?? "").toUpperCase();
    const isOwner =
      sector === origin ||
      (sector === "ENVASADO_MASIVO" && origin === "ENVASADO_MASIVO") ||
      (sector === "ENVASADO_PREMIUM" && origin === "ENVASADO_PREMIUM");

    if (!isOwner && !isSuper) {
      throw new PlanningForbiddenError(
        "Solo Envasado propietario, Producción o SUPERADMIN pueden cancelar el envío."
      );
    }

    const [activeDelivery] = await tx
      .select({ id: workItemDeliveries.id })
      .from(workItemDeliveries)
      .where(
        and(
          eq(workItemDeliveries.workItemId, id),
          eq(workItemDeliveries.status, "ENTREGADO"),
          eq(workItemDeliveries.archived, false)
        )
      )
      .limit(1);
    if (activeDelivery) {
      throw new PlanningValidationError(
        "El trabajo ya tiene entregas registradas. Anulá la entrega desde Entregados antes de cancelar el envío a Codificado."
      );
    }
    if (row.deliveredFromCodificadoAt) {
      if (!input.forceWithdrawDelivery || !isSuper) {
        throw new PlanningForbiddenError(
          "El trabajo ya terminó su paso por Codificado. Usá “Retirar entrega para corregir” (Producción/SUPERADMIN)."
        );
      }
    }

    if (
      input.expectedVersion != null &&
      Number(input.expectedVersion) !== Number(row.version)
    ) {
      throw new PlanningConflictError(
        "El trabajo cambió. Recargá e intentá de nuevo.",
        mapItem(row)
      );
    }

    if (origin !== "ENVASADO_MASIVO" && origin !== "ENVASADO_PREMIUM") {
      throw new PlanningValidationError("Origen de Envasado inválido para cancelar.");
    }

    const homeLine = row.homeLine;
    if (!homeLine) {
      throw new PlanningValidationError(
        "No se puede restaurar la línea de Envasado (home_line ausente)."
      );
    }

    const now = new Date();
    const eventType = row.deliveredFromCodificadoAt
      ? "WITHDRAW_CODIFICADO_DELIVERY"
      : "CANCEL_CODIFICADO_HANDOFF";

    const [updated] = await tx
      .update(workItems)
      .set({
        sector: origin as "ENVASADO_MASIVO" | "ENVASADO_PREMIUM",
        line: homeLine,
        branchOwner: null,
        viaCodificado: true, // conserva historial; sentAt se mantiene
        codificadoCancelledAt: now,
        codificadoCancelledBy: actor.displayName || actor.email,
        codificadoCancelReason: reason,
        deliveredFromCodificadoAt: null,
        deliveredFromCodificadoBy: null,
        // Sent markers cleared so Codificado list drops it; history in events.
        sentToCodificadoAt: null,
        sentToCodificadoBy: null,
        version: Number(row.version) + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: eventType,
      fromStatus: "EN_CODIFICADO",
      toStatus: origin,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `${idemRef} | ${reason}`,
    });

    // Pedido permanece EN_ENVASADO si estaba en ese estado.
    await touchPedidoEnEnvasado(
      tx as unknown as ReturnType<typeof getDb>,
      id,
      updated.productionPedidoId,
      actor,
      eventType
    );

    return { item: mapItem(updated), replayed: false, operationId };
  });
}

/**
 * Codificado ENTREGA — circuito sin Calidad: registra AUTOMÁTICAMENTE la entrega final (sin aprobación previa),
 * en la MISMA transacción que el cierre de Codificado. Contabiliza las unidades efectivamente entregadas, deja el
 * trabajo en `entregado` (o con saldo si la entrega es parcial), cierra el pedido cuando corresponde, y avisa a
 * Producción. Idempotente por `idempotencyKey` (misma clave = misma entrega).
 *
 * EXCEPCIÓN DE CAJAS: Codificado recibe la cantidad total y NO necesita cajas ni distribución — una distribución
 * ausente o incompleta jamás genera un error de «distribución incorrecta».
 */
export async function deliverFromCodificadoDurable(
  input: {
    workItemId: string;
    observation?: string | null;
    /** ver HandoffCodificadoInput.packagingLote — mismo contrato "fill-once". */
    packagingLote?: string | null;
    /** ver HandoffCodificadoInput.packagingVto. */
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packingGroups?: unknown;
    /** Unidades producidas pero no entregables (PARTE A). null = no informado. */
    sampleUnits?: number | null;
    expectedVersion?: number | null;
    idempotencyKey: string;
    /** Entrega parcial: unidades entregadas ahora. null = todo el saldo. */
    deliverQuantity?: number | null;
    deliveryPackingGroups?: unknown;
    remito?: string | null;
    receivedBy?: string | null;
    plannedDeliveryDate?: string | null;
    actualDeliveredAt?: string | null;
  },
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{
  item: PlanningWorkItemRecord;
  replayed: boolean;
  operationId: string;
  complete: boolean;
  delivered: number | null;
  pending: number | null;
  deliveryId: string | null;
}> {
  const sector = String(actor.sector ?? "").toUpperCase();
  if (sector !== "CODIFICADO" && sector !== "PRODUCCION" && sector !== "DIRECCION") {
    throw new PlanningForbiddenError("Solo Codificado puede entregar.");
  }
  const id = normalizeWorkItemId(input.workItemId);
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8) {
    throw new PlanningValidationError("idempotencyKey inválida.");
  }

  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const idemRef = `codificado:deliver:${key}`;
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (row.sector !== "CODIFICADO") {
      throw new PlanningValidationError("El trabajo no está en Codificado.");
    }
    if (row.codificadoCancelledAt) {
      throw new PlanningValidationError("El envío a Codificado fue cancelado.");
    }

    const nextObservation = input.observation?.trim() || row.codificadoObservation || null;

    const result = await recordDeliveryInTx(tx, {
      workItemId: id,
      actor: { email: actor.email, sector: actor.sector, displayName: actor.displayName },
      idempotencyKey: `codificado:${key}`,
      quantity: input.deliverQuantity ?? null,
      deliveryPackingGroups: input.deliveryPackingGroups ?? null,
      codigo: null,
      plannedDeliveryDate: input.plannedDeliveryDate ?? null,
      actualDeliveredAt: input.actualDeliveredAt ?? null,
      remito: input.remito ?? null,
      receivedBy: input.receivedBy ?? null,
      observations: input.observation ?? null,
      completion: {
        finishedQty:
          input.packagingTotalUnits != null ? String(input.packagingTotalUnits) : undefined,
        observation: input.observation ?? null,
        packagingLote: input.packagingLote ?? null,
        packagingVto: input.packagingVto ?? null,
        packagingTotalUnits: input.packagingTotalUnits ?? null,
        packingGroups: input.packingGroups ?? null,
        sampleUnits: input.sampleUnits ?? null,
      },
      extraItemPatch: { codificadoObservation: nextObservation },
      skipBoxValidation: true,
      movementType: sector === "CODIFICADO" ? "CODIFICADO_ENTREGA" : "PRODUCCION_ENTREGA",
    });

    if (!result.replayed) {
      await tx.insert(operationalEvents).values({
        workItemId: id,
        planningWeekId: row.planningWeekId,
        type: "DELIVERED_FROM_CODIFICADO",
        fromStatus: "EN_CODIFICADO",
        toStatus: result.complete ? "ENTREGADO" : "ENTREGA_PARCIAL",
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: idemRef,
      });
      const filledLote = !row.packagingLote && input.packagingLote?.trim() ? input.packagingLote.trim() : null;
      const filledVto = !row.packagingVto && input.packagingVto?.trim() ? input.packagingVto.trim() : null;
      if (filledLote || filledVto) {
        await tx.insert(operationalEvents).values({
          workItemId: id,
          planningWeekId: row.planningWeekId,
          type: "LOTE_VTO_FILLED",
          fromStatus: JSON.stringify({ lote: row.packagingLote ?? null, vto: row.packagingVto ?? null }),
          toStatus: JSON.stringify({
            lote: result.item.packagingLote ?? null,
            vto: result.item.packagingVto ?? null,
          }),
          actorEmail: actor.email,
          actorSector: actor.sector,
          note: "Completado por Codificado al entregar — Producción no lo había cargado.",
        });
      }
    }
    return result;
  });

  // Aviso a Producción fuera de la transacción: un fallo del aviso nunca bloquea la entrega.
  if (outcome.movement) await emitCircuitNotification(outcome.movement);
  await emitBillingForDelivery(outcome, actor.displayName || actor.email);

  return {
    item: mapItem(outcome.item),
    replayed: outcome.replayed,
    operationId,
    complete: outcome.complete,
    delivered: outcome.delivered,
    pending: outcome.pending,
    deliveryId: outcome.delivery?.id ?? null,
  };
}

export type ReopenCodificadoDeliveryInput = {
  workItemId: string;
  reason?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
};

/**
 * "Rehacer entrega" — deshace el cierre de Codificado (terminado sin entrega registrada) y
 * deja el trabajo editable de nuevo, SIN mover el sector (a diferencia de
 * cancelCodificadoHandoffDurable/WITHDRAW_CODIFICADO_DELIVERY, que expulsa
 * el trabajo de vuelta a Envasado). No borra cajas, muestras, lote/VTO, OA
 * ni observaciones — solo limpia las marcas de entrega y completado.
 *
 * Bloqueada explícitamente (no auto-corrige, no borra en silencio) si:
 *  - ya existe una entrega real a cliente en work_item_deliveries.
 */
export async function reopenCodificadoDeliveryDurable(
  input: ReopenCodificadoDeliveryInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const sector = String(actor.sector ?? "").toUpperCase();
  if (sector !== "CODIFICADO" && sector !== "PRODUCCION" && sector !== "DIRECCION") {
    throw new PlanningForbiddenError("Solo Codificado puede rehacer su propia entrega.");
  }
  const id = normalizeWorkItemId(input.workItemId);
  if (!id) throw new PlanningValidationError("workItemId requerido.");
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8) {
    throw new PlanningValidationError("idempotencyKey inválida.");
  }
  const reason = normalizeOptionalReason(input.reason);

  const db = getDb();
  return db.transaction(async (tx) => {
    const idemRef = `codificado:reopen:${key}`;
    const [prior] = await tx
      .select()
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.type, "REOPENED_CODIFICADO_DELIVERY"),
          eq(operationalEvents.note, idemRef)
        )
      )
      .limit(1);
    if (prior?.workItemId) {
      const [existing] = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.id, prior.workItemId))
        .limit(1);
      if (existing) return { item: mapItem(existing), replayed: true, operationId };
    }

    const [row] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (
      input.expectedVersion != null &&
      Number(input.expectedVersion) !== Number(row.version)
    ) {
      throw new PlanningConflictError(
        "El trabajo cambió. Recargá e intentá de nuevo.",
        mapItem(row)
      );
    }
    const [activeDelivery] = await tx
      .select()
      .from(workItemDeliveries)
      .where(
        and(
          eq(workItemDeliveries.workItemId, id),
          eq(workItemDeliveries.status, "ENTREGADO"),
          eq(workItemDeliveries.archived, false)
        )
      )
      .limit(1);
    const eligibility = canReopenCodificadoDelivery({
      sector: row.sector,
      deliveredFromCodificadoAt: row.deliveredFromCodificadoAt
        ? row.deliveredFromCodificadoAt.toISOString()
        : null,
      codificadoCancelledAt: row.codificadoCancelledAt
        ? row.codificadoCancelledAt.toISOString()
        : null,
      qualityStatus: row.qualityStatus,
      hasActiveClientDelivery: Boolean(activeDelivery),
    });
    if (!eligibility.ok || !row.deliveredFromCodificadoAt) {
      throw new PlanningValidationError(
        !eligibility.ok ? eligibility.error : "Este trabajo no fue entregado — no hay nada que rehacer."
      );
    }

    const now = new Date();
    const prevDeliveredAt = row.deliveredFromCodificadoAt.toISOString();
    const prevDeliveredBy = row.deliveredFromCodificadoBy ?? "?";

    const [updated] = await tx
      .update(workItems)
      .set({
        deliveredFromCodificadoAt: null,
        deliveredFromCodificadoBy: null,
        // completedAt se limpia junto con deliveredFromCodificadoAt para que el trabajo
        // deje de figurar como terminado mientras Codificado lo vuelve a editar;
        // deliverFromCodificadoDurable lo vuelve a fijar en la re-entrega.
        completedAt: null,
        completedBy: null,
        operationalStatus:
          row.operationalStatus === "revision" ? "en_curso" : row.operationalStatus,
        version: Number(row.version) + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "REOPENED_CODIFICADO_DELIVERY",
      fromStatus: "TERMINADO_CODIFICADO",
      toStatus: "EN_CODIFICADO",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `${idemRef} | entrega anterior ${prevDeliveredAt} por ${prevDeliveredBy}${reason ? ` | motivo: ${reason}` : ""}`,
    });

    return { item: mapItem(updated), replayed: false, operationId };
  });
}
