// E2E en Chromium real (PC y tablet): pestaña «Entregados» de Envasado Masivo y Premium + «Quitar del listado» (soft-hide). Base DESCARTABLE.
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
const OUT = process.env.OUT ?? "/tmp/envasado-entregados";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-ENTR";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select id, quantity, kind, status, cumulative_after, pending_after, delivered_by, delivered_by_sector from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const status = async (id) => (await q("select operational_status, planned_quantity from work_items where id = $1", [id]))[0];
const ids = {};

async function login(user, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const card = (page, product) => page.locator("[data-testid=work-item-card]", { hasText: product }).first();

const tab = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}`) }).or(page.getByRole("tab", { name: new RegExp(`^${label}`) })).first();
const rowsOf = (page) => page.locator("[data-testid=entregado-row]");
async function deliverUi(page, product, qty) {
  await tab(page, "Semanas").click();
  await card(page, product).waitFor({ timeout: 120_000 });
  await card(page, product).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill(String(qty));
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
}
const openEntregados = async (page) => { await tab(page, "Entregados").click(); await page.locator("[data-testid=envasado-entregados]").waitFor({ timeout: 60_000 }); };

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E entregados" } })).json()).week.id;
  const mk = async (sector, product, qty, client) => {
    const r = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client, plannedQuantity: qty, unit: "un.", product, sector, line: "Línea 1" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  const PM = "CREMA CORPORAL ENTR MASIVO";
  const PP = "SERUM ENTR PREMIUM";
  ids.m = await mk("ENVASADO_MASIVO", PM, "1000", "JACTANS ENTR");
  ids.p = await mk("ENVASADO_PREMIUM", PP, "1000", "JACTANS ENTR");
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  await q("update work_items set finished_qty = '1000' where id = $1", [ids.m]);
  await q("update work_items set finished_qty = '1015' where id = $1", [ids.p]);

  // ================= ENVASADO MASIVO (computadora) =================
  const env = await login(E2E_USERS.envasado, { width: 1500, height: 950 });
  const p = env.page;
  await card(p, PM).waitFor({ timeout: 120_000 });
  const tabLabels = await p.locator("[role=tablist] button, [role=tablist] [role=tab]").allInnerTexts().catch(() => []);
  const flat = tabLabels.map((t) => t.replace(/\s+\d+$/, "").trim());
  const iP = flat.findIndex((t) => /^Pendientes/.test(t));
  check("Masivo ve las pestañas Pendientes | Entregados, una al lado de la otra", iP >= 0 && /^Entregados/.test(flat[iP + 1] ?? ""), JSON.stringify(flat));
  await openEntregados(p);
  await p.locator("[data-testid=entregados-empty]").waitFor({ timeout: 30_000 }).catch(() => undefined);
  check("sin entregas todavía: mensaje vacío claro", (await p.locator("[data-testid=entregados-empty]").count()) === 1);

  await deliverUi(p, PM, 300);
  check("entrega parcial de 300 registrada una sola vez", await waitDb(async () => (await lines(ids.m)).length === 1));
  await openEntregados(p);
  await p.locator("[data-testid=entregado-row]").first().waitFor({ timeout: 60_000 });
  const t1 = (await rowsOf(p).first().innerText()).replace(/\s+/g, " ");
  check("la entrega parcial aparece en Entregados: cliente, producto, cantidad real 300, tipo Parcial, sector → destino, usuario", /JACTANS ENTR/.test(t1) && /CREMA CORPORAL ENTR MASIVO/.test(t1) && /300/.test(t1) && /Parcial/.test(t1) && /Envasado Masivo → Producción/.test(t1) && /E2E Envasado/.test(t1), t1.slice(0, 300));
  check("el trabajo sigue pendiente (saldo real 700)", (await status(ids.m)).operational_status !== "entregado");
  await tab(p, "Pendientes").click();
  check("el trabajo parcialmente entregado sigue apareciendo en Pendientes", (await p.getByText(PM).count()) > 0);

  await deliverUi(p, PM, 700);
  check("segunda entrega (700) registrada", await waitDb(async () => (await lines(ids.m)).length === 2));
  await openEntregados(p);
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length >= 2, null, { timeout: 60_000 });
  const qtys = (await rowsOf(p).locator("[data-testid=entregado-qty]").allInnerTexts()).map((t) => t.replace(/\D/g, "")).sort();
  check("Entregados muestra AMBAS entregas (300 y 700) sin reemplazar la primera", JSON.stringify(qtys) === JSON.stringify(["300", "700"]), JSON.stringify(qtys));
  check("el trabajo quedó entregado (sale de Pendientes por las reglas existentes)", (await status(ids.m)).operational_status === "entregado");
  await rowsOf(p).first().locator("[data-testid=entregado-detalle]").click();
  check("el detalle muestra cajas y saldo (sin inventar datos)", /Sin detalle de cajas|cajas/i.test(await rowsOf(p).first().innerText()));
  await p.screenshot({ path: `${OUT}/1-masivo-entregados.png` });

  // ---- Quitar del listado ----
  const snap = async () => JSON.stringify({ l: await lines(ids.m), s: await status(ids.m), r: (await q("select count(*)::int n from remitos"))[0].n, c: (await q("select count(*)::int n from internal_delivery_changes"))[0].n });
  const before = await snap();
  await rowsOf(p).first().locator("[data-testid=entregado-hide]").click();
  const conf = p.locator("[data-testid=entregado-hide-confirm]");
  await conf.waitFor({ timeout: 15_000 });
  check("pide confirmación antes de quitar y aclara que no anula la entrega", /NO se anula/.test(await conf.innerText()));
  await conf.getByRole("button", { name: "Cancelar" }).click();
  check("cancelar la confirmación no oculta nada", (await rowsOf(p).count()) === 2 && (await q("select count(*)::int n from internal_delivery_hides"))[0].n === 0);
  await rowsOf(p).first().locator("[data-testid=entregado-hide]").click();
  await p.locator("[data-testid=entregado-hide-confirm-yes]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 1, null, { timeout: 30_000 });
  check("quitar del listado: la entrega desaparece de la lista operativa", (await rowsOf(p).count()) === 1);
  check("NO se modificó cantidades, estado, remitos ni historial de cambios (la entrega sigue guardada)", (await snap()) === before && (await q("select count(*)::int n from internal_delivery_hides where hidden"))[0].n === 1);
  await p.reload();
  await openEntregados(p).catch(async () => { await card(p, PM).waitFor({ timeout: 5000 }).catch(() => undefined); });
  check("el ocultamiento persiste tras recargar", (await rowsOf(p).count()) === 1);
  await p.locator("[data-testid=entregados-toggle-hidden]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row][data-hidden='1']").length === 1, null, { timeout: 30_000 });
  check("«Mostrar ocultos» lista la entrega quitada", (await rowsOf(p).count()) === 1);
  await p.screenshot({ path: `${OUT}/2-masivo-ocultos.png` });
  await rowsOf(p).first().locator("[data-testid=entregado-restore]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 0, null, { timeout: 30_000 });
  await p.locator("[data-testid=entregados-toggle-hidden]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 2, null, { timeout: 30_000 });
  check("restaurar devuelve la entrega al listado (2 entregas) sin alterar nada", (await rowsOf(p).count()) === 2 && (await snap()) === before);

  // ---- Filtros y buscador ----
  await p.locator("[data-testid=entregados-q]").fill("zzz-no-existe");
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 0, null, { timeout: 30_000 });
  await p.locator("[data-testid=entregados-q]").fill("jactans");
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 2, null, { timeout: 30_000 });
  await p.locator("[data-testid=entregados-tipo]").selectOption("PARCIAL");
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length === 1, null, { timeout: 30_000 });
  check("buscador por cliente y filtro Parcial/Total funcionan", (await rowsOf(p).count()) === 1);
  await p.locator("[data-testid=entregados-tipo]").selectOption("");
  await p.locator("[data-testid=entregados-q]").fill("");
  const masivoDelivery = (await lines(ids.m))[0];

  // ================= ENVASADO PREMIUM (tablet) =================
  const pre = await login(E2E_USERS.envasadoPremium, { width: 1024, height: 768 });
  const pp = pre.page;
  await card(pp, PP).waitFor({ timeout: 120_000 });
  await deliverUi(pp, PP, 305);
  await deliverUi(pp, PP, 710);
  check("Premium registró 305 + 710 (supera lo solicitado: 1.000)", await waitDb(async () => (await lines(ids.p)).length === 2));
  await openEntregados(pp);
  await pp.waitForFunction(() => document.querySelectorAll("[data-testid=entregado-row]").length >= 2, null, { timeout: 60_000 });
  const pq = (await rowsOf(pp).locator("[data-testid=entregado-qty]").allInnerTexts()).map((t) => Number(t.replace(/\D/g, ""))).sort((a, b) => a - b);
  check("Premium (tablet) ve sus dos entregas con cantidades reales 305 y 710 (total 1.015)", JSON.stringify(pq) === "[305,710]" && pq[0] + pq[1] === 1015, JSON.stringify(pq));
  const allText = await pp.locator("[data-testid=entregados-list]").innerText();
  check("Premium NO ve las entregas de Masivo", !/CREMA CORPORAL ENTR MASIVO/.test(allText));
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check("en tablet la pestaña no genera desplazamiento horizontal", !overflow);
  await pp.screenshot({ path: `${OUT}/3-premium-tablet.png` });

  // ---- Permisos cruzados en el servidor ----
  const cross = await pre.ctx.request.post("/api/v1/internal-deliveries", { data: { action: "hide", kind: "PRODUCCION", id: masivoDelivery.id } });
  check("Premium no puede ocultar una entrega de Masivo (403)", cross.status() === 403, String(cross.status()));
  const pLine = (await lines(ids.p))[0];
  const cross2 = await env.ctx.request.post("/api/v1/internal-deliveries", { data: { action: "hide", kind: "PRODUCCION", id: pLine.id } });
  check("Masivo no puede ocultar una entrega de Premium (403)", cross2.status() === 403, String(cross2.status()));
  // Premium oculta la suya: Masivo y Producción no se enteran
  const hideOwn = await pre.ctx.request.post("/api/v1/internal-deliveries", { data: { action: "hide", kind: "PRODUCCION", id: pLine.id } });
  check("Premium puede ocultar la suya (200)", hideOwn.status() === 200, String(hideOwn.status()));

  // ---- Producción conserva el historial completo ----
  const pr = await login(E2E_USERS.produccion, { width: 1500, height: 950 });
  const all = await (await pr.ctx.request.get("/api/v1/internal-deliveries?limit=200")).json();
  const mine = (all.items ?? []).filter((d) => d.workItemId === ids.m || d.workItemId === ids.p);
  check("Producción ve las 4 entregas, incluida la que Premium quitó de su listado", mine.length === 4 && mine.some((d) => d.id === pLine.id), String(mine.length));
  const prHide = await pr.ctx.request.post("/api/v1/internal-deliveries", { data: { action: "hide", kind: "PRODUCCION", id: pLine.id } });
  check("Producción no oculta entregas de otros sectores (403)", prHide.status() === 403, String(prHide.status()));
  const dr = await login(E2E_USERS.direccion, { width: 1500, height: 950 });
  const drAll = await (await dr.ctx.request.get("/api/v1/internal-deliveries?limit=200")).json();
  check("Dirección conserva el historial completo", (drAll.items ?? []).filter((d) => d.workItemId === ids.p).length === 2);
  await pre.ctx.close(); await env.ctx.close(); await pr.ctx.close(); await dr.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
