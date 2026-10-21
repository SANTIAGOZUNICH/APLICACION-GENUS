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
const OUT = process.env.OUT ?? "/tmp/planillas-estabilidad";
const ONLY = (process.env.PLANILLAS ?? "stock,ingmp,ingme,salme,invme").split(",");
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

/** Estado observable: scroll X/Y, y para la celda activa la identidad de su fila (valor de la columna identidad). */
async function snap(page, sh, map) {
  return page.evaluate(({ gid, idc }) => {
    const root = document.querySelector(`[data-testid=${gid}]`);
    const sc = root.querySelector(".dsg-container");
    const rows = [...root.querySelectorAll(".dsg-row")].slice(1);
    const idOf = (row) => (row?.querySelector(`.genus-col-${idc} input`)?.value ?? "").trim();
    const act = root.querySelector(".dsg-active-cell");
    let activeId = null;
    if (act) {
      const r = act.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const hit = rows.find((row) => { const b = row.getBoundingClientRect(); return y >= b.top && y <= b.bottom; });
      activeId = hit ? idOf(hit) : null;
    }
    return { top: Math.round(sc.scrollTop), left: Math.round(sc.scrollLeft), hasActive: Boolean(act), activeId };
  }, { gid: sh.gid, idc: map[sh.idCol] });
}
/** Posición absoluta (px desde el inicio de la hoja) de la fila con ese identificador: cambia solo si la fila se movió. */
async function rowY(page, sh, map, code) {
  return page.evaluate(({ gid, idc, code }) => {
    const root = document.querySelector(`[data-testid=${gid}]`);
    const sc = root.querySelector(".dsg-container");
    for (const row of [...root.querySelectorAll(".dsg-row")].slice(1)) {
      if ((row.querySelector(`.genus-col-${idc} input`)?.value ?? "").trim() === code) return Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    }
    return null;
  }, { gid: sh.gid, idc: map[sh.idCol], code });
}
const rowLoc = (page, sh, map, code) => page.locator(`[data-testid=${sh.gid}] .dsg-row`).filter({ has: page.locator(`.genus-col-${map[sh.idCol]} input[value="${code}"]`) }).first();
const cellOf = (row, map, title) => row.locator(`.genus-col-${map[title]}`).first();
async function wheelTo(page, sh, y) {
  const b = await page.locator(`[data-testid=${sh.gid}] .dsg-container`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, y);
  await page.waitForTimeout(600);
}
async function apiOrder(page, resource) {
  const res = await page.request.get(`/api/v1/inventory?resource=${resource}`, { timeout: 120_000 });
  return ((await res.json()).data ?? []).map((r) => r.id);
}
const RESOURCE = { stock: "mp_stock", ingmp: "mp_ingresos", ingme: "me_ingresos", salme: "me_salidas", invme: "me_inventario" };

