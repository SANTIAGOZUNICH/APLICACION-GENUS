// E2E del Portal de Clientes — NOTIFICACIONES de punta a punta con SERVICE WORKER REAL (Chromium, build de producción, Postgres DESCARTABLE).
// Ver run-portal-notificaciones-e2e-local.sh. Cadena verificada en CADA transición:
//   endpoint REAL del sector → PostgreSQL (tablas fuente) → API del portal → portal ABIERTO sin recargar → evento (outbox) → worker (disparo inmediato,
//   sin cron) → Web Push firmado VAPID/aes128gcm → push service HTTPS local (valida y descifra) → SERVICE WORKER REAL (CDP deliverPushMessage) →
//   showNotification → acuse del SW al servidor → «recepción comprobada» en la base y en el panel de Dirección.
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/portal-notificaciones-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const NAME = `GENUS TEST ${RUN}`;
const NAME_B = `OTRO CLIENTE ${RUN}`;
const USER = `gt-${RUN.toLowerCase()}`;
const USER_B = `ot-${RUN.toLowerCase()}`;
const TEMP = "Inicial-Temporal-9";
const PASS = "Clave-Final-Notif-2026";
const OP = `OP-NT-${RUN}`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const b64u = (b) => b.toString("base64url");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const VAPID_PUBLIC = process.env.GENUS_E2E_VAPID_PUBLIC_KEY;

// ───────── Push service local: HTTPS, valida VAPID, descifra aes128gcm y REENVÍA el mensaje al service worker real ─────────
const CERT_DIR = path.resolve(process.cwd(), ".e2e-local/certs");
const device = { ecdh: createECDH("prime256v1"), auth: randomBytes(16) };
device.ecdh.generateKeys();
const received = [];
let forward = async () => {};
const pushServer = https.createServer({ key: readFileSync(path.join(CERT_DIR, "key.pem")), cert: readFileSync(path.join(CERT_DIR, "cert.pem")) }, (req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const entry = { path: req.url ?? "", vapidOk: false, message: null };
    try {
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(req.headers.authorization ?? ""));
      if (m) {
        const [h, p, sig] = m[1].split(".");
        const pub = Buffer.from(m[2], "base64url");
        const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
        entry.vapidOk = m[2] === VAPID_PUBLIC && verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
      }
      const body = Buffer.concat(chunks);
      if (req.url?.endsWith("/dev1") && body.length > 86) {
        const salt = body.subarray(0, 16);
        const idlen = body[20];
        const asPub = body.subarray(21, 21 + idlen);
        const cipher = body.subarray(21 + idlen);
        const secret = device.ecdh.computeSecret(asPub);
        const prk = Buffer.from(hkdfSync("sha256", secret, device.auth, Buffer.concat([Buffer.from("WebPush: info\0"), device.ecdh.getPublicKey(), asPub]), 32));
        const cek = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
        const nonce = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
        const d = createDecipheriv("aes-128-gcm", cek, nonce);
        d.setAuthTag(cipher.subarray(cipher.length - 16));
        const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
        let end = plain.length - 1;
        while (end >= 0 && plain[end] === 0) end--;
        entry.plain = plain.subarray(0, end).toString("utf8");
        entry.message = JSON.parse(entry.plain);
      }
    } catch (e) {
      entry.error = String(e);
    }
    received.push(entry);
    res.writeHead(201).end();
    // El «celular» recibe el push: se lo entrega al service worker REAL (misma carga útil descifrada).
    if (entry.message) void forward(entry.plain).catch((e) => console.error("forward", e));
  });
});
await new Promise((r) => pushServer.listen(0, "127.0.0.1", r));
const PUSH_URL = `https://localhost:${pushServer.address().port}`;

