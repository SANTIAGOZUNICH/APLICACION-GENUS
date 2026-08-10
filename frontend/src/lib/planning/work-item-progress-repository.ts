import "server-only";

import { and, desc, eq, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workItemDeliveries, workItems } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";

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
  packagingLote?: string | null;
  packagingVto?: string | null;
  packagingTotalUnits?: number | null;
  packingGroups?: Array<{ cajas: number; unidadesPorCaja: number }> | null;
  packingMismatchObservation?: string | null;
}

const KEEP_STATUS_ON_PROGRESS: ReadonlySet<string> = new Set([
  "revision",
  "entregado",
  "cancelado",
]);

export async function saveWorkProgressDurable(id: string, input: SaveProgressInput) {
  const db = getDb();
  const [existing] = await db
    .select({ operationalStatus: workItems.operationalStatus })
    .from(workItems)
    .where(eq(workItems.id, id))
    .limit(1);
  if (!existing) throw new Error("Work item no encontrado.");

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
  if (input.packagingLote !== undefined) patch.packagingLote = input.packagingLote;
  if (input.packagingVto !== undefined) patch.packagingVto = input.packagingVto;
  if (input.packagingTotalUnits !== undefined)
    patch.packagingTotalUnits = input.packagingTotalUnits;
  if (input.packingGroups !== undefined) patch.packingGroups = input.packingGroups;
  if (input.packingMismatchObservation !== undefined)
    patch.packingMismatchObservation = input.packingMismatchObservation;

  const [row] = await db
    .update(workItems)
    .set(patch)
    .where(eq(workItems.id, id))
    .returning();
  return row;
}

export interface CompleteWorkInput {
  finishedQty: string;
  observation: string;
  completedBy: string;
}

export async function completeWorkDurable(id: string, input: CompleteWorkInput) {
  const db = getDb();
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

/** Cola de Calidad nativa: work items enviados a revisión, decisión pendiente. */
export async function listQualityQueueDurable() {
  const db = getDb();
  return db.select().from(workItems).where(eq(workItems.operationalStatus, "revision"));
}
