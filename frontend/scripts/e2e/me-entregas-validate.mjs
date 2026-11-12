// E2E en Chromium real: CONTROL DE ME por Depósito (visible en todas las vistas) + ENTREGAS FLEXIBLES (caso JACTANS). Base DESCARTABLE; login real.
import { randomUUID } from "node:crypto";
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
const OUT = process.env.OUT ?? "/tmp/me-entregas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const TAG = "E2E-ME";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

async function login(user, viewport = { width: 1500, height: 1000 }) {
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
const apiAs = async (user) => { const a = await pwRequest.newContext({ baseURL: BASE }); if ((await a.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error(`login ${user.email}`); return a; };
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const card = (page, product) => page.locator("[data-testid=work-item-card], [data-testid=week-job-card]", { hasText: product }).first();
const stockCount = async () => Number((await q("select (select count(*) from mp_stock_movements) + (select count(*) from inv_me_ingresos) + (select count(*) from inv_me_salidas) n"))[0].n);

const wk = mondayOf(TODAY);
const P = { masivo: "SERUM JACTANS MASIVO", premium: "CREMA PREMIUM ME", elab: "BASE ELABORACION ME", entrega: "GEL JACTANS ENTREGA", cajas: "LOCION CAJAS FLEX" };
const ids = {};
const meText = async (loc) => (await loc.locator("[data-testid=me-badge]").first().innerText()).replace(/\s+/g, " ").trim();

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [wk]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${wk}`)).json();
  const weekId = list.weeks?.[0]?.id ?? (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart: wk, label: "E2E ME" } })).json()).week.id;
  const mk = async (sector, product, qty, unit, date, extra) => {
    const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: `${TAG} obs`, plannedDate: date, client: "JACTANS E2E SA", plannedQuantity: qty, unit, product, sector, ...extra } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.masivo = await mk("ENVASADO_MASIVO", P.masivo, "1000", "un.", TODAY, { line: "Línea 1" });
  ids.premium = await mk("ENVASADO_PREMIUM", P.premium, "500", "un.", addDays(wk, 1), { line: "Línea 1" });
  ids.elab = await mk("ELABORACION", P.elab, "60", "kg", addDays(wk, 2), { branchOwner: "Cristian" });
  ids.entrega = await mk("ENVASADO_MASIVO", P.entrega, "1000", "un.", TODAY, { line: "Línea 1" });
  ids.cajas = await mk("ENVASADO_MASIVO", P.cajas, "1000", "un.", TODAY, { line: "Línea 1" });
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  const stock0 = await stockCount();

  // ===== ME: estado inicial «Sin info» en todas las vistas =====
  const env = await login(E2E_USERS.envasado);
  await card(env.page, P.masivo).waitFor({ timeout: 120_000 });
  check("Envasado Masivo · vista Día/Mi trabajo: la tarjeta muestra «ME: Sin info»", (await meText(card(env.page, P.masivo))) === "ME: Sin info");
  await env.page.getByRole("button", { name: "Semana", exact: true }).click();
  await card(env.page, P.masivo).waitFor({ timeout: 60_000 });
  check("Envasado Masivo · Semana: «ME: Sin info»", (await meText(card(env.page, P.masivo))) === "ME: Sin info");
  await env.page.screenshot({ path: `${OUT}/1-envasado-semana.png` });

  const pr = await login(E2E_USERS.produccion);
  await nav(pr.page, "Vista mensual");
  await pr.page.locator("[data-testid=vista-mensual]").waitFor({ timeout: 120_000 });
  await pr.page.locator("[data-testid=vm-tab-ENVASADO_MASIVO]").click();
  const chipOf = (page, p) => page.locator("[data-testid=month-chip]", { hasText: p }).first();
  await chipOf(pr.page, P.masivo).waitFor({ timeout: 60_000 });
  check("Vista mensual (Producción, Envasado Masivo): la tarjeta muestra «ME: Sin info» sin abrir el detalle", /ME: Sin info/.test(await chipOf(pr.page, P.masivo).innerText()));
  await pr.page.locator("[data-testid=vm-tab-ELABORACION]").click();
  await chipOf(pr.page, P.elab).waitFor({ timeout: 60_000 });
  check("un trabajo exclusivo de Elaboración NO lleva ME", !/ME:/.test(await chipOf(pr.page, P.elab).innerText()));
  await pr.page.locator("[data-testid=vm-tab-ENVASADO_MASIVO]").click();

  // ===== Depósito controla =====
  const dep = await login(E2E_USERS.deposito);
  await nav(dep.page, "ME de Envasado");
  await dep.page.locator("[data-testid=deposito-me-envasado]").waitFor({ timeout: 120_000 });
  const rowOf = (p) => dep.page.locator("[data-testid=me-row]", { hasText: p }).first();
  await rowOf(P.masivo).waitFor({ timeout: 60_000 });
  const rtxt = (await rowOf(P.masivo).innerText()).replace(/\s+/g, " ");
  check("Depósito ve cliente, producto, fecha, sector de Envasado, cantidad y estado ME (Sin info)", /JACTANS E2E SA/.test(rtxt) && /Masivo/.test(rtxt) && /1000 un\./.test(rtxt) && /ME: Sin info/.test(rtxt), rtxt.slice(0, 160));
  check("los trabajos de Elaboración no aparecen en el control de ME", (await dep.page.locator("[data-testid=me-row]", { hasText: P.elab }).count()) === 0);
  await rowOf(P.masivo).locator("[data-testid=me-set-OK]").click();
  check("Depósito marca ✅", await waitDb(async () => (await q("select me_status from work_items where id = $1", [ids.masivo]))[0].me_status === "OK"));
  const obs = rowOf(P.premium).locator("[data-testid=me-observation-input]");
  await obs.fill("Faltan 300 pomos de 200 ml");
  await rowOf(P.premium).locator("[data-testid=me-set-NO_OK]").click();
  check("Depósito marca ❌ con observación", await waitDb(async () => { const r = (await q("select me_status, me_observation, me_updated_by from work_items where id = $1", [ids.premium]))[0]; return r.me_status === "NO_OK" && r.me_observation === "Faltan 300 pomos de 200 ml" && /Depósito/.test(r.me_updated_by); }));
  await rowOf(P.masivo).locator("[data-testid=me-set-NO_OK]").click();
  await rowOf(P.masivo).locator("[data-testid=me-set-OK]").click();
  check("cambia de ❌ a ✅ y queda el historial (quién, cuándo, estado anterior)", await waitDb(async () => { const h = await q("select from_status, to_status, actor_sector from work_item_me_history where work_item_id = $1 order by created_at", [ids.masivo]); return JSON.stringify(h.map((x) => [x.from_status, x.to_status])) === JSON.stringify([[null, "OK"], ["OK", "NO_OK"], ["NO_OK", "OK"]]) && h.every((x) => x.actor_sector === "DEPOSITO"); }));
  await dep.page.screenshot({ path: `${OUT}/2-deposito-me.png` });

  // ===== Todos los sectores ven lo mismo =====
  await env.page.locator("[data-testid=semanas-sector-reload], button:has-text('Actualizar')").first().click().catch(() => undefined);
  await env.page.reload();
  await env.page.getByRole("button", { name: "Semana", exact: true }).click();
  await card(env.page, P.masivo).waitFor({ timeout: 60_000 });
  check("Envasado Masivo · Semana ve ME: ✅ (mismo estado)", (await meText(card(env.page, P.masivo))) === "ME: ✅");
  await pr.page.reload();
  await nav(pr.page, "Vista mensual");
  await pr.page.locator("[data-testid=vm-tab-ENVASADO_MASIVO]").click();
  await chipOf(pr.page, P.masivo).waitFor({ timeout: 60_000 });
  check("Vista mensual (Producción) ve ME: ✅ en Masivo", /ME: ✅/.test(await chipOf(pr.page, P.masivo).innerText()));
  await pr.page.locator("[data-testid=vm-tab-ENVASADO_PREMIUM]").click();
  await chipOf(pr.page, P.premium).waitFor({ timeout: 60_000 });
  check("Vista mensual (Producción) ve ME: ❌ en Premium", /ME: ❌/.test(await chipOf(pr.page, P.premium).innerText()));
  await chipOf(pr.page, P.premium).click();
  const jc = pr.page.locator("[data-testid=job-card-me]");
  await jc.waitFor({ timeout: 15_000 });
  check("al abrir el detalle se ve la observación de Depósito", /Faltan 300 pomos de 200 ml/.test(await jc.innerText()) && /ME: ❌/.test(await jc.innerText()), (await jc.innerText()).replace(/\s+/g, " "));
  await pr.page.screenshot({ path: `${OUT}/3-mensual-me.png` });
  await pr.page.keyboard.press("Escape");

  // ===== Reprogramar conserva el ME; permisos en el servidor =====
  const rs = await prodApi.post("/api/v1/live-sync/operations", { data: { action: "reschedule_work", itemId: `native:${ids.premium}`, plannedDate: addDays(wk, 4) } });
  check("Producción reprograma el trabajo con ME ❌", rs.ok());
  const after = (await q("select me_status, me_observation, planned_date::text d from work_items where id = $1", [ids.premium]))[0];
  check("el ME se conserva al reprogramar", after.me_status === "NO_OK" && after.me_observation === "Faltan 300 pomos de 200 ml" && after.d === addDays(wk, 4));
  const codes = {};
  for (const [label, user] of [["Producción", E2E_USERS.produccion], ["Materias Primas", E2E_USERS.materiaPrima], ["Envasado", E2E_USERS.envasado], ["Elaboración", E2E_USERS.elaboracion], ["Codificado", E2E_USERS.codificado], ["Calidad", E2E_USERS.calidad]]) {
    const a = await apiAs(user);
    codes[label] = (await a.post(`/api/v1/work-items/${ids.masivo}/me`, { data: { status: "NO_OK", observation: "hack" } })).status();
  }
  check("el servidor rechaza (403) a los demás sectores y el estado no cambia", Object.values(codes).every((c) => c === 403) && (await q("select me_status from work_items where id = $1", [ids.masivo]))[0].me_status === "OK", JSON.stringify(codes));
  const depApi = await apiAs(E2E_USERS.deposito);
  check("un trabajo de Elaboración no admite ME (400)", (await depApi.post(`/api/v1/work-items/${ids.elab}/me`, { data: { status: "OK" } })).status() === 400);
  check("marcar ME no generó movimientos de stock ni de inventario", (await stockCount()) === stock0);

  // ===== ENTREGAS FLEXIBLES (JACTANS): 1.000 = 300 + 700 con realizadas desactualizadas =====
  await q("update work_items set finished_qty = '300' where id = $1", [ids.entrega]);
  await env.page.reload();
  await card(env.page, P.entrega).waitFor({ timeout: 120_000 });
  await card(env.page, P.entrega).getByRole("button", { name: "Entregar parcial" }).click();
  let dlg = env.page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill("300");
  await dlg.locator("[data-testid=confirm-deliver]").click(); // sin desglose de cajas: se registra igual
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  check("1.ª entrega de 300 sin detallar cajas: se registra", await waitDb(async () => (await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [ids.entrega]))[0].n === 1));
  await env.page.reload();
  await card(env.page, P.entrega).waitFor({ timeout: 120_000 });
  await card(env.page, P.entrega).getByRole("button", { name: "Entregar parcial" }).click();
  dlg = env.page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill("700");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  const exceed = dlg.locator("[data-testid=deliver-confirm-produced]");
  await exceed.waitFor({ timeout: 10_000 });
  check("2.ª entrega de 700 con realizadas desactualizadas (300): explica la diferencia y ofrece confirmar lo realmente producido (sin callejón sin salida)", /realizad|disponible/i.test(await dlg.locator("[data-testid=deliver-error]").innerText()) && (await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [ids.entrega]))[0].n === 1);
  await env.page.screenshot({ path: `${OUT}/4-confirmar-producidas.png` });
  await exceed.check();
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  const ls = await q("select quantity::float8 q, kind, cumulative_after::float8 cum from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [ids.entrega]);
  const it = (await q("select operational_status, finished_qty from work_items where id = $1", [ids.entrega]))[0];
  check("JACTANS: 300 + 700 = 1.000 registradas; trabajo entregado; realizadas confirmadas y auditadas", ls.length === 2 && ls[1].cum === 1000 && it.operational_status === "entregado" && String(it.finished_qty) === "1000" && (await q("select count(*)::int n from operational_events where work_item_id = $1 and type = 'PRODUCED_CONFIRMED'", [ids.entrega]))[0].n === 1, JSON.stringify(ls));

  // Cajas que no suman: advertencia, no bloqueo
  await q("update work_items set finished_qty = '1015' where id = $1", [ids.cajas]);
  await env.page.reload();
  await card(env.page, P.cajas).waitFor({ timeout: 120_000 });
  await card(env.page, P.cajas).getByRole("button", { name: "Entregar parcial" }).click();
  dlg = env.page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill("305");
  await dlg.locator("[data-testid=deliver-boxes-toggle]").click();
  await dlg.locator("[data-testid=deliver-box-cajas-0]").fill("3");
  await dlg.locator("[data-testid=deliver-box-upc-0]").fill("100");
  check("cajas que no suman las unidades: aviso claro con la diferencia (no error)", /suman 300 u\. y la entrega es de 305 u\./.test(await dlg.locator("[data-testid=deliver-boxes-diff]").innerText()));
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  check("se registra igual con las 305 u. reales y las cajas informadas, y la diferencia queda trazada", await waitDb(async () => { const l = (await q("select quantity::float8 q, packing_groups from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [ids.cajas]))[0]; return l && l.q === 305 && JSON.stringify(l.packing_groups) === JSON.stringify([{ cajas: 3, unidadesPorCaja: 100 }]) && (await q("select count(*)::int n from operational_events where work_item_id = $1 and type = 'DELIVERY_PACKING_DIFF'", [ids.cajas]))[0].n === 1; }));
  check("las entregas no movieron stock", (await stockCount()) === stock0);
  await env.page.screenshot({ path: `${OUT}/5-envasado-entregas.png` });
  await env.ctx.close(); await pr.ctx.close(); await dep.ctx.close();

  // Tablet: control de ME legible
  const tb = await login(E2E_USERS.deposito, { width: 820, height: 1100 });
  await nav(tb.page, "ME de Envasado");
  await tb.page.locator("[data-testid=me-row]").first().waitFor({ timeout: 60_000 });
  const ov = await tb.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("tablet: el control de ME se usa sin desborde de la página (tabla con scroll propio)", ov <= 1, `overflow=${ov}`);
  await tb.page.screenshot({ path: `${OUT}/6-tablet.png` });
  await tb.ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
