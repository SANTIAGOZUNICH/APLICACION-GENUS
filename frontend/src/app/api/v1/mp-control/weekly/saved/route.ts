import { NextResponse } from "next/server";
import { listSavedControls, saveControlNeeds } from "@/lib/mp-control/saved-weekly-control";
import { canReadMpControl, canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDay = (s: string | null | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

/** Controles guardados de UNA semana, uno por producto/producción. Nunca mezcla semanas. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const week = new URL(request.url).searchParams.get("week");
    if (!isDay(week)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD" }, { status: 400 });
    return NextResponse.json(await listSavedControls(week), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** { week, controlId } — vuelve a calcular y guardar los faltantes de ESE control. Solo Materias Primas. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materias Primas puede guardar el control semanal." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { week?: string; controlId?: string };
    if (!isDay(body.week) || !body.controlId) return NextResponse.json({ error: "week (AAAA-MM-DD) y controlId obligatorios" }, { status: 400 });
    const saved = await saveControlNeeds({ email: actor.email, sector: actor.sector }, body.controlId, body.week);
    return NextResponse.json({ saved }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
