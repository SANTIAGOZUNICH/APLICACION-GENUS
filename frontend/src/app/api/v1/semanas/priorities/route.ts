import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { loadPriorityHistory, updateTaskPriority } from "@/lib/semanas-sheet/semanas-sheet-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cambia la prioridad de UNA tarea de Semanas. Dato de GENUS (base de datos): no escribe en Google Sheets.
 * 409 = otro usuario la cambió o la tarea ya no está en la planilla · 403 = sin permiso · 503 = migración 0041 pendiente.
 */
export async function PATCH(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    const body = (await request.json().catch(() => null)) as { tabKey?: string; taskKey?: string; priority?: string; expectedVersion?: number } | null;
    if (!body?.tabKey || !body.taskKey || !body.priority || typeof body.expectedVersion !== "number") throw new OrdersValidationError("tabKey, taskKey, priority y expectedVersion son obligatorios.");
    const stored = await updateTaskPriority({ email: actor.email, sector: actor.sector, displayName: actor.displayName }, { tabKey: body.tabKey, taskKey: body.taskKey, priority: body.priority, expectedVersion: body.expectedVersion });
    return NextResponse.json({ ok: true, stored });
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if ((status === 409 || status === 503) && err instanceof Error) return NextResponse.json({ ok: false, error: err.message }, { status });
    return ordersErrorResponse(err);
  }
}

/** Historial (auditoría) de cambios de prioridad de una tarea. Producción y Dirección. */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    if (actor.sector !== "PRODUCCION" && actor.sector !== "DIRECCION") throw new OrdersForbiddenError("El historial de prioridades es de Producción.");
    const url = new URL(request.url);
    const tabKey = url.searchParams.get("tabKey");
    const taskKey = url.searchParams.get("taskKey");
    if (!tabKey || !taskKey) throw new OrdersValidationError("tabKey y taskKey son obligatorios.");
    return NextResponse.json({ events: await loadPriorityHistory(tabKey, taskKey) });
  } catch (err) {
    return ordersErrorResponse(err);
  }
}
