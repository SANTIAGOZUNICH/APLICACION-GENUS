import { NextResponse } from "next/server";
import { MpStateSchemaPendingError, excludeProductions, restoreProductions } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quita (o restaura) PRODUCCIONES del cálculo de una semana: sus necesidades de MP dejan de sumarse. No borra trabajos ni OE. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede quitar producciones del control." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { week?: string; items?: Array<{ workItemId?: string; label?: string }>; restore?: boolean; reason?: string };
    if (!b.week || !/^\d{4}-\d{2}-\d{2}$/.test(b.week) || !Array.isArray(b.items) || b.items.length === 0) return NextResponse.json({ error: "week e items son obligatorios." }, { status: 400 });
    const items = b.items.filter((i) => i.workItemId).map((i) => ({ workItemId: String(i.workItemId), label: String(i.label ?? "") })).slice(0, 200);
    if (b.restore) {
      await restoreProductions({ week: b.week, workItemIds: items.map((i) => i.workItemId) });
      return NextResponse.json({ ok: true, restored: items.length });
    }
    const n = await excludeProductions({ week: b.week, items, by: actor.email, reason: b.reason });
    return NextResponse.json({ ok: true, excluded: n });
  } catch (err) {
    if (err instanceof MpStateSchemaPendingError) return NextResponse.json({ error: err.message, schemaPending: true }, { status: 503 });
    return ordersErrorResponse(err);
  }
}
