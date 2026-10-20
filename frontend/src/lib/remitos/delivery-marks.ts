import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { OrdersValidationError } from "@/lib/orders/types";

export type DeliveryMark = "EXCLUIDA" | "REMITO_EXTERNO";

export type MarkedDelivery = {
  deliveryLineId: string;
  mark: DeliveryMark;
  externalRemitoNumber: string | null;
  externalRemitoDate: string | null;
  notes: string | null;
  markedBy: string;
  markedAt: string;
  client: string;
  pedido: string | null;
  product: string;
  lote: string;
  quantity: number;
  unit: string | null;
  deliveryDate: string;
  boxesText: string | null;
};

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f-]{36}$/i;

let ready: boolean | null = null;
/** La tabla es de la migración 0064: si todavía no se aplicó, las marcas se ignoran (nada se rompe). */
export async function marksTableReady(): Promise<boolean> {
  if (ready === true) return true;
  try {
    const res = await getDb().execute(sql`select to_regclass('public.delivery_remito_marks') is not null as ok`);
    ready = Boolean((res.rows as Row[])[0]?.ok);
  } catch {
    ready = false;
  }
  return ready;
}

function cleanIds(ids: string[]): string[] {
  const out = [...new Set(ids.filter((x) => UUID.test(x)))];
  if (out.length === 0) throw new OrdersValidationError("Elegí al menos una entrega.");
  return out;
}

async function assertReady() {
  if (!(await marksTableReady())) throw new OrdersValidationError("Falta aplicar la migración 0064 (marcas de remito) en la base.");
}

/**
 * Aplica una marca a entregas reales activas. Idempotente (una segunda vez no duplica ni cambia al autor original de
 * una marca igual) y transaccional. No toca la entrega, el remito, la factura ni el stock.
 */
export async function markDeliveries(
  actor: { email: string },
  input: { lineIds: string[]; mark: DeliveryMark; externalRemitoNumber?: string; externalRemitoDate?: string; notes?: string }
): Promise<{ marked: string[]; skipped: string[] }> {
  await assertReady();
  const ids = cleanIds(input.lineIds);
  const number = (input.externalRemitoNumber ?? "").trim().slice(0, 60) || null;
  const date = input.externalRemitoDate && /^\d{4}-\d{2}-\d{2}$/.test(input.externalRemitoDate) ? input.externalRemitoDate : null;
  const notes = (input.notes ?? "").trim().slice(0, 500) || null;
  const marked: string[] = [];
  const skipped: string[] = [];
  await getDb().transaction(async (tx) => {
    for (const id of ids) {
      const line = await tx.execute(sql`
        select l.id from work_item_delivery_lines l
         where l.id = ${id}::uuid and l.status = 'ACTIVA'
           and not exists (select 1 from remito_work_links k join remitos r on r.id = k.remito_id
                            where k.work_item_id = 'dl:' || l.id::text and r.status <> 'ANULADO')`);
      if ((line.rows as Row[]).length === 0) {
        skipped.push(id); // inexistente, anulada o ya dentro de un remito vigente de GENUS OS
        continue;
      }
      const cur = await tx.execute(sql`select mark, active, external_remito_number, external_remito_date::text as d, notes from delivery_remito_marks where delivery_line_id = ${id}::uuid for update`);
      const prev = (cur.rows as Row[])[0];
      const same =
        prev && prev.active === true && prev.mark === input.mark &&
        (prev.external_remito_number ?? null) === number && (prev.d ?? null) === date && (prev.notes ?? null) === notes;
      if (same) {
        skipped.push(id);
        continue;
      }
      await tx.execute(sql`
        insert into delivery_remito_marks (delivery_line_id, mark, external_remito_number, external_remito_date, notes, active, created_by, updated_by)
        values (${id}::uuid, ${input.mark}, ${number}, ${date}::date, ${notes}, true, ${actor.email}, ${actor.email})
        on conflict (delivery_line_id) do update
          set mark = excluded.mark, external_remito_number = excluded.external_remito_number, external_remito_date = excluded.external_remito_date,
              notes = excluded.notes, active = true, updated_by = excluded.updated_by, updated_at = now()`);
      await tx.execute(sql`
        insert into delivery_remito_mark_events (delivery_line_id, action, actor, detail)
        values (${id}::uuid, ${input.mark === "EXCLUIDA" ? "QUITADA_DE_PENDIENTES" : "MARCADA_REMITO_EXTERNO"}, ${actor.email},
                ${JSON.stringify({ number, date, notes })}::jsonb)`);
      marked.push(id);
    }
  });
  return { marked, skipped };
}

