import "server-only";

import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import type { RemitoRecord } from "@/lib/remitos/types";
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
    totals: { requested: result.target, delivered: result.delivered, pending: result.pending },
  });
  // Pedido entregado completo: aviso aparte (la entrega que lo completa ya avisó su propio movimiento).
  if (result.complete) {
    await emitBillingNotification({
      type: "ENTREGA_COMPLETA",
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
      deliveredAt: result.line.actualDeliveredAt,
      totals: { requested: result.target, delivered: result.delivered, pending: result.pending },
    });
  }
}

/**
 * Aviso «REMITO GENERADO» / «REMITO ANULADO». En la anulación informa cuántas unidades de esas entregas seguían
 * pendientes de facturar. Best-effort e idempotente (id por remito + número): nunca bloquea ni revierte el remito.
 */
export async function emitBillingForRemito(kind: "GENERADO" | "ANULADO", remito: RemitoRecord, actorName: string, reason?: string | null): Promise<void> {
  if (!remito.remitoNumber || !isDatabaseConfigured()) return;
  try {
    let pendingInvoiceUnits: number | null = null;
    if (kind === "ANULADO") {
      const ids = remito.lines.map((l) => l.trace?.deliveryLineId).filter((x): x is string => Boolean(x));
      if (ids.length > 0) {
        const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
        const res = await getDb().execute(sql`
          select coalesce(sum(greatest(0, l.quantity - coalesce(i.invoiced, 0))), 0)::float8 as pending
            from work_item_delivery_lines l
            left join (select il.delivery_line_id, sum(il.quantity) as invoiced
                         from billing_invoice_lines il join billing_invoices inv on inv.id = il.invoice_id
                        where il.status = 'ACTIVA' and inv.status = 'ACTIVA' group by il.delivery_line_id) i on i.delivery_line_id = l.id
           where l.id in (${list}) and l.status = 'ACTIVA'`);
        pendingInvoiceUnits = Number((res.rows[0] as { pending?: unknown } | undefined)?.pending ?? 0);
      }
      // Solo avisa si afecta entregas pendientes de facturar (o si no se pudo medir).
      if (pendingInvoiceUnits != null && pendingInvoiceUnits <= 0) return;
    }
    await emitBillingNotification({
      type: kind === "GENERADO" ? "REMITO_GENERADO" : "REMITO_ANULADO",
      remitoId: remito.id,
      remitoNumber: remito.remitoNumber,
      client: remito.clientDisplay ?? null,
      lines: remito.lines.map((l) => ({ product: l.product, quantity: l.totalUnits, unit: "u", orderRef: l.trace?.orderRef ?? null })),
      totalUnits: remito.totalUnits,
      totalCajas: remito.totalCajas ?? null,
      at: new Date(),
      actorName,
      reason: reason ?? null,
      pendingInvoiceUnits,
    });
  } catch (error) {
    console.error("[facturación] no se pudo avisar el remito (el remito ya quedó confirmado)", error);
  }
}
