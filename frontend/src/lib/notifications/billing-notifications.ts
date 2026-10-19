import "server-only";

import { getDb } from "@/lib/db/client";
import { osNotifications } from "@/lib/db/schema";
import type { RecordDeliveryResult } from "@/lib/planning/circuit/delivery-core";
import { buildBillingNotification, type BillingEvent, type PackingGroupLite } from "./billing-notification-builder";

/**
 * Aviso a Administración / Facturación. Se inserta DESPUÉS de confirmar el hecho operativo (marca de «listo» o entrega
 * real), de forma best-effort e idempotente (id determinístico + onConflictDoNothing): un reintento o una recarga no
 * duplica el aviso, y una falla del aviso nunca revierte ni bloquea la operación.
 */
export async function emitBillingNotification(event: BillingEvent): Promise<{ id: string; ok: boolean }> {
  const draft = buildBillingNotification(event);
  try {
    await getDb()
      .insert(osNotifications)
      .values({ id: draft.id, kind: draft.kind, title: draft.title, message: draft.message, sectors: draft.sectors, href: draft.href, readBy: [], dismissedBy: [], deletedBy: [] })
      .onConflictDoNothing();
    return { id: draft.id, ok: true };
  } catch (error) {
    console.error("[facturación] no se pudo registrar el aviso (la operación ya quedó confirmada)", { type: event.type, error });
    return { id: draft.id, ok: false };
  }
}

/** Aviso «ENTREGA REGISTRADA — YA SE PUEDE FACTURAR» para una entrega real recién registrada (un replay no avisa de nuevo). */
export async function emitBillingForDelivery(result: RecordDeliveryResult, actorName: string): Promise<void> {
  if (result.replayed || !result.line) return;
  const lineGroups = Array.isArray(result.line.packingGroups) ? result.line.packingGroups : null;
  const groups = lineGroups ? (lineGroups as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>) : Array.isArray(result.delivery.packingGroups) ? (result.delivery.packingGroups as Array<{ cajas?: unknown; unidadesPorCaja?: unknown }>) : [];
  const packingGroups: PackingGroupLite[] = groups.map((g) => ({ cajas: Number(g.cajas) || 0, unidadesPorCaja: Number(g.unidadesPorCaja) || 0 }));
  await emitBillingNotification({
    type: "ENTREGA_REGISTRADA",
    eventKey: result.line.id,
    workItemId: result.item.id,
    client: result.item.client ?? null,
    product: result.item.product ?? null,
    pedido: result.delivery.pedidoOp ?? result.item.orderNumber ?? null,
    orderRef: result.item.orderNumber ?? null,
    quantity: result.line.quantity,
    unit: result.line.unit ?? null,
    at: new Date(),
    actorName,
    remito: result.line.remito ?? result.delivery.remito ?? null,
    packingGroups,
    complete: result.complete,
    deliveredAt: result.line.actualDeliveredAt,
  });
}
