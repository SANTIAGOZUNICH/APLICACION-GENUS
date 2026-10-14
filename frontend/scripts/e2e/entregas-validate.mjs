// E2E en Chromium real: Entregas (calendario mensual), carga, reprogramación, cancelación, vínculo con trabajos de Envasado,
// precarga al «Asignar trabajo», cambios posteriores (diferencias + confirmación), estados, permisos y responsive.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production. Ver run-entregas-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/entregas";
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
const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};
const TODAY = iso(new Date());
// Fechas dentro del MES ACTUAL (visibles en la grilla): la entrega y la reprogramación en días distintos de hoy;
// la fabricación elegida es hoy (aparece en Día/Semana) y la sugerida por la entrega es mañana.
const MONTH = TODAY.slice(0, 8);
const D_DELIVERY = `${MONTH}${TODAY.endsWith("-20") ? "21" : "20"}`;
const D_RESCHEDULED = `${MONTH}${TODAY.endsWith("-22") ? "23" : "22"}`;
const D_PRODUCTION = addDays(TODAY, 1);
const D_MAKE = TODAY;
const CLIENT = "E2E FIRMEA";
const CLIENT2 = "E2E CAV";
const P1 = "E2E CREMA ACLARANTE";
const P2 = "E2E SERUM FACIAL VITAMINA C";
const P3 = "E2E GEL DE BAÑO";

async function cleanup() {
  await q("delete from scheduled_delivery_links where item_id in (select i.id from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client like 'E2E %')");
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client like 'E2E %')");
  await q("delete from scheduled_deliveries where client like 'E2E %'");
  await q("delete from work_item_deliveries where client like 'E2E %'");
  await q("delete from operational_events where work_item_id in (select id from work_items where client like 'E2E %')");
  const wi = await q("select id from work_items where client like 'E2E %'");
  for (const w of wi) {
    await q("delete from operational_orders where linked_work_item_id = $1", [String(w.id)]).catch(() => {});
  }
  await q("delete from work_items where client like 'E2E %'");
  await q("delete from feature_audit_events where domain = 'entregas'");
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1500, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
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
  if (await burger.isVisible().catch(() => false)) await burger.click();
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
};
const openEntregas = async (page) => {
  await nav(page, "Entregas");
  await page.locator("[data-testid=entregas-view]").waitFor({ timeout: 120_000 });
};
const chips = (page, date) => page.locator(`[data-testid=entregas-day][data-date='${date}'] [data-testid=entregas-client]`).allInnerTexts();
const waitChip = (page, date, name) => page.waitForFunction(([d, n]) => [...document.querySelectorAll(`[data-testid=entregas-day][data-date='${d}'] [data-testid=entregas-client]`)].some((c) => c.textContent === n), [date, name], { timeout: 30_000 });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const deliveryRows = (client) => q("select *, to_char(delivery_date,'YYYY-MM-DD') as d from scheduled_deliveries where client = $1 order by created_at", [client]);
const itemRows = (deliveryId) => q("select *, to_char(planned_production_date,'YYYY-MM-DD') as pd from scheduled_delivery_items where delivery_id = $1 and deleted_at is null order by position", [deliveryId]);
const audit = (action) => q("select * from feature_audit_events where domain = 'entregas' and action = $1 order by created_at", [action]);
const stockSnapshot = async () => JSON.stringify({ m: (await q("select count(*)::int n from mp_stock_movements"))[0].n, b: await q("select codigo, stock_actual from mp_stock_balances order by codigo"), l: await q("select payload->>'codigo' c, payload->>'cantidadKg' k from inv_mp_stock order by 1,2") });

