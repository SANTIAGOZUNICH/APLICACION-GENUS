import "server-only";

import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, operationalOrders, workItemDeliveries, workItems } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";
import {
  canActOnWorkItemSector,
  WORK_PROGRESS_DENIED_MESSAGE,
} from "@/features/os/operational/lib/work-progress-rbac";
import { OrdersForbiddenError } from "@/lib/orders/types";
import { PlanningValidationError } from "@/lib/planning/types";
import { canRequestRework } from "@/features/os/operational/lib/rework-flow";
import { isWorkItemReschedulable } from "@/features/os/operational/lib/work-transfer-labels";
import { resolveDirectCompletePackedUnits, type PackingGroup } from "@/lib/remitos/packing-math";
import { isIntegerUnit, parseArDecimal, parseArInteger } from "@/lib/utils/ar-number-parsing";
import { addDaysIso, weekStartMonday } from "@/lib/operational/operational-calendar";
import { normalizeOaOrderNumber } from "@/lib/planning/oa-assign-helpers";
import { loadWorkItemOperationalData } from "@/lib/planning/work-item-operational-data";

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
   * "Fill-once": Envasado/Codificado pueden completar Lote/VTO acá SOLO si
   * Producción los dejó vacíos. Si ya existe un valor, saveWorkProgressDurable
   * lo preserva tal cual y este campo se ignora en silencio — nunca hay
   * sobreescritura desde acá. Para corregir un valor ya cargado, el único
   * camino sigue siendo updateWorkItemLoteVtoDurable (Producción, con motivo
   * auditado).
   */
  packagingLote?: string | null;
  /** ver packagingLote. */
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
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        operationalStatus: workItems.operationalStatus,
        sector: workItems.sector,
        planningWeekId: workItems.planningWeekId,
        packagingLote: workItems.packagingLote,
        packagingVto: workItems.packagingVto,
      })
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
    if (input.packagingTotalUnits !== undefined)
      patch.packagingTotalUnits = input.packagingTotalUnits;
    if (input.packingGroups !== undefined) patch.packingGroups = input.packingGroups;
    if (input.packingMismatchObservation !== undefined)
      patch.packingMismatchObservation = input.packingMismatchObservation;
    if (input.sampleUnits !== undefined) patch.sampleUnits = input.sampleUnits;

    // Lote/VTO "fill-once": si Producción ya cargó un valor, se preserva tal
    // cual acá — jamás se sobreescribe desde Envasado/Codificado (para
    // corregir un valor existente, ver updateWorkItemLoteVtoDurable). Si
    // está vacío, Envasado/Codificado puede completarlo — se persiste de
    // inmediato en el MISMO work item, no en una copia paralela.
    const filledLote =
      !existing.packagingLote && input.packagingLote?.trim()
        ? input.packagingLote.trim()
        : null;
    const filledVto =
      !existing.packagingVto && input.packagingVto?.trim() ? input.packagingVto.trim() : null;
    if (filledLote) patch.packagingLote = filledLote;
    if (filledVto) patch.packagingVto = filledVto;

    const [row] = await tx.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
    if (!row) throw new Error("No se pudo guardar el avance.");

    if (filledLote || filledVto) {
      await tx.insert(operationalEvents).values({
        workItemId: id,
        planningWeekId: existing.planningWeekId,
        type: "LOTE_VTO_FILLED",
        fromStatus: JSON.stringify({
          lote: existing.packagingLote ?? null,
          vto: existing.packagingVto ?? null,
        }),
        toStatus: JSON.stringify({
          lote: row.packagingLote ?? null,
          vto: row.packagingVto ?? null,
        }),
        actorEmail: input.updatedBy,
        actorSector: String(actorSector),
        note: "Completado por Envasado/Codificado — Producción no lo había cargado.",
      });
    }

    return row;
  });
}

export interface UpdateLoteVtoInput {
  packagingLote?: string | null;
  packagingVto?: string | null;
  reason: string;
  updatedBy: string;
  updatedBySector: SectorId | string;
  /** Ver UpdateWorkItemPlanningInput#expectedVersion. */
  expectedVersion?: number;
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
        version: workItems.version,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");
    assertVersionMatches(existing.version, input.expectedVersion);

