// E2E focalizado (Chromium real, base DESCARTABLE): borrado de Ingresos MP CONFIRMADOS con teclado y botón, y botón táctil «Borrar»
// en tablet (Stock MP y Depósito), verificando persistencia e integridad del inventario (movimientos, saldos, lotes).
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
const OUT = process.env.OUT ?? "/tmp/mp-borrado-critico";
const N = Number(process.env.FILAS ?? 1423);
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
let page = await ctx.newPage();
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
  await q(`delete from inv_mp_stock where payload->>'codigo' like 'INT-MP-%' and payload->>'createdBy' <> 'zze'`).catch(() => undefined);
  await q(`delete from inv_mp_stock where payload->>'createdBy' = 'zze' or payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from inv_mp_ingresos where payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_movements where codigo like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_balances where codigo like 'ZZ%'`).catch(() => undefined);
}
async function seedStock(n) {
  await q(`insert into inv_mp_stock (id, payload, updated_at) select md5('zze-stock-' || g.n)::uuid, jsonb_build_object('id', md5('zze-stock-' || g.n)::uuid::text, 'codigo','ZZE-' || lpad(g.n::text,5,'0'),'descripcion','Materia ZZE ' || g.n,'proveedor','Prov','cliente','','producto','','lote','L' || g.n,'cantidadKg',10,'ubicacion','U1','vencimiento','2028-01-31','estadoStock','Stock OK','origen','manual','archived',false,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}'), now() from (select n from generate_series(1, ${n}) n) g`);
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
const balance = async (code) => Number((await q(`select stock_actual from mp_stock_balances where codigo = upper($1)`, [code]))[0]?.stock_actual ?? 0);
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


const GID = "mp-ingresos-grid";
const colOf = async (gid, title) => page.evaluate(({ gid, title }) => {
  for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) if (h.textContent.trim().toLowerCase() === title.toLowerCase()) return Number(/genus-col-(\d+)/.exec(h.className)?.[1]);
  return null;
}, { gid, title });
const rowN = async (id) => (await apiList("mp_ingresos")).filter((r) => r.status !== "ANULADO").findIndex((r) => r.id === id) + 1;
async function cellIn(gid, n, title) {
  const rowLoc = () => page.locator(`[data-testid=${gid}] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
  for (const dx of [0, 6000, -6000, 600]) {
    if (dx) { const b = await page.locator(`[data-testid=${gid}] .dsg-container`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(dx, 0); await page.waitForTimeout(350); }
    const c = await colOf(gid, title);
    if (c !== null && (await rowLoc().locator(`.genus-col-${c}`).count())) return rowLoc().locator(`.genus-col-${c}`).first();
  }
  throw new Error(`celda ${title} fila ${n} no encontrada`);
}
const valIn = async (gid, n, title) => { const c = await cellIn(gid, n, title); return c.evaluate((e) => (e.querySelector("input")?.value ?? e.textContent ?? "").trim()); };
const settledG = (gid) => waitDb(async () => ["saved", "idle"].includes(await page.locator(`[data-testid=${gid}-status]`).getAttribute("data-state")), 30_000);
const ingreso = async (id) => (await q(`select payload from inv_mp_ingresos where id = $1::uuid`, [id]))[0]?.payload;
const lotsOf = async (code) => (await q(`select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0) s from inv_mp_stock where payload->>'codigo' = $1 and coalesce(payload->>'archived','false') <> 'true'`, [code]))[0];
async function openMp(label, gid) {
  await page.goto("/mi-trabajo");
  await nav(label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForFunction((g) => document.querySelectorAll(`[data-testid=${g}] .dsg-row`).length > 3, gid, { timeout: 120_000 });
  await page.waitForTimeout(1200);
}
try {
  await cleanup();
  const A = [];
  for (let i = 1; i <= 6; i++) A.push(await newIngreso(`ZZC-${i}`, 10));
  check("6 ingresos confirmados creados (10 kg c/u, stock sumado)", A.every((a) => a.ok) && (await balance("ZZC-1")) === 10);
  await openMp("Ingresos MP", GID);

  // A) Backspace en CANTIDAD de un ingreso CONFIRMADO
  const m0 = await movs("ZZC-1");
  let n = await rowN(A[0].id);
  await (await cellIn(GID, n, "Cantidad")).click();
  await page.keyboard.press("Backspace");
  await settledG(GID);
  await page.waitForTimeout(800);
  let ing = await ingreso(A[0].id);
  check("Backspace en CANTIDAD de un ingreso confirmado: se vacía, sin motivo ni diálogo, y queda como borrador", (await valIn(GID, n, "Cantidad")) === "" && (ing.cantidad == null || ing.cantidad === 0) && ing.status === "BORRADOR" && (await page.locator("[role=dialog]").count()) === 0, `status=${ing.status} cantidad=${ing.cantidad}`);
  check("su stock se revirtió UNA vez (lote 0, saldo 0, +1 movimiento) y no quedan lotes duplicados", (await lotKg("ZZC-1")) === 0 && (await balance("ZZC-1")) === 0 && (await movs("ZZC-1")) === m0 + 1 && (await lotsOf("ZZC-1")).n === 1, `mov ${m0}→${await movs("ZZC-1")}`);
  // Deshacer (justo después del primer Backspace)
  await page.keyboard.press("Control+z");
  await settledG(GID);
  await page.waitForTimeout(1200);
  ing = await ingreso(A[0].id);
  check("Deshacer (Ctrl+Z) reconfirma el ingreso y devuelve el stock una sola vez (sin lotes duplicados)", ing.status === "CONFIRMADO" && (await lotKg("ZZC-1")) === 10 && (await balance("ZZC-1")) === 10 && (await lotsOf("ZZC-1")).n === 1, `status=${ing.status} cantidad=${ing.cantidad} previo=${ing.confirmadoPrevio} celda=${await valIn(GID, n, "Cantidad")} lote=${await lotKg("ZZC-1")} saldo=${await balance("ZZC-1")} movs=${await movs("ZZC-1")}`);

  await (await cellIn(GID, n, "Cantidad")).click();
  await page.keyboard.press("Backspace");
  await settledG(GID);
  await page.waitForTimeout(800);
  const mStable = await movs("ZZC-1");
  await (await cellIn(GID, n, "Cantidad")).click();
  await page.keyboard.press("Backspace");
  await settledG(GID);
  await page.waitForTimeout(600);
  check("repetir Backspace sobre la celda ya vacía no vuelve a mover stock (idempotente)", (await movs("ZZC-1")) === mStable && (await lotKg("ZZC-1")) === 0, `mov ${mStable}→${await movs("ZZC-1")}`);
  if (process.env.ONLY_UNDO) throw new Error('ONLY_UNDO_DONE');
  // B) Backspace en CÓDIGO (confirmado)
  n = await rowN(A[1].id);
  await (await cellIn(GID, n, "Código")).click();
  await page.keyboard.press("Backspace");
  await settledG(GID);
  await page.waitForTimeout(900);
  check("Backspace en CÓDIGO: la celda queda vacía y persiste", (await valIn(GID, n, "Código")) === "" && (await page.locator("[role=dialog]").count()) === 0);

  // C) vaciar la fila completa de un ingreso confirmado (rango primera..última columna)
  n = await rowN(A[2].id);
  const titles = ["Fecha", "Cantidad"];
  await (await cellIn(GID, n, "Fecha")).click();
  await (await cellIn(GID, n, "Cantidad")).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Backspace");
  await settledG(GID);
  await page.waitForTimeout(1000);
  const rowVals = [];
  for (const t of ["Fecha", "Ingreso", "Proveedor", "Remito", "Código", "Descripción", "Bultos", "Cantidad"]) rowVals.push([t, await valIn(GID, n, t)]);
  const notEmpty = rowVals.filter(([, v]) => v !== "" && v !== "0").map(([t]) => t);
  check("vaciar una fila completa de un ingreso confirmado (Backspace sobre el rango): todas las celdas quedan vacías", notEmpty.length === 0, notEmpty.join(","));
  check("y su stock se revirtió una sola vez", (await lotKg("ZZC-3")) === 0 && (await balance("ZZC-3")) === 0, `lote ${await lotKg("ZZC-3")} saldo ${await balance("ZZC-3")}`);

  // D) ELIMINAR filas (botón) de ingresos confirmados: una y varias
  n = await rowN(A[3].id);
  await (await cellIn(GID, n, "Proveedor")).click();
  await page.locator(`[data-testid=${GID}-delete-rows]`).click();
  await waitDb(async () => (await ingreso(A[3].id)).status === "ANULADO");
  check("eliminar un ingreso confirmado (botón Eliminar): sin motivo ni diálogo; queda ANULADO y su stock se revierte una vez", (await ingreso(A[3].id)).status === "ANULADO" && (await lotKg("ZZC-4")) === 0 && (await balance("ZZC-4")) === 0 && (await page.locator("[role=dialog]").count()) === 0);
  const n5 = await rowN(A[4].id), n6 = await rowN(A[5].id);
  await (await cellIn(GID, n5, "Proveedor")).click();
  await (await cellIn(GID, n6, "Proveedor")).click({ modifiers: ["Shift"] });
  await page.locator(`[data-testid=${GID}-delete-rows]`).click();
  await waitDb(async () => (await ingreso(A[4].id)).status === "ANULADO" && (await ingreso(A[5].id)).status === "ANULADO");
  check("eliminar varios ingresos confirmados seleccionados a la vez", (await ingreso(A[4].id)).status === "ANULADO" && (await ingreso(A[5].id)).status === "ANULADO" && (await balance("ZZC-5")) === 0 && (await balance("ZZC-6")) === 0);
  // reintento de la eliminación
  const mv4 = await movs("ZZC-4");
  await page.request.post("/api/v1/inventory", { data: { action: "anular", resource: "mp_ingresos", id: A[3].id } });
  check("reintentar la eliminación no duplica la reversión", (await movs("ZZC-4")) === mv4);

  // persistencia tras recargar
  await openMp("Ingresos MP", GID);
  const list = await apiList("mp_ingresos");
  const vis = list.filter((r) => r.status !== "ANULADO").map((r) => r.codigo);
  const txt = await page.locator(`[data-testid=${GID}]`).innerText();
  check("tras recargar: los eliminados no aparecen y los cambios persisten", !txt.includes("Ingreso ZZC-4") && !txt.includes("Ingreso ZZC-5") && !txt.includes("Ingreso ZZC-6") && vis.length >= 3);
  await page.screenshot({ path: `${OUT}/01-ingresos-tras-recarga.png` });

  // E) integridad global: saldo = suma de lotes por código; movimientos no duplicados
  const codes = (await q(`select distinct payload->>'codigo' c from inv_mp_stock where payload->>'codigo' like 'ZZC-%' or payload->>'codigo' like 'INT-MP-%'`)).map((r) => r.c);
  const allCodes = [...new Set([...codes, ...["ZZC-1", "ZZC-2", "ZZC-3", "ZZC-4", "ZZC-5", "ZZC-6"]])];
  let bad = [];
  for (const c of allCodes) {
    const lots = await lotsOf(c);
    if (Number(lots.s) !== (await balance(c))) bad.push(`${c}: lotes ${lots.s} vs saldo ${await balance(c)}`);
  }
  check(`inventario coherente: saldo por código = suma de lotes en ${allCodes.length} códigos`, bad.length === 0, bad.join(" ; "));
  check("los movimientos del libro tienen clave de idempotencia única (un reintento no puede duplicar)", (await q(`select count(*)::int n from (select idempotency_key from mp_stock_movements where codigo like 'ZZC-%' and idempotency_key is not null group by 1 having count(*) > 1) t`))[0].n === 0);

  // ===== TABLET: botón táctil «Borrar» =====
  const tctx = await browser.newContext({ baseURL: BASE, ...TIPS.tablet });
  const tpage = await tctx.newPage();
  const keep = page;
  page = tpage;
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.materiaPrima.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await openMp("Stock", "mp-stock-grid");
  const stockRows = await apiList("mp_stock");
  const target = stockRows.find((r) => r.codigo === "ZZC-2" || r.proveedor === "Prov ZZ");
  const sIdx = stockRows.filter((r) => !r.archived).findIndex((r) => r.id === target.id) + 1;
  const sCell = await cellIn("mp-stock-grid", sIdx, "Proveedor");
  await sCell.tap().catch(async () => sCell.click());
  const bar = page.locator("[data-testid=mp-stock-grid-touch-clear]");
  check("tablet: la barra táctil muestra el botón «Borrar»", await bar.isVisible().catch(() => false));
  await bar.tap().catch(async () => bar.click());
  await settledG("mp-stock-grid");
  await page.waitForTimeout(900);
  check("tablet: «Borrar» vacía la celda seleccionada (Stock MP) y persiste en la base", (await valIn("mp-stock-grid", sIdx, "Proveedor")) === "" && String((await q(`select payload->>'proveedor' p from inv_mp_stock where id = $1::uuid`, [target.id]))[0].p ?? "") === "");
  // rango de celdas con el botón
  await (await cellIn("mp-stock-grid", sIdx, "Descripción")).tap().catch(async () => (await cellIn("mp-stock-grid", sIdx, "Descripción")).click());
  await (await cellIn("mp-stock-grid", sIdx, "Lote")).click({ modifiers: ["Shift"] }).catch(() => undefined);
  await bar.tap().catch(async () => bar.click());
  await settledG("mp-stock-grid");
  await page.waitForTimeout(900);
  const stockAfter = (await q(`select payload from inv_mp_stock where id = $1::uuid`, [target.id]))[0].payload;
  check("tablet: «Borrar» con varias celdas seleccionadas las vacía (descripción…lote) sin tocar el saldo del código", (stockAfter.descripcion ?? "") === "" && (stockAfter.lote ?? "") === "");
  await openMp("Stock", "mp-stock-grid");
  check("tablet: tras recargar el borrado persiste", (await valIn("mp-stock-grid", sIdx, "Proveedor")) === "");
  await page.screenshot({ path: `${OUT}/02-tablet-borrar.png` });
  page = keep;
  await tctx.close();

  // ===== DEPÓSITO ME (tablet): botón Borrar =====
  const dctx = await browser.newContext({ baseURL: BASE, ...TIPS.tablet });
  page = await dctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.deposito.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  const mat = crypto.randomUUID();
  await q(`insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, jsonb_build_object('id', $1::text,'codigo','ZZC-ME','descripcion','Material ZZC','cliente','','ubicacion','A1','unidad','u','cantidadPorBulto',null,'stockActual',10,'stockMinimo',null,'puntoReposicion',null,'responsable','','observacion','','archived',false,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}'), now())`, [mat]);
  const ing1 = crypto.randomUUID();
  await q(`insert into inv_me_ingresos (id, payload, updated_at) values ($1::uuid, jsonb_build_object('id', $1::text,'fecha','2026-10-01','ingresoNro','ZZC-EI-1','proveedor','Prov ZZ','cliente','Cli ZZ','remitoNro','R1','codigo','ZZC-ME','descripcionInsumo','Ingreso ME ZZC','bultos',1,'cantidad',10,'total',10,'ubicacion','A1','materialId',$2::text,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}'), now())`, [ing1, mat]);
  await openMp("Ingresos ME", "me-ingresos-grid");
  const meRows = await apiList("me_ingresos");
  const meIdx = meRows.filter((r) => !r.anulado).findIndex((r) => r.id === ing1) + 1;
  const meCell = await cellIn("me-ingresos-grid", meIdx, "PROVEEDOR");
  await meCell.tap().catch(async () => meCell.click());
  const meBar = page.locator("[data-testid=me-ingresos-grid-touch-clear]");
  check("tablet (Depósito · Ingresos ME): la barra táctil muestra «Borrar»", await meBar.isVisible().catch(() => false));
  await meBar.tap().catch(async () => meBar.click());
  await settledG("me-ingresos-grid");
  await page.waitForTimeout(900);
  check("tablet (Ingresos ME): «Borrar» vacía la celda y persiste", (await valIn("me-ingresos-grid", meIdx, "PROVEEDOR")) === "" && String((await q(`select payload->>'proveedor' p from inv_me_ingresos where id = $1::uuid`, [ing1]))[0].p ?? "") === "");
  const cantCell = await cellIn("me-ingresos-grid", meIdx, "CANTIDAD");
  await cantCell.tap().catch(async () => cantCell.click());
  await meBar.tap().catch(async () => meBar.click());
  await settledG("me-ingresos-grid");
  await page.waitForTimeout(900);
  const meIng = (await q(`select payload from inv_me_ingresos where id = $1::uuid`, [ing1]))[0].payload;
  check("tablet (Ingresos ME): «Borrar» en CANTIDAD la vacía sin motivo ni diálogo (el stock del material se recalcula solo)", (meIng.cantidad == null || meIng.cantidad === 0) && (await page.locator("[role=dialog]").count()) === 0, JSON.stringify(meIng.cantidad));
  await dctx.close();
} catch (err) {
  if (String(err?.message).includes('ONLY_UNDO_DONE')) { console.log('(solo Deshacer)'); } else {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message.split("\n")[0] : String(err)); }
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await q(`delete from inv_me_ingresos where payload->>'codigo' = 'ZZC-ME'`).catch(() => undefined);
  await q(`delete from inv_me_materials where payload->>'codigo' = 'ZZC-ME'`).catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
