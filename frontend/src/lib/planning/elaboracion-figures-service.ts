import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { operationalEvents, workItemDeliveryLines } from "@/lib/db/schema";
import { computeElaboracionFigures, type ElaboracionFigures } from "@/lib/planning/elaboracion-figures";

type Row = { id: string; plannedQuantity: string | null; finishedQty: string | null; operationalStatus: string | null; status: string | null; unit: string | null };

/**
 * Cifras reales de Elaboración de varios trabajos (lectura): renglones de entrega ACTIVOS + envío a Envasado (evento). Una sola consulta
 * por tabla; no escribe nada.
 */
export async function loadElaboracionFigures(rows: Row[]): Promise<Map<string, ElaboracionFigures>> {
  const out = new Map<string, ElaboracionFigures>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const db = getDb();
  const lines = (await db
    .select({ id: workItemDeliveryLines.workItemId, kg: sql<number>`coalesce(sum(${workItemDeliveryLines.quantity}), 0)::float8`, last: sql<string | null>`max(${workItemDeliveryLines.createdAt})::text` })
    .from(workItemDeliveryLines)
    .where(and(inArray(workItemDeliveryLines.workItemId, ids), eq(workItemDeliveryLines.status, "ACTIVA")))
    .groupBy(workItemDeliveryLines.workItemId)) as Array<{ id: string; kg: number; last: string | null }>;
  const sends = (await db
    .select({ id: operationalEvents.workItemId, note: operationalEvents.note, at: operationalEvents.createdAt })
    .from(operationalEvents)
    .where(and(inArray(operationalEvents.workItemId, ids), eq(operationalEvents.type, "SENT_TO_ENVASADO")))) as Array<{ id: string; note: string | null; at: Date }>;
  const lineBy = new Map(lines.map((l) => [l.id, l]));
  const sendBy = new Map<string, { kg: number | null; at: Date }>();
  for (const s of sends) {
    const m = /kg=([0-9.,]+)/.exec(s.note ?? "");
    const kg = m ? Number(m[1]!.replace(",", ".")) : null;
    const prev = sendBy.get(s.id);
    if (!prev || s.at > prev.at) sendBy.set(s.id, { kg: kg != null && Number.isFinite(kg) ? kg : null, at: s.at });
  }
  for (const r of rows) {
    const l = lineBy.get(r.id);
    const s = sendBy.get(r.id);
    const lastDeliveryAt = [l?.last ? new Date(l.last) : null, s?.at ?? null].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null;
    out.set(
      r.id,
      computeElaboracionFigures({
        plannedQuantity: r.plannedQuantity,
        finishedQty: r.finishedQty,
        operationalStatus: r.operationalStatus,
        status: r.status,
        unit: r.unit,
        deliveredLinesKg: l?.kg ?? 0,
        sentToEnvasadoKg: s?.kg ?? null,
        sentToEnvasado: Boolean(s),
        lastDeliveryAt,
      })
    );
  }
  return out;
}
