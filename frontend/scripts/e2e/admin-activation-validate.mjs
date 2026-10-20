// E2E (Chromium, TABLET, build de producción): activación de la cuenta de Administración desde el navegador. Base DESCARTABLE.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID, randomBytes } from "node:crypto";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/admin-activation";
mkdirSync(OUT, { recursive: true });
const EMAIL = "admin@laboratoriogenus.com.ar";
const TAG = "E2E-ACT";
const CLIENT = "CLIENTE ACT SA";
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const tablet = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 };
const SECRET = `Tab-${randomBytes(8).toString("base64url")}-7!`;

async function login(user, password = E2E_PASSWORD) {
  const ctx = await browser.newContext({ baseURL: BASE, ...tablet });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}

try {
  await q("delete from genus_auth_sessions where user_id in (select id from genus_auth_users where email_normalized = $1)", [EMAIL]);
  await q("delete from genus_auth_users where email_normalized = $1", [EMAIL]);
  await q("delete from genus_auth_activations");
  const others = await q("select email_normalized, password_hash, sector, status from genus_auth_users order by email_normalized");

  // ── Autorización del lado del servidor ───────────────────────────────────────────────────────────────────────────
  const anon = await pwRequest.newContext({ baseURL: BASE });
  check("sin sesión no se puede emitir un enlace (401)", (await anon.post("/api/v1/auth/admin/activation")).status() === 401);
  const bogus = await anon.post("/api/v1/auth/activar-administracion", { data: { action: "redeem", token: randomBytes(32).toString("base64url"), password: SECRET } });
  check("canjear un token inventado → 404 y no se crea ningún usuario", bogus.status() === 404 && (await q("select 1 from genus_auth_users where email_normalized = $1", [EMAIL])).length === 0);
  check("el endpoint público no acepta crear con otro sector/rol ni sin token", (await anon.post("/api/v1/auth/activar-administracion", { data: { action: "redeem", sector: "PRODUCCION", password: SECRET } })).status() === 404);
  await anon.dispose();
  const prod = await login(E2E_USERS.produccion);
  const pPost = await prod.page.request.post("/api/v1/auth/admin/activation");
  check("Producción NO puede emitir enlaces ni otorgarse permisos administrativos (404)", pPost.status() === 404 && (await prod.page.request.get("/api/v1/auth/admin/activation")).status() === 404 && (await q("select 1 from genus_auth_activations")).length === 0);
  const pPage = await prod.page.goto("/administracion/usuarios");
  check("la página de usuarios no existe para Producción (404)", pPage?.status() === 404);
  await prod.ctx.close();

  // ── Superadministrador (cuenta de prueba E2E definida como GENUS_SUPERADMIN_EMAIL) ───────────────────────────────────
  const sa = await login(E2E_USERS.direccion);
  await sa.page.goto("/administracion/usuarios");
  await sa.page.locator("[data-testid=admin-activation-missing]").waitFor({ timeout: 60_000 });
  check("el superadministrador ve que la cuenta todavía no existe", true);
  await sa.page.screenshot({ path: `${OUT}/tablet-superadmin-card.png` });
  await sa.page.locator("[data-testid=admin-activation-generate]").tap();
  const linkText = await sa.page.locator("[data-testid=admin-activation-link]").innerText();
  check("genera un enlace con el token en el fragmento (#t=…), una sola vez", /\/activar-administracion#t=[A-Za-z0-9_-]{43}$/.test(linkText), linkText.replace(/t=.*/, "t=<oculto>"));
  const token = linkText.split("#t=")[1];
  const act = (await q("select token_hash, expires_at, used_at from genus_auth_activations"))[0];
  check("en la base solo queda el hash del token (nunca el token) y vence en ≤ 30 min", act.token_hash !== token && act.token_hash.length === 64 && act.used_at === null && new Date(act.expires_at) - Date.now() <= 30 * 60_000 + 5_000);
  await sa.ctx.close();

  // ── Activación desde el navegador de la tablet (sin sesión) ────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ baseURL: BASE, ...tablet });
  const page = await ctx.newPage();
  await page.goto(`/activar-administracion#t=${token}`);
  await page.locator("[data-testid=activar-form]").waitFor({ timeout: 60_000 });
  check("el enlace abre el formulario con el correo fijo y borra el token de la barra de direcciones", (await page.locator("[data-testid=activar-email]").innerText()) === EMAIL && !page.url().includes("t="));
  await page.screenshot({ path: `${OUT}/tablet-activar.png` });
  await page.locator("[data-testid=activar-pw]").fill("admin123");
  await page.locator("[data-testid=activar-pw2]").fill("admin123");
  await page.locator("[data-testid=activar-submit]").tap();
  check("rechaza «admin123» y contraseñas débiles", (await page.locator("[data-testid=activar-error]").isVisible()) && (await q("select 1 from genus_auth_users where email_normalized = $1", [EMAIL])).length === 0);
  await page.locator("[data-testid=activar-pw]").fill(SECRET);
  await page.locator("[data-testid=activar-pw2]").fill(`${SECRET}x`);
  await page.locator("[data-testid=activar-submit]").tap();
  check("rechaza contraseñas que no coinciden", /no coinciden/i.test(await page.locator("[data-testid=activar-error]").innerText()));
  await page.locator("[data-testid=activar-pw2]").fill(SECRET);
  await page.locator("[data-testid=activar-submit]").tap();
  await page.locator("[data-testid=activar-done]").waitFor({ timeout: 30_000 });
  const user = (await q("select sector, role_id, status, password_hash, role_label from genus_auth_users where email_normalized = $1", [EMAIL]))[0];
  check("se crea la cuenta: Administración, ROL-AD, ACTIVO", user?.sector === "ADMINISTRACION" && user.role_id === "ROL-AD" && user.status === "ACTIVO");
  check("solo se guardó un hash bcrypt (nunca la contraseña)", /^\$2[aby]\$12\$/.test(user.password_hash) && !user.password_hash.includes(SECRET));
  const audit = await q("select detail::text d from genus_auth_audit_events where email_normalized = $1 order by created_at", [EMAIL]);
  check("queda auditado (emitido por el superadmin y canjeado) sin token ni contraseña", audit.length >= 2 && audit.every((r) => !r.d.includes(SECRET) && !r.d.includes(token)) && audit.some((r) => /activation_issued/.test(r.d)) && audit.some((r) => /activation_redeemed/.test(r.d) && /"superadmin": false/.test(r.d)));
  check("el enlace queda usado", (await q("select used_at from genus_auth_activations"))[0].used_at !== null);
  await ctx.close();

  // Reuso, vencimiento y carreras.
  const reuse = await pwRequest.newContext({ baseURL: BASE });
  const again = await reuse.post("/api/v1/auth/activar-administracion", { data: { action: "redeem", token, password: `${SECRET}-2` } });
  check("un enlace ya usado no sirve (404)", again.status() === 404);
  const sa2 = await login(E2E_USERS.direccion);
  const dupIssue = await sa2.page.request.post("/api/v1/auth/admin/activation");
  check("con la cuenta ya creada no se emite otro enlace ni se pisa la cuenta (409)", dupIssue.status() === 409);
  const st = await (await sa2.page.request.get("/api/v1/auth/admin/activation")).json();
  check("el estado informa que la cuenta existe", st.status.exists === true && st.status.sector === "ADMINISTRACION");
  await q("delete from genus_auth_sessions where user_id = (select id from genus_auth_users where email_normalized = $1)", [EMAIL]);
  await q("delete from genus_auth_users where email_normalized = $1", [EMAIL]);
  const iss = await (await sa2.page.request.post("/api/v1/auth/admin/activation")).json();
  const t2 = iss.url.split("#t=")[1];
  await q("update genus_auth_activations set expires_at = now() - interval '1 minute' where token_hash is not null and used_at is null");
  const exp = await reuse.post("/api/v1/auth/activar-administracion", { data: { action: "redeem", token: t2, password: SECRET } });
  check("un enlace vencido no sirve (404)", exp.status() === 404 && (await q("select 1 from genus_auth_users where email_normalized = $1", [EMAIL])).length === 0);
  const t3 = (await (await sa2.page.request.post("/api/v1/auth/admin/activation")).json()).url.split("#t=")[1];
  check("emitir uno nuevo revoca el anterior", (await q("select count(*)::int n from genus_auth_activations where used_at is null and revoked_at is null and expires_at > now()"))[0].n === 1);
  const race = await Promise.all([1, 2, 3].map(() => reuse.post("/api/v1/auth/activar-administracion", { data: { action: "redeem", token: t3, password: SECRET } })));
  const okCount = race.filter((r) => r.status() === 200).length;
  check("tres canjes simultáneos del mismo enlace: se crea una sola cuenta", okCount === 1 && (await q("select count(*)::int n from genus_auth_users where email_normalized = $1", [EMAIL]))[0].n === 1);
  await reuse.dispose();
  await sa2.ctx.close();
  const after = await q("select email_normalized, password_hash, sector, status from genus_auth_users where email_normalized <> $1 order by email_normalized", [EMAIL]);
  check("ninguna cuenta existente fue modificada", JSON.stringify(after) === JSON.stringify(others));

  // ── Login y acceso al Control de facturación + avisos ─────────────────────────────────────────────────────────────
  const api = await pwRequest.newContext({ baseURL: BASE });
  await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E activación" } })).json()).week.id;
  const item = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLIENT, plannedQuantity: "400", unit: "un", product: "PRODUCTO ACT", sector: "ENVASADO_MASIVO", line: "Línea 1" } });
  const itemId = String((await item.json()).item.id).replace(/^native:/, "");
  await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [itemId]);
  const del = await api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${itemId}`, actorSectorId: "PRODUCCION", deliverQuantity: 150, idempotencyKey: `act-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "", deliveryPackingGroups: [{ cajas: 3, unidadesPorCaja: 50 }] } });
  check("(preparación) Producción registra una entrega parcial de 150 u.", del.ok(), String(del.status()));
  const nu = await login({ email: EMAIL }, SECRET);
  await nu.page.locator("[data-testid=billing-view]").waitFor({ timeout: 120_000 });
  check("la cuenta nueva inicia sesión y entra al Control de facturación", true);
  await nu.page.locator("[data-testid=billing-tab-control]").tap();
  await nu.page.locator("[data-testid=billing-search]").fill("CLIENTE ACT");
  await nu.page.locator("[data-testid=billing-row]").first().waitFor({ timeout: 30_000 });
  check("ve la entrega real (150 entregadas, PENDIENTE DE FACTURAR)", /PENDIENTE DE FACTURAR/.test(await nu.page.locator("[data-testid=billing-row]").first().innerText()));
  const notifs = await (await nu.page.request.get("/api/v1/notifications?all=1")).json();
  const mine = (notifs.notifications ?? []).filter((n) => /CLIENTE ACT/.test(`${n.title} ${n.message}`));
  check("recibe el aviso automático de la entrega parcial", mine.some((n) => /ENTREGA PARCIAL REGISTRADA/.test(n.title) && /Entregado acumulado: 150/.test(n.message)), mine.map((n) => n.title).join(" | "));
  await nu.page.screenshot({ path: `${OUT}/tablet-cuenta-nueva.png` });
  const invoice = await nu.page.request.post("/api/v1/billing/invoices", { data: { invoiceNumber: "ACT-1", invoiceDate: TODAY, lines: [{ deliveryLineId: (await q("select id from work_item_delivery_lines where work_item_id = $1", [itemId]))[0].id, quantity: 50 }], idempotencyKey: randomUUID() } });
  check("puede registrar facturación (201)", invoice.status() === 201);
  check("no es superadmin: no administra usuarios ni emite enlaces (404)", (await nu.page.request.get("/api/v1/auth/admin/users")).status() === 404 && (await nu.page.request.post("/api/v1/auth/admin/activation")).status() === 404);
  const adminPage = await nu.page.goto("/administracion/usuarios");
  check("la pantalla de usuarios no existe para la cuenta nueva", adminPage?.status() === 404);
  await nu.ctx.close();
  await api.dispose();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("delete from billing_invoice_lines where invoice_id in (select id from billing_invoices where client = $1)", [CLIENT]).catch(() => undefined);
  await q("delete from billing_invoices where client = $1", [CLIENT]).catch(() => undefined);
  await q("delete from os_notifications where message like '%CLIENTE ACT%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await q("delete from genus_auth_sessions where user_id in (select id from genus_auth_users where email_normalized = $1)", [EMAIL]).catch(() => undefined);
  await q("delete from genus_auth_users where email_normalized = $1", [EMAIL]).catch(() => undefined);
  await q("delete from genus_auth_activations").catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
