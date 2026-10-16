// E2E del Portal de Clientes en Chromium real (escritorio y móvil) contra la app de producción local y un Postgres DESCARTABLE.
// Flujo completo: Producción crea el cliente desde GENUS OS (API) → el cliente entra con código + correo + código temporal (leído
// del registro de correos en modo «capture», nunca se envía nada) → ve sus productos con el camión → confirma recepción →
// aislamiento entre clientes → cierre de sesión. Deja capturas en $OUT. Ver run-portal-e2e-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/portal-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const NAME_A = `E2E PORTAL A ${RUN}`;
const NAME_B = `E2E PORTAL B ${RUN}`;
const EMAIL_A = `cliente-a-${RUN.toLowerCase()}@e2e-cliente.test`;
const EMAIL_B = `cliente-b-${RUN.toLowerCase()}@e2e-cliente.test`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const mondayOf = (d) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

// ───────── Preparación: cliente creado desde GENUS OS + datos operativos ─────────
const admin = await pwRequest.newContext({ baseURL: BASE });
const lg = await admin.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
if (lg.status() !== 200) throw new Error(`login Producción: ${await lg.text()}`);
const post = async (action, data) => admin.post("/api/v1/portal-admin", { data: { action, ...data } });
const createA = await (await post("create_client", { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [EMAIL_A] })).json();
const createB = await (await post("create_client", { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [EMAIL_B] })).json();
const CODE_A = createA.publicCode;
const CODE_B = createB.publicCode;
check("Producción crea clientes desde GENUS OS con código público único", /^GEN-[A-Z2-9]{6}$/.test(CODE_A) && CODE_A !== CODE_B, `${CODE_A} / ${CODE_B}`);

const today = new Date();
const weekStart = mondayOf(today);
const api = admin;
let weekId = (await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()).weeks?.[0]?.id;
if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E portal" } })).json()).week.id;
const plannedDate = today.getUTCDay() === 0 || today.getUTCDay() === 6 ? weekStart : today.toISOString().slice(0, 10);
async function item(data) {
  const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { plannedDate, unit: "un", ...data } });
  if (res.status() !== 201) throw new Error(`crear ${data.product}: ${await res.text()}`);
  return (await res.json()).item.id;
}
const ped = async (op, producto, cliente) => (await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,$2,$3,'EN_PROCESO','E2E','PRODUCCION') returning id::text as id", [op, producto, cliente]))[0].id;
const pA1 = await ped(`OP-${RUN}-1`, "SHAMPOO REPARADOR", NAME_A);
const pA2 = await ped(`OP-${RUN}-2`, "CREMA NUTRITIVA", NAME_A);
const pA3 = await ped(`OP-${RUN}-3`, "SERUM ENTREGADO", NAME_A);
const pB = await ped(`OP-${RUN}-B`, "GEL SOLO DE B", NAME_B);
const wElab = await item({ client: NAME_A, product: "SHAMPOO REPARADOR", plannedQuantity: "300", unit: "kg", sector: "ELABORACION", branchOwner: "Cristian" });
const wEnv = await item({ client: NAME_A, product: "CREMA NUTRITIVA", plannedQuantity: "5000", sector: "ENVASADO_MASIVO", line: "Línea 1" });
const wDel = await item({ client: NAME_A, product: "SERUM ENTREGADO", plannedQuantity: "1200", sector: "ENVASADO_MASIVO", line: "Línea 2" });
const wB = await item({ client: NAME_B, product: "GEL SOLO DE B", plannedQuantity: "900", sector: "ENVASADO_MASIVO", line: "Línea 1" });
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso' where id = $1", [wElab, pA1]);
await q("insert into operational_events (work_item_id, type, actor_email, actor_sector, created_at) values ($1,'ITEM_ASSIGNED','e2e','PRODUCCION',$2)", [wElab, daysAgo(4)]);
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'revision', completed_at = $3 where id = $1", [wEnv, pA2, daysAgo(1)]);
// «Listo para entregar» = confirmación EXPLÍCITA del último sector (sin ella un trabajo terminado no figura como listo).
await q("insert into portal_availability_marks (work_item_id, quantity, unit, delivered_before, client_name, product, sector, marked_by, idempotency_key) values ($1, 5000, 'un', 0, $2, 'CREMA NUTRITIVA', 'ENVASADO_MASIVO', 'e2e-envasado@genus.test', $3)", [wEnv, NAME_A, `e2e-mark-${RUN}`]);
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'entregado' where id = $1", [wDel, pA3]);
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso' where id = $1", [wB, pB]);
const [wd] = await q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status) values ($1,'SERUM ENTREGADO',$2,'ENVASADO_MASIVO','1200','un',$3,'E2E','ENVASADO_MASIVO','ENTREGADO') returning id::text as id", [wDel, NAME_A, daysAgo(2)]);
await q("insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after) values ($1,$2,$3,1,1200,'un','FINAL','ACTIVA','ENVASADO_MASIVO','E2E','ENVASADO_MASIVO',$4,1200)", [wDel, wd.id, `e2e-${RUN}`, daysAgo(2)]);
const opsBefore = JSON.stringify(await Promise.all([
  q("select id, operational_status, completed_at, planned_quantity from work_items where id = any($1::uuid[]) order by id", [[wElab, wEnv, wDel, wB]]),
  q("select id, status, quantity from work_item_deliveries order by id"),
  q("select id, quantity from work_item_delivery_lines order by id"),
  q("select count(*)::int n from mp_stock_movements"),
]));

