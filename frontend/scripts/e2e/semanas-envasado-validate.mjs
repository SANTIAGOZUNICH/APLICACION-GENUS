// E2E en Chromium real: «Semanas» de Envasado (Masivo y Premium) = «Día a día», diseño compacto y retiro del Panel general.
//  - Para cada sector y semana compara, DÍA POR DÍA, los IDs de la vista Semana con los de la vista Día (todas las líneas).
//  - Trabajo reprogramado a la semana siguiente (misma operación que el drag de Producción), rango que cruza el fin de
//    semana, cambio de estado, entrega parcial, día con muchos trabajos y semana sin trabajos.
//  - Diseño: 5 columnas en escritorio sin desplazar la página, 3 en tablet, un día por vez en celular; contador correcto;
//    un día con muchos trabajos se desplaza ADENTRO de su columna (no estira la página ni oculta trabajos).
//  - Producción: sin «Panel general» en el menú, aterriza en una sección válida (Semanas), Dashboard intacto.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production.
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
const OUT = process.env.OUT ?? "/tmp/semanas-envasado";
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
const dow = (new Date().getDay() + 6) % 7; // 0 = lunes
const W0 = addDays(TODAY, -dow); // lunes de esta semana
const W1 = addDays(W0, 7);
const days = (w) => [0, 1, 2, 3, 4].map((n) => addDays(w, n));
const CLIENT = "E2E SEM CLIENTE";

async function cleanup() {
  const wi = (await q("select id from work_items where client ilike 'E2E SEM%'")).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from work_item_delivery_lines where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  await q("delete from work_item_deliveries where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => {});
  await q("delete from work_items where id = any($1::uuid[])", [wi]);
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = async (page, label) => {
  const burger = page.getByRole("button", { name: "Abrir menú" });
  if ((page.viewportSize()?.width ?? 1280) < 768) await burger.click({ timeout: 120_000 });
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
};
const menuLabels = async (page) => {
  if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("button", { name: "Abrir menú" }).click();
  return page.locator("nav").first().innerText();
};

/** Mi trabajo de Envasado → vista Semana en la semana `w`. */
async function openWeek(page, w) {
  await page.goto("/mi-trabajo");
  await page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 120_000 });
  await page.locator("[data-testid=week-board-columns]").first().waitFor({ timeout: 60_000 });
  for (let i = 0; i < 4 && !(await page.locator(`[data-testid=week-day-total][data-day='${w}'], [data-testid=week-day-pick][data-day='${w}'], [data-testid^='week-board-daycell-'][data-day='${w}']`).count()); i += 1) {
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    await page.waitForTimeout(800);
  }
  await page.locator(`[data-testid^='week-board-daycell-'][data-day='${w}']`).first().waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForTimeout(800);
}
/** IDs que la vista Semana muestra en `day` (todas las líneas). */
const weekIds = (page, day) =>
  page.$$eval(`[data-testid^='week-board-daycell-'][data-day='${day}'] [data-testid=week-job-card]`, (els) => [...new Set(els.map((e) => e.getAttribute("data-item-id")))].sort());