    if (
      (nextLote === undefined || nextLote === existing.packagingLote) &&
      (nextVto === undefined || nextVto === existing.packagingVto)
    ) {
      throw new Error("El valor indicado es igual al actual — no hay corrección para aplicar.");
    }

    const patch: Partial<typeof workItems.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
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

export interface UpdateOrderRefInput {
  /** Número de OE (Elaboración) u OA (resto) — debe existir ya, nunca se auto-crea acá. */
  orderNumberRaw: string;
  reason: string;
  updatedBy: string;
  updatedBySector: SectorId | string;
}

/**
 * Corrección de la OA/OE vinculada a un trabajo ya asignado (PARTE B). A
 * diferencia de ensureOaForAssignment (asignación inicial), esta función
 * NUNCA crea una orden nueva — exige que la OA/OE de destino ya exista,
 * para no generar documentos legales nuevos desde un flujo de edición.
 * Mantiene "1 trabajo = 1 OA": desvincula la orden anterior (si había) y
 * vincula la nueva de forma atómica, con el mismo guard de carrera
 * (WHERE linkedWorkItemId IS NULL) que usa la asignación inicial.
 */
export async function updateWorkItemOrderRefDurable(id: string, input: UpdateOrderRefInput) {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new PlanningValidationError("El motivo es obligatorio para corregir la OA/OE.");
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        sector: workItems.sector,
        orderId: workItems.orderId,
        orderNumber: workItems.orderNumber,
        planningWeekId: workItems.planningWeekId,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");

    const isElaboracion = existing.sector === "ELABORACION";
    const normalized = isElaboracion
      ? input.orderNumberRaw.trim().toUpperCase().replace(/\s+/g, "")
      : normalizeOaOrderNumber(input.orderNumberRaw);
    if (!normalized) {
      throw new PlanningValidationError(
        isElaboracion ? "Indicá el número de OE." : "Número de OA inválido."
      );
    }
    if (normalized === existing.orderNumber) {
      throw new Error("El número indicado es igual al actual — no hay corrección para aplicar.");
    }

    const [target] = await tx
      .select({
        id: operationalOrders.id,
        orderNumber: operationalOrders.orderNumber,
        type: operationalOrders.type,
        linkedWorkItemId: operationalOrders.linkedWorkItemId,
      })
      .from(operationalOrders)
      .where(eq(operationalOrders.orderNumber, normalized))
      .limit(1);
    if (!target) {
      throw new PlanningValidationError(
        `No se encontró la ${isElaboracion ? "OE" : "OA"} ${normalized}. Debe existir antes de vincularla — esta corrección no crea órdenes nuevas.`
      );
    }
    const expectedType = isElaboracion ? "OE" : "OA";
    if (target.type !== expectedType) {
      throw new PlanningValidationError(`La referencia debe ser una ${expectedType}.`);
    }
    if (target.linkedWorkItemId && target.linkedWorkItemId !== id) {
      throw new Error(
        "Conflicto: esta orden ya tiene un trabajo asignado. Cada trabajo requiere su propia OA/OE."
      );
    }

    if (existing.orderId && existing.orderId !== target.id) {
      await tx
        .update(operationalOrders)
        .set({ linkedWorkItemId: null, updatedAt: new Date(), version: sql`${operationalOrders.version} + 1` })
        .where(
          and(eq(operationalOrders.id, existing.orderId), eq(operationalOrders.linkedWorkItemId, id))
        );
    }

    const [linked] = await tx
      .update(operationalOrders)
      .set({
        linkedWorkItemId: id,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
        version: sql`${operationalOrders.version} + 1`,
      })
      .where(
        and(
          eq(operationalOrders.id, target.id),
          sql`(${operationalOrders.linkedWorkItemId} IS NULL OR ${operationalOrders.linkedWorkItemId} = ${id})`
        )
      )
      .returning({ id: operationalOrders.id });
    if (!linked) {
      throw new Error(
        "Conflicto: esta orden ya tiene un trabajo asignado. Cada trabajo requiere su propia OA/OE. Reintentá."
      );
    }

    const [row] = await tx
      .update(workItems)
      .set({ orderId: target.id, orderNumber: target.orderNumber, updatedAt: new Date() })
      .where(eq(workItems.id, id))
      .returning();
    if (!row) throw new Error("No se pudo actualizar la referencia de OA/OE.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "ORDER_REF_CORRECTED",
      fromStatus: JSON.stringify({ orderNumber: existing.orderNumber ?? null }),
      toStatus: JSON.stringify({ orderNumber: target.orderNumber }),
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
  /** Fecha de producción — debe mantenerse dentro de la semana ya publicada. */
  plannedDate?: string | null;
  notes?: string | null;
  reason?: string | null;
  updatedBy: string;
  updatedBySector: SectorId | string;
  /**
   * Concurrencia optimista (pedido de edición/eliminación de trabajos):
   * versión que el cliente tenía cargada al abrir el formulario. Si no
   * coincide con la versión real leída fresca dentro de esta misma
   * transacción, se rechaza — nunca se pisa un cambio ajeno más reciente.
   * `undefined` (compatibilidad con callers existentes que todavía no la
   * envían) desactiva el chequeo, igual que antes de este campo.
   */
  expectedVersion?: number;
}

/**
 * Concurrencia optimista compartida por las mutaciones de WorkItem — nunca
 * pisa en silencio un cambio hecho por otra pantalla mientras la actual
 * seguía abierta. El mensaje contiene "conflicto" a propósito: el catch-all
 * de la ruta (`/restaur|conflict|cancelado|aprobad|rechazad/i`) ya mapea
 * cualquier error con esa palabra a HTTP 409, así que no hace falta un tipo
 * de error nuevo ni tocar el mapeo de la ruta.
 */
function assertVersionMatches(currentVersion: number, expectedVersion: number | undefined): void {
  if (expectedVersion === undefined) return;
  if (expectedVersion !== currentVersion) {
    throw new PlanningValidationError(
      "Este trabajo fue modificado mientras lo estabas editando (conflicto de versión) — actualizá y revisá antes de guardar."
    );
  }
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
        plannedDate: workItems.plannedDate,
        plannedDateTo: workItems.plannedDateTo,
        version: workItems.version,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");
    assertVersionMatches(existing.version, input.expectedVersion);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const patch: Partial<typeof workItems.$inferInsert> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    if (input.plannedDate !== undefined) {
      const nextDate = input.plannedDate?.trim() || null;
      if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
        throw new PlanningValidationError("Fecha de producción inválida.");
      }
      const weekStart = weekStartMonday(String(existing.plannedDate));
      const weekEnd = addDaysIso(weekStart, 6);
      if (nextDate < weekStart || nextDate > weekEnd) {
        throw new PlanningValidationError(
          `La fecha de producción debe mantenerse dentro de la semana ya planificada (${weekStart} a ${weekEnd}). Para moverlo a otra semana, reasigná el trabajo.`
        );
      }
      const currentFrom = String(existing.plannedDate);
      const currentTo = existing.plannedDateTo ? String(existing.plannedDateTo) : currentFrom;
      if (nextDate !== currentFrom || nextDate !== currentTo) {
        before.plannedDate = currentFrom;
        before.plannedDateTo = existing.plannedDateTo ?? null;
        after.plannedDate = nextDate;
        after.plannedDateTo = null;
        patch.plannedDate = nextDate;
        patch.plannedDateTo = null;
      }
    }

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

export interface RescheduleWorkItemInput {
  /** Nueva fecha de producción (día destino del drop). Requerida. */
  plannedDate: string;
  /**
   * Nueva línea (solo Envasado Masivo/Premium). `undefined` = no tocar la
   * línea actual (drag solo entre días); `null` = limpiar línea (Elaboración/
   * Codificado, que no usan línea).
   */
  line?: string | null;
  updatedBy: string;
  updatedBySector: SectorId | string;
}

/**
 * Reprograma un trabajo por drag & drop en la vista Semanas (Producción) —
 * PARTIAL PATCH: toca únicamente plannedDate/line, nunca lote/VTO/OA/
 * cantidad/producto/cliente/packing/muestras/sobrante/observaciones. No
 * reutiliza updateWorkItemPlanningDurable porque esa función restringe
 * plannedDate a la semana ya publicada (regla pensada para correcciones
 * puntuales) y no acepta `line` — acá el drag es justamente la forma de
 * moverse entre días/líneas de la semana visible, así que no aplica esa
 * restricción. El caller (ruta) ya validó que el actor es PRODUCCION.
 */
export async function rescheduleWorkItemDurable(id: string, input: RescheduleWorkItemInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        plannedDate: workItems.plannedDate,
        plannedDateTo: workItems.plannedDateTo,
        line: workItems.line,
        sector: workItems.sector,
        operationalStatus: workItems.operationalStatus,
        deletedAt: workItems.deletedAt,
        planningWeekId: workItems.planningWeekId,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");
    if (existing.deletedAt) {
      throw new PlanningValidationError("Este trabajo fue borrado y no puede replanificarse.");
    }
    if (!isWorkItemReschedulable(existing.operationalStatus, null)) {
      throw new PlanningValidationError(
        "Este trabajo ya avanzó (entregado, enviado a Calidad/Codificado o cancelado) y no puede moverse."
      );
    }

    const nextDate = input.plannedDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      throw new PlanningValidationError("Fecha de producción inválida.");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const patch: Partial<typeof workItems.$inferInsert> = { updatedAt: new Date() };

    const currentFrom = String(existing.plannedDate);
    const currentTo = existing.plannedDateTo ? String(existing.plannedDateTo) : currentFrom;
    if (nextDate !== currentFrom || nextDate !== currentTo) {
      before.plannedDate = currentFrom;
      before.plannedDateTo = existing.plannedDateTo ?? null;
      after.plannedDate = nextDate;
      after.plannedDateTo = null;
      patch.plannedDate = nextDate;
      patch.plannedDateTo = null;
    }

    if (input.line !== undefined) {
      const nextLine = input.line?.trim() || null;
      if (nextLine !== (existing.line ?? null)) {
        before.line = existing.line ?? null;
        after.line = nextLine;
        patch.line = nextLine;
      }
    }

    if (Object.keys(after).length === 0) {
      throw new Error("No hay cambios para guardar.");
    }

    const [row] = await tx.update(workItems).set(patch).where(eq(workItems.id, id)).returning();
    if (!row) throw new Error("No se pudo reprogramar el trabajo.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "WORK_ITEM_RESCHEDULED",
      fromStatus: JSON.stringify(before),
      toStatus: JSON.stringify(after),
      actorEmail: input.updatedBy,
      actorSector: String(input.updatedBySector),
      note: null,
    });

    return row;
  });
}

