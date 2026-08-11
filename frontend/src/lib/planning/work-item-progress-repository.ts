import "server-only";

import { and, desc, eq, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItemDeliveries, workItems } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";
import {
  canActOnWorkItemSector,
  WORK_PROGRESS_DENIED_MESSAGE,
} from "@/features/os/operational/lib/work-progress-rbac";
import { OrdersForbiddenError } from "@/lib/orders/types";

/**
 * Fuente de verdad durable del avance operativo (0023) — reemplaza el overlay
 * en memoria de server-operational-state.ts para work items nativos (Neon).
 * Cada mutación escribe directo a Postgres; no hay estado intermedio en RAM.
 */

const NATIVE_PREFIX = "native:";

export function nativeIdFromItemId(itemId: string): string | null {
  if (!itemId.startsWith(NATIVE_PREFIX)) return null;
  const raw = itemId.slice(NATIVE_PREFIX.length);
  return raw.length > 0 ? raw : null;
}

export interface SaveProgressInput {
  finishedQty: string;
  observation: string;
  updatedBy: string;
  sector?: SectorId;
  /**
   * @deprecated Lote/VTO ya no son editables desde Envasado/Codificado —
   * ver PARTE A "Lote y VTO — fuente única". saveWorkProgressDurable
   * ignora estos campos a propósito; solo Producción los cambia (ver
   * updateWorkItemLoteVtoDurable).
   */
  packagingLote?: string | null;
  /** @deprecated ver packagingLote. */
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  packingMismatchObservation?: string | null;
  /** Unidades producidas pero no entregables (PARTE A). null = no informado. */
  sampleUnits?: number | null;
}

const KEEP_STATUS_ON_PROGRESS: ReadonlySet<string> = new Set([
  "revision",
  "entregado",
  "cancelado",
]);

/**
 * @param actorSector Sector autenticado del actor (server-resolved, nunca el
 * `body.sector` que manda el cliente) — debe coincidir con el sector actual
 * del work item o ser PRODUCCION/DIRECCION. Ver work-progress-rbac.ts.
 */
export async function saveWorkProgressDurable(
  id: string,
  input: SaveProgressInput,
  actorSector: SectorId | string
) {
  const db = getDb();
  const [existing] = await db
    .select({ operationalStatus: workItems.operationalStatus, sector: workItems.sector })
    .from(workItems)
    .where(eq(workItems.id, id))
    .limit(1);
  if (!existing) throw new Error("Work item no encontrado.");
  if (!canActOnWorkItemSector(actorSector, existing.sector)) {
    throw new OrdersForbiddenError(WORK_PROGRESS_DENIED_MESSAGE);
  }

  const nextStatus = KEEP_STATUS_ON_PROGRESS.has(existing.operationalStatus)
    ? existing.operationalStatus
    : "en_curso";

  const patch: Partial<typeof workItems.$inferInsert> = {
    operationalStatus: nextStatus,
    finishedQty: input.finishedQty.trim(),
    operationalObservation: input.observation.trim(),
    progressUpdatedAt: new Date(),
    progressUpdatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  // Lote/VTO: fuente única = Producción (PARTE A). Guardar avance desde
  // Envasado/Codificado nunca sobreescribe estos campos, aunque el cliente
  // los envíe — se ignoran a propósito (ver updateWorkItemLoteVtoDurable).
  if (input.packagingTotalUnits !== undefined)
    patch.packagingTotalUnits = input.packagingTotalUnits;
  if (input.packingGroups !== undefined) patch.packingGroups = input.packingGroups;
  if (input.packingMismatchObservation !== undefined)
    patch.packingMismatchObservation = input.packingMismatchObservation;
  if (input.sampleUnits !== undefined) patch.sampleUnits = input.sampleUnits;

  const [row] = await db
    .update(workItems)
    .set(patch)
    .where(eq(workItems.id, id))
    .returning();
  return row;
}

export interface UpdateLoteVtoInput {
  packagingLote?: string | null;
  packagingVto?: string | null;
  reason: string;
  updatedBy: string;
  updatedBySector: SectorId | string;
}

/**
 * Corrección de Lote/VTO por Producción (PARTE A — fuente única). Envasado/
 * Codificado nunca llaman esto; solo lo expone la ruta gateada a PRODUCCION.
 * Cada corrección queda auditada en operational_events con valor anterior,
 * nuevo, actor y motivo — todos los sectores leen el mismo valor tras esto.
 */
export async function updateWorkItemLoteVtoDurable(id: string, input: UpdateLoteVtoInput) {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new Error("El motivo es obligatorio para corregir Lote/VTO.");
  }
  const nextLote =
    input.packagingLote !== undefined ? input.packagingLote?.trim() || null : undefined;
  const nextVto =
    input.packagingVto !== undefined ? input.packagingVto?.trim() || null : undefined;
  if (nextLote === undefined && nextVto === undefined) {
    throw new Error("No hay cambios de Lote/VTO para guardar.");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        packagingLote: workItems.packagingLote,
        packagingVto: workItems.packagingVto,
        planningWeekId: workItems.planningWeekId,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");

    if (
      (nextLote === undefined || nextLote === existing.packagingLote) &&
      (nextVto === undefined || nextVto === existing.packagingVto)
    ) {
      throw new Error("El valor indicado es igual al actual — no hay corrección para aplicar.");
    }

    const patch: Partial<typeof workItems.$inferInsert> = { updatedAt: new Date() };
    if (nextLote !== undefined) patch.packagingLote = nextLote;
    if (nextVto !== undefined) patch.packagingVto = nextVto;

    const [row] = await tx.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
    if (!row) throw new Error("No se pudo actualizar Lote/VTO.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "LOTE_VTO_CORRECTED",
      fromStatus: JSON.stringify({
        lote: existing.packagingLote ?? null,
        vto: existing.packagingVto ?? null,
      }),
      toStatus: JSON.stringify({
        lote: row.packagingLote ?? null,
        vto: row.packagingVto ?? null,
      }),
      actorEmail: input.updatedBy,
      actorSector: String(input.updatedBySector),
      note: reason,
    });

    return row;
  });
}

