// E2E en Chromium real: edición DIRECTA EN LA CELDA (como Excel) en las 7 planillas de Depósito y Materias Primas.
//
// Reproduce la condición del bug de Production: el navegador ya tiene guardada la preferencia global «Ver como lista»
// (genus_os_table_mode = "list"), que antes hacía que TODAS las tablas abrieran como lista (sin edición en la celda).
// Los E2E anteriores usaban un navegador limpio y una pantalla de 2200-2400 px: por eso daban verde.
//
// Por cada tabla: doble clic en una celda existente → escribir → Enter → base de datos → recargar → mismo valor.
// Además: Escape cancela, Tab va a la siguiente celda editable, pegado de un rango desde Excel, columnas calculadas
// protegidas con su motivo, auditoría, conflicto de versión (409) y permisos. Datos de prueba en una base DESCARTABLE,
// sin mover stock (solo campos administrativos y borradores).
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
const OUT = process.env.OUT ?? "/tmp/planillas-edicion-celda";
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
const id = { mat: randomUUID(), ing: randomUUID(), sal: randomUUID() };
const pl = async (table, rid) => (await q(`select payload from ${table} where id = $1`, [rid]))[0]?.payload;
const auditCount = async (entityId) => Number((await q("select count(*)::int n from inv_audit where payload->>'entityId' = $1 and payload->>'action' in ('cell_edit','update')", [entityId]))[0].n);

