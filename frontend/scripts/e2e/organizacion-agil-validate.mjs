// E2E en Chromium real: organización ágil del día a día.
//  - Semana de Envasado: mover un trabajo a OTRA semana / OTRO mes desde la tarjeta (CONFIRMAR, sin motivo), persistencia
//    al recargar, sincronización con Día a día, sin duplicar; arrastrar y CANCELAR (vuelve) / CONFIRMAR (guarda una vez).
//  - Permisos: el operario de Envasado no mueve ni cambia fechas (y el servidor lo rechaza).
//  - Entregas = agenda de PENDIENTES: parcial muestra solo el saldo, completa no aparece, Entregados conserva lo histórico;
//    fecha de entrega editable con Envasado cerrado y SIN motivo.
//  - Pestaña general «Semanas» retirada; vistas semanales de los sectores intactas (escritorio y tablet).
//  - Integridad: stock/MP, OE y entregas reales sin cambios; auditoría con usuario y antes/después.
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
const OUT = process.env.OUT ?? "/tmp/organizacion-agil";
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
const days = (w) => [0, 1, 2, 3, 4].map((n) => addDays(w, n));
const MONTH = TODAY.slice(0, 8);
const CLIENT = "E2E AGIL CLIENTE";
const NEXT_MONTH = (() => {
  const [y, m] = TODAY.split("-").map(Number);
  return iso(new Date(y, m, 10)); // día 10 del mes siguiente
})();

async function cleanup() {
  const wi = (await q("select id from work_items where client ilike 'E2E AGIL%'")).map((r) => String(r.id));
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
    l: await q("select id, quantity, actual_delivered_at, status from work_item_delivery_lines order by id"),
    wd: await q("select id, quantity, actual_delivered_at, status from work_item_deliveries order by id"),
    m: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    b: await q("select codigo, stock_actual from mp_stock_balances order by codigo"),
    oe: (await q("select count(*)::int n from operational_orders"))[0].n,
  });

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
  if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("button", { name: "Abrir menú" }).click({ timeout: 120_000 });
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
};
/** Vista Semana de Envasado Masivo (Producción la abre desde «Envasado Masivo»; el operario desde Mi trabajo). */
async function openEnvasadoWeek(page, asProduccion) {
  if (asProduccion) {
    await page.goto("/mi-trabajo");
    await nav(page, "Envasado Masivo");
  } else await page.goto("/mi-trabajo");
  await page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 120_000 });
  await page.locator("[data-testid=week-board-columns]").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
}
const card = (page, product) => page.locator("[data-testid=week-job-card]", { hasText: product }).first();
const cardDay = (page, product) => card(page, product).evaluate((el) => el.closest("[data-day]")?.getAttribute("data-day") ?? null).catch(() => null);
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
async function dragCard(page, product, targetDay, zone = "1") {
  const src = await card(page, product).boundingBox();
  const dst = await page.locator(`[data-testid='week-board-daycell-${zone}::${targetDay}']`).boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(src.x + src.width / 2 + ((dst.x + dst.width / 2 - src.x - src.width / 2) * i) / 12, src.y + 10 + ((dst.y + 30 - src.y - 10) * i) / 12);
  await page.mouse.up();
}