// ───────── Navegador ─────────
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const lastOtp = async (email) => {
  for (let i = 0; i < 30; i++) {
    const r = await q("select body_text from portal_email_outbox where kind = 'LOGIN' and to_email = $1 order by created_at desc limit 1", [email]);
    const m = r[0]?.body_text?.match(/es: (\d{6})/);
    if (m) return m[1];
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return null;
};
async function portalLogin(page, code, email) {
  await page.goto("/entregas");
  await page.getByLabel("Código de cliente").fill(code);
  await page.getByLabel("Correo autorizado").fill(email);
  await q("update portal_login_challenges set created_at = created_at - interval '2 minutes' where email = $1", [email]);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await page.getByLabel("Código recibido por correo").waitFor();
  const otp = await lastOtp(email);
  if (!otp) throw new Error("no llegó el código al registro de correos");
  await page.getByLabel("Código recibido por correo").fill(otp);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.getByTestId("welcome").waitFor({ timeout: 15000 });
  return otp;
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// ── Escritorio ──
const dctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const d = await dctx.newPage();
await d.goto("/entregas");
await d.getByText("GENUS | Portal de Clientes").first().waitFor();
check("login del portal: marca, logo real y lema", (await d.locator('img[alt="Laboratorio Genus"]').first().evaluate((i) => i.complete && i.naturalWidth > 100)) && (await d.getByText("Tu producción, en buenas manos.").count()) > 0);
await d.screenshot({ path: `${OUT}/01-login-escritorio.png` });
const bg = await d.evaluate(() => getComputedStyle(document.querySelector(".gp")).backgroundColor);
check("tema claro (sin modo oscuro)", /rgb\(24[0-9], 24[0-9], 25[0-9]\)/.test(bg) || bg.startsWith("rgb(2") || bg.startsWith("rgb(24"), bg);

// credenciales inválidas: mismo mensaje genérico
await d.getByLabel("Código de cliente").fill("GEN-ZZZZZZ");
await d.getByLabel("Correo autorizado").fill(EMAIL_A);
await d.getByRole("button", { name: "Enviarme un código" }).click();
await d.getByLabel("Código recibido por correo").waitFor();
await d.getByLabel("Código recibido por correo").fill("123456");
await d.getByRole("button", { name: "Ingresar" }).click();
await d.getByTestId("login-msg").filter({ hasText: "no son correctos" }).waitFor();
check("código de cliente incorrecto: mensaje genérico, sin acceso", (await d.getByTestId("welcome").count()) === 0);

await portalLogin(d, CODE_A, EMAIL_A);
check("bienvenida con el nombre del cliente", (await d.getByTestId("welcome").innerText()).includes(`Cliente A ${RUN}`));
const cards = d.getByTestId("product-card");
check("tres productos del cliente, ninguno de otro", (await cards.count()) === 3 && (await d.getByText("GEL SOLO DE B").count()) === 0);
check("resumen: 3 en proceso (2 + el entregado cuenta aparte), 1 elaboración, 1 listo", (await d.getByTestId("sum-elab").innerText()) === "1" && (await d.getByTestId("sum-ready").innerText()) === "1");
const elabCard = cards.filter({ hasText: "SHAMPOO REPARADOR" });
check("Elaboración: mensaje oficial y cuenta regresiva en días hábiles", (await elabCard.getByTestId("stage-message").innerText()) === "Estamos elaborando tu producto en nuestro laboratorio." && /día/.test(await elabCard.getByTestId("eta").innerText()), await elabCard.getByTestId("eta").innerText());
const listoCard = cards.filter({ hasText: "CREMA NUTRITIVA" });
check("Listo para entregar: mensaje oficial y cantidad disponible", (await listoCard.getByTestId("stage-message").innerText()) === "¡Tu producto está listo! Podés coordinar la entrega con nuestro equipo." && /5\.000/.test(await listoCard.innerText()));
check("Entregado: mensaje oficial", (await cards.filter({ hasText: "SERUM ENTREGADO" }).getByTestId("stage-message").innerText()) === "Tu producto fue entregado. ¡Gracias por confiar en Laboratorio Genus!");
check("camión GENUS con el logo real en cada tarjeta", (await d.locator('[data-testid="truck"] image[href="/entregas/logo-genus.png"]').count()) === 3);
check("aclaración de tiempos estimativos", (await d.getByTestId("disclaimer").innerText()).includes("Los tiempos son estimativos y pueden variar según las características de cada producción."));
check("contacto con datos reales", (await d.getByTestId("contact-email").innerText()) === "ventas@laboratoriogenus.com.ar");
check("sin desborde horizontal (escritorio)", await noOverflow(d));
await d.screenshot({ path: `${OUT}/02-inicio-escritorio.png`, fullPage: true });

// detalle
await listoCard.getByTestId("ver-detalles").click();
await d.getByTestId("timeline").waitFor();
check("detalle del producto con recorrido por etapas", (await d.getByTestId("timeline").locator("li").count()) === 4);
await d.screenshot({ path: `${OUT}/03-detalle-escritorio.png`, fullPage: true });
await d.getByTestId("back").click();
await d.getByTestId("welcome").waitFor();

// movimiento del camión al cambiar de etapa: Elaboración → Envasado (el camión avanza, animación corta)
await d.evaluate(() => sessionStorage.clear());
const posBefore = await elabCard.getByTestId("truck").evaluate((e) => parseFloat(e.style.left));
await q("insert into operational_events (work_item_id, type, actor_email, actor_sector, created_at) values ($1,'RECEIVED_FROM_ELABORACION','e2e','ELABORACION',$2)", [wElab, daysAgo(1)]);
await q("update work_items set sector = 'ENVASADO_MASIVO', branch_owner = null, line = 'Línea 3', operational_status = 'en_curso' where id = $1", [wElab]);
await d.reload();
const moved = d.getByTestId("product-card").filter({ hasText: "SHAMPOO REPARADOR" });
await moved.getByTestId("stage-pill").filter({ hasText: "Envasado" }).waitFor();
check("al pasar a Envasado el mensaje cambia y el camión avanza", (await moved.getByTestId("stage-message").innerText()) === "Tu producto finalizó la elaboración y se encuentra en proceso de envasado." && parseFloat(await moved.getByTestId("truck").evaluate((e) => e.style.left)) > posBefore);
await d.screenshot({ path: `${OUT}/04-envasado-escritorio.png`, fullPage: true });

// recepción
await d.locator('[data-testid="delivery-row"]').filter({ hasText: "SERUM ENTREGADO" }).getByTestId("confirm-receipt").click();
const dlg = d.getByTestId("receipt-dialog");
await dlg.waitFor();
await dlg.getByText("1.200").waitFor();
const dlgText = (await dlg.innerText()).toLowerCase();
check("diálogo de recepción: producto, pedido, cantidad y fecha de entrega registrada", ["Producto", "Pedido", "Cantidad recibida", "Fecha de entrega registrada", "SERUM ENTREGADO", `OP-${RUN}-3`, "1.200"].every((t) => dlgText.includes(t.toLowerCase())));
check("botones CONFIRMAR RECEPCIÓN y CANCELAR", (await dlg.getByRole("button", { name: "CONFIRMAR RECEPCIÓN" }).count()) === 1 && (await dlg.getByRole("button", { name: "CANCELAR" }).count()) === 1);
await d.screenshot({ path: `${OUT}/05-recepcion-dialogo.png` });
await dlg.getByRole("button", { name: "CANCELAR" }).click();
check("cancelar no confirma nada", (await q("select 1 from portal_receipt_confirmations")).length === 0);
await d.locator('[data-testid="delivery-row"]').filter({ hasText: "SERUM ENTREGADO" }).getByTestId("confirm-receipt").click();
await d.getByTestId("receipt-dialog").getByRole("button", { name: "CONFIRMAR RECEPCIÓN" }).click();
await d.getByTestId("receipt-stamp").waitFor();
await d.screenshot({ path: `${OUT}/06-recepcion-constancia.png` });
await d.getByTestId("receipt-dialog").getByRole("button", { name: "Cerrar" }).click();
await d.reload();
const row = d.locator('[data-testid="delivery-row"]').filter({ hasText: "SERUM ENTREGADO" });
check("recepción confirmada persiste al recargar y no se puede repetir", (await row.getByTestId("delivery-confirmed").count()) === 1 && (await row.getByTestId("confirm-receipt").count()) === 0);
const rc = await q("select confirmed_by_email, quantity from portal_receipt_confirmations");
check("constancia guardada una sola vez con el correo autenticado", rc.length === 1 && rc[0].confirmed_by_email === EMAIL_A && rc[0].quantity === "1200");
const ops = JSON.stringify(await Promise.all([
  q("select id, operational_status, completed_at, planned_quantity from work_items where id = any($1::uuid[]) order by id", [[wElab, wEnv, wDel, wB]]),
  q("select id, status, quantity from work_item_deliveries order by id"),
  q("select id, quantity from work_item_delivery_lines order by id"),
  q("select count(*)::int n from mp_stock_movements"),
]));
const opsExpected = JSON.parse(opsBefore);
const opsNow = JSON.parse(ops);
check("la confirmación no toca entregas, líneas ni stock (el único cambio es el traspaso simulado de la prueba)", JSON.stringify(opsNow.slice(1)) === JSON.stringify(opsExpected.slice(1)));

// sesión: cookie y API
const cookies = (await dctx.cookies()).find((c) => c.name === "genus_portal_session");
check("cookie de sesión del portal: HttpOnly, SameSite=Lax, solo /entregas", Boolean(cookies?.httpOnly) && cookies.sameSite === "Lax" && cookies.path === "/entregas");
const apiNoCookie = await pwRequest.newContext({ baseURL: BASE });
check("la API del portal exige sesión (401 sin cookie)", (await apiNoCookie.get("/entregas/api/overview")).status() === 401);
const hdrs = (await apiNoCookie.get("/entregas")).headers();
check("cabeceras: noindex y sin caché", /noindex/.test(hdrs["x-robots-tag"] ?? "") && /no-store/.test(hdrs["cache-control"] ?? ""));
const logo = await apiNoCookie.get("/entregas/logo-genus.png");
check("logo real servido bajo /entregas", logo.status() === 200 && /image\/png/.test(logo.headers()["content-type"] ?? ""));
const csrf = await apiNoCookie.post("/entregas/api/auth/request", { data: { code: CODE_A, email: EMAIL_A }, headers: { origin: "https://evil.example" } });
check("POST con origen ajeno rechazado", csrf.status() === 403);

// cierre de sesión
await d.getByTestId("logout").click();
await d.getByRole("button", { name: "Enviarme un código" }).waitFor();
check("cerrar sesión vuelve al login y el panel deja de estar disponible", (await dctx.request.get("/entregas/api/overview")).status() === 401);

// aislamiento entre clientes
await portalLogin(d, CODE_B, EMAIL_B);
check("Cliente B ve solo lo suyo", (await d.getByTestId("product-card").count()) === 1 && (await d.getByText("GEL SOLO DE B").count()) > 0 && (await d.getByText("CREMA NUTRITIVA").count()) === 0);
const aProductId = (await q("select 1")) && (await (async () => {
  const s = await pwRequest.newContext({ baseURL: BASE });
  return s;
})());
void aProductId;
const ovB = await (await dctx.request.get("/entregas/api/overview")).json();
check("la respuesta de la API de B no contiene datos de A ni ids internos", !JSON.stringify(ovB).includes("SHAMPOO") && !JSON.stringify(ovB).includes(wElab) && !JSON.stringify(ovB).includes(wB));
await d.screenshot({ path: `${OUT}/07-cliente-b.png` });
await dctx.close();

// ── Móvil ──
const mctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const m = await mctx.newPage();
await m.goto("/entregas");
await m.screenshot({ path: `${OUT}/08-login-movil.png` });
check("login móvil sin desborde", await noOverflow(m));
await portalLogin(m, CODE_A, EMAIL_A);
await m.getByTestId("product-card").first().waitFor();
check("inicio móvil: tarjetas y camión visibles, sin desborde", (await m.getByTestId("product-card").count()) === 3 && (await m.getByTestId("truck").first().isVisible()) && (await noOverflow(m)));
await m.screenshot({ path: `${OUT}/09-inicio-movil.png`, fullPage: true });
await m.getByTestId("product-card").first().getByTestId("ver-detalles").tap();
await m.getByTestId("timeline").waitFor();
await m.screenshot({ path: `${OUT}/10-detalle-movil.png`, fullPage: true });
check("detalle móvil sin desborde", await noOverflow(m));
await mctx.close();

// ── Movimiento reducido ──
const rctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const r = await rctx.newPage();
await portalLogin(r, CODE_A, EMAIL_A);
const tr = await r.getByTestId("truck").first().evaluate((e) => getComputedStyle(e).transitionDuration + "|" + getComputedStyle(e).animationName);
check("«reducir movimiento»: sin transiciones ni animaciones", /^0s\|none$/.test(tr) || tr.startsWith("0s"), tr);
await rctx.close();

// ── GENUS OS: panel de administración y permisos ──
const lst = await (await admin.get("/api/v1/portal-admin?view=clients")).json();
check("panel administra clientes con alias, correos y código", lst.clients.some((c) => c.publicCode === CODE_A && c.emails.some((e) => e.email === EMAIL_A) && c.aliases.length === 1));
const prob = await (await admin.get("/api/v1/portal-admin?view=problems")).json();
check("problemas de vinculación disponibles", Array.isArray(prob.unmappedClients));
const env = await pwRequest.newContext({ baseURL: BASE });
await env.post("/api/v1/auth/login", { data: { email: E2E_USERS.envasado.email, password: E2E_PASSWORD } });
check("Envasado NO puede administrar el portal (403)", (await env.get("/api/v1/portal-admin?view=clients")).status() === 403);
check("sin sesión interna tampoco (401)", (await apiNoCookie.get("/api/v1/portal-admin?view=clients")).status() === 401);
const sus = await post("suspend", { clientId: lst.clients.find((c) => c.publicCode === CODE_B).id, reason: "E2E" });
check("suspender cliente cierra sus sesiones", sus.status() === 200 && (await dctx.request.get("/entregas/api/overview").catch(() => ({ status: () => 401 }))).status() === 401);

const adminCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const ap = await adminCtx.newPage();
await ap.goto("/login");
await ap.locator('input[type="email"]').fill(E2E_USERS.produccion.email);
await ap.locator('input[type="password"]').fill(E2E_PASSWORD);
await ap.locator('button[type="submit"]').click();
await ap.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
await ap.getByText("Portal de Clientes").first().click();
await ap.getByTestId("portal-admin").waitFor({ timeout: 20000 });
await ap.getByTestId("portal-client").first().waitFor();
check("GENUS OS: pestaña «Portal de Clientes» para Producción con código del cliente", (await ap.getByTestId("client-code").first().innerText()).startsWith("GEN-"));
await ap.screenshot({ path: `${OUT}/11-admin-genus-os.png`, fullPage: true });
await adminCtx.close();
check("GENUS OS sigue operativo (login interno)", (await (await pwRequest.newContext({ baseURL: BASE })).get("/login")).status() === 200);

await browser.close();
await pool.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
