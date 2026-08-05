import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  operationalEvents,
  operationalOrders,
  planningWeeks,
  workItems,
} from "@/lib/db/schema";
import { weekStartMonday } from "@/lib/operational/operational-calendar";
import type { PlanningActor, PlanningSector, PlanningWorkItemRecord } from "@/lib/planning/types";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningValidationError,
} from "@/lib/planning/types";
import {
  assertIsoDate,
  assertSectorAssignment,
  normalizeBranchOwner,
  normalizeLine,
} from "@/lib/planning/validators";
import { logSanitizedError } from "@/lib/planning/sanitize-public-error";

export type WorkAssignmentInput = {
  sector: PlanningSector;
  client: string;
  product: string;
  plannedQuantity: string;
  unit?: string;
  plannedDate: string;
  plannedDateTo?: string | null;
  deliveryDate?: string | null;
  line?: string | null;
  branchOwner?: string | null;
  notes?: string | null;
  /** OE/OA número (ej. OE-2026-000123). Opcional. */
  orderNumber?: string | null;
  orderId?: string | null;
  packagingLote?: string | null;
  packagingVto?: string | null;
  /** Cliente debe reenviar la misma key en reintentos. */
  idempotencyKey: string;
};

export type WorkAssignmentResult = {
  item: PlanningWorkItemRecord;
  replayed: boolean;
  order: {
    id: string;
    orderNumber: string;
    assignedSector: string;
    linkedWorkItemId: string | null;
  } | null;
  operationId: string;
};

function idempotencyOriginRef(key: string): string {
  return `assign:idem:${key.trim()}`;
}

function mapItemRow(row: typeof workItems.$inferSelect): PlanningWorkItemRecord {
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
  };
}

/** Solo observaciones libres — lote/VTO/entrega/OA van en columnas. */
function composeNotes(input: WorkAssignmentInput): string | null {
  const text = input.notes?.trim() || "";
  return text || null;
}

/**
 * Asigna un trabajo publicado en Neon de forma atómica e idempotente.
 * Causa raíz previa: UI escribía solo localStorage y reportaba éxito sin Neon.
 */
