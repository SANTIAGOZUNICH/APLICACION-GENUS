import { NextResponse } from "next/server";
import { saveTotalNote } from "@/lib/mp-control/weekly-availability-service";
import { canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validWeek = (w: unknown): w is string => typeof w === "string" && (w === "sin-fecha" || /^\d{4}-\d{2}-\d{2}$/.test(w));

/** Observación de una MP del Control semanal total (autoguardado; texto vacío = se borra). Solo Materia Prima escribe. */
export async function PUT(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materia Prima puede escribir observaciones." }, { status: 403 });
    const b = (await request.json().catch(() => ({}))) as { week?: unknown; rowKey?: unknown; label?: unknown; observacion?: unknown };
    if (!validWeek(b.week) || typeof b.rowKey !== "string" || !b.rowKey || typeof b.observacion !== "string") {
      return NextResponse.json({ error: "week, rowKey y observacion son obligatorios." }, { status: 400 });
    }
    await saveTotalNote({ week: b.week, rowKey: b.rowKey.slice(0, 300), label: String(b.label ?? "").slice(0, 300), observacion: b.observacion, by: actor.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
