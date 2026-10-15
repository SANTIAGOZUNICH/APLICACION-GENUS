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
  await q("delete from scheduled_delivery_links where item_id in (select i.id from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client ilike 'E2E %')");
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client ilike 'E2E %')");
  await q("delete from scheduled_deliveries where client ilike 'E2E %'");
  await q("delete from delivery_calendar_hidden where work_item_id in (select id from work_items where client ilike 'E2E %')").catch(() => {});
  await q("delete from work_item_delivery_lines where work_item_id in (select id from work_items where client ilike 'E2E %')").catch(() => {});
  await q("delete from work_item_deliveries where client ilike 'E2E %'");
  await q("delete from operational_events where work_item_id in (select id from work_items where client ilike 'E2E %')");
  const wi = await q("select id from work_items where client ilike 'E2E %'");
  for (const w of wi) {
    await q("delete from operational_orders where linked_work_item_id = $1", [String(w.id)]).catch(() => {});
  }
  await q("delete from work_items where client ilike 'E2E %'");
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
  // Si quedó una tarjeta/diálogo abierto, se cierra antes de usar el menú.
  for (let i = 0; i < 3 && (await page.locator("[role=dialog]").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
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
  const heads = await pp.locator("[data-testid=entregas-view] [role=columnheader]").allInnerTexts();
  check("Cabecera lunes→domingo", JSON.stringify(heads.map((h) => h.toLowerCase())) === JSON.stringify(["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]), JSON.stringify(heads));
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
  check("Programar una entrega NO toca stock ni trabajos", (await stockSnapshot()) === stock0 && (await q("select count(*)::int n from work_items where client ilike 'E2E %'"))[0].n === 0);

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
  check("Estado inicial «Entrega programada»; lo que falta se muestra como «No registrado»", /Entrega programada/.test(txt) && /No registrado/.test(txt));
  check("Origen visible en la tarjeta: «Programada manual»", /Programada manual/.test(txt));
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
  await q("update work_items set packaging_lote = 'L-MANUAL-OPERARIO' where id = $1", [w2.id]); // edición manual previa en otro trabajo
  await openEntregas(pp);
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  check("Sin cambios en la entrega NO hay avisos de diferencias (ni por parcialidad ni por ediciones manuales del trabajo)", (await pp.locator("[data-testid=entrega-divergences]").count()) === 0);
  await pp.locator("[data-testid=entrega-card]").first().locator("[data-testid=entrega-edit]").click();
  await pp.locator("[data-testid=entrega-item-quantity]").first().fill("1.500");
  await pp.locator("[data-testid=entrega-item-lot]").first().fill("L-E2E-9");
  await pp.locator("[data-testid=entrega-save]").click();
  await pp.waitForFunction(() => document.querySelectorAll("[data-testid=entrega-form]").length === 0);
  await pp.waitForFunction(() => /L-E2E-9/.test(document.querySelector("[data-testid=entrega-divergences]")?.textContent ?? ""), null, { timeout: 30_000 });
  const div = await pp.locator("[data-testid=entrega-divergences]").first().innerText();
  check("Se muestra QUÉ cambió después de asignar (el lote nuevo)", /Lote/.test(div) && /L-E2E-9/.test(div), div.replace(/\n/g, " ").slice(0, 160));
  check("Con varios trabajos la cantidad no se compara por trabajo: se muestra la cobertura (faltan 300)", !/Cantidad planificada/.test(div) && /faltan 300/.test(await pp.locator("[data-testid=entrega-coverage]").first().innerText()));
  check("Editar la entrega NO modificó los trabajos (hay que confirmar)", (await q("select packaging_lote from work_items where id = $1", [w1.id]))[0].packaging_lote === "L-E2E-1" && (await q("select packaging_lote from work_items where id = $1", [w2.id]))[0].packaging_lote === "L-MANUAL-OPERARIO");
  await pp.screenshot({ path: `${OUT}/7-diferencias.png` });
  await pp.locator("[data-testid=entrega-apply-open]").first().click();
  check("Aplicar exige motivo", await pp.locator("[data-testid=entrega-apply-confirm]").isDisabled());
  await pp.locator("[data-testid=entrega-apply-reason]").fill("El cliente cambió el lote");
  await pp.locator("[data-testid=entrega-apply-confirm]").click();
  const applied = await waitDb(async () => (await q("select packaging_lote from work_items where id = $1", [w1.id]))[0].packaging_lote === "L-E2E-9");
  const w1b = (await q("select * from work_items where id = $1", [w1.id]))[0];
  check("Tras confirmar se aplica al trabajo elegido (lote)", applied);
  check("NO se pisó el avance del operario (cantidad realizada y estado)", w1b.finished_qty === "120" && w1b.operational_status === "en_curso");
  check("La aplicación queda auditada con motivo y valores", (await audit("apply_to_work")).some((e) => e.payload?.reason === "El cliente cambió el lote" && e.payload?.fields?.length >= 1));
  // El otro trabajo: Producción decide mantenerlo como está.
  await pp.locator("[data-testid=entrega-divergences]").first().waitFor({ timeout: 30_000 });
  await pp.locator("[data-testid=entrega-keep-open]").first().click();
  await pp.locator("[data-testid=entrega-keep-reason]").fill("Ese lote ya está etiquetado");
  await pp.locator("[data-testid=entrega-keep-confirm]").click();
  const keepOk = await waitDb(async () => (await audit("keep_work_as_is")).length === 1);
  const w2Lote = (await q("select packaging_lote from work_items where id = $1", [w2.id]))[0].packaging_lote;
  const stillShown = await waitDb(async () => (await pp.locator("[data-testid=entrega-divergences]").count()) === 0);
  const keepErr = await pp.locator("[data-testid=entrega-work-error]").allInnerTexts();
  check("«Mantener el trabajo como está»: no modifica el trabajo, queda auditado y deja de avisar", keepOk && w2Lote === "L-MANUAL-OPERARIO" && stillShown, JSON.stringify({ keepOk, w2Lote, stillShown, keepErr }));
  await pp.keyboard.press("Escape");
  // Un tercer trabajo completa la cantidad programada (1.500 = 700 + 500 + 300).
  const a3 = await asg(pp, { ...common, idempotencyKey: randomUUID(), plannedQuantity: "300", line: "Línea 3", orderNumber: "OA-2026-990205" });
  check("Un tercer trabajo completa la cantidad programada", a3.ok() && (await q("select count(*)::int n from scheduled_delivery_links where item_id = $1 and unlinked_at is null", [items1[0].id]))[0].n === 3);

  // ===== 9. Estados: terminar el envasado NO es entregar =====
  const status = async () => {
    await pp.goto("/mi-trabajo"); // recarga: el calendario lee los estados frescos de los trabajos
    await openEntregas(pp);
    await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
    const s = await pp.locator("[data-testid=entrega-card]").first().locator("[data-testid=entrega-item]").first().locator("[data-testid=entrega-status]").first().getAttribute("data-status");
    await pp.keyboard.press("Escape");
    return s;
  };
  // Cobertura parcial: 1.500 programadas, trabajos cubren 1.500 (w1 pasó a 1500) + 500 → cubierto.
  const st1 = await status();
  check("Producción en proceso (trabajo en curso)", st1 === "produccion_en_proceso", st1);
  await q("update work_items set operational_status = 'completo' where client = $1 and product = $2", [CLIENT, P1]);
  const st2 = await status();
  check("Envasado terminado y sin entregar: «Lista para entregar» (sin aprobación de Calidad en el circuito)", st2 === "lista_para_entregar", st2);
  // Entrega PARCIAL: se entrega solo una parte de lo producido; queda saldo pendiente → nunca «Entregada» hasta completar.
  const p1Works = (await q("select id, coalesce(finished_qty, planned_quantity) as qty from work_items where client = $1 and product = $2 order by created_at", [CLIENT, P1]));
  await q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, actual_delivered_at, status, delivered_by, delivered_by_sector) values ($1,$2,$3,'ENVASADO_MASIVO','100', now(),'ENTREGADO','e2e','PRODUCCION')", [p1Works[0].id, P1, CLIENT]);
  const st3 = await status();
  check("Entrega parcial (100 de lo producido): «Entrega parcial», no «Entregada»", st3 === "entrega_parcial", st3);
  await q("delete from work_item_deliveries where work_item_id = $1", [p1Works[0].id]);
  for (const w of p1Works) {
    await q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, actual_delivered_at, status, delivered_by, delivered_by_sector) values ($1,$2,$3,'ENVASADO_MASIVO',$4, now(),'ENTREGADO','e2e','PRODUCCION')", [w.id, P1, CLIENT, String(w.qty)]);
  }
  const st4 = await status();
  check("Solo con la entrega REAL completa registrada pasa a «Entregada»", st4 === "entregada", st4);
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
  check("Cancelar una entrega programada no toca entregas reales ni trabajos", (await q("select count(*)::int n from work_item_deliveries where client ilike 'E2E %'"))[0].n === 3 && (await q("select count(*)::int n from work_items where client ilike 'E2E %'"))[0].n >= 3);
  await pp.keyboard.press("Escape").catch(() => {});
  await waitDb(async () => (await pp.locator(`[data-testid=entregas-day][data-date='${D_RESCHEDULED}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).first().getAttribute("class")).includes("line-through"));
  check("La entrega cancelada se ve tachada en el calendario", (await pp.locator(`[data-testid=entregas-day][data-date='${D_RESCHEDULED}'] [data-testid=entregas-client][data-client='${CLIENT2}']`).first().getAttribute("class")).includes("line-through"));
  const sug = await (await pp.request.get(`/api/v1/entregas/suggestions?client=${encodeURIComponent(CLIENT2)}&product=${encodeURIComponent(P1)}&sector=ENVASADO_MASIVO`)).json();
  check("Una entrega cancelada ya no se sugiere al asignar trabajos", (sug.suggestions ?? []).length === 0);
  const stale = await pp.request.patch(`/api/v1/entregas/${d1.id}`, { data: { action: "reschedule", newDate: addDays(D_DELIVERY, 3), reason: "Prueba de versión vieja", expectedVersion: 1 } });
  check("Versión vieja → 409 (nunca se pisa lo que cambió otra persona)", stale.status() === 409, String(stale.status()));

  // ===== 10b. Recuperación automática: histórico (fecha REAL de entrega) + futuro (fecha de entrega del trabajo) =====
  // Nada de esto se carga en la pestaña Entregas: sale de work_items / work_item_deliveries. Fechas dentro del mes actual.
  const DAY = (n) => `${MONTH}${String(n).padStart(2, "0")}`;
  const H_PROD = DAY(2); // fin de producción (completed_at): NO es la entrega
  const H_REAL = DAY(6); // entrega real (actual_delivered_at, 22:30 hora Argentina = 01:30 UTC del día siguiente)
  const PART_REAL = DAY(7);
  const FUT = DAY(25);
  const FUT2 = DAY(26);
  const FUT_PART = DAY(27);
  const HIST_CLIENT = "E2E TSU";
  const FUT_CLIENT = "E2E FUTURO";
  const PART_CLIENT = "E2E PARCIAL";
  const NOREAL_CLIENT = "E2E SINFECHA";
  const stats0 = (await (await pp.request.get("/api/v1/entregas/recovery")).json()).stats;
  const scheduledBefore = (await q("select count(*)::int n from scheduled_deliveries"))[0].n;
  const mk = async (data, oa) => {
    const r = await asg(pp, { unit: "un.", plannedDate: TODAY, plannedDateTo: TODAY, sector: "ENVASADO_MASIVO", line: "Línea 1", idempotencyKey: randomUUID(), orderNumber: oa, ...data });
    if (!r.ok()) throw new Error(`No se pudo sembrar ${data.product}: ${r.status()} ${await r.text()}`);
    return (await q("select id from work_items where client = $1 and product = $2", [data.client, data.product]))[0].id;
  };
  const realDelivery = (workId, client, product, qty, ts) => q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, actual_delivered_at, status, delivered_by, delivered_by_sector, remito, received_by) values ($1,$2,$3,'ENVASADO_MASIVO',$4,$5::timestamptz,'ENTREGADO','e2e','PRODUCCION','R-E2E-1','Recibe E2E')", [workId, product, client, qty, ts]);
  // Histórico: entregado de verdad (fecha real ≠ fin de producción).
  const wH = await mk({ client: HIST_CLIENT, product: "E2E HIST SHAMPOO", plannedQuantity: "800" }, "OA-2026-990301");
  await q("update work_items set operational_status = 'entregado', finished_qty = '800', completed_at = $2::timestamptz, delivery_date = null where id = $1", [wH, `${H_PROD}T12:00:00-03:00`]);
  await realDelivery(wH, HIST_CLIENT, "E2E HIST SHAMPOO", "800", `${H_REAL}T22:30:00-03:00`);
  // Marcado entregado pero SIN entrega real registrada: no hay fecha real → no se ubica (no se inventa).
  const wN = await mk({ client: NOREAL_CLIENT, product: "E2E ENTREGADO SIN FECHA", plannedQuantity: "100" }, "OA-2026-990302");
  await q("update work_items set operational_status = 'entregado', completed_at = $2::timestamptz, delivery_date = null where id = $1", [wN, `${H_PROD}T12:00:00-03:00`]);
  // Entrega parcial: se entregaron 400 de 1.000 y queda saldo con fecha de entrega futura.
  const wP = await mk({ client: PART_CLIENT, product: "E2E PARCIAL CREMA", plannedQuantity: "1000", deliveryDate: FUT_PART }, "OA-2026-990303");
  await q("update work_items set operational_status = 'completo', finished_qty = '1000' where id = $1", [wP]);
  await realDelivery(wP, PART_CLIENT, "E2E PARCIAL CREMA", "400", `${PART_REAL}T12:00:00-03:00`);
  // Futuro: 3 productos del mismo cliente el mismo día (nunca cargados en Entregas) + uno cancelado.
  const wF1 = await mk({ client: FUT_CLIENT, product: "E2E FUT CREMA", plannedQuantity: "500", deliveryDate: FUT }, "OA-2026-990304");
  const wF2 = await mk({ client: FUT_CLIENT.toLowerCase(), product: "E2E FUT SERUM", plannedQuantity: "300", deliveryDate: FUT, sector: "ENVASADO_PREMIUM" }, "OA-2026-990305");
  const wF3 = await mk({ client: FUT_CLIENT.replace("FUTURO", "FUTÚRO"), product: "E2E FUT GEL", plannedQuantity: "200", deliveryDate: FUT }, "OA-2026-990306");
  const wF4 = await mk({ client: FUT_CLIENT, product: "E2E FUT CANCELADO", plannedQuantity: "50", deliveryDate: FUT }, "OA-2026-990307");
  await q("update work_items set operational_status = 'en_curso' where id = $1", [wF2]);
  await q("update work_items set operational_status = 'completo', packaging_lote = null, packaging_vto = null, order_number = null where id = $1", [wF3]); // campos faltantes
  await q("update work_items set operational_status = 'cancelado', operational_cancelled_at = now() where id = $1", [wF4]);
  await pp.goto("/mi-trabajo");
  await openEntregas(pp);
  const futChips = await chips(pp, FUT);
  check("Futuro: 3 productos del mismo cliente (distinta tilde/mayúscula) el mismo día → UNA sola aparición en el día", futChips.length === 1 && futChips[0].toLowerCase().replace("ú", "u") === "e2e futuro", futChips.join(" | "));
  check("No se cargó nada a mano: scheduled_deliveries no cambió", (await q("select count(*)::int n from scheduled_deliveries"))[0].n === scheduledBefore);
  await pp.locator(`[data-testid=entregas-day][data-date='${FUT}'] [data-testid=entregas-client]`).first().click();
  const fdlg = pp.locator("[data-testid=entrega-detail]");
  await fdlg.waitFor();
  const fnames = await fdlg.locator("[data-testid=entrega-item-name]").allInnerTexts();
  const ftxt = await fdlg.innerText();
  check("Al tocar el cliente se listan sus 3 productos (el cancelado no)", fnames.length === 3 && ["E2E FUT CREMA", "E2E FUT SERUM", "E2E FUT GEL"].every((n) => fnames.includes(n)) && !ftxt.includes("E2E FUT CANCELADO"), fnames.join(" | "));
  check("Origen «Desde trabajo» y solo lectura (sin Modificar/Reprogramar/Cancelar/Vincular/Historial)", (await fdlg.locator("[data-testid=entrega-origin]").first().innerText()) === "Desde trabajo" && (await fdlg.locator("[data-testid=entrega-edit], [data-testid=entrega-reschedule-open], [data-testid=entrega-cancel-open], [data-testid=entrega-link-open], [data-testid=entrega-history-toggle]").count()) === 0);
  check("Detalle por producto: planificada/pendiente, producción, entrega programada, sector, responsable, orden y enlace al trabajo", /Cantidad planificada/i.test(ftxt) && /Pendiente de entregar/i.test(ftxt) && /Fecha de producción/i.test(ftxt) && /Fecha de entrega programada/i.test(ftxt) && /Envasado Premium/i.test(ftxt) && /Línea 1/i.test(ftxt) && /OA-2026-990304/i.test(ftxt) && (await fdlg.locator("[data-testid=entrega-work-open]").count()) === 3);
  check("Campos faltantes → «No registrado» y el trabajo NO se descarta", (await fdlg.locator("[data-testid=entrega-no-registrado]").count()) > 0);
  check("Estados derivados sin Calidad: pendiente / en proceso / lista para entregar", JSON.stringify((await fdlg.locator("[data-testid=entrega-item] [data-testid=entrega-status]").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))).sort()) === JSON.stringify(["lista_para_entregar", "produccion_en_proceso", "produccion_pendiente"]));
  await pp.screenshot({ path: `${OUT}/10-futuro-desde-trabajo.png` });
  await pp.keyboard.press("Escape");
  // Reprogramar la fecha EN EL TRABAJO (edición por celda canónica): el calendario lo refleja.
  const vF1 = Number((await q("select version from work_items where id = $1", [wF1]))[0].version);
  const mv = await pp.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wF1}`, field: "deliveryDate", value: FUT2, expectedVersion: vF1, reason: "Cliente pidió adelantar la entrega" }] } });
  await pp.goto("/mi-trabajo");
  await openEntregas(pp);
  const chips2 = await chips(pp, FUT2);
  check("Reprogramar la fecha de entrega en el trabajo → el calendario se actualiza (aparece el día nuevo)", mv.ok() && chips2.some((c) => /e2e futuro/i.test(c)), `${mv.status()} ${chips2.join("|")}`);
  await pp.locator(`[data-testid=entregas-day][data-date='${FUT}'] [data-testid=entregas-client]`).first().click();
  const left = await pp.locator("[data-testid=entrega-detail] [data-testid=entrega-item-name]").allInnerTexts();
  check("…y el producto reprogramado sale del día anterior (quedan los otros 2)", left.length === 2 && !left.includes("E2E FUT CREMA"), left.join(" | "));
  await pp.keyboard.press("Escape");
  // Histórico: en la FECHA REAL de entrega (no en la de fin de producción).
  check("Histórico: el trabajo entregado aparece en su FECHA REAL (hora Argentina) y no en la de fin de producción", (await chips(pp, H_REAL)).includes(HIST_CLIENT) && !(await chips(pp, H_PROD)).includes(HIST_CLIENT) && !(await chips(pp, DAY(7))).includes(HIST_CLIENT));
  await pp.locator(`[data-testid=entregas-day][data-date='${H_REAL}'] [data-testid=entregas-client][data-client='${HIST_CLIENT}']`).click();
  const hdlg = await pp.locator("[data-testid=entrega-detail]").innerText();
  check("Detalle histórico: «Entrega registrada», fecha real, fin de producción distinto y estado «Entregada»", /Entrega registrada/.test(hdlg) && new RegExp(`Fecha real de entrega[\\s\\S]*${H_REAL.split("-").reverse().join("/")}`).test(hdlg) && new RegExp(`Producción finalizada: ${H_PROD.split("-").reverse().join("/")}`).test(hdlg) && /Entregada/.test(hdlg));
  await pp.screenshot({ path: `${OUT}/11-historico-entrega-registrada.png` });
  await pp.keyboard.press("Escape");
  check("Entregado SIN fecha real registrada: no se ubica en el calendario (no se inventa fecha)", !(await pp.locator(`[data-testid=entregas-client][data-client='${NOREAL_CLIENT}']`).count()));
  // Entrega parcial: lo entregado en su fecha real + el saldo pendiente en su fecha programada.
  check("Entrega parcial: aparece la entrega real (parcial) y el saldo pendiente en su fecha de entrega", (await chips(pp, PART_REAL)).includes(PART_CLIENT) && (await chips(pp, FUT_PART)).includes(PART_CLIENT));
  await pp.locator(`[data-testid=entregas-day][data-date='${FUT_PART}'] [data-testid=entregas-client][data-client='${PART_CLIENT}']`).click();
  const ptxt = await pp.locator("[data-testid=entrega-detail]").innerText();
  const pst = await pp.locator("[data-testid=entrega-detail] [data-testid=entrega-item] [data-testid=entrega-status]").first().getAttribute("data-status");
  check("Parcial: estado «Entrega parcial», entregada 400 y pendiente 600 (no «Entregada» hasta completar)", pst === "entrega_parcial" && /Entregada\s*\n?\s*400/i.test(ptxt) && /Pendiente de entregar\s*\n?\s*600/i.test(ptxt), `${pst} ${ptxt.replace(/\n/g, " ").slice(0, 200)}`);
  await pp.keyboard.press("Escape");
  // Un trabajo vinculado NO duplica: aparece una sola vez, dentro de su entrega programada.
  await pp.locator(`[data-testid=entregas-day][data-date='${D_DELIVERY}'] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  const ldlg = pp.locator("[data-testid=entrega-detail]");
  const names = await ldlg.locator("[data-testid=entrega-item-name]").allInnerTexts();
  check("Vinculado: el trabajo aparece UNA sola vez (en su entrega programada), no como «Desde trabajo»", (await ldlg.locator(`[data-testid=entrega-work][data-work-id='${w1.id}']`).count()) === 1 && names.filter((n) => n === P1).length === 1);
  const origins = (await ldlg.locator("[data-testid=entrega-origin]").allInnerTexts()).sort().join();
  check("El trabajo sin vincular del mismo cliente y día sí aparece como «Desde trabajo» (producto P3)", names.includes(P3) && origins === "Desde trabajo,Programada manual,Programada manual", origins);
  await pp.keyboard.press("Escape");
  // Diagnóstico (solo lectura): deltas exactos sobre lo sembrado.
  const stats1 = (await (await pp.request.get("/api/v1/entregas/recovery")).json()).stats;
  const futurasEsperadas = [FUT, FUT, FUT2, FUT_PART].filter((d) => d >= TODAY).length; // wF1 (FUT2), wF2, wF3 (FUT) + saldo del parcial
  const vencidasEsperadas = 4 - futurasEsperadas;
  check("Diagnóstico: +2 históricas (entregado y parcial)", stats1.historicas.total - stats0.historicas.total === 2 && stats1.historicas.sueltas - stats0.historicas.sueltas === 2, JSON.stringify(stats1.historicas));
  check("Diagnóstico: futuras incorporadas sin cargar a mano", stats1.futuras.sueltas - stats0.futuras.sueltas === futurasEsperadas && stats1.vencidasSinEntregar - stats0.vencidasSinEntregar === vencidasEsperadas, JSON.stringify(stats1.futuras));
  check("Diagnóstico: quedan fuera 1 entregado sin fecha real y 1 cancelado (con motivo)", stats1.fuera.entregadoSinFechaReal - stats0.fuera.entregadoSinFechaReal === 1 && stats1.fuera.canceladosOEliminados - stats0.fuera.canceladosOEliminados === 1, JSON.stringify(stats1.fuera));
  await pp.goto("/mi-trabajo");
  await openEntregas(pp);
  const foot = await pp.locator("[data-testid=entregas-recovery-summary]").innerText();
  check("Pie discreto «N históricas · M futuras» en el calendario", foot === `${stats1.historicas.total} históricas · ${stats1.futuras.total} futuras`, foot);
  console.log(`RECUPERACION ${JSON.stringify(stats1)}`);
  check("Nada de esto tocó stock", (await stockSnapshot()) === stock0);

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
  check("Recortado por sector: Masivo ve lo histórico de su sector y NO el serum Premium «Desde trabajo»; Premium al revés", JSON.stringify(lm).includes("E2E HIST SHAMPOO") && !JSON.stringify(lm).includes("E2E FUT SERUM") && JSON.stringify(lp).includes("E2E FUT SERUM") && !JSON.stringify(lp).includes("E2E HIST SHAMPOO"));
  const ld = await listAs(deposito);
  check("Depósito consulta todo", JSON.stringify(ld).includes(P1) && JSON.stringify(ld).includes(P2));
  check("Calidad y Elaboración no acceden a Entregas (403)", (await calidad.page.request.get(`/api/v1/entregas?${range}`)).status() === 403 && (await elab.page.request.get(`/api/v1/entregas?${range}`)).status() === 403);
  const newDelivery = { client: "E2E INTRUSO", deliveryDate: D_DELIVERY, items: [{ product: "X" }] };
  const denied = await Promise.all([masivo, premium, deposito].map((u) => u.page.request.post("/api/v1/entregas", { data: newDelivery })));
  check("Envasado y Depósito NO pueden crear entregas (403)", denied.every((r) => r.status() === 403) && (await deliveryRows("E2E INTRUSO")).length === 0);
  const deniedPatch = await masivo.page.request.patch(`/api/v1/entregas/${d1.id}`, { data: { action: "cancel", reason: "Intento no autorizado", expectedVersion: 99 } });
  check("Envasado no puede cancelar ni reprogramar (403)", deniedPatch.status() === 403);
  check("El diagnóstico de recuperación es de solo lectura: Envasado no recibe cifras globales y Calidad no accede", (await (await masivo.page.request.get("/api/v1/entregas/recovery")).json()).stats === null && (await calidad.page.request.get("/api/v1/entregas/recovery")).status() === 403);
  const deniedSug = await masivo.page.request.get(`/api/v1/entregas/suggestions?client=${CLIENT}&product=${P1}`);
  check("Las sugerencias de «Asignar trabajo» son solo de Producción (403)", deniedSug.status() === 403);
  await masivo.page.goto("/mi-trabajo");
  await openEntregas(masivo.page);
  await masivo.page.locator("[data-testid=entregas-client]").first().click();
  const mdlg = await masivo.page.locator("[data-testid=entrega-detail]").innerText();
  check("Envasado ve el detalle de lo suyo en solo lectura (sin Modificar/Reprogramar/Cancelar) y no ve el producto de Premium", !(await masivo.page.locator("[data-testid=entrega-edit]").count()) && !(await masivo.page.locator("[data-testid=entrega-cancel-open]").count()) && !mdlg.includes(P2));
  check("Envasado no ve el historial de la entrega (contiene todos los sectores)", (await masivo.page.locator("[data-testid=entrega-history-toggle]").count()) === 0 && (await (await masivo.page.request.get(`/api/v1/entregas/${d1.id}`)).json()).history.length === 0);
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
    await r.page.locator(`[data-testid=entregas-day][data-date='${FUT}']`).click();
    const futAgenda = await r.page.locator("[data-testid=entregas-agenda] [data-testid=entregas-client]").allInnerTexts();
    await r.page.locator("[data-testid=entregas-agenda] [data-testid=entregas-client]").first().click();
    await r.page.locator("[data-testid=entrega-detail]").waitFor();
    const fbox = await r.page.locator("[data-testid=entrega-detail]").boundingBox();
    const fcount = await r.page.locator("[data-testid=entrega-detail] [data-testid=entrega-item-name]").count();
    check(`${name}: el cliente con varios productos del mismo día aparece una vez y, al tocarlo, lista sus productos sin salirse de pantalla`, futAgenda.length === 1 && fcount === 2 && fbox && fbox.width <= vp.width && !(await r.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${futAgenda.join("|")} ${fcount}`);
    await r.page.screenshot({ path: `${OUT}/8-${name}-futuro.png` });
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
