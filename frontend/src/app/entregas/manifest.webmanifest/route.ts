export const runtime = "nodejs";
export const dynamic = "force-static";

/** Manifest del Portal de Clientes: scope y start_url limitados a /entregas (distinto del manifest de GENUS OS). */
export function GET() {
  const manifest = {
    id: "/entregas",
    name: "GENUS — Portal de Clientes",
    short_name: "Portal Genus",
    description: "Seguí el avance de tus pedidos en Laboratorio Genus.",
    start_url: "/entregas",
    scope: "/entregas",
    display: "standalone",
    orientation: "portrait-primary",
    lang: "es-AR",
    background_color: "#ffffff",
    theme_color: "#0b2f57",
    categories: ["business"],
    icons: [
      { src: "/entregas/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/entregas/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/entregas/pwa/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
