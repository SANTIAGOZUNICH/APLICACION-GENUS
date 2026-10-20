// E2E (Chromium, TABLET): registrar una entrega con cajas de distintas cantidades. Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/entrega-cajas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CAJAS";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
let wid = null;
try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  await q("update work_items set operational_status = 'en_curso' where operational_status = 'revision' and notes not like $1", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const login = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (login.status() !== 200) throw new Error(`login: ${await login.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E cajas" } })).json()).week.id;
  const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: "CLIENTE CAJAS SA", plannedQuantity: "1250", unit: "un", product: "CREMA FACIAL CAJAS E2E", sector: "ENVASADO_MASIVO", line: "Línea 1" } });
  if (res.status() !== 201) throw new Error(`crear: ${await res.text()}`);
  wid = bare((await res.json()).item.id);
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [wid]);
  await api.dispose();

  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.produccion.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  await page.getByRole("button", { name: /^Pendientes de definir$/ }).or(page.getByRole("link", { name: /^Pendientes de definir$/ })).first().click({ timeout: 120_000 });
  const row = page.locator("[data-testid=pendiente-row]", { hasText: "CREMA FACIAL CAJAS E2E" }).first();
  await row.waitFor({ timeout: 120_000 });
  await row.locator("[data-testid=pendiente-action-ENTREGAR]").or(row.locator("[data-testid^=pendiente-action-]").first()).first().click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });

  check("Pendientes a definir: sin cajas registradas dice «Sin detalle de cajas registrado» (no inventa)", /Sin detalle de cajas registrado/.test(await row.locator("[data-testid=pendiente-cajas]").innerText()));
  await dlg.locator("[data-testid=deliver-quantity]").fill("850");
  await dlg.locator("[data-testid=deliver-boxes-toggle]").click();
  // Cajas distintas: 8 × 100 + 1 × 50 = 850
  await dlg.locator("[data-testid=deliver-box-cajas-0]").fill("8");
  await dlg.locator("[data-testid=deliver-box-upc-0]").fill("100");
  await dlg.locator("[data-testid=deliver-box-cajas-1]").fill("1");
  await dlg.locator("[data-testid=deliver-box-upc-1]").fill("50");
  check("el total de cajas se calcula solo (9 cajas · 850 u.)", /9 cajas · 850 u\./.test(await dlg.locator("[data-testid=deliver-boxes-total]").innerText()));
  await page.screenshot({ path: `${OUT}/tablet-dialogo-cajas.png` });
  // Mal: cambia el total de cajas → se rechaza sin guardar.
  await dlg.locator("[data-testid=deliver-box-cajas-0]").fill("7");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  check("cajas que no suman lo entregado se rechazan con mensaje claro", /suman 750 u\./.test(await dlg.locator("[data-testid=deliver-error]").innerText()));
  check("y no se registró ninguna entrega", (await q("select 1 from work_item_delivery_lines where work_item_id = $1", [wid])).length === 0);
  await dlg.locator("[data-testid=deliver-box-cajas-0]").fill("8");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async (e) => { console.log("DEBUG", await dlg.locator("[data-testid=deliver-error]").innerText().catch(() => "sin error visible"), JSON.stringify(await q("select quantity, status, packing_groups from work_item_delivery_lines where work_item_id = $1", [wid]))); await page.screenshot({ path: `${OUT}/debug.png` }); throw e; });
  const lines = await q("select quantity, packing_groups, kind from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [wid]);
  check("la entrega parcial queda con sus cajas (8×100 + 1×50) en la base", lines.length === 1 && lines[0].quantity === 850 && lines[0].kind === "PARCIAL" && JSON.stringify(lines[0].packing_groups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]));
  check("se creó UN aviso de facturación con las cajas", (await q("select message from os_notifications where kind = 'entrega_registrada' and message like '%CLIENTE CAJAS SA%'")).filter((r) => /8 cajas de 100 u\. \+ 1 caja de 50 u\./.test(r.message)).length === 1);
  // ── Pendientes a definir: con cajas registradas en el trabajo se ve «53 unidades · 11 cajas» y «10 × 5 + 1 × 3».
  await q("update work_items set packing_groups = $2::jsonb where id = $1", [wid, JSON.stringify([{ cajas: 10, unidadesPorCaja: 5 }, { cajas: 1, unidadesPorCaja: 3 }])]);
  await page.reload();
  await page.getByRole("button", { name: /^Pendientes de definir$/ }).or(page.getByRole("link", { name: /^Pendientes de definir$/ })).first().click({ timeout: 120_000 });
  const row2 = page.locator("[data-testid=pendiente-row]", { hasText: "CREMA FACIAL CAJAS E2E" }).first();
  await row2.waitFor({ timeout: 120_000 });
  const cajasTxt = await row2.locator("[data-testid=pendiente-cajas]").innerText();
  check("Pendientes a definir muestra «53 unidades · 11 cajas» y «10 × 5 + 1 × 3» (cajas mixtas) y el detalle completo", /53 unidades · 11 cajas/.test(cajasTxt) && /10 × 5 \+ 1 × 3/.test(cajasTxt) && /10 cajas × 5 unidades = 50 unidades/.test(cajasTxt) && /1 caja × 3 unidades = 3 unidades/.test(cajasTxt), cajasTxt.replace(/\n/g, " | "));
  await page.screenshot({ path: `${OUT}/tablet-pendientes-cajas.png` });
  await q("update work_items set packing_groups = null where id = $1", [wid]);
  // ── Segunda entrega (saldo 400): otras cajas (40 × 10). Cada entrega conserva SUS cajas.
  await page.reload();
  await page.getByRole("button", { name: /^Pendientes de definir$/ }).or(page.getByRole("link", { name: /^Pendientes de definir$/ })).first().click({ timeout: 120_000 });
  const row3 = page.locator("[data-testid=pendiente-row]", { hasText: "CREMA FACIAL CAJAS E2E" }).first();
  await row3.waitFor({ timeout: 120_000 });
  await row3.locator("[data-testid=pendiente-action-ENTREGAR]").or(row3.locator("[data-testid^=pendiente-action-]").first()).first().click();
  const dlg2 = page.locator("[data-testid=deliver-work-dialog]");
  await dlg2.waitFor({ timeout: 30_000 });
  await dlg2.locator("[data-testid=deliver-quantity]").fill("400");
  if ((await dlg2.locator("[data-testid=deliver-box-cajas-0]").count()) === 0) await dlg2.locator("[data-testid=deliver-boxes-toggle]").click();
  await dlg2.locator("[data-testid=deliver-box-cajas-0]").fill("40");
  await dlg2.locator("[data-testid=deliver-box-upc-0]").fill("10");
  await dlg2.locator("[data-testid=confirm-deliver]").click();
  await dlg2.waitFor({ state: "detached", timeout: 30_000 });
  const lines2 = await q("select quantity, packing_groups, delivery_id from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [wid]);
  check("la 2.ª entrega queda con sus propias cajas (40 × 10) y no toca las de la 1.ª", lines2.length === 2 && JSON.stringify(lines2[0].packing_groups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]) && JSON.stringify(lines2[1].packing_groups) === JSON.stringify([{ cajas: 40, unidadesPorCaja: 10 }]));
  // ── Entregados: el desglose real de cada entrega, sin mezclar, y persiste al recargar.
  const openEntregados = async () => {
    await page.getByRole("button", { name: /^Entregados$/ }).or(page.getByRole("link", { name: /^Entregados$/ })).first().click({ timeout: 120_000 });
    await page.locator("[data-testid=entregado-cajas]").first().waitFor({ timeout: 120_000 });
  };
  await openEntregados();
  const entTxt = await page.locator("[data-testid=entregado-cajas]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, " | ")).join(" || "));
  check("Entregados muestra las cajas de cada entrega por separado (850 u. · 9 cajas y 400 u. · 40 cajas)", /850 unidades · 9 cajas/.test(entTxt) && /8 × 100 \+ 1 × 50/.test(entTxt) && /400 unidades · 40 cajas/.test(entTxt) && /40 × 10/.test(entTxt), entTxt);
  check("no se mezclan: ninguna entrega muestra 1.250 unidades ni 49 cajas juntas", !/1\.250 unidades/.test(entTxt) && !/49 cajas/.test(entTxt));
  await page.screenshot({ path: `${OUT}/tablet-entregados-cajas.png` });
  await page.reload();
  await openEntregados();
  const entTxt2 = await page.locator("[data-testid=entregado-cajas]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, " | ")).join(" || "));
  check("tras recargar, Entregados conserva el mismo desglose", /850 unidades · 9 cajas/.test(entTxt2) && /400 unidades · 40 cajas/.test(entTxt2));
  await page.getByRole("button", { name: /^Ver detalle$/ }).first().click();
  check("el detalle de la entrega muestra el desglose completo («8 cajas × 100 unidades = 800 unidades»)", await page.getByText(/8 cajas × 100 unidades = 800 unidades/).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
  await ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  if (wid) await q("delete from os_notifications where message like '%CLIENTE CAJAS SA%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