export async function assignWorkItemDurable(
  input: WorkAssignmentInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<WorkAssignmentResult> {
  if (actor.sector !== "PRODUCCION" && actor.sector !== "DIRECCION") {
    throw new PlanningForbiddenError(
      "No tenés permiso para asignar trabajos."
    );
  }

  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new PlanningValidationError(
      "idempotencyKey inválida (8–128 caracteres)."
    );
  }

  if (!input.client?.trim() || !input.product?.trim() || !input.plannedQuantity?.trim()) {
    throw new PlanningValidationError(
      "Completá cliente, producto y cantidad."
    );
  }

  const plannedDate = assertIsoDate(input.plannedDate, "Desde");
  const plannedDateTo = input.plannedDateTo?.trim()
    ? assertIsoDate(input.plannedDateTo, "Hasta")
    : plannedDate;
  if (plannedDateTo < plannedDate) {
    throw new PlanningValidationError("Hasta no puede ser anterior a Desde.");
  }

  const line = normalizeLine(input.line);
  const branchOwner = normalizeBranchOwner(input.branchOwner);
  const assignment = assertSectorAssignment(input.sector, line, branchOwner);
  const weekStart = weekStartMonday(plannedDate);
  const originRef = idempotencyOriginRef(key);
  const notes = composeNotes(input);
  const orderNumber = input.orderNumber?.trim() || null;
  const orderId = input.orderId?.trim() || null;

  const db = getDb();

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.originRef, originRef))
        .limit(1);

      if (existing) {
        let orderMeta: WorkAssignmentResult["order"] = null;
        if (existing.id) {
          const [linked] = await tx
            .select({
              id: operationalOrders.id,
              orderNumber: operationalOrders.orderNumber,
              assignedSector: operationalOrders.assignedSector,
              linkedWorkItemId: operationalOrders.linkedWorkItemId,
            })
            .from(operationalOrders)
            .where(eq(operationalOrders.linkedWorkItemId, existing.id))
            .limit(1);
          if (linked) orderMeta = linked;
        }
        return {
          item: mapItemRow(existing),
          replayed: true,
          order: orderMeta,
          operationId,
        };
      }

      let [week] = await tx
        .select()
        .from(planningWeeks)
        .where(eq(planningWeeks.weekStart, weekStart))
        .limit(1);

      const now = new Date();

      if (!week) {
        const [created] = await tx
          .insert(planningWeeks)
          .values({
            weekStart,
            label: `Semana ${weekStart}`,
            status: "PUBLISHED",
            publishedAt: now,
            createdBy: actor.email,
          })
          .returning();
        week = created;
      } else if (week.status === "DRAFT") {
        const [published] = await tx
          .update(planningWeeks)
          .set({
            status: "PUBLISHED",
            publishedAt: now,
            version: sql`${planningWeeks.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(eq(planningWeeks.id, week.id), eq(planningWeeks.status, "DRAFT"))
          )
          .returning();
        if (!published) {
          throw new PlanningConflictError(
            "La semana cambió durante la asignación. Reintentá.",
            {
              id: week.id,
              weekStart: String(week.weekStart),
              label: week.label,
              status: week.status,
              publishedAt: week.publishedAt?.toISOString() ?? null,
              createdBy: week.createdBy,
              version: week.version,
              createdAt: week.createdAt.toISOString(),
              updatedAt: week.updatedAt.toISOString(),
            }
          );
        }
        await tx
          .update(workItems)
          .set({
            status: "PUBLICADO",
            publishedAt: now,
            version: sql`${workItems.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(workItems.planningWeekId, week.id),
              eq(workItems.status, "BORRADOR")
            )
          );
        week = published;
      }

      let orderRow: {
        id: string;
        orderNumber: string;
        assignedSector: string;
        linkedWorkItemId: string | null;
        type: string;
      } | null = null;

      if (orderId || orderNumber) {
        const [found] = orderId
          ? await tx
              .select({
                id: operationalOrders.id,
                orderNumber: operationalOrders.orderNumber,
                assignedSector: operationalOrders.assignedSector,
                linkedWorkItemId: operationalOrders.linkedWorkItemId,
                type: operationalOrders.type,
              })
              .from(operationalOrders)
              .where(eq(operationalOrders.id, orderId))
              .limit(1)
          : await tx
              .select({
                id: operationalOrders.id,
                orderNumber: operationalOrders.orderNumber,
                assignedSector: operationalOrders.assignedSector,
                linkedWorkItemId: operationalOrders.linkedWorkItemId,
                type: operationalOrders.type,
              })
              .from(operationalOrders)
              .where(eq(operationalOrders.orderNumber, orderNumber!))
              .limit(1);

        if (!found) {
          throw new PlanningValidationError(
            "No se encontró la orden indicada (OE/OA)."
          );
        }

        if (
          found.linkedWorkItemId &&
          found.linkedWorkItemId.trim() !== ""
        ) {
          throw new PlanningConflictError(
            "Esta orden ya tiene un trabajo asignado.",
            {
              id: "already-assigned",
              planningWeekId: week.id,
              plannedDate,
              client: input.client.trim(),
              product: input.product.trim(),
              plannedQuantity: input.plannedQuantity.trim(),
              unit: input.unit ?? "KG",
              sector: input.sector,
              line: assignment.line,
              branchOwner: assignment.branchOwner,
              priority: "NORMAL",
              notes: null,
              status: "PUBLICADO",
              publishedAt: null,
              createdBy: actor.email,
              source: "native",
              originRef: found.linkedWorkItemId,
              version: 1,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            }
          );
        }

        const expectedType = input.sector === "ELABORACION" ? "OE" : "OA";
        if (found.type !== expectedType) {
          throw new PlanningValidationError(
            `La referencia debe ser una ${expectedType}.`
          );
        }

        orderRow = found;
      }

      const [inserted] = await tx
        .insert(workItems)
        .values({
          planningWeekId: week.id,
          plannedDate,
          plannedDateTo: plannedDateTo === plannedDate ? null : plannedDateTo,
          client: input.client.trim(),
          product: input.product.trim(),
          plannedQuantity: input.plannedQuantity.trim(),
          unit: (input.unit ?? (input.sector === "ELABORACION" ? "kg" : "un.")).trim() || "KG",
          sector: input.sector,
          line: assignment.line,
          branchOwner: assignment.branchOwner,
          priority: "NORMAL",
          notes,
          packagingLote: input.packagingLote?.trim() || null,
          packagingVto: input.packagingVto?.trim() || null,
          packagingTotalUnits: (() => {
            const n = Number.parseFloat(
              String(input.plannedQuantity).replace(/\s/g, "").replace(",", ".")
            );
            return Number.isFinite(n) ? n : null;
          })(),
          orderId: orderRow?.id ?? null,
          orderNumber: orderRow?.orderNumber ?? orderNumber,
          deliveryDate: input.deliveryDate?.trim() || null,
          status: "PUBLICADO",
          publishedAt: now,
          createdBy: actor.email,
          source: "native",
          originRef,
        })
        .returning();

      let orderMeta: WorkAssignmentResult["order"] = null;
      if (orderRow) {
        const [updatedOrder] = await tx
          .update(operationalOrders)
          .set({
            assignedSector: input.sector,
            linkedWorkItemId: inserted.id,
            updatedBy: actor.email,
            updatedAt: now,
            version: sql`${operationalOrders.version} + 1`,
          })
          .where(
            and(
              eq(operationalOrders.id, orderRow.id),
              sql`(${operationalOrders.linkedWorkItemId} IS NULL OR ${operationalOrders.linkedWorkItemId} = '')`
            )
          )
          .returning({
            id: operationalOrders.id,
            orderNumber: operationalOrders.orderNumber,
            assignedSector: operationalOrders.assignedSector,
            linkedWorkItemId: operationalOrders.linkedWorkItemId,
          });

        if (!updatedOrder) {
          throw new PlanningConflictError(
            "Esta orden ya tiene un trabajo asignado.",
            mapItemRow(inserted)
          );
        }

        if (
          updatedOrder.linkedWorkItemId !== inserted.id ||
          updatedOrder.assignedSector !== input.sector
        ) {
          throw new PlanningValidationError(
            "No se pudo confirmar la coherencia OE ↔ trabajo. Reintentá."
          );
        }
        orderMeta = updatedOrder;
      }

      await tx.insert(operationalEvents).values({
        workItemId: inserted.id,
        planningWeekId: week.id,
        type: "ITEM_ASSIGNED",
        fromStatus: null,
        toStatus: "PUBLICADO",
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: `operationId=${operationId}`,
      });

      const [confirmed] = await tx
        .select()
        .from(workItems)
        .where(eq(workItems.id, inserted.id))
        .limit(1);

      if (!confirmed || confirmed.status !== "PUBLICADO") {
        throw new PlanningValidationError(
          "No se pudo confirmar el guardado en Neon. Reintentá."
        );
      }

      return {
        item: mapItemRow(confirmed),
        replayed: false,
        order: orderMeta,
        operationId,
      };
    });
  } catch (err) {
    logSanitizedError(operationId, "work-assignment", err);
    throw err;
  }
}
