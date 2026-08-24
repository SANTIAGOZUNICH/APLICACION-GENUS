import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  operationalEvents,
  operationalOrders,
  planningWeeks,
  productionPedidos,
  productionPedidoStatusEvents,
  workItems,
} from "@/lib/db/schema";
import { weekStartMonday } from "@/lib/operational/operational-calendar";
import { isIntegerUnit, parseArDecimal, parseArInteger } from "@/lib/utils/ar-number-parsing";
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
import { ensureOaForAssignment } from "@/lib/planning/ensure-oa-on-assign";
import {
  isPackagingOaSector,
  normalizeOaOrderNumber,
} from "@/lib/planning/oa-assign-helpers";

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
  /** OE/OA número (ej. OA-2026-000145). Opcional. */
  orderNumber?: string | null;
  orderId?: string | null;
  packagingLote?: string | null;
  packagingVto?: string | null;
  /** Código de producto (opcional; se copia a la OA). */
  productCode?: string | null;
  /** FK a production_pedidos — origina el trabajo desde un Pedido real (opcional). */
  productionPedidoId?: string | null;
  /** Cliente debe reenviar la misma key en reintentos. */
  idempotencyKey: string;
  /**
   * Si true y la OA existe con datos distintos, se vincula igual
   * rellenando solo campos vacíos (no sobrescribe confirmados).
   */
  forceLink?: boolean;
};

