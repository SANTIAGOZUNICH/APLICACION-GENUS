import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, osNotifications, workItemDeliveries, workItems } from "@/lib/db/schema";
import { classifyPendingDefinition } from "./pending-definition";
import { CIRCUIT_NOTIFICATION_SECTORS, uuidFromKey } from "./movements";

export const QUALITY_CIRCUIT_RETIRED_EVENT = "QUALITY_CIRCUIT_RETIRED";

export interface RetirementResult {
  /** Trabajos que estaban pendientes en Calidad hoy (con o sin evento previo). */
  candidates: number;
  /** Eventos nuevos registrados en esta corrida (0 si ya estaban todos). */
  recorded: number;
}

/** Id determinístico del evento de reubicación de UN trabajo: la clave idempotente por ítem. */
export function retirementEventId(workItemId: string): string {
  return uuidFromKey(`${QUALITY_CIRCUIT_RETIRED_EVENT}:${workItemId}`);
}

/**
 * Reubicación SEGURA y AUDITABLE de los trabajos que estaban pendientes en la ex-bandeja de Calidad
 * (operational_status = revision, quality_status = pendiente, completed_at, sin entrega). Idempotente:
 *  - NO cambia el estado, NO los marca entregados ni finalizados, NO borra nada ni toca quality_*;
 *  - registra UN operational_event `QUALITY_CIRCUIT_RETIRED` por trabajo (id determinístico + onConflictDoNothing);
 *  - los trabajos quedan visibles para Producción en «Pendientes de definir» con las acciones de su sector
 *    (o «pendiente de asignación» si el destino no se puede determinar);
 *  - un único aviso a Producción por tanda (id determinístico) resume cuántos se reubicaron.
 * Se puede correr cualquier cantidad de veces (se invoca al abrir «Pendientes de definir»).
 */
export async function retireQualityCircuitDurable(): Promise<RetirementResult> {
  const db = getDb();
  const rows = await db
    .select({
      id: workItems.id,
      sector: workItems.sector,
      planningWeekId: workItems.planningWeekId,
      completedAt: workItems.completedAt,
      qualityStatus: workItems.qualityStatus,
      viaCodificado: workItems.viaCodificado,
      codificadoCancelledAt: workItems.codificadoCancelledAt,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.operationalStatus, "revision"),
        eq(workItems.qualityStatus, "pendiente"),
        sql`${workItems.completedAt} IS NOT NULL`,
        isNull(workItems.deletedAt),
        sql`NOT EXISTS (SELECT 1 FROM ${workItemDeliveries} d WHERE d.work_item_id = ${workItems.id} AND d.status = 'ENTREGADO' AND d.archived = false)`
      )
    );
  if (rows.length === 0) return { candidates: 0, recorded: 0 };

  const values = rows.map((r) => {
    const info = classifyPendingDefinition({
      sector: r.sector,
      operationalStatus: "revision",
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      qualityStatus: r.qualityStatus,
      viaCodificado: r.viaCodificado,
      codificadoCancelledAt: r.codificadoCancelledAt ? r.codificadoCancelledAt.toISOString() : null,
    });
    return {
      id: retirementEventId(r.id),
      workItemId: r.id,
      planningWeekId: r.planningWeekId,
      type: QUALITY_CIRCUIT_RETIRED_EVENT,
      fromStatus: "PENDIENTE_CALIDAD",
      toStatus: "PENDIENTE_DE_DEFINIR",
      actorEmail: "sistema@genus.local",
      actorSector: "SISTEMA",
      note: `Calidad salió del circuito operativo | sector=${r.sector} | acciones=${info.actions.join(",")} | destino=${
        info.destinationKnown ? "determinado" : "pendiente de asignación"
      }`,
    };
  });

  const inserted = await db
    .insert(operationalEvents)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: operationalEvents.id, workItemId: operationalEvents.workItemId });

  if (inserted.length > 0) {
    const ids = inserted.map((i) => i.workItemId ?? i.id).sort();
    try {
      await db
        .insert(osNotifications)
        .values({
          id: uuidFromKey(`circuito:backfill:${ids.join(",")}`),
          kind: "circuito_movimiento",
          title: "Trabajos pendientes de definir",
          message: `${inserted.length} trabajo(s) que estaban pendientes en Calidad pasaron a «Pendientes de definir» en Producción. Registrá su entrega, enviá cada uno a Codificado/Envasado o asignalo. No se marcó nada como entregado.`,
          sectors: [...CIRCUIT_NOTIFICATION_SECTORS],
          href: "/mi-trabajo?view=pendientes",
          readBy: [],
          dismissedBy: [],
          deletedBy: [],
        })
        .onConflictDoNothing();
    } catch (error) {
      console.error("[circuito] no se pudo registrar el aviso de reubicación", error);
    }
  }
  return { candidates: rows.length, recorded: inserted.length };
}
