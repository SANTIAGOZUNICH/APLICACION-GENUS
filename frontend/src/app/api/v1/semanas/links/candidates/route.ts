import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { suggestSemanasLinks } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trabajos que PODRÍAN corresponder a una tarea (misma semana y sector), ordenados por parecido. Solo sugerencias. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (actor.sector !== "PRODUCCION") throw new OrdersForbiddenError("Solo Producción vincula tareas con trabajos.");
    const url = new URL(request.url);
    const tabKey = url.searchParams.get("tabKey");
    const taskKey = url.searchParams.get("taskKey");
    if (!tabKey || !taskKey) throw new OrdersValidationError("tabKey y taskKey son obligatorios.");
    return NextResponse.json(await suggestSemanasLinks(tabKey, taskKey));
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 503 && err instanceof Error) return NextResponse.json({ error: err.message }, { status });
    return ordersErrorResponse(err);
  }
}
