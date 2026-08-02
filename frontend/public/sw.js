/**
 * Service worker Genus OS — caché estática segura únicamente.
 * NUNCA cachea /api/**, HTML autenticado, ni datos operativos.
 * Build: ?build=SHA en la URL de registro.
 */
/* eslint-disable no-restricted-globals */
const BUILD = (() => {
  try {
    return new URL(self.location.href).searchParams.get("build") || "dev";
  } catch {
    return "dev";
  }
})();
const STATIC_CACHE = `genus-os-static-${BUILD}`;

const PRECACHE_URLS = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/brand/laboratorio-genus-logo-official-source.png",
];

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname.startsWith("/brand/")) return true;
  if (url.pathname === "/manifest.webmanifest" || url.pathname === "/manifest.webmanifest/") return true;
  if (/\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("genus-os-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // APIs y datos: red pura, sin cache.
  if (isApiRequest(url)) return;

  // Navegación: red primero; offline → pantalla segura.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match("/offline");
          return cached || new Response("Sin conexión", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // Estáticos inmutables: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const fallback = await caches.match(request);
          if (fallback) return fallback;
          throw new Error("offline-static");
        }
      })()
    );
  }
});
