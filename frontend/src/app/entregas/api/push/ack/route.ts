import { NextResponse } from "next/server";
import { clientIpHash } from "@/lib/portal/security";
import { rateLimitHit, requireDb } from "@/lib/portal/store";
import { recordPushAck } from "@/lib/portal/push/push-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Acuse de recepción del service worker: «mostré la notificación del evento X en el dispositivo Y» (mejor esfuerzo; sirve para el
 * diagnóstico de Dirección: «recepción comprobada en el dispositivo»). Sin cookie ni datos del cliente: la credencial
 * (evento + dispositivo, firmada con la clave del servidor) viaja DENTRO del payload cifrado que solo ese dispositivo pudo leer.
 * No devuelve ningún dato; ante cualquier problema responde sin detalle.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 4_000) return new NextResponse(null, { status: 413 });
    const body = JSON.parse(text) as Record<string, unknown>;
    const db = requireDb();
    const limit = await rateLimitHit(db, `push-ack:${clientIpHash(request.headers)}`, 60, 120);
    if (!limit.allowed) return new NextResponse(null, { status: 429 });
    const ok = await recordPushAck({ eventId: body.eventId, sid: body.sid, token: body.token, endpoint: body.endpoint, userAgent: request.headers.get("user-agent") }, db);
    return new NextResponse(null, { status: ok ? 204 : 400 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
