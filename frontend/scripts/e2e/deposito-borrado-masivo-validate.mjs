// E2E en Chromium real: Depósito elimina filas (una, varias no consecutivas, visibles con filtro, toda la tabla) y vacía celdas,
// sin motivos, y lo borrado NO reaparece al recargar. Base DESCARTABLE (marca verificada) y login real. Ver run-deposito-borrado-masivo-local.sh.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/deposito-borrado";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-01T10:00:00.000Z";
const nro = (n) => `E2E-BM-I-${String(n).padStart(2, "0")}`;
const ids = {};

async function seed(from, to, codePrefix = "E2E-BM-A") {
  for (let n = from; n <= to; n++) {
    const iid = randomUUID();
    const mid = randomUUID();
    const codigo = `${codePrefix}${n}`;
    ids[n] = { iid, mid, codigo };
    await q("insert into inv_me_materials (id, payload) values ($1,$2)", [mid, { id: mid, codigo, descripcion: `Insumo ${n}`, cliente: "CLIENTE E2E", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false }]);
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [iid, { id: iid, fecha: "2026-10-01", ingresoNro: nro(n), proveedor: "PROV E2E", cliente: "CLIENTE E2E", remitoNro: `R-BM-${n}`, codigo, descripcionInsumo: `Insumo ${n}`, bultos: 1, cantidad: 10 * n, total: 10 * n, ubicacion: "A1", materialId: mid, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T }]);
  }
}
const cleanup = async () => {
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-BM-%'`);
};
const anulado = async (n) => Boolean((await q("select payload from inv_me_ingresos where id = $1", [ids[n].iid]))[0]?.payload?.anulado);
const activeCount = async () => (await q("select count(*)::int n from inv_me_ingresos where payload->>'codigo' like 'E2E-BM-%' and not coalesce((payload->>'anulado')::boolean, false)"))[0].n;

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 2000, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const rowValues = (page) => page.evaluate(() => [...document.querySelectorAll(".dsg-row:not(.dsg-row-header)")].map((r) => [...r.querySelectorAll("input[type=text], input:not([type])")].map((i) => i.value).find((v) => /^E2E-BM-I-/.test(v)) ?? "").filter(Boolean));
const waitRow = (page, value) => page.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 120_000 });
const waitGone = (page, value) => page.waitForFunction((v) => ![...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 60_000 });
async function toggleRow(page, value) {
  // Clic REAL con el mouse (no un click() de JS): la grilla atiende el mousedown y no debe tragarse la casilla.
  const ri = await page.evaluate((v) => [...document.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v)), value);
  if (ri < 0) throw new Error(`fila no encontrada: ${value}`);
  await page.locator(".dsg-row").nth(ri).locator("[data-testid=row-check]").click();
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
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
async function confirmDialog(page) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15_000 });
  const text = await dialog.innerText();
  const hasReasonField = (await dialog.locator("textarea, input[type=text], input[type=password]").count()) > 0;
  await page.locator("[data-testid=deposito-delete-confirm]").click();
  return { text: text.replace(/\s+/g, " "), hasReasonField };
}

