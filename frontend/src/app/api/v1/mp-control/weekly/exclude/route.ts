import { NextResponse } from "next/server";
import { MpStateSchemaPendingError, excludeRowsByKeys, restoreRows } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quita (o restaura) MP del Control semanal de una semana. Persistente; NO toca inventario, fórmulas, OE ni consumos. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar materias primas del control." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { week?: string; rowKeys?: string[]; restore?: boolean };
    if (!b.week || !/^\d{4}-\d{2}-\d{2}$/.test(b.week) || !Array.isArray(b.rowKeys) || b.rowKeys.length === 0) return NextResponse.json({ error: "week y rowKeys son obligatorios." }, { status: 400 });
    const keys = b.rowKeys.map(String).slice(0, 500);
    if (b.restore) {
      await restoreRows({ week: b.week, rowKeys: keys });
      return NextResponse.json({ ok: true, restored: keys.length });
    }
    const n = await excludeRowsByKeys(b.week, keys, actor.email);
    return NextResponse.json({ ok: true, excluded: n });
  } catch (err) {
    if (err instanceof MpStateSchemaPendingError) return NextResponse.json({ error: err.message, schemaPending: true }, { status: 503 });
    return ordersErrorResponse(err);
  }
}
