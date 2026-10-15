// E2E en Chromium real: ARRASTRAR trabajos entre días en la vista Semana de Envasado (Masivo y Premium).
// Verifica con el arrastre REAL (mouse y dedo), no con la API:
//  - a mitad del arrastre la tarjeta se VE bajo el puntero aunque ya esté sobre OTRA columna (no queda encerrada);
//  - el día de destino se resalta y es el mismo que propone la confirmación;
//  - lunes → martes / lunes → viernes / viernes → lunes; CONFIRMAR guarda, CANCELAR deja todo; sin motivo;
//  - persistencia al recargar y coincidencia con Día a día; columnas con distinta cantidad de trabajos; tablet táctil.
// Base DESCARTABLE (marca verificada) y login real.
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/semanas-arrastre";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
};
const TODAY = iso(new Date());
const W0 = addDays(TODAY, -((new Date().getDay() + 6) % 7));
const [LUN, MAR, MIE, JUE, VIE] = [0, 1, 2, 3, 4].map((n) => addDays(W0, n));
const CLIENT = "E2E DRAG CLIENTE";

async function cleanup() {
  const wi = (await q("select id from work_items where client ilike 'E2E DRAG%'")).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => {});
  await q("delete from work_items where id = any($1::uuid[])", [wi]);
}
const fingerprint = async () =>
  JSON.stringify({
    wd: (await q("select count(*)::int n from work_item_deliveries"))[0].n,
    m: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    b: await q("select codigo, stock_actual from mp_stock_balances order by codigo"),
  });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const planned = async (product) => (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where client = $1 and product = $2", [CLIENT, product]))[0]?.d;

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", ...extra });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
async function openWeek(page, sectorLabel) {
  await page.goto("/mi-trabajo");
  await page.getByRole("button", { name: new RegExp(`^${sectorLabel}$`) }).or(page.getByRole("link", { name: new RegExp(`^${sectorLabel}$`) })).first().click({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 120_000 });
  await page.locator("[data-testid=week-board-columns]").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
}
const card = (page, product) => page.locator("[data-testid=week-job-card]", { hasText: product }).first();
const cellOf = (page, day) => page.locator(`[data-testid=week-line][data-line='1'] [data-testid^='week-board-daycell-'][data-day='${day}']`).first();
const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 40) };
};
/** Estado a mitad del arrastre: ¿la tarjeta se ve bajo el puntero? ¿qué día se resalta? */
const midDrag = (page, p, product) =>
  page.evaluate(({ x, y, product }) => {
    const under = document.elementFromPoint(x, y);
    const node = under?.closest("[data-testid=week-drag-overlay], [data-testid=week-job-card]");
    // Lo que se ve bajo el puntero tiene que ser ESA tarjeta (no otra que ya estaba en el día destino).
    const visible = Boolean(node && node.textContent?.includes(product));
    const over = [...document.querySelectorAll("[data-testid^='week-board-daycell-'][data-over='1']")].map((e) => e.getAttribute("data-day"));
    return { visible, over };
  }, { ...p, product });

async function mouseDrag(page, product, day) {
  const a = await center(card(page, product));
  const b = await center(cellOf(page, day));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + 4, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 18 });
  await page.waitForTimeout(200);
  const st = await midDrag(page, b, product);
  await page.mouse.up();
  return st;
}
async function touchDrag(ctx, page, product, day) {
  const cdp = await ctx.newCDPSession(page);
  const a = await center(card(page, product));
  const b = await center(cellOf(page, day));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  await page.waitForTimeout(300);
  for (let i = 1; i <= 18; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 18, y: a.y + ((b.y - a.y) * i) / 18 }] });
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(150);
  const st = await midDrag(page, b, product);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return st;
}
const confirmDate = async (page) => (await page.locator("[data-testid=move-confirm]").waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)) ? (await page.locator("[data-testid=move-confirm-date]").innerText()) : null;
const dmy = (d) => d.split("-").reverse().join("/");
const sameDate = (shown, d) => !!shown && shown.includes(dmy(d).slice(0, 5));

