import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  operationalEvents,
  productionPedidos,
  productionPedidoStatusEvents,
  workItems,
} from "@/lib/db/schema";
import { normalizeSearchKey } from "@/lib/formulas/types";
import { todayInBuenosAires } from "@/lib/operational/operational-calendar";
import { assignWorkItemDurable } from "@/lib/planning/work-assignment-service";
import { mapItem } from "@/lib/planning/codificado-handoff-service";
import { canActOnWorkItemSector } from "@/features/os/operational/lib/work-progress-rbac";
import { extractPedidoNumber } from "@/features/os/operational/lib/pedido-order-ref";
import type { PlanningActor, PlanningWorkItemRecord } from "@/lib/planning/types";
import {
  PlanningConflictError,
  PlanningForbiddenError,
  PlanningNotFoundError,
  PlanningOaCompatibilityError,
  PlanningValidationError,
} from "@/lib/planning/types";
import { normalizeLine } from "@/lib/planning/validators";
import {
  envasadoLinesFor,
  isEnvasadoDestination,
  suggestEnvasadoDestination,
  type DestinationSuggestion,
  type EnvasadoDestination,
} from "./destination";
import { emitCircuitNotification } from "./circuit-notifications";
import type { CircuitMovement } from "./movements";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const PEDIDO_RANK: Record<string, number> = {
  INGRESO: 0,
  EN_ELABORACION: 1,
  EN_PROCESO: 1,
  EN_ENVASADO: 2,
  EN_CODIFICADO: 3,
  LISTO_PARA_ENTREGAR: 4,
  TERMINADO: 4,
  ENTREGADO: 5,
};

function normalizeId(raw: string): string {
  const t = String(raw ?? "").trim();
  return t.startsWith("native:") ? t.slice("native:".length) : t;
}

export interface SendToEnvasadoInput {
  workItemId: string;
  /** Si no viene, se deduce (pedido / historial). Si no se puede deducir, se rechaza pidiendo elegirlo. */
  destination?: EnvasadoDestination | null;
  /** Línea de Envasado para el trabajo nuevo (default «Línea 1»). Ignorado si se enlaza uno existente. */
  line?: string | null;
  /** Kg realmente elaborados (Elaboración). */
  producedQuantity?: string | null;
  /** Unidades a envasar para el trabajo nuevo (opcional; por defecto las del pedido o la cantidad de Elaboración). */
  unitsToPackage?: string | null;
  observation?: string | null;
  /** Fecha de envasado para el trabajo nuevo (default hoy). */
  plannedDate?: string | null;
  idempotencyKey: string;
}

export interface SendToEnvasadoResult {
  source: PlanningWorkItemRecord;
  destination: PlanningWorkItemRecord;
  destinationSector: EnvasadoDestination;
  /** true si se enlazó un trabajo de Envasado ya existente (no se duplicó). */
  linked: boolean;
  replayed: boolean;
  operationId: string;
}

/** Sugerencia de destino para el diálogo (solo lectura). */
export async function suggestEnvasadoDestinationForItem(
  workItemId: string,
  actorSector?: string | null
): Promise<DestinationSuggestion & { pedidoOp: string | null; unitsHint: string | null }> {
  const id = normalizeId(workItemId);
  const db = getDb();
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
  // Misma regla de sector que el POST: solo quien puede actuar sobre el trabajo ve destino/OP/unidades.
  if (actorSector !== undefined && !canActOnWorkItemSector(String(actorSector ?? "").toUpperCase(), row.sector)) {
    throw new PlanningForbiddenError("No tenés permiso para ver este trabajo — no está asignado a tu sector.");
  }
  return suggestForRow(db, row);
}

