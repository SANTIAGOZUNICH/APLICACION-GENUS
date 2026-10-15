// E2E en Chromium real: arrastrar y soltar en el Calendario de Entregas.
//  - Arrastrar y CONFIRMAR / CANCELAR (sin motivo; nada se guarda antes de confirmar).
//  - Cliente con varios productos: hay que ELEGIR cuál se mueve; los demás quedan.
//  - Otra semana, otro mes (dejar la tarjeta sobre «›» cambia de mes sin soltarla).
//  - Entrega parcial con Envasado cerrado: se mueve el saldo; sin reabrir ni tocar cantidades.
//  - Entrega programada a mano: mueve UN producto (move_item); persistencia al recargar.
//  - Permisos (Envasado no arrastra; el servidor rechaza), arrastre TÁCTIL en tablet (eventos touch reales).
//  - Integridad: entregas reales, líneas, stock/MP intactos; auditoría con usuario y fecha anterior → nueva.
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
const OUT = process.env.OUT ?? "/tmp/entregas-arrastre";
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
const now = new Date();
const TODAY = iso(now);
const MONTH = TODAY.slice(0, 8);
const day = (n) => `${MONTH}${String(n).padStart(2, "0")}`;
const NEXT = iso(new Date(now.getFullYear(), now.getMonth() + 1, 10));
const CLI_MULTI = "E2E ARR VARIOS";
const CLI_PART = "E2E ARR PARCIAL";
const CLI_PROG = "E2E ARR PROGRAMADA";
const CLI_TOUCH = "E2E ARR TABLET";

