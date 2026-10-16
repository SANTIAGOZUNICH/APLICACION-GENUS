import { markNotificationsRead } from "@/lib/portal/data-service";
import { assertSameOrigin, errorResponse, jsonResponse, requireSession } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marca como leídos los avisos del cliente de la sesión. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session } = await requireSession(request);
    await markNotificationsRead(session.clientId);
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
