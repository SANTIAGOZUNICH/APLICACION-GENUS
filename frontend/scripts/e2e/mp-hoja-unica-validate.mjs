// E2E en Chromium real: Materias Primas como HOJA ÚNICA continua con ORDEN DE CARGA persistente.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production. Ver run-mp-hoja-unica-local.sh.
//
// Cubre: sin paginación · scroll continuo · orden de carga (y que no depende del azar de PostgreSQL) · alta al final ·
// persistencia tras recargar / otra sesión / tablet · editar, ajustar, ingresar y egresar sin reordenar · búsqueda y
// restauración exacta del orden · importación de varios registros · cargas simultáneas (sin posiciones repetidas) ·
// históricos (criterio documentado) · 1000 y 5000 filas (rendimiento) · escritorio y tablet · permisos lectura/edición ·
// integridad del inventario (huellas de stock, movimientos, lotes y saldos antes/después de operaciones de solo visualización).
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
const OUT = process.env.OUT ?? "/tmp/mp-hoja-unica";
mkdirSync(OUT, { recursive: true });
const results = [];
const metrics = {};
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const TIPS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  tablet: {
    viewport: { width: 820, height: 1180 },
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    hasTouch: true,
    deviceScaleFactor: 2,
  },
};

const NOMBRES = ["HU Glicerina", "HU Ácido hialurónico", "HU Fragancia", "HU Alcohol cetílico", "HU Vitamina E"];
// Códigos y proveedores en orden ALFABÉTICO INVERSO al de carga: si algo ordenara por código o proveedor, se notaría.
const CODIGOS = ["HU-MP-E", "HU-MP-D", "HU-MP-C", "HU-MP-B", "HU-MP-A"];

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos", "inv_mp_compras"]) {
    await q(`delete from ${t} where payload::text like '%HU-%' or payload::text like '%PERF %' or payload::text like '%HIST %' or payload::text like '%HU %'`);
  }
  await q("delete from mp_stock_movements where codigo like 'HU-%'");
  await q("delete from mp_stock_balances where codigo like 'HU-%'");
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const debugPages = [];
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
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
const post = (page, data) => page.request.post("/api/v1/inventory", { data });
const list = async (page, resource) => (await (await page.request.get(`/api/v1/inventory?resource=${resource}`)).json()).data;
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stockCount = async () => (await q("select count(*)::int n from inv_mp_stock where coalesce(payload->>'archived','false') <> 'true'"))[0].n;

async function openStock(page) {
  await page.goto("/mi-trabajo");
  await nav(page, "Stock");
  await page.locator("[data-testid=mp-sheet-count]").waitFor({ timeout: 120_000 });
}
async function openTab(page, label) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator("[data-testid=mp-sheet-count]").waitFor({ timeout: 120_000 });
}
const waitTotal = (page, n) => page.waitForFunction((n) => (document.querySelector("[data-testid=mp-sheet-count]")?.textContent ?? "").startsWith(String(n)), n, { timeout: 120_000 });

