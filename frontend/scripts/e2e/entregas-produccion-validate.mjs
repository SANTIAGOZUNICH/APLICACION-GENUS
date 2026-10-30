// E2E en Chromium real: Depósito → Entregas Producción como PLANILLA (misma grilla que Ingresos/Salidas ME). Base DESCARTABLE.
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
  await page.evaluate(([gid]) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); sc.scrollTop = sc.scrollHeight; sc.scrollLeft = 0; }, [GID]);
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
  // Registros PREVIOS (como los cargados desde la PR #222): deben conservarse intactos.
  const oldIds = [randomUUID(), randomUUID()];
  await q(`insert into deposito_despachos (id, fecha, remito, cliente, producto, bultos, cantidad_total, created_by, created_by_sector) values
    ($1,'2026-10-20','0001-00000045','${TAG} PREVIO A','Crema previa',3,60,'prev','DEPOSITO'), ($2,'2026-10-21','000777','${TAG} PREVIO B','Gel previo',1,10,'prev','DEPOSITO')`, oldIds);

  const { ctx, page } = await openAs(E2E_USERS.deposito);
  await openTab(page);
  check("abre como planilla con las 6 columnas, sin formularios ni botón «Agregar entrega»",
    JSON.stringify(Object.keys(await colMap(page)).filter((k) => ["fecha", "n.º remito", "cliente", "producto", "bultos", "cantidad total"].includes(k))) !== "[]"
    && (await page.locator("[data-testid=despachos-create]").count()) === 0 && (await page.getByRole("dialog").count()) === 0,
    JSON.stringify(Object.keys(await colMap(page))));
  check("los registros previos siguen visibles", (await page.locator(`[data-testid=${GID}] input`).evaluateAll((els) => els.some((i) => i.value === "0001-00000045"))) === true);
  await page.screenshot({ path: `${OUT}/1-planilla.png` });

  // ---- Pegado de 5 filas (celdas vacías, ceros iniciales, fecha DD/MM/AAAA) en las filas en blanco ----
  await clickBox(page, await draftCell(page, 0, "Fecha"));
  const rows5 = [
    ["10/11/2026", "00045", `${TAG} P1`, "Crema 50ml", "4", "96"],
    ["11/11/2026", "", `${TAG} P2`, "", "", "12"], // remito, producto y bultos vacíos
    ["12/11/2026", "0001-00000099", `${TAG} P3`, "Shampoo 1L", "10", "240"],
    ["", "000123", `${TAG} P4`, "Gel", "2", ""], // sin fecha y sin cantidad
    ["13/11/2026", "7", `${TAG} P5`, "Serum", "1,5", "1.234,5"],
  ];
  await pasteDoc(page, rows5.map((r) => r.join("\t")).join("\n"));
  check("pegar 5 filas: se crean las 5 (una vez cada una)", await waitDb(async () => (await active(`cliente like '${TAG} P_'`)).length === 5, 40_000));
  const byCli = async (c) => (await active("cliente = $1", [`${TAG} ${c}`]))[0];
  const p1 = await byCli("P1"), p2 = await byCli("P2"), p3 = await byCli("P3"), p4 = await byCli("P4"), p5 = await byCli("P5");
  check("cada columna cae en su columna y cada fila en su fila", p1?.producto === "Crema 50ml" && Number(p1.bultos) === 4 && Number(p1.cantidad_total) === 96 && p3?.producto === "Shampoo 1L" && Number(p3.cantidad_total) === 240);
  check("remitos con ceros iniciales se conservan como TEXTO", p1?.remito === "00045" && p3?.remito === "0001-00000099" && p4?.remito === "000123" && p5?.remito === "7");
  check("celdas vacías se respetan (no se corren columnas)", p2?.remito === "" && p2?.producto === "" && Number(p2.bultos) === 0 && Number(p2.cantidad_total) === 12);
  check("fila sin fecha se guarda incompleta (fecha vacía)", p4 && p4.fecha === null && Number(p4.cantidad_total) === 0);
  check("fecha DD/MM/AAAA y decimales con coma se interpretan bien", String((await q("select fecha::text f from deposito_despachos where id = $1", [p1.id]))[0].f) === "2026-11-10" && Number(p5.bultos) === 1.5 && Number(p5.cantidad_total) === 1234.5);
  await page.waitForTimeout(2500);
  check("sin duplicados tras esperar (guardado único por fila)", (await active(`cliente like '${TAG} P_'`)).length === 5);

  // ---- Pegar una columna de fechas completa ----
  const dateOnly = () => q("select id from deposito_despachos where deleted_at is null and cliente = '' and remito = '' and fecha between '2026-12-01' and '2026-12-04'");
  await clickBox(page, await draftCell(page, 0, "Fecha"));
  await pasteDoc(page, "01/12/2026\n02/12/2026\n03/12/2026\n04/12/2026");
  check("pegar solo una COLUMNA de fechas: 4 filas nuevas con fecha y el resto vacío", await waitDb(async () => (await dateOnly()).length === 4, 40_000));

  // ---- Pegado masivo (300 filas) ----
  const big = Array.from({ length: 300 }, (_, i) => [`${String((i % 28) + 1).padStart(2, "0")}/09/2027`, String(i).padStart(6, "0"), `${TAG} BIG`, `Producto ${i % 7}`, String(i % 9), String(i * 3)].join("\t")).join("\n");
  await clickBox(page, await draftCell(page, 0, "Fecha"));
  const t0 = Date.now();
  await pasteDoc(page, big);
  check("pegar 300 filas de una sola vez: se guardan las 300", await waitDb(async () => (await active("cliente = $1", [`${TAG} BIG`])).length === 300, 120_000), `${Math.round((Date.now() - t0) / 1000)}s`);
  await page.waitForTimeout(3000);
  const big2 = await active("cliente = $1", [`${TAG} BIG`]);
  check("pegado masivo sin duplicados y sin pérdida (remitos 000000…000299 únicos, ceros conservados)", big2.length === 300 && new Set(big2.map((r) => r.remito)).size === 300 && big2.some((r) => r.remito === "000007"));

  // ---- Escribir directo en una fila en blanco ----
  await clickBox(page, await draftCell(page, 0, "Cliente"));
  await page.keyboard.type(`${TAG} TIPEADO`);
  await page.keyboard.press("Tab");
  await page.keyboard.type("Producto tipeado");
  await page.keyboard.press("Enter");
  check("escribir directo en una celda en blanco crea la fila sola (incompleta)", await waitDb(async () => (await active("cliente = $1", [`${TAG} TIPEADO`])).length === 1, 30_000));

  // ---- Recarga: persiste ----
  await page.reload();
  await openTab(page);
  await setFilter(page, "despachos-f-cliente", `${TAG} PREVIO`);
  await waitRow(page, "0001-00000045");
  check("tras recargar siguen los datos (previos y pegados)", await page.locator(`[data-testid=${GID}] input`).evaluateAll((els) => els.some((i) => i.value === "0001-00000045")));

  // ---- Editar una celda existente ----
  const c = await dataCell(page, "0001-00000045", "Producto");
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Crema EDITADA");
  await page.keyboard.press("Enter");
  check("edición directa de una celda se guarda sola", await waitDb(async () => (await q("select producto from deposito_despachos where id = $1", [oldIds[0]]))[0].producto === "Crema EDITADA"));
  check("la edición deja auditoría (antes → después)", await waitDb(async () => (await q("select 1 from deposito_despachos_audit where despacho_id = $1 and action = 'update' and field = 'producto' and before_value = 'Crema previa' and after_value = 'Crema EDITADA'", [String(oldIds[0])])).length === 1));

  // ---- Borrar contenido de celdas (varias y una) ----
  await setFilter(page, "despachos-f-cliente", `${TAG} PREVIO`);
  const pB = await dataCell(page, "000777", "Producto"); // B (21/10) queda arriba de A (20/10) en el orden por fecha
  await pB.click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Delete");
  check("Delete sobre varias celdas seleccionadas vacía todas", await waitDb(async () => (await q("select producto from deposito_despachos where id = any($1::uuid[])", [oldIds])).every((r) => r.producto === "")));
  const cl = await dataCell(page, "000777", "Cliente");
  await cl.click();
  await page.keyboard.press("Delete");
  check("Delete vacía una celda y se guarda", await waitDb(async () => (await q("select cliente from deposito_despachos where id = $1", [oldIds[1]]))[0].cliente === ""));

  // ---- Eliminar varias filas (sin motivo) ----
  const before = (await active("cliente = $1", [`${TAG} BIG`])).length;
  await setFilter(page, "despachos-f-cliente", `${TAG} BIG`);
  await setFilter(page, "despachos-f-remito", "00000");
  for (const v of ["000001", "000002", "000003"]) {
    const ri = await page.evaluate(([gid, v]) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)].findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v)), [GID, v]);
    if (ri < 0) throw new Error(`fila ${v} no visible`);
    await page.locator(`[data-testid=${GID}] .dsg-row`).nth(ri).locator("[data-testid=row-check]").click();
  }
  check("seleccionar 3 filas completas muestra la barra de selección", (await page.locator("[data-testid=deposito-delete-count]").innerText()) === "3 filas seleccionadas");
  await page.locator("[data-testid=deposito-delete-selected]").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15_000 });
  check("la eliminación pide UNA confirmación sin motivo", (await dialog.locator("textarea, input[type=text]").count()) === 0);
  await page.locator("[data-testid=deposito-delete-confirm]").click();
  check("eliminadas las 3 filas (baja lógica con auditoría)", await waitDb(async () => (await active("cliente = $1", [`${TAG} BIG`])).length === before - 3)
    && (await q("select count(*)::int n from deposito_despachos_audit a join deposito_despachos d on d.id::text = a.despacho_id where a.action = 'delete' and d.cliente = $1 and d.remito in ('000001','000002','000003')", [`${TAG} BIG`]))[0].n === 3);
  await page.reload();
  await openTab(page);
  await setFilter(page, "despachos-f-cliente", `${TAG} BIG`);
  await setFilter(page, "despachos-f-remito", "00000");
  check("tras recargar las filas eliminadas no reaparecen", (await active("remito = '000001' and cliente = $1", [`${TAG} BIG`])).length === 0);
  await page.screenshot({ path: `${OUT}/2-final.png` });
  const prevKept = await q("select id from deposito_despachos where id = any($1::uuid[]) and deleted_at is null", [oldIds]);
  check("los registros previos se conservaron (con sus datos)", prevKept.length === 2);
  await ctx.close();

  // ---- Permisos ----
  const pe = await openAs(E2E_USERS.produccion);
  await openTab(pe.page);
  check("Producción ve la planilla pero sin filas en blanco para cargar", (await pe.page.locator(`[data-testid=${GID}] .genus-draft-row`).count()) === 0);
  const post = await pe.page.request.post("/api/v1/deposito-despachos", { data: { records: [{ remito: "X", cliente: `${TAG} NOPERM` }] } });
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
