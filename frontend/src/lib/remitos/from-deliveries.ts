import "server-only";

import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, remitoLineLockKey, withAdvisoryLocks } from "@/lib/db/client";
import { OrdersValidationError } from "@/lib/orders/types";
import { packingGroupsToRemitoSlots } from "./packing-math";
import { describeDeliveryPacking } from "./delivery-packing";
import { groupDeliveries, type EligibleDelivery, type RemitoPreviewGroup } from "./delivery-grouping";
export { groupDeliveries };
export type { EligibleDelivery, RemitoPreviewGroup };
import { loadResolvedPackingByLine } from "./delivery-packing-resolve";
import { listAvailableDeliveries, deliveryKey as remitoDeliveryKey } from "./delivery-remittance";
import { getRemitoService } from "./remito-service";
import type { RemitoActor } from "./remito-service";
import { lineTotalCajas } from "./line-qty";
import type { RemitoApprovalInput, RemitoRecord } from "./types";

/** Clave con la que una entrega real queda vinculada a un remito (impide incluirla dos veces). */
export const deliveryLinkKey = (deliveryLineId: string) => remitoDeliveryKey(deliveryLineId);

type Row = Record<string, unknown>;

/**
 * Entregas REALES (líneas activas de entrega a Producción) con unidades todavía DISPONIBLES para remitir: recibidas − ya incluidas en remitos
 * vigentes (un remito anulado libera sus unidades; un borrador las reserva). Una entrega puede remitirse por partes: mientras quede saldo
 * se sigue ofreciendo, con lo que falta. Una entrega ya remitida por completo, marcada o cancelada no se ofrece. Ver delivery-remittance.
 */
export async function listEligibleDeliveries(opts: { lineIds?: string[] } = {}): Promise<EligibleDelivery[]> {
  const list = await listAvailableDeliveries(opts);
  return list.map((d) => {
    const partial = d.remitted > 1e-6; // ya salió una parte: las cajas del saldo no se pueden asumir
    const groups = partial ? [] : d.packingGroups;
    return {
      deliveryLineId: d.deliveryLineId,
      workItemId: d.workItemId,
      client: d.client,
      pedido: d.pedido,
      orderRef: d.orderRef,
      product: d.product,
      lote: d.lote,
      vto: d.vto,
      quantity: d.available,
      deliveredQuantity: d.delivered,
      remittedQuantity: d.remitted,
      sequence: d.sequence,
      sourceSector: d.sourceSector,
      observations: d.observations,
      unit: d.unit,
      kind: d.kind,
      deliveredAt: d.deliveredAt,
      deliveryDate: d.deliveryDate,
      packingGroups: groups,
      boxesText: describeDeliveryPacking(groups),
      packingSource: partial ? "NINGUNA" : d.packingSource,
      packingWarning: partial ? `Ya se remitieron ${d.remitted} de ${d.delivered} u.: las cajas del saldo (${d.available} u.) se completan al preparar el remito.` : d.packingWarning,
      packingSuggested: partial ? [] : d.packingSuggested,
      deliveredBy: d.deliveredBy,
      deliveryRemito: null,
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
  const ids = [...new Set(lineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (ids.length === 0) throw new OrdersValidationError("Elegí al menos una entrega.");
  // Candado por entrega durante TODA la operación (verificar saldo → escribir): dos usuarios que piden las mismas unidades a la vez no
  // pueden duplicarlas; el segundo ve el saldo ya descontado y su entrega queda en «skipped».
  return withAdvisoryLocks(ids.map(remitoLineLockKey), async () => {
    const { groups, missing } = await previewRemitosFromDeliveries(ids);
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
        // La entrega completa y todavía sin remitir conserva la clave histórica; el saldo de una entrega ya remitida en parte lleva clave propia.
        const whole = !(l.remittedQuantity && l.remittedQuantity > 1e-6);
        const input: RemitoApprovalInput = {
          workItemId: whole ? deliveryLinkKey(l.deliveryLineId) : remitoDeliveryKey(l.deliveryLineId, randomUUID().replace(/-/g, "").slice(0, 12)),
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
          trace: { deliveryLineId: l.deliveryLineId, workItemId: l.workItemId, pedido: l.pedido, orderRef: l.orderRef, deliveryRemito: l.deliveryRemito, observations: l.observations ?? null, deliverySequence: l.sequence, deliveredQuantity: l.deliveredQuantity },
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
  });
}

/**
 * Al abrir un BORRADOR: completa las cajas de los renglones que quedaron vacías con las cajas efectivas de su entrega
 * (entrega o trabajo). No toca renglones con cajas ni correcciones manuales (ver autofillDraftBoxes). Best-effort.
 */
export async function autofillDraftBoxesFromDeliveries(actor: RemitoActor, remito: RemitoRecord): Promise<RemitoRecord> {
  if (remito.status !== "BORRADOR") return remito;
  const targets = remito.lines.filter((l) => l.trace?.deliveryLineId && l.trace.workItemId && lineTotalCajas(l) === 0);
  if (targets.length === 0) return remito;
  try {
    const resolved = await loadResolvedPackingByLine(targets.map((l) => String(l.trace?.workItemId)));
    const fills = targets.flatMap((l) => {
      const r = resolved.get(String(l.trace?.deliveryLineId));
      if (!r || r.groups.length === 0) return [];
      // Solo si las cajas de la entrega coinciden EXACTAMENTE con lo que lleva el renglón: en un remito parcial (parte de la entrega) no se
      // asumen cajas ni se pisa el total del renglón.
      if (r.groups.reduce((s, g) => s + g.cajas * g.unidadesPorCaja, 0) !== Number(l.totalUnits)) return [];
      const slots = packingGroupsToRemitoSlots(r.groups);
      return [{ lineId: l.id, slots }];
    });
    if (fills.length === 0) return remito;
    return (await getRemitoService().autofillDraftBoxes(actor, remito.id, fills)) ?? remito;
  } catch (error) {
    console.error("[remitos] no se pudieron completar las cajas del borrador", error);
    return remito;
  }
}
