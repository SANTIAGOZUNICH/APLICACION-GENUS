// E2E en Chromium real: CUATRO entregas parciales de Envasado con cajas distintas → cada una conserva SU embalaje en Producción. Base DESCARTABLE.
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
const OUT = process.env.OUT ?? "/tmp/cajas-parciales";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CJP";
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

const FOUR = [
  { qty: 500, boxes: [[5, 100]], obs: "uno" },
  { qty: 600, boxes: [[6, 100]], obs: "dos" },
  { qty: 450, boxes: [[4, 100], [1, 50]], obs: "tres" },
  { qty: 470, boxes: [[4, 100], [1, 70]], obs: "cuatro" },
];
async function deliverBoxes(page, product, f) {
  await card(page, product).waitFor({ timeout: 120_000 });
  await card(page, product).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill(String(f.qty));
  await dlg.locator("[data-testid=deliver-observations]").fill(f.obs).catch(() => undefined);
  if ((await dlg.locator("[data-testid=deliver-box-cajas-0]").count()) === 0) await dlg.locator("[data-testid=deliver-boxes-toggle]").click();
  for (let i = 0; i < f.boxes.length; i++) {
    if ((await dlg.locator(`[data-testid=deliver-box-cajas-${i}]`).count()) === 0) await dlg.locator("[data-testid=deliver-box-add-slot]").click();
    await dlg.locator(`[data-testid=deliver-box-cajas-${i}]`).fill(String(f.boxes[i][0]));
    await dlg.locator(`[data-testid=deliver-box-upc-${i}]`).fill(String(f.boxes[i][1]));
  }
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG dlg:", (await dlg.locator("[data-testid=deliver-error]").innerText().catch(() => "?"))));
}

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E cajas parciales" } })).json()).week.id;
  const PM = "CREMA CAJAS PARCIALES MASIVO";
  const r = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: "CLIENTE CJP SA", plannedQuantity: "2000", unit: "un.", product: PM, sector: "ENVASADO_MASIVO", line: "Línea 1" } });
  if (r.status() !== 201) throw new Error(`crear: ${await r.text()}`);
  ids.m = bare((await r.json()).item.id);
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  await q("update work_items set finished_qty = '2020' where id = $1", [ids.m]);

  const env = await login(E2E_USERS.envasado, { width: 1500, height: 950 });
  for (const f of FOUR) await deliverBoxes(env.page, PM, f);
  const dbl = await q("select sequence, quantity, packing_groups, observations from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [ids.m]);
  console.log("DB:", JSON.stringify(dbl));
  check("las 4 entregas parciales quedaron registradas", dbl.length === 4);
  for (let i = 0; i < 4; i++) {
    const expected = FOUR[i].boxes.map(([c, u]) => ({ cajas: c, unidadesPorCaja: u }));
    check(`entrega ${i + 1} (${FOUR[i].qty}) conserva SU embalaje en la base`, JSON.stringify(dbl[i]?.packing_groups) === JSON.stringify(expected), JSON.stringify(dbl[i]?.packing_groups));
  }
  await env.ctx.close();

  const pr = await login(E2E_USERS.produccion, { width: 1500, height: 950 });
  const p = pr.page;
  await p.getByRole("button", { name: /^Entregados$/ }).or(p.getByRole("link", { name: /^Entregados$/ })).first().click({ timeout: 120_000 });
  await p.locator("[data-testid=os-table-mode-toggle], [data-testid=entregado-cajas]").first().waitFor({ timeout: 120_000 });
  await p.waitForTimeout(2500);
  const gridRows = await p.evaluate(() => [...document.querySelectorAll(".dsg-row")].map((r) => [...r.querySelectorAll("input")].map((i) => i.value).filter(Boolean).join(" ¦ ")).filter(Boolean));
  console.log("GRID_ROWS:", JSON.stringify(gridRows));
  await p.screenshot({ path: `${OUT}/produccion-grid.png` });
  check("PLANILLA de Producción: una fila por entrega (4 filas), cada una con SUS cajas", gridRows.length >= 4 && /Entrega #1 de 4/.test(gridRows.join("\n")) && /5 × 100/.test(gridRows.join("\n")), String(gridRows.length));
  const joined = gridRows.join("\n");
  check("planilla: se ven las cajas de la 2.ª, 3.ª y 4.ª entrega (6 × 100, 4 × 100 + 1 × 50, 4 × 100 + 1 × 70)", /6 × 100/.test(joined) && /4 × 100 \+ 1 × 50/.test(joined) && /4 × 100 \+ 1 × 70/.test(joined));
  check("planilla: TOTAL RECIBIDO 2.020 u. y 21 cajas", /TOTAL RECIBIDO 2\.020 u\. · 21 cajas/.test(joined), joined.slice(0, 300));
  if ((await p.locator("[data-testid=entregado-cajas]").count()) === 0) await p.locator("[data-testid=os-table-mode-toggle]").first().click();
  await p.locator("[data-testid=entregado-cajas]").first().waitFor({ timeout: 60_000 });
  const txt = await p.locator("[data-testid=entregado-cajas]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, " | ")).join(" || "));
  console.log("PRODUCCION:", txt);
  check("Producción muestra el desglose de las CUATRO entregas", /5 cajas × 100|5 × 100/.test(txt) && /6 × 100|6 cajas × 100/.test(txt) && /4 × 100 \+ 1 × 50/.test(txt) && /4 × 100 \+ 1 × 70/.test(txt), txt.slice(0, 400));
  check("ninguna entrega dice «Sin detalle de cajas registrado»", !/Sin detalle de cajas/.test(txt));
  await p.screenshot({ path: `${OUT}/produccion.png` });
  await pr.ctx.close();
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
