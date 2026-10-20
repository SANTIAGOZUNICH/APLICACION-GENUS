import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { normText } from "./availability";
import { buildControlNeeds, type ControlNeeds } from "./control-needs";
import { getMpControlService } from "./mp-control-service";
import { getWeeklyAvailability, weekBounds } from "./weekly-availability-service";

/** Un control guardado: lo que faltaba para ESA fórmula y ESA producción al guardar (no se reescribe solo). */
export type SavedProductControl = {
  controlId: string;
  weekStart: string;
  version: number;
  savedBy: string;
  savedAt: string;
  createdAt: string;
  needs: ControlNeeds;
};

type Row = Record<string, unknown>;
const today = () => new Date().toISOString().slice(0, 10);
const toSaved = (r: Row): SavedProductControl => ({
  controlId: String(r.control_id),
  weekStart: String(r.week_start),
  version: Number(r.version),
  savedBy: String(r.saved_by),
  savedAt: new Date(String(r.saved_at)).toISOString(),
  createdAt: new Date(String(r.created_at)).toISOString(),
  needs: r.snapshot as ControlNeeds,
});

/** Controles guardados de UNA semana (nunca mezcla semanas ni incluye anulados/archivados). */
export async function listSavedControls(anyDay: string): Promise<{ controls: SavedProductControl[]; schemaPending: boolean }> {
  const week = weekBounds(anyDay).start;
  try {
    const res = await getDb().execute(sql`
      select s.control_id::text as control_id, s.week_start::text as week_start, s.snapshot, s.version, s.saved_by, s.saved_at, s.created_at
        from mp_weekly_saved_product_controls s
        join mp_weekly_controls c on c.id = s.control_id
       where s.week_start = ${week}::date and c.status not in ('ANULADO', 'ARCHIVADO')
       order by s.created_at asc`);
    return { controls: (res.rows as Row[]).map(toSaved), schemaPending: false };
  } catch (e) {
    if (isMissingSchemaError(e)) return { controls: [], schemaPending: true };
    throw e;
  }
}

/**
 * Guarda (o actualiza) el resultado de UN control: sus MP faltantes con el stock compartido ya repartido. Una fila por
 * control: volver a guardar la REEMPLAZA (no duplica) y sube la versión. Si el control está anulado/archivado se quita.
 */
export async function saveControlNeeds(actor: { email: string; sector: never | string }, controlId: string, anyDay?: string | null): Promise<SavedProductControl | null> {
  const db = getDb();
  const control = await getMpControlService().get(actor as never, controlId);
  if (!control) return null;
  if (control.status === "ANULADO" || control.status === "ARCHIVADO") {
    await db.execute(sql`delete from mp_weekly_saved_product_controls where control_id = ${controlId}::uuid`);
    return null;
  }
  const prev = (await db.execute(sql`select week_start::text as week_start, created_at from mp_weekly_saved_product_controls where control_id = ${controlId}::uuid`)).rows as Row[];
  const week = weekBounds(anyDay ?? (prev[0]?.week_start as string | undefined) ?? today()).start;
  const data = await getWeeklyAvailability(week);
  // Controles guardados antes (sin producción en la semana): lo que ya tienen comprometido del mismo stock.
  const before = prev[0]?.created_at ? new Date(String(prev[0].created_at)).toISOString() : new Date().toISOString();
  const others = (await db.execute(sql`
    select snapshot from mp_weekly_saved_product_controls
     where week_start = ${week}::date and control_id <> ${controlId}::uuid and created_at < ${before}::timestamptz`)).rows as Row[];
  const earlier = new Map<string, number>();
  for (const o of others) {
    const n = o.snapshot as ControlNeeds;
    if (n.allocation !== "CONTROL") continue;
    for (const i of n.items) earlier.set(normText(i.materiaPrima), (earlier.get(normText(i.materiaPrima)) ?? 0) + i.necesarioKg);
  }
  const needs = buildControlNeeds({
    control: { id: control.id, client: control.client, product: control.product, quantityKg: control.quantityKg, linkedOe: control.linkedOeId, lines: control.lines },
    sections: data.products,
    earlierNeedByMp: earlier,
    generatedAt: data.generatedAt,
  });
  await db.execute(sql`
    insert into mp_weekly_saved_product_controls (control_id, week_start, client, product, quantity_kg, linked_oe, snapshot, version, saved_by, saved_at, created_by)
    values (${controlId}::uuid, ${week}::date, ${control.client}, ${control.product}, ${control.quantityKg}, ${control.linkedOeId}, ${JSON.stringify(needs)}::jsonb, 1, ${actor.email}, now(), ${actor.email})
    on conflict (control_id) do update
      set week_start = excluded.week_start, client = excluded.client, product = excluded.product, quantity_kg = excluded.quantity_kg,
          linked_oe = excluded.linked_oe, snapshot = excluded.snapshot, version = mp_weekly_saved_product_controls.version + 1,
          saved_by = excluded.saved_by, saved_at = now()`);
  const out = (await listSavedControls(week)).controls.find((c) => c.controlId === controlId);
  if (!out) throw new Error("No se pudo confirmar el guardado del control.");
  return out;
}

/** Guardado best-effort tras crear/actualizar un control: nunca rompe la respuesta del control. */
export async function trySaveControlNeeds(
  actor: { email: string; sector: string },
  controlId: string,
  anyDay?: string | null
): Promise<{ weeklySaved: boolean; weeklyError?: string }> {
  try {
    const day = anyDay && /^\d{4}-\d{2}-\d{2}$/.test(anyDay) ? anyDay : null;
    await saveControlNeeds(actor, controlId, day);
    return { weeklySaved: true };
  } catch (err) {
    return { weeklySaved: false, weeklyError: err instanceof Error ? err.message : "No se pudo guardar el control semanal." };
  }
}