export type WorkAssignmentResult = {
  item: PlanningWorkItemRecord;
  replayed: boolean;
  order: {
    id: string;
    orderNumber: string;
    assignedSector: string;
    linkedWorkItemId: string | null;
    created?: boolean;
    linked?: boolean;
    filledEmptyFields?: string[];
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
    productionPedidoId: row.productionPedidoId ?? null,
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
 * Transacción Drizzle (tipado flexible, mismo patrón que ensure-oa-on-assign.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Orden monótono de estados de Pedido — solo se usa para no retroceder al
 * asignar un trabajo. No confundir con el estado del work item (otra
 * máquina de estados). "EN_PROCESO"/"TERMINADO" son alias legacy que el
 * CHECK constraint de production_pedidos todavía admite en lectura.
 */
const PEDIDO_STATUS_RANK: Record<string, number> = {
  INGRESO: 0,
  EN_ELABORACION: 1,
  EN_PROCESO: 1,
  EN_ENVASADO: 2,
  LISTO_PARA_ENTREGAR: 3,
  TERMINADO: 3,
  ENTREGADO: 4,
};

/**
 * No existe "EN_CODIFICADO" en production_pedidos (el CHECK constraint no lo
 * admite) — Codificado es, para el Pedido, la continuación del mismo tramo
 * de envasado, así que reusa EN_ENVASADO (mismo criterio que
 * touchPedidoEnEnvasado en codificado-handoff-service.ts).
 */
function targetPedidoStatusForSector(
  sector: PlanningWorkItemRecord["sector"]
): "EN_ELABORACION" | "EN_ENVASADO" | null {
  if (sector === "ELABORACION") return "EN_ELABORACION";
  if (
    sector === "ENVASADO_MASIVO" ||
    sector === "ENVASADO_PREMIUM" ||
    sector === "CODIFICADO"
  ) {
    return "EN_ENVASADO";
  }
  return null;
}

/**
 * Al asignar un trabajo con Pedido vinculado, hace avanzar el estado del
 * Pedido según el sector asignado — nunca retrocede (un Pedido con varios
 * work items siempre refleja la fase más avanzada real) y nunca duplica
 * (no-op si ya está en ese estado o más adelante). Reusa
 * production_pedido_status_events para la auditoría — mismo patrón que
 * touchPedidoEnEnvasado/touchPedidoListoParaEntregar.
 */
async function touchPedidoOnAssign(
  tx: Tx,
  workItemId: string,
  pedido: { id: string; estado: string | null },
  actor: PlanningActor,
  sector: PlanningWorkItemRecord["sector"]
): Promise<void> {
  const target = targetPedidoStatusForSector(sector);
  if (!target) return;
  const from = pedido.estado;
  const fromRank = PEDIDO_STATUS_RANK[from ?? "INGRESO"] ?? 0;
  const targetRank = PEDIDO_STATUS_RANK[target];
  if (fromRank >= targetRank) return;

  await tx
    .update(productionPedidos)
    .set({ estado: target, updatedBy: actor.email, updatedAt: new Date() })
    .where(eq(productionPedidos.id, pedido.id));

  await tx.insert(productionPedidoStatusEvents).values({
    pedidoId: pedido.id,
    workItemId,
    fromEstado: from,
    toEstado: target,
    actorEmail: actor.email,
    actorSector: actor.sector,
    event: "WORK_ITEM_ASSIGNED",
    motivo: null,
  });
}

/**
 * Asigna un trabajo publicado en Neon de forma atómica e idempotente.
 * Regla: 1 trabajo = 1 OA. Para Envasado Masivo/Premium/Codificado: si hay
 * número de OA y no existe, la crea automáticamente con ese mismo número
 * dentro de la misma transacción.
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
  const orderNumberRaw = input.orderNumber?.trim() || null;
  const orderId = input.orderId?.trim() || null;
  const forceLink = Boolean(input.forceLink);
  const productCode = input.productCode?.trim() || "";
  const productionPedidoId = input.productionPedidoId?.trim() || null;

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
        if (existing.orderId) {
          const [linked] = await tx
            .select({
              id: operationalOrders.id,
              orderNumber: operationalOrders.orderNumber,
              assignedSector: operationalOrders.assignedSector,
              linkedWorkItemId: operationalOrders.linkedWorkItemId,
            })
            .from(operationalOrders)
            .where(eq(operationalOrders.id, existing.orderId))
            .limit(1);
          if (linked) {
            orderMeta = { ...linked, created: false, linked: true };
          }
        } else if (existing.id) {
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
          if (linked) {
            orderMeta = { ...linked, created: false, linked: true };
          }
        }
        return {
          item: mapItemRow(existing),
          replayed: true,
          order: orderMeta,
          operationId,
        };
      }

      let pedidoSnapshot: { id: string; estado: string | null } | null = null;
      if (productionPedidoId) {
        const [foundPedido] = await tx
          .select({ id: productionPedidos.id, estado: productionPedidos.estado })
          .from(productionPedidos)
          .where(
            and(
              eq(productionPedidos.id, productionPedidoId),
              sql`${productionPedidos.deletedAt} IS NULL`
            )
          )
          .limit(1);
        if (!foundPedido) {
          throw new PlanningValidationError("Pedido no encontrado.");
        }
        pedidoSnapshot = foundPedido;
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
        created?: boolean;
        linked?: boolean;
        filledEmptyFields?: string[];
      } | null = null;

      // Envasado Masivo / Premium / Codificado: auto-crear o vincular OA.
      if (isPackagingOaSector(input.sector) && (orderNumberRaw || orderId)) {
        let numberForEnsure = orderNumberRaw;
        if (orderId && !numberForEnsure) {
          const [byId] = await tx
            .select({ orderNumber: operationalOrders.orderNumber })
            .from(operationalOrders)
            .where(eq(operationalOrders.id, orderId))
            .limit(1);
          numberForEnsure = byId?.orderNumber ?? null;
        }
        if (!numberForEnsure) {
          throw new PlanningValidationError("No se encontró la OA indicada.");
        }

        const ensured = await ensureOaForAssignment(tx, {
          orderNumberRaw: numberForEnsure,
          sector: input.sector,
          product: input.product.trim(),
          client: input.client.trim(),
          lot: input.packagingLote?.trim() || "",
          vto: input.packagingVto?.trim() || "",
          code: productCode,
          quantity: input.plannedQuantity.trim(),
          notes,
          assignmentDate: plannedDate,
          forceLink,
          actorEmail: actor.email,
          actorSector: actor.sector,
        });

        orderRow = {
          id: ensured.id,
          orderNumber: ensured.orderNumber,
          assignedSector: ensured.assignedSector,
          linkedWorkItemId: ensured.linkedWorkItemId,
          type: "OA",
          created: ensured.created,
          linked: ensured.linked,
          filledEmptyFields: ensured.filledEmptyFields,
        };
      } else if (orderId || orderNumberRaw) {
        // Elaboración (OE) u otros: lookup obligatorio, sin auto-crear.
        const lookupNumber = orderNumberRaw
          ? input.sector === "ELABORACION"
            ? orderNumberRaw.trim().toUpperCase().replace(/\s+/g, "")
            : normalizeOaOrderNumber(orderNumberRaw)
          : null;

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
              .where(eq(operationalOrders.orderNumber, lookupNumber!))
              .limit(1);

        if (!found) {
          throw new PlanningValidationError(
            "No se encontró la orden indicada (OE/OA)."
          );
        }

        if (found.linkedWorkItemId && found.linkedWorkItemId.trim() !== "") {
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

        orderRow = { ...found, created: false, linked: true };
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
          unit:
            (input.unit ?? (input.sector === "ELABORACION" ? "kg" : "un.")).trim() ||
            "KG",
          sector: input.sector,
          line: assignment.line,
          branchOwner: assignment.branchOwner,
          priority: "NORMAL",
          notes,
          packagingLote: input.packagingLote?.trim() || null,
          packagingVto: input.packagingVto?.trim() || null,
          packagingTotalUnits: (() => {
            const unit = input.unit ?? (input.sector === "ELABORACION" ? "kg" : "un.");
            const parsed = isIntegerUnit(unit)
              ? parseArInteger(input.plannedQuantity)
              : parseArDecimal(input.plannedQuantity);
            return parsed.ok ? parsed.value : null;
          })(),
          orderId: orderRow?.id ?? null,
          orderNumber: orderRow?.orderNumber ?? orderNumberRaw,
          productionPedidoId,
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

        // 1 trabajo = 1 OA/OE: la actualización condicional de arriba (WHERE
        // linkedWorkItemId IS NULL) es la que hace cumplir la regla ante una
        // carrera — si no devolvió fila, otra transacción ya vinculó esta
        // orden primero.
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
            "No se pudo confirmar la coherencia OA/OE ↔ trabajo. Reintentá."
          );
        }
        orderMeta = {
          ...updatedOrder,
          created: Boolean(orderRow.created),
          linked: !orderRow.created,
          filledEmptyFields: orderRow.filledEmptyFields ?? [],
        };
      }

      await tx.insert(operationalEvents).values({
        workItemId: inserted.id,
        planningWeekId: week.id,
        type: "ITEM_ASSIGNED",
        fromStatus: null,
        toStatus: "PUBLICADO",
        actorEmail: actor.email,
        actorSector: actor.sector,
        note: `operationId=${operationId};oa=${orderMeta?.orderNumber ?? "none"};oaCreated=${orderMeta?.created ?? false}`,
      });

      if (pedidoSnapshot) {
        await touchPedidoOnAssign(tx, inserted.id, pedidoSnapshot, actor, input.sector);
      }

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
