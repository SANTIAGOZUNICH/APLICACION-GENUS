// E2E (Chromium real, base DESCARTABLE): las planillas de MP y Depósito se usan como Excel y NUNCA saltan mientras se escribe.
// Mide, antes/después de cada guardado automático: posición de scroll (X/Y), celda activa y identidad de la fila.
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
const OUT = process.env.OUT ?? "/tmp/planillas-borrado";
const ONLY = (process.env.PLANILLAS ?? "stock,ingmp,ingme,salme,invme").split(",");
const NROWS = Number(process.env.FILAS_BORRADO ?? 60);
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const TIPS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1.5 },
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const NB = Number(process.env.FILAS ?? 1450);
const TAG = "ZZE";
const NOWISO = "2026-10-01T00:00:00.000Z";
const PAYBASE = `'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}'`;
const uid = (k) => `md5('zze-${k}-' || g.n)::uuid`;

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos", "inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'createdBy' = 'zze' or payload::text like '%ZZC-%'`).catch(() => undefined);
  await q(`delete from mp_stock_movements where codigo like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_balances where codigo like 'ZZ%'`).catch(() => undefined);
}
async function seedSql(table, kind, n, payloadSql) {
  await q(`insert into ${table} (id, payload, updated_at) select ${uid(kind)}, jsonb_build_object('id', ${uid(kind)}::text, ${payloadSql}, ${PAYBASE}), now() from (select n from generate_series(1, ${n}) n) g`);
}
const pad = (n) => String(n).padStart(5, "0");

/** Cada planilla: dónde está, cómo se identifica una fila, qué columnas se editan y dónde queda guardado cada dato. */
const SHEETS = {
  stock: {
    label: "Stock MP", user: "materiaPrima", nav: "Stock", gid: "mp-stock-grid", table: "inv_mp_stock", rows: NB,
    idCol: "código", idField: "codigo", code: (n) => `ZZE-${pad(n)}`,
    seed: (n) => seedSql("inv_mp_stock", "stock", n, `'codigo','ZZE-' || lpad(g.n::text,5,'0'),'descripcion','Materia ZZE ' || g.n,'proveedor','Prov ' || g.n,'cliente','','producto','','lote','L' || g.n,'cantidadKg',10,'ubicacion','U' || (g.n % 40),'vencimiento','2028-01-31','estadoStock','Stock OK','origen','manual','archived',false`),
    text: [["proveedor", "proveedor"], ["cliente", "cliente"], ["descripción", "descripcion"], ["ubicación", "ubicacion"], ["producto", "producto"]],
    qty: { col: "kg lote", field: "cantidadKg", value: "77", expect: 77 }, lot: { col: "lote", field: "lote" },
  },
  ingmp: {
    label: "Ingresos MP", user: "materiaPrima", nav: "Ingresos MP", gid: "mp-ingresos-grid", table: "inv_mp_ingresos", rows: Number(process.env.FILAS_ING ?? 700),
    idCol: "ingreso", idField: "ingresoNro", code: (n) => `ZZE-I-${pad(n)}`,
    seed: (n) => seedSql("inv_mp_ingresos", "ingmp", n, `'fecha','2026-10-01','ingresoNro','ZZE-I-' || lpad(g.n::text,5,'0'),'proveedor','Prov ' || g.n,'cliente','','remitoNro','R' || g.n,'codigo','ZZE-I' || g.n,'producto','','descripcion','Ingreso ZZE ' || g.n,'bultos',1,'cantidad',5,'total',5,'ubicacion','U1','lote','LI' || g.n,'vencimiento','2028-01-31','stockLotId',null,'status','BORRADOR','stockImpacted',false`),
    text: [["proveedor", "proveedor"], ["cliente", "cliente"], ["remito", "remitoNro"], ["producto", "producto"], ["descripción", "descripcion"]],
    qty: { col: "cantidad", field: "cantidad", value: "12", expect: 12 },
  },
  ingme: {
    label: "Ingresos ME", user: "deposito", nav: "Ingresos ME", gid: "me-ingresos-grid", table: "inv_me_ingresos", rows: Number(process.env.FILAS_ME ?? 600),
    idCol: "ingreso nº", idField: "ingresoNro", code: (n) => `ZZE-EI-${pad(n)}`,
    seed: async (n) => {
      await seedSql("inv_me_materials", "mat", n, `'codigo','ZZE-M-' || lpad(g.n::text,5,'0'),'descripcion','Material ZZE ' || g.n,'cliente','','ubicacion','A' || (g.n % 30),'unidad','u','cantidadPorBulto',null,'stockActual',10,'stockMinimo',null,'puntoReposicion',null,'responsable','','observacion','','archived',false`);
      await seedSql("inv_me_ingresos", "ing", n, `'fecha','2026-10-01','ingresoNro','ZZE-EI-' || lpad(g.n::text,5,'0'),'proveedor','Prov ' || g.n,'cliente','','remitoNro','R' || g.n,'codigo','ZZE-M-' || lpad(g.n::text,5,'0'),'descripcionInsumo','Ingreso ME ZZE ' || g.n,'bultos',1,'cantidad',10,'total',10,'ubicacion','A1','materialId',${uid("mat")}::text`);
    },
    text: [["proveedor", "proveedor"], ["cliente", "cliente"], ["remito nº", "remitoNro"], ["descripción insumo", "descripcionInsumo"], ["proveedor", "proveedor"]],
    qty: { col: "cantidad", field: "cantidad", value: "15", expect: 15 },
  },
  salme: {
    label: "Salidas ME", user: "deposito", nav: "Salidas ME", gid: "me-salidas-grid", table: "inv_me_salidas", rows: Number(process.env.FILAS_ME ?? 600),
    idCol: "egreso n.º", idField: "egresoNro", code: (n) => `ZZE-S-${pad(n)}`,
    seed: async (n) => {
      await seedSql("inv_me_salidas", "sal", n, `'fecha','2026-10-02','egresoNro','ZZE-S-' || lpad(g.n::text,5,'0'),'cliente','Cli ' || g.n,'remitoNro','','descripcion','Salida ME ZZE ' || g.n,'bultos',null,'cantidad',null,'total',null,'control',false,'entregado',false,'comentarios','','materialId',${uid("mat")}::text,'codigo','ZZE-M-' || lpad(g.n::text,5,'0'),'unidad','u','origen','MANUAL','descuentaStock',false,'motivoSalida',null,'oaId',null,'oaNumber',null,'oaVersion',null,'materialLineId',null,'idempotencyKey',null,'reverted',false,'revertedAt',null,'revertReason',null`);
    },
    text: [["cliente", "cliente"], ["descripción", "descripcion"], ["remito n.º", "remitoNro"], ["cliente", "cliente"], ["descripción", "descripcion"]],
    qty: { col: "cantidad", field: "cantidad", value: "3", expect: 3 },
  },
  invme: {
    label: "Inventario ME", user: "deposito", nav: "Inventario ME", gid: "me-inventario-grid", table: "inv_me_materials", rows: Number(process.env.FILAS_INV ?? 400),
    idCol: "código", idField: "codigo", code: (n) => `ZZE-M-${pad(n)}`,
    seed: (n) => seedSql("inv_me_materials", "mat", n, `'codigo','ZZE-M-' || lpad(g.n::text,5,'0'),'descripcion','Material ZZE ' || g.n,'cliente','','ubicacion','A' || (g.n % 30),'unidad','u','cantidadPorBulto',null,'stockActual',0,'stockMinimo',null,'puntoReposicion',null,'responsable','','observacion','','archived',false`),
    text: [["cliente", "cliente"], ["insumo", "descripcion"], ["ubicación", "ubicacion"], ["cliente", "cliente"], ["insumo", "descripcion"]],
    qty: null,
  },
};

const dbRow = async (sh, code) => (await q(`select payload from ${sh.table} where payload->>'${sh.idField}' = $1`, [code]))[0]?.payload;
const status = (page, gid) => page.locator(`[data-testid=${gid}-status]`).getAttribute("data-state");
const settled = (page, gid) => waitDb(async () => ["saved", "idle"].includes(await status(page, gid)), 40_000);
const headerMap = (page, gid) => page.evaluate((gid) => {
  const out = {};
  for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) {
    const m = /genus-col-(\d+)/.exec(h.className);
    if (m) out[h.textContent.trim().toLowerCase()] = Number(m[1]);
  }
  return out;
}, gid);

/**
 * La identidad de una fila se lee de su NÚMERO de fila (gutter «#»), que siempre está renderizado: la columna
 * identidad puede quedar fuera de pantalla (virtualización horizontal) cuando se trabaja en columnas de la derecha.
 * En las hojas sembradas, la fila n es la n-ésima: el orden es estable mientras el número coincide con el código.
 */
const numOf = (code) => Number(String(code).slice(-5));
/** Estado observable: scroll X/Y y la fila de la celda activa (por su número de fila). */
async function snap(page, sh) {
  return page.evaluate(({ gid }) => {
    const root = document.querySelector(`[data-testid=${gid}]`);
    const sc = root.querySelector(".dsg-container");
    const rows = [...root.querySelectorAll(".dsg-row")].slice(1);
    const numberOf = (row) => Number((row?.querySelector(".dsg-cell-gutter")?.textContent ?? "").trim());
    const act = root.querySelector(".dsg-active-cell");
    let activeNum = null;
    if (act) {
      const r = act.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const hit = rows.find((row) => { const b = row.getBoundingClientRect(); return y >= b.top && y <= b.bottom; });
      activeNum = hit ? numberOf(hit) : null;
    }
    return { top: Math.round(sc.scrollTop), left: Math.round(sc.scrollLeft), hasActive: Boolean(act), activeNum };
  }, { gid: sh.gid });
}
/** Posición absoluta (px desde el inicio de la hoja) de la fila n: cambia solo si la fila se movió. */
async function rowY(page, sh, _map, code) {
  const n = numOf(code);
  return page.evaluate(({ gid, n }) => {
    const root = document.querySelector(`[data-testid=${gid}]`);
    const sc = root.querySelector(".dsg-container");
    for (const row of [...root.querySelectorAll(".dsg-row")].slice(1)) {
      if (Number((row.querySelector(".dsg-cell-gutter")?.textContent ?? "").trim()) === n) return Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    }
    return null;
  }, { gid: sh.gid, n });
}
const rowLoc = (page, sh, _map, code) => page.locator(`[data-testid=${sh.gid}] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${numOf(code)}$`) }) }).first();
const rowLocN = (page, sh, n) => page.locator(`[data-testid=${sh.gid}] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
const cellOf = (row, map, title) => row.locator(`.genus-col-${map[title]}`).first();
async function wheelTo(page, sh, y) {
  const b = await page.locator(`[data-testid=${sh.gid}] .dsg-container`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, y);
  await page.waitForTimeout(600);
}
async function apiOrder(page, resource) {
  const res = await page.request.get(`/api/v1/inventory?resource=${resource}`, { timeout: 120_000 });
  return ((await res.json()).data ?? []).filter((r) => r.status !== "ANULADO").map((r) => r.id ?? r.materialId);
}
const RESOURCE = { stock: "mp_stock", ingmp: "mp_ingresos", ingme: "me_ingresos", salme: "me_salidas", invme: "me_inventario" };


