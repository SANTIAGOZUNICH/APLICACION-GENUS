/** Utilidades HTTP de los endpoints del portal: respuestas sin caché, chequeo de origen y sesión por cookie. */
import "server-only";

import { NextResponse } from "next/server";
import { resolvePortalSession, type PortalSession } from "./auth-service";
import { parsePortalCookie } from "./cookies";
import { isAllowedOrigin } from "./security";
import { PortalError } from "./store";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

/** POST de navegador: exige un Origin del mismo sitio (defensa CSRF adicional a SameSite=Lax). */
export function assertSameOrigin(request: Request): void {
  if (!isAllowedOrigin(request.headers, request.url)) throw new PortalError("Solicitud no permitida.", 403, "BAD_ORIGIN");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.length > 4_000) throw new Error("big");
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new PortalError("Solicitud inválida.", 400, "BAD_JSON");
  }
}

export async function requireSession(request: Request): Promise<{ session: PortalSession; token: string }> {
  const token = parsePortalCookie(request.headers.get("cookie"));
  const session = await resolvePortalSession(token);
  if (!token || !session) throw new PortalError("Tu sesión venció. Ingresá de nuevo.", 401, "NO_SESSION");
  return { session, token };
}

/** Convierte cualquier error en una respuesta segura (sin detalles internos). */
export function errorResponse(err: unknown) {
  if (err instanceof PortalError) return jsonResponse({ ok: false, error: err.message, code: err.code }, err.status);
  console.error("[portal] error inesperado", err);
  return jsonResponse({ ok: false, error: "No pudimos completar la operación. Probá de nuevo en unos minutos.", code: "INTERNAL" }, 500);
}
