// E2E del MODO DEMOSTRACIÓN del Portal de Clientes (Chromium real, escritorio, tablet y móvil; build de producción local y
// Postgres DESCARTABLE). Flujo: usuario interno toca «Abrir portal de prueba» en GENUS OS → el portal abre con una sesión demo
// (token de un solo uso en el fragmento) → datos ficticios, camión, detalle, confirmación simulada → vencimiento y aislamiento.
// Deja capturas en $OUT. Ver run-portal-demo-e2e-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/portal-demo-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const fingerprint = async () =>
  JSON.stringify(await Promise.all([
    q("select count(*)::int n from portal_clients"),
    q("select count(*)::int n from portal_receipt_confirmations"),
    q("select count(*)::int n from portal_notifications"),
    q("select count(*)::int n from portal_email_outbox"),
    q("select count(*)::int n from work_items"),
    q("select count(*)::int n from work_item_deliveries"),
    q("select count(*)::int n from work_item_delivery_lines"),
    q("select count(*)::int n from mp_stock_movements"),
    q("select count(*)::int n from os_notifications"),
    q("select count(*)::int n from production_pedidos"),
  ]));

// ── Cliente REAL de control (para comprobar que la demo no lo toca y que su acceso normal sigue igual) ──
const admin = await pwRequest.newContext({ baseURL: BASE });
const lg = await admin.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
if (lg.status() !== 200) throw new Error(`login Producción: ${await lg.text()}`);
const REAL_EMAIL = `real-${RUN.toLowerCase()}@e2e-cliente.test`;
const real = await (await admin.post("/api/v1/portal-admin", { data: { action: "create_client", displayName: `Cliente Real ${RUN}`, aliases: [`E2E REAL ${RUN}`], emails: [REAL_EMAIL] } })).json();
const before = await fingerprint();

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

