import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { buildNeedsAttention, type AttentionResult } from "./needs-attention";
import { getWeeklyAvailability, weekBounds } from "./weekly-availability-service";

export type SavedWeeklyControl = {
  weekStart: string;
  version: number;
  savedBy: string;
  savedAt: string;
  createdBy: string;
  /** Lo que había al guardar (no se reescribe cuando cambia el stock). */
  result: AttentionResult & { generatedAt: string };
};

type Row = Record<string, unknown>;

export async function getSavedWeeklyControl(anyDay: string): Promise<{ saved: SavedWeeklyControl | null; schemaPending: boolean }> {
  const week = weekBounds(anyDay).start;
  try {
    const res = await getDb().execute(sql`
      select week_start::text as week_start, snapshot, version, saved_by, saved_at, created_by
        from mp_weekly_saved_controls where week_start = ${week}::date`);
    const r = (res.rows as Row[])[0];
    if (!r) return { saved: null, schemaPending: false };
    return {
      saved: {
        weekStart: String(r.week_start),
        version: Number(r.version),
        savedBy: String(r.saved_by),
        savedAt: new Date(String(r.saved_at)).toISOString(),
        createdBy: String(r.created_by),
        result: r.snapshot as SavedWeeklyControl["result"],
      },
      schemaPending: false,
    };
  } catch (e) {
    if (isMissingSchemaError(e)) return { saved: null, schemaPending: true };
    throw e;
  }
}

/**
 * Guarda el control de la semana: recalcula en el servidor (con el stock compartido y las exclusiones vigentes) las MP que
 * necesitan atención y las guarda como foto. Una fila por semana: volver a guardar la REEMPLAZA (nunca duplica) y sube la
 * versión. No toca inventario, fórmulas, OE ni las observaciones/decisiones de cada MP.
 */
export async function saveWeeklyControl(actor: { email: string }, anyDay: string): Promise<SavedWeeklyControl> {
  const week = weekBounds(anyDay).start;
  const data = await getWeeklyAvailability(week);
  const result = { ...buildNeedsAttention(data.rows, data.products), generatedAt: data.generatedAt };
  await getDb().execute(sql`
    insert into mp_weekly_saved_controls (week_start, snapshot, version, saved_by, saved_at, created_by)
    values (${week}::date, ${JSON.stringify(result)}::jsonb, 1, ${actor.email}, now(), ${actor.email})
    on conflict (week_start) do update
      set snapshot = excluded.snapshot, version = mp_weekly_saved_controls.version + 1, saved_by = excluded.saved_by, saved_at = now()`);
  const out = await getSavedWeeklyControl(week);
  if (!out.saved) throw new Error("No se pudo confirmar el guardado del control semanal.");
  return out.saved;
}

/** Guardado best-effort tras crear/actualizar un control: nunca rompe la respuesta del control. */
export async function trySaveWeeklyControl(
  actor: { email: string },
  anyDay?: string | null
): Promise<{ weeklySaved: boolean; weeklyError?: string }> {
  try {
    const day = anyDay && /^\d{4}-\d{2}-\d{2}$/.test(anyDay) ? anyDay : new Date().toISOString().slice(0, 10);
    await saveWeeklyControl(actor, day);
    return { weeklySaved: true };
  } catch (err) {
    return { weeklySaved: false, weeklyError: err instanceof Error ? err.message : "No se pudo guardar el control semanal." };
  }
}
