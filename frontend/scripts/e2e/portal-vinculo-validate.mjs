// E2E del Portal de Clientes — VÍNCULO POR ID del cliente, de punta a punta y SIN mocks en la vinculación.
// Chromium real, app de producción local y Postgres DESCARTABLE. Ver run-portal-vinculo-e2e-local.sh.
//   Dirección crea el cliente «GENUS TEST» y su acceso (usuario genustest) desde el panel → Producción asigna un pedido desde el
//   formulario REAL «Nuevo pedido» → el cliente (portal ya abierto) lo ve SOLO, sin recargar, con producto, cantidad, OP, fecha y
//   estado → el pedido avanza de sector (elaboración → envasado → listo) y el portal lo refleja sin cerrar sesión → los avisos push
//   quedan en la outbox (simulada, envío general APAGADO) → otro cliente de nombre parecido («GENUS TEST 2») no ve nada.
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
const OUT = process.env.OUT ?? "/tmp/portal-vinculo-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const NAME = `GENUS TEST ${RUN}`;
const NAME2 = `GENUS TEST ${RUN} 2`;
const NAME3 = `GENUS ${RUN}`;
const FINAL = "Clave-Final-Genus-2026";
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
const arToday = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
};
const dmy = (iso) => iso.split("-").reverse().join("/");

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const apiCtx = async (user) => {
  const c = await pwRequest.newContext({ baseURL: BASE });
  const r = await c.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } });
  if (r.status() !== 200) throw new Error(`login ${user.email}: ${await r.text()}`);
  return c;
};

