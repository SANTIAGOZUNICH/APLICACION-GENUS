// E2E en Chromium real (PC y tablet): INGRESOS = historial, STOCK = saldo, y Entregas Producción que descuentan stock. Base DESCARTABLE.
// Ingreso 5.000 → stock 5.000; entrega 1.200 → 3.800 (Ingresos sigue 5.000); entrega 800 → 3.000; recarga; anular; permisos; MP intacto.
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
const OUT = process.env.OUT ?? "/tmp/deposito-me-stock-entregas";
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
const TAG = "E2E-ST";
const COD = "E2E-ST-CAJA";
const MAT = randomUUID();
const ING = randomUUID();
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
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-ST-%'`);
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
  const T = "2026-11-02T10:00:00.000Z";
  await q("insert into inv_me_materials (id, payload) values ($1,$2)", [MAT, { id: MAT, codigo: COD, descripcion: "Caja E2E ST", cliente: `${TAG} CLIENTE`, ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false, archivedAt: null, archivedBy: null, archivedReason: null }]);
  await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [ING, { id: ING, fecha: "2026-11-02", ingresoNro: "E2E-ST-I1", proveedor: "PROV", cliente: `${TAG} CLIENTE`, remitoNro: "R-ST-1", codigo: COD, descripcionInsumo: "Caja E2E ST", materialId: MAT, bultos: 1, cantidad: 5000, total: 5000, unidad: "u", anulado: false, anuladoAt: null, anuladoBy: null, anuladoReason: null, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T, producto: "", ubicacion: "A1" }]);
  const mpBefore = (await q("select (select count(*)::int from inv_mp_stock) a, (select count(*)::int from inv_mp_ingresos) b, (select count(*)::int from mp_stock_movements) c"))[0];

  const mk = async (user, viewport) => {
    const ctx = await browser.newContext({ baseURL: BASE, viewport });
    await ctx.addInitScript(() => { try { localStorage.setItem("genus_os_table_mode", "grid"); } catch {} });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    return { ctx, page };
  };
  const stockApi = async (page) => {
    const res = await page.request.get("/api/v1/inventory?resource=me_stock");
    const body = await res.json();
    return (body.data ?? []).find((m) => m.codigo === COD)?.stockActual;
  };
  const ingresosApi = async (page) => {
    const body = await (await page.request.get("/api/v1/inventory?resource=me_ingresos")).json();
    return (body.data ?? []).filter((r) => r.codigo === COD).map((r) => r.total);
  };
  const salidaRows = () => q("select payload from inv_me_salidas where payload->>'codigo' = $1 and payload->>'despachoId' is not null", [COD]);

  for (const [label, viewport] of [["PC", { width: 1600, height: 950 }], ["TABLET", { width: 1024, height: 768 }]]) {
    const { ctx, page } = await mk(E2E_USERS.deposito, viewport);
    if (label === "PC") {
      check(`[${label}] ingreso 5.000: stock 5.000 e Ingresos muestra 5.000`, (await stockApi(page)) === 5000 && JSON.stringify(await ingresosApi(page)) === "[5000]");
      await openTab(page);
      // Entrega 12 bultos × 100 = 1.200 (cliente y descripción coinciden con el material)
      await clickBox(page, await draftCell(page, 0, "Fecha"));
      await pasteDoc(page, ["03/11/2026", "B001", `${TAG} CLIENTE`, "0001-77", "Caja E2E ST", "12", "100", "1.200", "FALSE", "FALSE", ""].join("\t"));
      check("entrega de 1.200: se crea UNA vez y queda vinculada al material", await waitDb(async () => (await active("egreso = 'B001'")).length === 1 && (await active("egreso = 'B001'"))[0].me_stock_status === "VINCULADO", 40_000));
      check("el stock baja a 3.800 y Ingresos sigue mostrando 5.000", (await stockApi(page)) === 3800 && JSON.stringify(await ingresosApi(page)) === "[5000]");
      check("UNA sola salida vinculada (sin duplicados) con trazabilidad", (await salidaRows()).length === 1 && (await salidaRows())[0].payload.total === 1200);
      await page.waitForTimeout(2500);
      await page.reload();
      await page.locator(`[data-testid=${GID}]`).waitFor({ timeout: 120_000 }).catch(() => undefined);
      check("recargar no vuelve a descontar", (await stockApi(page)) === 3800 && (await salidaRows()).length === 1);
      await page.screenshot({ path: `${OUT}/1-pc-entregas.png` });
      // Segunda entrega 800
      await openTab(page);
      await clickBox(page, await draftCell(page, 0, "Fecha"));
      await pasteDoc(page, ["04/11/2026", "B002", `${TAG} CLIENTE`, "0001-78", "Caja E2E ST", "8", "100", "800", "FALSE", "FALSE", ""].join("\t"));
      check("segunda entrega de 800: stock 3.000, Ingresos 5.000", await waitDb(async () => (await stockApi(page)) === 3000, 40_000) && JSON.stringify(await ingresosApi(page)) === "[5000]");
      // Entrega de un producto no identificable: no descuenta
      await openTab(page);
      await clickBox(page, await draftCell(page, 0, "Fecha"));
      await pasteDoc(page, ["05/11/2026", "B003", `${TAG} CLIENTE`, "0001-79", "Producto inexistente ST", "1", "50", "50", "FALSE", "FALSE", ""].join("\t"));
      check("producto sin material identificado: queda «sin material» y NO descuenta", await waitDb(async () => (await active("egreso = 'B003'")).length === 1 && (await active("egreso = 'B003'"))[0].me_stock_status === "SIN_MATERIAL", 40_000) && (await stockApi(page)) === 3000);
      await openTab(page);
      await page.locator("[data-testid=despachos-stock-panel]").waitFor({ timeout: 60_000 });
      check("panel «Stock ME de las entregas» muestra la entrega sin material con selector", (await page.locator("[data-testid=despachos-sin-material] li").count()) >= 1);
      await page.locator("[data-testid=despachos-pick-material]").first().selectOption(COD);
      await page.locator("[data-testid=despachos-assign]").first().click();
      check("elegir el material descuenta (2.950) una sola vez", await waitDb(async () => (await stockApi(page)) === 2950, 40_000) && (await salidaRows()).length === 3);
      await page.screenshot({ path: `${OUT}/2-pc-panel.png` });
      // Eliminar una entrega (baja lógica): anula la salida y repone
      const delTarget = (await active("egreso = 'B002'"))[0];
      const delRes = await page.request.post("/api/v1/deposito-despachos/bulk-delete", { data: { ids: [delTarget.id] } });
      check("eliminar la entrega de 800 anula su salida y repone stock (3.750); no se borra físicamente", delRes.status() === 200 && (await stockApi(page)) === 3750 && (await q("select count(*)::int n from inv_me_salidas where payload->>'despachoId' = $1 and (payload->>'reverted')::boolean", [delTarget.id]))[0].n === 1);
    } else {
      await openTab(page);
      const scrollable = await page.evaluate((gid) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); return sc ? sc.scrollWidth > sc.clientWidth : false; }, GID);
      check("[TABLET] la planilla de entregas hace scroll horizontal (no corta columnas)", scrollable);
      await page.locator("[data-testid=despachos-stock-resumen]").waitFor({ timeout: 60_000 });
      check("[TABLET] el resumen de stock de las entregas es visible", await page.locator("[data-testid=despachos-stock-resumen]").isVisible());
      check("[TABLET] stock consistente (3.750) e Ingresos intacto (5.000)", (await stockApi(page)) === 3750 && JSON.stringify(await ingresosApi(page)) === "[5000]");
      await page.screenshot({ path: `${OUT}/3-tablet.png` });
    }
    await ctx.close();
  }

  // Permisos: Producción consulta pero no escribe; no puede asignar ni aplicar; la salida vinculada no se anula desde Salidas ME
  const pe = await mk(E2E_USERS.produccion, { width: 1600, height: 950 });
  const rep = await pe.page.request.get("/api/v1/deposito-despachos/stock");
  check("Producción puede consultar el informe de stock de las entregas (200)", rep.status() === 200);
  const asg = await pe.page.request.post("/api/v1/deposito-despachos/stock", { data: { action: "assign", id: (await active("egreso = 'B003'"))[0].id, codigo: COD } });
  const apl = await pe.page.request.post("/api/v1/deposito-despachos/stock", { data: { action: "apply" } });
  check("Producción no puede asignar material ni aplicar descuentos (403)", asg.status() === 403 && apl.status() === 403, `${asg.status()}/${apl.status()}`);
  const dr = await mk(E2E_USERS.direccion, { width: 1600, height: 950 });
  check("Dirección consulta (200)", (await dr.page.request.get("/api/v1/deposito-despachos/stock")).status() === 200);
  await pe.ctx.close();
  await dr.ctx.close();
  const dep = await mk(E2E_USERS.deposito, { width: 1600, height: 950 });
  const linked = (await salidaRows()).find((r) => !r.payload.reverted)?.payload;
  const annul = await dep.page.request.post("/api/v1/inventory", { data: { action: "delete", resource: "me_salidas", id: linked.id, reason: "prueba" } });
  check("la salida vinculada no se anula desde Salidas ME (se corrige en la entrega)", annul.status() >= 400 && (await stockApi(dep.page)) === 3750, String(annul.status()));
  await dep.ctx.close();
  const mpAfter = (await q("select (select count(*)::int from inv_mp_stock) a, (select count(*)::int from inv_mp_ingresos) b, (select count(*)::int from mp_stock_movements) c"))[0];
  check("Materias Primas no se toca", JSON.stringify(mpBefore) === JSON.stringify(mpAfter));
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