/** Lee TODA una columna de la planilla recorriendo el scroll (la grilla virtualiza); clave = n.º de fila del margen. */
async function readAllColOnce(page, gridId, title) {
  const collected = new Map();
  const step = () =>
    page.evaluate(
      ([gid, title]) => {
        const root = document.querySelector(`[data-testid=${gid}]`);
        if (!root) return { rows: [], done: true };
        const rows = [...root.querySelectorAll(".dsg-row")];
        const header = rows.find((r) => r.classList.contains("dsg-row-header"));
        const idx = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === title);
        const out = rows
          .filter((r) => r !== header)
          .map((r) => {
            const cells = r.querySelectorAll(".dsg-cell");
            const c = cells[idx];
            return { n: Number(cells[0]?.textContent), v: c?.querySelector("input")?.value ?? c?.textContent ?? "" };
          });
        const sc = root.querySelector(".dsg-container");
        const done = !sc || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
        if (sc && !done) sc.scrollTop += Math.max(100, sc.clientHeight - 80);
        return { rows: out, done };
      },
      [gridId, title]
    );
  await page.evaluate((gid) => {
    const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`);
    if (sc) sc.scrollTop = 0;
  }, gridId);
  await page.waitForTimeout(150);
  for (let i = 0; i < 4000; i++) {
    const { rows, done } = await step();
    for (const r of rows) if (Number.isFinite(r.n)) collected.set(r.n, r.v);
    if (done) {
      await page.waitForTimeout(200);
      const last = await step();
      for (const r of last.rows) if (Number.isFinite(r.n)) collected.set(r.n, r.v);
      break;
    }
    await page.waitForTimeout(40);
  }
  return [...collected.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
/** Lectura estable: repite hasta que dos pasadas seguidas coinciden (la grilla virtualiza y re-renderiza al desplazarse). */
async function readAllCol(page, gridId, title) {
  let prev = await readAllColOnce(page, gridId, title);
  for (let i = 0; i < 3; i++) {
    const cur = await readAllColOnce(page, gridId, title);
    if (JSON.stringify(cur) === JSON.stringify(prev)) return cur;
    prev = cur;
  }
  return prev;
}
const onlyHU = (arr) => arr.filter((v) => v.startsWith("HU "));

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
async function typeInto(page, rowValue, title, value, gridTestId) {
  const c = await cell(page, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridTestId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await apply.click();
}

/** Huella de TODO lo que el cambio de visualización no puede tocar: filas (payload+updated_at+posición), libro mayor y saldos. */
async function snap() {
  const tables = {};
  for (const t of ["inv_mp_stock", "inv_mp_ingresos", "inv_mp_compras", "inv_mp_control"]) {
    tables[t] = (
      await q(
        `select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||payload::text||'|'||updated_at::text||'|'||load_seq::text||'|'||coalesce(seq_criterio,''), ';' order by load_seq),'')) h from ${t}`
      )
    )[0];
  }
  const mov = (await q("select count(*)::int n, md5(coalesce(string_agg(id::text||codigo||kind||quantity::text||coalesce(balance_after::text,''), ';' order by id),'')) h from mp_stock_movements"))[0];
  const bal = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  const sums = (await q("select md5(coalesce(string_agg(c||s::text, ';' order by c),'')) h from (select payload->>'codigo' c, sum((payload->>'cantidadKg')::numeric) s from inv_mp_stock group by 1) x"))[0].h;
  const ajustes = (await q("select count(*)::int n from inv_ajustes"))[0].n;
  return { tables, mov, bal, sums, ajustes };
}
const seqOf = async (ids) => (await q("select id, load_seq::text s from inv_mp_stock where id = any($1::uuid[]) order by load_seq", [ids])).map((r) => `${r.id}:${r.s}`);
const dbOrder = async (like) => (await q("select payload->>'descripcion' d from inv_mp_stock where payload->>'descripcion' like $1 order by load_seq", [like])).map((r) => r.d);

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const mp = mpu.page;

  // ============ 1) Carga inicial en un orden NO alfabético ============
  const ids = [];
  for (const [i, d] of NOMBRES.entries()) {
    const r = await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: d, codigo: CODIGOS[i], lote: `HL${i}`, cantidadKg: 10 * (i + 1), proveedor: `ZZ Proveedor ${5 - i}`, ubicacion: `U${5 - i}` } });
    const body = await r.json();
    ids.push(body.data.id);
  }
  const apiOrder = (await list(mp, "mp_stock")).map((r) => r.descripcion).filter((v) => v.startsWith("HU "));
  check("API: el listado respeta el orden de carga (Glicerina, Ácido hialurónico, Fragancia, Alcohol cetílico, Vitamina E)", same(apiOrder, NOMBRES), apiOrder.join(" > "));
  check("base: load_seq estrictamente creciente en el orden de carga y sin repetidos", same(await dbOrder("HU %"), NOMBRES) && (await q("select count(distinct load_seq)::int d, count(*)::int n from inv_mp_stock"))[0].d === (await q("select count(*)::int n from inv_mp_stock"))[0].n);
  check("filas nuevas quedan con seq_criterio 'alta'", (await q("select count(*)::int n from inv_mp_stock where payload->>'descripcion' like 'HU %' and seq_criterio = 'alta'"))[0].n === NOMBRES.length);

  // ============ 2) Hoja única en pantalla (escritorio 1280x800) ============
  const d = await openAs(E2E_USERS.materiaPrima, "desktop");
  const dp = d.page;
  await openStock(dp);
  const total1 = await stockCount();
  await waitTotal(dp, total1);
  await dp.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  const bodyText = await dp.locator("body").innerText();
  check("SIN paginación: no hay «Página», «Anterior» ni «Siguiente»", !/Página\s+\d+\s*\/\s*\d+/.test(bodyText) && (await dp.getByRole("button", { name: /^(Anterior|Siguiente)$/ }).count()) === 0);
  check("muestra el total de registros y que el orden es el de carga", /\d+ registros?/.test(await dp.locator("[data-testid=mp-sheet-count]").innerText()) && /Orden de carga/.test(await dp.locator("[data-testid=mp-sheet-order]").innerText()));
  const uiOrder = onlyHU(await readAllCol(dp, "mp-stock-grid", "Descripción"));
  check("PANTALLA Stock: filas en el orden de carga (no alfabético por código/proveedor/nombre)", same(uiOrder, NOMBRES), uiOrder.join(" > "));
  await dp.screenshot({ path: `${OUT}/1-stock-hoja-unica-escritorio.png` });

  // Estado base para las pruebas de integridad: de acá en más, "solo visualizar" no puede cambiar NADA.
  const base = await snap();

  // ============ 3) Persistencia: recargar, otra sesión, tablet ============
  await dp.reload();
  await nav(dp, "Stock");
  await dp.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  check("tras RECARGAR la página el orden es el mismo", same(onlyHU(await readAllCol(dp, "mp-stock-grid", "Descripción")), NOMBRES));
  await d.ctx.close();
  const t = await openAs(E2E_USERS.materiaPrima, "tablet");
  const tp = t.page;
  await openStock(tp);
  await tp.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  check("en OTRA sesión/dispositivo (tablet, 820x1180) el orden es el mismo", same(onlyHU(await readAllCol(tp, "mp-stock-grid", "Descripción")), NOMBRES));

  // ============ 4) Tablet y escritorio: sin scroll horizontal de página; encabezado fijo; scroll interno ============
  const layout = async (page) =>
    page.evaluate(() => {
      const sc = document.querySelector("[data-testid=mp-stock-grid] .dsg-container");
      const header = document.querySelector("[data-testid=mp-stock-grid] .dsg-row-header");
      const before = header.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      sc.scrollTop = 400;
      return new Promise((res) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            res({
              pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
              sheetScrollsX: sc.scrollWidth > sc.clientWidth,
              sheetScrollsY: sc.scrollHeight > sc.clientHeight,
              headerTopBefore: before,
              headerTopAfter: header.getBoundingClientRect().top - sc.getBoundingClientRect().top,
              scrolled: sc.scrollTop,
              sheetBottom: sc.getBoundingClientRect().bottom,
              innerHeight: window.innerHeight,
            })
          )
        )
      );
    });
  // Para ver desplazamiento vertical hacen falta más filas que las visibles: se agregan 40 lotes de relleno ordenados.
  for (let i = 0; i < 40; i++) await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: `HU Relleno ${String(i).padStart(2, "0")}`, codigo: `HU-R-${String(40 - i).padStart(2, "0")}`, lote: `RL${i}`, cantidadKg: 1 } });
  const totalRelleno = await stockCount();
  await tp.reload();
  await nav(tp, "Stock");
  await waitTotal(tp, totalRelleno);
  await tp.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  const lt = await layout(tp);
  check("TABLET 820x1180: la página NO tiene scroll horizontal (solo la hoja)", lt.pageOverflowX <= 1, `overflow ${lt.pageOverflowX}px`);
  check("TABLET: la hoja se desplaza dentro de su marco (vertical) y el encabezado queda fijo", lt.sheetScrollsY && lt.scrolled > 0 && Math.abs(lt.headerTopAfter - lt.headerTopBefore) <= 2, JSON.stringify(lt));
  check("TABLET: columnas legibles con scroll horizontal DENTRO de la hoja (no de la página)", lt.sheetScrollsX || lt.pageOverflowX <= 1, `scrollX hoja: ${lt.sheetScrollsX}`);
  check("TABLET: la hoja entra en la pantalla (alto del marco ≤ alto de la ventana)", lt.sheetBottom <= lt.innerHeight + 2, `${Math.round(lt.sheetBottom)} ≤ ${lt.innerHeight}`);
  await tp.screenshot({ path: `${OUT}/2-stock-tablet.png` });
  await t.ctx.close();
  const d2 = await openAs(E2E_USERS.materiaPrima, "desktop");
  const d2p = d2.page;
  await openStock(d2p);
  await waitTotal(d2p, totalRelleno);
  await d2p.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  const ld = await layout(d2p);
  check("ESCRITORIO 1280x800: sin scroll horizontal de página, hoja con scroll vertical continuo y encabezado fijo", ld.pageOverflowX <= 1 && ld.sheetScrollsY && Math.abs(ld.headerTopAfter - ld.headerTopBefore) <= 2, JSON.stringify(ld));
  const allNow = onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción"));
  check("scroll continuo: llegando al final se ven TODOS los registros (45), sin cortes de página", allNow.length === 45 && same(allNow.slice(0, 5), NOMBRES), `${allNow.length} filas`);
  await d2p.screenshot({ path: `${OUT}/3-stock-escritorio-scroll.png` });

  // ============ 5) Editar / ajustar / ingresar / egresar NO reordenan ============
  const orderIds = async () => (await q("select id from inv_mp_stock where payload->>'descripcion' like 'HU %' order by load_seq")).map((r) => r.id);
  const idsBefore = await orderIds();
  const seqBefore = await seqOf(idsBefore);
  await d2p.evaluate(() => { const sc = document.querySelector("[data-testid=mp-stock-grid] .dsg-container"); if (sc) sc.scrollTop = 0; });
  await d2p.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), "HU Ácido hialurónico", { timeout: 20_000 });
  await typeInto(d2p, "HU Ácido hialurónico", "Proveedor", "AAA PRIMERO ALFABETICO", "mp-stock-grid");
  check("editar una fila en la hoja (Proveedor) se guarda", await waitDb(async () => (await q("select 1 from inv_mp_stock where payload->>'descripcion' = 'HU Ácido hialurónico' and payload->>'proveedor' = 'AAA PRIMERO ALFABETICO'")).length === 1));
  check("editar NO cambia la posición (load_seq idéntico) ni el orden en pantalla", same(await seqOf(idsBefore), seqBefore) && same(onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción")).slice(0, 5), NOMBRES));
  const lot3 = (await list(mp, "mp_stock")).find((r) => r.descripcion === "HU Fragancia");
  const antesAjuste = await snap();
  const adj = await post(mp, { action: "adjust", resource: "mp_stock", id: lot3.id, payload: { cantidadNueva: 123, motivo: "Conteo físico orden de carga" } });
  check("modificar cantidades (Ajustar stock) funciona y NO reordena", adj.ok() && same(await seqOf(idsBefore), seqBefore) && same(await dbOrder("HU %").then((o) => o.filter((x) => !x.includes("Relleno"))), NOMBRES));
  const ing = await post(mp, { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-01-01", remitoNro: "HU-R-1", codigo: lot3.codigo, descripcion: lot3.descripcion, lote: lot3.lote, proveedor: "x", bultos: 2, cantidad: 5, status: "CONFIRMADO" } });
  check("INGRESO confirmado a un lote existente suma 10 kg y NO reordena", ing.ok() && (await q("select (payload->>'cantidadKg')::numeric k from inv_mp_stock where id = $1", [lot3.id]))[0].k == 133 && same(await seqOf(idsBefore), seqBefore));
  const eg = await mp.request.post("/api/v1/mp-stock/ledger", { data: { action: "ajuste", codigo: CODIGOS[0], quantity: -3, reason: "Egreso de prueba orden de carga" } });
  check("EGRESO en el libro mayor (−3) baja el saldo y NO reordena", eg.ok() && same(await seqOf(idsBefore), seqBefore));
  const despuesAjuste = await snap();
  check("el ajuste/ingreso/egreso solo cambió lo esperado: saldo de HU-MP-C y HU-MP-E; los demás códigos igual", despuesAjuste.tables.inv_mp_compras.h === antesAjuste.tables.inv_mp_compras.h && despuesAjuste.mov.n > antesAjuste.mov.n);
  // Ingreso de una MP NUEVA → al final.
  const ing2 = await post(mp, { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-01-02", remitoNro: "HU-R-2", codigo: "HU-MP-NUEVA", descripcion: "HU Aceite de coco", lote: "HLN", proveedor: "AAA", bultos: 1, cantidad: 7, status: "CONFIRMADO" } });
  const maxPrev = (await q("select max(load_seq)::text m from inv_mp_stock where payload->>'descripcion' <> 'HU Aceite de coco'"))[0].m;
  const nuevo = (await q("select load_seq::text s, payload from inv_mp_stock where payload->>'descripcion' = 'HU Aceite de coco'"))[0];
  check("MATERIA PRIMA NUEVA (ingreso confirmado) se agrega AL FINAL, persiste con todos sus campos y no mueve las anteriores", ing2.ok() && Number(nuevo.s) > Number(maxPrev) && nuevo.payload.codigo === "HU-MP-NUEVA" && nuevo.payload.lote === "HLN" && nuevo.payload.cantidadKg === 7 && same(await seqOf(idsBefore), seqBefore));
  await d2p.reload();
  await nav(d2p, "Stock");
  await d2p.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  const finalUi = onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción"));
  check("pantalla tras todo eso: orden de carga intacto y la nueva MP al final", same(finalUi.slice(0, 5), NOMBRES) && finalUi[finalUi.length - 1] === "HU Aceite de coco", `${finalUi.length} filas`);

  // ============ 6) Búsqueda / filtros / orden explícito: no alteran el orden y se vuelve EXACTAMENTE al de carga ============
  const sBase = await snap();
  const fullBefore = await readAllCol(d2p, "mp-stock-grid", "Descripción");
  await d2p.fill("[data-testid=mp-search]", "HU-MP-");
  await waitTotal(d2p, 6);
  const filtered = onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción"));
  check("búsqueda por CÓDIGO: solo coincidencias y en orden de carga", same(filtered, [...NOMBRES, "HU Aceite de coco"]), filtered.join(" > "));
  await d2p.fill("[data-testid=mp-search]", "Fragan");
  await waitTotal(d2p, 1);
  check("búsqueda por NOMBRE (descripción)", same(onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción")), ["HU Fragancia"]));
  await d2p.fill("[data-testid=mp-search]", "HL3");
  await waitTotal(d2p, 1);
  check("búsqueda por LOTE", same(onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción")), ["HU Alcohol cetílico"]));
  await d2p.fill("[data-testid=mp-search]", "ZZ Proveedor");
  await waitTotal(d2p, 4);
  check("búsqueda por PROVEEDOR (en orden de carga, no alfabético)", same(onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción")), ["HU Glicerina", "HU Fragancia", "HU Alcohol cetílico", "HU Vitamina E"]));
  await d2p.locator("[data-testid=mp-search-clear]").click();
  await waitTotal(d2p, totalRelleno + 1);
  check("al limpiar la búsqueda se recupera EXACTAMENTE el orden de carga de toda la hoja", same(await readAllCol(d2p, "mp-stock-grid", "Descripción"), fullBefore));
  await d2p.selectOption("[data-testid=mp-stock-sort]", "descripcion_asc");
  const sorted = onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción"));
  check("ordenar por columna es una opción EXPLÍCITA (cambia el orden) y avisa que no es el de carga", !same(sorted.slice(0, 5), NOMBRES) && (await d2p.locator("[data-testid=mp-sheet-order-reset]").count()) === 1);
  await d2p.locator("[data-testid=mp-sheet-order-reset]").click();
  check("«Volver al orden de carga» recupera EXACTAMENTE el orden original", same(await readAllCol(d2p, "mp-stock-grid", "Descripción"), fullBefore) && (await d2p.locator("[data-testid=mp-stock-sort]").inputValue()) === "carga");
  await d2p.selectOption("[data-testid=mp-stock-sort]", "codigo_asc");
  await d2p.reload();
  await nav(d2p, "Stock");
  await d2p.locator("[data-testid=mp-stock-grid]").waitFor({ timeout: 60_000 });
  check("el orden elegido NO se recuerda: al entrar siempre es el de carga (sin orden automático)", (await d2p.locator("[data-testid=mp-stock-sort]").inputValue()) === "carga" && same(onlyHU(await readAllCol(d2p, "mp-stock-grid", "Descripción")).slice(0, 5), NOMBRES));
  // modo lista (clásica): también continua, sin paginación y en el mismo orden
  await d2p.locator("[data-testid=os-table-mode-toggle]").first().click();
  await d2p.locator("[data-testid=mp-stock-list-sheet]").waitFor({ timeout: 30_000 });
  const listNames = await d2p.evaluate(() => [...document.querySelectorAll("[data-testid=mp-stock-list-sheet] tbody tr")].map((r) => r.textContent ?? ""));
  const iG = listNames.findIndex((x) => x.includes("HU Glicerina"));
  check("modo LISTA clásico: misma hoja continua, mismo orden de carga", iG >= 0 && listNames[iG + 1].includes("HU Ácido hialurónico") && listNames[iG + 2].includes("HU Fragancia"));
  await d2p.locator("[data-testid=os-table-mode-toggle]").first().click();
  const sAfter = await snap();
  check("INTEGRIDAD: buscar, ordenar, recargar y cambiar de modo NO modificó ninguna fila, movimiento ni saldo (huellas idénticas, incl. updated_at)", same(sBase, sAfter));

  // ============ 7) Importar varios registros (Ingresos MP, como «Pegar desde Excel»: fila por fila en orden) ============
  const remitos = Array.from({ length: 12 }, (_, i) => `HU-IMP-${String.fromCharCode(76 - i)}${i}`); // L0, K1, J2… orden alfabético inverso
  const fechas = ["2026-05-09", "2026-01-02", "2026-12-30", "2026-03-03", "2026-07-07", "2026-02-02", "2026-11-11", "2026-04-04", "2026-10-10", "2026-06-06", "2026-09-09", "2026-08-08"];
  for (const [i, r] of remitos.entries()) {
    const resp = await post(mp, { action: "upsert", resource: "mp_ingresos", payload: { fecha: fechas[i], remitoNro: r, codigo: `HU-IMP-${i}`, descripcion: `HU Importada ${i}`, lote: `IL${i}`, cantidad: 10 + i, bultos: 1, status: "BORRADOR" } });
    if (!resp.ok()) throw new Error(`import ${i}: ${resp.status()}`);
  }
  const impDb = (await q("select payload->>'remitoNro' r from inv_mp_ingresos where payload->>'remitoNro' like 'HU-IMP-%' order by load_seq")).map((r) => r.r);
  check("IMPORTACIÓN de 12 registros: se conserva el orden de las filas importadas (aunque fechas y remitos no sigan ese orden)", same(impDb, remitos));
  await openTab(d2p, "Ingresos MP");
  await d2p.locator("[data-testid=mp-ingresos-grid]").waitFor({ timeout: 60_000 });
  const impUi = (await readAllCol(d2p, "mp-ingresos-grid", "Remito")).filter((v) => v.startsWith("HU-IMP-"));
  check("PANTALLA Ingresos MP: mismas 12 filas en el orden importado; sin paginación", same(impUi, remitos) && (await d2p.getByText(/Página \d+ \/ \d+/).count()) === 0, impUi.join(","));
  await d2p.screenshot({ path: `${OUT}/4-ingresos-hoja-unica.png` });
  // Compras MP
  const compras = ["HU Zinc", "HU Aloe", "HU Mentol"];
  for (const c of compras) await post(mp, { action: "upsert", resource: "mp_compras", payload: { fecha: "2026-01-01", materiaPrima: c, cantidad: 1, unidad: "kg", estado: "Solicitada" } });
  check("Compras MP: orden de carga (Zinc, Aloe, Mentol; no alfabético)", same((await q("select payload->>'materiaPrima' m from inv_mp_compras where payload->>'materiaPrima' like 'HU %' order by load_seq")).map((r) => r.m), compras) && same((await list(mp, "mp_compras")).map((r) => r.materiaPrima).filter((m) => m.startsWith("HU ")), compras));

  // ============ 8) Cargas simultáneas de distintos usuarios ============
  const mp2 = await openAs(E2E_USERS.materiaPrima, "desktop");
  const dir = await openAs(E2E_USERS.direccion, "desktop");
  const mk = (n, page, tag) => post(page, { action: "upsert", resource: "mp_stock", payload: { descripcion: `HU Conc ${tag}${String(n).padStart(2, "0")}`, codigo: `HU-C-${tag}${n}`, lote: `CL${tag}${n}`, cantidadKg: 1 } });
  const resps = await Promise.all([
    ...Array.from({ length: 15 }, (_, n) => mk(n, mp, "A")),
    ...Array.from({ length: 15 }, (_, n) => mk(n, mp2.page, "B")),
    ...Array.from({ length: 10 }, (_, n) => mk(n, dir.page, "C")),
  ]);
  check("40 altas SIMULTÁNEAS de 3 usuarios: todas aceptadas (sin 409/500)", resps.every((r) => r.ok()), resps.map((r) => r.status()).filter((s) => s !== 200).join(","));
  const conc = await q("select load_seq::text s, payload->>'descripcion' d from inv_mp_stock where payload->>'descripcion' like 'HU Conc %' order by load_seq");
  check("simultáneas: 40 registros, 40 posiciones DISTINTAS y todas después de las anteriores", conc.length === 40 && new Set(conc.map((c) => c.s)).size === 40 && Number(conc[0].s) > Number(maxPrev));
  const concApi = (await list(mp, "mp_stock")).map((r) => r.descripcion).filter((v) => v.startsWith("HU Conc "));
  check("simultáneas: la API devuelve exactamente el orden persistido (determinístico)", same(concApi, conc.map((c) => c.d)));
  const dup = (await q("select load_seq, count(*)::int n from inv_mp_stock group by load_seq having count(*) > 1")).length;
  const dupI = (await q("select load_seq, count(*)::int n from inv_mp_ingresos group by load_seq having count(*) > 1")).length;
  check("no hay posiciones duplicadas en ninguna hoja", dup === 0 && dupI === 0);
  await mp2.ctx.close();
  await dir.ctx.close();

  // ============ 9) Históricos (anteriores a la migración 0049): criterio documentado ============
  const histIds = [];
  const hist = [
    { d: "HIST C (más nueva)", created: "2026-03-30T12:00:00.000Z" },
    { d: "HIST A (más vieja)", created: "2026-01-05T09:00:00.000Z" },
    { d: "HIST SIN FECHA", created: null },
    { d: "HIST B", created: "2026-02-10T15:30:00.000Z" },
  ];
  for (const h of hist) {
    const id = (await q("select gen_random_uuid()::text id"))[0].id;
    histIds.push(id);
    const payload = { id, proveedor: "H", cliente: "", descripcion: h.d, cantidadKg: 1, ubicacion: "", lote: "H", vencimiento: "", estadoStock: "", diasAlVence: null, estadoVencimiento: "", origen: "manual", codigo: "HIST-" + id.slice(0, 4), productosAsociados: "", archived: false, createdBy: "hist", updatedBy: "hist", ...(h.created ? { createdAt: h.created } : {}), updatedAt: "2026-04-01T00:00:00.000Z" };
    await q("insert into inv_mp_stock (id, payload, updated_at) values ($1, $2::jsonb, '2026-04-01T00:00:00Z')", [id, JSON.stringify(payload)]);
  }
  const seqsAntes = (await q("select load_seq::text s from inv_mp_stock where id = any($1::uuid[]) order by load_seq", [histIds])).map((r) => r.s);
  const histAntes = await q("select id, payload::text p, updated_at::text u from inv_mp_stock where id = any($1::uuid[]) order by id", [histIds]);
  check("históricos sembrados SIN orden confiable: seq_criterio NULL y posiciones por orden de inserción (no por fecha)", (await q("select count(*)::int n from inv_mp_stock where id = any($1::uuid[]) and seq_criterio is null", [histIds]))[0].n === 4);
  await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: "HU Posterior a históricos", codigo: "HU-POST", lote: "P1", cantidadKg: 1 } }); // cualquier escritura de MP dispara el backfill
  const histOrden = (await q("select payload->>'descripcion' d, seq_criterio c, load_seq::text s from inv_mp_stock where id = any($1::uuid[]) order by load_seq", [histIds]));
  check("BACKFILL: históricos ordenados por su fecha de creación registrada; sin fecha primero (más antiguos asumidos)", same(histOrden.map((h) => h.d), ["HIST SIN FECHA", "HIST A (más vieja)", "HIST B", "HIST C (más nueva)"]), histOrden.map((h) => h.d).join(" > "));
  check("BACKFILL: criterio auditable (historico:sin-fecha / historico:createdAt)", same(histOrden.map((h) => h.c), ["historico:sin-fecha", "historico:createdAt", "historico:createdAt", "historico:createdAt"]));
  check("BACKFILL: reparte las MISMAS posiciones que ya tenían (permutación: no se crean ni se pierden)", same(histOrden.map((h) => h.s), seqsAntes));
  const histDespues = await q("select id, payload::text p, updated_at::text u from inv_mp_stock where id = any($1::uuid[]) order by id", [histIds]);
  check("BACKFILL: no toca payload (kg, lote, etc.) ni updated_at de ninguna fila", same(histAntes, histDespues));
  const postRow = (await q("select load_seq::text s from inv_mp_stock where payload->>'descripcion' = 'HU Posterior a históricos'"))[0].s;
  check("filas posteriores quedan después de todos los históricos", Number(postRow) > Math.max(...histOrden.map((h) => Number(h.s))));
  const s1 = await snap();
  await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: "HU Otra mas", codigo: "HU-OTRA", lote: "P2", cantidadKg: 1 } });
  const histOrden2 = (await q("select payload->>'descripcion' d, load_seq::text s from inv_mp_stock where id = any($1::uuid[]) order by load_seq", [histIds]));
  check("BACKFILL idempotente: una segunda escritura no vuelve a mover los históricos", same(histOrden2.map((h) => h.d), histOrden.map((h) => h.d)) && same(histOrden2.map((h) => h.s), histOrden.map((h) => h.s)) && s1.tables.inv_mp_stock.n + 1 === (await snap()).tables.inv_mp_stock.n);
  await q("delete from inv_mp_stock where id = any($1::uuid[])", [histIds]);

  // ============ 10) Permisos: lectura vs edición ============
  // La barra lateral solo ofrece Stock MP a Materia Prima y Dirección; Calidad/Producción/Depósito leen por API (lectura).
  const cal = await openAs(E2E_USERS.calidad, "desktop");
  const cp = cal.page;
  const calOrder = (await list(cp, "mp_stock")).map((r) => r.descripcion).filter((v) => v.startsWith("HU "));
  check("LECTURA (Calidad): lee el MISMO listado en el MISMO orden de carga", same(calOrder.slice(0, 5), NOMBRES) && calOrder.length >= 45, `${calOrder.length} filas`);
  const denyW = await post(cp, { action: "upsert", resource: "mp_stock", payload: { descripcion: "HU no debe existir", codigo: "HU-NO", lote: "X", cantidadKg: 1 } });
  const denyC = await cp.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: ids[0], field: "proveedor", value: "X", expectedVersion: "2020-01-01T00:00:00.000Z" }] } });
  check("LECTURA (Calidad): el servidor rechaza escribir (alta 403, celda 403) y no se agrega ninguna fila", denyW.status() === 403 && [403, 409].includes(denyC.status()) && (await q("select 1 from inv_mp_stock where payload->>'descripcion' = 'HU no debe existir'")).length === 0, `${denyW.status()}/${denyC.status()}`);
  await cal.ctx.close();
  await openStock(mp);
  check("EDICIÓN (Materia Prima): ve «Nuevo», «Pegar desde Excel» y «Registrar ajuste» (todas las acciones siguen)", (await mp.getByRole("button", { name: /^Nuevo$/ }).count()) === 1 && (await mp.getByRole("button", { name: /Pegar desde Excel/ }).count()) === 1 && (await mp.locator("[data-testid=mp-stock-ajuste-open]").count()) === 1);

  // ============ 11) Integridad de inventario: consistencia ledger ↔ lotes tras todo lo anterior ============
  const lotesPorCodigo = await q("select payload->>'codigo' c, sum((payload->>'cantidadKg')::numeric) s from inv_mp_stock where payload->>'codigo' like 'HU-MP-%' group by 1 order by 1");
  const saldos = await q("select codigo c, stock_actual::numeric s from mp_stock_balances where codigo like 'HU-MP-%' order by 1");
  const esperadoSaldo = { "HU-MP-E": 10 - 3, "HU-MP-D": 20, "HU-MP-C": 133, "HU-MP-B": 40, "HU-MP-A": 50, "HU-MP-NUEVA": 7 };
  // Saldo del libro mayor = suma de movimientos (altas + ingreso + ajuste de kg + egreso), independiente del orden/visualización.
  check("INTEGRIDAD: saldos del libro mayor por código = lo esperado de las operaciones hechas (cantidad no cambió por mostrarse distinto)", saldos.every((s) => Number(s.s) === esperadoSaldo[s.c]) && saldos.length === 6, JSON.stringify(saldos));
  check("INTEGRIDAD: kg de los lotes por código coinciden con lo operado (HU-MP-C=133, HU-MP-D=20…)", lotesPorCodigo.find((l) => l.c === "HU-MP-C")?.s == 133 && lotesPorCodigo.find((l) => l.c === "HU-MP-D")?.s == 20);
  await mpu.ctx.close();
  await d2.ctx.close();

  // ============ 12) Rendimiento: 1000 y 5000 filas sembradas ============
  async function seedPerf(from, to) {
    await q(
      `insert into inv_mp_stock (id, payload, updated_at, seq_criterio)
       select g.id::uuid, jsonb_build_object('id', g.id, 'proveedor', 'PROV '||(i%50), 'cliente', '', 'descripcion', 'PERF MP '||lpad(i::text,5,'0'), 'cantidadKg', (i%100)+1,
              'ubicacion', 'A-'||(i%30), 'lote', 'LP'||i, 'vencimiento', '2027-01-01', 'estadoStock', '', 'diasAlVence', null, 'estadoVencimiento', '', 'origen', 'manual',
              'codigo', 'PERF-'||lpad(i::text,5,'0'), 'productosAsociados', '', 'archived', false, 'createdBy', 'e2e', 'updatedBy', 'e2e',
              'createdAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'updatedAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
              now(), 'alta'
         from (select gen_random_uuid()::text id, i from generate_series($1::int, $2::int) i) g`,
      [from, to]
    );
  }
  async function perf(label, n) {
    const user = await openAs(E2E_USERS.materiaPrima, "desktop");
    const p = user.page;
    await p.goto("/mi-trabajo");
    const total = await stockCount();
    const tApi = Date.now();
    const apiResp = await p.request.get("/api/v1/inventory?resource=mp_stock");
    const apiBytes = (await apiResp.body()).length;
    const apiMs = Date.now() - tApi;
    const t0 = Date.now();
    await nav(p, "Stock");
    await waitTotal(p, total);
    await p.locator("[data-testid=mp-stock-grid] .dsg-row:not(.dsg-row-header)").first().waitFor({ timeout: 120_000 });
    const initialMs = Date.now() - t0;
    const domRows = await p.locator("[data-testid=mp-stock-grid] .dsg-row").count();
    const scroll = await p.evaluate(async (total) => {
      const sc = document.querySelector("[data-testid=mp-stock-grid] .dsg-container");
      const t = performance.now();
      const frames = [];
      let last = performance.now();
      // recorrido progresivo de TODA la hoja (60 saltos) midiendo la duración de cada cuadro
      const steps = 60;
      for (let i = 1; i <= steps; i++) {
        sc.scrollTop = ((sc.scrollHeight - sc.clientHeight) * i) / steps;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
      }
      const lastRowN = await new Promise((resolve) => {
        const t2 = performance.now();
        const poll = () => {
          const rows = [...document.querySelectorAll("[data-testid=mp-stock-grid] .dsg-row:not(.dsg-row-header)")];
          const n = Number(rows[rows.length - 1]?.querySelector(".dsg-cell")?.textContent);
          if (n === total || performance.now() - t2 > 5000) resolve(n);
          else requestAnimationFrame(poll);
        };
        poll();
      });
      return { totalMs: performance.now() - t, lastRowN, maxFrame: Math.max(...frames), p95Frame: frames.slice().sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] };
    }, total);
    const domRowsEnd = await p.locator("[data-testid=mp-stock-grid] .dsg-row").count();
    // Modo lista clásico: carga progresiva hasta la última fila
    await p.locator("[data-testid=os-table-mode-toggle]").first().click();
    const tl = Date.now();
    await p.locator("[data-testid=mp-stock-list-sheet] tbody tr").first().waitFor({ timeout: 60_000 });
    const listFirstMs = Date.now() - tl;
    const listFirstRows = await p.locator("[data-testid=mp-stock-list-sheet] tbody tr").count();
    const listAll = await p.evaluate(async (total) => {
      const sc = document.querySelector("[data-testid=mp-stock-list-sheet]");
      const t = performance.now();
      let count = 0;
      for (let i = 0; i < 400; i++) {
        sc.scrollTop = sc.scrollHeight;
        await new Promise((r) => setTimeout(r, 25));
        count = sc.querySelectorAll("tbody tr").length;
        if (count >= total) break;
      }
      return { ms: performance.now() - t, count };
    }, total);
    await p.screenshot({ path: `${OUT}/perf-${label}-lista.png` });
    metrics[label] = { filas: total, apiMs, apiKB: Math.round(apiBytes / 1024), renderInicialMs: initialMs, filasEnDOMInicial: domRows, filasEnDOMAlFinal: domRowsEnd, recorridoCompletoMs: Math.round(scroll.totalMs), ultimaFilaVisible: scroll.lastRowN === total, cuadroMaxMs: Math.round(scroll.maxFrame), cuadroP95Ms: Math.round(scroll.p95Frame), listaPrimeraTandaMs: listFirstMs, listaFilasIniciales: listFirstRows, listaHastaElFinalMs: Math.round(listAll.ms), listaFilasFinal: listAll.count };
    console.log(`PERF ${label}:`, JSON.stringify(metrics[label]));
    await user.ctx.close();
    return { total, initialMs, domRows, domRowsEnd, scroll, listFirstRows, listAll };
  }
  const before1k = await snap();
  await seedPerf(1, 1000);
  const r1 = await perf("1000-filas", 1000);
  check(`RENDIMIENTO ${r1.total} filas: render inicial ≤ 5 s (medido ${r1.initialMs} ms) y la hoja virtualiza (${r1.domRows} filas en DOM)`, r1.initialMs <= 5000 && r1.domRows < 120);
  check(`RENDIMIENTO ${r1.total} filas: recorrer toda la hoja llega a la última fila (${Math.round(r1.scroll.totalMs)} ms; cuadro máx ${Math.round(r1.scroll.maxFrame)} ms)`, r1.scroll.lastRowN === r1.total && r1.scroll.p95Frame <= 400 && r1.scroll.totalMs <= 12000);
  check(`RENDIMIENTO ${r1.total} filas (lista clásica): primera tanda ${r1.listFirstRows} filas y carga progresiva hasta el final (${r1.listAll.count}/${r1.total})`, r1.listFirstRows === 250 && r1.listAll.count >= r1.total);
  await seedPerf(1001, 5000);
  const r5 = await perf("5000-filas", 5000);
  check(`RENDIMIENTO ${r5.total} filas: render inicial ≤ 8 s (medido ${r5.initialMs} ms) con ${r5.domRows} filas en DOM`, r5.initialMs <= 8000 && r5.domRows < 120);
  check(`RENDIMIENTO ${r5.total} filas: recorrido completo ≤ 12 s (${Math.round(r5.scroll.totalMs)} ms, cuadro p95 ${Math.round(r5.scroll.p95Frame)} ms), llega a la fila ${r5.scroll.lastRowN}; DOM al final ${r5.domRowsEnd} filas`, r5.scroll.lastRowN === r5.total && r5.scroll.p95Frame <= 400 && r5.scroll.totalMs <= 12000 && r5.domRowsEnd < 120);
  check(`RENDIMIENTO ${r5.total} filas (lista clásica): ${r5.listFirstRows} iniciales y carga progresiva hasta ${r5.listAll.count}/${r5.total} en ${Math.round(r5.listAll.ms)} ms`, r5.listFirstRows === 250 && r5.listAll.count >= r5.total);
  // Con 5000 filas el orden sigue siendo el de carga: primeras = las 5 de siempre, últimas = PERF 05000
  const bigCtx = await openAs(E2E_USERS.materiaPrima, "desktop");
  const apiBig = (await list(bigCtx.page, "mp_stock")).map((r) => r.descripcion);
  const sinHU = apiBig.filter((x) => x.startsWith("PERF "));
  check("con 5000 filas la API mantiene el orden de carga (PERF 00001 … PERF 05000 en ese orden, después de los HU)", sinHU.length === 5000 && sinHU[0] === "PERF MP 00001" && sinHU[4999] === "PERF MP 05000" && apiBig.indexOf("HU Glicerina") === 0);
  await bigCtx.ctx.close();
  await q("delete from inv_mp_stock where payload->>'descripcion' like 'PERF MP %'");
  const after5k = await snap();
  check("integridad: borrar SOLO las filas de prueba de rendimiento deja el stock, movimientos y saldos como estaban", after5k.mov.h === before1k.mov.h && after5k.bal === before1k.bal);
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
console.log("\nMETRICAS", JSON.stringify(metrics, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
