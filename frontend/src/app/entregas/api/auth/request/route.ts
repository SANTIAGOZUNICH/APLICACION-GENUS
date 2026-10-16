import { after } from "next/server";
import { requestLoginCode } from "@/lib/portal/auth-service";
import { assertSameOrigin, errorResponse, jsonResponse, readJson } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEUTRAL = "Si los datos son correctos, te enviamos un código de acceso al correo autorizado. Revisá tu bandeja de entrada.";

/** Pide el código temporal. La respuesta es idéntica exista o no el cliente/correo (sin enumeración). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const r = await requestLoginCode({ code: body.code, email: body.email, headers: request.headers });
    if (r.status === "rate_limited") return jsonResponse({ ok: false, error: "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.", code: "RATE_LIMITED" }, 429, { "Retry-After": "600" });
    after(async () => {
      try {
        await r.deliver();
      } catch (err) {
        console.error("[portal] fallo el envío del código", err);
      }
    });
    return jsonResponse({ ok: true, message: NEUTRAL });
  } catch (err) {
    return errorResponse(err);
  }
}