async function cleanup() {
  await q("delete from scheduled_delivery_links where item_id in (select i.id from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client ilike 'E2E ARR%')").catch(() => {});
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client ilike 'E2E ARR%')").catch(() => {});
  await q("delete from scheduled_deliveries where client ilike 'E2E ARR%'").catch(() => {});
  const wi = (await q("select id from work_items where client ilike 'E2E ARR%'")).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from delivery_calendar_hidden where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  await q("delete from work_item_delivery_lines where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  await q("delete from work_item_deliveries where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => {});
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => {});
  await q("delete from work_items where id = any($1::uuid[])", [wi]);
}
const fingerprint = async () =>
  JSON.stringify({
    wd: await q("select id, quantity, actual_delivered_at, status from work_item_deliveries order by id"),
    l: await q("select id, quantity, status from work_item_delivery_lines order by id"),
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
const deliveryOf = async (client, product) => (await q("select to_char(delivery_date,'YYYY-MM-DD') d from work_items where client = $1 and product = $2", [client, product]))[0]?.d;

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
async function openEntregas(page) {
  await page.goto("/mi-trabajo");
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByRole("button", { name: "Abrir menú" }).click({ timeout: 60_000 }).catch(() => {});
  await page.getByRole("button", { name: /^Entregas$/ }).or(page.getByRole("link", { name: /^Entregas$/ })).first().click({ timeout: 120_000 });
  await page.locator("[data-testid=entregas-view]").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}
const chip = (page, date, client) => page.locator(`[data-testid=entregas-day][data-date='${date}'] [data-testid=entregas-client][data-client='${client}']`).first();
const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function mouseDrag(page, from, toLoc, holdOn = null) {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 6, { steps: 3 });
  if (holdOn) {
    // Cerca del borde la página se desplaza sola mientras se arrastra: se vuelve a apuntar al botón hasta quedar encima.
    for (let i = 0; i < 4; i += 1) {
      const h = await center(holdOn);
      await page.mouse.move(h.x, h.y, { steps: 6 });
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1000);
  }
  const b = await center(typeof toLoc === "function" ? toLoc() : toLoc);
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}
const dialog = (page) => page.locator("[data-testid=entregas-move]");

try {
  await cleanup();
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;
  await pp.goto("/mi-trabajo");
  const asg = async (client, product, deliveryDate, extra = {}) => {
    const r = await pp.request.post("/api/v1/work-assignments", {
      data: { unit: "un.", plannedDate: TODAY, plannedDateTo: TODAY, sector: "ENVASADO_MASIVO", line: "Línea 1", client, product, deliveryDate, idempotencyKey: randomUUID(), plannedQuantity: "500", ...extra },
    });
    if (!r.ok()) throw new Error(`asignación ${product}: ${r.status()} ${await r.text()}`);
    return String((await q("select id from work_items where client = $1 and product = $2", [client, product]))[0].id);
  };
  // Datos: cliente con 2 productos el mismo día; parcial con Envasado cerrado; programada a mano con 2 productos.
  const D1 = day(20);
  await asg(CLI_MULTI, "E2E ARR CREMA", D1);
  await asg(CLI_MULTI, "E2E ARR SERUM", D1);
  const wPart = await asg(CLI_PART, "E2E ARR PARCIAL", day(21));
  await q("update work_items set operational_status = 'completo', finished_qty = '500', packaging_closed_at = now(), packaging_closed_by = 'E2E' where id = $1", [wPart]);
  await q(
    `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
     values ($1, 'E2E ARR PARCIAL', $2, 'ENVASADO_MASIVO', '300', 'un', now(), 'E2E', 'ENVASADO_MASIVO', 'ENTREGADO')`,
    [wPart, CLI_PART]
  );
  const prog = await pp.request.post("/api/v1/entregas", {
    data: { client: CLI_PROG, deliveryDate: day(22), items: [{ product: "E2E ARR PROG A", quantity: "100", sector: "ENVASADO_MASIVO" }, { product: "E2E ARR PROG B", quantity: "200", sector: "ENVASADO_MASIVO" }] },
  });
  check("entrega programada de prueba creada", prog.ok(), String(prog.status()));
  await asg(CLI_TOUCH, "E2E ARR TACTIL", day(23));
  const fp0 = await fingerprint();
  await openEntregas(pp);

  // ===== Arrastrar y CANCELAR =====
  await mouseDrag(pp, chip(pp, D1, CLI_MULTI), pp.locator(`[data-testid=entregas-day][data-date='${day(24)}']`));
  await dialog(pp).waitFor({ timeout: 15_000 });
  const opts = await pp.locator("[data-testid=entregas-move-option]").evaluateAll((els) => els.map((e) => e.getAttribute("data-product")));
  const shownClient = await pp.locator("[data-testid=entregas-move-client]").innerText();
  const shownTo = await pp.locator("[data-testid=entregas-move-to]").inputValue();
  const shownFrom = await pp.locator("[data-testid=entregas-move-from]").innerText();
  check("confirmación: cliente, fecha original, nueva fecha y los productos del cliente", shownClient === CLI_MULTI && shownTo === day(24) && shownFrom === D1.split("-").reverse().join("/") && opts.length === 2, `${shownClient} ${shownFrom} → ${shownTo} · ${opts.join(",")}`);
  check("sin motivo; con varios productos no se puede confirmar sin elegir uno", (await dialog(pp).locator("input:not([type=radio]):not([type=date])").count()) === 0 && (await pp.locator("[data-testid=entregas-move-confirm]").isDisabled()));
  await pp.screenshot({ path: `${OUT}/01-confirmar.png` });
  check("…y no se guardó nada antes de confirmar", (await deliveryOf(CLI_MULTI, "E2E ARR CREMA")) === D1);
  await pp.locator("[data-testid=entregas-move-cancel]").click();
  await pp.waitForTimeout(600);
  check("CANCELAR: todo queda en su fecha original", (await deliveryOf(CLI_MULTI, "E2E ARR CREMA")) === D1 && (await deliveryOf(CLI_MULTI, "E2E ARR SERUM")) === D1 && (await chip(pp, D1, CLI_MULTI).count()) === 1);

  // ===== Arrastrar y CONFIRMAR un solo producto (otra semana) =====
  const NEXT_WEEK = day(27);
  await mouseDrag(pp, chip(pp, D1, CLI_MULTI), pp.locator(`[data-testid=entregas-day][data-date='${NEXT_WEEK}']`));
  await dialog(pp).waitFor({ timeout: 15_000 });
  await pp.locator("[data-testid=entregas-move-option][data-product='E2E ARR CREMA'] input").check();
  await pp.locator("[data-testid=entregas-move-confirm]").dblclick();
  check("CONFIRMAR: el producto elegido pasa a la otra semana", await waitDb(async () => (await deliveryOf(CLI_MULTI, "E2E ARR CREMA")) === NEXT_WEEK));
  check("…el otro producto del cliente queda en su fecha", (await deliveryOf(CLI_MULTI, "E2E ARR SERUM")) === D1);
  check("…sin duplicar trabajos", (await q("select count(*)::int n from work_items where client = $1", [CLI_MULTI]))[0].n === 2);
  await pp.waitForTimeout(1200);
  check("el calendario se actualiza al instante (cliente en ambos días)", (await chip(pp, NEXT_WEEK, CLI_MULTI).count()) === 1 && (await chip(pp, D1, CLI_MULTI).count()) === 1);
  const audit = await q("select actor_email, payload from feature_audit_events where domain = 'entregas' and entity_id = $1 order by created_at desc limit 1", [`work:${(await q("select id from work_items where client = $1 and product = 'E2E ARR CREMA'", [CLI_MULTI]))[0].id}`]);
  const pay = audit[0] ? (typeof audit[0].payload === "string" ? JSON.parse(audit[0].payload) : audit[0].payload) : null;
  check("auditoría: usuario y fecha anterior → nueva, sin motivo", audit[0]?.actor_email === E2E_USERS.produccion.email && JSON.stringify(pay).includes(D1) && JSON.stringify(pay).includes(NEXT_WEEK), JSON.stringify(pay).slice(0, 160));
  check("…un solo cambio aunque se haga doble clic", (await q("select count(*)::int n from feature_audit_events where domain = 'entregas' and action = 'work_edit' and entity_id = $1", [`work:${(await q("select id from work_items where client = $1 and product = 'E2E ARR CREMA'", [CLI_MULTI]))[0].id}`]))[0].n === 1);

  // ===== Parcial con Envasado cerrado =====
  await mouseDrag(pp, chip(pp, day(21), CLI_PART), pp.locator(`[data-testid=entregas-day][data-date='${day(28)}']`));
  await dialog(pp).waitFor({ timeout: 15_000 });
  const detail = await pp.locator("[data-testid=entregas-move-option]").first().innerText();
  check("parcial: la opción muestra solo el saldo (200 pendientes)", /200/.test(detail) && /pendientes/.test(detail), detail.replace(/\n/g, " "));
  await pp.locator("[data-testid=entregas-move-confirm]").click();
  check("Envasado cerrado: se reprograma la entrega pendiente", await waitDb(async () => (await deliveryOf(CLI_PART, "E2E ARR PARCIAL")) === day(28)));
  const wp = (await q("select operational_status, finished_qty, planned_quantity, packaging_closed_at is not null c from work_items where id = $1", [wPart]))[0];
  check("…sin reabrir Envasado ni tocar cantidades", wp.operational_status === "completo" && wp.finished_qty === "500" && wp.planned_quantity === "500" && wp.c === true);

  // ===== Programada a mano: mover UN producto =====
  await pp.waitForTimeout(800);
  await mouseDrag(pp, chip(pp, day(22), CLI_PROG), pp.locator(`[data-testid=entregas-day][data-date='${day(29)}']`));
  await dialog(pp).waitFor({ timeout: 15_000 });
  await pp.locator("[data-testid=entregas-move-option][data-product='E2E ARR PROG B'] input").check();
  await pp.locator("[data-testid=entregas-move-confirm]").click();
  const progRows = async () => q("select i.product, to_char(d.delivery_date,'YYYY-MM-DD') d from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client = $1 and i.deleted_at is null and d.status <> 'cancelada' order by i.product", [CLI_PROG]);
  check("programada: solo el producto elegido cambia de fecha", await waitDb(async () => JSON.stringify(await progRows()) === JSON.stringify([{ product: "E2E ARR PROG A", d: day(22) }, { product: "E2E ARR PROG B", d: day(29) }])), JSON.stringify(await progRows()));

  // ===== Otro mes: dejar la tarjeta sobre «›» y soltar en el mes siguiente =====
  await pp.waitForTimeout(800);
  await mouseDrag(pp, chip(pp, D1, CLI_MULTI), () => pp.locator(`[data-testid=entregas-day][data-date='${NEXT}']`), pp.locator("[data-testid=entregas-drop-next]"));
  await dialog(pp).waitFor({ timeout: 15_000 });
  check("otro mes: la nueva fecha es del mes siguiente", (await pp.locator("[data-testid=entregas-move-to]").inputValue()) === NEXT);
  await pp.locator("[data-testid=entregas-move-confirm]").click();
  check("…se guarda", await waitDb(async () => (await deliveryOf(CLI_MULTI, "E2E ARR SERUM")) === NEXT));

  // ===== Persistencia =====
  await openEntregas(pp);
  check("recargar: las fechas nuevas se conservan", (await chip(pp, day(28), CLI_PART).count()) === 1 && (await chip(pp, day(21), CLI_PART).count()) === 0 && (await chip(pp, NEXT_WEEK, CLI_MULTI).count()) === 1);
  check("integridad: entregas reales, líneas, stock y MP sin cambios", (await fingerprint()) === fp0);
  await pr.ctx.close();

  // ===== Permisos =====
  const env = await openAs(E2E_USERS.envasado);
  await openEntregas(env.page);
  check("Envasado: ve el calendario pero no puede arrastrar", (await env.page.locator("[data-testid=entregas-drag]").count()) === 0);
  const wTouch = String((await q("select id from work_items where client = $1", [CLI_TOUCH]))[0].id);
  const denied = await env.page.request.patch(`/api/v1/entregas/work/${wTouch}`, { data: { action: "edit", deliveryDate: day(25) } });
  check("…y el servidor rechaza la reprogramación", denied.status() === 403, String(denied.status()));
  await env.ctx.close();

  // ===== Táctil en tablet (eventos touch reales: mantener apretado y arrastrar) =====
  const tab = await openAs(E2E_USERS.produccion, { width: 1280, height: 800 }, { hasTouch: true, isMobile: false });
  const tp = tab.page;
  await openEntregas(tp);
  const cdp = await tab.ctx.newCDPSession(tp);
  const a = await center(chip(tp, day(23), CLI_TOUCH));
  // Destino en la misma fila (lejos del borde: cerca del borde la página se desplaza sola mientras se arrastra).
  const b = await center(tp.locator(`[data-testid=entregas-day][data-date='${day(24)}']`));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  await tp.waitForTimeout(450);
  for (let i = 1; i <= 15; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 15, y: a.y + ((b.y - a.y) * i) / 15 }] });
    await tp.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const touchOk = await dialog(tp).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  check("tablet: arrastre táctil abre la confirmación", touchOk);
  if (touchOk) {
    await tp.screenshot({ path: `${OUT}/02-tablet-tactil.png` });
    await tp.locator("[data-testid=entregas-move-confirm]").tap();
    check("tablet: se guarda al confirmar", await waitDb(async () => (await deliveryOf(CLI_TOUCH, "E2E ARR TACTIL")) === day(24)));
  }
  await tab.ctx.close();
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
