import { NextResponse } from "next/server";
import { searchInventoryMps } from "@/lib/mp-control/weekly-availability-service";
import { canReadMpControl } from "@/lib/mp-control/types";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buscador LIBRE de materias primas del inventario (nombre o código, cualquiera), para reemplazar una MP del control a mano. Solo lectura. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (!canReadMpControl(actor.sector)) return NextResponse.json({ error: "Sin permiso de lectura MP Control." }, { status: 403 });
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ items: await searchInventoryMps(q.slice(0, 120)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
