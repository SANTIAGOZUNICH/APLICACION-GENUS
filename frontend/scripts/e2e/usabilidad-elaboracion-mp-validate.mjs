// E2E (Chromium real, build de producción) de la usabilidad de Elaboración y Materias Primas con los permisos REALES
// de cada sector y datos como los de Production en una base DESCARTABLE: OE de punta a punta (KG REAL UTILIZADO con
// coma, lotes de MP, entrega segura que descuenta los kg reales, sin doble envío), Calidad intacto, Control semanal, búsqueda, anchos, sin conexión,
// conflicto y permisos.
import { randomUUID } from "node:crypto";
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
const OUT = process.env.OUT ?? "/tmp/usabilidad-elaboracion-mp";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-09T10:00:00.000Z";
const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
/** Navegador de un usuario REAL: ya tiene guardada la preferencia global «lista» de antes. */
async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__pl_seeded")) {
        sessionStorage.setItem("__pl_seeded", "1");
      }
    } catch {}
  });
  const page = await ctx.newPage();
  // Si un guardado por celda falla, se ve el motivo exacto del servidor.
  page.on("response", async (res) => {
    if (res.url().includes("/api/v1/inventory/cells") && res.status() >= 400) {
      console.log(`  [cells ${res.status()}] ${(await res.text().catch(() => "")).slice(0, 400)}`);
    }
  });
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const norm = (s) => s.trim().toLowerCase();

/**
 * Celda (fila con `rowValue` en alguna columna, columna `title`). La grilla dibuja solo las columnas visibles: primero
 * se ubica la fila con el scroll al inicio y después se desplaza hasta que la columna aparezca.
 */