export interface DeleteWorkItemInput {
  /** Obligatorio — nunca se acepta un borrado sin motivo auditable. */
  reason: string;
  deletedBy: string;
  /** Ver UpdateWorkItemPlanningInput#expectedVersion. */
  expectedVersion?: number;
}

/**
 * Borrado de un trabajo por Producción (0025) — SIEMPRE soft delete/tombstone,
 * nunca DELETE físico: la fila de work_items nunca se destruye, así que OA
 * (operational_orders.linkedWorkItemId), packingGroups, muestras, decisiones
 * de Calidad, operational_events y work_item_deliveries quedan intactos y
 * reconstruibles. Reutilizar el DELETE físico existente (DrizzleRepository.
 * deleteItem) sería inseguro acá: work_item_deliveries tiene FK ON DELETE
 * CASCADE sobre work_item_id (ver schema.ts) y borraría el historial de
 * entregas real. Idempotente: si ya estaba borrado, devuelve la fila sin
 * volver a escribir el evento. El caller (ruta) ya validó que el actor es
 * PRODUCCION — no hay chequeo adicional de sector acá porque el check
 * constraint work_items_sector_assignment garantiza que sector es siempre
 * uno de los 4 que Producción gestiona.
 */
export async function deleteWorkItemDurable(id: string, input: DeleteWorkItemInput) {
  const reason = input.reason?.trim();
  if (!reason) {
    throw new PlanningValidationError("El motivo es obligatorio para eliminar un trabajo.");
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        deletedAt: workItems.deletedAt,
        sector: workItems.sector,
        product: workItems.product,
        client: workItems.client,
        operationalStatus: workItems.operationalStatus,
        planningWeekId: workItems.planningWeekId,
        version: workItems.version,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");
    if (existing.deletedAt) {
      const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
      return row!;
    }
    assertVersionMatches(existing.version, input.expectedVersion);

    const now = new Date();
    const [row] = await tx
      .update(workItems)
      .set({
        deletedAt: now,
        deletedBy: input.deletedBy,
        deleteReason: reason,
        updatedAt: now,
        version: existing.version + 1,
      })
      .where(eq(workItems.id, id))
      .returning();
    if (!row) throw new Error("No se pudo borrar el trabajo.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "WORK_ITEM_DELETED_BY_PRODUCCION",
      fromStatus: existing.operationalStatus,
      toStatus: existing.operationalStatus,
      actorEmail: input.deletedBy,
      actorSector: "PRODUCCION",
      note: `sector=${existing.sector} · producto=${existing.product} · cliente=${existing.client} · motivo=${reason}`,
    });

    return row;
  });
}