async function seedMe() {
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'PLAN-ME-%'`);
  const mat = { id: id.mat, codigo: "PLAN-ME-01", descripcion: "Cajas planilla", cliente: "CLIENTE PL", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false };
  const ing = { id: id.ing, fecha: "2026-10-09", ingresoNro: "PL-I-1", proveedor: "PROV PL", cliente: "CLIENTE PL", remitoNro: "PL-R-1", codigo: "PLAN-ME-01", descripcionInsumo: "Cajas planilla", bultos: 1, cantidad: 10, total: 10, ubicacion: "A1", materialId: id.mat, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T };
  const sal = { id: id.sal, fecha: "2026-10-09", egresoNro: "PL-E-1", cliente: "CLIENTE PL", remitoNro: "", descripcion: "Cajas planilla", bultos: null, cantidad: 2, total: 2, control: false, entregado: false, comentarios: "sin comentario", materialId: id.mat, codigo: "PLAN-ME-01", unidad: "u", origen: "MANUAL", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T, motivoSalida: "REGISTRO", descuentaStock: false };
  await q("insert into inv_me_materials (id, payload) values ($1,$2)", [id.mat, mat]);
  await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [id.ing, ing]);
  await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [id.sal, sal]);
}
const prodLike = { lot: randomUUID(), ing: randomUUID(), dots: randomUUID() };
/**
 * Fila con las MISMAS características que las de Production: lote existente creado por un ingreso CONFIRMADO
 * (origen «ingreso»), payload anterior a esta corrección (sin campo «producto»), PRODUCTO que sale del ingreso.
 * Se inserta directo (sin movimientos de libro mayor: no se mueve stock para probar). Más un lote con código «..».
 */
async function seedMpProductionLike() {
  const lot = { id: prodLike.lot, proveedor: "PROV ORIGINAL", cliente: "CLIENTE PL", descripcion: "Mentol planilla", cantidadKg: 25, ubicacion: "B2", lote: "L-PROD-1", vencimiento: "2027-05-31", estadoStock: "Con stock", diasAlVence: null, estadoVencimiento: "", origen: "ingreso", codigo: "PLAN-MP-PROD", codigoPendiente: false, productosAsociados: "", archived: false, createdBy: "mp@laboratoriogenus.com.ar", updatedBy: "mp@laboratoriogenus.com.ar", createdAt: T, updatedAt: T };
  const ing = { id: prodLike.ing, fecha: "2026-09-01", ingresoNro: "MP-I-09001", proveedor: "PROV ORIGINAL", cliente: "CLIENTE PL", remitoNro: "PL-MP-PROD", pccMeNro: "", codigo: "PLAN-MP-PROD", codigoPendiente: false, producto: "CREMA PROD", descripcion: "Mentol planilla", bultos: 1, cantidad: 25, total: 25, ubicacion: "B2", lote: "L-PROD-1", vencimiento: "2027-05-31", stockLotId: prodLike.lot, status: "CONFIRMADO", stockImpacted: true, createdBy: "mp@laboratoriogenus.com.ar", updatedBy: "mp@laboratoriogenus.com.ar", createdAt: T, updatedAt: T };
  const dots = { ...lot, id: prodLike.dots, codigo: "..", proveedor: "", cliente: "", descripcion: "", cantidadKg: 0, ubicacion: "", lote: "", vencimiento: "", origen: "import", estadoStock: "Sin stock" };
  await q("insert into inv_mp_stock (id, payload) values ($1,$2)", [prodLike.lot, lot]);
  await q("insert into inv_mp_ingresos (id, payload) values ($1,$2)", [prodLike.ing, ing]);
  await q("insert into inv_mp_stock (id, payload) values ($1,$2)", [prodLike.dots, dots]);
}
async function cleanupMp() {
  await q("delete from inv_mp_stock where payload->>'codigo' = '..' and payload->>'createdBy' = 'mp@laboratoriogenus.com.ar' and payload->>'descripcion' = ''");
  await q("delete from inv_mp_ingresos where payload->>'remitoNro' like 'PL-MP-%'");
  await q("delete from inv_mp_stock where payload->>'codigo' like 'PLAN-MP-%'");
  await q("delete from inv_mp_compras where payload->>'materiaPrima' like 'PL %'");
  await q("delete from mp_weekly_controls where product like 'PL %'");
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
/** Navegador de un usuario REAL: ya tiene guardada la preferencia global «lista» de antes. */
async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__pl_seeded")) {
        localStorage.setItem("genus_os_table_mode", "list");
        sessionStorage.setItem("__pl_seeded", "1");
      }
    } catch {}
  });
  const page = await ctx.newPage();
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
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
/** Comprobación de una tabla: planilla visible pese a la preferencia vieja, edición en la celda, persistencia al recargar. */
async function inCellRoundTrip(page, { label, navLabel, gridId, rowValue, column, value, read, reload }) {
  const sheet = await page.locator(`[data-testid=${gridId}]`).waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
  check(`${label}: abre como PLANILLA aunque el navegador tenía guardado «Ver como lista»`, sheet);
  const dialog = await editCell(page, gridId, rowValue, column, value);
  check(`${label}: «${column}» se guarda con Enter, sin abrir diálogos ni formularios`, !dialog);
  check(`${label}: doble clic en «${column}» → escribir → Enter guarda en PostgreSQL`, await waitDb(async () => (await read()) === value), String(await read()));
  await page.reload();
  if (reload) await reload();
  else await nav(page, navLabel);
  check(`${label}: tras recargar, la celda muestra «${value}»`, (await cellValue(page, gridId, rowValue, column)) === value);
}

try {
  await seedMe();
  await cleanupMp();
  await seedMpProductionLike();

  // ================= DEPÓSITO =================
  const dep = await openAs(E2E_USERS.deposito);
  const dp = dep.page;
  await dp.goto("/mi-trabajo");

  await nav(dp, "Ingresos ME");
  await inCellRoundTrip(dp, { label: "Ingresos ME", navLabel: "Ingresos ME", gridId: "me-ingresos-grid", rowValue: "PL-R-1", column: "PROVEEDOR", value: "PROV EDITADO", read: async () => (await pl("inv_me_ingresos", id.ing))?.proveedor });
  check("Ingresos ME: TOTAL protegido, con el motivo", /bultos × cantidad/.test(await lockReason(dp, "me-ingresos-grid", "PL-R-1", "TOTAL")));
  check("Ingresos ME: la edición queda auditada", (await auditCount(id.ing)) >= 1);
  await dp.screenshot({ path: `${OUT}/1-ingresos-me.png` });

  await nav(dp, "Salidas ME");
  await inCellRoundTrip(dp, { label: "Salidas ME", navLabel: "Salidas ME", gridId: "me-salidas-grid", rowValue: "PL-E-1", column: "COMENTARIOS", value: "Comentario editado en la celda", read: async () => (await pl("inv_me_salidas", id.sal))?.comentarios });
  await dp.screenshot({ path: `${OUT}/2-salidas-me.png` });

  await nav(dp, "Inventario ME");
  await inCellRoundTrip(dp, { label: "Inventario ME", navLabel: "Inventario ME", gridId: "me-inventario-grid", rowValue: "PLAN-ME-01", column: "UBICACIÓN", value: "RACK-9", read: async () => (await pl("inv_me_materials", id.mat))?.ubicacion });
  check("Inventario ME: CANTIDAD TOTAL protegida (se ajusta con motivo)", /Ajustar stock/.test(await lockReason(dp, "me-inventario-grid", "PLAN-ME-01", "CANTIDAD TOTAL")));
  await dp.screenshot({ path: `${OUT}/3-inventario-me.png` });
  await dep.ctx.close();

  // ================= MATERIAS PRIMAS =================
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const mp = mpu.page;
  const post = (data) => mp.request.post("/api/v1/inventory", { data });
  // Borradores: no mueven stock.
  for (const n of [1, 2]) {
    await post({ action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-09", remitoNro: `PL-MP-R${n}`, codigo: `PLAN-MP-0${n}`, descripcion: `MP planilla ${n}`, proveedor: "PROV MP", cantidad: 5, status: "BORRADOR" } });
  }
  await post({ action: "upsert", resource: "mp_stock", payload: { codigo: "PLAN-MP-LOT", descripcion: "Lote planilla", ubicacion: "E1" } });
  await post({ action: "upsert", resource: "mp_compras", payload: { materiaPrima: "PL Mentol", cantidad: 3, unidad: "kg", proveedor: "PROV MP", estado: "Solicitada", nota: "nota vieja" } });
  const ingreso = async (r) => (await q("select payload from inv_mp_ingresos where payload->>'remitoNro' = $1", [r]))[0]?.payload;

  await mp.goto("/mi-trabajo");
  await nav(mp, "Ingresos MP");
  await inCellRoundTrip(mp, { label: "Ingresos MP", navLabel: "Ingresos MP", gridId: "mp-ingresos-grid", rowValue: "PL-MP-R1", column: "Proveedor", value: "PROV CELDA", read: async () => (await ingreso("PL-MP-R1"))?.proveedor });
  // Ingreso CONFIRMADO existente (como los de Production): un dato administrativo se edita en la celda, sin diálogo
  // y sin mover stock.
  await inCellRoundTrip(mp, { label: "Ingresos MP (confirmado existente)", navLabel: "Ingresos MP", gridId: "mp-ingresos-grid", rowValue: "PL-MP-PROD", column: "Ubicación", value: "B9", read: async () => (await ingreso("PL-MP-PROD"))?.ubicacion });
  check("Ingresos MP (confirmado existente): sigue CONFIRMADO y sin movimientos nuevos", (await ingreso("PL-MP-PROD"))?.status === "CONFIRMADO" && (await q("select 1 from mp_stock_movements where codigo = 'PLAN-MP-PROD'")).length === 0);
  check("Ingresos MP: INGRESO Nº protegido, con el motivo", /asignado por el sistema/.test(await lockReason(mp, "mp-ingresos-grid", "PL-MP-R1", "Ingreso")));

  // Escape cancela
  {
    const c = await cell(mp, "mp-ingresos-grid", "PL-MP-R2", "Cliente");
    await c.dblclick();
    await mp.keyboard.type("NO DEBE QUEDAR");
    await mp.keyboard.press("Escape");
    await mp.waitForTimeout(1200);
    check("teclado: Escape cancela la edición (no se guarda nada)", ((await ingreso("PL-MP-R2"))?.cliente ?? "") === "" && (await cellValue(mp, "mp-ingresos-grid", "PL-MP-R2", "Cliente")) === "");
  }
  // Tab: guarda y pasa a la siguiente celda EDITABLE (saltea INGRESO Nº)
  {
    const c = await cell(mp, "mp-ingresos-grid", "PL-MP-R2", "Fecha");
    await c.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("08/10/2026");
    await mp.keyboard.press("Tab");
    await mp.keyboard.type("PROV TAB");
    await mp.keyboard.press("Enter");
    const ok = await waitDb(async () => (await ingreso("PL-MP-R2"))?.fecha === "2026-10-08" && (await ingreso("PL-MP-R2"))?.proveedor === "PROV TAB");
    check("teclado: Tab guarda la celda y salta la columna protegida (Ingreso Nº) a la siguiente editable (Proveedor)", ok, JSON.stringify({ fecha: (await ingreso("PL-MP-R2"))?.fecha, prov: (await ingreso("PL-MP-R2"))?.proveedor }));
  }
  // Pegado de un rango desde Excel (2 filas × 1 columna) en «Ubicación», empezando en la fila de arriba.
  {
    const grid = mp.locator("[data-testid=mp-ingresos-grid]");
    await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = 0; });
    const order = await grid.evaluate((g) =>
      [...g.querySelectorAll(".dsg-row")].flatMap((r) => [...r.querySelectorAll("input")].map((x) => x.value).filter((v) => /^PL-MP-R\d$/.test(v)))
    );
    const [top, bottom] = order;
    await (await cell(mp, "mp-ingresos-grid", top, "Ubicación")).click();
    await mp.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "ESTANTE A\nESTANTE B");
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    const apply = mp.locator("[data-testid=mp-ingresos-grid-preview-apply]");
    if (await apply.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await apply.click();
    check("pegar desde Excel un rango de 2 celdas (2 filas): ambas guardadas", await waitDb(async () => (await ingreso(top))?.ubicacion === "ESTANTE A" && (await ingreso(bottom))?.ubicacion === "ESTANTE B"), JSON.stringify(order));
  }
  check("Ingresos MP: los borradores siguen en BORRADOR (editar no mueve stock)", (await ingreso("PL-MP-R1"))?.status === "BORRADOR" && (await q("select 1 from mp_stock_balances where codigo like 'PLAN-MP-0%'")).length === 0);
  // Concurrencia
  {
    const r = await ingreso("PL-MP-R1");
    const stale = await mp.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_ingresos", changes: [{ id: r.id, field: "cliente", value: "X", expectedVersion: "2020-01-01T00:00:00.000Z" }] } });
    check("concurrencia: guardar sobre una versión vieja → 409 y no se pisa", stale.status() === 409 && ((await ingreso("PL-MP-R1"))?.cliente ?? "") === "", String(stale.status()));
    check("auditoría: cada edición de celda deja registro (antes/después/usuario)", (await auditCount(r.id)) >= 2);
  }
  await mp.screenshot({ path: `${OUT}/4-ingresos-mp.png` });

  await nav(mp, "Stock");
  await inCellRoundTrip(mp, { label: "Stock MP", navLabel: "Stock", gridId: "mp-stock-grid", rowValue: "PLAN-MP-LOT", column: "Ubicación", value: "E7", read: async () => (await q("select payload from inv_mp_stock where payload->>'codigo' = 'PLAN-MP-LOT'"))[0]?.payload.ubicacion });
  check("Stock MP: «Stock código» protegido, con el motivo", /libro mayor/.test(await lockReason(mp, "mp-stock-grid", "PLAN-MP-LOT", "Stock código")));
  await mp.screenshot({ path: `${OUT}/5-stock-mp.png` });

  // --- Stock MP con una fila igual a las de Production (lote creado por un ingreso confirmado), usuario Materia Prima.
  const lotPayload = async () => (await q("select payload from inv_mp_stock where id = $1", [prodLike.lot]))[0]?.payload;
  check("Stock MP (fila tipo Production): PRODUCTO muestra el producto del ingreso confirmado", (await cellValue(mp, "mp-stock-grid", "PLAN-MP-PROD", "Producto")) === "CREMA PROD");
  for (const [col, field] of [["Producto", "producto"], ["Proveedor", "proveedor"], ["Descripción", "descripcion"], ["Lote", "lote"]]) {
    check(`Stock MP (fila tipo Production): «${col}» sin candado`, (await lockReason(mp, "mp-stock-grid", "PLAN-MP-PROD", col)) === "");
  }
  await inCellRoundTrip(mp, { label: "Stock MP (fila tipo Production)", navLabel: "Stock", gridId: "mp-stock-grid", rowValue: "PLAN-MP-PROD", column: "Producto", value: "CREMA PROD · GEL NUEVO", read: async () => (await lotPayload())?.producto });
  await inCellRoundTrip(mp, { label: "Stock MP (fila tipo Production)", navLabel: "Stock", gridId: "mp-stock-grid", rowValue: "PLAN-MP-PROD", column: "Proveedor", value: "PROV CORREGIDO", read: async () => (await lotPayload())?.proveedor });
  await inCellRoundTrip(mp, { label: "Stock MP (fila tipo Production)", navLabel: "Stock", gridId: "mp-stock-grid", rowValue: "PLAN-MP-PROD", column: "Descripción", value: "Mentol cristal", read: async () => (await lotPayload())?.descripcion });
  check("Stock MP (fila tipo Production): los kg no cambiaron (25) y no hay movimientos del código", (await lotPayload())?.cantidadKg === 25 && (await q("select 1 from mp_stock_movements where codigo = 'PLAN-MP-PROD'")).length === 0);
  check("Stock MP (fila tipo Production): las 3 ediciones quedan auditadas", (await auditCount(prodLike.lot)) >= 3);
  {
    const why = await lockReason(mp, "mp-stock-grid", "PLAN-MP-PROD", "Kg lote");
    check("Stock MP: kg de un lote de ingreso protegidos con motivo específico", /Ajustar stock/.test(why), why);
    const whyCode = await lockReason(mp, "mp-stock-grid", "PLAN-MP-PROD", "Código");
    check("Stock MP: Código protegido con motivo específico (libro mayor)", /libro mayor/.test(whyCode), whyCode);
  }
  {
    const flagged = await mp.locator("[data-testid=mp-stock-grid]").evaluate((g) =>
      [...g.querySelectorAll(".dsg-row")].some((r) => /^\.\.\s*C[óo]digo inv[áa]lido/.test([...r.querySelectorAll("input")].map((x) => x.value).find((v) => v.startsWith("..")) ?? "") || r.querySelector("[data-testid^=mp-stock-codigo-invalido-]"))
    );
    check("Stock MP: la fila «..» se marca «Código inválido» (no se oculta ni se borra)", flagged && (await q("select 1 from inv_mp_stock where id = $1", [prodLike.dots])).length === 1);
  }
  await (await cell(mp, "mp-stock-grid", "PLAN-MP-PROD", "Producto")).click();
  await mp.screenshot({ path: `${OUT}/5b-stock-mp-fila-production-producto.png` });

  await nav(mp, "Compras MP");
  await inCellRoundTrip(mp, { label: "Compras MP", navLabel: "Compras MP", gridId: "mp-compras-grid", rowValue: "PL Mentol", column: "Nota", value: "nota editada en la celda", read: async () => (await q("select payload from inv_mp_compras where payload->>'materiaPrima' = 'PL Mentol'"))[0]?.payload.nota });
  await mp.screenshot({ path: `${OUT}/6-compras-mp.png` });

  // Control semanal (borrador: Lote, Preparado, Observación y Kg editados)
  const ctl = await mp.request.post("/api/v1/mp-control", { data: { client: "CLIENTE PL", product: "PL CREMA", quantityKg: 100, snapshot: { client: "CLIENTE PL", product: "PL CREMA", source: "manual", capturedAt: new Date().toISOString(), materials: [{ codigo: "PLAN-MP-01", materiaPrima: "MP planilla 1", formulaPct: 10 }] } } });
  const ctlId = (await ctl.json()).control?.id;
  const openControl = async () => {
    await nav(mp, "Control semanal");
    await mp.getByText("CLIENTE PL · PL CREMA").first().click({ timeout: 30_000 });
  };
  await openControl();
  await inCellRoundTrip(mp, {
    label: "Control semanal MP",
    gridId: "mp-control-lines-grid",
    rowValue: "PLAN-MP-01",
    column: "Lote",
    value: "LOTE-CELDA",
    read: async () => (await q("select lote from mp_weekly_control_lines where control_id = $1", [ctlId]))[0]?.lote,
    reload: openControl,
  });
  check("Control semanal: «Stock» protegido, con el motivo", /libro mayor/.test(await lockReason(mp, "mp-control-lines-grid", "PLAN-MP-01", "Stock")));
  await mp.screenshot({ path: `${OUT}/7-control-semanal-mp.png` });

  // La preferencia ahora es POR TABLA: elegir «lista» en una tabla no cambia las demás.
  await nav(mp, "Compras MP");
  await mp.locator("[data-testid=mp-compras-excel] [data-testid=os-table-mode-toggle]").click();
  check("modo lista elegido en Compras MP: muestra el aviso «Editar en la planilla»", await mp.locator("[data-testid=os-table-edit-in-sheet-hint]").isVisible());
  await nav(mp, "Ingresos MP");
  check("…y las demás tablas siguen abriendo como planilla", await mp.locator("[data-testid=mp-ingresos-grid]").waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
  await nav(mp, "Compras MP");
  await mp.locator("[data-testid=os-table-edit-in-sheet]").click();
  check("«Editar en la planilla» vuelve a la planilla", await mp.locator("[data-testid=mp-compras-grid]").waitFor({ timeout: 30_000 }).then(() => true).catch(() => false));
  await mpu.ctx.close();

  // ================= PERMISOS =================
  const prod = await openAs(E2E_USERS.produccion);
  const pr = prod.page;
  await pr.goto("/mi-trabajo");
  const deny = await pr.request.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: id.ing, field: "proveedor", value: "X", expectedVersion: (await pl("inv_me_ingresos", id.ing)).updatedAt }] } });
  check("permisos: Producción no edita Ingresos ME (403)", deny.status() === 403, String(deny.status()));
  const denyMp = await pr.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_compras", changes: [{ id: (await q("select id from inv_mp_compras where payload->>'materiaPrima' = 'PL Mentol'"))[0].id, field: "nota", value: "X", expectedVersion: "x" }] } });
  check("permisos: Producción no edita Compras MP (403)", denyMp.status() === 403, String(denyMp.status()));
  await prod.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
