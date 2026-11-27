// E2E del Portal de Clientes — PWA instalable + Web Push + modalidad piloto (Chromium real, build de producción, Postgres DESCARTABLE).
// Push SIEMPRE con stub del navegador (PushManager) y sin envío real (interruptor global apagado): no se envía nada a nadie.
// Ver run-portal-push-e2e-local.sh.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/portal-push-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const NAME_A = `E2E PP A ${RUN}`;
const NAME_B = `E2E PP B ${RUN}`;
const USER_A = `push.a-${RUN.toLowerCase()}`;
const USER_B = `push.b-${RUN.toLowerCase()}`;
const PASS = "Clave-Final-Push-2026";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const login = async (email) => {
  const c = await pwRequest.newContext({ baseURL: BASE });
  const r = await c.post("/api/v1/auth/login", { data: { email, password: E2E_PASSWORD } });
  if (r.status() !== 200) throw new Error(`login ${email}: ${await r.text()}`);
  return c;
};
const direccion = await login(E2E_USERS.direccion.email);
const produccion = await login(E2E_USERS.produccion.email);
const deposito = await login(E2E_USERS.deposito.email);
const post = (ctx, action, data) => ctx.post("/api/v1/portal-admin", { data: { action, ...data } });

// ───────── Preparación ─────────
const cA = await (await post(direccion, "create_client", { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [] })).json();
const cB = await (await post(direccion, "create_client", { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [] })).json();
const list = await (await direccion.get("/api/v1/portal-admin?view=clients")).json();
const idA = list.clients.find((c) => c.publicCode === cA.publicCode).id;
const idB = list.clients.find((c) => c.publicCode === cB.publicCode).id;
const mkUser = async (clientId, username) => {
  const r = await (await post(direccion, "create_user", { clientId, username, password: "Inicial-Temporal-9" })).json();
  return r;
};
const uA = await mkUser(idA, USER_A);
const uB = await mkUser(idB, USER_B);
const ped = async (op, producto, cliente, estado) => (await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,$2,$3,$4,'E2E','PRODUCCION') returning id::text as id", [op, producto, cliente, estado]))[0].id;
const OP_A = `OP-${RUN}-A`;
const OP_B = `OP-${RUN}-B`;
await ped(OP_A, "SHAMPOO PUSH", NAME_A, "INGRESO");
await ped(OP_B, "GEL PUSH B", NAME_B, "INGRESO");

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

// Stub de Push del navegador (sin servicio de push real): suscripción falsa persistente durante la página.
const PUSH_STUB = () => {
  // La suscripción falsa persiste entre recargas (como la del navegador real) usando sessionStorage.
  const KEY = "__e2ePushEndpoint";
  const build = (endpoint) => {
    const sub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }), unsubscribe: async () => { sessionStorage.removeItem(KEY); return true; } };
    return sub;
  };
  window.__pushStubCalls = 0;
  PushManager.prototype.subscribe = async function () {
    window.__pushStubCalls++;
    let ep = sessionStorage.getItem(KEY);
    if (!ep) { ep = `https://push.example.test/send/e2e-${Math.random().toString(36).slice(2)}-xxxxxxxxxxxxxxxxxxxx`; sessionStorage.setItem(KEY, ep); }
    return build(ep);
  };
  PushManager.prototype.getSubscription = async function () {
    const ep = sessionStorage.getItem(KEY);
    return ep ? build(ep) : null;
  };
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function portalSession(ctx, username, initial) {
  const l = await ctx.request.post("/entregas/api/auth/login", { data: { username, password: initial }, headers: { origin: BASE } });
  if (l.status() !== 200) throw new Error(`login portal ${username}: ${l.status()}`);
  const p = await ctx.request.post("/entregas/api/auth/password", { data: { current: initial, next: PASS }, headers: { origin: BASE } });
  if (p.status() !== 200) throw new Error(`cambio de clave: ${p.status()} ${await p.text()}`);
}

