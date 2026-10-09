// E2E en Chromium real: Materias Primas como planillas editables (Etapa 3) — Ingresos, Stock, Compras y Control semanal.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production. Ver run-mp-planilla-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/mp-planilla";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const balance = async (codigo) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [codigo]))[0]?.stock_actual ?? 0);
const ingreso = async (remito) => (await q("select payload from inv_mp_ingresos where payload->>'remitoNro' = $1", [remito]))[0]?.payload;
const lotKg = async (codigo) => (await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [codigo])).map((r) => r.payload.cantidadKg);

async function cleanup() {
  await q("delete from inv_mp_ingresos where payload->>'codigo' like 'E2E-MP-%'");
  await q("delete from inv_mp_stock where payload->>'codigo' like 'E2E-MP-%'");
  await q("delete from inv_mp_compras where payload->>'materiaPrima' like 'E2E %'");
  await q("delete from mp_stock_movements where codigo like 'E2E-MP-%'");
  await q("delete from mp_stock_balances where codigo like 'E2E-MP-%'");
  await q("delete from mp_weekly_controls where product like 'E2E %'");
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 2200, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
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
const waitRow = (page, value) => page.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 120_000 });
async function cell(page, rowValue, title) {
  const pos = await page.evaluate(([v, title]) => {
    const rows = [...document.querySelectorAll(".dsg-row")];
    const header = rows.find((r) => r.classList.contains("dsg-row-header"));
    const col = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === title);
    const ri = rows.findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v));
    return { col, ri };
  }, [rowValue, title]);
  if (pos.col < 0 || pos.ri < 0) throw new Error(`celda no encontrada: ${rowValue} / ${title} ${JSON.stringify(pos)}`);
  return page.locator(".dsg-row").nth(pos.ri).locator(".dsg-cell").nth(pos.col);
}
async function typeInto(page, rowValue, title, value, gridTestId, reason) {
  const c = await cell(page, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridTestId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
    if (reason) await page.locator(`[data-testid=${gridTestId}-reason]`).fill(reason);
    await apply.click();
  }
}
const cellLocked = async (page, rowValue, title) => (await cell(page, rowValue, title)).evaluate((el) => Boolean(el.querySelector(".genus-cell-lock")));
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const post = (page, data) => page.request.post("/api/v1/inventory", { data });

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const pp = mpu.page;

  // ===== Datos: un ingreso confirmado (formulario) + uno pegado (borrador) =====
  const conf = await post(pp, { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: "E2E-R-1", codigo: "E2E-MP-GLI", descripcion: "Glicerina E2E", lote: "G1", proveedor: "PROV E2E", bultos: 4, cantidad: 25 } });
  check("ingreso por formulario: confirmado y suma al lote y al libro mayor (100 kg)", conf.ok() && (await balance("E2E-MP-GLI")) === 100 && (await lotKg("E2E-MP-GLI"))[0] === 100, String(conf.status()));
  const pasteRow = { fecha: "2026-10-02", remitoNro: "E2E-R-2", codigo: "E2E-MP-COCO", descripcion: "Aceite coco E2E", lote: "K1", proveedor: "PROV E2E", cantidad: 40, status: "BORRADOR" };
  const pasted = await post(pp, { action: "upsert", resource: "mp_ingresos", payload: pasteRow });
  check("pegado: queda en BORRADOR y NO mueve stock", pasted.ok() && (await ingreso("E2E-R-2"))?.status === "BORRADOR" && (await balance("E2E-MP-COCO")) === 0);
  const dup = await post(pp, { action: "upsert", resource: "mp_ingresos", payload: pasteRow });
  check("pegar dos veces el mismo ingreso: rechazado (no duplica stock)", dup.status() === 400 && /Duplicado/.test((await dup.json()).error ?? ""), String(dup.status()));

  // ===== Ingresos MP como planilla =====
  await pp.goto("/mi-trabajo");
  await nav(pp, "Ingresos MP");
  await waitRow(pp, "E2E-R-2");
  check("planilla de Ingresos editable: proveedor, cantidad y lote sin candado", !(await cellLocked(pp, "E2E-R-2", "Proveedor")) && !(await cellLocked(pp, "E2E-R-2", "Cantidad")) && !(await cellLocked(pp, "E2E-R-2", "Lote")));
  check("INGRESO Nº y TOTAL no se editan (calculados)", (await cellLocked(pp, "E2E-R-2", "Ingreso")) && (await cellLocked(pp, "E2E-R-2", "Total")));
  await typeInto(pp, "E2E-R-2", "Cantidad", "45", "mp-ingresos-grid");
  check("editar el borrador en la grilla: guarda 45 y sigue en BORRADOR (no mueve stock)", await waitDb(async () => (await ingreso("E2E-R-2"))?.cantidad === 45 && (await ingreso("E2E-R-2"))?.status === "BORRADOR" && (await balance("E2E-MP-COCO")) === 0));
  await pp.locator("[data-testid=mp-ingresos-borradores]").waitFor({ timeout: 30_000 });
  await pp.screenshot({ path: `${OUT}/1-ingresos-planilla-borrador.png` });
  await pp.locator("[data-testid=mp-ingresos-confirmar-borradores]").click();
  check("«Confirmar borradores»: recién ahí suma al lote y al libro mayor (45)", await waitDb(async () => (await ingreso("E2E-R-2"))?.status === "CONFIRMADO" && (await balance("E2E-MP-COCO")) === 45 && (await lotKg("E2E-MP-COCO"))[0] === 45));

  // corrección de un confirmado: pide motivo y mueve por delta
  await waitRow(pp, "E2E-R-1");
  await typeInto(pp, "E2E-R-1", "Cantidad", "24", "mp-ingresos-grid", "Remito corregido por el proveedor");
  check("corregir la cantidad de un ingreso CONFIRMADO pide motivo y ajusta por diferencia (100 → 96)", await waitDb(async () => (await balance("E2E-MP-GLI")) === 96 && (await lotKg("E2E-MP-GLI"))[0] === 96));
  check("la corrección queda auditada con el motivo", (await q("select 1 from inv_audit where payload->>'entityId' = $1 and payload->>'reason' = 'Remito corregido por el proveedor'", [(await ingreso("E2E-R-1")).id])).length === 1);
  await pp.reload();
  await nav(pp, "Ingresos MP");
  await waitRow(pp, "E2E-R-1");
  check("tras recargar, la grilla muestra el valor guardado (24)", (await (await cell(pp, "E2E-R-1", "Cantidad")).locator("input").inputValue()) === "24");
  await pp.screenshot({ path: `${OUT}/2-ingresos-corregido-recargado.png` });

  // concurrencia: versión vieja → 409
  const stale = await pp.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_ingresos", changes: [{ id: (await ingreso("E2E-R-1")).id, field: "proveedor", value: "X", expectedVersion: "2020-01-01T00:00:00.000Z" }] } });
  check("edición con versión vieja → 409 y no se pisa", stale.status() === 409 && (await ingreso("E2E-R-1")).proveedor === "PROV E2E", String(stale.status()));

  // ===== Stock MP: stock del código según el libro mayor =====
  await nav(pp, "Stock");
  await waitRow(pp, "E2E-MP-GLI");
  const libro = await (await cell(pp, "E2E-MP-GLI", "Stock código")).locator("input").inputValue();
  check("Stock: columna «Stock código» con el saldo del libro mayor (96)", /96/.test(libro), libro);
  check("Stock: los kg de un lote ingresado no se pisan por celda (se ajustan con motivo)", await cellLocked(pp, "E2E-MP-GLI", "Kg lote"));
  await pp.screenshot({ path: `${OUT}/3-stock-libro-mayor.png` });
  const lotId = (await q("select id from inv_mp_stock where payload->>'codigo' = 'E2E-MP-GLI'"))[0].id;
  const adj = await post(pp, { action: "adjust", resource: "mp_stock", id: lotId, payload: { cantidadNueva: 90, motivo: "Conteo físico E2E" } });
  check("«Ajustar stock» del lote: el lote y el libro mayor bajan juntos (96 → 90)", adj.ok() && (await balance("E2E-MP-GLI")) === 90 && (await lotKg("E2E-MP-GLI"))[0] === 90);
  const formKg = await post(pp, { action: "upsert", resource: "mp_stock", payload: { id: lotId, descripcion: "Glicerina E2E", cantidadKg: 500 } });
  check("el formulario ya no pisa los kg de un lote existente (400, sin cambio)", formKg.status() === 400 && (await balance("E2E-MP-GLI")) === 90, String(formKg.status()));

  // ===== Compras MP =====
  const compra = await post(pp, { action: "upsert", resource: "mp_compras", payload: { materiaPrima: "E2E Mentol", cantidad: 3, unidad: "kg", proveedor: "PROV E2E", estado: "Solicitada" } });
  check("alta de compra", compra.ok());
  await nav(pp, "Compras MP");
  await waitRow(pp, "E2E Mentol");
  await typeInto(pp, "E2E Mentol", "Estado", "En camino", "mp-compras-grid");
  check("Compras: editar el estado en la grilla persiste", await waitDb(async () => (await q("select payload->>'estado' as e from inv_mp_compras where payload->>'materiaPrima' = 'E2E Mentol'"))[0]?.e === "En camino"));
  await pp.screenshot({ path: `${OUT}/4-compras-planilla.png` });

  // ===== Control semanal: stock real =====
  const ctl = await pp.request.post("/api/v1/mp-control", { data: { client: "CLIENTE E2E", product: "E2E CREMA", quantityKg: 100, snapshot: { client: "CLIENTE E2E", product: "E2E CREMA", source: "manual", capturedAt: new Date().toISOString(), materials: [{ codigo: "E2E-MP-GLI", materiaPrima: "Glicerina E2E", formulaPct: 10 }] } } });
  const ctlBody = await ctl.json();
  check("Control semanal: la línea trae el stock real del libro mayor (90; antes siempre 0)", ctl.ok() && ctlBody.control?.lines?.[0]?.stockActual === 90, JSON.stringify(ctlBody.control?.lines?.[0]?.stockActual));
  const v1 = ctlBody.control.updatedAt;
  const up = await pp.request.patch(`/api/v1/mp-control/${ctlBody.control.id}`, { data: { quantityKg: 200, expectedVersion: v1 } });
  const upStale = await pp.request.patch(`/api/v1/mp-control/${ctlBody.control.id}`, { data: { quantityKg: 300, expectedVersion: v1 } });
  check("Control semanal: guardado con versión; la versión vieja → 409", up.ok() && upStale.status() === 409, `${up.status()} / ${upStale.status()}`);
  await nav(pp, "Control semanal");
  await pp.getByText("CLIENTE E2E · E2E CREMA").first().click({ timeout: 30_000 });
  await waitRow(pp, "E2E-MP-GLI");
  check("Control semanal en pantalla: la línea muestra el stock real (90)", (await (await cell(pp, "E2E-MP-GLI", "Stock")).locator("input").inputValue()) === "90");
  await pp.screenshot({ path: `${OUT}/5-control-semanal.png` });
  await mpu.ctx.close();

  // ===== Permisos: Producción ve, no edita =====
  const prod = await openAs(E2E_USERS.produccion);
  const pr = prod.page;
  const denyCell = await pr.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_ingresos", changes: [{ id: (await ingreso("E2E-R-1")).id, field: "proveedor", value: "X", expectedVersion: (await ingreso("E2E-R-1")).updatedAt }] } });
  check("Producción no edita ingresos MP (403)", denyCell.status() === 403, String(denyCell.status()));
  const denySeed = await pr.request.post("/api/v1/mp-stock/ledger", { data: { action: "seed", codigo: "E2E-MP-NEW", seedQuantity: 10 } });
  check("Producción no registra saldos iniciales del libro mayor (403)", denySeed.status() === 403, String(denySeed.status()));
  const canRead = await pr.request.get("/api/v1/mp-stock/ledger?codigo=E2E-MP-GLI");
  check("Producción sí lee el libro mayor", canRead.ok() && (await canRead.json()).balance?.stockActual === 90);
  await prod.ctx.close();
  const env = await openAs(E2E_USERS.envasado);
  const denyRead = await env.page.request.get("/api/v1/mp-stock/ledger?codigo=E2E-MP-GLI");
  check("Envasado no lee el libro mayor de MP (403)", denyRead.status() === 403, String(denyRead.status()));
  await env.ctx.close();
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
