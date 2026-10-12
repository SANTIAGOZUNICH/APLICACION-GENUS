// E2E (Chromium real, build de producción) de la usabilidad de Elaboración y Materias Primas con los permisos REALES
// de cada sector y datos como los de Production en una base DESCARTABLE: OE de punta a punta (ajuste con coma y
// motivo, entrega segura, sin doble envío), Calidad intacto, Control semanal, búsqueda, anchos, sin conexión,
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
}
async function seedOe(page) {
  const res = await page.request.post("/api/v1/orders", { data: { type: "OE", fromScratch: true, product: "CREMA UX", code: "PT-UX-1", client: "CLIENTE UX", lot: "L-UX-1", assignedSector: "ELABORACION" } });
  const o = (await res.json()).order;
  const fd = o.formData;
  fd.header = { ...fd.header, productName: "CREMA UX", code: "PT-UX-1", date: today, quantityKg: 100, lot: "L-UX-1", client: "CLIENTE UX" };
  fd.materials = [
    { id: "m1", materiaPrima: "Agua purificada", codigo: "UX-MP-AGUA", formulaPct: 80, kgAPesar: 80, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "" },
    { id: "m2", materiaPrima: "Glicerina", codigo: "UX-MP-GLI", formulaPct: 20, kgAPesar: 20, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "" },
  ];
  fd.procedureSteps = [{ id: "p1", text: "Calentar fase acuosa a 70 °C" }, { id: "p2", text: "Incorporar glicerina y agitar 10 min" }];
  const up = await page.request.patch(`/api/v1/orders/${o.id}`, { data: { expectedVersion: o.version, formData: fd } });
  if (!up.ok()) throw new Error(`seed OE ${up.status()} ${await up.text()}`);
  return o.id;
}
const oeRow = async (id) => (await q("select status, form_data from operational_orders where id = $1", [id]))[0];

try {
  await cleanup();
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
  await el.locator("[data-testid=oe-cell-ajuste]").first().waitFor({ timeout: 60_000 });
  const sub = await el.locator("h3 + p").first().innerText();
  check("OE abierta: subtítulo legible (sin «sector ELABORACION»)", !/ELABORACION/.test(sub) && /Elaboración/.test(sub), sub);

  // Ajuste con coma decimal y SIN motivo todavía: no aparece «Error al guardar»; se espera el motivo.
  const ajuste = el.locator("[data-testid=oe-cell-ajuste]").first();
  await ajuste.fill("1,5");
  await el.waitForTimeout(2500);
  const body1 = await el.locator("main").innerText();
  check("Ajuste sin motivo: no muestra «Error al guardar»", !/Error al guardar|No se guardó/.test(body1));
  check("Ajuste sin motivo: indica que falta el motivo para guardar", /Falta el motivo del ajuste de «Agua purificada»/.test(body1));
  await el.screenshot({ path: `${OUT}/despues-el-2-ajuste-espera-motivo.png` });
  const motivo = el.locator("table").filter({ hasText: /Motivo ajuste/ }).locator("tbody tr").first().locator("input").nth(4);
  await motivo.fill("Corrección por humedad");
  check("Al completar el motivo se guarda (ajuste 1,5 → 1.5 y motivo en PostgreSQL)", await waitDb(async () => {
    const m = (await oeRow(oeId))?.form_data?.materials?.[0];
    return m?.ajuste === 1.5 && m?.ajusteMotivo === "Corrección por humedad";
  }), JSON.stringify((await oeRow(oeId))?.form_data?.materials?.[0] ?? {}).slice(0, 160));

  // Entregar incompleta: la acción principal es volver a completar; entregar igual exige confirmación explícita.
  await el.getByRole("button", { name: /^Entregar$/ }).first().click();
  const dlg = el.locator("[role=dialog]");
  await dlg.waitFor();
  const back = dlg.locator("[data-testid=deliver-back]");
  const incomplete = dlg.locator("[data-testid=deliver-incomplete]");
  check("Entregar con faltantes: «Volver a completar» es la acción principal", (await back.innerText()) === "Volver a completar");
  check("Entregar con faltantes: «Entregar igual» deshabilitado hasta confirmar", await incomplete.isDisabled());
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
  await q("update inv_mp_stock set payload = jsonb_set(payload, '{updatedAt}', to_jsonb('2026-10-12T10:00:00.000Z'::text)), updated_at = now() where payload->>'codigo' = 'UX-MP-GLI'");
  const c2 = await cell(mp, "mp-stock-grid", "UX-MP-GLI", "Ubicación");
  await c2.dblclick();
  await mp.keyboard.press("ControlOrMeta+A");
  await mp.keyboard.type("E1-01");
  await mp.keyboard.press("Enter");
  await failed.waitFor({ timeout: 15_000 }).catch(() => {});
  const confText = await failed.innerText().catch(() => "");
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