export interface UpdateWorkItemPlanningInput {
  client?: string | null;
  product?: string | null;
  plannedQuantity?: string | null;
  unit?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
  reason?: string | null;
  updatedBy: string;
  updatedBySector: SectorId | string;
}

const PLANNING_EDITABLE_KEYS = [
  "client",
  "product",
  "plannedQuantity",
  "unit",
  "deliveryDate",
  "notes",
] as const;

/**
 * Edición de campos de planificación por Producción sobre un trabajo ya
 * asignado (product/client/cantidad/fecha de entrega/observaciones). Toca
 * SOLO estas columnas — nunca finishedQty, packingGroups, sampleUnits,
 * deliverableUnits, operationalStatus, ni ningún campo de Codificado/
 * Calidad, así que no puede pisar avance ya informado por otro sector.
 * Lote/VTO siguen su propio mecanismo (updateWorkItemLoteVtoDurable) — no
 * se duplican acá. El caller (ruta) ya validó que el actor es PRODUCCION.
 */
export async function updateWorkItemPlanningDurable(
  id: string,
  input: UpdateWorkItemPlanningInput
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        client: workItems.client,
        product: workItems.product,
        plannedQuantity: workItems.plannedQuantity,
        unit: workItems.unit,
        deliveryDate: workItems.deliveryDate,
        notes: workItems.notes,
        planningWeekId: workItems.planningWeekId,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const patch: Partial<typeof workItems.$inferInsert> = { updatedAt: new Date() };

    for (const key of PLANNING_EDITABLE_KEYS) {
      const incoming = input[key];
      if (incoming === undefined) continue;
      const nextValue =
        key === "deliveryDate"
          ? incoming?.trim() || null
          : typeof incoming === "string"
            ? incoming.trim() || null
            : incoming;
      const currentValue = existing[key];
      if (nextValue === currentValue) continue;
      before[key] = currentValue ?? null;
      after[key] = nextValue ?? null;
      (patch as Record<string, unknown>)[key] = nextValue;
    }

    if (Object.keys(after).length === 0) {
      throw new Error("No hay cambios para guardar.");
    }

    const [row] = await tx.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
    if (!row) throw new Error("No se pudo actualizar el trabajo.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "PLANNING_FIELDS_CORRECTED",
      fromStatus: JSON.stringify(before),
      toStatus: JSON.stringify(after),
      actorEmail: input.updatedBy,
      actorSector: String(input.updatedBySector),
      note: input.reason?.trim() || null,
    });

    return row;
  });
}

export interface CompleteWorkInput {
  finishedQty: string;
  observation: string;
  completedBy: string;
}

/** @param actorSector Ver saveWorkProgressDurable — mismo criterio de RBAC. */
export async function completeWorkDurable(
  id: string,
  input: CompleteWorkInput,
  actorSector: SectorId | string
) {
  const db = getDb();
  const [existing] = await db
    .select({ sector: workItems.sector })
    .from(workItems)
    .where(eq(workItems.id, id))
    .limit(1);
  if (!existing) throw new Error("Work item no encontrado.");
  if (!canActOnWorkItemSector(actorSector, existing.sector)) {
    throw new OrdersForbiddenError(WORK_PROGRESS_DENIED_MESSAGE);
  }

  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({
      operationalStatus: "revision",
      finishedQty: input.finishedQty.trim(),
      operationalObservation: input.observation.trim(),
      completedAt: now,
      completedBy: input.completedBy,
      progressUpdatedAt: now,
      progressUpdatedBy: input.completedBy,
      updatedAt: now,
    })
    .where(eq(workItems.id, id))
    .returning();
  if (!row) throw new Error("Work item no encontrado.");
  return row;
}

