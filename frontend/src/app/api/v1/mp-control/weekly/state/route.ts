import { NextResponse } from "next/server";
import { MpStateSchemaPendingError, saveRowNote } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpNotes } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Observación general (por MP y semana) y decisión de gestión. Administrativo: no toca fórmulas, cantidades, stock ni consumos. */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpNotes(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima y Producción pueden escribir observaciones y decisiones." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { week?: string; rowKey?: string; label?: string; observacion?: string; gestion?: string };
    if (!b.week || !/^\d{4}-\d{2}-\d{2}$/.test(b.week) || !b.rowKey) return NextResponse.json({ error: "week y rowKey son obligatorios." }, { status: 400 });
    await saveRowNote({ week: b.week, rowKey: b.rowKey, label: b.label ?? "", observacion: b.observacion, gestion: b.gestion, by: actor.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MpStateSchemaPendingError) return NextResponse.json({ error: err.message, schemaPending: true }, { status: 503 });
    if (err instanceof Error && /Decisión/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return ordersErrorResponse(err);
  }
}
