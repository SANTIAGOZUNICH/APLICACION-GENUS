import { NextResponse, type NextRequest } from "next/server";
import {
  isLegacyOsRedirectEnabled,
  LEGACY_TO_OS_REDIRECTS,
} from "@/lib/config/os-convergence";

/** Fase 3.11 — redirects 302 opt-in legacy → OS (Strangler Fig). Default: off. */
export function middleware(request: NextRequest) {
  if (!isLegacyOsRedirectEnabled()) {
    return NextResponse.next();
  }

  const target = LEGACY_TO_OS_REDIRECTS[request.nextUrl.pathname];
  if (!target) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url, 302);
}

/** Debe coincidir con las claves de LEGACY_TO_OS_REDIRECTS. */
export const config = {
  matcher: ["/bandeja"],
};
