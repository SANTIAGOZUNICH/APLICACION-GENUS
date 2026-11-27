import { portalServiceWorkerSource } from "@/lib/portal/pwa/sw-source";

export const runtime = "nodejs";
export const dynamic = "force-static";

/** Service worker del Portal de Clientes. Alcance acotado a /entregas (la app interna no lo usa ni lo registra). */
export function GET() {
  const build = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7);
  return new Response(portalServiceWorkerSource(build), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, max-age=0",
      "Service-Worker-Allowed": "/entregas",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
