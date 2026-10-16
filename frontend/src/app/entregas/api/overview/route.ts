import { toClientPayload } from "@/lib/portal/overview";
import { loadPortalOverview, listNotifications } from "@/lib/portal/data-service";
import { errorResponse, jsonResponse, requireSession } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Todo lo que ve el cliente, calculado SIEMPRE en el servidor para el cliente de la sesión (nunca por parámetro). */
export async function GET(request: Request) {
  try {
    const { session } = await requireSession(request);
    const { overview } = await loadPortalOverview(session.clientId);
    const notifications = await listNotifications(session.clientId);
    return jsonResponse({ ok: true, client: { name: session.clientName, code: session.publicCode }, ...toClientPayload(overview), notifications });
  } catch (err) {
    return errorResponse(err);
  }
}