export interface QualityDecisionInput {
  decidedBy: string;
  decidedBySector: SectorId | string;
  decidedByEmail?: string;
  observation?: string;
}

export async function decideQualityDurable(
  id: string,
  status: "aprobado" | "rechazado",
  input: QualityDecisionInput
) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({
      qualityStatus: status,
      qualityDecidedAt: now,
      qualityDecidedBy: input.decidedBy,
      qualityDecidedBySector: String(input.decidedBySector),
      qualityObservation: input.observation?.trim() || null,
      qualityChangeReason: null,
      updatedAt: now,
    })
    .where(eq(workItems.id, id))
    .returning();
  if (!row) throw new Error("Work item no encontrado.");
  return row;
}

export async function annulQualityDecisionDurable(
  id: string,
  input: { reason: string; decidedBy: string; decidedBySector: SectorId | string; decidedByEmail?: string }
) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({
      qualityStatus: "pendiente",
      qualityDecidedAt: now,
      qualityDecidedBy: input.decidedBy,
      qualityDecidedBySector: String(input.decidedBySector),
      qualityChangeReason: input.reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(workItems.id, id),
        or(eq(workItems.qualityStatus, "aprobado"), eq(workItems.qualityStatus, "rechazado"))
      )
    )
    .returning();
  if (!row) {
    throw new Error("Solo se pueden anular decisiones aprobadas o rechazadas.");
  }
  return row;
}

export async function restoreCancelledWorkDurable(
  id: string,
  input: { restoredBy: string; reason?: string }
) {
  const db = getDb();
  const [existing] = await db
    .select({ operationalObservation: workItems.operationalObservation })
    .from(workItems)
    .where(and(eq(workItems.id, id), eq(workItems.operationalStatus, "cancelado")))
    .limit(1);
  if (!existing) {
    throw new Error("Solo se restauran trabajos en estado cancelado.");
  }
  const now = new Date();
  const nextObservation = [
    existing.operationalObservation,
    input.reason?.trim() ? `Restaurado: ${input.reason.trim()}` : "Restaurado",
  ]
    .filter(Boolean)
    .join(" · ");
  const [row] = await db
    .update(workItems)
    .set({
      operationalStatus: "en_curso",
      operationalObservation: nextObservation,
      progressUpdatedAt: now,
      progressUpdatedBy: input.restoredBy,
      operationalCancelledAt: null,
      operationalCancelledBy: null,
      operationalCancelReason: null,
      updatedAt: now,
    })
    .where(eq(workItems.id, id))
    .returning();
  return row;
}

export async function cancelWorkDurable(
  id: string,
  input: { cancelledBy: string; reason: string }
) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(workItems)
    .set({
      operationalStatus: "cancelado",
      operationalCancelledAt: now,
      operationalCancelledBy: input.cancelledBy,
      operationalCancelReason: input.reason,
      progressUpdatedAt: now,
      progressUpdatedBy: input.cancelledBy,
      updatedAt: now,
    })
    .where(eq(workItems.id, id))
    .returning();
  if (!row) throw new Error("Work item no encontrado.");
  return row;
}

export interface DeliverWorkInput {
  id?: string;
  workItemId: string;
  qualityItemId?: string | null;
  product: string;
  codigo: string | null;
  client: string | null;
  lote: string | null;
  sourceSector: SectorId;
  quantity: string | null;
  unit: string | null;
  plannedDeliveryDate: string | null;
  actualDeliveredAt: string;
  remito: string | null;
  receivedBy: string | null;
  observations: string | null;
  deliveredBy: string;
  deliveredBySector: SectorId;
}

/** Idempotente: si ya hay una entrega activa (ENTREGADO, no archivada) para el work item, la devuelve. */
export async function deliverWorkDurable(input: DeliverWorkInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existingActive] = await tx
      .select()
      .from(workItemDeliveries)
      .where(
        and(
          eq(workItemDeliveries.workItemId, input.workItemId),
          eq(workItemDeliveries.status, "ENTREGADO"),
          eq(workItemDeliveries.archived, false)
        )
      )
      .limit(1);
    if (existingActive) return existingActive;

    const [row] = await tx
      .insert(workItemDeliveries)
      .values({
        workItemId: input.workItemId,
        qualityItemId: input.qualityItemId ?? null,
        product: input.product,
        codigo: input.codigo,
        client: input.client,
        lote: input.lote,
        sourceSector: input.sourceSector,
        quantity: input.quantity,
        unit: input.unit,
        plannedDeliveryDate: input.plannedDeliveryDate,
        actualDeliveredAt: new Date(input.actualDeliveredAt),
        remito: input.remito,
        receivedBy: input.receivedBy,
        observations: input.observations,
        status: "ENTREGADO",
        deliveredBy: input.deliveredBy,
        deliveredBySector: input.deliveredBySector,
      })
      .returning();

    await tx
      .update(workItems)
      .set({
        operationalStatus: "entregado",
        progressUpdatedAt: new Date(),
        progressUpdatedBy: input.deliveredBy,
        updatedAt: new Date(),
      })
      .where(eq(workItems.id, input.workItemId));

    return row;
  });
}