try {
  await cleanup();
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;
  await pp.goto("/mi-trabajo");
  const asg = async (sector, product, plannedDate) => {
    const r = await pp.request.post("/api/v1/work-assignments", {
      data: { unit: "un.", plannedDate, plannedDateTo: plannedDate, sector, line: "Línea 1", client: CLIENT, product, idempotencyKey: randomUUID(), plannedQuantity: "500" },
    });
    if (!r.ok()) throw new Error(`asignación ${product}: ${r.status()} ${await r.text()}`);
  };
  // Columnas con distinta cantidad: lunes 2, viernes 1, resto vacío.
  await asg("ENVASADO_MASIVO", "E2E DRAG LUNES A", LUN);
  await asg("ENVASADO_MASIVO", "E2E DRAG LUNES B", LUN);
  await asg("ENVASADO_MASIVO", "E2E DRAG VIERNES", VIE);
  await asg("ENVASADO_PREMIUM", "E2E DRAG PREMIUM", LUN);
  await asg("ENVASADO_MASIVO", "E2E DRAG TACTIL", MIE);
  const fp0 = await fingerprint();

  await openWeek(pp, "Envasado Masivo");
  // ===== Lunes → martes: CONFIRMAR =====
  let st = await mouseDrag(pp, "E2E DRAG LUNES A", MAR);
  check("lunes→martes: a mitad del arrastre la tarjeta se VE sobre la columna destino (no queda encerrada)", st.visible, JSON.stringify(st));
  check("…el día resaltado es el martes", JSON.stringify(st.over) === JSON.stringify([MAR]), JSON.stringify(st.over));
  let shown = await confirmDate(pp);
  check("…la confirmación propone el martes (sin motivo)", sameDate(shown, MAR) && (await pp.locator("[data-testid=move-confirm] input, [data-testid=move-confirm] textarea").count()) === 0, String(shown));
  await pp.screenshot({ path: `${OUT}/01-confirmar.png` });
  check("…nada guardado antes de confirmar", (await planned("E2E DRAG LUNES A")) === LUN);
  await pp.locator("[data-testid=move-confirm-ok]").click();
  check("CONFIRMAR: queda el martes", await waitDb(async () => (await planned("E2E DRAG LUNES A")) === MAR));
  await pp.waitForTimeout(1200);
  check("…y la tarjeta ya está en la columna del martes", (await card(pp, "E2E DRAG LUNES A").evaluate((el) => el.closest("[data-day]")?.getAttribute("data-day"))) === MAR);

  // ===== Lunes → viernes: CANCELAR =====
  st = await mouseDrag(pp, "E2E DRAG LUNES B", VIE);
  check("lunes→viernes: la tarjeta cruza toda la semana y se ve sobre el viernes", st.visible && JSON.stringify(st.over) === JSON.stringify([VIE]), JSON.stringify(st));
  shown = await confirmDate(pp);
  check("…la confirmación propone el viernes", sameDate(shown, VIE), String(shown));
  await pp.locator("[data-testid=move-confirm-cancel]").click();
  await pp.waitForTimeout(600);
  check("CANCELAR: vuelve al lunes y no se guardó nada", (await planned("E2E DRAG LUNES B")) === LUN && (await card(pp, "E2E DRAG LUNES B").evaluate((el) => el.closest("[data-day]")?.getAttribute("data-day"))) === LUN);

  // ===== Viernes → lunes: CONFIRMAR =====
  st = await mouseDrag(pp, "E2E DRAG VIERNES", LUN);
  check("viernes→lunes: se ve sobre el lunes y se resalta el lunes", st.visible && JSON.stringify(st.over) === JSON.stringify([LUN]), JSON.stringify(st));
  shown = await confirmDate(pp);
  check("…la confirmación propone el lunes", sameDate(shown, LUN), String(shown));
  await pp.locator("[data-testid=move-confirm-ok]").click();
  check("CONFIRMAR: queda el lunes", await waitDb(async () => (await planned("E2E DRAG VIERNES")) === LUN));

  // ===== Persistencia + Día a día =====
  await openWeek(pp, "Envasado Masivo");
  const dayOf = async (p) => card(pp, p).evaluate((el) => el.closest("[data-day]")?.getAttribute("data-day"));
  check("recargar: martes / lunes / lunes se conservan", (await dayOf("E2E DRAG LUNES A")) === MAR && (await dayOf("E2E DRAG LUNES B")) === LUN && (await dayOf("E2E DRAG VIERNES")) === LUN);
  const dia = JSON.stringify(await (await pp.request.get(`/api/v1/work-items?sector=ENVASADO_MASIVO&date=${MAR}`)).json());
  check("Día a día del martes muestra el trabajo movido", dia.includes("E2E DRAG LUNES A"));
  check("sin duplicados", (await q("select count(*)::int n from work_items where client = $1", [CLIENT]))[0].n === 5);

  // ===== Premium =====
  await openWeek(pp, "Envasado Premium");
  st = await mouseDrag(pp, "E2E DRAG PREMIUM", JUE);
  check("Premium lunes→jueves: se ve y se resalta el jueves", st.visible && JSON.stringify(st.over) === JSON.stringify([JUE]), JSON.stringify(st));
  shown = await confirmDate(pp);
  await pp.locator("[data-testid=move-confirm-ok]").click().catch(() => {});
  check("Premium: CONFIRMAR guarda el jueves", sameDate(shown, JUE) && (await waitDb(async () => (await planned("E2E DRAG PREMIUM")) === JUE)), String(shown));
  await pr.ctx.close();

  // ===== Tablet táctil =====
  const tab = await openAs(E2E_USERS.produccion, { width: 1280, height: 800 }, { hasTouch: true });
  await openWeek(tab.page, "Envasado Masivo");
  st = await touchDrag(tab.ctx, tab.page, "E2E DRAG TACTIL", VIE);
  check("tablet (dedo) miércoles→viernes: la tarjeta acompaña al dedo y se resalta el viernes", st.visible && JSON.stringify(st.over) === JSON.stringify([VIE]), JSON.stringify(st));
  shown = await confirmDate(tab.page);
  check("…la confirmación propone el viernes", sameDate(shown, VIE), String(shown));
  await tab.page.screenshot({ path: `${OUT}/02-tablet.png` });
  await tab.page.locator("[data-testid=move-confirm-ok]").tap().catch(() => tab.page.locator("[data-testid=move-confirm-ok]").click());
  check("tablet: CONFIRMAR guarda el viernes", await waitDb(async () => (await planned("E2E DRAG TACTIL")) === VIE));
  await tab.ctx.close();

  check("integridad: entregas, stock y MP sin cambios", (await fingerprint()) === fp0);
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await cleanup().catch((e) => console.error("cleanup", e));
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