async function cell(page, gridId, rowValue, title) {
  const grid = page.locator(`[data-testid=${gridId}]`);
  await grid.waitFor({ timeout: 60_000 });
  const setScroll = (x) => grid.evaluate((g, v) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = v; }, x);
  await setScroll(0);
  await page.waitForTimeout(150);
  let ri = -1;
  for (let i = 0; i < 30 && ri < 0; i++) {
    ri = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
    if (ri < 0) {
      await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 250; });
      await page.waitForTimeout(120);
    }
  }
  if (ri < 0) throw new Error(`fila no encontrada: ${gridId} / ${rowValue}`);
  await setScroll(0);
  for (let i = 0; i < 40; i++) {
    const colIdx = (t) => grid.evaluate((g, t) => {
      const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
      return [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim().toLowerCase() === t);
    }, t);
    const col = await colIdx(norm(title));
    if (col >= 0) {
      // Centrar la columna (a partir del encabezado, que siempre está en el DOM) para que no quede debajo de la
      // columna fija de acciones, como haría el usuario al desplazarse. La grilla virtualiza columnas: después de
      // desplazar se vuelven a calcular los índices de columna y fila.
      await grid.evaluate((g, c0) => {
        const c = g.querySelector(".dsg-container");
        const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
        const el = header?.querySelectorAll(".dsg-cell")[c0];
        if (!c || !el) return;
        const cr = c.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        c.scrollLeft += er.left - cr.left - cr.width / 3;
      }, col);
      await page.waitForTimeout(200);
      const col2 = await colIdx(norm(title));
      const ri2 = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
      const target = grid.locator(".dsg-row").nth(ri2 >= 0 ? ri2 : ri).locator(".dsg-cell").nth(col2 >= 0 ? col2 : col);
      await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
      return target;
    }
    await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 200; });
    await page.waitForTimeout(120);
  }
  throw new Error(`columna no encontrada: ${gridId} / ${title}`);
}
async function editCell(page, gridId, rowValue, title, value, reason) {
  const c = await cell(page, gridId, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    if (reason) await page.locator(`[data-testid=${gridId}-reason]`).fill(reason);
    await apply.click();
    return true; // apareció un diálogo de confirmación
  }
  return false;
}
const cellValue = async (page, gridId, rowValue, title) => (await cell(page, gridId, rowValue, title)).locator("input").inputValue();
const lockReason = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-lock") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin motivo)" : ""));
/** Nota de trazabilidad de la celda (marca en la esquina + texto al pasar el mouse), o "" si no tiene. */
const noteOf = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-note") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin texto)" : ""));
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// ---------- Datos como los de Production en la base DESCARTABLE: una OE de Elaboración armada por Producción con su
// fórmula y procedimiento, lotes/ingresos/compras de MP existentes. Sin movimientos de stock de prueba.
const today = new Date().toISOString().slice(0, 10);
async function cleanup() {
  await q("delete from operational_orders where product like 'CREMA UX%'").catch(() => {});
  await q("delete from inv_mp_compras where payload->>'materiaPrima' like 'UX %'");
  await q("delete from inv_mp_stock where payload->>'codigo' like 'UX-MP-%'");
  await q("delete from inv_mp_stock where payload->>'codigo' like 'UX-OE-%'");
  await q("delete from inv_mp_ingresos where payload->>'codigo' like 'UX-OE-%'");
  await q("delete from mp_stock_movements where codigo like 'UX-OE-%'");
  await q("delete from mp_stock_balances where codigo like 'UX-OE-%'");
}
/** Stock MP real (ingresos confirmados de MP): lotes + libro mayor, como en Production. */
async function seedMpLots(page) {
  for (const [codigo, descripcion, lote, kg] of [["UX-OE-AGUA", "Agua purificada", "AG-UX-1", 500], ["UX-OE-GLI", "Glicerina", "GL-UX-1", 100]]) {
    const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `UX-R-${lote}`, codigo, descripcion, lote, proveedor: "PROV UX", bultos: 1, cantidad: kg } } });
    if (!r.ok()) throw new Error(`seed MP ${codigo}: ${r.status()} ${await r.text()}`);
  }
}
const ledgerKg = async (codigo) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [codigo]))[0]?.stock_actual ?? NaN);
const lotKg = async (codigo, lote) => (await q("select payload from inv_mp_stock where payload->>'codigo' = $1 and payload->>'lote' = $2", [codigo, lote]))[0]?.payload?.cantidadKg;
async function seedOe(page) {
  const res = await page.request.post("/api/v1/orders", { data: { type: "OE", fromScratch: true, product: "CREMA UX", code: "PT-UX-1", client: "CLIENTE UX", lot: "L-UX-1", assignedSector: "ELABORACION" } });
  const o = (await res.json()).order;
  const fd = o.formData;
  fd.header = { ...fd.header, productName: "CREMA UX", code: "PT-UX-1", date: today, quantityKg: 100, lot: "L-UX-1", client: "CLIENTE UX" };
  fd.materials = [
    { id: "m1", materiaPrima: "Agua purificada", codigo: "UX-MP-AGUA", codigoMp: "UX-OE-AGUA", formulaPct: 80, kgAPesar: 80, kgReal: null, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "" },
    { id: "m2", materiaPrima: "Glicerina", codigo: "UX-MP-GLI", codigoMp: "UX-OE-GLI", formulaPct: 20, kgAPesar: 20, kgReal: null, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "" },
  ];
  fd.procedureSteps = [{ id: "p1", text: "Calentar fase acuosa a 70 °C" }, { id: "p2", text: "Incorporar glicerina y agitar 10 min" }];
  const up = await page.request.patch(`/api/v1/orders/${o.id}`, { data: { expectedVersion: o.version, formData: fd } });
  if (!up.ok()) throw new Error(`seed OE ${up.status()} ${await up.text()}`);
  return o.id;
}
const oeRow = async (id) => (await q("select status, form_data from operational_orders where id = $1", [id]))[0];