export interface CompleteWorkInput {
  finishedQty: string;
  observation: string;
  completedBy: string;
  /**
   * Sobrante de granel (0026) — el registro en depósito ya se creó por su
   * propio camino idempotente (graneles-service.ts, upsertFromEnvasado);
   * esto solo enlaza el work item con ese registro, igual que ya hace
   * handoffToCodificadoDurable para el camino Envasado→Codificado. Antes de
   * este fix, el camino de "Entregar a Calidad" directo (sin Codificado)
   * nunca lo persistía acá — el sobrante quedaba invisible en el work item.
   */
  bulkRemainderKg?: number | null;
  bulkRemainderObservation?: string | null;
  bulkRemainderId?: string | null;
}

/**
 * @param actorSector Ver saveWorkProgressDurable — mismo criterio de RBAC.
 *
 * Cierre de packaging al completar directo (sin pasar por Codificado): si
 * el trabajo ya tiene packingGroups reales (cargados vía
 * PackagingQuantitiesBlock, ej. el drawer de Envasado), esta función debe
 * calcular y persistir packedUnits/packagingClosedAt igual que
 * handoffToCodificadoDurable — si no, entregas/remito caen al bruto
 * (packagingTotalUnits) para estos trabajos. Si NO hay packingGroups
 * (trabajo sin distribución de cajas, ej. Elaboración), el campo se deja
 * sin tocar — nunca se infiere. La columna en DB se sigue llamando
 * `deliverableUnits` (histórica) pero ahora siempre guarda packedUnits —
 * nunca producido menos muestras (regla definitiva: muestras es metadata).
 */