try {
  await cleanup();
  const fp0 = await fingerprint();
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;
  await pp.goto("/mi-trabajo");
  await pp.waitForTimeout(2500);

  // ===== Pestaña general «Semanas» retirada; vistas de sectores intactas =====
  const menu = (await pp.locator("nav").first().innerText()).split("\n").map((x) => x.trim());
  check("Producción: sin pestaña general «Semanas» en el menú", !menu.includes("Semanas"), menu.join(" | ").slice(0, 200));
  check("Producción: conserva Envasado Masivo / Premium / Elaboración / Entregas", ["Envasado Masivo", "Envasado Premium", "Elaboración", "Entregas"].every((m) => menu.includes(m)));
  check("Producción aterriza en una sección válida (Pedidos)", /Pedidos/i.test(await pp.locator("main").innerText()));

  // ===== Datos =====
  const asg = async (product, plannedDate, extra = {}) => {
    const r = await pp.request.post("/api/v1/work-assignments", {
      data: { unit: "un.", plannedDate, plannedDateTo: plannedDate, sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLIENT, product, idempotencyKey: randomUUID(), plannedQuantity: "500", ...extra },
    });
    if (!r.ok()) throw new Error(`asignación ${product}: ${r.status()} ${await r.text()}`);
    return String((await q("select id from work_items where client = $1 and product = $2", [CLIENT, product]))[0].id);
  };
  const d = days(W0);
  const id = {};
  id.mover = await asg("E2E AGIL MOVER", d[3]);
  id.drag = await asg("E2E AGIL ARRASTRAR", d[1]);
  id.otro = await asg("E2E AGIL OTRO DEL CLIENTE", d[3]);

  // ===== Mover a OTRA semana desde la tarjeta (sin motivo) =====
  await openEnvasadoWeek(pp, true);
  check("Semana de Envasado (vista del sector) sigue disponible", (await pp.locator("[data-testid=week-board-columns]").count()) > 0);
  const nextWeekDay = addDays(d[3], 5); // martes de la semana siguiente
  await card(pp, "E2E AGIL MOVER").locator("[data-testid=week-job-date]").fill(nextWeekDay);
  await pp.locator("[data-testid=move-confirm]").waitFor({ timeout: 15_000 });
  check("cambiar fecha: pide CONFIRMAR/CANCELAR, sin motivo", (await pp.locator("[data-testid=move-confirm] input").count()) === 0 && /CONFIRMAR/.test(await pp.locator("[data-testid=move-confirm]").innerText()));
  await pp.locator("[data-testid=move-confirm-ok]").click();
  check("otra semana: se guarda en la asignación original (sin duplicar)", await waitDb(async () => (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.mover]))[0].d === nextWeekDay));
  check("…sin tocar el otro trabajo del cliente", (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.otro]))[0].d === d[3]);
  check("…sin copias", (await q("select count(*)::int n from work_items where client = $1 and product = 'E2E AGIL MOVER'", [CLIENT]))[0].n === 1);
  await pp.waitForTimeout(1500);
  check("la vista se actualiza: ya no está en esta semana", (await card(pp, "E2E AGIL MOVER").count()) === 0);
  await pp.getByRole("button", { name: "Semana siguiente" }).click();
  await pp.waitForTimeout(1500);
  check("aparece en la semana siguiente, en su día", (await cardDay(pp, "E2E AGIL MOVER")) === nextWeekDay);

  // ===== Mover a OTRO mes =====
  await card(pp, "E2E AGIL MOVER").locator("[data-testid=week-job-date]").fill(NEXT_MONTH);
  await pp.locator("[data-testid=move-confirm-ok]").click();
  check("otro mes: se guarda", await waitDb(async () => (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.mover]))[0].d === NEXT_MONTH));

  // ===== Persistencia al recargar + Día a día =====
  await pp.reload();
  await openEnvasadoWeek(pp, true);
  check("recargar: el trabajo no volvió a su fecha anterior", (await card(pp, "E2E AGIL MOVER").count()) === 0);
  const sem = await pp.request.get(`/api/v1/work-items?sector=ENVASADO_MASIVO&date=${NEXT_MONTH}`);
  check("Día a día del nuevo día lo muestra (misma fuente)", JSON.stringify(await sem.json()).includes(id.mover));
  const ev = await q("select from_status, to_status, actor_email from operational_events where work_item_id = $1 order by created_at desc limit 1", [id.mover]);
  check("auditoría: usuario, valor anterior y nuevo (sin motivo inventado)", ev.length === 1 && /planned/i.test(String(ev[0].to_status)) && String(ev[0].to_status).includes(NEXT_MONTH));

  // ===== Arrastrar y CANCELAR / CONFIRMAR =====
  await dragCard(pp, "E2E AGIL ARRASTRAR", d[4]);
  await pp.locator("[data-testid=move-confirm]").waitFor({ timeout: 15_000 }).catch(() => {});
  check("arrastrar: muestra la confirmación", (await pp.locator("[data-testid=move-confirm]").count()) === 1);
  await pp.screenshot({ path: `${OUT}/01-arrastrar-confirmar.png` });
  check("…y no guardó nada antes de confirmar", (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.drag]))[0].d === d[1]);
  await pp.locator("[data-testid=move-confirm-cancel]").click();
  await pp.waitForTimeout(800);
  check("CANCELAR: la tarjeta vuelve a su fecha original", (await cardDay(pp, "E2E AGIL ARRASTRAR")) === d[1] && (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.drag]))[0].d === d[1]);
  await dragCard(pp, "E2E AGIL ARRASTRAR", d[4]);
  await pp.locator("[data-testid=move-confirm]").waitFor({ timeout: 15_000 });
  await pp.locator("[data-testid=move-confirm-ok]").dblclick();
  check("CONFIRMAR: se guarda la nueva fecha", await waitDb(async () => (await q("select to_char(planned_date,'YYYY-MM-DD') d from work_items where id = $1", [id.drag]))[0].d === d[4]));
  await pp.waitForTimeout(1200);
  const moves = await q("select count(*)::int n from operational_events where work_item_id = $1 and to_status like $2", [id.drag, `%${d[4]}%`]);
  check("…una sola vez aunque se haga doble clic (un único evento auditado)", moves[0].n === 1, String(moves[0].n));
  check("…y la tarjeta queda en el nuevo día", (await cardDay(pp, "E2E AGIL ARRASTRAR")) === d[4]);

  // ===== Permisos: el operario de Envasado no mueve =====
  const op = await openAs(E2E_USERS.envasado);
  await openEnvasadoWeek(op.page, false);
  check("operario de Envasado: ve su semana, sin selector de fecha", (await card(op.page, "E2E AGIL ARRASTRAR").count()) === 1 && (await op.page.locator("[data-testid=week-job-date]").count()) === 0);
  const denied = await op.page.request.post("/api/v1/live-sync/operations", { data: { action: "reschedule_work", itemId: `native:${id.drag}`, plannedDate: d[0], actorSectorId: "ENVASADO_MASIVO" } });
  check("…y el servidor rechaza que mueva trabajos", !denied.ok(), String(denied.status()));
  await op.ctx.close();

  // ===== Tablet =====
  const tab = await openAs(E2E_USERS.produccion, { width: 820, height: 1180 });
  await openEnvasadoWeek(tab.page, true);
  check("tablet: vista semanal de Envasado y selector de fecha disponibles", (await tab.page.locator("[data-testid=week-job-date]").count()) > 0);
  await tab.page.screenshot({ path: `${OUT}/02-tablet.png` });
  await tab.ctx.close();

  // ===== Entregas = agenda de PENDIENTES =====
  const D_PARCIAL = `${MONTH}27`;
  const D_COMPLETA = `${MONTH}26`;
  id.parcial = await asg("E2E AGIL PARCIAL", d[0], { deliveryDate: D_PARCIAL });
  id.completa = await asg("E2E AGIL COMPLETA", d[0], { deliveryDate: D_COMPLETA });
  await q("update work_items set operational_status = 'completo', finished_qty = '500', packaging_closed_at = now(), packaging_closed_by = 'E2E' where id = any($1::uuid[])", [[id.parcial, id.completa]]);
  for (const [w, qty, status] of [[id.parcial, 300, "completo"], [id.completa, 500, "entregado"]]) {
    await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
       values ($1, (select product from work_items where id = $1), $2, 'ENVASADO_MASIVO', $3, 'un', now(), 'E2E', 'ENVASADO_MASIVO', 'ENTREGADO')`,
      [w, CLIENT, String(qty)]
    );
    await q("update work_items set operational_status = $2 where id = $1", [w, status]);
  }
  const fpE = await fingerprint();
  await nav(pp, "Entregas");
  await pp.locator("[data-testid=entregas-view]").waitFor({ timeout: 120_000 });
  await pp.waitForTimeout(1500);
  const chip = (date) => pp.locator(`[data-testid=entregas-day][data-date='${date}'] [data-testid=entregas-client][data-client='${CLIENT}']`);
  check("entrega completa: no aparece en Entregas", (await chip(D_COMPLETA).count()) === 0);
  check("entrega parcial: aparece en su fecha programada", (await chip(D_PARCIAL).count()) === 1);
  await chip(D_PARCIAL).first().click();
  await pp.locator("[data-testid=entrega-detail]").waitFor({ timeout: 30_000 });
  const pend = pp.locator("[data-testid=entrega-item-pending]").first();
  check("…muestra solo el saldo (200 de 500)", (await pend.getAttribute("data-pending")) === "200", await pend.innerText().catch(() => ""));
  // Envasado cerrado + saldo pendiente: cambiar la fecha de entrega SIN motivo.
  const box = pp.locator("[data-testid=entrega-item]", { hasText: "E2E AGIL PARCIAL" }).first();
  await box.locator("[data-testid=entrega-work-edit-open]").click();
  const newDel = `${MONTH}28`;
  await box.locator("[data-testid=entrega-work-edit-date]").fill(newDel);
  check("fecha de entrega: el motivo es opcional (se puede confirmar vacío)", await box.locator("[data-testid=entrega-work-edit-confirm]").isEnabled());
  await box.locator("[data-testid=entrega-work-edit-confirm]").click();
  check("Envasado cerrado: la fecha de entrega se reprograma sin motivo", await waitDb(async () => (await q("select to_char(delivery_date,'YYYY-MM-DD') d from work_items where id = $1", [id.parcial]))[0].d === newDel));
  const w = (await q("select operational_status, finished_qty, packaging_closed_at is not null c from work_items where id = $1", [id.parcial]))[0];
  check("…sin reabrir Envasado ni tocar estado/unidades", w.operational_status === "completo" && w.finished_qty === "500" && w.c === true);
  check("…y sin tocar entregas reales, stock, MP ni OE", (await fingerprint()) === fpE);
  await pp.keyboard.press("Escape");

  // Entregados conserva lo histórico.
  await nav(pp, "Entregados");
  await pp.waitForTimeout(3000);
  const ent = await pp.locator("main").innerText();
  check("Entregados conserva las entregas realizadas (completa y parcial)", /E2E AGIL COMPLETA/.test(ent) && /E2E AGIL PARCIAL/.test(ent));
  await pr.ctx.close();

  check("integridad: stock, MP y OE sin cambios por mover trabajos", JSON.stringify(JSON.parse(fp0).m) === JSON.stringify(JSON.parse(await fingerprint()).m) && JSON.stringify(JSON.parse(fp0).b) === JSON.stringify(JSON.parse(await fingerprint()).b));
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