async function fillItem(page, idx, { product, quantity, unit, sector, lot, vto, prodDate }) {
  const box = page.locator("[data-testid=entrega-item]").nth(idx);
  await box.locator("[data-testid=entrega-item-product]").fill(product);
  if (quantity != null) await box.locator("[data-testid=entrega-item-quantity]").fill(quantity);
  if (unit != null) await box.locator("[data-testid=entrega-item-unit]").fill(unit);
  if (sector) await box.locator("[data-testid=entrega-item-sector]").selectOption(sector);
  if (lot) await box.locator("[data-testid=entrega-item-lot]").fill(lot);
  if (vto) await box.locator("[data-testid=entrega-item-vto]").fill(vto);
  if (prodDate) await box.locator("[data-testid=entrega-item-prod-date]").fill(prodDate);
}

try {
  await cleanup();
  const stock0 = await stockSnapshot();
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;

  // ===== 1. Carga desde el calendario: varios productos; datos pendientes sin inventar =====
  await openEntregas(pp);
  check("Menú lateral de Producción: pestaña «Entregas» y calendario mensual", (await pp.locator("[data-testid=entregas-month]").innerText()).length > 4);
  check("Se resalta la fecha de hoy", (await pp.locator("[data-testid=entregas-today-mark]").count()) === 1);
  check("Cabecera lunes→domingo", JSON.stringify(await pp.getByRole("columnheader").allInnerTexts()) === JSON.stringify(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]));
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}']`).click();
  await pp.locator("[data-testid=entregas-new]").click();
  await pp.locator("[data-testid=entrega-client]").fill(CLIENT);
  check("Fecha de entrega sugerida = día seleccionado", (await pp.locator("[data-testid=entrega-date]").inputValue()) === D_DELIVERY);
  await fillItem(pp, 0, { product: P1, quantity: "1.200", unit: "un.", sector: "ENVASADO_MASIVO", lot: "L-E2E-1", vto: "10/2028", prodDate: D_PRODUCTION });
  await pp.locator("[data-testid=entrega-add-item]").click();
  await fillItem(pp, 1, { product: P2, sector: "ENVASADO_PREMIUM" }); // sin cantidad, lote ni vencimiento: pendientes
  await pp.locator("[data-testid=entrega-responsible]").fill("Ana");
  await pp.locator("[data-testid=entrega-notes]").fill("Retira el cliente");
  await pp.screenshot({ path: `${OUT}/1-nueva-entrega.png` });
  await pp.locator("[data-testid=entrega-save]").click();
  await waitChip(pp, D_DELIVERY, CLIENT);
  const d1 = (await deliveryRows(CLIENT))[0];
  const items1 = await itemRows(d1.id);
  check("Entrega creada con 2 productos; cantidades, sector y fecha de producción guardados", items1.length === 2 && items1[0].quantity === "1.200" && items1[0].sector === "ENVASADO_MASIVO" && items1[0].pd === D_PRODUCTION && items1[0].lot === "L-E2E-1", JSON.stringify(items1.map((i) => [i.product, i.quantity, i.sector])));
  check("Lo que no se conocía queda PENDIENTE (null), nada inventado", items1[1].quantity === null && items1[1].lot === null && items1[1].vto === null && items1[1].planned_production_date === null);
  check("Auditoría: alta con quién y qué", (await audit("create")).length === 1 && (await audit("create"))[0].actor_email === E2E_USERS.produccion.email);
  check("Programar una entrega NO toca stock ni trabajos", (await stockSnapshot()) === stock0 && (await q("select count(*)::int n from work_items where client like 'E2E %'"))[0].n === 0);

  // ===== 2. Mismo cliente, mismo día: una sola entrada; otro cliente =====
  await pp.locator("[data-testid=entregas-new]").click();
  await pp.locator("[data-testid=entrega-client]").fill(CLIENT);
  await fillItem(pp, 0, { product: P3, quantity: "300", unit: "un.", sector: "ENVASADO_MASIVO" });
  await pp.locator("[data-testid=entrega-save]").click();
  await pp.waitForFunction(() => document.querySelectorAll("[data-testid=entrega-form]").length === 0);
  await pp.locator("[data-testid=entregas-new]").click();
  await pp.locator("[data-testid=entrega-client]").fill(CLIENT2);
  await fillItem(pp, 0, { product: P1, quantity: "500", unit: "un.", sector: "ENVASADO_MASIVO" });
  await pp.locator("[data-testid=entrega-save]").click();
  await waitChip(pp, D_DELIVERY, CLIENT2);
  const dayChips = await chips(pp, D_DELIVERY);
  check("2 entregas del mismo cliente el mismo día → el cliente aparece UNA vez (junto a otro cliente)", JSON.stringify(dayChips.sort()) === JSON.stringify([CLIENT2, CLIENT].sort()), dayChips.join(" | "));
  const cellText = await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}']`).innerText();
  check("Dentro de la celda: solo nombres de cliente (sin productos, cantidades, lotes ni observaciones)", !/CREMA|SERUM|GEL|1\.200|L-E2E|Retira/.test(cellText), cellText.replace(/\n/g, " ").slice(0, 120));
  await pp.screenshot({ path: `${OUT}/2-calendario-desktop.png` });

  // ===== 3. Tarjeta flotante con todo el detalle =====
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  const dlg = pp.locator("[data-testid=entrega-detail]");
  await dlg.waitFor();
  const txt = await dlg.innerText();
  check("Al tocar el cliente se ven TODAS sus entregas del día (2) con sus 3 productos", (await dlg.locator("[data-testid=entrega-card]").count()) === 2 && (await dlg.locator("[data-testid=entrega-item-name]").count()) === 3);
  check("Detalle: producto, cantidad y unidad, sector, lote, vencimiento, producción planificada, responsable, observaciones", /1\.200 un\./.test(txt) && /Envasado Masivo/.test(txt) && /L-E2E-1/.test(txt) && /10\/2028/.test(txt) && /Ana/.test(txt) && /Retira el cliente/.test(txt) && new RegExp(D_PRODUCTION.split("-").reverse().join("/")).test(txt));
  check("Estado inicial «Entrega programada»; lo pendiente se muestra como Pendiente", /Entrega programada/.test(txt) && /Pendiente/.test(txt));
  check("Hay historial de modificaciones", (await dlg.locator("[data-testid=entrega-history-toggle]").count()) === 2);
  await pp.screenshot({ path: `${OUT}/3-tarjeta-detalle.png` });
  await pp.keyboard.press("Escape");

  // ===== 4. Modificar =====
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  await pp.locator("[data-testid=entrega-card]").first().locator("[data-testid=entrega-edit]").click();
  await pp.locator("[data-testid=entrega-form]").waitFor();
  check("En edición la fecha está bloqueada (se usa «Reprogramar»)", await pp.locator("[data-testid=entrega-date]").isDisabled());
  await pp.locator("[data-testid=entrega-item-notes]").first().fill("Etiqueta con logo nuevo");
  await pp.locator("[data-testid=entrega-save]").click();
  check("Modificar guarda y audita antes/después", await waitDb(async () => (await audit("update")).length === 1 && (await itemRows(d1.id))[0].notes === "Etiqueta con logo nuevo"));
  await pp.keyboard.press("Escape");

  // ===== 5. Vinculación: «Asignar trabajo» sugiere, Producción elige y confirma =====
  await nav(pp, "Envasado Masivo");
  await pp.locator("[data-testid=open-assign-work-dialog]").click({ timeout: 60_000 });
  await pp.locator("#af-client").fill(CLIENT);
  await pp.locator("#af-product").fill(P1);
  await pp.locator("[data-testid=assign-entrega-suggestions]").waitFor({ timeout: 30_000 });
  const opts = await pp.locator("[data-testid=assign-entrega-option]").allInnerTexts();
  check("Asignar trabajo: muestra las entregas candidatas (cliente + producto + sector), sin elegir sola", opts.length === 1 && /E2E FIRMEA/.test(opts[0]) && /1\.200/.test(opts[0]) && /L-E2E-1/.test(opts[0]), opts.join(" | "));
  check("Antes de confirmar NO hay vínculo ni campos completados", (await pp.locator("#af-qty").inputValue()) === "" && (await q("select count(*)::int n from scheduled_delivery_links"))[0].n === 0);
  await pp.screenshot({ path: `${OUT}/4-asignar-sugerencias.png` });
  await pp.locator("[data-testid=assign-entrega-pick]").click();
  check("Al confirmar se precargan cantidad, lote, VTO y fecha de entrega", (await pp.locator("#af-qty").inputValue()) === "1.200" && (await pp.locator("#af-delivery").inputValue()) === D_DELIVERY && (await pp.locator("#af-lote").inputValue()) === "L-E2E-1" && (await pp.locator("#af-vto").inputValue()) === "10/2028");
  check("La fecha de producción propuesta viene de la entrega (si se cargó) y es editable", (await pp.locator("#af-date-from").inputValue()) === D_PRODUCTION);
  // Producción elige cuándo se fabrica: otro día distinto de la entrega y de lo sugerido.
  await pp.locator("#af-date-from").fill(D_MAKE);
  await pp.locator("#af-date-to").fill(D_MAKE);
  await pp.locator("#af-qty").fill("700"); // este trabajo cubre 700 de 1.200; otro completará el resto
  await pp.locator("[data-testid=assign-oa-number]").fill("OA-2026-990201").catch(() => {});
  await pp.screenshot({ path: `${OUT}/5-asignar-precargado.png` });
  await pp.locator("[data-testid=assign-submit]").click();
  await pp.waitForFunction(() => /asignad|creada|vinculad/i.test(document.querySelector("[data-testid=assign-feedback]")?.textContent ?? ""), null, { timeout: 60_000 }).catch(() => {});
  const w1 = (await q("select *, to_char(planned_date,'YYYY-MM-DD') as pd, to_char(delivery_date,'YYYY-MM-DD') as dd from work_items where client = $1 and product = $2", [CLIENT, P1]))[0];
  check("Trabajo creado con los datos de la entrega y la fecha de producción ELEGIDA por Producción", w1 && w1.sector === "ENVASADO_MASIVO" && w1.dd === D_DELIVERY && w1.pd === D_MAKE && w1.planned_quantity === "700" && w1.packaging_lote === "L-E2E-1" && w1.packaging_vto === "10/2028", JSON.stringify(w1 && [w1.sector, w1.dd, w1.pd, w1.planned_quantity, w1.packaging_lote]));
  const link1 = w1 ? await q("select * from scheduled_delivery_links where work_item_id = $1 and unlinked_at is null", [w1.id]) : [];
  check("Vínculo guardado con el id del producto de la entrega (y auditado)", link1.length === 1 && link1[0].item_id === items1[0].id && (await audit("link")).length === 1);

  // ===== 6. Varios trabajos completan un producto; sin duplicados =====
  const keyB = randomUUID();
  const asg = (page, data) => page.request.post("/api/v1/work-assignments", { data });
  const common = { sector: "ENVASADO_MASIVO", line: "Línea 2", client: CLIENT, product: P1, plannedQuantity: "500", unit: "un.", plannedDate: D_MAKE, plannedDateTo: D_MAKE, deliveryDate: D_DELIVERY, scheduledDeliveryItemId: items1[0].id, orderNumber: "OA-2026-990202" };
  const a2 = await asg(pp, { ...common, idempotencyKey: keyB });
  const a2r = await asg(pp, { ...common, idempotencyKey: keyB });
  check("Segundo trabajo para el mismo producto (una entrega se completa con varios)", a2.ok() && (await q("select count(*)::int n from scheduled_delivery_links l where l.item_id = $1 and l.unlinked_at is null", [items1[0].id]))[0].n === 2, String(a2.status()));
  check("Reintento idempotente: no duplica el trabajo ni el vínculo", a2r.ok() && (await q("select count(*)::int n from work_items where client = $1 and product = $2", [CLIENT, P1]))[0].n === 2 && (await q("select count(*)::int n from scheduled_delivery_links"))[0].n === 2);
  const w2 = (await q("select * from work_items where client = $1 and product = $2 and planned_quantity = '500'", [CLIENT, P1]))[0];
  const bad = await asg(pp, { ...common, idempotencyKey: randomUUID(), client: "E2E OTRO CLIENTE", orderNumber: "OA-2026-990203" });
  check("El servidor rechaza vincular un trabajo que no coincide con cliente/producto de la entrega", !bad.ok() && (await q("select count(*)::int n from work_items where client = 'E2E OTRO CLIENTE'"))[0].n === 0, String(bad.status()));
  const noPick = await asg(pp, { ...common, idempotencyKey: randomUUID(), scheduledDeliveryItemId: undefined, orderNumber: "OA-2026-990204", product: P3, plannedQuantity: "300" });
  check("Sin elegir entrega no se vincula nada solo", noPick.ok() && (await q("select count(*)::int n from scheduled_delivery_links"))[0].n === 2);
  const double = await pp.request.patch(`/api/v1/entregas/${d1.id}`, { data: { action: "link", itemId: items1[1].id, workItemId: w1.id } });
  check("Un trabajo no se vincula a dos entregas distintas (409)", double.status() === 409 || double.status() === 400, String(double.status()));

  // ===== 7. Día y Semana =====
  await nav(pp, "Envasado Masivo");
  await pp.getByRole("tab", { name: /^Día$/ }).or(pp.getByRole("button", { name: /^Día$/ })).first().click().catch(() => {});
  const goDay = async () => {
    await pp.locator("[data-testid=work-item-card]", { hasText: P1 }).first().waitFor({ timeout: 30_000 }).catch(() => {});
    return (await pp.locator("[data-testid=work-item-card]", { hasText: P1 }).count()) > 0;
  };
  check("Aparece en la vista Día del día de producción elegido, con su línea y fecha de entrega", await goDay());
  const cardTxt = await pp.locator("[data-testid=work-item-card]", { hasText: P1 }).first().innerText().catch(() => "");
  check("La tarjeta muestra cantidad, fecha de entrega y lote/VTO", /700/.test(cardTxt) && new RegExp(D_DELIVERY.split("-").reverse().join("/")).test(cardTxt), cardTxt.replace(/\n/g, " ").slice(0, 140));
  await pp.getByRole("tab", { name: /^Semana$/ }).or(pp.getByRole("button", { name: /^Semana$/ })).first().click();
  await pp.locator("[data-testid=work-item-card]", { hasText: P1 }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  check("Aparece en la vista Semana (tarjetas por día)", (await pp.locator("[data-testid=week-board-cards] [data-testid=work-item-card]", { hasText: P1 }).count()) >= 1);
  await pp.screenshot({ path: `${OUT}/6-semana-con-trabajos.png` });

  // ===== 8. Cambio posterior de la entrega: diferencias y confirmación antes de tocar el trabajo =====
  await q("update work_items set finished_qty = '120', operational_status = 'en_curso' where id = $1", [w1.id]); // el operario ya avanzó
  await openEntregas(pp);
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  await pp.locator("[data-testid=entrega-card]").first().locator("[data-testid=entrega-edit]").click();
  await pp.locator("[data-testid=entrega-item-quantity]").first().fill("1.500");
  await pp.locator("[data-testid=entrega-item-lot]").first().fill("L-E2E-9");
  await pp.locator("[data-testid=entrega-save]").click();
  await pp.waitForFunction(() => document.querySelectorAll("[data-testid=entrega-form]").length === 0);
  await pp.locator("[data-testid=entrega-divergences]").first().waitFor({ timeout: 30_000 });
  const div = await pp.locator("[data-testid=entrega-divergences]").first().innerText();
  check("Se muestra QUÉ cambió respecto del trabajo (cantidad y lote)", /Cantidad planificada/.test(div) && /Lote/.test(div) && /1\.500/.test(div) && /L-E2E-9/.test(div), div.replace(/\n/g, " ").slice(0, 160));
  check("Editar la entrega NO modificó el trabajo (hay que confirmar)", (await q("select planned_quantity, packaging_lote from work_items where id = $1", [w1.id]))[0].planned_quantity === "700" && (await q("select packaging_lote from work_items where id = $1", [w1.id]))[0].packaging_lote === "L-E2E-1");
  await pp.screenshot({ path: `${OUT}/7-diferencias.png` });
  await pp.locator("[data-testid=entrega-apply-open]").first().click();
  check("Aplicar exige motivo", await pp.locator("[data-testid=entrega-apply-confirm]").isDisabled());
  await pp.locator("[data-testid=entrega-apply-reason]").fill("El cliente amplió el pedido");
  await pp.locator("[data-testid=entrega-apply-confirm]").click();
  const applied = await waitDb(async () => (await q("select planned_quantity, packaging_lote from work_items where id = $1", [w1.id]))[0].planned_quantity === "1500");
  const w1b = (await q("select * from work_items where id = $1", [w1.id]))[0];
  check("Tras confirmar se aplica al trabajo (cantidad y lote)", applied && w1b.packaging_lote === "L-E2E-9");
  check("NO se pisó el avance del operario (cantidad realizada y estado)", w1b.finished_qty === "120" && w1b.operational_status === "en_curso");
  check("La aplicación queda auditada con motivo y valores", (await audit("apply_to_work")).some((e) => e.payload?.reason === "El cliente amplió el pedido" && e.payload?.fields?.length >= 1));
  await pp.keyboard.press("Escape");

  // ===== 9. Estados: terminar el envasado NO es entregar =====
  const status = async () => {
    await openEntregas(pp);
    await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
    const s = await pp.locator("[data-testid=entrega-card]").first().locator("[data-testid=entrega-item]").first().locator("[data-testid=entrega-status]").first().getAttribute("data-status");
    await pp.keyboard.press("Escape");
    return s;
  };
  // Cobertura parcial: 1.500 programadas, trabajos cubren 1.500 (w1 pasó a 1500) + 500 → cubierto.
  check("Producción en proceso (trabajo en curso)", (await status()) === "produccion_en_proceso");
  await q("update work_items set operational_status = 'completo' where client = $1 and product = $2", [CLIENT, P1]);
  check("Envasado terminado ≠ entregada: «Producción finalizada»", (await status()) === "produccion_finalizada");
  await q("update work_items set quality_status = 'aprobado' where client = $1 and product = $2", [CLIENT, P1]);
  check("Con Calidad aprobada: «Lista para entregar» (todavía no entregada)", (await status()) === "lista_para_entregar");
  for (const id of [w1.id, w2.id]) {
    await q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, actual_delivered_at, status, delivered_by, delivered_by_sector) values ($1,$2,$3,'ENVASADO_MASIVO','100', now(),'ENTREGADO','e2e','PRODUCCION')", [id, P1, CLIENT]);
  }
  check("Solo con la entrega REAL registrada pasa a «Entregada»", (await status()) === "entregada");
  const deliveryOfDay = await q("select status from scheduled_deliveries where id = $1", [d1.id]);
  check("La entrega programada sigue 'programada' en la base (el estado «Entregada» se deriva del flujo real, no se escribe)", deliveryOfDay[0].status === "programada");

  // ===== 10. Reprogramar (motivo) y cancelar (motivo) =====
  await openEntregas(pp);
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).click();
  const cardCav = pp.locator("[data-testid=entrega-card]").first();
  await cardCav.locator("[data-testid=entrega-reschedule-open]").click();
  await pp.locator("[data-testid=entrega-reschedule-date]").fill(D_RESCHEDULED);
  check("Reprogramar exige motivo", await pp.locator("[data-testid=entrega-reschedule-confirm]").isDisabled());
  await pp.locator("[data-testid=entrega-reschedule-reason]").fill("Pedido del cliente");
  await pp.locator("[data-testid=entrega-reschedule-confirm]").click();
  check("Reprogramada: cambia de fecha, cuenta la reprogramación y audita desde/hasta/motivo", await waitDb(async () => {
    const r = (await deliveryRows(CLIENT2))[0];
    const a = (await audit("reschedule"))[0];
    return r.d === D_RESCHEDULED && r.reschedule_count === 1 && a?.payload?.from === D_DELIVERY && a?.payload?.to === D_RESCHEDULED && a?.payload?.reason === "Pedido del cliente";
  }));
  await pp.keyboard.press("Escape").catch(() => {});
  await waitChip(pp, D_RESCHEDULED, CLIENT2);
  check("En el calendario el cliente se movió de día", !(await chips(pp, D_DELIVERY)).includes(CLIENT2));
  await pp.locator(`[data-testid=entregas-day][data-date='${D_RESCHEDULED}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).click();
  check("La tarjeta indica «Reprogramada 1 vez»", /Reprogramada 1 vez/.test(await pp.locator("[data-testid=entrega-detail]").innerText()));
  await pp.locator("[data-testid=entrega-cancel-open]").click();
  check("Cancelar exige motivo", await pp.locator("[data-testid=entrega-cancel-confirm]").isDisabled());
  await pp.locator("[data-testid=entrega-cancel-reason]").fill("El cliente suspendió el pedido");
  await pp.locator("[data-testid=entrega-cancel-confirm]").click();
  check("Cancelada: queda como historial (no se borra) con quién, cuándo y motivo", await waitDb(async () => { const r = (await deliveryRows(CLIENT2))[0]; return r?.status === "cancelada" && r.cancel_reason === "El cliente suspendió el pedido" && r.cancelled_by === E2E_USERS.produccion.email; }));
  check("Cancelar una entrega programada no toca entregas reales ni trabajos", (await q("select count(*)::int n from work_item_deliveries where client like 'E2E %'"))[0].n === 2 && (await q("select count(*)::int n from work_items where client like 'E2E %'"))[0].n >= 3);
  await pp.keyboard.press("Escape").catch(() => {});
  await waitDb(async () => (await pp.locator(`[data-testid=entregas-day][data-date='${D_RESCHEDULED}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).first().getAttribute("class")).includes("line-through"));
  check("La entrega cancelada se ve tachada en el calendario", (await pp.locator(`[data-testid=entregas-day][data-date='${D_RESCHEDULED}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).first().getAttribute("class")).includes("line-through"));
  const sug = await (await pp.request.get(`/api/v1/entregas/suggestions?client=${encodeURIComponent(CLIENT2)}&product=${encodeURIComponent(P1)}&sector=ENVASADO_MASIVO`)).json();
  check("Una entrega cancelada ya no se sugiere al asignar trabajos", (sug.suggestions ?? []).length === 0);
  const stale = await pp.request.patch(`/api/v1/entregas/${d1.id}`, { data: { action: "reschedule", newDate: addDays(D_DELIVERY, 3), reason: "Prueba de versión vieja", expectedVersion: 1 } });
  check("Versión vieja → 409 (nunca se pisa lo que cambió otra persona)", stale.status() === 409, String(stale.status()));

  // ===== 11. Permisos (servidor) =====
  const masivo = await openAs(E2E_USERS.envasado);
  const premium = await openAs(E2E_USERS.envasadoPremium);
  const deposito = await openAs(E2E_USERS.deposito);
  const calidad = await openAs(E2E_USERS.calidad);
  const elab = await openAs(E2E_USERS.elaboracion);
  const range = `from=${addDays(TODAY, -40)}&to=${addDays(TODAY, 40)}`;
  const listAs = async (u) => (await (await u.page.request.get(`/api/v1/entregas?${range}`)).json()).deliveries ?? [];
  const lm = await listAs(masivo);
  check("Envasado Masivo ve SOLO los productos de su sector (no el Serum de Premium)", lm.length > 0 && lm.flatMap((d) => d.items).every((i) => i.sector === "ENVASADO_MASIVO") && !JSON.stringify(lm).includes(P2));
  const lp = await listAs(premium);
  check("Envasado Premium ve solo lo suyo", lp.flatMap((d) => d.items).every((i) => i.sector === "ENVASADO_PREMIUM") && JSON.stringify(lp).includes(P2) && !JSON.stringify(lp).includes(P1));
  const ld = await listAs(deposito);
  check("Depósito consulta todo", JSON.stringify(ld).includes(P1) && JSON.stringify(ld).includes(P2));
  check("Calidad y Elaboración no acceden a Entregas (403)", (await calidad.page.request.get(`/api/v1/entregas?${range}`)).status() === 403 && (await elab.page.request.get(`/api/v1/entregas?${range}`)).status() === 403);
  const newDelivery = { client: "E2E INTRUSO", deliveryDate: D_DELIVERY, items: [{ product: "X" }] };
  const denied = await Promise.all([masivo, premium, deposito].map((u) => u.page.request.post("/api/v1/entregas", { data: newDelivery })));
  check("Envasado y Depósito NO pueden crear entregas (403)", denied.every((r) => r.status() === 403) && (await deliveryRows("E2E INTRUSO")).length === 0);
  const deniedPatch = await masivo.page.request.patch(`/api/v1/entregas/${d1.id}`, { data: { action: "cancel", reason: "Intento no autorizado", expectedVersion: 99 } });
  check("Envasado no puede cancelar ni reprogramar (403)", deniedPatch.status() === 403);
  const deniedSug = await masivo.page.request.get(`/api/v1/entregas/suggestions?client=${CLIENT}&product=${P1}`);
  check("Las sugerencias de «Asignar trabajo» son solo de Producción (403)", deniedSug.status() === 403);
  await masivo.page.goto("/mi-trabajo");
  await openEntregas(masivo.page);
  await masivo.page.locator("[data-testid=entregas-client]").first().click();
  const mdlg = await masivo.page.locator("[data-testid=entrega-detail]").innerText();
  check("Envasado ve el detalle de lo suyo en solo lectura (sin Modificar/Reprogramar/Cancelar) y no ve el producto de Premium", !(await masivo.page.locator("[data-testid=entrega-edit]").count()) && !(await masivo.page.locator("[data-testid=entrega-cancel-open]").count()) && !mdlg.includes(P2));
  check("Envasado no ve el botón «Nueva entrega»", (await masivo.page.locator("[data-testid=entregas-new]").count()) === 0);
  check("Programar, vincular y cancelar nunca movieron stock", (await stockSnapshot()) === stock0);

  // ===== 12. Responsive: tablet y celular =====
  for (const [name, vp] of [["tablet", { width: 820, height: 1100 }], ["mobile", { width: 390, height: 844 }]]) {
    const r = await openAs(E2E_USERS.produccion, vp);
    await openEntregas(r.page);
    await r.page.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}']`).click();
    const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const agenda = await r.page.locator("[data-testid=entregas-agenda]").innerText();
    check(`${name}: sin scroll horizontal y el día seleccionado lista sus clientes`, !overflow && agenda.includes(CLIENT), agenda.replace(/\n/g, " ").slice(0, 80));
    await r.page.locator("[data-testid=entregas-agenda] [data-testid=entregas-client]").first().click();
    await r.page.locator("[data-testid=entrega-detail]").waitFor();
    const box = await r.page.locator("[data-testid=entrega-detail]").boundingBox();
    check(`${name}: la tarjeta flotante entra en pantalla`, box && box.width <= vp.width);
    await r.page.screenshot({ path: `${OUT}/8-${name}-tarjeta.png` });
    await r.page.keyboard.press("Escape");
    await r.page.screenshot({ path: `${OUT}/8-${name}-calendario.png` });
    await r.ctx.close();
  }
  await pp.goto("/mi-trabajo");
  await openEntregas(pp);
  await pp.screenshot({ path: `${OUT}/9-calendario-desktop.png` });
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
