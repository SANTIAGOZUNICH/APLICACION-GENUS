import { assertSameOrigin, demoSessionFrom, errorResponse, jsonResponse, requireSession } from "@/lib/portal/http";
import { PortalError } from "@/lib/portal/store";
import { listPushHistory, markPushRead, pushClientConfig, removePushSubscription, savePushSubscription } from "@/lib/portal/push/push-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

/** GET /entregas/api/push/config?endpoint=…  ·  GET /entregas/api/push/history */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    // La demostración no tiene dispositivos ni historial reales.
    if (await demoSessionFrom(request)) return jsonResponse(action === "history" ? { items: [], unread: 0 } : { available: false, reason: "demo", publicKey: null, devices: 0, thisDevice: false, pilotEnabled: false });
    const { session } = await requireSession(request);
    if (action === "config") {
      const endpoint = new URL(request.url).searchParams.get("endpoint");
      return jsonResponse(await pushClientConfig(session, endpoint && endpoint.length <= 2048 ? endpoint : null));
    }
    if (action === "history") return jsonResponse(await listPushHistory(session));
    throw new PortalError("No encontrado.", 404, "NOT_FOUND");
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST subscribe | unsubscribe | read (solo del cliente de la sesión; mismo origen). */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    assertSameOrigin(request);
    if (await demoSessionFrom(request)) throw new PortalError("No disponible en la demostración.", 409, "DEMO");
    const { session } = await requireSession(request);
    const body = await readJsonLarge(request);
    if (action === "subscribe") {
      const saved = await savePushSubscription(session, body.subscription, request.headers.get("user-agent"), undefined, typeof body.applicationServerKey === "string" ? body.applicationServerKey : null);
      return jsonResponse({ ok: true, ...saved });
    }
    if (action === "unsubscribe") return jsonResponse({ ok: true, removed: await removePushSubscription(session, body.endpoint) });
    if (action === "read") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;
      return jsonResponse({ ok: true, marked: await markPushRead(session, body.all === true ? null : (ids ?? [])) });
    }
    throw new PortalError("No encontrado.", 404, "NOT_FOUND");
  } catch (err) {
    return errorResponse(err);
  }
}

/** Las suscripciones traen un endpoint largo: el lector común (4 KB) se queda corto, acá se admite hasta 8 KB. */
async function readJsonLarge(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.length > 8_000) throw new Error("big");
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new PortalError("Solicitud inválida.", 400, "BAD_JSON");
  }
}
