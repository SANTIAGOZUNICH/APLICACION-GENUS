import { logoutPortalSession } from "@/lib/portal/auth-service";
import { clearPortalCookie, parsePortalCookie } from "@/lib/portal/cookies";
import { assertSameOrigin, errorResponse, jsonResponse } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await logoutPortalSession(parsePortalCookie(request.headers.get("cookie")));
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearPortalCookie() });
  } catch (err) {
    return errorResponse(err);
  }
}