async function runSheet(key, kind) {
  const sh = SHEETS[key];
  const tag = `${sh.label} · ${kind}`;
  const u = await openAs(E2E_USERS[sh.user], kind);
  const page = u.page;
  await cleanup();
  await sh.seed(sh.rows);
  check(`${tag}: ${sh.rows} filas sembradas`, (await q(`select count(*)::int n from ${sh.table} where payload->>'createdBy' = 'zze'`))[0].n >= sh.rows);
  await page.goto("/mi-trabajo");
  await nav(page, sh.nav);
  await page.locator(`[data-testid=${sh.gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForFunction((gid) => (document.querySelector(`[data-testid=${gid}] .dsg-container`)?.scrollHeight ?? 0) > 5000, sh.gid, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const map = await headerMap(page, sh.gid);
  const rowH = await page.evaluate((gid) => document.querySelector(`[data-testid=${gid}] .dsg-row:not(:first-child)`).getBoundingClientRect().height, sh.gid);
  const orderBefore = await apiOrder(page, RESOURCE[key]);
  const START = Math.min(350, sh.rows - 40);
  await wheelTo(page, sh, (START - 4) * rowH);
  await page.screenshot({ path: `${OUT}/${key}-${kind}-01-fila-${START}.png` });

  // ---- 10 ediciones consecutivas desde la fila START (Enter baja una fila, como Excel) ----
  let maxDrift = 0, lost = 0, wrongNext = 0, movedRows = 0, notSaved = 0;
  for (let i = 0; i < 10; i++) {
    const code = sh.code(START + i);
    const [title, field] = sh.text[i % sh.text.length];
    const row = rowLoc(page, sh, map, code);
    await row.waitFor({ timeout: 20_000 });
    if (i === 0) await cellOf(row, map, title).click();
    else {
      const cur = await snap(page, sh, map);
      if (cur.activeId !== code) await cellOf(row, map, title).click(); // Enter pasó de columna: se vuelve a la columna de trabajo
    }
    const before = await snap(page, sh, map);
    const yBefore = await rowY(page, sh, map, code);
    const typed = `Ed${i}-${START + i}`;
    await page.keyboard.type(typed);
    await page.keyboard.press("Enter");
    await settled(page, sh.gid);
    await page.waitForTimeout(900);
    const after = await snap(page, sh, map);
    const yAfter = await rowY(page, sh, map, code);
    const drift = Math.abs(after.top - before.top);
    maxDrift = Math.max(maxDrift, drift);
    if (!after.hasActive) lost++;
    if (after.activeId !== sh.code(START + i + 1)) wrongNext++;
    if (yBefore !== yAfter) movedRows++;
    const saved = await dbRow(sh, code);
    if (String(saved?.[field] ?? "") !== typed) notSaved++;
    console.log(`  ${tag} #${i + 1} ${code}: scrollTop ${before.top}→${after.top}, left ${before.left}→${after.left}, fila Y ${yBefore}→${yAfter}, activa=${after.activeId}`);
  }
  check(`${tag}: 10 ediciones en la fila ${START}: el scroll nunca salta (desvío máx. ${maxDrift}px, fila = ${Math.round(rowH)}px)`, maxDrift <= rowH * 2.5);
  check(`${tag}: la celda activa se conserva tras cada guardado (y sigue en la fila siguiente, como Excel)`, lost === 0 && wrongNext === 0, `sin celda activa ${lost}, fila activa distinta de la esperada ${wrongNext}`);
  check(`${tag}: la fila editada NO cambia de posición al guardar (identidad de fila)`, movedRows === 0, `${movedRows} filas se movieron`);
  check(`${tag}: las 10 ediciones están en la base`, notSaved === 0, `${notSaved} sin guardar`);

  // ---- borrar una celda ----
  {
    const code = sh.code(START + 12);
    const [title, field] = sh.text[0];
    const row = rowLoc(page, sh, map, code);
    await row.waitFor({ timeout: 20_000 });
    const y0 = await rowY(page, sh, map, code);
    await cellOf(row, map, title).click();
    await page.keyboard.press("Delete");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    check(`${tag}: Suprimir vacía la celda y queda vacía en la base`, String((await dbRow(sh, code))?.[field] ?? "x") === "" && (await rowY(page, sh, map, code)) === y0);
  }
  // ---- borrar un rango (2 filas × 2 columnas) ----
  {
    const c1 = sh.code(START + 14), c2 = sh.code(START + 15);
    const [t1, f1] = sh.text[1], [t2, f2] = sh.text[2];
    const r1 = rowLoc(page, sh, map, c1);
    await r1.waitFor({ timeout: 20_000 });
    await cellOf(r1, map, t1).click();
    await cellOf(rowLoc(page, sh, map, c2), map, t2).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    const a = await dbRow(sh, c1), b = await dbRow(sh, c2);
    check(`${tag}: borrar un rango vacía todas sus celdas`, [a?.[f1], a?.[f2], b?.[f1], b?.[f2]].every((v) => String(v ?? "x") === ""), JSON.stringify([a?.[f1], a?.[f2], b?.[f1], b?.[f2]]));
  }
  // ---- vaciar una fila completa (todas las columnas de texto) ----
  {
    const code = sh.code(START + 17);
    const row = rowLoc(page, sh, map, code);
    await row.waitFor({ timeout: 20_000 });
    const titles = [...new Set(sh.text.map((t) => t[0]))];
    const fields = [...new Set(sh.text.map((t) => t[1]))];
    const idxs = titles.map((t) => map[t]).sort((x, y) => x - y);
    await row.locator(`.genus-col-${idxs[0]}`).first().click();
    await row.locator(`.genus-col-${idxs[idxs.length - 1]}`).first().click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    const r = await dbRow(sh, code);
    check(`${tag}: vaciar una fila completa (varias columnas) y guardar el registro incompleto`, !!r && fields.every((f) => String(r[f] ?? "x") === ""), JSON.stringify(fields.map((f) => r?.[f])));
  }
  // ---- editar una cantidad (afecta stock) sin pedir motivo ----
  if (sh.qty) {
    const code = sh.code(START + 20);
    const row = rowLoc(page, sh, map, code);
    await row.waitFor({ timeout: 20_000 });
    const y0 = await rowY(page, sh, map, code);
    await cellOf(row, map, sh.qty.col).click();
    await page.keyboard.type(sh.qty.value);
    await page.keyboard.press("Enter");
    await settled(page, sh.gid);
    await page.waitForTimeout(900);
    const dialog = await page.locator("[role=dialog]").count();
    const reasonBar = await page.locator(`[data-testid=${sh.gid}-reason-bar], [data-testid=${sh.gid}-inline-reason]`).count();
    check(`${tag}: editar una cantidad se guarda directo (sin motivo, sin confirmación) y la fila no se mueve`, Number((await dbRow(sh, code))?.[sh.qty.field]) === sh.qty.expect && dialog === 0 && reasonBar === 0 && (await rowY(page, sh, map, code)) === y0);
  }
  // ---- editar un lote ----
  if (sh.lot) {
    const code = sh.code(START + 22);
    const row = rowLoc(page, sh, map, code);
    await row.waitFor({ timeout: 20_000 });
    await cellOf(row, map, sh.lot.col).click();
    await page.keyboard.type("LOTE-NUEVO");
    await page.keyboard.press("Enter");
    await settled(page, sh.gid);
    await page.waitForTimeout(700);
    check(`${tag}: editar un lote se guarda directo`, (await dbRow(sh, code))?.[sh.lot.field] === "LOTE-NUEVO");
  }
  // ---- persistencia tras recargar + el ORDEN de la hoja no cambió ----
  const orderAfter = await apiOrder(page, RESOURCE[key]);
  check(`${tag}: tras tantas ediciones el orden de la hoja (servidor) es EXACTAMENTE el mismo`, JSON.stringify(orderBefore) === JSON.stringify(orderAfter), `${orderBefore.length} filas antes, ${orderAfter.length} después`);
  await page.reload();
  await page.locator(`[data-testid=${sh.gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForFunction((gid) => (document.querySelector(`[data-testid=${gid}] .dsg-container`)?.scrollHeight ?? 0) > 5000, sh.gid, { timeout: 180_000 });
  await page.waitForTimeout(1200);
  const map2 = await headerMap(page, sh.gid);
  await wheelTo(page, sh, (START - 4) * rowH);
  const r0 = rowLoc(page, sh, map2, sh.code(START));
  await r0.waitFor({ timeout: 20_000 });
  const shown = await cellOf(r0, map2, sh.text[0][0]).locator("input").first().inputValue().catch(() => null);
  check(`${tag}: tras recargar la edición sigue ahí y la fila está en el mismo lugar`, shown === `Ed0-${START}` || (await dbRow(sh, sh.code(START)))?.[sh.text[0][1]] === `Ed0-${START}`, String(shown));
  await page.screenshot({ path: `${OUT}/${key}-${kind}-02-recargado.png` });
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
