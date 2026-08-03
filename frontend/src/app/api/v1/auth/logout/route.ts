import { NextResponse } from "next/server";
import { clearCookieHeader, parseSessionCookie } from "@/lib/auth/cookies";
import { getAuthService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    await getAuthService().logout(token);

    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", clearCookieHeader());
    return response;
  } catch (err) {
    return authErrorResponse(err);
  }
}
