import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { loadSectorPlan } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Planificación de Semanas de un sector (SOLO LECTURA): tareas + prioridades compartidas con Producción.
 * `?sector=` es opcional; el servidor decide qué puede ver el usuario (403 si pide otro sector).
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const plan = await loadSectorPlan(actor.sector, new URL(request.url).searchParams.get("sector"));
    return NextResponse.json(plan);
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: `No se pudo leer la planificación: ${err.message}` }, { status: 502 });
    }
    return ordersErrorResponse(err);
  }
}
