import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItems } from "@/lib/db/schema";
import type {
  PlanningActor,
  PlanningWorkItemRecord,
  PlanningWorkItemStatus,
} from "@/lib/planning/types";
import {
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningValidationError,
} from "@/lib/planning/types";
import { parseNativeWorkItemId } from "@/lib/planning/native-id";

type WorkItemRow = typeof workItems.$inferSelect;

function resolveId(itemId: string): string {
  return parseNativeWorkItemId(itemId) ?? itemId;
}

function mapProgressFields(row: WorkItemRow): Pick<
  PlanningWorkItemRecord,
  | "finishedQuantity"
  | "operationalObservation"
  | "progressUpdatedAt"
  | "progressUpdatedBy"
  | "completedAt"
  | "completedBy"
  | "status"
  | "version"
  | "updatedAt"
  | "id"
  | "planningWeekId"
  | "sector"
  | "product"
  | "client"
  | "plannedQuantity"
  | "unit"
  | "line"
  | "branchOwner"
  | "plannedDate"
  | "notes"
> {
  return {
    id: row.id,
    planningWeekId: row.planningWeekId,
    plannedDate: String(row.plannedDate),
    client: row.client,
    product: row.product,
    plannedQuantity: row.plannedQuantity,
    unit: row.unit,
    sector: row.sector,
    line: row.line,
    branchOwner: row.branchOwner,
    notes: row.notes,
    status: row.status,
    finishedQuantity: row.finishedQuantity,
    operationalObservation: row.operationalObservation,
    progressUpdatedAt: row.progressUpdatedAt
      ? row.progressUpdatedAt.toISOString()
      : null,
    progressUpdatedBy: row.progressUpdatedBy,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completedBy: row.completedBy,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertPublishedLifecycle(status: PlanningWorkItemStatus) {
  if (status === "BORRADOR" || status === "PLANIFICADO") {
    throw new PlanningForbiddenError(
      "El trabajo aún no está publicado. No se puede registrar avance."
    );
  }
  if (status === "CANCELADO") {
    throw new PlanningForbiddenError("Trabajo cancelado.");
  }
}

/** Guardar avance parcial — EN_PROCESO + evento. */
export async function saveNativeProgress(
  itemId: string,
  payload: { finishedQty: string; observation: string },
  actor: PlanningActor
) {
  const finishedQty = payload.finishedQty?.trim();
  if (!finishedQty) {
    throw new PlanningValidationError("Terminadas (cantidad) es obligatoria.");
  }

  const id = resolveId(itemId);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    assertPublishedLifecycle(row.status);
    if (
      row.status === "PENDIENTE_CALIDAD" ||
      row.status === "APROBADO_CALIDAD" ||
      row.status === "RECHAZADO_CALIDAD" ||
      row.status === "LIBERADO"
    ) {
      throw new PlanningForbiddenError(
        "El trabajo ya fue entregado a Calidad. No se puede editar el avance."
      );
    }

    const fromStatus = row.status;
    const now = new Date();
    const [updated] = await tx
      .update(workItems)
      .set({
        finishedQuantity: finishedQty,
        operationalObservation: payload.observation?.trim() || null,
        progressUpdatedAt: now,
        progressUpdatedBy: actor.displayName || actor.email,
        status: "EN_PROCESO",
        version: row.version + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, row.id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: row.id,
      planningWeekId: row.planningWeekId,
      type: "PROGRESS_SAVED",
      fromStatus,
      toStatus: "EN_PROCESO",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `Terminadas ${finishedQty}${payload.observation?.trim() ? ` · ${payload.observation.trim()}` : ""}`,
    });

    return mapProgressFields(updated);
  });
}

/** Entregar a Calidad — PENDIENTE_CALIDAD + evento. */
export async function completeNativeWork(
  itemId: string,
  payload: { finishedQty: string; observation: string },
  actor: PlanningActor
) {
  const finishedQty = payload.finishedQty?.trim();
  if (!finishedQty) {
    throw new PlanningValidationError("Terminadas (cantidad) es obligatoria.");
  }

  const id = resolveId(itemId);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    assertPublishedLifecycle(row.status);
    if (row.status === "PENDIENTE_CALIDAD") {
      throw new PlanningForbiddenError("Ya está entregado a Calidad.");
    }
    if (
      row.status === "APROBADO_CALIDAD" ||
      row.status === "RECHAZADO_CALIDAD" ||
      row.status === "LIBERADO"
    ) {
      throw new PlanningForbiddenError("El trabajo ya tiene decisión de Calidad.");
    }

    const fromStatus = row.status;
    const now = new Date();
    const [updated] = await tx
      .update(workItems)
      .set({
        finishedQuantity: finishedQty,
        operationalObservation: payload.observation?.trim() || null,
        progressUpdatedAt: now,
        progressUpdatedBy: actor.displayName || actor.email,
        completedAt: now,
        completedBy: actor.displayName || actor.email,
        status: "PENDIENTE_CALIDAD",
        version: row.version + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, row.id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: row.id,
      planningWeekId: row.planningWeekId,
      type: "DELIVERED_TO_QUALITY",
      fromStatus,
      toStatus: "PENDIENTE_CALIDAD",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `Entregado · Terminadas ${finishedQty}`,
    });

    return mapProgressFields(updated);
  });
}

/** Aprobar / rechazar Calidad. */
export async function decideNativeQuality(
  itemId: string,
  decision: "aprobado" | "rechazado",
  payload: { observation?: string },
  actor: PlanningActor
) {
  if (actor.sector !== "CALIDAD" && actor.sector !== "DIRECCION") {
    throw new PlanningForbiddenError("Solo Calidad puede aprobar o rechazar.");
  }

  const toStatus: PlanningWorkItemStatus =
    decision === "aprobado" ? "APROBADO_CALIDAD" : "RECHAZADO_CALIDAD";

  const id = resolveId(itemId);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (row.status !== "PENDIENTE_CALIDAD") {
      throw new PlanningForbiddenError(
        "Solo se puede decidir sobre trabajos pendientes de Calidad."
      );
    }

    const fromStatus = row.status;
    const now = new Date();
    const noteExtra = payload.observation?.trim();
    const [updated] = await tx
      .update(workItems)
      .set({
        status: toStatus,
        operationalObservation: noteExtra
          ? noteExtra
          : row.operationalObservation,
        version: row.version + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, row.id))
      .returning();

    await tx.insert(operationalEvents).values({
      workItemId: row.id,
      planningWeekId: row.planningWeekId,
      type: decision === "aprobado" ? "QUALITY_APPROVED" : "QUALITY_REJECTED",
      fromStatus,
      toStatus,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: noteExtra || (decision === "aprobado" ? "Aprobado" : "Rechazado"),
    });

    return mapProgressFields(updated);
  });
}