export async function archiveDeliveryDurable(id: string, actorName: string) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(workItemDeliveries)
    .set({ archived: true, archivedAt: now, archivedBy: actorName, updatedAt: now })
    .where(eq(workItemDeliveries.id, id))
    .returning();
  return row ?? null;
}

export async function restoreDeliveryDurable(id: string) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(workItemDeliveries)
    .set({ archived: false, archivedAt: null, archivedBy: null, updatedAt: now })
    .where(eq(workItemDeliveries.id, id))
    .returning();
  return row ?? null;
}

export async function annulDeliveryDurable(id: string, reason: string, actorName: string) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(workItemDeliveries)
    .where(eq(workItemDeliveries.id, id))
    .limit(1);
  if (!existing) return null;
  if (existing.status === "REGISTRO_ELIMINADO") return null;
  if (existing.archived) return null;
  if (existing.status === "ANULADO") return existing;

  const now = new Date();
  const [row] = await db
    .update(workItemDeliveries)
    .set({
      status: "ANULADO",
      archived: false,
      annulledAt: now,
      annulledBy: actorName,
      annulReason: reason,
      updatedAt: now,
    })
    .where(eq(workItemDeliveries.id, id))
    .returning();

  if (row) {
    await db
      .update(workItems)
      .set({
        operationalStatus: "revision",
        progressUpdatedAt: now,
        progressUpdatedBy: actorName,
        updatedAt: now,
      })
      .where(eq(workItems.id, row.workItemId));
  }
  return row ?? null;
}

export async function deleteDeliveryRecordDurable(
  id: string,
  input: { reason: string; actorName: string }
) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(workItemDeliveries)
    .where(eq(workItemDeliveries.id, id))
    .limit(1);
  if (!existing) return null;
  if (!existing.archived && existing.status === "ENTREGADO") return null;

  const now = new Date();
  const [row] = await db
    .update(workItemDeliveries)
    .set({
      status: "REGISTRO_ELIMINADO",
      deletedAt: now,
      deletedBy: input.actorName,
      deleteReason: input.reason,
      updatedAt: now,
    })
    .where(eq(workItemDeliveries.id, id))
    .returning();
  return row ?? null;
}

export async function listDeliveriesDurable(filter?: { includeDeleted?: boolean }) {
  const db = getDb();
  const rows = await db
    .select()
    .from(workItemDeliveries)
    .where(
      filter?.includeDeleted ? undefined : ne(workItemDeliveries.status, "REGISTRO_ELIMINADO")
    )
    .orderBy(desc(workItemDeliveries.actualDeliveredAt));
  return rows;
}

/**
 * work_item_deliveries.work_item_id se guarda como uuid crudo (ver
 * deliverWorkDurable — nativeIdFromItemId ya le sacó el prefijo antes de
 * insertar). El cliente indexa work items por `native:<uuid>` (WorkItem.id),
 * así que hay que reponer el prefijo acá para que workItemsById.get(...)
 * matchee en la vista de Entregados.
 */
export function toClientDeliveryRecord(row: typeof workItemDeliveries.$inferSelect) {
  return {
    id: row.id,
    workItemId: `${NATIVE_PREFIX}${row.workItemId}`,
    qualityItemId: row.qualityItemId,
    product: row.product,
    codigo: row.codigo,
    client: row.client,
    lote: row.lote,
    sourceSector: row.sourceSector,
    quantity: row.quantity,
    unit: row.unit,
    plannedDeliveryDate: row.plannedDeliveryDate,
    actualDeliveredAt: row.actualDeliveredAt.toISOString(),
    remito: row.remito,
    receivedBy: row.receivedBy,
    observations: row.observations,
    status: row.status,
    deliveredBy: row.deliveredBy,
    deliveredBySector: row.deliveredBySector,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archived: row.archived,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    archivedBy: row.archivedBy,
    annulledAt: row.annulledAt ? row.annulledAt.toISOString() : null,
    annulledBy: row.annulledBy,
    annulReason: row.annulReason,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedBy: row.deletedBy,
    deleteReason: row.deleteReason,
  };
}

/** Cola de Calidad nativa: work items enviados a revisión, decisión pendiente. */
export async function listQualityQueueDurable() {
  const db = getDb();
  return db.select().from(workItems).where(eq(workItems.operationalStatus, "revision"));
}