try {
  // ───────── 1. Dirección crea el cliente y el acceso DESDE EL PANEL (UI real) ─────────
  const dir = await openAs(E2E_USERS.direccion);
  await dir.page.getByText("Portal de Clientes").first().click();
  await dir.page.getByTestId("portal-users").waitFor({ timeout: 60_000 });
  await dir.page.getByLabel("Nombre del cliente").fill(NAME);
  await dir.page.getByRole("button", { name: "Crear cliente y generar código" }).click();
  await dir.page.locator("text=/Cliente creado/").first().waitFor({ timeout: 30_000 });
  const client = (await q("select id::text as id, public_code from portal_clients where display_name = $1", [NAME]))[0];
  check("Dirección crea el cliente «GENUS TEST» desde el panel (alias = nombre comercial)", Boolean(client) && (await q("select 1 from portal_client_aliases where client_id = $1::uuid and removed_at is null and name_key = $2", [client.id, NAME.toLowerCase()])).length === 1);

  const apiDir = await apiCtx(E2E_USERS.direccion);
  const mkClient = async (name) => {
    const r = await (await apiDir.post("/api/v1/portal-admin", { data: { action: "create_client", displayName: name, aliases: [name], emails: [] } })).json();
    return (await q("select id::text as id from portal_clients where public_code = $1", [r.publicCode]))[0].id;
  };
  const id2 = await mkClient(NAME2);
  const id3 = await mkClient(NAME3);

  // Crear acceso (usuario genustest) desde el panel «Usuarios del portal».
  const form = dir.page.getByTestId("user-form");
  await form.getByLabel("Cliente").selectOption(client.id);
  await dir.page.waitForFunction(() => document.querySelector('[aria-label="Contraseña inicial"]')?.value?.length >= 12);
  await form.getByLabel("Usuario", { exact: true }).fill("genustest");
  await dir.page.getByTestId("create-user").click();
  await dir.page.getByTestId("user-secret").waitFor({ timeout: 30_000 });
  const USER = (await dir.page.getByTestId("user-secret-username").innerText()).trim();
  const PASS = (await dir.page.getByTestId("user-secret-value").innerText()).trim();
  check("Dirección crea el acceso «genustest» con contraseña temporal", USER === "genustest" && PASS.length >= 12, USER);
  await dir.page.screenshot({ path: `${OUT}/01-panel-direccion.png` });
  // Acceso para el cliente parecido (aislamiento).
  const u2 = await (await apiDir.post("/api/v1/portal-admin", { data: { action: "create_user", clientId: id2, username: "genustest2", password: "Inicial-Temporal-2" } })).json();
  check("se crea también el acceso del cliente parecido «GENUS TEST 2»", u2.username === "genustest2");

  // Piloto de avisos push del cliente (baseline antes de cualquier pedido nuevo).
  const pilot = await apiDir.post("/api/v1/portal-admin", { data: { action: "push_pilot", clientId: client.id, enabled: true } });
  check("Dirección habilita el piloto de avisos del cliente (envío general APAGADO)", pilot.status() === 200 && (await q("select global_send_enabled from portal_push_settings where id = 1"))[0]?.global_send_enabled !== true);

  // ───────── 2. El cliente entra al portal (queda abierto, sin pedidos) ─────────
  const ctxC = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const portal = await ctxC.newPage();
  await portal.goto("/entregas");
  await portal.getByLabel("Usuario").fill(USER);
  await portal.getByLabel("Contraseña").fill(PASS);
  await portal.getByRole("button", { name: "Ingresar" }).click();
  await portal.getByTestId("change-password").waitFor({ timeout: 30_000 });
  await portal.getByLabel("Contraseña actual (temporal)").fill(PASS);
  await portal.getByLabel("Contraseña nueva", { exact: true }).fill(FINAL);
  await portal.getByLabel("Repetí la contraseña nueva").fill(FINAL);
  await portal.getByRole("button", { name: "Guardar y continuar" }).click();
  await portal.getByTestId("welcome").waitFor({ timeout: 30_000 });
  check("el cliente entra al portal con su usuario y ve su nombre", (await portal.getByTestId("welcome").innerText()).includes(NAME));
  check("al principio no tiene pedidos", (await portal.getByTestId("product-card").count()) === 0);
  await portal.evaluate(() => { window.__marker = "vivo"; });
  // La otra sesión (cliente parecido) también queda abierta.
  const ctx2 = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const portal2 = await ctx2.newPage();
  await portal2.goto("/entregas");
  await portal2.getByLabel("Usuario").fill("genustest2");
  await portal2.getByLabel("Contraseña").fill("Inicial-Temporal-2");
  await portal2.getByRole("button", { name: "Ingresar" }).click();
  await portal2.getByTestId("change-password").waitFor({ timeout: 30_000 });
  await portal2.getByLabel("Contraseña actual (temporal)").fill("Inicial-Temporal-2");
  await portal2.getByLabel("Contraseña nueva", { exact: true }).fill(FINAL);
  await portal2.getByLabel("Repetí la contraseña nueva").fill(FINAL);
  await portal2.getByRole("button", { name: "Guardar y continuar" }).click();
  await portal2.getByTestId("welcome").waitFor({ timeout: 30_000 });

  const anon = await pwRequest.newContext({ baseURL: BASE });
  const cron = async () => (await anon.get("/api/cron/portal-push", { headers: { authorization: "Bearer e2e-cron-secret" } })).json();
  const eventsOf = async (op) => (await q("select event_type, status, mode from portal_push_outbox where client_id = $1::uuid and order_ref = $2 order by created_at", [client.id, op]));
  await cron(); // baseline del piloto ya hecho al habilitarlo: sin pedidos todavía
  let sends = 0;

  // ───────── 3. Producción asigna el pedido desde el formulario REAL «Nuevo pedido» ─────────
  const prod = await openAs(E2E_USERS.produccion);
  await prod.page.goto("/mi-trabajo");
  await nav(prod.page, "Pedidos");
  await prod.page.getByRole("button", { name: /nuevo pedido/i }).click({ timeout: 120_000 });
  const cliInput = prod.page.getByTestId("pedido-form-cliente");
  await cliInput.waitFor({ timeout: 60_000 });
  await prod.page.waitForFunction(() => document.querySelector("[data-testid=pedido-form-op]")?.value !== "", null, { timeout: 30_000 }).catch(() => undefined);
  const OP1 = `OP-${RUN}-1`;
  await prod.page.getByTestId("pedido-form-op").fill(OP1);
  // Se tipea el nombre con otra escritura (minúsculas + espacio doble): el selector lo resuelve al ID del cliente.
  await cliInput.fill(`genus  test ${RUN.toLowerCase()}`);
  await prod.page.getByTestId("pedido-form-cliente-estado").filter({ hasText: "vínculo por ID" }).waitFor({ timeout: 15_000 });
  check("el formulario de Producción resuelve el cliente por ID (selector/autocompletado)", (await prod.page.getByTestId("pedido-form-cliente-estado").innerText()).includes(NAME));
  await prod.page.getByTestId("pedido-form-producto").fill("SHAMPOO GENUS TEST");
  await prod.page.getByTestId("pedido-form-q").fill("250");
  const fechaForm = await prod.page.getByTestId("pedido-form-fecha").inputValue();
  await prod.page.screenshot({ path: `${OUT}/02-nuevo-pedido.png` });
  await prod.page.getByTestId("pedido-form-guardar").click();
  await prod.page.waitForFunction(() => !document.querySelector("[data-testid=pedido-form-op]"), null, { timeout: 30_000 });
  const ped1 = (await q("select id::text as id, op, fecha::text as fecha, portal_client_id::text as cid, q from production_pedidos where producto = 'SHAMPOO GENUS TEST'"))[0];
  check("el pedido se guardó con el ID del cliente (vínculo principal)", ped1?.cid === client.id && ped1?.op === OP1, JSON.stringify(ped1));
  const c1 = await cron();
  sends += c1.push.enviadas;
  check("pedido recién asignado: la outbox registra «RECIBIDO» (simulado, envío general APAGADO)", c1.ok && c1.push.globalSendEnabled === false && JSON.stringify((await eventsOf(OP1)).map((e) => [e.event_type, e.status, e.mode])) === JSON.stringify([["RECIBIDO", "SIMULADA", "SIMULADO"]]));
  check("no se creó ningún cliente automático duplicado", (await q("select count(*)::int as n from portal_clients where display_name ilike $1", [`%${RUN}%`]))[0].n === 3);

  // ───────── 4. El portal ABIERTO lo muestra solo, sin recargar ─────────
  const card = portal.getByTestId("product-card").filter({ hasText: "SHAMPOO GENUS TEST" });
  await card.waitFor({ timeout: 60_000 });
  check("el pedido aparece SOLO en el portal abierto (auto-sync), sin recargar ni cerrar sesión", (await portal.evaluate(() => window.__marker)) === "vivo" && (await portal.evaluate(() => performance.getEntriesByType("navigation").length)) === 1);
  const txt = await card.innerText();
  check("el cliente ve producto, OP, cantidad, fecha y estado «Pedido recibido»", txt.includes("SHAMPOO GENUS TEST") && txt.includes(`Pedido ${OP1}`) && /solicitado\s*250/i.test(txt.replace(/\n/g, " ")) && txt.includes(`Fecha del pedido: ${dmy(ped1.fecha)}`) && (await card.getByTestId("stage-pill").innerText()) === "Pedido recibido", txt.replace(/\s+/g, " ").slice(0, 160));
  check("la fecha del formulario (DD/MM/AA) es la del pedido guardado", fechaForm.length > 0 && ped1.fecha === arToday(), `${fechaForm} → ${ped1.fecha}`);
  await portal.screenshot({ path: `${OUT}/03-portal-pedido-recibido.png`, fullPage: true });
  check("el cliente parecido «GENUS TEST 2» NO ve el pedido", !(await portal2.locator("body").innerText()).includes("SHAMPOO GENUS TEST") && (await portal2.getByTestId("product-card").count()) === 0);

  // Segundo pedido por el MISMO formulario, con estado manual «EN ELABORACIÓN» (caso que antes quedaba invisible) y nombre con otra escritura.
  await prod.page.getByRole("button", { name: /nuevo pedido/i }).click();
  await prod.page.getByTestId("pedido-form-cliente").fill(`  Genus Test ${RUN}  `);
  await prod.page.getByTestId("pedido-form-cliente-estado").filter({ hasText: "vínculo por ID" }).waitFor({ timeout: 15_000 });
  await prod.page.getByTestId("pedido-form-op").fill(`OP-${RUN}-2`);
  await prod.page.getByTestId("pedido-form-producto").fill("CREMA GENUS TEST");
  await prod.page.getByTestId("pedido-form-q").fill("40");
  await prod.page.getByTestId("pedido-form-estado").selectOption("EN_ELABORACION");
  await prod.page.getByTestId("pedido-form-guardar").click();
  await prod.page.waitForFunction(() => !document.querySelector("[data-testid=pedido-form-producto]"), null, { timeout: 30_000 });
  const cardCrema = portal.getByTestId("product-card").filter({ hasText: "CREMA GENUS TEST" });
  await cardCrema.waitFor({ timeout: 60_000 });
  check("un pedido con estado manual «EN ELABORACIÓN» y sin trabajos también aparece (antes quedaba invisible)", (await cardCrema.getByTestId("stage-pill").innerText()) === "En elaboración");

  // ───────── 5. Movimientos entre sectores: el portal abierto se actualiza solo ─────────
  const production = await apiCtx(E2E_USERS.produccion);
  const envasadoApi = await apiCtx(E2E_USERS.envasado);
  const today = new Date();
  const weekStart = mondayOf(today);
  let weekId = (await (await production.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()).weeks?.[0]?.id;
  if (!weekId) weekId = (await (await production.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E portal vínculo" } })).json()).week.id;
  const plannedDate = today.getUTCDay() === 0 || today.getUTCDay() === 6 ? weekStart : today.toISOString().slice(0, 10);
  const mkItem = await production.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { plannedDate, unit: "un", client: NAME, product: "SHAMPOO GENUS TEST", plannedQuantity: "250", sector: "ELABORACION", branchOwner: "Cristian" } });
  if (mkItem.status() !== 201) throw new Error(`crear trabajo: ${await mkItem.text()}`);
  const workId = (await mkItem.json()).item.id;
  await q("update work_items set production_pedido_id = $2::uuid where id = $1", [workId, ped1.id]);
  await card.getByTestId("stage-pill").filter({ hasText: "Pedido programado" }).waitFor({ timeout: 60_000 });
  check("al asignarse el trabajo el portal pasa solo a «Pedido programado»", true);
  await q("update work_items set operational_status = 'en_curso' where id = $1", [workId]);
  await card.getByTestId("stage-pill").filter({ hasText: "En elaboración" }).waitFor({ timeout: 60_000 });
  check("elaboración en curso → «En elaboración» sin recargar", true);
  sends += (await cron()).push.enviadas;
  await q("update work_items set sector = 'ENVASADO_MASIVO', branch_owner = null, line = 'Línea 1', progress_updated_at = now() where id = $1", [workId]);
  await card.getByTestId("stage-pill").filter({ hasText: "En envasado" }).waitFor({ timeout: 60_000 });
  check("pasa a Envasado → «En envasado» sin recargar", true);
  sends += (await cron()).push.enviadas;
  await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [workId]);
  const mk = await envasadoApi.post("/api/v1/disponibilidad", { data: { action: "mark", workItemId: workId, idempotencyKey: `e2e-pv-${RUN}` } });
  if (mk.status() >= 300) {
    await q("insert into portal_availability_marks (work_item_id, quantity, unit, delivered_before, client_name, product, sector, marked_by, idempotency_key) values ($1, 250, 'un', 0, $2, 'SHAMPOO GENUS TEST', 'ENVASADO_MASIVO', 'e2e-envasado@genus.test', $3)", [workId, NAME, `e2e-pv-${RUN}`]);
  }
  await card.getByTestId("stage-pill").filter({ hasText: "Listo para entregar" }).waitFor({ timeout: 60_000 });
  check("Envasado confirma «Listo para entregar» → el portal lo refleja sin recargar ni cerrar sesión", (await portal.evaluate(() => window.__marker)) === "vivo" && (await portal.evaluate(() => performance.getEntriesByType("navigation").length)) === 1);
  await portal.screenshot({ path: `${OUT}/04-portal-listo.png`, fullPage: true });
  check("el cliente parecido sigue sin ver nada de «GENUS TEST»", (await portal2.getByTestId("product-card").count()) === 0);

  // ───────── 6. Avisos push: misma asociación por ID, outbox simulada ─────────
  const last = await cron();
  await cron();
  sends += last.push.enviadas;
  const ev = await eventsOf(OP1);
  check("cada movimiento del pedido de «GENUS TEST» generó UN evento (Recibido → Elaboración → Envasado → Listo), todos simulados", JSON.stringify(ev.map((e) => e.event_type)) === JSON.stringify(["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"]) && ev.every((e) => e.status === "SIMULADA" && e.mode === "SIMULADO"), JSON.stringify(ev.map((e) => e.event_type)));
  check("0 envíos reales con el envío general APAGADO", sends === 0 && (await q("select global_send_enabled from portal_push_settings where id = 1"))[0].global_send_enabled === false);
  check("sin duplicados en toda la outbox", (await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d"))[0].n === 0);
  check("ningún evento cruzó a «GENUS TEST 2» ni a «GENUS»", (await q("select count(*)::int as n from portal_push_outbox where client_id = any($1::uuid[])", [[id2, id3]]))[0].n === 0);

  // ───────── 7. Aislamiento de la API del portal ─────────
  const ov = await (await ctxC.request.get(`/entregas/api/overview?clientId=${id2}&client=${encodeURIComponent(NAME2)}&user=genustest2`)).json();
  check("la API del portal ignora cualquier parámetro de cliente/usuario: siempre el de la sesión", ov.client.name === NAME && !JSON.stringify(ov).includes(NAME2) && ov.orders.length >= 1);

  // ───────── 8. Panel de problemas de vínculo (Dirección) ─────────
  await dir.page.reload();
  await dir.page.getByText("Portal de Clientes").first().click();
  await dir.page.getByTestId("portal-id-linking").waitFor({ timeout: 30_000 });
  check("Dirección ve el reporte de vínculo por ID en «Problemas de vinculación»", /Vínculo por ID de pedidos históricos/.test(await dir.page.getByTestId("portal-id-linking").innerText()));
  await dir.page.screenshot({ path: `${OUT}/05-problemas-vinculo.png`, fullPage: true });
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
