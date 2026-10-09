import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { loadSemanasWorkItemPriorities } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prioridad de Semanas de los trabajos de «Mi trabajo» (solo lectura). Solo trabajos VINCULADOS por Producción y del
 * sector del usuario (Producción y Dirección: todos). Un trabajo sin vínculo no recibe prioridad.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    return NextResponse.json(await loadSemanasWorkItemPriorities(actor.sector));
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      // Sin planilla legible: no se muestra ninguna prioridad (nunca una prioridad dudosa).
      return NextResponse.json({ available: false, byWorkItem: {}, error: `No se pudo leer la planificación: ${err.message}` }, { status: 200 });
    }
    return ordersErrorResponse(err);
  }
}