/** Revierte la marca (vuelve a ofrecerse en «Generar remitos»). El historial de eventos se conserva. */
export async function restoreDeliveries(actor: { email: string }, lineIds: string[]): Promise<{ restored: string[] }> {
  await assertReady();
  const ids = cleanIds(lineIds);
  const restored: string[] = [];
  await getDb().transaction(async (tx) => {
    for (const id of ids) {
      const upd = await tx.execute(sql`
        update delivery_remito_marks set active = false, updated_by = ${actor.email}, updated_at = now()
         where delivery_line_id = ${id}::uuid and active = true returning mark, external_remito_number`);
      const row = (upd.rows as Row[])[0];
      if (!row) continue;
      await tx.execute(sql`
        insert into delivery_remito_mark_events (delivery_line_id, action, actor, detail)
        values (${id}::uuid, 'RESTAURADA', ${actor.email}, ${JSON.stringify({ was: row.mark, number: row.external_remito_number ?? null })}::jsonb)`);
      restored.push(id);
    }
  });
  return { restored };
}

export async function listMarkedDeliveries(): Promise<MarkedDelivery[]> {
  if (!(await marksTableReady())) return [];
  const res = await getDb().execute(sql`
    select m.delivery_line_id::text as id, m.mark, m.external_remito_number, m.external_remito_date::text as ext_date, m.notes, m.updated_by, m.updated_at,
           w.client, w.product, w.packaging_lote, l.quantity::float8 as quantity, l.unit, l.packing_groups, d.pedido_op,
           (l.actual_delivered_at at time zone 'America/Argentina/Buenos_Aires')::date::text as delivery_date
      from delivery_remito_marks m
      join work_item_delivery_lines l on l.id = m.delivery_line_id
      join work_items w on w.id = l.work_item_id
      left join work_item_deliveries d on d.id = l.delivery_id
     where m.active = true and l.status = 'ACTIVA'
     order by m.updated_at desc limit 500`);
  const { describeDeliveryPacking } = await import("./delivery-packing");
  return (res.rows as Row[]).map((r) => {
    const groups = Array.isArray(r.packing_groups) ? (r.packing_groups as Array<{ cajas?: number; unidadesPorCaja?: number }>).map((g) => ({ cajas: Number(g.cajas) || 0, unidadesPorCaja: Number(g.unidadesPorCaja) || 0 })) : [];
    return {
      deliveryLineId: String(r.id),
      mark: r.mark === "REMITO_EXTERNO" ? "REMITO_EXTERNO" : "EXCLUIDA",
      externalRemitoNumber: r.external_remito_number == null ? null : String(r.external_remito_number),
      externalRemitoDate: r.ext_date == null ? null : String(r.ext_date),
      notes: r.notes == null ? null : String(r.notes),
      markedBy: String(r.updated_by),
      markedAt: new Date(String(r.updated_at)).toISOString(),
      client: String(r.client ?? ""),
      pedido: r.pedido_op == null ? null : String(r.pedido_op),
      product: String(r.product ?? ""),
      lote: String(r.packaging_lote ?? ""),
      quantity: Number(r.quantity),
      unit: r.unit == null ? null : String(r.unit),
      deliveryDate: String(r.delivery_date),
      boxesText: describeDeliveryPacking(groups),
    };
  });
}
