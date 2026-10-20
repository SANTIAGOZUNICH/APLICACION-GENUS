import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { OrdersValidationError } from "@/lib/orders/types";
import { packingGroupsToRemitoSlots } from "./packing-math";
import { describeDeliveryPacking } from "./delivery-packing";
import { groupDeliveries, type EligibleDelivery, type RemitoPreviewGroup } from "./delivery-grouping";
export { groupDeliveries };
export type { EligibleDelivery, RemitoPreviewGroup };
import { marksTableReady } from "./delivery-marks";
import { getRemitoService } from "./remito-service";
import type { RemitoActor } from "./remito-service";
import type { RemitoApprovalInput, RemitoRecord } from "./types";

/** Clave con la que una entrega real queda vinculada a un remito (impide incluirla dos veces). */
export const deliveryLinkKey = (deliveryLineId: string) => `dl:${deliveryLineId}`;

type Row = Record<string, unknown>;

/**
 * Entregas REALES (líneas activas de entrega) que todavía no están en un remito vigente. Un remito anulado libera sus
 * entregas; un borrador las reserva. Una entrega parcial y su saldo son líneas distintas: nunca se vuelve a incluir lo ya remitido.
 */
export async function listEligibleDeliveries(opts: { lineIds?: string[] } = {}): Promise<EligibleDelivery[]> {
  const only = opts.lineIds?.length ? sql`and l.id in (${sql.join(opts.lineIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const marks = (await marksTableReady())
    ? sql`and not exists (select 1 from delivery_remito_marks m where m.delivery_line_id = l.id and m.active = true)`
    : sql``;
  const res = await getDb().execute(sql`
    select l.id::text as id, l.work_item_id::text as work_item_id, l.quantity, l.unit, l.kind, l.actual_delivered_at, l.remito, l.delivered_by,
           l.packing_groups, w.client, w.product, w.packaging_lote, w.packaging_vto, w.order_number, d.pedido_op,
           (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date::text as delivery_date
      from work_item_delivery_lines l
      join work_items w on w.id = l.work_item_id
      left join work_item_deliveries d on d.id = l.delivery_id
     where l.status = 'ACTIVA' and w.deleted_at is null ${only} ${marks}
       and not exists (
         select 1 from remito_work_links k join remitos r on r.id = k.remito_id
          where k.work_item_id = 'dl:' || l.id::text and r.status <> 'ANULADO')
     order by l.actual_delivered_at desc`);
  return (res.rows as Row[]).map((r) => {
    const groups = Array.isArray(r.packing_groups) ? (r.packing_groups as Array<{ cajas?: number; unidadesPorCaja?: number }>).map((g) => ({ cajas: Number(g.cajas) || 0, unidadesPorCaja: Number(g.unidadesPorCaja) || 0 })) : [];
    return {
      deliveryLineId: String(r.id),
      workItemId: String(r.work_item_id),
      client: String(r.client ?? ""),
      pedido: r.pedido_op == null ? null : String(r.pedido_op),
      orderRef: r.order_number == null ? null : String(r.order_number),
      product: String(r.product ?? ""),
      lote: String(r.packaging_lote ?? ""),
      vto: String(r.packaging_vto ?? ""),
      quantity: Number(r.quantity),
      unit: r.unit == null ? null : String(r.unit),
      kind: r.kind === "FINAL" ? "FINAL" : "PARCIAL",
      deliveredAt: new Date(String(r.actual_delivered_at)).toISOString(),
      deliveryDate: String(r.delivery_date),
      packingGroups: groups,
      boxesText: describeDeliveryPacking(groups),
      deliveredBy: String(r.delivered_by ?? ""),
      deliveryRemito: r.remito == null ? null : String(r.remito),
    };
  });
}

export async function previewRemitosFromDeliveries(lineIds: string[]): Promise<{ groups: RemitoPreviewGroup[]; missing: string[] }> {
  const ids = [...new Set(lineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (ids.length === 0) throw new OrdersValidationError("Elegí al menos una entrega.");
  const found = await listEligibleDeliveries({ lineIds: ids });
  const have = new Set(found.map((f) => f.deliveryLineId));
  return { groups: groupDeliveries(found), missing: ids.filter((i) => !have.has(i)) };
}

/**
 * Crea (o completa) los BORRADORES de remito de las entregas elegidas: uno por cliente + fecha, con un renglón por entrega
 * real. No toca stock ni entregas. Una entrega ya incluida en un remito vigente se rechaza (no se duplica por doble clic).
 */
export async function createRemitoDraftsFromDeliveries(actor: RemitoActor, lineIds: string[]): Promise<{ remitos: RemitoRecord[]; skipped: string[] }> {
  const { groups, missing } = await previewRemitosFromDeliveries(lineIds);
  if (groups.length === 0) throw new OrdersValidationError("Esas entregas ya están en un remito o no existen.");
  // Un remito ANULADO libera sus entregas: se suelta el vínculo viejo (la trazabilidad queda en el remito anulado).
  const keys = groups.flatMap((g) => g.lines.map((l) => deliveryLinkKey(l.deliveryLineId)));
  await getDb().execute(sql`delete from remito_work_links k using remitos r where r.id = k.remito_id and r.status = 'ANULADO' and k.work_item_id in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
  const service = getRemitoService();
  const out = new Map<string, RemitoRecord>();
  const skipped = [...missing];
  for (const g of groups) {
    for (const l of g.lines) {
      const slots = packingGroupsToRemitoSlots(l.packingGroups);
      const input: RemitoApprovalInput = {
        workItemId: deliveryLinkKey(l.deliveryLineId),
        clientId: l.client,
        clientDisplay: l.client,
        deliveryDate: g.deliveryDate,
        product: l.product,
        lote: l.lote,
        vto: l.vto,
        totalUnits: l.quantity,
        cajas1: slots.cajas1, unidades1: slots.unidades1,
        cajas2: slots.cajas2, unidades2: slots.unidades2,
        cajas3: slots.cajas3, unidades3: slots.unidades3,
        extraCajas: slots.extraCajas,
        trace: { deliveryLineId: l.deliveryLineId, workItemId: l.workItemId, pedido: l.pedido, orderRef: l.orderRef, deliveryRemito: l.deliveryRemito },
      };
      const r = await service.upsertDraftFromApproval(actor, input);
      if (r.duplicateWorkItem || r.immutableOfferNewVersion) {
        skipped.push(l.deliveryLineId);
        continue;
      }
      out.set(r.remito.id, r.remito);
    }
  }
  return { remitos: [...out.values()], skipped };
}
