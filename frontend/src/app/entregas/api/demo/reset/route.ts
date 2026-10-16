import { demoReset } from "@/lib/portal/demo-service";
import { assertSameOrigin, demoSessionFrom, errorResponse, jsonResponse } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vuelve la demostración al estado inicial (solo con una sesión demo vigente). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const d = await demoSessionFrom(request);
    if (!d) return jsonResponse({ ok: false, error: "La sesión de prueba venció.", code: "NO_SESSION" }, 401);
    await demoReset(d.demo);
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
