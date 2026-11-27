import { passwordLogin } from "@/lib/portal/user-auth-service";
import { buildPortalCookie, clearDemoCookie } from "@/lib/portal/cookies";
import { assertSameOrigin, errorResponse, jsonResponse, readJson } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mismo mensaje para usuario inexistente, contraseña mala, desactivado o bloqueado: no se puede averiguar qué usuarios existen. */
const INVALID = "Usuario o contraseña incorrectos.";
const TOO_MANY = "Demasiados intentos. Esperá unos minutos y probá de nuevo.";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const r = await passwordLogin({ username: body.username, password: body.password, headers: request.headers });
    if (!r.ok) {
      if (r.reason === "invalid") return jsonResponse({ ok: false, error: INVALID, code: "INVALID" }, 401);
      return jsonResponse({ ok: false, error: TOO_MANY, code: "RATE_LIMITED" }, 429, { "Retry-After": String(Math.min(r.retryAfterSeconds ?? 600, 3600)) });
    }
    const res = jsonResponse({ ok: true, client: r.session.clientName, mustChangePassword: r.mustChangePassword }, 200, { "Set-Cookie": buildPortalCookie(r.token) });
    res.headers.append("Set-Cookie", clearDemoCookie());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
