import { toClientPayload } from "@/lib/portal/overview";
import { loadPortalOverview, listNotifications } from "@/lib/portal/data-service";
import { demoPayload } from "@/lib/portal/demo-service";
import { demoSessionFrom, errorResponse, jsonResponse, requireSession } from "@/lib/portal/http";
import { sha256 } from "@/lib/portal/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seguimiento en tiempo real: la página consulta esta ruta cada pocos segundos con `If-None-Match`. La firma (ETag) es un hash de
 * lo que ESE cliente ve; si no cambió responde 304 sin cuerpo (consulta liviana). Siempre `private, no-store`: la firma nunca la
 * comparte un caché intermedio entre clientes.
 */
function respond(request: Request, body: unknown) {
  const etag = `"${sha256(JSON.stringify(body)).slice(0, 32)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-store" } });
  }
  return jsonResponse(body, 200, { ETag: etag });
}

/** Todo lo que ve el cliente, calculado SIEMPRE en el servidor para el cliente de la sesión (nunca por parámetro). */
export async function GET(request: Request) {
  try {
    // Sesión de demostración: datos ficticios generados en memoria, sin tocar GENUS OS.
    const d = await demoSessionFrom(request);
    if (d) return respond(request, { ok: true, ...(await demoPayload(d.demo)) });
    const { session } = await requireSession(request);
    const { overview } = await loadPortalOverview(session.clientId);
    const notifications = await listNotifications(session.clientId);
    return respond(request, { ok: true, client: { name: session.clientName, code: session.publicCode }, ...toClientPayload(overview), notifications });
  } catch (err) {
    return errorResponse(err);
  }
}
