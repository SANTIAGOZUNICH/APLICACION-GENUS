import { confirmReceipt, getReceiptPreview } from "@/lib/portal/data-service";
import { assertSameOrigin, errorResponse, jsonResponse, readJson, requireSession } from "@/lib/portal/http";
import { clientIpHash } from "@/lib/portal/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: unknown) => (typeof v === "string" && /^[a-f0-9]{24}$/.test(v) ? v : null);

/** Datos para el diálogo «Confirmar recepción» (producto, pedido, cantidad, fecha de entrega registrada). */
export async function GET(request: Request) {
  try {
    const { session } = await requireSession(request);
    const id = idOf(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonResponse({ ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" }, 404);
    const view = await getReceiptPreview(session, id);
    if (!view) return jsonResponse({ ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" }, 404);
    return jsonResponse({ ok: true, delivery: view });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session } = await requireSession(request);
    const body = await readJson(request);
    const id = idOf(body.id);
    if (!id) return jsonResponse({ ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" }, 404);
    const r = await confirmReceipt(session, id, clientIpHash(request.headers));
    if (!r.ok) {
      return r.reason === "already_confirmed"
        ? jsonResponse({ ok: false, error: "Esta entrega ya tiene la recepción confirmada.", code: "ALREADY_CONFIRMED" }, 409)
        : jsonResponse({ ok: false, error: "Entrega no encontrada.", code: "NOT_FOUND" }, 404);
    }
    return jsonResponse({ ok: true, confirmation: r.confirmation });
  } catch (err) {
    return errorResponse(err);
  }
}
