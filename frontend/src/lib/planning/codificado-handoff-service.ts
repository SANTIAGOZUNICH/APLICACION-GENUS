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
import { computePackagingClose, normalizePackingGroups } from "@/lib/remitos/packing-math";
import type { PlanningActor, PlanningSector, PlanningWorkItemRecord } from "@/lib/planning/types";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";

/**
 * Valida el cierre físico (PARTE A) antes de dejar avanzar un handoff.
 * Excepción ya autorizada en el sistema existente (no se inventa una
 * nueva): si hay una observación de embalaje, se documenta el mismatch y
 * se permite continuar — mismo criterio que packaging-quantities-block.tsx
 * ya aplicaba para el guardado intermedio (requireObservationOnMismatch).
 */
function assertPackagingCloseOrExplained(params: {
  finishedQty: number | null | undefined;
  sampleUnits: number | null | undefined;
  packingGroups: unknown;
  observation: string | null | undefined;
}): ReturnType<typeof computePackagingClose> {
  const groups = normalizePackingGroups(
    (params.packingGroups as Array<{ cajas?: number; unidadesPorCaja?: number }>) ?? []
  );
  const close = computePackagingClose({
    finishedQty: params.finishedQty,
    sampleUnits: params.sampleUnits,
    groups,
  });
  if (close.canValidate && !close.isValid && !params.observation?.trim()) {
    const faltan = close.diferencia;
    throw new PlanningValidationError(
      faltan > 0
        ? `La distribución no coincide con la cantidad final: faltan distribuir ${faltan} unidad(es) (cajas + muestras = ${close.totalAcondicionado}, esperado ${params.finishedQty}). Indicá una observación si es una excepción justificada.`
        : `La distribución supera la cantidad final por ${Math.abs(faltan)} unidad(es) (cajas + muestras = ${close.totalAcondicionado}, esperado ${params.finishedQty}). Indicá una observación si es una excepción justificada.`
    );
  }
  return close;
}

export type CodificadoOriginSector = "ENVASADO_MASIVO" | "ENVASADO_PREMIUM";

export type HandoffCodificadoInput = {
  workItemId: string;
  totalUnits: number;
  observation?: string | null;
  /**
   * @deprecated Lote/VTO ya no son editables desde Envasado/Codificado —
   * la fuente única es lo que Producción cargó al asignar. Se ignoran acá
   * a propósito (ver PARTE A: "Lote y VTO — fuente única"); el campo queda
   * tipado por compat con clientes viejos pero el server nunca lo aplica.
   */
  packagingLote?: string | null;
  /** @deprecated ver packagingLote. */
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
  /** Forzar retiro aunque haya avance o entrega a Calidad (RBAC). */
  forceWithdrawDelivery?: boolean;
};

function normalizeWorkItemId(raw: string): string {
  const t = String(raw ?? "").trim();
  if (t.startsWith("native:")) return t.slice("native:".length);
  return t;
}

