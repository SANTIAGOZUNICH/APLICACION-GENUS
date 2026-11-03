import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { resolveWorkItemDeliveryPacking, type ResolvedLinePacking } from "./delivery-packing";
import { mergePackingGroups } from "./delivery-boxes-input";

type Row = Record<string, unknown>;

/**
 * Cajas efectivas de cada entrega (línea ACTIVA) de los trabajos indicados: lo guardado en la entrega, o —si falta—
 * lo registrado en el trabajo (Envasado/Codificado) o en el snapshot del registro de entrega. Solo lectura: no
 * modifica entregas, remitos ni stock. Reglas en `resolveWorkItemDeliveryPacking`.
 */
export async function loadResolvedPackingByLine(workItemIds: string[]): Promise<Map<string, ResolvedLinePacking>> {
  const ids = [...new Set(workItemIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const out = new Map<string, ResolvedLinePacking>();
  if (ids.length === 0) return out;
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const db = getDb();
  const [lines, works, snaps] = await Promise.all([
    db.execute(sql`select id::text as id, work_item_id::text as work_item_id, quantity::float8 as quantity, packing_groups
                     from work_item_delivery_lines where status = 'ACTIVA' and work_item_id in (${list}) order by sequence`),
    db.execute(sql`select id::text as id, packing_groups, parent_work_item_id::text as parent_id from work_items where id in (${list})`),
    db.execute(sql`select work_item_id::text as work_item_id, packing_groups from work_item_deliveries
                    where work_item_id in (${list}) and packing_groups is not null order by updated_at desc`),
  ]);
  const workGroups = new Map<string, unknown>((works.rows as Row[]).map((r) => [String(r.id), r.packing_groups]));
  // Trabajo de Codificado que recibe entregas parciales de Envasado: las cajas que Envasado informó en cada entrega son su «detalle del
  // trabajo» (consolidadas, sin perder los tipos de caja). Así Codificado entrega a Producción con las cajas ya cargadas, sin recargarlas
  // ni contarlas dos veces: lo que cuenta para el remito son SOLO las entregas a Producción (las internas no son entregas al cliente).
  const parents = (works.rows as Row[]).filter((r) => r.parent_id).map((r) => [String(r.id), String(r.parent_id)] as const);
  if (parents.length > 0) {
    try {
      const plist = sql.join([...new Set(parents.map(([, p]) => p))].map((i) => sql`${i}::uuid`), sql`, `);
      const t = await db.execute(sql`select work_item_id::text as work_item_id, packing_groups from work_item_codificado_transfers where status = 'ACTIVA' and work_item_id in (${plist})`);
      const byParent = new Map<string, unknown[]>();
      for (const r of t.rows as Row[]) byParent.set(String(r.work_item_id), [...(byParent.get(String(r.work_item_id)) ?? []), r.packing_groups]);
      for (const [child, parent] of parents) {
        const merged = mergePackingGroups((byParent.get(parent) ?? []).map((g) => (Array.isArray(g) ? (g as Array<{ cajas: number; unidadesPorCaja: number }>) : null)));
        if (merged.length > 0) workGroups.set(child, merged);
      }
    } catch {
      // 0080 sin aplicar: se usan las cajas del propio trabajo (comportamiento anterior).
    }
  }
  const snapshot = new Map<string, unknown>();
  for (const r of snaps.rows as Row[]) {
    const k = String(r.work_item_id);
    if (!snapshot.has(k) && Array.isArray(r.packing_groups) && (r.packing_groups as unknown[]).length > 0) snapshot.set(k, r.packing_groups);
  }
  const byWork = new Map<string, Array<{ id: string; quantity: number; groups: unknown }>>();
  for (const r of lines.rows as Row[]) {
    const k = String(r.work_item_id);
    byWork.set(k, [...(byWork.get(k) ?? []), { id: String(r.id), quantity: Number(r.quantity), groups: r.packing_groups }]);
  }
  for (const [wid, ls] of byWork) {
    const res = resolveWorkItemDeliveryPacking({
      workItemGroups: workGroups.get(wid),
      snapshotGroups: snapshot.get(wid),
      lines: ls.map((l) => ({ id: l.id, quantity: l.quantity, groups: Array.isArray(l.groups) ? (l.groups as never) : null })),
    });
    for (const [k, v] of res) out.set(k, v);
  }
  return out;
}