// ───────── 1. Manifest, íconos y service worker (cliente A, escritorio) ─────────
const ctxA = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, permissions: ["notifications"] });
await ctxA.addInitScript(PUSH_STUB);
await portalSession(ctxA, USER_A, "Inicial-Temporal-9");
const a = await ctxA.newPage();
await a.goto("/entregas");
await a.getByTestId("welcome").waitFor({ timeout: 30000 });
// ───────── 0. Aviso de activación al primer ingreso (aunque el piloto de envío todavía no esté habilitado) ─────────
await a.getByTestId("push-prompt").waitFor({ timeout: 30000 });
{
  const t = await a.getByTestId("push-prompt").innerText();
  check("primer ingreso: modal «¡Enterate del avance de tus pedidos!» con el texto acordado y los botones «Activar notificaciones» / «Ahora no»",
    t.includes("¡Enterate del avance de tus pedidos!") && t.includes("Activá las notificaciones para recibir novedades sobre tus productos, incluso cuando no estés utilizando la aplicación.") && /Activar notificaciones/.test(t) && /Ahora no/.test(t));
  check("el permiso nativo NO se pidió al mostrar el modal (solo tras el gesto)", (await a.evaluate(() => window.__pushStubCalls)) === 0);
  await a.screenshot({ path: `${OUT}/00-modal-activacion.png` });
  await a.getByTestId("push-prompt-later").click();
  check("«Ahora no» cierra el modal sin pedir permiso ni registrar nada", (await a.getByTestId("push-prompt").count()) === 0 && (await a.evaluate(() => window.__pushStubCalls)) === 0 && (await q("select count(*)::int as n from portal_push_subscriptions where client_id = $1::uuid", [idA]))[0].n === 0);
  await a.reload();
  await a.getByTestId("welcome").waitFor({ timeout: 30000 });
  await a.getByTestId("push-toggle").waitFor({ timeout: 30000 });
  check("tras «Ahora no» el modal no vuelve a molestar, y desde «Portal en tu celular» se puede activar (estado: Notificaciones desactivadas)", (await a.getByTestId("push-prompt").count()) === 0 && /Notificaciones desactivadas/.test(await a.getByTestId("push-state").innerText()));
}
const manifestHref = await a.locator('link[rel="manifest"]').first().getAttribute("href");
check("/entregas enlaza el manifest PROPIO del portal (no el de GENUS OS)", manifestHref === "/entregas/manifest.webmanifest" && (await a.locator('link[rel="manifest"]').count()) === 1, String(manifestHref));
const man = await (await ctxA.request.get("/entregas/manifest.webmanifest")).json();
check("manifest: nombre, short_name, standalone, scope y start_url limitados al portal, colores", man.name === "GENUS — Portal de Clientes" && Boolean(man.short_name) && man.display === "standalone" && man.scope === "/entregas" && man.start_url === "/entregas" && Boolean(man.theme_color) && Boolean(man.background_color), JSON.stringify({ n: man.name, s: man.short_name, sc: man.scope, st: man.start_url }));
check("manifest: íconos 192, 512 y maskable", ["192x192", "512x512"].every((s) => man.icons.some((i) => i.sizes === s && i.purpose === "any")) && man.icons.some((i) => i.purpose === "maskable"));
let iconsOk = true;
for (const i of man.icons) {
  const r = await ctxA.request.get(i.src);
  iconsOk &&= r.status() === 200 && (r.headers()["content-type"] ?? "").startsWith("image/png");
}
const apple = await a.locator('link[rel="apple-touch-icon"]').first().getAttribute("href");
check("íconos oficiales servidos como PNG y apple-touch-icon del portal", iconsOk && apple === "/entregas/pwa/apple-touch-icon.png" && (await ctxA.request.get(apple)).status() === 200, String(apple));
await a.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration("/entregas"))?.active), null, { timeout: 30000 });
const reg = await a.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration("/entregas");
  return { scope: r.scope, script: r.active.scriptURL, state: r.active.state };
});
check("service worker registrado con scope /entregas", reg.scope.endsWith("/entregas") && reg.script.endsWith("/entregas/sw.js"), JSON.stringify(reg));
const swRes = await ctxA.request.get("/entregas/sw.js");
check("el SW se sirve con Service-Worker-Allowed: /entregas y sin caché HTTP larga", swRes.headers()["service-worker-allowed"] === "/entregas" && /no-cache|no-store/.test(swRes.headers()["cache-control"] ?? ""));

