/**
 * Service worker del Portal de Clientes (scope /entregas). Se sirve desde /entregas/sw.js con `Service-Worker-Allowed: /entregas`.
 *
 * POLÍTICA DE CACHÉ (innegociable):
 *  - Solo se cachean assets estáticos PÚBLICOS: /entregas/pwa/*, el logo, la página offline genérica y /_next/static/* (bundles con hash).
 *  - NUNCA se cachea ni se intercepta /entregas/api/* (network-only), ni el HTML de las páginas (navegación network-only; si no hay
 *    red se muestra la página offline genérica, sin datos de ningún cliente), ni respuestas con `no-store`/`private`.
 *  - Al cerrar sesión / cambiar de usuario la página pide CLEAR_CACHES: se borran todas las caches del portal.
 * ACTUALIZACIÓN: la versión nueva queda «en espera» y avisa a la página; se activa solo cuando el usuario acepta (SKIP_WAITING).
 * PUSH: muestra siempre una notificación (requisito de iOS/Safari), dentro de waitUntil, con payload parseado con fallback y assets existentes;
 *       después manda el ACUSE de recepción a /entregas/api/push/ack. Al tocarla abre /entregas#pedido-… (solo rutas del portal).
 */
export const PORTAL_SW_VERSION = "1";

export function portalServiceWorkerSource(build: string): string {
  const version = `${PORTAL_SW_VERSION}-${build}`.replace(/[^A-Za-z0-9._-]/g, "");
  return `/* GENUS Portal de Clientes — service worker v${version} */
const VERSION = ${JSON.stringify(version)};
const CACHE_PREFIX = "genus-portal-";
const STATIC_CACHE = CACHE_PREFIX + "static-" + VERSION;
const SCOPE_PATH = "/entregas";
const OFFLINE_URL = "/entregas/offline.html";
const PRECACHE = [OFFLINE_URL, "/entregas/pwa/icon-192.png", "/entregas/pwa/icon-512.png", "/entregas/pwa/badge-96.png", "/entregas/logo-genus.png"];

function isStaticPublicAsset(url) {
  const p = url.pathname;
  if (p === OFFLINE_URL || p === "/entregas/logo-genus.png") return true;
  if (p.startsWith("/entregas/pwa/")) return true;
  if (p.startsWith("/_next/static/")) return true;
  return false;
}
function isPortalApi(url) { return url.pathname === SCOPE_PATH + "/api" || url.pathname.startsWith(SCOPE_PATH + "/api/"); }
function inScope(url) { return url.pathname === SCOPE_PATH || url.pathname.startsWith(SCOPE_PATH + "/"); }
function safePortalUrl(raw) {
  try {
    const u = new URL(raw || SCOPE_PATH, self.location.origin);
    if (u.origin !== self.location.origin || !(u.pathname === SCOPE_PATH || u.pathname.startsWith(SCOPE_PATH + "/"))) return SCOPE_PATH;
    return u.pathname + u.search + u.hash;
  } catch (e) { return SCOPE_PATH; }
}

self.addEventListener("install", (event) => {
  // Sin skipWaiting automático: la versión nueva espera a que el usuario acepte el aviso.
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== STATIC_CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "CLEAR_CACHES") {
    // Borra TODAS las caches del portal y vuelve a dejar solo los assets públicos básicos (página offline, íconos).
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))))
        .then(() => caches.open(STATIC_CACHE))
        .then((c) => c.addAll(PRECACHE))
        .catch(() => undefined)
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API del portal: network-only, ni siquiera se intercepta.
  if (isPortalApi(url)) return;
  if (req.mode === "navigate") {
    if (!inScope(url)) return;
    // HTML siempre de la red (puede ser autenticado). Sin red: página offline genérica.
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())));
    return;
  }
  if (!isStaticPublicAsset(url)) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      const cc = (res.headers.get("cache-control") || "").toLowerCase();
      if (res.ok && res.type === "basic" && !cc.includes("no-store") && !cc.includes("private") && !res.headers.has("set-cookie")) cache.put(req, res.clone()).catch(() => undefined);
      return res;
    })
  );
});

// Lectura ROBUSTA del payload: JSON → texto plano → vacío. Nunca lanza.
function readPush(event) {
  var data = {};
  try {
    if (event.data) {
      try { data = event.data.json(); }
      catch (e) { data = typeof event.data.text === "function" ? { body: String(event.data.text() || "") } : {}; }
    }
  } catch (e) { data = {}; }
  return data && typeof data === "object" ? data : {};
}

// Acuse de recepción (mejor esfuerzo): avisa al servidor que ESTE dispositivo mostró la notificación. Nunca rompe la notificación.
function ackPush(data) {
  try {
    var ack = data && data.ack;
    if (!ack || typeof ack.sid !== "string" || typeof ack.token !== "string" || typeof data.eventId !== "string") return Promise.resolve();
    var getSub = self.registration && self.registration.pushManager && self.registration.pushManager.getSubscription ? self.registration.pushManager.getSubscription() : Promise.resolve(null);
    return Promise.resolve(getSub).catch(function () { return null; }).then(function (sub) {
      return fetch(SCOPE_PATH + "/api/push/ack", {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: data.eventId, sid: ack.sid, token: ack.token, endpoint: sub && sub.endpoint ? sub.endpoint : undefined })
      });
    }).catch(function () { return undefined; });
  } catch (e) { return Promise.resolve(); }
}

self.addEventListener("push", (event) => {
  const data = readPush(event);
  const title = typeof data.title === "string" && data.title ? data.title : "GENUS — Portal de Clientes";
  const body = typeof data.body === "string" && data.body ? data.body : "Tenés novedades en tu pedido.";
  const options = {
    body,
    icon: "/entregas/pwa/icon-192.png",
    badge: "/entregas/pwa/badge-96.png",
    lang: "es-AR",
    tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
    timestamp: Date.now(),
    vibrate: [120, 60, 120],
    data: { url: safePortalUrl(data.url), eventId: typeof data.eventId === "string" ? data.eventId : null }
  };
  // SIEMPRE se muestra una notificación (iOS/Safari y Chrome exigen userVisibleOnly): si falla con opciones, se reintenta con lo mínimo.
  // El acuse se manda DESPUÉS de mostrarla y dentro de waitUntil (el navegador no termina el SW antes).
  event.waitUntil(
    self.registration.showNotification(title, options)
      .catch(function () { return self.registration.showNotification(title, { body: body }); })
      .then(function () { return ackPush(data); })
  );
});

// Si el navegador rota la suscripción (clave nueva, caducidad), se vuelve a registrar sola con la clave vigente.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async function () {
    try {
      var old = event.oldSubscription;
      var sub = event.newSubscription || (old && old.options && old.options.applicationServerKey
        ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey })
        : null);
      if (!sub) return;
      await fetch(SCOPE_PATH + "/api/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch (e) { /* sin sesión o sin red: la página reintenta al abrirse */ }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safePortalUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      for (const c of list) {
        try {
          const u = new URL(c.url);
          if (u.origin === self.location.origin && (u.pathname === SCOPE_PATH || u.pathname.startsWith(SCOPE_PATH + "/"))) {
            await c.focus();
            if ("navigate" in c) return c.navigate(target);
            return undefined;
          }
        } catch (e) { /* ignorar */ }
      }
      return self.clients.openWindow(target);
    })
  );
});
`;
}
