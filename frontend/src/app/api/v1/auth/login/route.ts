import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { buildSetCookieHeader } from "@/lib/auth/cookies";
import { getAuthService } from "@/lib/auth/get-auth-service";
import { authErrorResponse } from "@/lib/auth/http";
import { SESSION_TTL_SECONDS } from "@/lib/auth/constants";
import { AuthInvalidCredentialsError } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LoginRequestBody {
  email?: string;
  password?: string;
  rememberMe?: boolean;
}

/** sha256 del IP del cliente — nunca se persiste la IP en claro. */
function hashIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  if (!ip) return null;
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return authErrorResponse(new AuthInvalidCredentialsError("Body JSON inválido."));
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const { user, token } = await getAuthService().login(email, password, {
      userAgent: request.headers.get("user-agent"),
      ipHash: hashIp(request),
      rememberMe: Boolean(body.rememberMe),
    });

    const response = NextResponse.json({
      user: {
        email: user.email,
        displayName: user.displayName,
        sector: user.sector,
        role: user.roleId,
        roleLabel: user.roleLabel,
        sectorLabel: user.sectorLabel,
        jobTitle: user.jobTitle,
        redirectTo: user.redirectTo,
      },
    });
    response.headers.set(
      "Set-Cookie",
      buildSetCookieHeader(token, { maxAgeSeconds: SESSION_TTL_SECONDS })
    );
    return response;
  } catch (err) {
    return authErrorResponse(err);
  }
}