try {
  await cleanup();
  await seed(1, 12);
  const dep = await openAs(E2E_USERS.deposito);
  const dp = dep.page;

  // ================= INGRESOS ME =================
  await nav(dp, "Ingresos ME");
  await waitRow(dp, nro(1));
  const checks = await dp.locator("[data-testid=row-check]").count();
  check("cada fila tiene su casilla al comienzo y el encabezado tiene «seleccionar todas»", checks >= 12 && (await dp.locator("[data-testid=row-check-all]").count()) === 1, `${checks} casillas`);
  check("sin selección no se muestra la barra de acciones de selección; «Eliminar todas…» siempre disponible", (await dp.locator("[data-testid=deposito-delete-count]").count()) === 0 && (await dp.locator("[data-testid=deposito-delete-all-menu]").count()) === 1);
  await dp.screenshot({ path: `${OUT}/1-casillas.png` });

  // 1) una fila
  await toggleRow(dp, nro(1));
  await dp.locator("[data-testid=deposito-delete-count]").waitFor();
  check("seleccionar una fila muestra «1 fila seleccionada | Eliminar seleccionadas | Cancelar selección»", (await dp.locator("[data-testid=deposito-delete-count]").innerText()) === "1 fila seleccionada" && (await dp.locator("[data-testid=deposito-delete-cancel]").count()) === 1);
  await dp.screenshot({ path: `${OUT}/2-barra.png` });
  await dp.locator("[data-testid=deposito-delete-selected]").click();
  const d1 = await confirmDialog(dp);
  check("una sola confirmación con la cantidad, sin pedir motivo ni contraseña", /1 registro seleccionado/.test(d1.text) && !d1.hasReasonField, d1.text.slice(0, 120));
  await waitGone(dp, nro(1));
  check("la fila desaparece de la planilla y en la base queda dada de baja (anulado)", await waitDb(() => anulado(1)));
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await waitRow(dp, nro(2));
  check("tras recargar la fila eliminada NO reaparece", !(await rowValues(dp)).includes(nro(1)));

  // 2) cinco filas NO consecutivas
  for (const n of [3, 5, 7, 9, 11]) await toggleRow(dp, nro(n));
  check("selección de 5 filas no consecutivas", (await dp.locator("[data-testid=deposito-delete-count]").innerText()) === "5 filas seleccionadas");
  await dp.locator("[data-testid=deposito-delete-selected]").click();
  const d5 = await confirmDialog(dp);
  check("confirmación de 5 registros", /5 registros seleccionados/.test(d5.text), d5.text.slice(0, 100));
  await waitGone(dp, nro(11));
  const gone5 = await waitDb(async () => (await Promise.all([3, 5, 7, 9, 11].map(anulado))).every(Boolean));
  const kept = (await Promise.all([2, 4, 6, 8, 10, 12].map(anulado))).every((x) => !x);
  check("las 5 se eliminan y las demás quedan intactas", gone5 && kept && (await activeCount()) === 6);
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await waitRow(dp, nro(2));
  check("tras recargar siguen 6 filas, ninguna eliminada reaparece", (await rowValues(dp)).sort().join() === [2, 4, 6, 8, 10, 12].map(nro).sort().join());

  // 3) visibles con filtro (solo lo que se ve) y 4) toda la tabla
  await dp.locator('input[placeholder="Buscar…"]').fill("Insumo 1"); // coincide con Insumo 10 y 12? (descripción) → ver abajo
  await dp.waitForTimeout(800);
  const visibleNow = await rowValues(dp);
  await dp.locator("[data-testid=deposito-delete-all-menu]").click();
  const visLabel = await dp.locator("[data-testid=deposito-delete-visible]").innerText();
  check("«Eliminar todas las filas visibles» muestra la cantidad filtrada, distinta de la tabla completa", visLabel.includes(`(${visibleNow.length})`) && visibleNow.length < 6, `${visLabel} / visibles=${visibleNow.join(",")}`);
  const tblLabel = await dp.locator("[data-testid=deposito-delete-table]").innerText();
  check("«Eliminar todos los registros de la tabla» indica el total real (6), incluidos los ocultos por el filtro", tblLabel.includes("(6)"), tblLabel);
  await dp.locator("[data-testid=deposito-delete-visible]").click();
  const dv = await confirmDialog(dp);
  check("confirmación de «visibles» aclara el alcance", /filas visibles?/.test(dv.text) && !dv.hasReasonField, dv.text.slice(0, 120));
  await waitDb(async () => (await activeCount()) === 6 - visibleNow.length);
  check("solo se eliminaron las visibles; las ocultas por el filtro siguen en la base", (await activeCount()) === 6 - visibleNow.length);
  await dp.locator('input[placeholder="Buscar…"]').fill("");
  await dp.waitForTimeout(500);
  await dp.locator("[data-testid=deposito-delete-all-menu]").click();
  await dp.locator("[data-testid=deposito-delete-table]").click();
  const dt = await confirmDialog(dp);
  check("«toda la tabla»: confirmación única que avisa que incluye lo no visible", /TODOS los registros/.test(dt.text) && !dt.hasReasonField, dt.text.slice(0, 160));
  check("toda la tabla queda sin registros activos en la base", await waitDb(async () => (await activeCount()) === 0));
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: `${OUT}/3-tabla-vacia.png` });
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await dp.waitForTimeout(2500);
  check("tras recargar la tabla sigue vacía (nada reaparece)", (await rowValues(dp)).filter((v) => v.startsWith("E2E-BM-")).length === 0);

  // historial interno
  await dp.locator("[data-testid=deposito-delete-history]").click();
  await dp.locator("[data-testid=deletion-history-list] li").first().waitFor({ timeout: 30_000 });
  const histN = await dp.locator("[data-testid=deletion-history-list] li").count();
  check("historial de eliminaciones accesible para auditoría (usuario, fecha y contenido)", histN >= 12 && /E2E-BM|Insumo/.test(await dp.locator("[data-testid=deletion-history-list]").innerText()), `${histN} entradas`);
  await dp.screenshot({ path: `${OUT}/4-historial.png` });
  await dp.keyboard.press("Escape");
  const audit = await q("select count(*)::int n from inv_audit where payload->>'module' = 'me_ingresos' and payload->>'action' = 'anular' and payload->>'actor' = $1", [E2E_USERS.deposito.email]);
  check("auditoría en la base: una entrada por registro eliminado (usuario Depósito)", audit[0].n >= 12, String(audit[0].n));
  const stock = await dp.request.get("/api/v1/inventory?resource=me_inventario");
  const inv = ((await stock.json()).data ?? []).filter((r) => String(r.codigo).startsWith("E2E-BM-"));
  check("el stock de los materiales con ingresos eliminados vuelve a 0 (saldos coherentes)", inv.every((r) => r.cantidadTotal === 0), `${inv.length} materiales`);

  // ================= VACIAR CELDAS =================
  await seed(20, 24, "E2E-BM-C");
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await waitRow(dp, nro(20));
  const c1 = await cell(dp, nro(20), "PROVEEDOR");
  await c1.click();
  await dp.keyboard.press("Delete");
  check("vaciar UNA celda (Delete) se guarda vacía en la base", await waitDb(async () => (await q("select payload from inv_me_ingresos where id = $1", [ids[20].iid]))[0].payload.proveedor === ""));
  await c1.click();
  await dp.keyboard.press("Shift+ArrowDown");
  await dp.keyboard.press("Shift+ArrowDown");
  await dp.keyboard.press("Delete");
  const multi = await waitDb(async () => (await Promise.all([20, 21, 22].map(async (n) => (await q("select payload from inv_me_ingresos where id = $1", [ids[n].iid]))[0].payload.proveedor))).every((v) => v === ""));
  check("vaciar VARIAS celdas seleccionadas se guarda en las 3 filas", multi);
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await waitRow(dp, nro(20));
  check("tras recargar las celdas vaciadas siguen vacías", (await (await cell(dp, nro(21), "PROVEEDOR")).locator("input").inputValue()) === "");

  // ================= SALIDAS e INVENTARIO =================
  const salId = randomUUID();
  await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [salId, { id: salId, fecha: "2026-10-02", egresoNro: "E2E-BM-E-01", cliente: "CLIENTE E2E", remitoNro: "", descripcion: "x", bultos: null, cantidad: 2, total: 2, control: false, entregado: false, comentarios: "", materialId: ids[23].mid, codigo: ids[23].codigo, unidad: "u", origen: "MANUAL", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T }]);
  await nav(dp, "Salidas ME");
  await waitRow(dp, "E2E-BM-E-01");
  await dp.locator("[data-testid=row-check-all]").click();
  await dp.locator("[data-testid=deposito-delete-selected]").click();
  await confirmDialog(dp);
  check("Salidas ME: «seleccionar todas» + eliminar baja la salida y persiste", await waitDb(async () => (await q("select payload from inv_me_salidas where id = $1", [salId]))[0].payload.reverted === true));
  await nav(dp, "Inventario ME");
  await dp.waitForFunction(() => document.querySelectorAll("[data-testid=row-check]").length > 0, null, { timeout: 60_000 });
  await dp.locator("[data-testid=deposito-delete-all-menu]").click();
  await dp.locator("[data-testid=deposito-delete-table]").click();
  await confirmDialog(dp);
  check("Inventario ME: «toda la tabla» archiva los materiales de prueba y persiste", await waitDb(async () => (await q("select count(*)::int n from inv_me_materials where payload->>'codigo' like 'E2E-BM-%' and not coalesce((payload->>'archived')::boolean,false)"))[0].n === 0));
  await dp.screenshot({ path: `${OUT}/5-inventario-vacio.png` });
  await dep.ctx.close();

  // ================= PERMISOS =================
  await seed(30, 31, "E2E-BM-P");
  const prodCtx = await pwRequest.newContext({ baseURL: BASE });
  await prodCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  const pr = await prodCtx.post("/api/v1/inventory", { data: { action: "bulk_delete", resource: "me_ingresos", payload: { scope: "all" } } });
  check("Producción NO puede borrar ingresos ME (403) y no se elimina nada", pr.status() === 403 && !(await anulado(30)) && !(await anulado(31)), String(pr.status()));
  await prodCtx.dispose();
  const anon = await pwRequest.newContext({ baseURL: BASE });
  const an = await anon.post("/api/v1/inventory", { data: { action: "bulk_delete", resource: "me_ingresos", payload: { scope: "all" } } });
  check("sin sesión → 401", an.status() === 401, String(an.status()));
  await anon.dispose();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