const apiCtx = async (user) => {
  const c = await pwRequest.newContext({ baseURL: BASE });
  const r = await c.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } });
  if (r.status() !== 200) throw new Error(`login ${user.email}: ${await r.text()}`);
  return c;
};
const must = async (res, what) => {
  if (res.status() >= 300) throw new Error(`${what}: ${res.status()} ${await res.text()}`);
  return res.json();
};
const mondayOf = (d) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
try {
  const dir = await apiCtx(E2E_USERS.direccion);
  const produccion = await apiCtx(E2E_USERS.produccion);
  const elabApi = await apiCtx(E2E_USERS.elaboracion);
  const envApi = await apiCtx(E2E_USERS.envasado);
  const admin = (action, data) => dir.post("/api/v1/portal-admin", { data: { action, ...data } });

  // ───────── Preparación: clientes, accesos, piloto + ENVÍO REAL solo para el de prueba (global APAGADO) ─────────
  const mk = async (name, user) => {
    const r = await must(await admin("create_client", { displayName: name, aliases: [name], emails: [] }), "crear cliente");
    const id = (await q("select id::text as id from portal_clients where public_code = $1", [r.publicCode]))[0].id;
    await must(await admin("create_user", { clientId: id, username: user, password: TEMP }), "crear usuario");
    return id;
  };
  const idA = await mk(NAME, USER);
  const idB = await mk(NAME_B, USER_B);
  await must(await admin("push_pilot", { clientId: idA, enabled: true }), "piloto A");
  await must(await admin("push_pilot", { clientId: idB, enabled: true }), "piloto B");
  check("envío real por cliente: sin confirmación explícita se rechaza (400)", (await admin("push_real_send", { clientId: idA, enabled: true })).status() === 400);
  check("Producción no puede habilitar el envío real (403)", (await produccion.post("/api/v1/portal-admin", { data: { action: "push_real_send", clientId: idA, enabled: true, confirm: true } })).status() === 403);
  await must(await admin("push_real_send", { clientId: idA, enabled: true, confirm: true }), "envío real A");
  check("«Envío REAL a este cliente (prueba)» habilitado SOLO para el cliente de prueba; el interruptor global sigue APAGADO", (await q("select global_send_enabled from portal_push_settings where id = 1"))[0]?.global_send_enabled !== true && (await q("select client_id::text as id, real_send_enabled as r from portal_push_client_pilot where client_id = any($1::uuid[]) order by r desc", [[idA, idB]])).map((r) => `${r.id === idA}:${r.r}`).join() === "true:true,false:false");

  // ───────── El cliente entra al portal (queda ABIERTO), con permiso de notificaciones y service worker real ─────────
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, permissions: ["notifications"] });
  const portal = await ctx.newPage();
  await portal.goto("/entregas");
  await portal.getByLabel("Usuario").fill(USER);
  await portal.getByLabel("Contraseña").fill(TEMP);
  await portal.getByRole("button", { name: "Ingresar" }).click();
  await portal.getByTestId("change-password").waitFor({ timeout: 30_000 });
  await portal.getByLabel("Contraseña actual (temporal)").fill(TEMP);
  await portal.getByLabel("Contraseña nueva", { exact: true }).fill(PASS);
  await portal.getByLabel("Repetí la contraseña nueva").fill(PASS);
  await portal.getByRole("button", { name: "Guardar y continuar" }).click();
  await portal.getByTestId("welcome").waitFor({ timeout: 30_000 });
  await portal.evaluate(() => { window.__marker = "vivo"; });
  await portal.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration("/entregas"))?.active), null, { timeout: 30_000 });

  // CDP: registro del service worker REAL para entregarle los push.
  const cdp = await ctx.newCDPSession(portal);
  let registrationId = null;
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
    const r = e.registrations.find((x) => x.scopeURL.endsWith("/entregas") || x.scopeURL.endsWith("/entregas/"));
    if (r) registrationId = r.registrationId;
  });
  await cdp.send("ServiceWorker.enable");
  for (let i = 0; i < 50 && !registrationId; i++) await sleep(200);
  check("service worker REAL del portal activo y registrado (scope /entregas)", Boolean(registrationId));
  forward = async (plain) => cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(BASE).origin, registrationId, data: plain });

  // Suscripción: el navegador headless no tiene FCM; el dispositivo se registra con las claves del «push service» local por la API REAL de suscripción.
  const cfg = await (await ctx.request.get("/entregas/api/push/config")).json();
  check("el servidor ofrece la clave VAPID pública del entorno", cfg.available === true && cfg.publicKey === VAPID_PUBLIC);
  const sub = { endpoint: `${PUSH_URL}/push/dev1`, keys: { p256dh: b64u(device.ecdh.getPublicKey()), auth: b64u(device.auth) } };
  const reg = await ctx.request.post("/entregas/api/push/subscribe", { data: { subscription: sub, applicationServerKey: cfg.publicKey }, headers: { origin: BASE } });
  check("el dispositivo queda registrado en PostgreSQL (suscripción válida)", reg.status() === 200 && (await q("select count(*)::int as n from portal_push_subscriptions where client_id = $1::uuid and invalid_reason is null", [idA]))[0].n === 1);
  const stale = await ctx.request.post("/entregas/api/push/subscribe", { data: { subscription: { ...sub, endpoint: `${PUSH_URL}/push/old` }, applicationServerKey: "B".repeat(87) }, headers: { origin: BASE } });
  check("una suscripción creada con OTRA clave VAPID se rechaza (409) para que el dispositivo se vuelva a suscribir", stale.status() === 409);

  // ───────── Utilidades por transición ─────────
  const notifications = () => portal.evaluate(async () => (await (await navigator.serviceWorker.getRegistration("/entregas")).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url })));
  const events = () => q("select event_type, status, mode from portal_push_outbox where client_id = $1::uuid and order_ref = $2 and event_type <> 'prueba' order by created_at", [idA, OP]);
  const apiStatus = async () => {
    const j = await (await ctx.request.get("/entregas/api/overview")).json();
    return j.orders.find((o) => o.orderRef === OP)?.status.label ?? null;
  };
  const orderEl = () => portal.getByTestId("order").filter({ hasText: `Pedido ${OP}` });
  const waitPush = async (n, label) => {
    for (let i = 0; i < 100; i++) {
      if (received.filter((r) => r.message).length >= n) break;
      await sleep(200);
    }
    return received.filter((r) => r.message).length >= n;
  };
  /** Verifica toda la cadena tras una acción REAL (sin cron: el disparo inmediato tiene que hacerlo solo). */
  async function step(label, expect) {
    const gotPush = expect.push ? await waitPush(expect.pushCount, label) : true;
    await portal.getByTestId("order").filter({ hasText: `Pedido ${OP}` }).getByTestId("order-status").filter({ hasText: expect.portal }).waitFor({ timeout: 30_000 });
    check(`${label} · portal ABIERTO sin recargar muestra «${expect.portal}»`, (await portal.evaluate(() => window.__marker)) === "vivo" && (await portal.evaluate(() => performance.getEntriesByType("navigation").length)) === 1);
    check(`${label} · API del portal = «${expect.portal}»`, (await apiStatus()) === expect.portal);
    const src = await q("select p.estado, w.sector::text as sector, w.operational_status as st from production_pedidos p left join work_items w on w.production_pedido_id = p.id where p.op = $1 order by w.sector", [OP]);
    check(`${label} · tablas fuente PostgreSQL`, expect.dbPedido === undefined || src.some((r) => (r.estado ?? "∅") === expect.dbPedido), JSON.stringify(src));
    const ev = (await events()).map((e) => e.event_type).join(",");
    check(`${label} · eventos generados = ${expect.events}`, ev === expect.events, ev);
    if (expect.push) {
      check(`${label} · push entregado al dispositivo (descifrado, VAPID válido, sin pasar por el cron)`, gotPush && received.at(-1).vapidOk && received.at(-1).message.title === expect.push.title && received.at(-1).message.body === expect.push.body, received.at(-1)?.message?.title);
      // service worker real: notificación MOSTRADA + acuse
      let shown = [];
      for (let i = 0; i < 50; i++) {
        shown = await notifications();
        if (shown.some((n) => n.title === expect.push.title)) break;
        await sleep(200);
      }
      const n = shown.find((x) => x.title === expect.push.title);
      check(`${label} · el service worker REAL mostró la notificación nativa «${expect.push.title}»`, Boolean(n) && n.body === expect.push.body && /\/entregas#pedido-/.test(n.url ?? ""), JSON.stringify(n));
      let acked = false;
      for (let i = 0; i < 50 && !acked; i++) {
        acked = (await q("select count(*)::int as n from portal_push_deliveries where outbox_id = $1::uuid and acked_at is not null", [received.at(-1).message.eventId]))[0].n === 1;
        if (!acked) await sleep(200);
      }
      check(`${label} · acuse del SW: «recepción comprobada en el dispositivo» registrada`, acked);
    }
  }

  const today = new Date();
  const weekStart = mondayOf(today);
  let weekId = (await (await produccion.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()).weeks?.[0]?.id;
  if (!weekId) weekId = (await (await produccion.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E notificaciones" } })).json()).week.id;
  const plannedDate = today.getUTCDay() === 0 || today.getUTCDay() === 6 ? weekStart : today.toISOString().slice(0, 10);

  // ───────── 1. Producción carga el pedido (endpoint real) ─────────
  const ped = await must(await produccion.post("/api/v1/production-pedidos", { data: { op: OP, cliente: NAME, producto: "SHAMPOO NT", q: 400, portalClientId: idA } }), "crear pedido");
  await step("1 Pedido cargado", { portal: "Pedido recibido", events: "RECIBIDO", dbPedido: "∅", push: { title: "¡Recibimos tu pedido!", body: "Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance." }, pushCount: 1 });

  // ───────── 2. Producción asigna a Elaboración ─────────
  const asg = await must(await produccion.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: NAME, product: "SHAMPOO NT", plannedQuantity: "400", unit: "un", plannedDate, branchOwner: "Cristian", productionPedidoId: ped.item.id, idempotencyKey: `e2e-nt-assign-${RUN}` } }), "asignar");
  const workId = asg.item?.id ?? asg.workItem?.id;
  await step("2 Asignado a Elaboración", { portal: "En elaboración", events: "RECIBIDO,ELABORACION", dbPedido: "EN_ELABORACION", push: { title: "¡Tu pedido se está elaborando!", body: "Estimamos que estará listo para entregar en aproximadamente 8 días hábiles." }, pushCount: 2 });

  // ───────── 3. Elaboración → Envasado ─────────
  const toEnv = await must(await elabApi.post(`/api/v1/work-items/${workId}/envasado`, { data: { destination: "ENVASADO_MASIVO", producedQuantity: "400", idempotencyKey: `e2e-nt-env-${RUN}-00001` } }), "enviar a Envasado");
  const destId = String(toEnv.destinationWorkItem.id).replace(/^native:/, "");
  await step("3 Elaboración → Envasado", { portal: "En envasado", events: "RECIBIDO,ELABORACION,ENVASADO", dbPedido: "EN_ENVASADO", push: { title: "¡Tu pedido está en envasado!", body: "Estimamos que estará listo para entregar en aproximadamente 3 días hábiles." }, pushCount: 3 });

  // ───────── 4. Envasado finaliza («Entregar a Calidad»/finalizar) y marca «Listo para entregar» ─────────
  await must(await envApi.post("/api/v1/live-sync/operations", { data: { action: "complete_work", item: { id: `native:${destId}` }, finishedQty: "400", observation: "ok", actorSectorId: "ENVASADO_MASIVO" } }), "finalizar envasado");
  await sleep(1500);
  check("4a Envasado finaliza sin marcar listo: el portal sigue «En envasado» y NO hay push de listo", (await apiStatus()) === "En envasado" && received.filter((r) => r.message).length === 3);
  await must(await envApi.post("/api/v1/disponibilidad", { data: { action: "mark", workItemId: destId, idempotencyKey: `e2e-nt-mark-${RUN}` } }), "marcar listo");
  await step("4b «Marcar listo para entregar»", { portal: "Listo para entregar", events: "RECIBIDO,ELABORACION,ENVASADO,LISTO", push: { title: "¡TU PEDIDO ESTÁ LISTO! 🎉", body: "Finalizamos la producción de tu pedido. Ya podemos coordinar su entrega." }, pushCount: 4 });

  // ───────── 5. Entrega PARCIAL y TOTAL (Depósito/Entregas, endpoint real «deliver_work») ─────────
  const deliver = (qty, key) => envApi.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${destId}`, actorSectorId: "ENVASADO_MASIVO", deliverQuantity: qty, partial: qty != null, idempotencyKey: `e2e-nt-dlv-${RUN}-${key}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "" } });
  await must(await deliver(150, "1"), "entrega parcial");
  await portal.getByTestId("delivery-row").first().waitFor({ timeout: 30_000 }); // el portal abierto lo muestra solo (sondeo de 5 s)
  await sleep(1500);
  check("5a Entrega PARCIAL: el portal sigue «Listo para entregar», con la entrega en el historial, y NO hay push de «entregado»", (await apiStatus()) === "Listo para entregar" && received.filter((r) => r.message).length === 4 && (await portal.getByTestId("delivery-row").count()) === 1, `estado=${await apiStatus()} pushes=${received.filter((r) => r.message).length} filas=${await portal.getByTestId("delivery-row").count()}`);
  await must(await deliver(null, "2"), "entrega total");
  await step("5b Entrega TOTAL", { portal: "Entregado", events: "RECIBIDO,ELABORACION,ENVASADO,LISTO,ENTREGADO", dbPedido: "ENTREGADO", push: { title: "¡Tu pedido fue entregado!", body: "Gracias por confiar en Laboratorio Genus." }, pushCount: 5 });
  await portal.getByTestId("delivered-section").waitFor({ timeout: 15_000 });
  check("el pedido entregado queda en la sección «Entregados» con su fecha", /Entregado el \d{2}\/\d{2}\/\d{4}/.test(await portal.getByTestId("delivered-section").innerText()));
  await portal.screenshot({ path: `${OUT}/01-portal-entregado.png`, fullPage: true });

  // ───────── 6. Vía del ESTADO DEL PEDIDO (edición de Producción): Listo y Entregado ─────────
  const OP2 = `${OP}-M`;
  const ped2 = await must(await produccion.post("/api/v1/production-pedidos", { data: { op: OP2, cliente: NAME, producto: "CREMA NT", q: 20, portalClientId: idA } }), "crear pedido 2");
  const upd = (estado) => produccion.patch(`/api/v1/production-pedidos/${ped2.item.id}`, { data: { op: OP2, cliente: NAME, producto: "CREMA NT", q: 20, estado } });
  const n0 = received.filter((r) => r.message).length;
  await waitPush(n0 + 1);
  await must(await upd("LISTO PARA ENTREGAR"), "estado listo");
  await waitPush(n0 + 2);
  await portal.getByTestId("order").filter({ hasText: `Pedido ${OP2}` }).getByTestId("order-status").filter({ hasText: "Listo para entregar" }).waitFor({ timeout: 30_000 });
  await must(await upd("ENTREGADO"), "estado entregado");
  await waitPush(n0 + 3);
  await portal.getByTestId("delivered-section").getByTestId("order").filter({ hasText: `Pedido ${OP2}` }).waitFor({ timeout: 30_000 });
  check("6 Producción pasa el estado del pedido a «Listo» y «Entregado»: el portal abierto lo refleja y llegan los pushes", received.filter((r) => r.message).slice(-2).map((r) => r.message.title).join("|") === "¡TU PEDIDO ESTÁ LISTO! 🎉|¡Tu pedido fue entregado!");

  // ───────── 7. Cliente aislado y sin envío real: eventos simulados, nada sale ─────────
  const before = received.length;
  const pedB = await must(await produccion.post("/api/v1/production-pedidos", { data: { op: `${OP}-B`, cliente: NAME_B, producto: "GEL B", q: 9, portalClientId: idB } }), "pedido B");
  await sleep(3000);
  const evB = await q("select status, mode from portal_push_outbox where client_id = $1::uuid", [idB]);
  check("7 otro cliente (piloto, SIN envío real, global apagado): evento SIMULADO y ningún push saliente", evB.length >= 1 && evB.every((e) => e.status === "SIMULADA" && e.mode === "SIMULADO") && received.length === before && Boolean(pedB.item.id));
  check("7 aislamiento: el cliente de prueba no ve el pedido del otro cliente", !(await portal.locator("body").innerText()).includes(`${OP}-B`));

  // ───────── 8. Sin duplicados y cron como red de seguridad ─────────
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const cronRes = await anon.get("/api/cron/portal-push", { headers: { authorization: "Bearer e2e-cron-secret" } });
  check("el cron real responde 200 con Bearer correcto y 401 sin él", cronRes.status() === 200 && (await anon.get("/api/cron/portal-push")).status() === 401);
  await sleep(1500);
  check("sin duplicados: 5 + 3 pushes en total para el cliente de prueba tras el cron", received.filter((r) => r.message).length === 8 && (await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d"))[0].n === 0, String(received.filter((r) => r.message).length));

  // ───────── 9. Panel de Dirección y salud ─────────
  const octx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 1000 } });
  const p = await octx.newPage();
  await p.goto("/login");
  await p.locator('input[type="email"]').fill(E2E_USERS.direccion.email);
  await p.locator('input[type="password"]').fill(E2E_PASSWORD);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await p.getByText("Portal de Clientes").first().click();
  await p.getByTestId("portal-push-admin").waitFor({ timeout: 30_000 });
  const rowA = p.getByTestId("push-client-row").filter({ hasText: NAME });
  const rowB = p.getByTestId("push-client-row").filter({ hasText: NAME_B });
  check("panel: «Envío REAL a este cliente (prueba)» en el cliente de prueba y SIMULADO en el otro", /Envío REAL a este cliente/.test(await rowA.getByTestId("push-real-state").innerText()) && /SIMULADO/.test(await rowB.getByTestId("push-real-state").innerText()));
  const diag = await rowA.getByTestId("push-diag-deliveries").innerText();
  check("panel: «aceptadas por el servicio push» y «recepción comprobada» como cifras distintas", /\d+ aceptadas por el servicio push \/ \d+ recepción comprobada/.test(diag), diag);
  check("panel: cron al día (sin «sin ejecuciones recientes») tras la corrida", (await p.getByTestId("push-cron-stale").count()) === 0);
  await p.screenshot({ path: `${OUT}/02-panel-direccion.png`, fullPage: true });
  const health = await dir.get("/api/v1/portal-push-health");
  const hj = await health.json();
  check("endpoint de salud (solo Dirección): VAPID, cron y cliente de prueba con envío real", health.status() === 200 && hj.vapid.configured === true && hj.cron.stale === false && hj.clients.find((c) => c.id === idA)?.realSendEnabled === true && !JSON.stringify(hj).includes(PUSH_URL), JSON.stringify(hj.problems));
  check("endpoint de salud: Producción recibe 403", (await produccion.get("/api/v1/portal-push-health")).status() === 403);
  // notificación de prueba desde la UI: aceptada + recepción comprobada
  p.on("dialog", (d) => void d.accept());
  await rowA.getByTestId("push-test-send").click();
  await p.waitForFunction(() => /recepción COMPROBADA en el dispositivo/.test(document.body.innerText), null, { timeout: 60_000 });
  check("botón «Enviar notificación de prueba»: muestra «aceptada por el servicio push» y «recepción COMPROBADA» (SW real + acuse)", (await notifications()).some((n) => n.title === "¡Bienvenido a Laboratorio Genus! 🎉"));
  await octx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
  await pool.end();
  pushServer.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
