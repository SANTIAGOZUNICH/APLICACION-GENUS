import { describe, expect, it, vi } from "vitest";
import { portalServiceWorkerSource } from "./sw-source";

type Listener = (e: Record<string, unknown>) => void;

/** Ejecuta el service worker en una sandbox con `self`, `caches` y `fetch` falsos. */
function boot() {
  const listeners: Record<string, Listener> = {};
  const store = new Map<string, Map<string, unknown>>();
  const cacheApi = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return { match: async (r: { url?: string } | string) => m.get(typeof r === "string" ? r : r.url!), put: async (r: { url: string }, v: unknown) => void m.set(r.url, v), addAll: async (urls: string[]) => urls.forEach((u) => m.set(new URL(u, "https://x.test").href, { precached: u })) };
    }),
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    match: async (u: string) => [...store.values()].map((m) => m.get(new URL(u, "https://x.test").href)).find(Boolean),
  };
  const shown: Array<{ title: string; opts: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://x.test", href: "https://x.test/entregas/sw.js" },
    addEventListener: (t: string, l: Listener) => void (listeners[t] = l),
    skipWaiting: vi.fn(),
    registration: { showNotification: async (title: string, opts: Record<string, unknown>) => void shown.push({ title, opts }) },
    clients: { matchAll: async () => [], openWindow: async (u: string) => void opened.push(u) },
  };
  const fetchMock = vi.fn(async (req: { url: string }) => ({ ok: true, type: "basic", url: req.url, headers: new Headers({ "cache-control": "public, max-age=31536000" }), clone() { return this; } }));
  new Function("self", "caches", "fetch", "URL", "Response", "Headers", portalServiceWorkerSource("test"))(self, cacheApi, fetchMock, URL, { error: () => "ERR" }, Headers);
  const fetchEvent = (url: string, over: Record<string, unknown> = {}) => {
    let responded: Promise<unknown> | null = null;
    listeners.fetch!({ request: { method: "GET", url, mode: "no-cors", ...over }, respondWith: (p: Promise<unknown>) => void (responded = p) });
    return responded;
  };
  return { listeners, store, shown, opened, self, fetchMock, fetchEvent };
}

