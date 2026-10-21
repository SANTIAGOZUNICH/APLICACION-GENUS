// E2E (Chromium, escritorio y TABLET): filtro TODAS | ENVASADO | ELABORACIÓN en ENTREGAS (calendario). Base DESCARTABLE; login real.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/entregas-sector";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " \u2014 " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 8);
const DAY = `${MONTH}${TODAY.endsWith("-18") ? "19" : "18"}`;
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const C = { ela: "E2E SECT CLI ELAB", mas: "E2E SECT CLI MASIVO", pre: "E2E SECT CLI PREMIUM", mix: "E2E SECT CLI MIXTO" };
try {
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client like 'E2E SECT CLI%')");
  await q("delete from scheduled_deliveries where client like 'E2E SECT CLI%'");
  const login = async (ctx) => {
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_USERS.produccion.email);
    await page.locator('input[type="password"]').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    return page;
  };
  const seedCtx = await browser.newContext({ baseURL: BASE });
  const seed = await login(seedCtx);
  const mk = async (client, items) => {
    const r = await seed.request.post("/api/v1/entregas", { data: { client, deliveryDate: DAY, items } });
    if (r.status() !== 201 && r.status() !== 200) throw new Error(`crear ${client}: ${r.status()} ${await r.text()}`);
  };
  await mk(C.mas, [{ product: "CREMA B", quantity: "100", unit: "un", sector: "ENVASADO_MASIVO" }]);
  await mk(C.pre, [{ product: "CREMA C", quantity: "50", unit: "un", sector: "ENVASADO_PREMIUM" }]);
  await mk(C.mix, [{ product: "CREMA E", quantity: "20", unit: "un", sector: "ENVASADO_MASIVO" }]);
  // Elaboración no se programa a mano: aparece en Entregas desde el TRABAJO de Elaboración con fecha de entrega.
  const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const weekStart = mondayOf(TODAY);
  await q("update work_items set deleted_at = now() where notes like 'E2E-SECT%' and deleted_at is null");
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const wl = await (await seed.request.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = wl.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await seed.request.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E sector" } })).json()).week.id;
  for (const [client, product] of [[C.ela, "SERUM A"], [C.mix, "SERUM D"]]) {
    const r = await seed.request.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: "E2E-SECT", plannedDate: TODAY, deliveryDate: DAY, client, plannedQuantity: "10", unit: "kg", product, sector: "ELABORACION", branchOwner: "Cristian" } });
    if (r.status() !== 201) throw new Error(`trabajo ${client}: ${await r.text()}`);
  }
  const pub = await seed.request.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await q("update work_items set delivery_date = $1::date where notes = 'E2E-SECT' and deleted_at is null", [DAY]);
  await seedCtx.close();
  check("entregas programadas (Masivo, Premium, mixto) + trabajos de Elaboración con fecha de entrega", (await q("select count(*)::int n from scheduled_deliveries where client like 'E2E SECT CLI%'"))[0].n === 3 && (await q("select count(*)::int n from work_items where notes = 'E2E-SECT' and sector = 'ELABORACION'"))[0].n === 2);
  const snapshot = async () => JSON.stringify([await q("select d.client, i.product, i.sector, i.quantity from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client like 'E2E SECT CLI%' order by 1, 2"), await q("select client, product, sector::text, planned_quantity, to_char(delivery_date,'YYYY-MM-DD') d from work_items where notes = 'E2E-SECT' order by 1, 2")]);
  const before = await snapshot();

  for (const [device, ctxOpts] of [["escritorio", { viewport: { width: 1440, height: 900 } }], ["tablet", { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 }]]) {
    const ctx = await browser.newContext({ baseURL: BASE, ...ctxOpts });
    const page = await login(ctx);
    if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
    await page.getByRole("button", { name: /^Entregas$/ }).or(page.getByRole("link", { name: /^Entregas$/ })).first().click({ timeout: 120_000 });
    await page.locator("[data-testid=entregas-sector-filter]").waitFor({ timeout: 120_000 });
    const day = page.locator(`[data-testid=entregas-day][data-date='${DAY}']`);
    await day.waitFor({ timeout: 60_000 });
    const names = async () => {
      await page.waitForTimeout(400);
      const t = await day.locator("[data-testid=entregas-client]").allInnerTexts();
      return t.map((x) => x.trim()).filter((x) => x.startsWith("E2E SECT CLI")).sort();
    };
    const click = async (id) => page.locator(`[data-testid=entregas-sector-${id}]`).click();
    const url0 = page.url();
    check(`${device}: TODAS muestra los 4 clientes (sin duplicar)`, (await names()).join("|") === [C.ela, C.mas, C.mix, C.pre].sort().join("|"), (await names()).join("|"));
    await click("envasado");
    check(`${device}: ENVASADO muestra Masivo + Premium juntos (y el mixto por su producto de envasado), sin Elaboración pura`, (await names()).join("|") === [C.mas, C.mix, C.pre].sort().join("|"), (await names()).join("|"));
    await click("elaboracion");
    check(`${device}: ELABORACIÓN muestra solo clientes con productos de Elaboración (puro y mixto)`, (await names()).join("|") === [C.ela, C.mix].sort().join("|"), (await names()).join("|"));
    await page.screenshot({ path: `${OUT}/${device}-elaboracion.png` });
    // el detalle del cliente mixto en ELABORACIÓN muestra solo su producto de Elaboración
    await day.locator(`[data-testid=entregas-client][data-client='${C.mix}']`).click();
    const dlg = page.locator("[role=dialog]").first();
    await dlg.waitFor({ timeout: 30_000 });
    const dtxt = await dlg.innerText();
    check(`${device}: el detalle del mixto en ELABORACIÓN lista SERUM D y no CREMA E`, dtxt.includes("SERUM D") && !dtxt.includes("CREMA E"));
    await page.keyboard.press("Escape");
    await click("envasado");
    await day.locator(`[data-testid=entregas-client][data-client='${C.mix}']`).click();
    const dtxt2 = await page.locator("[role=dialog]").first().innerText();
    check(`${device}: el detalle del mixto en ENVASADO lista CREMA E y no SERUM D`, dtxt2.includes("CREMA E") && !dtxt2.includes("SERUM D"));
    await page.keyboard.press("Escape");
    await click("todas");
    check(`${device}: volver a TODAS restaura los 4 sin recargar la página`, (await names()).length === 4 && page.url() === url0);
    check(`${device}: el botón elegido queda destacado`, (await page.locator("[data-testid=entregas-sector-todas]").getAttribute("aria-pressed")) === "true");
    const box = await page.locator("[data-testid=entregas-sector-envasado]").boundingBox();
    check(`${device}: botones fáciles de tocar (\u2265 44 px)`, box && box.height >= 44, JSON.stringify(box));
    await ctx.close();
  }
  check("el filtro no modificó ninguna entrega (productos, sectores, cantidades)", (await snapshot()) === before);
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client like 'E2E SECT CLI%')").catch(() => undefined);
  await q("delete from scheduled_deliveries where client like 'E2E SECT CLI%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes = 'E2E-SECT' and deleted_at is null").catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