export async function completeWorkDurable(
  id: string,
  input: CompleteWorkInput,
  actorSector: SectorId | string
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        sector: workItems.sector,
        unit: workItems.unit,
        packingGroups: workItems.packingGroups,
        sampleUnits: workItems.sampleUnits,
        planningWeekId: workItems.planningWeekId,
        operationalStatus: workItems.operationalStatus,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!existing) throw new Error("Work item no encontrado.");
    if (!canActOnWorkItemSector(actorSector, existing.sector)) {
      throw new OrdersForbiddenError(WORK_PROGRESS_DENIED_MESSAGE);
    }

    const now = new Date();
    const parsed = isIntegerUnit(existing.unit)
      ? parseArInteger(input.finishedQty)
      : parseArDecimal(input.finishedQty);
    const packedUnits = resolveDirectCompletePackedUnits({
      packingGroups: existing.packingGroups as PackingGroup[] | null,
      sampleUnits: existing.sampleUnits,
      finishedQty: parsed.ok ? parsed.value : null,
    });
    const closePatch =
      packedUnits != null
        ? { deliverableUnits: packedUnits, packagingClosedAt: now, packagingClosedBy: input.completedBy }
        : null;

    const patch: Partial<typeof workItems.$inferInsert> = {
      operationalStatus: "revision",
      finishedQty: input.finishedQty.trim(),
      operationalObservation: input.observation.trim(),
      completedAt: now,
      completedBy: input.completedBy,
      progressUpdatedAt: now,
      progressUpdatedBy: input.completedBy,
      updatedAt: now,
      // Reenvío tras un Rehacer: se resuelve el pedido, ya no queda "pendiente".
      reworkRequestedAt: null,
      reworkRequestedBy: null,
      reworkRequestedBySector: null,
      reworkReason: null,
      ...(closePatch ?? {}),
    };
    if (input.bulkRemainderKg !== undefined) patch.bulkRemainderKg = input.bulkRemainderKg;
    if (input.bulkRemainderObservation !== undefined)
      patch.bulkRemainderObservation = input.bulkRemainderObservation;
    if (input.bulkRemainderId !== undefined) patch.bulkRemainderId = input.bulkRemainderId;

    const [row] = await tx
      .update(workItems)
      .set(patch)
      .where(eq(workItems.id, id))
      .returning();
    if (!row) throw new Error("Work item no encontrado.");

    // Trazabilidad de quién/cuándo completó — todas las demás mutaciones de
    // este archivo dejan un operational_events; a esta le faltaba.
    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: existing.planningWeekId,
      type: "WORK_ITEM_COMPLETED",
      fromStatus: existing.operationalStatus,
      toStatus: "revision",
      actorEmail: input.completedBy,
      actorSector: String(actorSector),
      note: `finishedQty=${input.finishedQty.trim()}`,
    });

    return row;
  });
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