describe("service worker del portal", () => {
  it("/entregas/api/* es network-only: ni se intercepta ni se cachea", async () => {
    const sw = boot();
    for (const p of ["/entregas/api/overview", "/entregas/api/push/history", "/entregas/api/auth/login"]) {
      expect(sw.fetchEvent(`https://x.test${p}`)).toBeNull();
      expect(sw.fetchEvent(`https://x.test${p}`, { mode: "navigate" })).toBeNull();
    }
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });
  it("el HTML autenticado nunca se cachea: la navegación va a la red y solo cae a la página offline genérica", async () => {
    const sw = boot();
    await (sw.listeners.install as never as (e: unknown) => void)({ waitUntil: (p: Promise<unknown>) => p });
    const res = (await sw.fetchEvent("https://x.test/entregas", { mode: "navigate" })) as unknown as { url: string };
    expect(res.url).toBe("https://x.test/entregas");
    for (const m of sw.store.values()) expect([...m.keys()].some((k) => k.endsWith("/entregas"))).toBe(false);
    sw.fetchMock.mockRejectedValueOnce(new Error("offline"));
    const off = (await sw.fetchEvent("https://x.test/entregas", { mode: "navigate" })) as unknown as { precached?: string };
    expect(off.precached).toBe("/entregas/offline.html");
  });
  it("solo cachea assets públicos estáticos del portal; ignora el resto", async () => {
    const sw = boot();
    expect(sw.fetchEvent("https://x.test/entregas/pwa/icon-192.png")).not.toBeNull();
    expect(sw.fetchEvent("https://x.test/_next/static/chunks/a.js")).not.toBeNull();
    expect(sw.fetchEvent("https://x.test/api/v1/pedidos")).toBeNull();
    expect(sw.fetchEvent("https://x.test/entregas/producto/abc")).toBeNull();
    expect(sw.fetchEvent("https://other.test/entregas/pwa/icon-192.png")).toBeNull();
    expect(sw.fetchEvent("https://x.test/entregas/pwa/icon-192.png", { method: "POST" })).toBeNull();
  });
  it("no guarda respuestas no-store/private", async () => {
    const sw = boot();
    sw.fetchMock.mockResolvedValueOnce({ ok: true, type: "basic", headers: new Headers({ "cache-control": "private, no-store" }), clone() { return this; } } as never);
    await sw.fetchEvent("https://x.test/entregas/pwa/icon-512.png");
    for (const m of sw.store.values()) expect(m.has("https://x.test/entregas/pwa/icon-512.png")).toBe(false);
  });
  it("activate borra caches viejas del portal y respeta las ajenas; CLEAR_CACHES vacía todo", async () => {
    const sw = boot();
    sw.store.set("genus-portal-static-0", new Map());
    sw.store.set("genus-os-static-abc", new Map());
    await (sw.listeners.activate as never as (e: unknown) => void)({ waitUntil: (p: Promise<unknown>) => p });
    expect(sw.store.has("genus-portal-static-0")).toBe(false);
    expect(sw.store.has("genus-os-static-abc")).toBe(true);
    await (sw.listeners.message as never as (e: unknown) => void)({ data: { type: "CLEAR_CACHES" }, waitUntil: (p: Promise<unknown>) => p });
    expect([...sw.store.keys()].filter((k) => k.startsWith("genus-portal-")).length).toBeLessThanOrEqual(1);
    expect(sw.store.has("genus-os-static-abc")).toBe(true);
  });
  it("no hace skipWaiting solo: solo con el mensaje del usuario", () => {
    const sw = boot();
    (sw.listeners.install as never as (e: unknown) => void)({ waitUntil: () => undefined });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    (sw.listeners.message as never as (e: unknown) => void)({ data: { type: "SKIP_WAITING" }, waitUntil: () => undefined });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it("push muestra siempre una notificación y notificationclick abre solo rutas del portal", async () => {
    const sw = boot();
    await (sw.listeners.push as never as (e: unknown) => void)({ data: { json: () => ({ title: "Hola", body: "Cuerpo", url: "/entregas#pedido-1", tag: "t" }) }, waitUntil: (p: Promise<unknown>) => p });
    expect(sw.shown[0]).toMatchObject({ title: "Hola", opts: { body: "Cuerpo", data: { url: "/entregas#pedido-1" } } });
    await (sw.listeners.push as never as (e: unknown) => void)({ data: { json: () => { throw new Error("bad"); } }, waitUntil: (p: Promise<unknown>) => p });
    expect(sw.shown[1]!.title).toContain("Portal de Clientes");
    const click = async (url: string) => (sw.listeners.notificationclick as never as (e: unknown) => Promise<void>)({ notification: { close: () => undefined, data: { url } }, waitUntil: (p: Promise<unknown>) => p });
    await click("/entregas#pedido-abc");
    await click("https://evil.test/entregas");
    await click("/mi-trabajo");
    expect(sw.opened).toEqual(["/entregas#pedido-abc", "/entregas", "/entregas"]);
  });
  it("push robusto: payload no JSON → texto; sin payload → mensaje por defecto; si showNotification con opciones falla reintenta lo mínimo; siempre dentro de waitUntil", async () => {
    const sw = boot();
    const waits: Promise<unknown>[] = [];
    const push = sw.listeners.push as never as (e: unknown) => void;
    push({ data: { json: () => { throw new Error("x"); }, text: () => "Texto plano" }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    push({ data: null, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    expect(waits).toHaveLength(2);
    await Promise.all(waits);
    expect(sw.shown[0]).toMatchObject({ opts: { body: "Texto plano", icon: "/entregas/pwa/icon-192.png", badge: "/entregas/pwa/badge-96.png" } });
    expect(sw.shown[1]!.opts.body).toContain("novedades");
    let calls = 0;
    sw.self.registration.showNotification = async (title: string, opts: Record<string, unknown>) => { calls++; if (calls === 1) throw new Error("opts"); sw.shown.push({ title, opts }); };
    const w3: Promise<unknown>[] = [];
    push({ data: { json: () => ({ title: "T" }) }, waitUntil: (p: Promise<unknown>) => w3.push(p) });
    await Promise.all(w3);
    expect(calls).toBe(2);
  });
  it("manda el ACUSE de recepción DESPUÉS de mostrar la notificación, sin romperla si falla", async () => {
    const sw = boot();
    const acks: Array<{ url: string; body: string }> = [];
    const f = vi.fn(async (url: string, init?: { body?: string }) => { acks.push({ url, body: String(init?.body) }); return { ok: true } as never; });
    const src = (await import("./sw-source")).portalServiceWorkerSource("t");
    const listeners: Record<string, (e: Record<string, unknown>) => void> = {};
    const order: string[] = [];
    const self = { location: { origin: "https://x.test" }, addEventListener: (t: string, l: never) => void (listeners[t] = l), registration: { showNotification: async () => void order.push("show"), pushManager: { getSubscription: async () => ({ endpoint: "https://push.test/e" }) } } };
    new Function("self", "caches", "fetch", "URL", "Response", "Headers", src)(self, {}, (u: string, i: { body?: string }) => { order.push("ack"); return f(u, i); }, URL, {}, Headers);
    const w: Promise<unknown>[] = [];
    listeners.push!({ data: { json: () => ({ title: "T", eventId: "e1", ack: { sid: "s1", token: "t1" } }) }, waitUntil: (p: Promise<unknown>) => w.push(p) });
    await Promise.all(w);
    expect(order).toEqual(["show", "ack"]);
    expect(acks[0]!.url).toBe("/entregas/api/push/ack");
    expect(JSON.parse(acks[0]!.body)).toEqual({ eventId: "e1", sid: "s1", token: "t1", endpoint: "https://push.test/e" });
    void sw;
  });
});
