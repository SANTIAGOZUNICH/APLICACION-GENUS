import { logoutPortalSession } from "@/lib/portal/auth-service";
import { clearDemoCookie, clearPortalCookie, parseDemoCookie, parsePortalCookie } from "@/lib/portal/cookies";
import { demoLogout } from "@/lib/portal/demo-service";
import { assertSameOrigin, errorResponse, jsonResponse } from "@/lib/portal/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const cookie = request.headers.get("cookie");
    await demoLogout(parseDemoCookie(cookie));
    await logoutPortalSession(parsePortalCookie(cookie));
    const res = jsonResponse({ ok: true }, 200, { "Set-Cookie": clearPortalCookie() });
    res.headers.append("Set-Cookie", clearDemoCookie());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