const SHEET_GIDS = { stock: "mp-stock-grid", ingmp: "mp-ingresos-grid", ingme: "me-ingresos-grid", salme: "me-salidas-grid", invme: "me-inventario-grid" };

/** Texto visible de cada celda de datos de una fila (por número de fila), en el orden de las columnas. */
const cellsOf = (page, gid, n) => page.evaluate(({ gid, n }) => {
  const root = document.querySelector(`[data-testid=${gid}]`);
  for (const row of [...root.querySelectorAll(".dsg-row")].slice(1)) {
    if (Number((row.querySelector(".dsg-cell-gutter")?.textContent ?? "").trim()) === n) {
      return [...row.querySelectorAll(".dsg-cell")].map((c) => ({ cls: c.className, v: (c.querySelector("input")?.value ?? c.textContent ?? "").trim(), disabled: c.classList.contains("dsg-cell-disabled") }));
    }
  }
  return null;
}, { gid, n });
const headers = (page, gid) => page.evaluate((gid) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)].map((h) => ({ cls: h.className, t: h.textContent.trim() })), gid);

async function openSheet(page, sh) {
  await page.goto("/mi-trabajo");
  await nav(page, sh.nav);
  await page.locator(`[data-testid=${sh.gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForFunction((gid) => document.querySelectorAll(`[data-testid=${gid}] .dsg-row`).length > 5, sh.gid, { timeout: 180_000 });
  await page.waitForTimeout(1500);
}

async function runSheet(key, kind) {
  const sh = SHEETS[key];
  const tag = `${sh.label} · ${kind}`;
  const u = await openAs(E2E_USERS[sh.user], kind);
  const page = u.page;
  await cleanup();
  const rows = NROWS;
  sh.rows = rows;
  if (key === "ingmp") {
    for (let i = 1; i <= rows; i++) {
      const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { id: crypto.randomUUID(), ingresoNro: `ZZE-I-${pad(i)}`, codigo: `ZZE-I${i}`, descripcion: `Ingreso ZZE ${i}`, proveedor: `Prov ${i}`, cliente: "Cli", remitoNro: `R${i}`, producto: "Prod", bultos: 1, cantidad: 5, ubicacion: "U1", lote: `LI${i}`, vencimiento: "2028-01-31", fecha: "2026-10-01", confirm: true } } });
      if (!r.ok()) throw new Error(`no se pudo crear el ingreso confirmado ${i}: ${r.status()}`);
    }
    await q(`update inv_mp_ingresos set payload = jsonb_set(payload, '{createdBy}', '"zze"') where payload->>'codigo' like 'ZZE-I%'`);
  } else await sh.seed(rows);
  await openSheet(page, sh);
  const hdr = await headers(page, sh.gid);
  const dataCols = hdr.map((h, i) => ({ ...h, i })).filter((h) => h.t && !/^#$/.test(h.t) && !/acciones|fotos?|adjuntos?/i.test(h.t));
  console.log(`  ${tag}: columnas = ${dataCols.map((h) => h.t).join(" | ")}`);
  const colIdx = (h) => Number(/genus-col-(\d+)/.exec(h.cls)?.[1]);
  const notice = () => page.locator(`[data-testid=${sh.gid}-notice]`).innerText().catch(() => "");
  const dialogs = () => page.locator("[role=dialog]").count();
  const rowByN = (n) => page.locator(`[data-testid=${sh.gid}] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
  const rowH = await page.evaluate((gid) => document.querySelector(`[data-testid=${gid}] .dsg-row:not(:first-child)`).getBoundingClientRect().height, sh.gid);
  // Las columnas se virtualizan horizontalmente: se busca la celda desplazando a la izquierda/derecha según haga falta.
  const cellAt = async (rowN, col) => {
    const loc = () => rowByN(rowN).locator(`.genus-col-${colIdx(col)}`).first();
    {
      const top = await page.evaluate((gid) => document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollTop, sh.gid);
      const want = (rowN - 4) * rowH;
      if (!(await rowByN(rowN).count()) || Math.abs(want - top) > rowH * 9) { await wheelTo(page, sh, want - top); }
    }
    for (const dx of [0, -6000, 6000, -6000, 400]) {
      if (dx) { const b = await page.locator(`[data-testid=${sh.gid}] .dsg-container`).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(dx, 0); await page.waitForTimeout(350); }
      if (await loc().count()) return loc();
    }
    return loc();
  };
  const valAt = async (rowN, col) => { await cellAt(rowN, col); return (await cellsOf(page, sh.gid, rowN))?.find((z) => z.cls.includes(`genus-col-${colIdx(col)}`))?.v; };
  const isQtyCol = (t) => /^(kg lote|cantidad total|bultos|total|cantidad)$/i.test(t);
  const emptyish = (col, v) => (v ?? "") === "" || (isQtyCol(col.t) && v === "0");
  const topNow = async () => (await snap(page, sh)).top;

  // ---- 1) Backspace en CADA columna, una fila distinta por columna; luego Delete en otras ----
  const results1 = [];
  for (const mode of ["Backspace", "Delete"]) {
    for (let c = 0; c < dataCols.length; c++) {
      const col = dataCols[c];
      const n = 3 + c + (mode === "Delete" ? 0 : 0); // fila n (1-based); se repite con otra tecla en otra pasada
      if (mode === "Delete" && c >= 0) { /* misma fila que Backspace ya vaciada: se usa la fila siguiente */ }
      const rowN = mode === "Backspace" ? 3 + c : 3 + dataCols.length + c;
      if (rowN > rows) continue;
      const r = rowByN(rowN);
      if (!(await r.count())) { results1.push({ mode, col: col.t, ok: false, why: "fila no visible" }); continue; }
      const cell = await cellAt(rowN, col);
      const before = (await valAt(rowN, col)) ?? "";
      await cell.click();
      const t0 = await topNow();
      await page.keyboard.press(mode);
      await settled(page, sh.gid);
      await page.waitForTimeout(500);
      const after = (await valAt(rowN, col)) ?? "?";
      const nt = await notice(), dl = await dialogs();
      const qtyCol = /^(kg lote|cantidad total|bultos|total|cantidad)$/i.test(col.t); // cantidades del libro: vaciar = 0
      const emptyOk = after === "" || (qtyCol && after === "0");
      const ok = (before === "" || emptyOk) && dl === 0 && !/motivo|obligatori|bloquead|no se puede|no editable|calculad/i.test(nt) && Math.abs((await topNow()) - t0) <= rowH * 2.5;
      const sn = ok ? null : await snap(page, sh);
      results1.push({ mode, col: col.t, ok, why: ok ? "" : `antes="${before}" después="${after}" aviso="${nt}" diálogos=${dl} activa=#${sn?.activeNum} hasActive=${sn?.hasActive}` });
    }
  }
  for (const mode of ["Backspace", "Delete"]) {
    const bad = results1.filter((x) => x.mode === mode && !x.ok);
    check(`${tag}: ${mode} vacía la celda en TODAS las columnas (${results1.filter((x) => x.mode === mode).length}), sin motivo, sin aviso, sin salto`, bad.length === 0, bad.map((b) => `[${b.col}] ${b.why}`).join(" ; "));
  }
  // persistencia tras recargar: las celdas vaciadas siguen vacías (no se restauran)
  await openSheet(page, sh);
  let restored = [];
  for (const x of results1.filter((y) => y.ok)) {
    const c = dataCols.findIndex((d) => d.t === x.col);
    const rowN = x.mode === "Backspace" ? 3 + c : 3 + dataCols.length + c;
    const v = await valAt(rowN, dataCols[c]);
    const isQty = /^(kg lote|cantidad total|bultos|total|cantidad)$/i.test(dataCols[c].t);
    if (v !== "" && v !== undefined && !(isQty && v === "0")) restored.push(`${x.col}(fila ${rowN})="${v}"`);
  }
  check(`${tag}: tras recargar, ningún dato borrado con Backspace/Delete vuelve a aparecer`, restored.length === 0, restored.slice(0, 6).join(" ; "));

  // ---- 2) diez celdas seleccionadas (rango 5 filas x 2 columnas) + Backspace ----
  {
    const c0 = dataCols[0], c1 = dataCols[Math.min(1, dataCols.length - 1)];
    const rA = rowByN(30), rB = rowByN(34);
    await (await cellAt(30, c0)).click();
    await (await cellAt(34, c1)).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Backspace");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    let nonEmpty = 0;
    for (let n = 30; n <= 34; n++) {
      for (const c of [c0, c1]) if (((await valAt(n, c)) ?? "x") !== "") nonEmpty++;
    }
    check(`${tag}: seleccionar 10 celdas y presionar Backspace las vacía todas`, nonEmpty === 0 && (await dialogs()) === 0, `${nonEmpty} con contenido; aviso="${await notice()}"`);
    await page.keyboard.press("Control+z");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    check(`${tag}: Deshacer (Ctrl+Z) recupera el rango borrado`, ((await valAt(31, c0)) ?? "") !== "");
    await page.keyboard.press("Backspace"); // vuelve a borrar el rango (selección conservada)
    await settled(page, sh.gid);
    await page.waitForTimeout(500);
  }
  // ---- 3) vaciar una fila completa (todas las columnas de datos) con Backspace ----
  {
    const n = 40;
    const first = dataCols[0], last = dataCols[dataCols.length - 1];
    await (await cellAt(n, first)).click();
    await (await cellAt(n, last)).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Backspace");
    await settled(page, sh.gid);
    await page.waitForTimeout(800);
    const left = [];
    for (const d of dataCols) if (!emptyish(d, await valAt(n, d))) left.push(d.t);
    check(`${tag}: vaciar una fila completa con Backspace deja todas las celdas vacías (la fila queda como registro vacío)`, left.length === 0, `con contenido: ${left.join(", ")}; aviso="${await notice()}"`);
  }
  // ---- 4) varias filas completas seleccionadas + Backspace ----
  {
    const first = dataCols[0], last = dataCols[dataCols.length - 1];
    await (await cellAt(44, first)).click();
    await (await cellAt(46, last)).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await settled(page, sh.gid);
    await page.waitForTimeout(900);
    let left = 0;
    for (let n = 44; n <= 46; n++) for (const d of dataCols) if (!emptyish(d, await valAt(n, d))) left++;
    check(`${tag}: 3 filas completas seleccionadas + Delete: todo vacío`, left === 0, `${left} celdas con contenido; aviso="${await notice()}"`);
  }
  // ---- 5) botón táctil BORRAR (visible en tablet) equivale a Delete ----
  if (kind === "tablet") {
    const col = dataCols[1] ?? dataCols[0];
    { const c50 = await cellAt(50, col); await c50.tap().catch(async () => c50.click()); }
    const btn = page.locator(`[data-testid=${sh.gid}-touchbar] button`, { hasText: /^Borrar$/ }).first();
    const visible = await btn.isVisible().catch(() => false);
    if (visible) { await btn.tap().catch(() => btn.click()); await settled(page, sh.gid); await page.waitForTimeout(600); }
    check(`${tag}: el botón táctil «Borrar» vacía la celda seleccionada`, visible && ((await valAt(50, col)) ?? "x") === "");
  }
  // ---- 6) escribir sobre una celda y luego borrar con Backspace: en edición, Backspace borra caracteres ----
  {
    let col = dataCols[0];
    for (const d of dataCols) { if (((await valAt(52, d)) ?? "") !== "" && !isQtyCol(d.t) && !/fecha|vencimiento/i.test(d.t)) { col = d; break; } }
    const cell = await cellAt(52, col);
    await cell.click();
    await page.keyboard.press("Enter"); // entra en edición con el texto actual
    await page.keyboard.press("End");
    await page.keyboard.type("XY");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await settled(page, sh.gid);
    await page.waitForTimeout(500);
    const v = (await valAt(52, col)) ?? "";
    check(`${tag}: en modo edición, Backspace borra solo un carácter (no vacía la celda)`, v.endsWith("X") && v.length > 1, `${col.t}: ${v}`);
  }
  // ---- 7) buscador: Backspace dentro del buscador NO borra celdas ----
  {
    const search = page.getByPlaceholder(/buscar/i).first();
    if (await search.count()) {
      const col = dataCols[0];
      const before = await valAt(55, col);
      await (await cellAt(55, col)).click();
      await search.click();
      await search.type("abc");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");
      await search.fill("");
      await page.waitForTimeout(500);
      const after = await valAt(55, col);
      check(`${tag}: Backspace/Delete dentro del buscador no tocan la planilla`, before === after && before !== "", `${before} → ${after}`);
    }
  }
  await page.screenshot({ path: `${OUT}/${key}-${kind}.png` });
  await u.ctx.close();
}

try {
  for (const key of ONLY) {
    if (!SHEETS[key]) continue;
    try { await runSheet(key, process.env.TABLET ? "tablet" : "desktop"); } catch (err) {
      console.error(err);
      check(`${SHEETS[key].label}: ejecución sin excepciones`, false, err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  }
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
