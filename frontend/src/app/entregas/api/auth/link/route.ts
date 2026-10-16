import { verifyLoginLink } from "@/lib/portal/auth-service";
import { buildPortalCookie, clearDemoCookie } from "@/lib/portal/cookies";
import { assertSameOrigin, errorResponse, jsonResponse, readJson } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** El enlace seguro se canjea con POST desde la página /acceso (un GET de un antivirus o vista previa no lo consume). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const r = await verifyLoginLink({ token: body.token, headers: request.headers });
    if (!r.ok) {
      return r.reason === "rate_limited"
        ? jsonResponse({ ok: false, error: "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.", code: "RATE_LIMITED" }, 429)
        : jsonResponse({ ok: false, error: "El enlace venció o ya fue usado. Pedí un código nuevo.", code: "INVALID" }, 401);
    }
    // Un ingreso real reemplaza cualquier sesión de demostración que quedara en este navegador.
    const res = jsonResponse({ ok: true, client: r.session.clientName }, 200, { "Set-Cookie": buildPortalCookie(r.token) });
    res.headers.append("Set-Cookie", clearDemoCookie());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
