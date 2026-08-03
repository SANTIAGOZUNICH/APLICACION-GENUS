import { NextResponse, type NextRequest } from "next/server";
import {
  isLegacyOsRedirectEnabled,
  LEGACY_TO_OS_REDIRECTS,
} from "@/lib/config/os-convergence";

/** Fase 3.11 — redirects 302 opt-in legacy → OS (Strangler Fig). Default: off. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get("genus_session")?.value);
  const isAuthLogin = pathname === "/api/v1/auth/login";
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.webmanifest/";
  const isHealthCheck =
    pathname === "/api/health" || pathname === "/api/v1/connectivity";
  const isApi = pathname.startsWith("/api/v1/");

  if (!isPublicPage && !isAuthLogin && !isHealthCheck && !hasSessionCookie) {
    if (isApi) {
      return NextResponse.json({ error: "Sesión requerida.", code: "AUTH_UNAUTHORIZED" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (!isLegacyOsRedirectEnabled()) {
    return NextResponse.next();
  }

  const target = LEGACY_TO_OS_REDIRECTS[pathname];
  if (!target) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url, 302);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest\\.webmanifest|sw\\.js|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$).*)",
  ],
};
