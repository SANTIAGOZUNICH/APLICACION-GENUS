import { NextResponse } from "next/server";
import { getWeeklyAvailability } from "@/lib/mp-control/weekly-availability-service";
import { canReadMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disponibilidad real de MP de la semana (stock del inventario vs. necesidad consolidada). Solo lectura, sin caché. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const week = new URL(request.url).searchParams.get("week") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return NextResponse.json({ error: "week debe ser AAAA-MM-DD" }, { status: 400 });
    const data = await getWeeklyAvailability(week);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
