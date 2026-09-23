import { NextResponse, type NextRequest } from "next/server";
import {
  isLegacyOsRedirectEnabled,
  LEGACY_TO_OS_REDIRECTS,
} from "@/lib/config/os-convergence";
import {
  getCanonicalProductionHost,
  shouldRedirectToCanonicalHost,
  shouldRedirectToCanonicalPreviewHost,
} from "@/lib/config/canonical-host";

/** Fase 3.11 — redirects 302 opt-in legacy → OS (Strangler Fig). Default: off. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/v1/");
  /**
   * Bug real (encontrado auditando por qué el cron de Asignación de Lotes
   * nunca sincronizaba en Production pese a existir y tener CRON_SECRET
   * configurado): Vercel Cron llama a /api/cron/* con
   * `Authorization: Bearer $CRON_SECRET` — nunca manda la cookie
   * `genus_session`. Como esta ruta no empieza con /api/v1/, `isApi` daba
   * false, así que el gate de sesión de abajo la trataba como página y
   * respondía 307 a /login ANTES de que el handler (que sí valida
   * CRON_SECRET) llegara a ejecutarse — confirmado en vivo contra
   * Production (curl a appgenus.vercel.app/api/cron/... → 307 Location:
   * /login). /api/cron/* tiene su propia autenticación (Bearer token) en
   * el propio handler, igual que /api/health — nunca debe pasar por el
   * gate de sesión.
   */
  const isCronEndpoint = pathname.startsWith("/api/cron/");

  // Dominio canónico único en Production — ver canonical-host.ts. Corre
  // ANTES que todo lo demás: la cookie de sesión es host-only, así que un
  // link/bookmark a otro alias de Vercel del mismo deployment deja al login
  // "aparentemente correcto" pero expulsa al usuario en la siguiente
  // navegación (la cookie nunca llega en el host equivocado).
  if (
    shouldRedirectToCanonicalHost({
      vercelEnv: process.env.VERCEL_ENV,
      hostname: request.nextUrl.hostname,
      isApiRequest: isApi || isCronEndpoint,
    })
  ) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.hostname = getCanonicalProductionHost();
    canonicalUrl.port = "";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  // Preview: cada deployment tiene dos hostnames válidos (propio + alias de
  // rama) — ver canonical-host.ts. Sin esto, saltar entre ambos con una
  // sesión válida se ve como "Sesión vencida" (cookie host-only ausente en
  // el hostname "equivocado").
  if (
    shouldRedirectToCanonicalPreviewHost({
      vercelEnv: process.env.VERCEL_ENV,
      hostname: request.nextUrl.hostname,
      isApiRequest: isApi || isCronEndpoint,
      deploymentHost: process.env.VERCEL_URL,
    })
  ) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.hostname = process.env.VERCEL_URL!;
    canonicalUrl.port = "";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const hasSessionCookie = Boolean(request.cookies.get("genus_session")?.value);
  const isAuthLogin = pathname === "/api/v1/auth/login";
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.webmanifest/";
  const isHealthCheck =
    pathname === "/api/health" || pathname === "/api/v1/connectivity";

  if (!isPublicPage && !isAuthLogin && !isHealthCheck && !isCronEndpoint && !hasSessionCookie) {
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
