// E2E en Chromium real: Depósito → Entregas Producción como réplica de la hoja «SALIDAS PROD. T 2026» (11 columnas). Base DESCARTABLE.
// Escribir/pegar directo en filas en blanco, pegado de varias filas y de una columna de fechas, pegado masivo (300), celdas vacías,
// remitos con ceros, edición y vaciado de celdas, eliminación de varias filas, recarga, permisos y registros previos conservados.
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
const OUT = process.env.OUT ?? "/tmp/entregas-produccion";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const GID = "entregas-produccion-grid";
const TAG = "E2E-EP";
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const active = (where = "true", params = []) => q(`select * from deposito_despachos where deleted_at is null and cliente like '${TAG}%' and ${where}`, params);
const cleanup = async () => {
  await q("delete from deposito_despachos_audit where despacho_id in (select id::text from deposito_despachos where cliente like $1)", [`${TAG}%`]);
  await q("delete from deposito_despachos where cliente like $1", [`${TAG}%`]);
  await q("delete from deposito_despachos_audit where despacho_id in (select id::text from deposito_despachos where created_by like 'E2E %' and cliente = '' and remito = '' and fecha between '2026-12-01' and '2026-12-04')");
  await q("delete from deposito_despachos where created_by like 'E2E %' and cliente = '' and remito = '' and fecha between '2026-12-01' and '2026-12-04'");
};
const setFilter = async (page, testid, value) => { await page.locator(`[data-testid=${testid}]`).fill(value); await page.waitForTimeout(500); };

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("genus_os_table_mode", "grid"); } catch {} });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
async function openTab(page) {
  await page.goto("/mi-trabajo");
  await nav(page, "Entregas Producción");
  await page.locator(`[data-testid=${GID}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
}
async function colMap(page) {
  return page.evaluate((gid) => {
    const out = {};
    for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) {
      const m = /genus-col-(\d+)/.exec(h.className);
      if (m) out[h.textContent.trim().toLowerCase()] = Number(m[1]);
    }
    return out;
  }, GID);
}
async function draftCell(page, k, title) {
  const c = (await colMap(page))[title.toLowerCase()];
  if (c === undefined) throw new Error(`columna no encontrada: ${title} (${Object.keys(await colMap(page))})`);
  await page.evaluate(([gid, k]) => {
    const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`);
    sc.scrollLeft = 0;
    sc.scrollTop = sc.scrollHeight;
    // La primera fila en blanco queda arriba de todo, debajo del encabezado fijo (si no, el clic cae en el encabezado y selecciona la columna).
    const row = document.querySelectorAll(`[data-testid=${gid}] .genus-draft-row`)[k];
    const head = sc.querySelector(".dsg-row-header");
    if (row && head) sc.scrollTop += row.getBoundingClientRect().top - head.getBoundingClientRect().bottom - 2;
  }, [GID, k]);
  await page.waitForTimeout(250);
  return page.locator(`[data-testid=${GID}] .genus-draft-row`).nth(k).locator(`.genus-col-${c}`).first();
}
async function clickBox(page, loc) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("celda sin caja");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const pasteDoc = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
async function dataCell(page, rowValue, title) {
  const pos = await page.evaluate(([gid, v, title]) => {
    const rows = [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)];
    const header = rows.find((r) => r.classList.contains("dsg-row-header"));
    const col = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim().toLowerCase() === title.toLowerCase());
    const ri = rows.findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v));
    return { col, ri };
  }, [GID, rowValue, title]);
  if (pos.col < 0 || pos.ri < 0) throw new Error(`celda no encontrada: ${rowValue}/${title} ${JSON.stringify(pos)}`);
  return page.locator(`[data-testid=${GID}] .dsg-row`).nth(pos.ri).locator(".dsg-cell").nth(pos.col);
}
const waitRow = (page, value) => page.waitForFunction(([gid, v]) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row input`)].some((i) => i.value === v), [GID, value], { timeout: 90_000 });
const waitGone = (page, value) => page.waitForFunction(([gid, v]) => ![...document.querySelectorAll(`[data-testid=${gid}] .dsg-row input`)].some((i) => i.value === v), [GID, value], { timeout: 60_000 });

try {
  await cleanup();
  // Registros PREVIOS (formato viejo: cantidad_total sin cantidad por caja): deben conservarse sin inventar datos.
  const oldIds = [randomUUID(), randomUUID()];
  await q(`insert into deposito_despachos (id, fecha, remito, cliente, producto, bultos, cantidad_total, created_by, created_by_sector) values
    ($1,'2026-10-20','0001-00000045','${TAG} PREVIO A','Crema previa',3,250,'prev','DEPOSITO'), ($2,'2026-10-21','000777','${TAG} PREVIO B','Gel previo',1,10,'prev','DEPOSITO')`, oldIds);
  const stockBefore = (await q("select (select count(*)::int from mp_stock_movements) mov, (select count(*)::int from remitos) rem"))[0];

  const { ctx, page } = await openAs(E2E_USERS.deposito);
  await openTab(page);
  const TITLES = ["fecha", "egreso n°", "cliente", "remito n°", "descripción", "bultos", "cantidad", "total", "control", "entregado", "comentarios"];
  const cm = await colMap(page);
  const order = Object.entries(cm).sort((x, y) => x[1] - y[1]).map(([k]) => k).filter((k) => TITLES.includes(k));
  check("abre como planilla con EXACTAMENTE las 11 columnas del Sheet y en ese orden", JSON.stringify(order) === JSON.stringify(TITLES), JSON.stringify(Object.keys(cm)));
  check("sin formularios ni botón «Agregar entrega»", (await page.locator("[data-testid=despachos-create]").count()) === 0 && (await page.getByRole("dialog").count()) === 0);
  check("los registros previos siguen visibles", await page.locator(`[data-testid=${GID}] input`).evaluateAll((els) => els.some((i) => i.value === "0001-00000045")));
  await page.screenshot({ path: `${OUT}/1-planilla.png` });

  // ---- Egreso B001 pegado desde Google Sheets (11 columnas, incluye TOTAL y casillas) ----
  await clickBox(page, await draftCell(page, 0, "Fecha"));
  const sheet = [
    ["10/11/2026", "B001", `${TAG} LIETA`, "2938", "CREMA EXFOLIANTE PARA MANOS", "17", "56", "952", "FALSE", "FALSE", ""],
    ["10/11/2026", "B001", `${TAG} LIETA`, "2938", "ACEITE PARA MANOS", "18", "56", "1.008", "TRUE", "FALSE", "revisado"],
    ["10/11/2026", "B001", `${TAG} LIETA`, "2938", "CREMA EXFOLIANTE PARA MANOS", "1", "28", "28", "FALSE", "FALSE", "caja incompleta"],
  ];
  await pasteDoc(page, sheet.map((r) => r.join("\t")).join("\n"));
  check("pegar el egreso B001 (3 filas): se crean las 3 una sola vez", await waitDb(async () => (await active("egreso = 'B001'")).length === 3, 40_000));
  const rowsB = (await active("egreso = 'B001'")).sort((x, y) => Number(y.bultos) - Number(x.bultos));
  check("un egreso con varias filas: mismo egreso, cliente y remito", rowsB.every((r) => r.cliente === `${TAG} LIETA` && r.remito === "2938"));
  check("TOTAL = BULTOS × CANTIDAD: 17×56=952, 18×56=1008, 1×28=28 (TOTAL pegado no se toma como dato)", JSON.stringify(rowsB.map((r) => Number(r.cantidad_total)).sort((x, y) => x - y)) === "[28,952,1008]");
  check("cada columna cae en su lugar (descripción, bultos, cantidad)", rowsB.some((r) => r.producto === "ACEITE PARA MANOS" && Number(r.bultos) === 18 && Number(r.cantidad) === 56) && rowsB.some((r) => Number(r.bultos) === 1 && Number(r.cantidad) === 28));
  check("CONTROL pegado como TRUE queda marcado y ENTREGADO sin marcar; comentario guardado", rowsB.some((r) => r.control === true && r.comentarios === "revisado" && r.entregado === false) && rowsB.filter((r) => r.control).length === 1);
  await page.waitForTimeout(2500);
  check("sin duplicados tras esperar", (await active("egreso = 'B001'")).length === 3);

  // ---- Casillas CONTROL / ENTREGADO independientes con quién y cuándo ----
  await setFilter(page, "despachos-f-cliente", `${TAG} LIETA`);
  await waitRow(page, "ACEITE PARA MANOS");
  const box = async (col) => (await dataCell(page, "ACEITE PARA MANOS", col)).locator("input[type=checkbox]"); // se resuelve justo antes de cada clic (el orden puede cambiar al refrescar)
  await (await box("Entregado")).click();
  check("marcar ENTREGADO no toca CONTROL y registra quién/cuándo", await waitDb(async () => {
    const r = (await active("producto = 'ACEITE PARA MANOS'"))[0];
    return r?.entregado === true && r.entregado_by && r.entregado_at && r.control === true;
  }));
  await (await box("Control")).click();
  check("desmarcar CONTROL no toca ENTREGADO y queda registrado", await waitDb(async () => {
    const r = (await active("producto = 'ACEITE PARA MANOS'"))[0];
    return r?.control === false && r.control_by && r.entregado === true;
  }));
  check("las marcas dejan auditoría", (await q("select count(*)::int n from deposito_despachos_audit a join deposito_despachos d on d.id::text = a.despacho_id where d.producto = 'ACEITE PARA MANOS' and d.cliente like $1 and a.field in ('control','entregado')", [`${TAG}%`]))[0].n >= 2);

  // ---- Editar BULTOS actualiza TOTAL de inmediato ----
  await setFilter(page, "despachos-f-cliente", "");
  await clickBox(page, await draftCell(page, 0, "Fecha"));
  await pasteDoc(page, ["11/11/2026", "B002", `${TAG} LIETA`, "9001", "GEL", "2", "10", "20", "FALSE", "FALSE", ""].join("\t"));
  check("fila nueva (B002) creada", await waitDb(async () => (await active("remito = '9001'")).length === 1, 30_000));
  await setFilter(page, "despachos-f-cliente", `${TAG} LIETA`);
  await waitRow(page, "9001");
  const bu = await dataCell(page, "9001", "Bultos");
  await bu.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  check("editar BULTOS guarda y recalcula TOTAL (5×10=50)", await waitDb(async () => Number((await active("remito = '9001'"))[0]?.cantidad_total) === 50));
  let uiTotal = "";
  await waitDb(async () => { uiTotal = await (await dataCell(page, "9001", "Total")).evaluate((el) => `${el.textContent} ${[...el.querySelectorAll("input")].map((i) => i.value).join(" ")}`); return /\b50\b/.test(uiTotal); }, 10_000);
  check("la columna TOTAL muestra el nuevo valor sin recargar", /\b50\b/.test(uiTotal), JSON.stringify(uiTotal));
  await bu.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("-3");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  check("no acepta negativos (queda 5)", Number((await active("remito = '9001'"))[0].bultos) === 5);

  // ---- Botones de egreso / duplicar ----
  check("botones «+ Nuevo egreso», «+ Fila al mismo egreso» y «Duplicar fila» presentes",
    (await page.locator("[data-testid=despachos-nuevo-egreso]").count()) === 1 && (await page.locator("[data-testid=despachos-fila-egreso]").count()) === 1 && (await page.locator("[data-testid=despachos-duplicar]").count()) === 1);
  const rowRi = await page.evaluate(([gid]) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)].findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === "9001")), [GID]);
  await page.locator(`[data-testid=${GID}] .dsg-row`).nth(rowRi).locator("[data-testid=row-check]").click();
  await page.locator("[data-testid=despachos-fila-egreso]").click();
  check("«Fila al mismo egreso» crea una fila que hereda egreso, cliente y remito", await waitDb(async () => (await active("egreso = 'B002' and remito = '9001'")).length === 2, 30_000));
  await page.locator("[data-testid=despachos-duplicar]").click();
  check("«Duplicar fila» agrega otra fila (sin pisar la original)", await waitDb(async () => (await active("egreso = 'B002' and remito = '9001'")).length === 3, 30_000));

  // ---- Filtros, búsqueda y orden ----
  await setFilter(page, "despachos-f-cliente", "");
  await setFilter(page, "despachos-f-egreso", "B001");
  const visibleB001 = await page.locator(`[data-testid=${GID}] .dsg-row input`).evaluateAll((els) => els.filter((i) => i.value === "2938").length);
  check("filtro por EGRESO N° muestra solo B001 (3 filas)", visibleB001 === 3, String(visibleB001));
  await setFilter(page, "despachos-f-egreso", "");

  // ---- Recarga: persiste ----
  await page.reload();
  await openTab(page);
  await setFilter(page, "despachos-f-cliente", `${TAG} LIETA`);
  await waitRow(page, "ACEITE PARA MANOS");
  const chk = await dataCell(page, "ACEITE PARA MANOS", "Entregado");
  check("tras recargar persisten las filas y las casillas", await chk.locator("input[type=checkbox]").isChecked());
  await page.screenshot({ path: `${OUT}/2-egreso.png` });

  // ---- Fila previa: se conserva y no se inventa cantidad ----
  const prev = (await q("select cantidad, cantidad_total, bultos from deposito_despachos where id = $1", [oldIds[0]]))[0];
  check("registro previo conservado: total 250 intacto y CANTIDAD pendiente (no se inventa)", prev.cantidad === null && Number(prev.cantidad_total) === 250);

  // ---- Eliminar con confirmación ----
  await setFilter(page, "despachos-f-cliente", `${TAG} LIETA`);
  const ri = await page.evaluate(([gid]) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)].findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === "9001")), [GID]);
  await page.locator(`[data-testid=${GID}] .dsg-row`).nth(ri).locator("[data-testid=row-check]").click();
  await page.locator("[data-testid=deposito-delete-selected]").click();
  await page.getByRole("dialog").waitFor({ timeout: 15_000 });
  await page.locator("[data-testid=deposito-delete-confirm]").click();
  check("eliminar pide confirmación y hace baja lógica con auditoría", await waitDb(async () => (await active("remito = '9001'")).length === 2)
    && (await q("select count(*)::int n from deposito_despachos_audit a join deposito_despachos d on d.id::text = a.despacho_id where a.action = 'delete' and d.remito = '9001' and d.cliente like $1", [`${TAG}%`]))[0].n === 1);

  // ---- Sin efectos sobre stock ni remitos ----
  const stockAfter = (await q("select (select count(*)::int from mp_stock_movements) mov, (select count(*)::int from remitos) rem"))[0];
  check("no se crearon movimientos de stock ni remitos", JSON.stringify(stockAfter) === JSON.stringify(stockBefore));

  // ---- Tablet: scroll horizontal, sin columnas cortadas ----
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.waitForTimeout(500);
  const scrollable = await page.evaluate((gid) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); return sc ? sc.scrollWidth > sc.clientWidth : false; }, GID);
  check("en tablet la planilla hace scroll horizontal (no corta columnas)", scrollable);
  await page.screenshot({ path: `${OUT}/3-tablet.png` });
  await ctx.close();

  // ---- Permisos ----
  const pe = await openAs(E2E_USERS.produccion);
  await openTab(pe.page);
  check("Producción ve la planilla pero sin filas en blanco para cargar", (await pe.page.locator(`[data-testid=${GID}] .genus-draft-row`).count()) === 0);
  const post = await pe.page.request.post("/api/v1/deposito-despachos", { data: { records: [{ remito: "X", cliente: `${TAG} NOPERM` }] } });
  const patchP = await pe.page.request.patch("/api/v1/deposito-despachos/cells", { data: { changes: [{ id: oldIds[0], field: "control", value: "TRUE", expectedVersion: "x" }] } });
  check("Producción no puede marcar CONTROL (403)", patchP.status() === 403, String(patchP.status()));
  check("Producción no puede crear (403)", post.status() === 403, String(post.status()));
  const dr = await openAs(E2E_USERS.direccion);
  const get = await dr.page.request.get("/api/v1/deposito-despachos");
  check("Dirección puede consultar (200)", get.status() === 200, String(get.status()));
  await pe.ctx.close();
  await dr.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
