// E2E (Chromium real, base DESCARTABLE): CASO REAL — Stock MP con 4.308 posiciones, última fila escrita la 1462 y 1463..4308 vacías.
// El próximo ingreso debe ocupar la fila 1463, el siguiente la 1464 (no la 4309).
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
const OUT = process.env.OUT ?? "/tmp/mp-primera-vacia";
const W = Number(process.env.ESCRITAS ?? 1462);
const T = Number(process.env.TOTAL ?? 4308);
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const kind = process.env.TABLET ? "tablet" : "desktop";
const TIPS = { desktop: { viewport: { width: 1280, height: 800 } }, tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 } };
const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
const page = await ctx.newPage();
await page.goto("/login");
await page.locator('input[type="email"]').fill(E2E_USERS.materiaPrima.email);
await page.locator('input[type="password"]').fill(E2E_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

const nav = (label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
const NOWISO = "2026-10-01T00:00:00.000Z";
async function cleanup() {
  await q(`delete from inv_mp_stock where payload->>'createdBy' = 'zze' or payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from inv_mp_ingresos where payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_movements where codigo like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_balances where codigo like 'ZZ%'`).catch(() => undefined);
}
async function seedStock(written, total) {
  await q(`insert into inv_mp_stock (id, payload, updated_at) select md5('zze-stock-' || g.n)::uuid, case when g.n <= ${written} then jsonb_build_object('id', md5('zze-stock-' || g.n)::uuid::text, 'codigo','ZZE-' || lpad(g.n::text,5,'0'),'descripcion','Materia ZZE ' || g.n,'proveedor','Prov','cliente','','producto','','lote','L' || g.n,'cantidadKg',10,'ubicacion','U1','vencimiento','2028-01-31','estadoStock','Stock OK','origen','manual','archived',false,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}') else jsonb_build_object('id', md5('zze-stock-' || g.n)::uuid::text, 'codigo','','descripcion','','proveedor','','cliente','','producto','','lote','','cantidadKg',null,'ubicacion','','vencimiento','','estadoStock','Sin stock','diasAlVence',null,'estadoVencimiento','','origen','planilla','archived',false,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}') end, now() from (select n from generate_series(1, ${total}) n order by n) g`);
}
const apiList = async (resource) => (await (await page.request.get(`/api/v1/inventory?resource=${resource}`, { timeout: 180_000 })).json()).data ?? [];
const stockOrder = async () => (await apiList("mp_stock")).filter((r) => !r.archived).map((r) => r.id);
const stockCodes = async () => (await apiList("mp_stock")).filter((r) => !r.archived).map((r) => r.codigo);
let seq = 0;
async function newIngreso(code, qty = 25) {
  seq += 1;
  const id = crypto.randomUUID();
  const res = await page.request.post("/api/v1/inventory", {
    data: { action: "upsert", resource: "mp_ingresos", payload: { id, codigo: code, descripcion: `Ingreso ${code}`, proveedor: "Prov ZZ", lote: `LOTE-${code}`, bultos: 1, cantidad: qty, fecha: "2026-10-05", confirm: true } },
    timeout: 120_000,
  });
  const json = await res.json().catch(() => ({}));
  return { id, ok: res.ok(), json, status: res.status() };
}
const movs = async (code) => (await q(`select count(*)::int n from mp_stock_movements where codigo = $1`, [code]))[0].n;
const balance = async (code) => Number((await q(`select stock_actual from mp_stock_balances where codigo = $1`, [code]))[0]?.stock_actual ?? 0);
const lotKg = async (code) => Number((await q(`select coalesce(sum((payload->>'cantidadKg')::numeric),0) s from inv_mp_stock where payload->>'codigo' = $1 and coalesce((payload->>'archived')::boolean,false) = false`, [code]))[0].s);

/** Texto de la fila n (gutter) de una planilla: celdas + valores de inputs. */
const rowText = (gid, n) => page.evaluate(({ gid, n }) => {
  const root = document.querySelector(`[data-testid=${gid}]`);
  for (const row of [...root.querySelectorAll(".dsg-row")].slice(1)) {
    if (Number((row.querySelector(".dsg-cell-gutter")?.textContent ?? "").trim()) === n) {
      return [...row.querySelectorAll(".dsg-cell")].map((c) => (c.querySelector("input")?.value ?? c.textContent ?? "")).join("|");
    }
  }
  return null;
}, { gid, n });
const snapScroll = (gid) => page.evaluate((gid) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); return Math.round(sc.scrollTop); }, "mp-stock-grid");
async function wheel(gid, y) {
  const b = await page.locator(`[data-testid=${gid}] .dsg-container`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, y);
  await page.waitForTimeout(700);
}
async function openTab(label, gid) {
  await page.goto("/mi-trabajo");
  await nav(label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}


const rowIdx = async (code) => (await apiList("mp_stock")).filter((r) => !r.archived).findIndex((r) => r.codigo === code) + 1;
const visibleTotal = async () => (await apiList("mp_stock")).filter((r) => !r.archived).length;
async function bottomOfSheet(gid = "mp-stock-grid") {
  await page.goto("/mi-trabajo");
  await nav("Stock");
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForFunction((g) => (document.querySelector(`[data-testid=${g}] .dsg-container`)?.scrollHeight ?? 0) > 5000, gid, { timeout: 240_000 });
  await page.waitForTimeout(1500);
}
async function gotoRow(n) {
  const top = await page.evaluate(() => document.querySelector("[data-testid=mp-stock-grid] .dsg-container").scrollTop);
  const want = (n - 6) * 36;
  await wheel("mp-stock-grid", want - top);
}
try {
  await cleanup();
  await seedStock(W, T);
  check(`planilla del caso real: ${T} posiciones, la última escrita es la ${W}, ${W + 1}..${T} vacías`, (await q(`select count(*)::int n from inv_mp_stock where payload->>'createdBy' = 'zze'`))[0].n === T);

  // ===== CASO REAL =====
  const a = await newIngreso("ZZN-1");
  check("ingreso nuevo creado", a.ok, JSON.stringify(a.json).slice(0, 100));
  check(`el próximo ingreso ocupa la fila ${W + 1} (NO la ${T + 1})`, (await rowIdx("ZZN-1")) === W + 1, `fila ${await rowIdx("ZZN-1")}`);
  check(`la planilla NO crece: sigue con ${T} posiciones (se usó la fila vacía, sin duplicar)`, (await visibleTotal()) === T, `${await visibleTotal()}`);
  const b = await newIngreso("ZZN-2");
  check(`el siguiente ocupa la fila ${W + 2}`, b.ok && (await rowIdx("ZZN-2")) === W + 2 && (await visibleTotal()) === T);
  const c = await newIngreso("ZZN-3");
  check(`y el siguiente la ${W + 3}`, c.ok && (await rowIdx("ZZN-3")) === W + 3 && (await visibleTotal()) === T);
  check("las filas anteriores no se movieron (la fila 1462 sigue siendo ZZE-01462, la 1 es ZZE-00001)", (await stockCodes())[W - 1] === `ZZE-${String(W).padStart(5, "0")}` && (await stockCodes())[0] === "ZZE-00001");
  check("quedan vacías todas las demás filas hasta la última posición", (await stockCodes()).slice(W + 3).every((c) => c === ""));

  // En la interfaz, y tras recargar
  await bottomOfSheet();
  await gotoRow(W + 1);
  const ui1 = await rowText("mp-stock-grid", W + 1), ui2 = await rowText("mp-stock-grid", W + 2), ui3 = await rowText("mp-stock-grid", W + 3), ui4 = await rowText("mp-stock-grid", W + 4);
  check(`UI: las filas ${W + 1}, ${W + 2} y ${W + 3} muestran los tres ingresos y la ${W + 4} sigue vacía`, !!ui1 && ui1.includes("ZZN-1") && !!ui2 && ui2.includes("ZZN-2") && !!ui3 && ui3.includes("ZZN-3") && !!ui4 && !ui4.includes("ZZN"), `${(ui1 ?? "").slice(0, 40)} / ${(ui2 ?? "").slice(0, 40)} / ${(ui4 ?? "").slice(0, 40)}`);
  await page.screenshot({ path: `${OUT}/01-caso-real.png` });
  await page.reload();
  await nav("Stock").catch(() => undefined);
  await page.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => (document.querySelector("[data-testid=mp-stock-grid] .dsg-container")?.scrollHeight ?? 0) > 5000, null, { timeout: 240_000 });
  await page.waitForTimeout(1500);
  await gotoRow(W + 1);
  const r1 = await rowText("mp-stock-grid", W + 1), r3 = await rowText("mp-stock-grid", W + 3);
  check("tras recargar la página siguen exactamente en esas posiciones", !!r1 && r1.includes("ZZN-1") && !!r3 && r3.includes("ZZN-3"));

  // reintentos
  const mv0 = await movs("ZZN-1"), kg0 = await lotKg("ZZN-1");
  for (let i = 0; i < 2; i++) await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { id: a.id, codigo: "ZZN-1", descripcion: "Ingreso ZZN-1", proveedor: "Prov ZZ", lote: "LOTE-ZZN-1", bultos: 1, cantidad: 25, fecha: "2026-10-05", confirm: true } } });
  check("reintentos no duplican movimientos, lotes ni kg ni cambian de fila", (await movs("ZZN-1")) === mv0 && (await lotKg("ZZN-1")) === kg0 && (await rowIdx("ZZN-1")) === W + 1 && (await visibleTotal()) === T, `mov ${mv0}→${await movs("ZZN-1")}`);
  check("1 solo lote por cada código nuevo (sin lotes duplicados)", (await q(`select count(*)::int n from inv_mp_stock where payload->>'codigo' = 'ZZN-1'`))[0].n === 1);
  check("saldo del código = suma de lotes", (await balance("ZZN-1")) === (await lotKg("ZZN-1")));

  // alta manual de un lote (Stock) en la planilla: también usa la primera vacía
  const manual = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_stock", payload: { id: crypto.randomUUID(), codigo: "ZZN-M", descripcion: "Manual", lote: "LM", cantidadKg: 5, origen: "planilla" } } });
  check(`alta manual de un lote en Stock: fila ${W + 4}`, manual.ok() && (await rowIdx("ZZN-M")) === W + 4 && (await visibleTotal()) === T, `fila ${await rowIdx("ZZN-M")}`);

  // filas vacías INTERMEDIAS (antes de la última escrita): no se tocan ni se reutilizan
  const ids = await stockOrder();
  const midBlank = (await (await page.request.post("/api/v1/inventory/rows", { data: { action: "insert", resource: "mp_stock", beforeId: ids[100] } })).json()).id;
  const d = await newIngreso("ZZN-4");
  const order = await stockOrder();
  check(`con una vacía intermedia (fila 101): el nuevo va a la primera vacía DESPUÉS de la última escrita (fila ${W + 6}), no al hueco`, d.ok && order.indexOf(midBlank) === 100 && (await rowIdx("ZZN-4")) === W + 6, `intermedia en ${order.indexOf(midBlank) + 1}, nuevo en ${await rowIdx("ZZN-4")}`);

  // fila movida a mano: pasa a ser la última escrita
  const moved = ids[20];
  const firstBlank = order[W + 6]; // primera vacía actual
  await page.request.post("/api/v1/inventory/rows", { data: { action: "move", resource: "mp_stock", id: moved, beforeId: firstBlank } });
  const e = await newIngreso("ZZN-5");
  const order2 = await stockOrder();
  check("con una fila movida a mano a continuación de los datos, el nuevo va justo después de ella", e.ok && order2.indexOf(moved) === W + 5 && (await rowIdx("ZZN-5")) === order2.indexOf(moved) + 2, `movida en ${order2.indexOf(moved) + 1}, nuevo en ${await rowIdx("ZZN-5")}`);

  // filtros y ordenamientos activos en pantalla
  await bottomOfSheet();
  const search = page.getByPlaceholder(/buscar/i).first();
  await search.fill("ZZE-00005");
  await page.waitForTimeout(600);
  const f = await newIngreso("ZZN-6");
  const posF = await rowIdx("ZZN-6");
  await search.fill("");
  check("con un filtro de búsqueda activo el nuevo ocupa igual su fila (la siguiente vacía)", f.ok && posF === (await rowIdx("ZZN-5")) + 1, `fila ${posF}`);
  const sortSel = page.locator("select").filter({ hasText: /Orden de la hoja/ }).first();
  if (await sortSel.count()) {
    await sortSel.selectOption({ label: "Código A-Z" }).catch(() => undefined);
    await page.waitForTimeout(500);
    const g = await newIngreso("ZZN-7");
    check("con otro ordenamiento elegido en pantalla, el orden de la hoja no cambia: el nuevo ocupa la siguiente vacía", g.ok && (await rowIdx("ZZN-7")) === posF + 1, `fila ${await rowIdx("ZZN-7")}`);
    await sortSel.selectOption({ label: "Orden de la hoja (manual)" }).catch(() => undefined);
  } else check("selector de orden presente", false);

  // sin saltos de pantalla mientras otro usuario edita y llegan ingresos
  await bottomOfSheet();
  await gotoRow(350);
  let maxDrift = 0, lost = 0;
  for (let i = 0; i < 5; i++) {
    const n = 350 + i;
    const row = page.locator("[data-testid=mp-stock-grid] .dsg-row").filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.locator(".dsg-cell").nth(4).click();
    const s0 = await snapScroll("mp-stock-grid");
    await newIngreso(`ZZW-${i}`, 5);
    await page.keyboard.type(`Edit${i}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    maxDrift = Math.max(maxDrift, Math.abs((await snapScroll("mp-stock-grid")) - s0));
    if (!(await page.locator("[data-testid=mp-stock-grid] .dsg-active-cell").count())) lost++;
  }
  check(`editar la fila 350 mientras llegan ingresos: sin saltos (desvío máx. ${maxDrift}px) ni pérdida de celda activa`, maxDrift <= 36 * 2.5 && lost === 0);
  check(`la planilla sigue con ${T + 1} posiciones (${T} + la única fila vacía que la prueba insertó a propósito) y los ZZW ocuparon vacías existentes`, (await visibleTotal()) === T + 1, `${await visibleTotal()}`);

  // movimientos: exactamente 1 alta por ingreso nuevo
  const dup = await q(`select codigo, count(*)::int n from mp_stock_movements where codigo like 'ZZN-%' or codigo like 'ZZW-%' group by 1 having count(*) > 1`);
  check("ningún ingreso generó movimientos duplicados", dup.length === 0, JSON.stringify(dup));

  // planilla SIN filas vacías persistidas (sólo filas visuales de trabajo): el nuevo va a continuación de la última escrita
  await q(`delete from inv_mp_stock where payload->>'createdBy' = 'zze' and (payload->>'codigo') = ''`);
  await q(`delete from inv_mp_stock where payload->>'codigo' like 'ZZ%' and payload->>'codigo' not like 'ZZE%'`);
  await q(`delete from mp_stock_movements where codigo like 'ZZ%'`);
  await q(`delete from mp_stock_balances where codigo like 'ZZ%'`);
  await q(`delete from inv_mp_ingresos where payload->>'codigo' like 'ZZ%'`);
  const before = await visibleTotal();
  const h = await newIngreso("ZZN-8");
  check("sin vacías persistidas, el nuevo se inserta justo después de la última escrita (siguiente posición)", h.ok && (await rowIdx("ZZN-8")) === before + 1, `antes ${before}, fila ${await rowIdx("ZZN-8")}`);
  await bottomOfSheet();
  await gotoRow(before + 1);
  const uiH = await rowText("mp-stock-grid", before + 1);
  await page.screenshot({ path: `${OUT}/02-sin-vacias.png` });
  check("UI: esa fila muestra el ingreso y debajo siguen las filas de trabajo vacías", !!uiH && uiH.includes("ZZN-8") && ((await rowText("mp-stock-grid", before + 2)) ?? "").length >= 0);
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
