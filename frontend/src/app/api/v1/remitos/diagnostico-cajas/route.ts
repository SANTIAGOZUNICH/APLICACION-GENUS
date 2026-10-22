import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { loadResolvedPackingByLine } from "@/lib/remitos/delivery-packing-resolve";
import { canReadRemitos } from "@/lib/remitos/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/**
 * Diagnóstico de SOLO LECTURA (autenticado, sector Producción): cuántas entregas activas tienen cajas propias, cuántas
 * se recuperan del trabajo, cuáles no se pueden asignar sin ambigüedad y cuáles no tienen datos. No modifica nada.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadRemitos(actor.sector)) throw new OrdersForbiddenError("Solo PRODUCCIÓN puede acceder a Remitos.");
    const res = await getDb().execute(sql`
      select l.id::text as id, l.work_item_id::text as work_item_id, l.quantity::float8 as quantity, l.kind, l.actual_delivered_at::text as at,
             w.client, w.product, w.packaging_lote as lote
        from work_item_delivery_lines l join work_items w on w.id = l.work_item_id
       where l.status = 'ACTIVA' and w.deleted_at is null order by l.actual_delivered_at desc limit 2000`);
    const rows = res.rows as Row[];
    const resolved = await loadResolvedPackingByLine(rows.map((r) => String(r.work_item_id)));
    const counts = { total: rows.length, propias: 0, recuperadasDelTrabajo: 0, conAdvertencia: 0, sinDatos: 0 };
    const detalle: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const rp = resolved.get(String(r.id));
      if (!rp || rp.source === "ENTREGA") counts.propias += rp ? 1 : 0;
      else if (rp.groups.length > 0) counts.recuperadasDelTrabajo += 1;
      else if (rp.warning) counts.conAdvertencia += 1;
      else counts.sinDatos += 1;
      if (rp && rp.source !== "ENTREGA" && detalle.length < 100) {
        detalle.push({ entrega: r.id, cliente: r.client, producto: r.product, lote: r.lote, unidades: r.quantity, tipo: r.kind, fuente: rp.source, cajas: rp.groups, sugeridas: rp.suggested ?? [], advertencia: rp.warning ?? null });
      }
    }
    return NextResponse.json({ readOnly: true, counts, detalle });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
