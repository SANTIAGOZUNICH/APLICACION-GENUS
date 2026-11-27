import { NextResponse } from "next/server";
import { resolveOrdersActor } from "@/lib/orders/actor";
import { ordersErrorResponse } from "@/lib/orders/http";
import { PortalError } from "@/lib/portal/store";
import { pushHealth } from "@/lib/portal/push/push-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Salud del circuito de notificaciones del Portal de Clientes — SOLO Dirección (sesión de GENUS OS; el servicio lo vuelve a validar).
 * Permite verificar producción SIN acceso a la base: VAPID, cron (último latido, «sin ejecuciones recientes» si pasó más de 5 minutos),
 * cola, y por cliente dispositivos, envío simulado vs real, «aceptado por el servicio push» vs «recepción comprobada en el dispositivo» y el
 * último error. No devuelve endpoints, claves ni datos de contacto. `ok: false` + `problems[]` dicen qué corregir.
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveOrdersActor(request);
    return NextResponse.json(await pushHealth({ email: actor.email, sector: actor.sector }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    if (err instanceof PortalError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return ordersErrorResponse(err);
  }
}