// ── Usuario interno → botón en GENUS OS → portal de prueba ──
const staffCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const sp = await staffCtx.newPage();
await sp.goto("/login");
await sp.locator('input[type="email"]').fill(E2E_USERS.produccion.email);
await sp.locator('input[type="password"]').fill(E2E_PASSWORD);
await sp.locator('button[type="submit"]').click();
await sp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await sp.getByText("Portal de Clientes").first().click();
await sp.getByTestId("portal-demo").waitFor({ timeout: 20000 });
const btn = sp.getByTestId("open-demo");
check("GENUS OS: botón «Abrir portal de prueba» visible", (await btn.innerText()).trim() === "Abrir portal de prueba");
await sp.screenshot({ path: `${OUT}/01-genus-os-boton.png` });
const [demoPage] = await Promise.all([staffCtx.waitForEvent("page", { timeout: 20000 }), btn.click()]);
await demoPage.waitForURL((u) => u.pathname === "/entregas", { timeout: 30000 });
await demoPage.getByTestId("welcome").waitFor({ timeout: 20000 });
check("se abre el portal real en otra pestaña con la sesión demo (sin código de cliente ni correo)", (await demoPage.getByTestId("welcome").innerText()).includes("Cliente de demostración"));
check("la URL final no conserva el token (ni en la consulta ni en el fragmento)", !/[#?]/.test(new URL(demoPage.url()).search + new URL(demoPage.url()).hash) && !demoPage.url().includes("t="));
check("indicación discreta «Modo demostración»", (await demoPage.getByTestId("demo-badge").innerText()) === "Modo demostración" && (await demoPage.getByTestId("demo-banner").count()) === 1);
const cards = demoPage.getByTestId("product-card");
check("seis productos ficticios", (await cards.count()) === 6);
const card = (name) => cards.filter({ hasText: name });
check("crema facial en elaboración con 8 días hábiles restantes", (await card("Crema facial").getByTestId("stage-pill").innerText()) === "Elaboración" && /\b8 días hábiles/.test(await card("Crema facial").getByTestId("eta").innerText()));
check("shampoo en envasado con 3 días hábiles restantes", (await card("Shampoo").getByTestId("stage-pill").innerText()) === "Envasado" && /\b3 días hábiles/.test(await card("Shampoo").getByTestId("eta").innerText()));
check("sérum listo para entregar", (await card("Sérum").getByTestId("stage-pill").innerText()) === "Listo para entregar");
check("producto con entrega parcial (5.000 / 2.000 / 3.000)", /5\.000/.test(await card("Acondicionador").getByTestId("partial-note").innerText()) && /2\.000/.test(await card("Acondicionador").getByTestId("partial-note").innerText()) && /3\.000/.test(await card("Acondicionador").getByTestId("partial-note").innerText()));
check("entregado con recepción pendiente y entregado con recepción confirmada", (await demoPage.locator('[data-testid="delivery-row"]').filter({ hasText: "Tónico" }).getByTestId("confirm-receipt").count()) === 1 && (await demoPage.locator('[data-testid="delivery-row"]').filter({ hasText: "Mascarilla" }).getByTestId("delivery-confirmed").count()) === 1);
check("camión GENUS en las seis tarjetas, con progreso", (await demoPage.getByTestId("truck").count()) === 6 && (await demoPage.getByTestId("truck-tracker").count()) === 6);
check("historial de entregas y notificaciones", (await demoPage.locator('[data-testid="delivery-row"]').count()) >= 3 && (await demoPage.getByTestId("bell-count").innerText()) === "2");
check("sin desborde horizontal (escritorio)", await noOverflow(demoPage));
await demoPage.screenshot({ path: `${OUT}/02-demo-escritorio.png`, fullPage: true });

// detalle
await card("Acondicionador").getByTestId("ver-detalles").click();
await demoPage.getByTestId("timeline").waitFor();
check("detalle del producto en la demo (recorrido y banner)", (await demoPage.getByTestId("timeline").locator("li").count()) === 4 && (await demoPage.getByTestId("demo-badge").count()) === 1);
await demoPage.screenshot({ path: `${OUT}/03-demo-detalle.png`, fullPage: true });
await demoPage.getByTestId("back").click();
await demoPage.getByTestId("welcome").waitFor();

// confirmación simulada
await demoPage.locator('[data-testid="delivery-row"]').filter({ hasText: "Tónico" }).getByTestId("confirm-receipt").click();
const dlg = demoPage.getByTestId("receipt-dialog");
await dlg.waitFor();
await dlg.getByText("800").first().waitFor();
check("diálogo de recepción simulada con los datos ficticios", /simulada/i.test(await dlg.innerText()) && (await dlg.getByRole("button", { name: "CONFIRMAR RECEPCIÓN" }).count()) === 1);
await demoPage.screenshot({ path: `${OUT}/04-demo-recepcion-dialogo.png` });
await dlg.getByRole("button", { name: "CONFIRMAR RECEPCIÓN" }).click();
await demoPage.getByTestId("receipt-stamp").waitFor();
await demoPage.screenshot({ path: `${OUT}/05-demo-recepcion-constancia.png` });
await demoPage.getByTestId("receipt-dialog").getByRole("button", { name: "Cerrar" }).click();
await demoPage.reload();
const row = demoPage.locator('[data-testid="delivery-row"]').filter({ hasText: "Tónico" });
check("la recepción simulada persiste al recargar y no se puede repetir", (await row.getByTestId("delivery-confirmed").count()) === 1 && (await row.getByTestId("confirm-receipt").count()) === 0);
check("la confirmación simulada NO crea constancias ni avisos reales ni toca nada de GENUS OS", (await fingerprint()) === before);
await demoPage.getByTestId("demo-reset").click();
await demoPage.waitForFunction(() => document.querySelectorAll('[data-testid="confirm-receipt"]').length === 2);
check("«Reiniciar demostración» devuelve el estado inicial", true);

// token de un solo uso
const demoUrlCtx = await browser.newContext({ baseURL: BASE });
const reuse = await demoUrlCtx.newPage();
const launch = await (await admin.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).json();
check("la URL de apertura lleva el token solo en el fragmento", launch.url.includes("/entregas/demo#t=") && !new URL(launch.url).search);
await reuse.goto(launch.url);
await reuse.waitForURL((u) => u.pathname === "/entregas", { timeout: 20000 });
await reuse.getByTestId("demo-badge").waitFor();
const reuse2 = await (await browser.newContext({ baseURL: BASE })).newPage();
await reuse2.goto(launch.url);
await reuse2.getByTestId("demo-error").waitFor({ timeout: 20000 });
check("el enlace de un solo uso no sirve por segunda vez", /venció o ya fue usado/.test(await reuse2.getByTestId("demo-error").innerText()));
check("el segundo intento no deja sesión", (await reuse2.context().request.get("/entregas/api/overview")).status() === 401);
await reuse2.screenshot({ path: `${OUT}/06-demo-enlace-usado.png` });

// vencimiento de la sesión
await q("update portal_demo_sessions set expires_at = now() - interval '1 second' where revoked_at is null");
check("sesión demo vencida: la API responde 401", (await reuse.context().request.get("/entregas/api/overview")).status() === 401);
await reuse.goto("/entregas");
check("sesión demo vencida: el portal vuelve al ingreso normal de clientes", (await reuse.getByRole("button", { name: "Enviarme un código" }).count()) === 1 && (await reuse.getByTestId("demo-badge").count()) === 0);
const tokenExpired = await (await admin.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).json();
await q("update portal_demo_tokens set expires_at = now() - interval '1 second' where consumed_at is null");
const late = await (await browser.newContext({ baseURL: BASE })).newPage();
await late.goto(tokenExpired.url);
await late.getByTestId("demo-error").waitFor({ timeout: 20000 });
check("token vencido (más de 2 minutos): rechazado", true);

// permisos
const env = await pwRequest.newContext({ baseURL: BASE });
await env.post("/api/v1/auth/login", { data: { email: E2E_USERS.envasado.email, password: E2E_PASSWORD } });
check("Envasado NO puede abrir el portal de prueba (403)", (await env.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).status() === 403);
check("sin sesión interna tampoco (401)", (await (await pwRequest.newContext({ baseURL: BASE })).post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).status() === 401);
const dirCtx = await pwRequest.newContext({ baseURL: BASE });
await dirCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.direccion.email, password: E2E_PASSWORD } });
check("Dirección sí puede (200)", (await dirCtx.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).status() === 200);
check("POST con origen ajeno al canje rechazado", (await (await pwRequest.newContext({ baseURL: BASE })).post("/entregas/api/demo/start", { data: { token: "a".repeat(40) }, headers: { origin: "https://evil.example" } })).status() === 403);