// ───────── 2. El SW NO cachea /entregas/api ni HTML autenticado ─────────
await a.reload();
await a.getByTestId("welcome").waitFor();
await a.evaluate(async () => { await fetch("/entregas/api/overview", { credentials: "same-origin" }); await fetch("/entregas/api/push/history", { credentials: "same-origin" }); });
await a.waitForTimeout(800);
const cached = await a.evaluate(async () => {
  const out = [];
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push({ cache: k, url: new URL(r.url).pathname });
  return out;
});
check("caches del portal: solo assets públicos (nada de /entregas/api ni del HTML /entregas)", cached.length > 0 && cached.every((c) => c.cache.startsWith("genus-portal-")) && cached.every((c) => !c.url.startsWith("/entregas/api") && c.url !== "/entregas" && !c.url.startsWith("/entregas/producto")), cached.map((c) => c.url).join(", "));
check("la página offline genérica está precacheada (sin datos de clientes)", cached.some((c) => c.url === "/entregas/offline.html"));
const off = await (await ctxA.request.get("/entregas/offline.html")).text();
check("la página offline no contiene datos de ningún cliente", !off.includes(NAME_A) && !off.includes(NAME_B) && !off.includes(OP_A) && /Sin conexión/.test(off));

// ───────── 3. App interna: sin el manifest ni el SW del portal ─────────
const ctxOs = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const os = await ctxOs.newPage();
await os.goto("/login");
await os.waitForTimeout(1500);
const osManifest = await os.locator('link[rel="manifest"]').first().getAttribute("href");
const osRegs = await os.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
check("la app interna NO enlaza el manifest del portal y conserva el suyo", osManifest === "/manifest.webmanifest", String(osManifest));
check("la app interna NO registra el service worker del portal", osRegs.every((s) => !s.includes("/entregas")), osRegs.join(","));
await ctxOs.close();

