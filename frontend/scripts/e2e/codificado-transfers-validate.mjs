// E2E en Chromium real: ENTREGAS PARCIALES de Envasado → CODIFICADO. Base DESCARTABLE; logins reales.
// Trabajo de 2.000 u.: «Entregar a Codificado» 800 → 700 → 500. Codificado recibe y trabaja de inmediato; Envasado sigue abierto.
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
const OUT = process.env.OUT ?? "/tmp/codificado-transfers";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CTRF";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const transfers = (id) => q("select seq, quantity, cumulative, pending, origin_sector, lote, delivered_by from work_item_codificado_transfers where work_item_id = $1 order by seq", [id]);
const CLI = "CLIENTE CTRF SA";
const PROD = "SERUM CAPILAR CTRF";
const ids = {};

async function login(user, viewport = { width: 1400, height: 1000 }) {
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
const num = async (loc) => Number((await loc.innerText()).replace(/\./g, "").replace(",", ".").trim());
const cleanup = async () => {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await q("update work_items set deleted_at = now() where parent_work_item_id in (select id from work_items where notes like $1) and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
};

try {
  await cleanup();
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E codificado" } })).json()).week.id;
  const mk = async (sector, product, qty) => {
    const r = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLI, plannedQuantity: qty, unit: "un.", product, sector, line: "Línea 1" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.main = await mk("ENVASADO_MASIVO", PROD, "2000");
  ids.race = await mk("ENVASADO_MASIVO", `${PROD} RACE`, "2000");
  ids.other = await mk("ENVASADO_PREMIUM", `${PROD} PREMIUM`, "500");
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  await q("update work_items set packaging_lote = 'L-CTRF-01', sample_units = 20 where id = $1", [ids.main]);
  const extBefore = JSON.stringify({ d: (await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [ids.main]))[0].n, ds: (await q("select count(*)::int n from deposito_despachos"))[0].n, me: (await q("select count(*)::int n from inv_me_salidas"))[0].n });

  // ================= ENVASADO MASIVO entrega a Codificado =================
  const env = await login(E2E_USERS.envasado);
  const p = env.page;
  await card(p, PROD).waitFor({ timeout: 120_000 });
  await card(p, PROD).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
  const btn = p.locator("[data-testid=deliver-to-codificado-btn]");
  await btn.waitFor({ timeout: 30_000 });
  check("el trabajo de Envasado tiene el botón «Entregar a Codificado»", /Entregar a Codificado/.test(await btn.innerText()));
  await btn.click();
  const dlg = p.locator("[data-testid=deliver-to-codificado-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=dtc-assigned]").filter({ hasText: /2\.000/ }).waitFor({ timeout: 30_000 });
  check("el diálogo muestra cliente, producto, lote, asignada, ya entregada y pendiente", (await dlg.locator("[data-testid=dtc-client]").innerText()) === CLI && (await dlg.locator("[data-testid=dtc-product]").innerText()) === PROD && /L-CTRF-01/.test(await dlg.locator("[data-testid=dtc-lote]").innerText()) && (await num(dlg.locator("[data-testid=dtc-assigned]"))) === 2000 && (await num(dlg.locator("[data-testid=dtc-transferred]"))) === 0 && (await num(dlg.locator("[data-testid=dtc-pending]"))) === 2000);
  check("tiene el campo editable «Cantidad a entregar ahora»", (await dlg.locator("[data-testid=dtc-qty]").count()) === 1 && /Cantidad a entregar ahora/.test(await dlg.innerText()));
  await p.screenshot({ path: `${OUT}/1-dialogo.png` });

  // No se puede entregar más de lo terminado: 900 con 800 terminadas
  await dlg.locator("[data-testid=dtc-finished]").fill("800");
  await dlg.locator("[data-testid=dtc-qty]").fill("900");
  await dlg.locator("[data-testid=dtc-confirm]").click();
  check("no deja entregar más de lo terminado (900 con 800 terminadas)", /Solo hay 800/.test(await dlg.locator("[data-testid=dtc-error]").innerText()) && (await transfers(ids.main)).length === 0);
  await dlg.locator("[data-testid=dtc-qty]").fill("2500");
  await dlg.locator("[data-testid=dtc-finished]").fill("2500");
  await dlg.locator("[data-testid=dtc-confirm]").click();
  check("no deja registrar más terminadas que lo asignado", (await dlg.locator("[data-testid=dtc-error]").count()) === 1 && (await transfers(ids.main)).length === 0);

  // 1ª entrega: 800 (doble clic: no duplica)
  await dlg.locator("[data-testid=dtc-finished]").fill("800");
  await dlg.locator("[data-testid=dtc-qty]").fill("800");
  await dlg.locator("[data-testid=dtc-confirm]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  let t = await transfers(ids.main);
  check("entrega de 800: un solo movimiento (el doble clic no duplica), con lote y usuario", t.length === 1 && Number(t[0].quantity) === 800 && Number(t[0].cumulative) === 800 && Number(t[0].pending) === 1200 && t[0].lote === "L-CTRF-01" && t[0].origin_sector === "ENVASADO_MASIVO" && t[0].delivered_by === E2E_USERS.envasado.email, JSON.stringify(t));
  const sum = p.locator("[data-testid=envasado-cod-summary]");
  await sum.waitFor({ timeout: 30_000 });
  await p.waitForFunction(() => /1\.200/.test(document.querySelector("[data-testid=env-pending]")?.textContent ?? ""), null, { timeout: 30_000 });
  check("Envasado ve asignada 2.000 · terminada 800 · entregada a Codificado 800 · pendiente 1.200", (await num(sum.locator("[data-testid=env-assigned]"))) === 2000 && (await num(sum.locator("[data-testid=env-produced]"))) === 800 && (await num(sum.locator("[data-testid=env-transferred]"))) === 800 && (await num(sum.locator("[data-testid=env-pending]"))) === 1200);
  const w1 = (await q("select operational_status, sector, planned_quantity from work_items where id = $1", [ids.main]))[0];
  check("el trabajo de Envasado sigue pendiente en Envasado (no se completó ni se movió)", w1.sector === "ENVASADO_MASIVO" && w1.operational_status !== "completo" && w1.operational_status !== "entregado" && String(w1.planned_quantity) === "2000");
  await p.screenshot({ path: `${OUT}/2-envasado-800.png` });

  // ================= CODIFICADO recibe =================
  const cod = await login(E2E_USERS.codificado);
  const c = cod.page;
  const receipts = c.locator("[data-testid=cod-receipts]");
  await receipts.waitFor({ timeout: 120_000 });
  await c.waitForFunction((cli) => [...document.querySelectorAll("[data-testid=cod-receipt-row]")].some((r) => (r.textContent ?? "").includes(cli)), CLI, { timeout: 60_000 });
  const rr = (await c.locator("[data-testid=cod-receipt-row]").filter({ hasText: CLI }).first().innerText()).replace(/\s+/g, " ");
  check("la entrega aparece SOLA en la bandeja de Codificado (cliente, producto, lote, origen, cantidad, fecha y usuario)", rr.includes(CLI) && rr.includes(PROD) && rr.includes("L-CTRF-01") && /Envasado Masivo/.test(rr) && /800/.test(rr) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(rr) && /E2E Envasado/.test(rr), rr);
  await c.getByRole("button", { name: /Ver como lista/ }).click({ timeout: 30_000 }).catch(() => undefined); // la grilla Excel no expone el texto de las celdas
  const recib = c.getByText(/Recibidas 800 de 2000/).first();
  await recib.waitFor({ timeout: 60_000 }).catch(async (e) => { await c.screenshot({ path: `${OUT}/debug-codificado.png` }); console.log("DEBUG codificado:", (await c.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 900)); throw e; });
  check("en la lista de Codificado el trabajo figura como «Recibidas 800 de 2000» (un solo trabajo)", (await c.getByText(/Recibidas \d+ de/).count()) >= 1);
  await c.getByRole("button", { name: /^Abrir/ }).first().click();
  const panel = c.locator("[data-testid=cod-received-panel]");
  await panel.waitFor({ timeout: 30_000 });
  check("Codificado ve recibidas 800 · codificadas 0 · pendiente de codificar 800 · todavía no recibidas 1.200", (await num(panel.locator("[data-testid=cod-received]"))) === 800 && (await num(panel.locator("[data-testid=cod-coded]"))) === 0 && (await num(panel.locator("[data-testid=cod-pending-code]"))) === 800 && (await num(panel.locator("[data-testid=cod-not-received]"))) === 1200);
  await c.screenshot({ path: `${OUT}/3-codificado-800.png` });
  // Codificado empieza a trabajar con las primeras 800
  await panel.locator("[data-testid=cod-coded-input]").fill("900");
  await panel.locator("[data-testid=cod-coded-save]").click();
  check("no se pueden registrar más codificadas que las recibidas", /recibió 800/.test(await panel.getByRole("alert").innerText()));
  await panel.locator("[data-testid=cod-coded-input]").fill("500");
  await panel.locator("[data-testid=cod-coded-save]").click();
  await c.waitForFunction(() => /^300$/.test((document.querySelector("[data-testid=cod-pending-code]")?.textContent ?? "").trim()), null, { timeout: 30_000 });
  check("Codificado registra 500 codificadas: pendientes de codificar 300", (await num(panel.locator("[data-testid=cod-coded]"))) === 500);

  // 2ª y 3ª entrega desde la UI de Envasado
  const deliver = async (finished, qty, alreadyTransferred) => {
    await p.keyboard.press("Escape").catch(() => undefined);
    await card(p, PROD).waitFor({ timeout: 60_000 });
    await card(p, PROD).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
    await p.locator("[data-testid=deliver-to-codificado-btn]").click();
    const d = p.locator("[data-testid=deliver-to-codificado-dialog]");
    await d.waitFor({ timeout: 30_000 });
    await d.locator("[data-testid=dtc-transferred]").filter({ hasText: new RegExp(`^${String(alreadyTransferred).replace(/(\d)(?=(\d{3})+$)/g, "$1\\.")}$`) }).waitFor({ timeout: 30_000 });
    await d.locator("[data-testid=dtc-finished]").fill(String(finished));
    await d.locator("[data-testid=dtc-qty]").fill(String(qty));
    await d.locator("[data-testid=dtc-confirm]").click();
    await d.waitFor({ state: "detached", timeout: 30_000 });
  };
  await deliver(1500, 700, 800);
  t = await transfers(ids.main);
  check("segunda entrega de 700: acumulado 1.500 y no se crea otro trabajo en Codificado", t.length === 2 && Number(t[1].cumulative) === 1500 && Number(t[1].pending) === 500 && (await q("select count(*)::int n from work_items where parent_work_item_id = $1 and deleted_at is null", [ids.main]))[0].n === 1);
  await c.waitForFunction(() => /^1\.500$/.test((document.querySelector("[data-testid=cod-received]")?.textContent ?? "").trim()), null, { timeout: 60_000 });
  check("Codificado ve ahora recibidas 1.500 (las 700 se suman a las 800) sin recargar", (await num(panel.locator("[data-testid=cod-received]"))) === 1500 && (await num(panel.locator("[data-testid=cod-pending-code]"))) === 1000 && (await num(panel.locator("[data-testid=cod-not-received]"))) === 500);
  await deliver(2000, 500, 1500);
  t = await transfers(ids.main);
  check("entrega final de 500: total 2.000 en tres movimientos independientes", t.length === 3 && t.map((x) => Number(x.quantity)).join(",") === "800,700,500" && Number(t[2].cumulative) === 2000 && Number(t[2].pending) === 0);
  check("recién ahora el trabajo de Envasado queda completo", (await q("select operational_status from work_items where id = $1", [ids.main]))[0].operational_status === "completo");
  await c.waitForFunction(() => /^2\.000$/.test((document.querySelector("[data-testid=cod-received]")?.textContent ?? "").trim()), null, { timeout: 60_000 });
  check("Codificado ve recibidas 2.000 y 0 sin recibir", (await num(panel.locator("[data-testid=cod-not-received]"))) === 0);

  // Persistencia tras recargar
  await c.reload();
  await c.locator("[data-testid=cod-receipts]").waitFor({ timeout: 120_000 });
  check("después de recargar siguen las tres entregas en la bandeja de Codificado", (await c.locator("[data-testid=cod-receipt-row]").filter({ hasText: CLI }).count()) === 3);
  await c.getByText(/Recibidas 2000 de 2000/).first().waitFor({ timeout: 60_000 });
  await c.getByRole("button", { name: /^Abrir/ }).first().click();
  await c.locator("[data-testid=cod-received-panel]").waitFor({ timeout: 30_000 });
  check("y el avance de Codificado (500 codificadas) se conservó", (await num(c.locator("[data-testid=cod-coded]"))) === 500);

  // ================= Concurrencia, permisos y efectos colaterales (API) =================
  const apiAs = async (user) => { const a = await pwRequest.newContext({ baseURL: BASE }); const r = await a.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } }); if (r.status() !== 200) throw new Error("login " + user.email); return a; };
  const envApi1 = await apiAs(E2E_USERS.envasado);
  const envApi2 = await apiAs(E2E_USERS.envasado);
  const post = (a, id, body) => a.post(`/api/v1/work-items/${id}/codificado`, { data: { action: "transfer", ...body } });
  const [r1, r2] = await Promise.all([post(envApi1, ids.race, { quantity: 1500, finishedQty: 2000, idempotencyKey: "race-a-" + Date.now() }), post(envApi2, ids.race, { quantity: 1500, finishedQty: 2000, idempotencyKey: "race-b-" + Date.now() })]);
  const codes = [r1.status(), r2.status()].sort();
  check("dos usuarios entregando a la vez 1.500 de 2.000: solo uno entra (el otro recibe error de saldo)", codes[0] === 200 && codes[1] >= 400 && (await transfers(ids.race)).length === 1, codes.join(","));
  const same = "retry-" + Date.now();
  const k1 = await post(envApi1, ids.race, { quantity: 100, finishedQty: 2000, idempotencyKey: same });
  const k2 = await post(envApi1, ids.race, { quantity: 100, finishedQty: 2000, idempotencyKey: same });
  check("un reintento con la misma clave devuelve la misma entrega (sin duplicar)", k1.status() === 200 && k2.status() === 200 && (await k2.json()).replayed === true && (await transfers(ids.race)).length === 2);
  const prem = await apiAs(E2E_USERS.envasadoPremium);
  const foreign = await post(prem, ids.race, { quantity: 10, finishedQty: 2000, idempotencyKey: "foreign-" + Date.now() });
  check("el otro Envasado no puede entregar un trabajo ajeno (403)", foreign.status() === 403, String(foreign.status()));
  const codApi = await apiAs(E2E_USERS.codificado);
  const byCod = await post(codApi, ids.race, { quantity: 10, finishedQty: 2000, idempotencyKey: "bycod-" + Date.now() });
  check("Codificado no puede entregar a Codificado (403)", byCod.status() === 403, String(byCod.status()));
  const cal = await apiAs(E2E_USERS.calidad);
  const calGet = await cal.get(`/api/v1/work-items/${ids.main}/codificado`);
  const calList = await cal.get("/api/v1/codificado-transfers");
  check("Calidad no consulta las entregas (403)", calGet.status() === 403 && calList.status() === 403, `${calGet.status()}/${calList.status()}`);
  const prodApi = await apiAs(E2E_USERS.produccion);
  const prodGet = await prodApi.get(`/api/v1/work-items/${ids.main}/codificado`);
  const prodList = await prodApi.get("/api/v1/codificado-transfers");
  check("Producción puede consultar todo el historial (200)", prodGet.status() === 200 && prodList.status() === 200 && (await prodGet.json()).view.transfers.length === 3);
  const childId = (await q("select id from work_items where parent_work_item_id = $1", [ids.main]))[0].id;
  const prodCoded = await prodApi.post(`/api/v1/work-items/${childId}/codificado`, { data: { action: "progress", codedUnits: 10 } });
  check("Producción no registra el avance de Codificado (403)", prodCoded.status() === 403, String(prodCoded.status()));
  const envCoded = await envApi1.post(`/api/v1/work-items/${childId}/codificado`, { data: { action: "progress", codedUnits: 10 } });
  check("Envasado no registra el avance de Codificado (403)", envCoded.status() === 403, String(envCoded.status()));
  const legacy = await envApi1.post(`/api/v1/work-items/${ids.race}/codificado`, { data: { action: "send", totalUnits: 1000, idempotencyKey: "legacy-" + Date.now() } });
  check("el envío total ya no se puede usar sobre un trabajo con entregas parciales (400)", legacy.status() === 400, String(legacy.status()));

  const extAfter = JSON.stringify({ d: (await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [ids.main]))[0].n, ds: (await q("select count(*)::int n from deposito_despachos"))[0].n, me: (await q("select count(*)::int n from inv_me_salidas"))[0].n });
  check("ninguna entrega al cliente ni despacho ni salida de stock de Depósito se generó", extBefore === extAfter, `${extBefore} → ${extAfter}`);
  const m = (await q("select sample_units, planned_quantity from work_items where id = $1", [ids.main]))[0];
  check("las muestras registradas (20) quedan como metadata: no se descontaron ni se contaron dos veces", Number(m.sample_units) === 20 && Number(m.planned_quantity) === 2000 && Number((await q("select coalesce(sum(quantity),0)::float n from work_item_codificado_transfers where work_item_id = $1", [ids.main]))[0].n) === 2000);

  for (const x of [envApi1, envApi2, prem, codApi, cal, prodApi]) await x.dispose();
  await env.ctx.close();
  await cod.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