export interface ReworkWorkItemInput {
  requestedBy: string;
  requestedBySector: SectorId | string;
  reason?: string | null;
}

/**
 * "Rehacer" — Calidad o Producción (RBAC: quality-decision-rbac.ts, mismo
 * conjunto que Aprobar/Rechazar) devuelve el work item al sector que lo
 * envió. El sector NO cambia — solo se reabre: se limpia completedAt (sale
 * de la cola de Calidad, listCompletedItems filtra por completedAt IS NOT
 * NULL) y, si venía de una entrega de Codificado, también
 * deliveredFromCodificadoAt (sale de "codificado_completo" en
 * resolveProjectedStatus). OA/lote/VTO/packingGroups/historial quedan
 * intactos — no se toca ninguna de esas columnas. Idempotente en el sentido
 * de que reintentar sobre un item ya reabierto simplemente vuelve a fallar
 * la validación de canRequestRework (completedAt ya es null).
 */
export async function reworkWorkItemDurable(id: string, input: ReworkWorkItemInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        sector: workItems.sector,
        planningWeekId: workItems.planningWeekId,
        operationalStatus: workItems.operationalStatus,
        completedAt: workItems.completedAt,
        qualityStatus: workItems.qualityStatus,
        deliveredFromCodificadoAt: workItems.deliveredFromCodificadoAt,
        deletedAt: workItems.deletedAt,
      })
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);
    if (!row) throw new Error("Work item no encontrado.");
    if (row.deletedAt) {
      throw new PlanningValidationError("Este trabajo fue borrado por Producción.");
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

    const eligibility = canRequestRework({
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      qualityStatus: row.qualityStatus,
      hasActiveClientDelivery: Boolean(activeDelivery),
    });
    if (!eligibility.ok) {
      throw new PlanningValidationError(eligibility.error);
    }

    const now = new Date();
    const reason = input.reason?.trim() || null;
    const patch: Partial<typeof workItems.$inferInsert> = {
      operationalStatus: "en_curso",
      completedAt: null,
      completedBy: null,
      reworkRequestedAt: now,
      reworkRequestedBy: input.requestedBy,
      reworkRequestedBySector: String(input.requestedBySector),
      reworkReason: reason,
      progressUpdatedAt: now,
      progressUpdatedBy: input.requestedBy,
      updatedAt: now,
    };
    if (row.deliveredFromCodificadoAt) {
      patch.deliveredFromCodificadoAt = null;
      patch.deliveredFromCodificadoBy = null;
    }
    const [updated] = await tx
      .update(workItems)
      .set(patch)
      .where(eq(workItems.id, id))
      .returning();
    if (!updated) throw new Error("No se pudo procesar el Rehacer.");

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "REWORK_REQUESTED",
      fromStatus: row.operationalStatus,
      toStatus: "en_curso",
      actorEmail: input.requestedBy,
      actorSector: String(input.requestedBySector),
      note: reason,
    });

    return updated;
  });
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
  /**
   * codigo (código de producto) no vive en work_items — sale de un registro
   * aparte (Asignación de Lotes). Fuera del alcance de esta garantía: no es
   * un campo operativo del WorkItem, así que sigue viniendo del caller.
   */
  codigo: string | null;
  sourceSector: SectorId;
  plannedDeliveryDate: string | null;
  actualDeliveredAt: string;
  remito: string | null;
  receivedBy: string | null;
  observations: string | null;
  deliveredBy: string;
  deliveredBySector: SectorId;
  /**
   * @deprecated Datos canónicos del work item (product/client/lote/quantity/
   * unit y todo lo que WorkItemOperationalData cubre) — el servidor los
   * relee SIEMPRE frescos de Neon (ver loadWorkItemOperationalData) y
   * descarta lo que venga acá. Quedan tipados por compat con clientes
   * viejos, pero nunca se persisten.
   */
  product?: string;
  lote?: string | null;
  client?: string | null;
  quantity?: string | null;
  unit?: string | null;
}