// ───────── 4. Instrucciones iPhone / Android / botón Instalar ─────────
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
{
  const ctxI = await browser.newContext({ baseURL: BASE, userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctxI.addInitScript(() => { delete window.PushManager; });
  await portalSession(ctxI, USER_A, PASS).catch(async () => { await ctxI.request.post("/entregas/api/auth/login", { data: { username: USER_A, password: PASS }, headers: { origin: BASE } }); });
  const i = await ctxI.newPage();
  await i.goto("/entregas");
  await i.getByTestId("app-panel").waitFor({ timeout: 30000 });
  await i.getByTestId("push-prompt").waitFor({ timeout: 20000 });
  const pi = await i.getByTestId("push-prompt").innerText();
  check("iPhone sin app instalada: el modal explica Safari → Compartir → Agregar a pantalla de inicio (iOS 16.4) y NO ofrece pedir permiso", /Safari/.test(pi) && /Compartir/.test(pi) && /Agregar a pantalla de inicio/.test(pi) && /16\.4/.test(pi) && (await i.getByTestId("push-prompt-activate").count()) === 0);
  await i.getByTestId("push-prompt-later").click();
  check("iPhone: estado «Instalación requerida»", /Instalación requerida/.test(await i.getByTestId("push-state").innerText()));
  await i.getByTestId("install-help-toggle").click();
  const t = await i.getByTestId("install-ios").innerText();
  check("iPhone: instrucciones Safari → Compartir → Agregar a pantalla de inicio, push solo desde la app instalada, iOS 16.4", /Safari/.test(t) && /Compartir/.test(t) && /Agregar a pantalla de inicio/.test(t) && /solo funcionan desde la app instalada/.test(t) && /16\.4/.test(t));
  check("iPhone en Safari (sin app instalada): el aviso de notificaciones explica que hay que instalarla", /solo funcionan desde la app instalada/.test(await i.getByTestId("push-msg").innerText()) && (await i.getByTestId("push-toggle").count()) === 0);
  check("iPhone: sin desborde horizontal", await noOverflow(i));
  await i.screenshot({ path: `${OUT}/01-iphone-instrucciones.png`, fullPage: true });
  await ctxI.close();

  const ctxD = await browser.newContext({ baseURL: BASE, userAgent: ANDROID, viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await ctxD.request.post("/entregas/api/auth/login", { data: { username: USER_A, password: PASS }, headers: { origin: BASE } });
  const d = await ctxD.newPage();
  await d.goto("/entregas");
  await d.getByTestId("app-panel").waitFor({ timeout: 30000 });
  await d.getByTestId("push-prompt").waitFor({ timeout: 20000 }).then(() => d.getByTestId("push-prompt-later").click(), () => undefined);
  check("Android: sin evento de instalación no se muestra el botón «Instalar app»", (await d.getByTestId("install-btn").count()) === 0);
  await d.evaluate(() => {
    const ev = new Event("beforeinstallprompt", { cancelable: true });
    ev.prompt = async () => { window.__installPrompted = true; };
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(ev);
  });
  await d.getByTestId("install-btn").waitFor({ timeout: 5000 });
  await d.getByTestId("install-btn").click();
  check("Android: con beforeinstallprompt aparece «Instalar app» y dispara la instalación", (await d.evaluate(() => window.__installPrompted === true)) && (await d.getByTestId("install-btn").count()) === 0);
  await d.getByTestId("install-help-toggle").click();
  check("Android: instrucciones de instalación visibles", /Instalar/.test(await d.getByTestId("install-android").innerText()) && (await d.getByTestId("install-ios").count()) === 0);
  check("Android: sin desborde horizontal", await noOverflow(d));
  await d.screenshot({ path: `${OUT}/02-android.png`, fullPage: true });
  await ctxD.close();
}

// ───────── 5. Notificaciones: piloto, activar/desactivar con push stub ─────────
await a.reload();
await a.getByTestId("app-panel").waitFor();
await a.getByTestId("push-toggle").waitFor({ timeout: 20000 });
check("sin piloto de envío: el dispositivo igual se puede registrar (el piloto solo decide el ENVÍO); estado «desactivadas», permiso solo tras el clic", (await a.getByTestId("push-toggle").getAttribute("data-state")) === "off" && (await a.evaluate(() => window.__pushStubCalls)) === 0 && /Notificaciones desactivadas/.test(await a.getByTestId("push-state").innerText()));
// Permisos: Producción NO puede tocar el piloto (backend); Dirección sí y el baseline queda sin envíos.
const denied = await post(deposito, "push_pilot", { clientId: idA, enabled: true });
check("Un sector ajeno (Depósito) NO puede habilitar el piloto ni ver el panel push (403)", denied.status() === 403 && (await deposito.get("/api/v1/portal-admin?view=push")).status() === 403 && (await post(deposito, "push_settings", { globalSendEnabled: true })).status() === 403);
const on = await post(direccion, "push_pilot", { clientId: idA, enabled: true });
const onJ = await on.json();
check("Dirección habilita el piloto del cliente A: baseline sin enviar nada", on.status() === 200 && onJ.enabled === true && (await q("select count(*)::int as n from portal_push_outbox where client_id = $1::uuid", [idA]))[0].n === 0 && (await q("select count(*)::int as n from portal_push_order_state where client_id = $1::uuid", [idA]))[0].n >= 1, JSON.stringify(onJ));
await a.reload();
await a.getByTestId("push-toggle").waitFor({ timeout: 20000 });
await a.getByTestId("push-toggle").click();
await a.getByTestId("push-feedback").waitFor();
await a.waitForFunction(() => document.querySelector('[data-testid="push-toggle"]')?.getAttribute("data-state") === "on");
const rows = await q("select endpoint, owner_key, client_id::text as c from portal_push_subscriptions where client_id = $1::uuid", [idA]);
check("activar: la suscripción queda en PostgreSQL (por usuario y cliente) y SOLO entonces se muestra «Notificaciones activadas»", rows.length === 1 && rows[0].owner_key === `u:${uA.id}` && (await a.evaluate(() => window.__pushStubCalls)) === 1 && /Notificaciones activadas/.test(await a.getByTestId("push-state").innerText()), JSON.stringify(rows.map((r) => r.owner_key)));
await a.screenshot({ path: `${OUT}/03-push-activado.png`, fullPage: true });
await a.getByTestId("push-toggle").click();
await a.waitForFunction(() => document.querySelector('[data-testid="push-toggle"]')?.getAttribute("data-state") === "off");
check("desactivar: se elimina la suscripción del dispositivo", (await q("select count(*)::int as n from portal_push_subscriptions where client_id = $1::uuid", [idA]))[0].n === 0);
await a.getByTestId("push-toggle").click(); // lo deja activado para el paso de logout
await a.waitForFunction(() => document.querySelector('[data-testid="push-toggle"]')?.getAttribute("data-state") === "on");
// Servidor que rechaza la suscripción → «Error de suscripción» y NUNCA «activadas».
{
  const ctxE = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, permissions: ["notifications"] });
  await ctxE.addInitScript(PUSH_STUB);
  await ctxE.request.post("/entregas/api/auth/login", { data: { username: USER_A, password: PASS }, headers: { origin: BASE } });
  const e = await ctxE.newPage();
  await e.route("**/entregas/api/push/subscribe", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falla simulada" }) }));
  await e.goto("/entregas");
  await e.getByTestId("push-prompt").waitFor({ timeout: 30000 });
  await e.getByTestId("push-prompt-activate").click();
  await e.getByTestId("push-prompt-error").waitFor({ timeout: 20000 });
  await e.getByTestId("push-prompt-later").click();
  check("si el servidor no confirma el registro NO se muestra «activadas»: queda «Error de suscripción»", /Error de suscripción/.test(await e.getByTestId("push-state").innerText()) && (await e.getByTestId("push-toggle").getAttribute("data-state")) === "off");
  await ctxE.close();
}

// ───────── 6. Historial leídas / no leídas + abrir el pedido ─────────
const ov = await (await ctxA.request.get("/entregas/api/overview")).json();
const orderOpaque = ov.orders.find((o) => o.orderRef === OP_A).id;
const insHist = (clientId, ref, opaque, type, title, body) => q(
  "insert into portal_push_outbox (client_id, order_key, order_ref, order_opaque_id, event_type, title, body, url, status, mode, processed_at) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'ENVIADA', 'REAL', now()) returning id::text as id",
  [clientId, `op:${ref.toLowerCase()}:${type}`, ref, opaque, type, title, body, `/entregas#pedido-${opaque}`]);
const h1 = (await insHist(idA, OP_A, orderOpaque, "RECIBIDO", "¡Recibimos tu pedido!", `Tu pedido fue registrado correctamente.\nPedido ${OP_A}`))[0].id;
await insHist(idA, `${OP_A}-X`, orderOpaque, "ELABORACION", "¡Tu pedido se está elaborando!", `Comenzamos la elaboración.\nPedido ${OP_A}`);
await insHist(idB, OP_B, "otroOpaco", "RECIBIDO", "¡Recibimos tu pedido!", `Aviso exclusivo de B.\nPedido ${OP_B}`);
await a.reload();
await a.getByTestId("bell-count").waitFor({ timeout: 20000 });
check("campana: 2 avisos sin leer del cliente A", (await a.getByTestId("bell-count").innerText()) === "2");
await a.getByTestId("bell").click();
const items = a.getByTestId("push-item");
check("lista del historial con no leídas marcadas y SIN avisos del cliente B", (await items.count()) === 2 && (await items.evaluateAll((els) => els.every((e) => e.getAttribute("data-read") === "0"))) && !(await a.locator("body").innerText()).includes(OP_B));
await a.screenshot({ path: `${OUT}/04-campana.png` });
await items.filter({ hasText: "Recibimos tu pedido" }).locator("a").click();
await a.waitForFunction((id) => location.hash === `#pedido-${id}`, orderOpaque);
check("al tocar un aviso se abre el pedido correspondiente (#pedido-…) y queda resaltado", (await a.locator(`#pedido-${orderOpaque}`).count()) === 1 && (await a.evaluate((id) => document.getElementById(`pedido-${id}`)?.classList.contains("gp-order-focus"), orderOpaque)));
check("el aviso tocado queda leído en el servidor (por usuario)", (await q("select count(*)::int as n from portal_push_reads where outbox_id = $1::uuid", [h1]))[0].n === 1 && (await a.getByTestId("bell-count").innerText()) === "1");
await a.getByTestId("bell").click();
await a.getByTestId("push-read-all").click();
await a.waitForFunction(() => document.querySelectorAll('[data-testid="bell-count"]').length === 0);
check("«Marcar todas como leídas» deja la campana en cero", (await a.getByTestId("push-item").evaluateAll((els) => els.every((e) => e.getAttribute("data-read") === "1"))) && (await q("select count(*)::int as n from portal_push_reads where owner_key = $1", [`u:${uA.id}`]))[0].n === 2);

// ───────── 7. Cron protegido por secreto; interruptor apagado = simulado ─────────
const anon = await pwRequest.newContext({ baseURL: BASE });
check("cron del worker: sin secreto 401; con secreto incorrecto 401", (await anon.get("/api/cron/portal-push")).status() === 401 && (await anon.get("/api/cron/portal-push", { headers: { authorization: "Bearer nope" } })).status() === 401);
await ped(`OP-${RUN}-A2`, "CREMA NUEVA", NAME_A, "INGRESO");
const run1 = await (await anon.get("/api/cron/portal-push", { headers: { authorization: "Bearer e2e-cron-secret" } })).json();
const run2 = await (await anon.get("/api/cron/portal-push", { headers: { authorization: "Bearer e2e-cron-secret" } })).json();
check("worker con el envío real APAGADO: detecta, registra «simulada» y NO envía; repetirlo no duplica", run1.ok && run1.push.globalSendEnabled === false && run1.push.simuladas === 1 && run1.push.enviadas === 0 && run2.push.detected === 0 && (await q("select status, mode from portal_push_outbox where order_ref = $1", [`OP-${RUN}-A2`])).length === 1, JSON.stringify(run1.push));
await a.reload();
await a.getByTestId("welcome").waitFor();
check("el cliente NO ve en su historial los eventos simulados", (await a.getByTestId("bell-count").count()) === 0 && !(await a.locator("body").innerText()).includes("Recibimos tu pedido!") === true);

// ───────── 8. Panel de Dirección en GENUS OS ─────────
{
  const octx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const p = await octx.newPage();
  await p.goto("/login");
  await p.locator('input[type="email"]').fill(E2E_USERS.direccion.email);
  await p.locator('input[type="password"]').fill(E2E_PASSWORD);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await p.getByText("Portal de Clientes").first().click();
  await p.getByTestId("portal-tab-push").click();
  await p.getByTestId("portal-push-admin").waitFor({ timeout: 30000 });
  check("GENUS OS: Dirección ve el panel con envío real APAGADO por defecto, plazos 8/3 e indicadores", /APAGADO/.test(await p.getByTestId("push-global-state").innerText()) && (await p.getByTestId("push-days-elab").inputValue()) === "8" && (await p.getByTestId("push-days-env").inputValue()) === "3" && (await p.getByTestId("q-sim").innerText()) !== "");
  const rowA = p.getByTestId("push-client-row").filter({ hasText: `Cliente A ${RUN}` });
  const rowB = p.getByTestId("push-client-row").filter({ hasText: `Cliente B ${RUN}` });
  check("el panel lista los clientes con acceso: A habilitado, B no", (await rowA.getByTestId("push-pilot-toggle").isChecked()) && !(await rowB.getByTestId("push-pilot-toggle").isChecked()));
  await rowB.getByTestId("push-pilot-toggle").click();
  await p.waitForFunction(() => /Piloto habilitado/.test(document.body.innerText));
  check("habilitar el piloto de B desde el panel hace el baseline sin enviar", (await q("select count(*)::int as n from portal_push_order_state where client_id = $1::uuid", [idB]))[0].n >= 1 && (await q("select count(*)::int as n from portal_push_outbox where client_id = $1::uuid and status <> 'ENVIADA'", [idB]))[0].n === 0);
  await p.getByTestId("push-days-elab").fill("10");
  await p.getByTestId("push-days-save").click();
  await p.waitForFunction(() => /Plazos guardados/.test(document.body.innerText));
  check("Dirección edita los plazos (estimaciones en días hábiles)", (await q("select elaboracion_days, envasado_days from portal_push_settings where id = 1"))[0].elaboracion_days === 10, JSON.stringify(await q("select elaboracion_days, envasado_days from portal_push_settings where id = 1")));
  await p.getByTestId("push-days-elab").fill("8");
  await p.getByTestId("push-days-save").click();
  // Notificación de prueba: botón solo para clientes habilitados; B (habilitado recién) no tiene dispositivos; A sí. Push real siempre apagado.
  await p.waitForFunction(() => /Plazos guardados/.test(document.body.innerText));
  p.on("dialog", (d) => void d.accept());
  const globalBefore = (await q("select global_send_enabled from portal_push_settings where id = 1"))[0].global_send_enabled;
  const workBefore = (await q("select count(*)::int as n from work_items"))[0].n;
  const orderStateBefore = (await q("select count(*)::int as n from portal_push_order_state"))[0].n;
  const outboxBefore = (await q("select count(*)::int as n from portal_push_outbox where event_type <> 'prueba'"))[0].n;
  check("el botón «Enviar notificación de prueba» aparece solo en clientes habilitados en el piloto", (await rowA.getByTestId("push-test-send").count()) === 1 && (await rowB.getByTestId("push-test-send").count()) === 1);
  await rowB.getByTestId("push-test-send").click();
  await p.waitForFunction(() => /no tiene dispositivos suscriptos/.test(document.body.innerText));
  check("cliente habilitado SIN dispositivos: rechazo con mensaje claro y nada enviado ni registrado", (await q("select count(*)::int as n from portal_push_outbox where client_id = $1::uuid and event_type = 'prueba'", [idB]))[0].n === 0);
  await rowA.getByTestId("push-test-send").click();
  await p.waitForFunction(() => /Notificación de prueba para .*aceptada por el servicio push en \d+ de \d+ dispositivo/.test(document.body.innerText));
  check("la prueba responde con cantidad de dispositivos enviados/fallidos y se audita con el usuario de Dirección", (await q("select count(*)::int as n from portal_audit_events where client_id = $1::uuid and event_type = 'PUSH_PRUEBA_ENVIADA' and actor = $2", [idA, E2E_USERS.direccion.email]))[0].n === 1);
  await rowA.getByTestId("push-test-send").click();
  await p.waitForFunction(() => /hace instantes/.test(document.body.innerText));
  check("doble clic: la segunda prueba dentro de 30 s se rechaza y no se vuelve a auditar", (await q("select count(*)::int as n from portal_audit_events where client_id = $1::uuid and event_type = 'PUSH_PRUEBA_ENVIADA'", [idA]))[0].n === 1);
  check("la prueba no cambió el interruptor global ni work_items, estado de pedidos ni outbox de pedidos", (await q("select global_send_enabled from portal_push_settings where id = 1"))[0].global_send_enabled === globalBefore
    && (await q("select count(*)::int as n from work_items"))[0].n === workBefore
    && (await q("select count(*)::int as n from portal_push_order_state"))[0].n === orderStateBefore
    && (await q("select count(*)::int as n from portal_push_outbox where event_type <> 'prueba'"))[0].n === outboxBefore);
  check("Depósito NO puede enviar la prueba (403)", (await post(deposito, "push_test", { clientId: idA })).status() === 403);
  await p.screenshot({ path: `${OUT}/05-panel-direccion.png`, fullPage: true });
  await octx.close();
}

// ───────── 9. Aislamiento entre dos clientes (navegador) ─────────
const ctxB = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, permissions: ["notifications"] });
await ctxB.addInitScript(PUSH_STUB);
await portalSession(ctxB, USER_B, "Inicial-Temporal-9");
const b = await ctxB.newPage();
await b.goto("/entregas");
await b.getByTestId("bell-count").waitFor({ timeout: 20000 });
// Primer ingreso de este dispositivo: el aviso de activación aparece por diseño; se descarta para seguir.
await b.getByTestId("push-prompt").waitFor({ timeout: 20000 });
await b.getByTestId("push-prompt-later").click();
await b.getByTestId("bell").click();
const bodyB = await b.locator("body").innerText();
check("cliente B: ve SOLO su aviso y su pedido (nada de A)", /Aviso exclusivo de B/.test(bodyB) && !bodyB.includes(OP_A) && !bodyB.includes("SHAMPOO PUSH"));
const histB = await (await ctxB.request.get("/entregas/api/push/history")).json();
check("API historial de B: solo avisos de B", histB.items.length === 1 && JSON.stringify(histB).includes(OP_B) && !JSON.stringify(histB).includes(OP_A));
const markForeign = await ctxB.request.post("/entregas/api/push/read", { data: { ids: [h1] }, headers: { origin: BASE } });
check("B no puede marcar avisos de A como leídos", (await markForeign.json()).marked === 0);
check("la API de push exige sesión del portal y mismo origen", (await anon.get("/entregas/api/push/history")).status() === 401 && (await ctxB.request.post("/entregas/api/push/subscribe", { data: {}, headers: { origin: "https://evil.test" } })).status() === 403);
await ctxB.close();

// ───────── 10. Cerrar sesión: sin dispositivo suscripto ni caché privada ─────────
await a.getByTestId("logout").click();
await a.getByTestId("form-usuario").waitFor({ timeout: 20000 });
await a.waitForTimeout(500);
const afterLogout = await a.evaluate(async () => {
  const out = [];
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
  return out;
});
check("al cerrar sesión el dispositivo deja de estar suscripto a los avisos de ese usuario", (await q("select count(*)::int as n from portal_push_subscriptions where owner_key = $1", [`u:${uA.id}`]))[0].n === 0);
check("al cerrar sesión no queda nada privado en caché", afterLogout.every((u) => u.startsWith("/entregas/pwa/") || u === "/entregas/offline.html" || u === "/entregas/logo-genus.png" || u.startsWith("/_next/static/")), afterLogout.join(", "));

// Dirección puede dejar el piloto apagado de nuevo.
await post(direccion, "push_pilot", { clientId: idA, enabled: false });
await post(direccion, "push_pilot", { clientId: idB, enabled: false });
await browser.close();
await pool.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
