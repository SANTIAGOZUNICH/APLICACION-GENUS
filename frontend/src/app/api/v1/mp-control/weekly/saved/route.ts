import { NextResponse } from "next/server";
import { getSavedWeeklyControl, saveWeeklyControl } from "@/lib/mp-control/saved-weekly-control";
import { canReadMpControl, canWriteMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDay = (s: string | null): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

/** Control semanal guardado de UNA semana (o null si todavía no se guardó). Nunca mezcla semanas. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const week = new URL(request.url).searchParams.get("week");
    if (!isDay(week)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD" }, { status: 400 });
    return NextResponse.json(await getSavedWeeklyControl(week), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}

/** { week } — guarda (o actualiza) el control de la semana con las MP que necesitan atención. Solo Materias Primas. */
export async function POST(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canWriteMpControl(actor.sector)) return NextResponse.json({ error: "Solo Materias Primas puede guardar el control semanal." }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { week?: string };
    if (!isDay(body.week ?? null)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD" }, { status: 400 });
    return NextResponse.json({ saved: await saveWeeklyControl({ email: actor.email }, body.week!) }, { status: 201 });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
