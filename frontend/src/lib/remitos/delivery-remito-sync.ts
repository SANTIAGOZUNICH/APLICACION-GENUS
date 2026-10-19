import "server-only";

import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import type { RemitoRecord } from "./types";

/**
 * Deja el número del remito asociado a cada ENTREGA REAL incluida (work_item_delivery_lines.remito y, si no tenía, el
 * agregado work_item_deliveries.remito). Si la entrega ya traía un texto de remito cargado a mano, se conserva en
 * observaciones. Solo escribe el campo de texto: no toca cantidades, stock ni estados. Best-effort (nunca bloquea al remito).
 */
export async function linkRemitoNumberToDeliveries(remito: Pick<RemitoRecord, "remitoNumber" | "lines">): Promise<void> {
  const number = remito.remitoNumber;
  const ids = remito.lines.map((l) => l.trace?.deliveryLineId).filter((x): x is string => Boolean(x));
  if (!number || ids.length === 0 || !isDatabaseConfigured()) return;
  try {
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    const db = getDb();
    await db.execute(sql`
      update work_item_deliveries d set remito = ${number}, updated_at = now()
        from work_item_delivery_lines l
       where l.delivery_id = d.id and l.id in (${list}) and (d.remito is null or d.remito = '' or d.remito = l.remito)`);
    await db.execute(sql`
      update work_item_delivery_lines set
        observations = case when remito is not null and remito <> '' and remito <> ${number}
                            then concat_ws(' · ', nullif(observations, ''), 'Remito cargado al entregar: ' || remito) else observations end,
        remito = ${number}
       where id in (${list})`);
  } catch (error) {
    console.error("[remitos] no se pudo asociar el número de remito a las entregas", error);
  }
}

/** Al anular el remito, las entregas dejan de figurar con ese número (quedan disponibles para un remito nuevo). */
export async function unlinkRemitoNumberFromDeliveries(remito: Pick<RemitoRecord, "remitoNumber" | "lines">): Promise<void> {
  const number = remito.remitoNumber;
  const ids = remito.lines.map((l) => l.trace?.deliveryLineId).filter((x): x is string => Boolean(x));
  if (!number || ids.length === 0 || !isDatabaseConfigured()) return;
  try {
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    const db = getDb();
    await db.execute(sql`update work_item_deliveries d set remito = null, updated_at = now() from work_item_delivery_lines l where l.delivery_id = d.id and l.id in (${list}) and d.remito = ${number}`);
    await db.execute(sql`update work_item_delivery_lines set remito = null where id in (${list}) and remito = ${number}`);
  } catch (error) {
    console.error("[remitos] no se pudo liberar el número de remito de las entregas", error);
  }
}