async function suggestForRow(tx: Tx, row: typeof workItems.$inferSelect) {
  const candidates = (await tx
    .select({
      sector: workItems.sector,
      pedidoId: workItems.productionPedidoId,
      client: workItems.client,
      product: workItems.product,
      originSector: workItems.codificadoOriginSector,
      viaCodificado: workItems.viaCodificado,
    })
    .from(workItems)
    .where(
      and(
        sql`${workItems.deletedAt} IS NULL`,
        sql`${workItems.sector} IN ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM', 'CODIFICADO')`,
        sql`${workItems.id} <> ${row.id}`,
        row.productionPedidoId
          ? sql`(${workItems.productionPedidoId} = ${row.productionPedidoId} OR lower(${workItems.client}) = lower(${row.client}))`
          : sql`lower(${workItems.client}) = lower(${row.client})`
      )
    )
    .orderBy(desc(workItems.createdAt))
    .limit(200)) as Array<{
    sector: string;
    pedidoId: string | null;
    client: string;
    product: string;
    originSector: string | null;
    viaCodificado: boolean;
  }>;
  // Un trabajo ya en Codificado vino de un Envasado: ese origen cuenta como el Envasado real.
  const normalized = candidates.map((c) => ({
    sector: c.sector === "CODIFICADO" ? (c.originSector ?? "CODIFICADO") : c.sector,
    pedidoId: c.pedidoId,
    client: c.client,
    product: c.product,
  }));
  const suggestion = suggestEnvasadoDestination(
    { pedidoId: row.productionPedidoId, client: row.client, product: row.product },
    normalized
  );
  let pedidoOp: string | null = null;
  let unitsHint: string | null = null;
  if (row.productionPedidoId) {
    const [pedido] = await tx
      .select({ op: productionPedidos.op, q: productionPedidos.q })
      .from(productionPedidos)
      .where(eq(productionPedidos.id, row.productionPedidoId))
      .limit(1);
    pedidoOp = pedido?.op ?? null;
    unitsHint = pedido?.q != null && Number(pedido.q) > 0 ? String(Math.round(Number(pedido.q))) : null;
  }
  return { ...suggestion, pedidoOp, unitsHint };
}

async function touchPedidoEnvasado(
  tx: Tx,
  workItemId: string,
  pedidoId: string | null,
  actor: PlanningActor
): Promise<void> {
  if (!pedidoId) return;
  const [pedido] = await tx
    .select({ id: productionPedidos.id, estado: productionPedidos.estado })
    .from(productionPedidos)
    .where(and(eq(productionPedidos.id, pedidoId), sql`${productionPedidos.deletedAt} IS NULL`))
    .limit(1);
  if (!pedido) return;
  const fromRank = PEDIDO_RANK[pedido.estado ?? "INGRESO"] ?? 0;
  if (fromRank >= PEDIDO_RANK.EN_ENVASADO) return; // monótono: nunca retrocede
  await tx
    .update(productionPedidos)
    .set({ estado: "EN_ENVASADO", updatedBy: actor.email, updatedAt: new Date() })
    .where(eq(productionPedidos.id, pedidoId));
  await tx.insert(productionPedidoStatusEvents).values({
    pedidoId,
    workItemId,
    fromEstado: pedido.estado,
    toEstado: "EN_ENVASADO",
    actorEmail: actor.email,
    actorSector: actor.sector,
    event: "ELABORACION_TO_ENVASADO",
    motivo: null,
  });
}

/**
 * Elaboración → Envasado Masivo/Premium, DIRECTO (sin Calidad ni aprobación). En UNA transacción e idempotente:
 *  - marca el trabajo de Elaboración como completo (quién/cuándo/cantidad producida);
 *  - crea el trabajo de Envasado del sector destino con la misma identidad (cliente, producto, lote, vto, pedido,
 *    fecha de entrega) o, si ya existe uno del mismo pedido + producto, lo ENLAZA en vez de duplicar;
 *  - deja eventos operativos en ambos trabajos (trazabilidad) y avisa a Producción (fuera de la transacción).
 * NO es una entrega final del pedido y no toca inventario ni consumo de MP.
 */