// acceso normal de clientes
const rc = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
const rp = await rc.newPage();
await rp.goto("/entregas");
await rp.getByLabel("Código de cliente").fill(real.publicCode);
await rp.getByLabel("Correo autorizado").fill(REAL_EMAIL);
await rp.getByRole("button", { name: "Enviarme un código" }).click();
await rp.getByLabel("Código recibido por correo").waitFor();
let otp = null;
for (let i = 0; i < 30 && !otp; i++) {
  otp = (await q("select body_text from portal_email_outbox where kind = 'LOGIN' and to_email = $1 order by created_at desc limit 1", [REAL_EMAIL]))[0]?.body_text?.match(/es: (\d{6})/)?.[1] ?? null;
  if (!otp) await new Promise((r) => setTimeout(r, 300));
}
await rp.getByLabel("Código recibido por correo").fill(otp);
await rp.getByRole("button", { name: "Ingresar" }).click();
await rp.getByTestId("welcome").waitFor({ timeout: 15000 });
check("el acceso real con código de cliente + correo sigue funcionando (sin marca de demostración)", (await rp.getByTestId("welcome").innerText()).includes(`Cliente Real ${RUN}`) && (await rp.getByTestId("demo-badge").count()) === 0);
await rc.close();

// tablet y móvil
for (const [name, opts] of [
  ["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ["movil", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
]) {
  const l = await (await admin.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).json();
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const p = await ctx.newPage();
  await p.goto(l.url);
  await p.getByTestId("demo-badge").waitFor({ timeout: 20000 });
  check(`${name}: demo con seis tarjetas, camión y sin desborde`, (await p.getByTestId("product-card").count()) === 6 && (await p.getByTestId("truck").first().isVisible()) && (await noOverflow(p)));
  await p.screenshot({ path: `${OUT}/07-demo-${name}.png`, fullPage: true });
  await p.getByTestId("product-card").nth(1).getByTestId("ver-detalles").tap();
  await p.getByTestId("timeline").waitFor();
  check(`${name}: detalle sin desborde`, await noOverflow(p));
  await p.screenshot({ path: `${OUT}/08-demo-detalle-${name}.png`, fullPage: true });
  await p.goBack();
  await p.getByTestId("demo-badge").waitFor();
  await p.locator('[data-testid="delivery-row"]').filter({ hasText: "Tónico" }).getByTestId("confirm-receipt").tap();
  await p.getByTestId("receipt-dialog").getByRole("button", { name: "CONFIRMAR RECEPCIÓN" }).tap();
  await p.getByTestId("receipt-stamp").waitFor();
  check(`${name}: confirmación simulada táctil`, true);
  await p.screenshot({ path: `${OUT}/09-demo-recepcion-${name}.png` });
  await p.getByTestId("receipt-dialog").getByRole("button", { name: "Cerrar" }).tap();
  await p.getByTestId("logout").tap();
  await p.getByRole("button", { name: "Enviarme un código" }).waitFor();
  check(`${name}: «Salir de la demo» cierra la sesión`, (await ctx.request.get("/entregas/api/overview")).status() === 401);
  await ctx.close();
}

// movimiento reducido en la demo
{
  const l = await (await admin.post("/api/v1/portal-admin", { data: { action: "demo_launch" } })).json();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(l.url);
  await p.getByTestId("demo-badge").waitFor({ timeout: 20000 });
  const t = await p.getByTestId("truck").first().evaluate((e) => getComputedStyle(e).transitionDuration + "|" + getComputedStyle(e).animationName);
  check("demo con «reducir movimiento»: sin transiciones ni animaciones", t.startsWith("0s"), t);
  await ctx.close();
}

check("al terminar, ningún dato real cambió por usar la demostración", (await fingerprint()).replace(/"n":\d+/, "") !== "" && JSON.parse(await fingerprint())[0][0].n === JSON.parse(before)[0][0].n && JSON.parse(await fingerprint())[1][0].n === 0);
await browser.close();
await pool.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