try {
  await cleanup();
  const mpSeed = await openAs(E2E_USERS.materiaPrima);
  await seedMpLots(mpSeed.page);
  await mpSeed.ctx.close();
  // ===== Producción arma la OE (como en Production) =====
  const pr = await openAs(E2E_USERS.produccion);
  const oeId = await seedOe(pr.page);
  await pr.ctx.close();

  // ===== ELABORACIÓN =====
  const { ctx: elc, page: el } = await openAs(E2E_USERS.elaboracion);
  await el.waitForTimeout(2500);
  const homeText = await el.locator("main").innerText().catch(() => "");
  check("Mi trabajo: sin textos técnicos (GENUS_DATA_MODE, WorkItems, Drive)", !/GENUS_DATA_MODE|WorkItems|DATABASE_URL/.test(homeText), homeText.slice(0, 120));
  await el.screenshot({ path: `${OUT}/despues-el-1-mi-trabajo.png` });
  await nav(el, "Órdenes de Elaboración");
  await el.getByRole("button", { name: /^Abrir$/ }).first().waitFor({ timeout: 60_000 });
  const listText = await el.locator("main").innerText();
  check("Listado de OE: sector con nombre legible (no «ELABORACION»)", !/\bELABORACION\b/.test(listText) && /Elaboración/.test(listText));
  const estados = await el.locator("select").first().locator("option").allInnerTexts();
  check("Filtro de estado con nombres legibles", !estados.some((t) => /_/.test(t)) && estados.some((t) => /Completa con pendientes/.test(t)), estados.join(" | "));
  await el.getByRole("button", { name: /^Abrir$/ }).first().click();
  await el.locator("[data-testid=oe-cell-kg-real]").first().waitFor({ timeout: 60_000 });
  const sub = await el.locator("h3 + p").first().innerText();
  check("OE abierta: subtítulo legible (sin «sector ELABORACION»)", !/ELABORACION/.test(sub) && /Elaboración/.test(sub), sub);

  // KG REAL UTILIZADO con coma decimal, sin motivo obligatorio: se guarda solo (autoguardado), sin «Error al guardar».
  const kgReal = el.locator("[data-testid=oe-cell-kg-real]");
  check("KG REAL vacío al abrir (no se copia el teórico)", (await kgReal.first().inputValue()) === "" && (await kgReal.nth(1).inputValue()) === "");
  await kgReal.first().fill("80,5");
  await el.waitForTimeout(2500);
  const body1 = await el.locator("main").innerText();
  check("KG REAL distinto del teórico: no muestra «Error al guardar» ni pide motivo", !/Error al guardar|No se guardó|Falta el motivo/.test(body1));
  check("Se guarda 80,5 → 80.5 en PostgreSQL", await waitDb(async () => (await oeRow(oeId))?.form_data?.materials?.[0]?.kgReal === 80.5), JSON.stringify((await oeRow(oeId))?.form_data?.materials?.[0] ?? {}).slice(0, 160));
  check("Dif. visible (+0,5) y KG A PESAR intacto (80)", (await el.locator("[data-testid=oe-cell-dif]").first().innerText()) === "+0,5" && (await el.locator("[data-testid=oe-cell-kg]").first().innerText()) === "80");
  check("Antes de entregar: indica qué falta (kg real y lote por fila)", /Fila 1 — Agua purificada: falta LOTE MP/.test(await el.locator("[data-testid=oe-consumo-pendientes]").innerText()));
  await el.screenshot({ path: `${OUT}/despues-el-2-kg-real.png` });
  await kgReal.nth(1).fill("19,8");
  await el.locator("[data-testid=oe-cell-lote]").first().fill("AG-UX-1");
  await el.locator("[data-testid=oe-cell-lote]").nth(1).fill("GL-UX-1");
  check("Lotes y kg reales guardados", await waitDb(async () => JSON.stringify((await oeRow(oeId))?.form_data?.materials?.map((m) => [m.kgReal, m.lote])) === JSON.stringify([[80.5, "AG-UX-1"], [19.8, "GL-UX-1"]])));

  // Entregar incompleta: la acción principal es volver a completar; entregar igual exige confirmación explícita.
  await el.getByRole("button", { name: /^Entregar$/ }).first().click();
  const dlg = el.locator("[role=dialog]");
  await dlg.waitFor();
  const back = dlg.locator("[data-testid=deliver-back]");
  const incomplete = dlg.locator("[data-testid=deliver-incomplete]");
  check("Entregar con faltantes: «Volver a completar» es la acción principal", (await back.innerText()) === "Volver a completar");
  check("Entregar con faltantes: «Entregar igual» deshabilitado hasta confirmar", await incomplete.isDisabled());
  await el.waitForTimeout(800); // que termine la animación antes de la captura
  await el.screenshot({ path: `${OUT}/despues-el-3-entregar-incompleta.png` });
  await back.click();
  const controlOpen = await el.locator("#oe-sec-control").evaluate((d) => d.open);
  check("«Volver a completar» abre «Control de proceso» (donde están los datos que faltan)", controlOpen);
  const sec = el.locator("#oe-sec-control");
  await sec.getByLabel("Cantidad obtenida").fill("98,5");
  await sec.getByLabel("Fecha finalización").fill(today);
  check("Cantidad obtenida con coma decimal se guarda (98.5)", await waitDb(async () => (await oeRow(oeId))?.form_data?.processControl?.cantidadObtenida === 98.5 && (await oeRow(oeId))?.form_data?.processControl?.fechaFin === today));
  await el.waitForTimeout(1200);

  // Entregar completa: un clic en «Entregar» del diálogo; doble clic no entrega dos veces.
  await el.getByRole("button", { name: /^Entregar$/ }).first().click();
  await dlg.waitFor();
  const confirm = dlg.locator("[data-testid=deliver-confirm]");
  check("OE completa: el diálogo ofrece «Entregar» directamente", await confirm.isVisible());
  let delivers = 0;
  el.on("request", (r) => { if (r.url().includes(`/orders/${oeId}/deliver`)) delivers += 1; });
  await confirm.dblclick();
  check("OE entregada: estado COMPLETA en PostgreSQL", await waitDb(async () => (await oeRow(oeId))?.status === "COMPLETA"), (await oeRow(oeId))?.status);
  check(
    "Al entregar se descontaron los kg REALES (80,5 y 19,8) del lote y del código",
    (await lotKg("UX-OE-AGUA", "AG-UX-1")) === 419.5 && (await lotKg("UX-OE-GLI", "GL-UX-1")) === 80.2 && (await ledgerKg("UX-OE-AGUA")) === 419.5 && (await ledgerKg("UX-OE-GLI")) === 80.2,
    JSON.stringify([await lotKg("UX-OE-AGUA", "AG-UX-1"), await lotKg("UX-OE-GLI", "GL-UX-1"), await ledgerKg("UX-OE-AGUA"), await ledgerKg("UX-OE-GLI")])
  );
  await el.waitForTimeout(1000);
  check("Doble clic en «Entregar»: un solo envío", delivers === 1, String(delivers));
  const after = await el.locator("main").innerText();
  check("Tras entregar: sin errores técnicos en pantalla", !/HTTP \d{3}|Error \d{3}|Cannot read|undefined/.test(after));
  await el.screenshot({ path: `${OUT}/despues-el-4-entregada.png` });
  // Permisos: Elaboración no edita Stock MP.
  const denyStock = await el.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: "00000000-0000-0000-0000-000000000000", field: "ubicacion", value: "X", expectedVersion: "x" }] } });
  check("permisos: Elaboración no edita Stock MP (403)", denyStock.status() === 403, String(denyStock.status()));
  await elc.close();

  // ===== CALIDAD: el flujo de aprobación no cambió =====
  const ca = await openAs(E2E_USERS.calidad);
  const appr = await ca.page.request.get(`/api/v1/orders/${oeId}`);
  check("Calidad ve la OE entregada (COMPLETA) para revisar", appr.ok() && (await appr.json()).order?.status === "COMPLETA");
  await ca.ctx.close();

  // ===== MATERIAS PRIMAS =====
  const { ctx: mpc, page: mp } = await openAs(E2E_USERS.materiaPrima);
  const post = (data) => mp.request.post("/api/v1/inventory", { data });
  await post({ action: "upsert", resource: "mp_compras", payload: { fecha: "2026-10-05", materiaPrima: "UX Mentol cristal", cantidad: 10, unidad: "kg", proveedor: "AROMAS SA", fechaEntrega: "2026-10-20", produccionesAfecta: "CREMA UX lote L-UX-1 y GEL UX lote L-UX-2", estado: "Solicitada", nota: "" } });
  await post({ action: "upsert", resource: "mp_stock", payload: { codigo: "UX-MP-GLI", descripcion: "Glicerina USP 99,5%", proveedor: "QUIMICA SUR", cliente: "CLIENTE UX", ubicacion: "E1-02", lote: "GL-2026-0912", vencimiento: "2027-09-30", cantidadKg: 25 } });
  await mp.reload();

  await nav(mp, "Control semanal");
  check("Control semanal: se puede crear un control sin tener uno en borrador", await mp.locator("[data-testid=mp-control-create]").waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
  await mp.waitForTimeout(800); // que termine la animación antes de la captura
  await mp.screenshot({ path: `${OUT}/despues-mp-1-control-semanal.png` });

  await nav(mp, "Compras MP");
  await mp.locator("[data-testid=mp-compras-grid]").waitFor({ timeout: 60_000 });
  const afecta = await (await cell(mp, "mp-compras-grid", "UX Mentol cristal", "Afecta a")).evaluate((c) => { const i = c.querySelector("input"); return i ? i.scrollWidth <= i.clientWidth + 2 : false; });
  check("Compras: «Afecta a» se lee completo (ancho según contenido)", afecta);
  await mp.screenshot({ path: `${OUT}/despues-mp-2-compras.png` });

  await nav(mp, "Stock");
  await mp.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  await mp.locator("[data-testid=mp-search]").fill("GL-2026");
  await mp.waitForTimeout(500);
  check("Búsqueda por lote encuentra el lote", (await mp.locator("[data-testid=mp-stock-grid] input").evaluateAll((xs) => xs.some((x) => x.value === "UX-MP-GLI"))));
  await mp.locator("[data-testid=mp-search-clear]").click();
  check("«×» quita la búsqueda", (await mp.locator("[data-testid=mp-search]").inputValue()) === "");

  // Sin conexión: mensaje simple y el valor escrito queda para reintentar.
  await mpc.setOffline(true);
  const c1 = await cell(mp, "mp-stock-grid", "UX-MP-GLI", "Ubicación");
  await c1.dblclick();
  await mp.keyboard.press("ControlOrMeta+A");
  await mp.keyboard.type("E9-99");
  await mp.keyboard.press("Enter");
  const failed = mp.locator("[data-testid=mp-stock-grid-failed]");
  await failed.waitFor({ timeout: 15_000 }).catch(() => {});
  const failText = await failed.innerText().catch(() => "");
  check("Sin conexión: mensaje simple, sin «Failed to fetch»", /Sin conexión/.test(failText) && !/Failed to fetch|TypeError/.test(failText), failText.slice(0, 160));
  check("Sin conexión: lo escrito queda visible para reintentar", /E9-99/.test(failText));
  await mp.screenshot({ path: `${OUT}/despues-mp-3-sin-conexion.png` });
  await mpc.setOffline(false);
  await failed.getByRole("button", { name: "Reintentar" }).click();
  check("Al volver la conexión, «Reintentar» guarda el valor", await waitDb(async () => (await q("select payload->>'ubicacion' u from inv_mp_stock where payload->>'codigo' = 'UX-MP-GLI'"))[0]?.u === "E9-99"));

  // Edición simultánea: mensaje claro, sin «409».
  // Otra persona guardó antes: se simula enviando la versión que este usuario tenía ANTES (determinístico; la grilla se
  // refresca sola y si no, la carrera dependería del momento).
  await mp.route("**/api/v1/inventory/cells", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    for (const c of body.changes ?? []) c.expectedVersion = "2020-01-01T00:00:00.000Z";
    await route.continue({ postData: JSON.stringify(body) });
  });
  const c2 = await cell(mp, "mp-stock-grid", "UX-MP-GLI", "Ubicación");
  await c2.dblclick();
  await mp.keyboard.press("ControlOrMeta+A");
  await mp.keyboard.type("E1-01");
  await mp.keyboard.press("Enter");
  await failed.waitFor({ timeout: 15_000 }).catch(() => {});
  const confText = await failed.innerText().catch(() => "");
  await mp.unroute("**/api/v1/inventory/cells");
  check("Edición simultánea: explica que otro usuario lo modificó y ofrece recargar, sin «409»", /modific/i.test(confText) && !/409/.test(confText), confText.slice(0, 160));
  await mp.screenshot({ path: `${OUT}/despues-mp-4-conflicto.png` });
  const denyOe = await mp.request.post(`/api/v1/orders/${oeId}/deliver`, { data: { confirm: true } });
  check("permisos: Materias Primas no entrega OE (403)", denyOe.status() === 403, String(denyOe.status()));
  await mpc.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failedR = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedR.length}/${results.length} OK`);
process.exit(failedR.length ? 1 : 0);