export async function sendElaboracionToEnvasadoDurable(
  input: SendToEnvasadoInput,
  actor: PlanningActor,
  operationId: string = randomUUID()
): Promise<SendToEnvasadoResult> {
  const id = normalizeId(input.workItemId);
  if (!id) throw new PlanningValidationError("workItemId requerido.");
  const key = input.idempotencyKey?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new PlanningValidationError("idempotencyKey inválida (8–128).");
  }
  const actorSector = String(actor.sector ?? "").toUpperCase();
  const actorName = actor.displayName || actor.email;
  const idemRef = `envasado:send:${key}`;

  const db = getDb();
  const result = await db.transaction(async (tx): Promise<SendToEnvasadoResult & { movement: CircuitMovement }> => {
    const [row] = await tx.select().from(workItems).where(eq(workItems.id, id)).for("update").limit(1);
    if (!row) throw new PlanningNotFoundError("Trabajo no encontrado.");
    if (row.sector !== "ELABORACION") {
      throw new PlanningValidationError("Solo los trabajos de Elaboración se envían a Envasado.");
    }
    if (!canActOnWorkItemSector(actorSector, row.sector)) {
      throw new PlanningForbiddenError(
        "No tenés permiso para enviar este trabajo a Envasado — no está asignado a tu sector."
      );
    }
    if (row.deletedAt) throw new PlanningValidationError("Este trabajo fue borrado por Producción.");
    if (row.operationalStatus === "cancelado") {
      throw new PlanningValidationError("Este trabajo está cancelado: no se puede enviar a Envasado.");
    }

    // Replay: el trabajo ya se envió (misma clave u otra) → devuelve lo que ya existe, sin duplicar.
    const prior = await tx
      .select()
      .from(operationalEvents)
      .where(and(eq(operationalEvents.workItemId, id), eq(operationalEvents.type, "SENT_TO_ENVASADO")))
      .orderBy(desc(operationalEvents.createdAt))
      .limit(1);
    if (row.operationalStatus === "completo" && prior[0]?.note) {
      const destId = /to=([0-9a-f-]{36})/.exec(prior[0].note)?.[1];
      if (destId) {
        const [dest] = await tx.select().from(workItems).where(eq(workItems.id, destId)).limit(1);
        if (dest) {
          return {
            source: mapItem(row),
            destination: mapItem(dest),
            destinationSector: dest.sector as EnvasadoDestination,
            linked: /linked=1/.test(prior[0].note),
            replayed: true,
            operationId,
            movement: movementFor(row, dest.sector as EnvasadoDestination, key, actor, input.producedQuantity),
          };
        }
      }
    }

    // Destino: elegido o deducido; si no se puede, se pide elegirlo (nunca se adivina).
    const suggestion = await suggestForRow(tx, row);
    const destSector: EnvasadoDestination | null = isEnvasadoDestination(input.destination)
      ? input.destination
      : suggestion.sector;
    if (!destSector) {
      throw new PlanningValidationError(
        "No se pudo determinar si va a Envasado Masivo o Premium. Elegí el destino."
      );
    }

    // ¿Ya hay un trabajo de Envasado del MISMO pedido + producto? Se enlaza (no se duplica).
    let linkedRow: typeof workItems.$inferSelect | null = null;
    const productKey = normalizeSearchKey(row.product);
    if (row.productionPedidoId) {
      const siblings = (await tx
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.productionPedidoId, row.productionPedidoId),
            sql`${workItems.deletedAt} IS NULL`,
            sql`${workItems.sector} IN ('ENVASADO_MASIVO', 'ENVASADO_PREMIUM', 'CODIFICADO')`,
            sql`${workItems.operationalStatus} NOT IN ('cancelado', 'entregado')`
          )
        )
        .orderBy(desc(workItems.createdAt))) as Array<typeof workItems.$inferSelect>;
      linkedRow = siblings.find((s) => normalizeSearchKey(s.product) === productKey) ?? null;
    }

    let destinationRow: typeof workItems.$inferSelect;
    let linked = false;
    if (linkedRow) {
      destinationRow = linkedRow;
      linked = true;
    } else {
      const line = normalizeLine(input.line) ?? "Línea 1";
      if (!envasadoLinesFor(destSector).includes(line)) {
        throw new PlanningValidationError(
          `La línea ${line} no existe en ${destSector === "ENVASADO_MASIVO" ? "Envasado Masivo" : "Envasado Premium"}.`
        );
      }
      const plannedDate = input.plannedDate?.trim() || todayInBuenosAires();
      let pedidoOp: string | null = null;
      let pedidoUnits: string | null = null;
      if (row.productionPedidoId) {
        const [pedido] = await tx
          .select({ op: productionPedidos.op, q: productionPedidos.q })
          .from(productionPedidos)
          .where(eq(productionPedidos.id, row.productionPedidoId))
          .limit(1);
        pedidoOp = pedido?.op ?? null;
        pedidoUnits = pedido?.q != null && Number(pedido.q) > 0 ? String(Math.round(Number(pedido.q))) : null;
      }
      const unitsExplicit = input.unitsToPackage?.trim() || null;
      const plannedQuantity = unitsExplicit ?? pedidoUnits ?? row.plannedQuantity;
      const unit = unitsExplicit || pedidoUnits ? "un." : row.unit;
      const pedidoNumber = extractPedidoNumber(pedidoOp);
      const orderNumber = pedidoNumber ? `OA-${plannedDate.slice(0, 4)}-${pedidoNumber}` : null;
      const baseAssignment = {
        sector: destSector,
        client: row.client,
        product: row.product,
        plannedQuantity,
        unit,
        plannedDate,
        deliveryDate: row.deliveryDate ? String(row.deliveryDate) : null,
        line,
        branchOwner: null,
        notes: input.observation?.trim() || null,
        packagingLote: row.packagingLote ?? null,
        packagingVto: row.packagingVto ?? null,
        // Mismo lote de producto terminado que la OE: el vínculo con Asignación de Lotes viaja a Envasado/OA.
        asignacionLoteId: row.asignacionLoteId ?? null,
        productionPedidoId: row.productionPedidoId ?? null,
        // Clave por trabajo de Elaboración: un mismo trabajo nunca genera dos de Envasado, aunque cambie la request.
        idempotencyKey: `elab2env:${id}`,
        forceLink: true,
      };
      let assigned;
      try {
        // Savepoint: si la OA automática choca con otra orden, el envío NO se bloquea — se reintenta sin OA y
        // Producción la vincula después (nunca se frena el trabajo por un detalle de documentación).
        assigned = await tx.transaction((sp: Tx) =>
          assignWorkItemDurable({ ...baseAssignment, orderNumber }, actor, operationId, { tx: sp, skipRoleCheck: true })
        );
      } catch (error) {
        if (
          orderNumber &&
          (error instanceof PlanningConflictError ||
            error instanceof PlanningOaCompatibilityError ||
            error instanceof PlanningValidationError)
        ) {
          assigned = await assignWorkItemDurable({ ...baseAssignment, orderNumber: null }, actor, operationId, {
            tx,
            skipRoleCheck: true,
          });
        } else {
          throw error;
        }
      }
      const [created] = await tx.select().from(workItems).where(eq(workItems.id, assigned.item.id)).limit(1);
      destinationRow = created;
      // assigned.replayed = el trabajo de Envasado ya lo había creado ESTE trabajo de Elaboración (no es un enlace ajeno).
      linked = false;
    }

    const now = new Date();
    const finished = input.producedQuantity?.trim() || row.finishedQty || null;
    await tx
      .update(workItems)
      .set({
        operationalStatus: "completo",
        finishedQty: finished,
        operationalObservation: input.observation?.trim() || row.operationalObservation,
        completedAt: now,
        completedBy: actorName,
        progressUpdatedAt: now,
        progressUpdatedBy: actorName,
        reworkRequestedAt: null,
        reworkRequestedBy: null,
        reworkRequestedBySector: null,
        reworkReason: null,
        version: Number(row.version) + 1,
        updatedAt: now,
      })
      .where(eq(workItems.id, id));

    await tx.insert(operationalEvents).values({
      workItemId: id,
      planningWeekId: row.planningWeekId,
      type: "SENT_TO_ENVASADO",
      fromStatus: row.operationalStatus,
      toStatus: "completo",
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `${idemRef} | to=${destinationRow.id} | sector=${destSector} | linked=${linked ? 1 : 0} | kg=${finished ?? "s/d"}`,
    });
    await tx.insert(operationalEvents).values({
      workItemId: destinationRow.id,
      planningWeekId: destinationRow.planningWeekId,
      type: "RECEIVED_FROM_ELABORACION",
      fromStatus: null,
      toStatus: destinationRow.operationalStatus,
      actorEmail: actor.email,
      actorSector: actor.sector,
      note: `${idemRef} | from=${id} | lote=${row.packagingLote ?? "s/d"} | linked=${linked ? 1 : 0}`,
    });

    await touchPedidoEnvasado(tx, destinationRow.id, row.productionPedidoId ?? null, actor);

    const [sourceAfter] = await tx.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    return {
      source: mapItem(sourceAfter),
      destination: mapItem(destinationRow),
      destinationSector: destSector,
      linked,
      replayed: false,
      operationId,
      movement: movementFor(row, destSector, key, actor, finished),
    };
  });

  await emitCircuitNotification(result.movement);
  const { movement: _movement, ...rest } = result;
  void _movement;
  return rest;
}

function movementFor(
  row: typeof workItems.$inferSelect,
  dest: EnvasadoDestination,
  key: string,
  actor: PlanningActor,
  produced: string | null | undefined
): CircuitMovement {
  return {
    type: "ELABORACION_A_ENVASADO",
    workItemId: row.id,
    eventKey: key,
    fromSector: "ELABORACION",
    toSector: dest,
    client: row.client,
    product: row.product,
    quantity: produced?.trim() || row.finishedQty || row.plannedQuantity,
    unit: row.unit,
    lote: row.packagingLote ?? null,
    at: new Date(),
    actorName: actor.displayName || actor.email,
    actorEmail: actor.email,
  };
}