/** IDs que la vista Día muestra en `day`, recorriendo todas las pestañas de línea. */
async function dayIds(page, day) {
  // Desde la Semana: el encabezado de la columna abre ese día en la vista Día.
  await page.locator(`[data-testid^='week-board-daycell-'][data-day='${day}'] button[title^='Ver ']`).first().click();
  await page.getByRole("tab", { name: /^Línea 1/ }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  const tabs = page.getByRole("tab", { name: /^Línea / });
  const n = await tabs.count();
  const ids = new Set();
  for (let i = 0; i < n; i += 1) {
    await tabs.nth(i).click();
    await page.waitForTimeout(400);
    for (const id of await page.$$eval("[data-testid=work-item-card]", (els) => els.map((e) => e.getAttribute("data-item-id")))) ids.add(id);
  }
  await page.getByRole("button", { name: /^Semana$/ }).first().click();
  await page.locator("[data-testid=week-board-columns]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  return [...ids].sort();
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  await cleanup();
  // ================= Producción: Panel general retirado =================
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;
  const SEMANAS = "[data-testid^=semanas-tab-]";
  // Mi trabajo de Producción (antes «Panel general»; enlaces viejos y el inicio de sesión estándar) → primera sección.
  await pp.goto("/mi-trabajo");
  await pp.locator(SEMANAS).first().waitFor({ timeout: 120_000 });
  check("Producción en /mi-trabajo aterriza en Semanas (sección válida), sin «Panel general»", (await pp.locator(SEMANAS).count()) > 0 && !/Panel general/i.test(await pp.locator("main").innerText()));
  const menu = await menuLabels(pp);
  check("menú de Producción sin «Panel general»", !/Panel general/i.test(menu), menu.replace(/\s+/g, " ").slice(0, 160));
  check("menú de Producción con «Semanas» y «Dashboard»", /Semanas/.test(menu) && /Dashboard/.test(menu));
  await nav(pp, "Dashboard");
  await pp.waitForTimeout(2500);
  check("Dashboard sigue disponible", (await pp.locator("[data-testid=dashboard-error]").count()) === 0 && /Dashboard/i.test(await pp.locator("main").innerText()));

  // ================= Datos (como Producción, por la API real) =================
  const asg = async (sector, product, plannedDate, line = "Línea 1", extra = {}) => {
    const r = await pp.request.post("/api/v1/work-assignments", {
      data: { unit: "un.", plannedDate, plannedDateTo: plannedDate, sector, line, client: CLIENT, product, idempotencyKey: randomUUID(), plannedQuantity: "500", ...extra },
    });
    if (!r.ok()) throw new Error(`asignación ${product}: ${r.status()} ${await r.text()}`);
    return String((await q("select id from work_items where client = $1 and product = $2", [CLIENT, product]))[0].id);
  };
  const M = "ENVASADO_MASIVO";
  const P = "ENVASADO_PREMIUM";
  const id = {};
  id.a = await asg(M, "E2E SEM SHAMPOO A", days(W0)[0]);
  id.b = await asg(M, "E2E SEM SHAMPOO B", days(W0)[0]);
  id.c = await asg(M, "E2E SEM GEL L2", days(W0)[1], "Línea 2");
  id.d = await asg(M, "E2E SEM JABON L3", days(W0)[2], "Línea 3");
  id.e = await asg(M, "E2E SEM CREMA ESTADO", days(W0)[2]);
  id.r = await asg(M, "E2E SEM REPROGRAMADO", days(W0)[4]);
  id.g = await asg(M, "E2E SEM RANGO", days(W0)[3]);
  id.p1 = await asg(P, "E2E SEM SERUM 1", days(W0)[0]);
  id.p2 = await asg(P, "E2E SEM SERUM 2", days(W0)[3]);
  id.p3 = await asg(P, "E2E SEM SERUM 3", days(W0)[3]);
  for (let n = 0; n < 12; n += 1) id[`m${n}`] = await asg(M, `E2E SEM MUCHOS ${String(n).padStart(2, "0")}`, days(W1)[2]);
  // Reprogramado por Producción a la semana siguiente (misma operación que el drag & drop).
  const rr = await pp.request.post("/api/v1/live-sync/operations", { data: { action: "reschedule_work", itemId: `native:${id.r}`, plannedDate: days(W1)[1], actorSectorId: "PRODUCCION" } });
  check("reprogramación a la semana siguiente aceptada", rr.ok(), String(rr.status()));
  // Rango jueves → lunes siguiente, cambio de estado y entrega parcial.
  await q("update work_items set planned_date_to = $2 where id = $1", [id.g, days(W1)[0]]);
  await q("update work_items set operational_status = 'en_curso' where id = $1", [id.e]);
  await q(
    `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
     values ($1, 'E2E SEM SHAMPOO B', $2, 'ENVASADO_MASIVO', '200', 'un', now(), 'E2E', 'ENVASADO_MASIVO', 'ENTREGADO')`,
    [id.b, CLIENT]
  );
  const before = JSON.stringify(await q("select id, planned_date, planned_date_to, line, sector, planning_week_id from work_items where client = $1 order by id", [CLIENT]));
  await pr.ctx.close();

  const n = (x) => `native:${x}`;
  // ================= Coincidencia Día ↔ Semana, día por día =================
  for (const [label, user, weeks] of [
    ["Masivo", E2E_USERS.envasado, [W0, W1, addDays(W1, 14)]],
    ["Premium", E2E_USERS.envasadoPremium, [W0, W1]],
  ]) {
    const s = await openAs(user);
    for (const w of weeks) {
      await openWeek(s.page, w);
      for (const d of days(w)) {
        const semana = await weekIds(s.page, d);
        const dia = await dayIds(s.page, d);
        check(`${label} ${d}: Semana = Día (${semana.length} trabajos)`, same(semana, dia), same(semana, dia) ? "" : `semana=${semana} dia=${dia}`);
        if (label === "Masivo" && d === days(W1)[1]) check("…reprogramado: aparece en su NUEVO día (semana siguiente)", semana.includes(n(id.r)));
        if (label === "Masivo" && d === days(W1)[0]) check("…rango jueves→lunes: también el lunes siguiente", semana.includes(n(id.g)));
        if (label === "Masivo" && d === days(W0)[2]) check("…cambio de estado: sigue en su día", semana.includes(n(id.e)));
        if (label === "Masivo" && d === days(W0)[0]) check("…entrega parcial: sigue en su día", semana.includes(n(id.b)));
        if (label === "Masivo" && w === addDays(W1, 14)) check(`…semana sin trabajos de prueba (${d})`, !semana.some((x) => Object.values(id).map(n).includes(x)));
      }
      if (label === "Masivo" && w === W0) check("…reprogramado ya no está en su semana de origen", !(await s.page.$$eval("[data-testid=week-job-card]", (els) => els.map((e) => e.getAttribute("data-item-id")))).includes(n(id.r)));
      if (label === "Premium" && w === W0) check("Premium no ve trabajos de Masivo", !(await s.page.$$eval("[data-testid=week-job-card]", (els) => els.map((e) => e.getAttribute("data-item-id")))).includes(n(id.a)));
    }

    // ================= Diseño (escritorio) =================
    if (label === "Masivo") {
      await openWeek(s.page, W0);
      const cells = await s.page.$$eval("[data-testid=week-line][data-line='1'] [data-testid^='week-board-daycell-']", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
      check("escritorio: 5 columnas en una fila", cells.length === 5 && new Set(cells.map((c) => c.y)).size === 1 && new Set(cells.map((c) => c.x)).size === 5, JSON.stringify(cells));
      await s.page.evaluate(() => { document.querySelector("main")?.scrollTo(0, 0); window.scrollTo(0, 0); });
      const bottom = await s.page.$$eval("[data-testid=week-line]", (els) => Math.max(...els.map((e) => e.getBoundingClientRect().bottom)));
      check("escritorio 1440×900: la semana completa (3 líneas) entra sin desplazar la página", bottom <= 900, `fondo=${Math.round(bottom)}px`);
      const tot = await s.page.$$eval("[data-testid=week-day-total]", (els) => els.map((e) => [e.getAttribute("data-day"), Number(e.getAttribute("data-count"))]));
      const expected = await Promise.all(days(W0).map(async (d) => [d, (await weekIds(s.page, d)).length]));
      check("contador por día = trabajos visibles", JSON.stringify(tot) === JSON.stringify(expected), JSON.stringify(tot));
      await s.page.screenshot({ path: `${OUT}/01-escritorio-semana.png` });
      await s.page.locator("[data-testid=week-job-card]").first().click();
      check("tocar una tarjeta abre el detalle completo", await s.page.getByRole("dialog").first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
      await s.page.keyboard.press("Escape");

      await openWeek(s.page, W1);
      const many = s.page.locator(`[data-testid^='week-board-daycell-1::'][data-day='${days(W1)[2]}']`);
      const info = await many.evaluate((el) => {
        const ul = el.querySelector("[data-testid=week-board-cards]");
        return { count: Number(el.getAttribute("data-count")), cards: el.querySelectorAll("[data-testid=week-job-card]").length, scrolls: ul ? ul.scrollHeight > ul.clientHeight : false, h: el.getBoundingClientRect().height };
      });
      check("muchos trabajos: contador correcto y ninguno oculto", info.count >= 12 && info.cards === info.count, JSON.stringify(info));
      check("muchos trabajos: desplazamiento interno, la columna no estira la página", info.scrolls && info.h < 520, JSON.stringify(info));
      await s.page.screenshot({ path: `${OUT}/02-escritorio-muchos.png` });
    }
    await s.ctx.close();
  }

  // ================= Tablet y celular =================
  const tab = await openAs(E2E_USERS.envasado, { width: 820, height: 1180 });
  await openWeek(tab.page, W0);
  const tcells = await tab.page.$$eval("[data-testid=week-line][data-line='1'] [data-testid^='week-board-daycell-']", (els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
  check("tablet: distribución compacta (3 columnas por fila)", tcells.length === 5 && tcells.filter((y) => y === tcells[0]).length === 3, JSON.stringify(tcells));
  check("tablet: sin desplazamiento horizontal", await tab.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await tab.page.screenshot({ path: `${OUT}/03-tablet.png`, fullPage: true });
  await tab.ctx.close();

  const mob = await openAs(E2E_USERS.envasado, { width: 390, height: 844 });
  await openWeek(mob.page, W0);
  const visible = () => mob.page.$$eval("[data-testid=week-line][data-line='1'] [data-testid^='week-board-daycell-']", (els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getAttribute("data-day")));
  check("celular: selector de días visible y un día por vez", (await mob.page.locator("[data-testid=week-day-picker]").isVisible()) && (await visible()).length === 1);
  await mob.page.locator(`[data-testid=week-day-pick][data-day='${days(W0)[0]}']`).click();
  check("celular: elegir lunes muestra el lunes", same(await visible(), [days(W0)[0]]));
  check("celular: el contador del selector coincide", Number(await mob.page.locator(`[data-testid=week-day-pick][data-day='${days(W0)[0]}'] span`).nth(1).innerText()) === (await weekIds(mob.page, days(W0)[0])).length);
  check("celular: sin desplazamiento horizontal", await mob.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mob.page.locator(`[data-testid^='week-board-daycell-1::'][data-day='${days(W0)[0]}'] [data-testid=week-job-card]`).first().click();
  check("celular: la tarjeta abre el detalle", await mob.page.getByRole("dialog").first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false));
  await mob.page.screenshot({ path: `${OUT}/04-celular.png` });
  await mob.ctx.close();

  // ================= Integridad =================
  const after = JSON.stringify(await q("select id, planned_date, planned_date_to, line, sector, planning_week_id from work_items where client = $1 order by id", [CLIENT]));
  check("ver las vistas no cambió fechas, líneas, sectores ni semanas de los trabajos", before === after);
  const dup = (await q("select product, count(*)::int n from work_items where client = $1 group by product having count(*) > 1", [CLIENT])).length;
  check("sin copias de trabajos", dup === 0);
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await cleanup().catch((e) => console.error("cleanup", e));
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? results.length : results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