/**
 * Idempotente: si ya hay una entrega activa (ENTREGADO, no archivada) para
 * el work item, la devuelve.
 *
 * REGLA: al momento de esta entrega, el servidor toma como fuente de verdad
 * el work_item ACTUAL en Neon — nunca el body del frontend, que puede venir
 * de una pantalla abierta hace rato y no reflejar un lote/VTO/packingGroups
 * que otro sector acaba de completar (ver loadWorkItemOperationalData). El
 * frontend solo controla datos propios de ESTA acción de entrega
 * (fecha/hora real, remito, quién recibe, observaciones) — nunca puede
 * reemplazar datos canónicos del work item con un valor stale.
 *
 * Es además un snapshot histórico (0028/0031): el work_item sigue siendo
 * editable después (ej. corrección de VTO por Producción), pero la entrega
 * ya confirmada conserva exactamente lo que existía en Neon en el momento
 * real de la entrega.
 */
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

    const canonical = await loadWorkItemOperationalData(tx, input.workItemId);
    if (!canonical) throw new Error("Work item no encontrado.");

    const [row] = await tx
      .insert(workItemDeliveries)
      .values({
        workItemId: input.workItemId,
        qualityItemId: input.qualityItemId ?? null,
        product: canonical.product,
        codigo: input.codigo,
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
        sourceSector: input.sourceSector,
        // Cantidad "oficial" de la entrega: lo físicamente embalado
        // (deliverableUnits) cuando hay cierre; si no, la cantidad final
        // declarada. Nunca la cantidad cruda producida ni un valor del body.
        quantity:
          canonical.deliverableUnits != null
            ? String(canonical.deliverableUnits)
            : (canonical.finishedQty ?? canonical.plannedQuantity),
        unit: canonical.unit,
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
    // vto/orderNumber/packingGroups (0028) se persistían pero nunca viajaban
    // al cliente acá — la UI no podía mostrarlos aunque Neon los tuviera.
    vto: row.vto ?? null,
    orderNumber: row.orderNumber ?? null,
    packingGroups:
      (row.packingGroups as Array<{ cajas: number; unidadesPorCaja: number }> | null) ?? null,
    // Snapshot completo (0031) — ver work-item-operational-data.ts.
    plannedQuantity: row.plannedQuantity ?? null,
    finishedQty: row.finishedQty ?? null,
    sampleUnits: row.sampleUnits ?? null,
    deliverableUnits: row.deliverableUnits ?? null,
    bulkRemainderKg: row.bulkRemainderKg ?? null,
    bulkRemainderObservation: row.bulkRemainderObservation ?? null,
    productionPedidoId: row.productionPedidoId ?? null,
    pedidoOp: row.pedidoOp ?? null,
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
