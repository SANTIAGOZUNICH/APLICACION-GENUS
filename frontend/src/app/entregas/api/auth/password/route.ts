import { changeOwnPassword } from "@/lib/portal/user-auth-service";
import { assertSameOrigin, errorResponse, jsonResponse, readJson, requireSession } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** El usuario cambia su propia contraseña (la actual + la nueva). Única ruta permitida con una contraseña temporal. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session } = await requireSession(request, { allowPasswordChange: true });
    const body = await readJson(request);
    await changeOwnPassword(session, { current: body.current, next: body.next, headers: request.headers });
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