function mapItem(row: typeof workItems.$inferSelect): PlanningWorkItemRecord {
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

function assertEnvasadoActor(actor: PlanningActor): CodificadoOriginSector {
  const s = String(actor.sector ?? "").toUpperCase();
  if (s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM") {
    return s;
  }
  if (s === "PRODUCCION" || s === "DIRECCION") {
    // Producción puede operar cancel/resend; envío originario lo hace Envasado.
    throw new PlanningForbiddenError(
      "El envío a Codificado debe originarse en Envasado Masivo o Premium."
    );
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

async function touchPedidoListoParaEntregar(
  tx: ReturnType<typeof getDb>,
  workItemId: string,
  pedidoId: string | null | undefined,
  actor: PlanningActor
) {
  if (!pedidoId) return;
  const [pedido] = await tx
    .select()
    .from(productionPedidos)
    .where(and(eq(productionPedidos.id, pedidoId), sql`${productionPedidos.deletedAt} IS NULL`))
    .limit(1);
  if (!pedido || pedido.estado === "ENTREGADO") return;
  const from = pedido.estado;
  if (from === "LISTO_PARA_ENTREGAR") return;
  await tx
    .update(productionPedidos)
    .set({
      estado: "LISTO_PARA_ENTREGAR",
      updatedBy: actor.email,
      updatedAt: new Date(),
    })
    .where(eq(productionPedidos.id, pedidoId));
  await tx.insert(productionPedidoStatusEvents).values({
    pedidoId,
    workItemId,
    fromEstado: from,
    toEstado: "LISTO_PARA_ENTREGAR",
    actorEmail: actor.email,
    actorSector: actor.sector,
    event: "DELIVERED_TO_QUALITY",
    motivo: normalizeOptionalReason(null),
  });
}

/**
 * Envasado → Codificado durable. Mismo workItemId; sector actual = CODIFICADO.
 */
export async function handoffToCodificadoDurable(
  input: HandoffCodificadoInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const origin = assertEnvasadoActor(actor);
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
  return db.transaction(async (tx) => {
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

    const [row] = await tx
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (row.status !== "PUBLICADO") {
      throw new PlanningValidationError("Solo se pueden enviar trabajos publicados.");
    }
    if (row.deliveredFromCodificadoAt) {
      throw new PlanningValidationError(
        "Este trabajo ya fue entregado a Calidad desde Codificado."
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

    if (origin !== fromSector && !row.viaCodificado) {
      // Solo el sector propietario puede enviar; cancel/reenviar respeta origen.
      if (String(actor.sector).toUpperCase() !== fromSector) {
        throw new PlanningForbiddenError(
          "Solo el Envasado propietario puede enviar este trabajo a Codificado."
        );
      }
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
    const nextSampleUnits = input.sampleUnits !== undefined ? input.sampleUnits : row.sampleUnits;
    const nextObservation = input.observation?.trim() || row.codificadoObservation || null;
    // La observación que justifica un mismatch puede venir del campo general
    // (codificadoObservation) o de la observación específica de embalaje ya
    // guardada por PackagingQuantitiesBlock (packingMismatchObservation) —
    // misma excepción ya autorizada, dos campos de origen distintos.
    const close = assertPackagingCloseOrExplained({
      finishedQty: input.totalUnits,
      sampleUnits: nextSampleUnits,
      packingGroups: nextPackingGroups,
      observation: nextObservation || row.packingMismatchObservation,
    });
    const closedByName = actor.displayName || actor.email;

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
        // Lote/VTO: fuente única = Producción. Nunca se sobrescriben desde
        // Envasado/Codificado (PARTE A) — se ignora cualquier valor entrante.
        packagingLote: row.packagingLote,
        packagingVto: row.packagingVto,
        packingGroups: nextPackingGroups,
        sampleUnits: nextSampleUnits,
        deliverableUnits: close.canValidate ? close.enCajas : null,
        packagingClosedAt: close.canValidate ? now : row.packagingClosedAt,
        packagingClosedBy: close.canValidate ? closedByName : row.packagingClosedBy,
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

    await touchPedidoEnEnvasado(
      tx as unknown as ReturnType<typeof getDb>,
      id,
      updated.productionPedidoId,
      actor,
      isResend ? "RESENT_TO_CODIFICADO" : "SENT_TO_CODIFICADO"
    );

    return { item: mapItem(updated), replayed: false, operationId };
  });
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

    if (row.deliveredFromCodificadoAt) {
      if (!input.forceWithdrawDelivery || !isSuper) {
        throw new PlanningForbiddenError(
          "El trabajo ya fue entregado a Calidad. Usá “Retirar entrega para corregir” (Producción/SUPERADMIN)."
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
 * Codificado entrega a Calidad — marca Neon + pedido LISTO_PARA_ENTREGAR.
 */
export async function deliverFromCodificadoDurable(
  input: {
    workItemId: string;
    observation?: string | null;
    /** @deprecated ver HandoffCodificadoInput.packagingLote — ignorado a propósito. */
    packagingLote?: string | null;
    /** @deprecated ver HandoffCodificadoInput.packagingVto — ignorado a propósito. */
    packagingVto?: string | null;
    packagingTotalUnits?: number | null;
    packingGroups?: unknown;
    /** Unidades producidas pero no entregables (PARTE A). null = no informado. */
    sampleUnits?: number | null;
    expectedVersion?: number | null;
    idempotencyKey: string;
  },
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<{ item: PlanningWorkItemRecord; replayed: boolean; operationId: string }> {
  const sector = String(actor.sector ?? "").toUpperCase();
  if (
    sector !== "CODIFICADO" &&
    sector !== "PRODUCCION" &&
    sector !== "DIRECCION"
  ) {
    throw new PlanningForbiddenError("Solo Codificado puede entregar a Calidad.");
  }
  const id = normalizeWorkItemId(input.workItemId);
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8) {
    throw new PlanningValidationError("idempotencyKey inválida.");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const idemRef = `codificado:deliver:${key}`;
    const [prior] = await tx
      .select()
      .from(operationalEvents)
      .where(
        and(
          eq(operationalEvents.type, "DELIVERED_FROM_CODIFICADO"),
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
    if (row.sector !== "CODIFICADO") {
      throw new PlanningValidationError("El trabajo no está en Codificado.");
    }
    if (row.codificadoCancelledAt) {
      throw new PlanningValidationError("El envío a Codificado fue cancelado.");
    }
    if (row.deliveredFromCodificadoAt) {
      return { item: mapItem(row), replayed: true, operationId };
    }

    const now = new Date();
    const deliveredByName = actor.displayName || actor.email;
    const nextTotalUnits =
      input.packagingTotalUnits != null ? input.packagingTotalUnits : row.packagingTotalUnits;
    const nextPackingGroups =
      input.packingGroups != null ? input.packingGroups : row.packingGroups;
    const nextSampleUnits = input.sampleUnits !== undefined ? input.sampleUnits : row.sampleUnits;
    const nextObservation = input.observation?.trim() || row.codificadoObservation || null;
    const close = assertPackagingCloseOrExplained({
      finishedQty: nextTotalUnits != null ? Number(nextTotalUnits) : null,
      sampleUnits: nextSampleUnits,
      packingGroups: nextPackingGroups,
      observation: nextObservation || row.packingMismatchObservation,
    });
    const [updated] = await tx
      .update(workItems)
      .set({
        deliveredFromCodificadoAt: now,
        deliveredFromCodificadoBy: deliveredByName,
        // Lote/VTO: fuente única = Producción (PARTE A) — nunca sobrescritos acá.
        packagingLote: row.packagingLote,
        packagingVto: row.packagingVto,
        packagingTotalUnits: nextTotalUnits,
        packingGroups: nextPackingGroups,
        sampleUnits: nextSampleUnits,
        deliverableUnits: close.canValidate ? close.enCajas : row.deliverableUnits,
        packagingClosedAt: close.canValidate ? now : row.packagingClosedAt,
        packagingClosedBy: close.canValidate ? deliveredByName : row.packagingClosedBy,
        codificadoObservation: nextObservation,
        // Marca el work item como "completado, pendiente de revisión" en la
        // MISMA transacción — antes esto dependía de un POST secundario
        // fire-and-forget (postCompleteWork) desde el cliente; si fallaba,
        // el handoff quedaba "entregado" pero invisible para la cola de
        // Calidad (listCompletedItems filtra por completed_at IS NOT NULL).
        completedAt: row.completedAt ?? now,
        completedBy: row.completedBy ?? deliveredByName,
        operationalStatus:
          row.operationalStatus === "entregado" || row.operationalStatus === "cancelado"
            ? row.operationalStatus
            : "revision",
        finishedQty:
          input.packagingTotalUnits != null
            ? String(input.packagingTotalUnits)
            : row.finishedQty,
        operationalObservation: input.observation?.trim() || row.operationalObservation,
        version: Number(row.version) + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "DELIVERED_FROM_CODIFICADO",
      fromStatus: "EN_CODIFICADO",
      toStatus: "PENDIENTE_CALIDAD",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: idemRef,
    });

    await touchPedidoListoParaEntregar(
      tx as unknown as ReturnType<typeof getDb>,
      id,
      updated.productionPedidoId,
      actor
    );

    return { item: mapItem(updated), replayed: false, operationId };
  });
}

export type ReopenCodificadoDeliveryInput = {
  workItemId: string;
  reason?: string | null;
  expectedVersion?: number | null;
  idempotencyKey: string;
};

/**
 * "Rehacer entrega" — deshace la entrega a Calidad hecha por Codificado y
 * deja el trabajo editable de nuevo, SIN mover el sector (a diferencia de
 * cancelCodificadoHandoffDurable/WITHDRAW_CODIFICADO_DELIVERY, que expulsa
 * el trabajo de vuelta a Envasado). No borra cajas, muestras, lote/VTO, OA
 * ni observaciones — solo limpia las marcas de entrega y completado.
 *
 * Bloqueada explícitamente (no auto-corrige, no borra en silencio) si:
 *  - Calidad ya tomó una decisión (aprobado/rechazado) — hay que anularla
 *    primero desde Calidad (annulQualityDecisionDurable), a propósito: no
 *    existe ningún vínculo automático entre qualityStatus y este flujo, y
 *    resetearlo acá sin que Calidad lo sepa sería silencioso.
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
    if (row.sector !== "CODIFICADO") {
      throw new PlanningValidationError("El trabajo no está en Codificado.");
    }
    if (!row.deliveredFromCodificadoAt) {
      throw new PlanningValidationError(
        "Este trabajo no fue entregado — no hay nada que rehacer."
      );
    }
    if (row.codificadoCancelledAt) {
      throw new PlanningValidationError("El envío a Codificado fue cancelado.");
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
    if (row.qualityStatus && row.qualityStatus !== "pendiente") {
      throw new PlanningValidationError(
        "Calidad ya tomó una decisión sobre este trabajo (aprobado/rechazado). Pedile a Calidad que anule su decisión antes de rehacer la entrega."
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
    if (activeDelivery) {
      throw new PlanningValidationError(
        "Ya existe una entrega real a cliente para este trabajo — no se puede rehacer la entrega de Codificado."
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
        // completedAt gatea la cola de Calidad (listCompletedItems) — se
        // limpia junto con deliveredFromCodificadoAt para que el trabajo
        // deje de mostrarse ahí mientras Codificado lo vuelve a editar;
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
      fromStatus: "PENDIENTE_CALIDAD",
      toStatus: "EN_CODIFICADO",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `${idemRef} | entrega anterior ${prevDeliveredAt} por ${prevDeliveredBy}${reason ? ` | motivo: ${reason}` : ""}`,
    });

    return { item: mapItem(updated), replayed: false, operationId };
  });
}
