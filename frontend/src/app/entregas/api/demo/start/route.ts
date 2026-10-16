import { buildDemoCookie } from "@/lib/portal/cookies";
import { redeemDemoToken } from "@/lib/portal/demo-service";
import { assertSameOrigin, errorResponse, jsonResponse, readJson } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canjea el token de un solo uso (viene en el fragmento de la URL, nunca en la consulta) por una sesión demo. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const r = await redeemDemoToken({ token: body.token, headers: request.headers });
    if (!r.ok) {
      if (r.reason === "rate_limited") return jsonResponse({ ok: false, error: "Demasiados intentos. Esperá unos minutos.", code: "RATE_LIMITED" }, 429);
      return jsonResponse({ ok: false, error: "El enlace de prueba venció o ya fue usado. Volvé a abrirlo desde GENUS OS.", code: "INVALID" }, 401);
    }
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": buildDemoCookie(r.sessionToken) });
  } catch (err) {
    return errorResponse(err);
  }
}
