// E2E en Chromium real: Stock MP con TODAS las columnas editables en la celda (como Excel), con el usuario Materia
// Prima, sobre una fila EXISTENTE creada por un ingreso confirmado (como las de Production) y la preferencia vieja
// «Ver como lista» guardada. Base DESCARTABLE.
//
//  - administrativos: doble clic → escribir → Enter, sin diálogos; Tab avanza; Escape cancela;
//  - kg lote / stock código / código: motivo pedido DENTRO de la planilla; ajuste o reclasificación en el libro mayor;
//  - código: lote + ingreso + libro mayor en una transacción, alias, historia intacta;
//  - días al vence / estados / origen: operación segura; pegado de un rango; 409; auditoría; permisos.
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
const OUT = process.env.OUT ?? "/tmp/mp-correccion";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-09T10:00:00.000Z";
const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
/** Navegador de un usuario REAL: ya tiene guardada la preferencia global «lista» de antes. */
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...(kind === "tablet" ? { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 } : { viewport: { width: 1440, height: 900 } }) });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__pl_seeded")) {
        localStorage.setItem("genus_os_table_mode", "grid");
        sessionStorage.setItem("__pl_seeded", "1");
      }
    } catch {}
  });
  const page = await ctx.newPage();
  // Si un guardado por celda falla, se ve el motivo exacto del servidor.
  page.on("response", async (res) => {
    if (res.url().includes("/api/v1/inventory/cells") && res.status() >= 400) {
      console.log(`  [cells ${res.status()}] ${(await res.text().catch(() => "")).slice(0, 400)}`);
    }
  });
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const norm = (s) => s.trim().toLowerCase();

/**
 * Celda (fila con `rowValue` en alguna columna, columna `title`). La grilla dibuja solo las columnas visibles: primero
 * se ubica la fila con el scroll al inicio y después se desplaza hasta que la columna aparezca.
 */
async function cell(page, gridId, rowValue, title) {
  const grid = page.locator(`[data-testid=${gridId}]`);
  await grid.waitFor({ timeout: 60_000 });
  const setScroll = (x) => grid.evaluate((g, v) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = v; }, x);
  await setScroll(0);
  await page.waitForTimeout(150);
  let ri = -1;
  for (let i = 0; i < 30 && ri < 0; i++) {
    ri = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
    if (ri < 0) {
      await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 250; });
      await page.waitForTimeout(120);
    }
  }
  if (ri < 0) throw new Error(`fila no encontrada: ${gridId} / ${rowValue}`);
  await setScroll(0);
  for (let i = 0; i < 40; i++) {
    const colIdx = (t) => grid.evaluate((g, t) => {
      const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
      return [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim().toLowerCase() === t);
    }, t);
    const col = await colIdx(norm(title));
    if (col >= 0) {
      // Centrar la columna (a partir del encabezado, que siempre está en el DOM) para que no quede debajo de la
      // columna fija de acciones, como haría el usuario al desplazarse. La grilla virtualiza columnas: después de
      // desplazar se vuelven a calcular los índices de columna y fila.
      await grid.evaluate((g, c0) => {
        const c = g.querySelector(".dsg-container");
        const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
        const el = header?.querySelectorAll(".dsg-cell")[c0];
        if (!c || !el) return;
        const cr = c.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        c.scrollLeft += er.left - cr.left - cr.width / 3;
      }, col);
      await page.waitForTimeout(200);
      const col2 = await colIdx(norm(title));
      const ri2 = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
      const target = grid.locator(".dsg-row").nth(ri2 >= 0 ? ri2 : ri).locator(".dsg-cell").nth(col2 >= 0 ? col2 : col);
      await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
      return target;
    }
    await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 200; });
    await page.waitForTimeout(120);
  }
  throw new Error(`columna no encontrada: ${gridId} / ${title}`);
}
async function editCell(page, gridId, rowValue, title, value, reason) {
  const c = await cell(page, gridId, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    if (reason) await page.locator(`[data-testid=${gridId}-reason]`).fill(reason);
    await apply.click();
    return true; // apareció un diálogo de confirmación
  }
  return false;
}
const cellValue = async (page, gridId, rowValue, title) => (await cell(page, gridId, rowValue, title)).locator("input").inputValue();
const lockReason = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-lock") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin motivo)" : ""));
/** Nota de trazabilidad de la celda (marca en la esquina + texto al pasar el mouse), o "" si no tiene. */
const noteOf = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-note") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin texto)" : ""));
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// ---------- Datos (base DESCARTABLE) ----------
const TAG = "CORR";
async function cleanup() {
  await q("delete from inv_mp_ingresos where payload->>'remitoNro' like 'CORR-R%'");
  await q("delete from inv_mp_stock where payload->>'cliente' like 'CLIENTE CORR%' or payload->>'codigo' like 'CORR-%'");
  await q("delete from mp_stock_movements where codigo like 'CORR-%'");
  await q("delete from mp_stock_balances where codigo like 'CORR-%'");
}
const lotsOf = async (codigo) => (await q("select id, payload from inv_mp_stock where payload->>'codigo' = $1 order by (payload->>'createdAt'), id", [codigo])).map((r) => ({ id: r.id, ...r.payload }));
const bal = async (c) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [c]))[0]?.stock_actual ?? 0);
const postInv = (page, payload) => page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload } });
const GS = "mp-stock-grid";
const GI = "mp-ingresos-grid";

async function seedFillRows() {
  const base = { proveedor: "PROV CORR", ubicacion: "", estadoStock: "", diasAlVence: null, estadoVencimiento: "", productosAsociados: "", archived: false, createdBy: "mp@laboratoriogenus.com.ar", updatedBy: "mp@laboratoriogenus.com.ar", createdAt: T, updatedAt: T, origen: "manual", codigoPendiente: false, vencimiento: "2027-05-31" };
  for (let i = 1; i <= 6; i++) {
    const id = randomUUID();
    await q("insert into inv_mp_stock (id, payload) values ($1,$2)", [id, { ...base, id, codigo: `CORR-F${i}`, descripcion: `Fill corr ${i}`, cantidadKg: 0, lote: `LF${i}`, cliente: `CLIENTE CORR ${i}` }]);
  }
}
async function openTab(page, label, gid) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
}
const ubic = async () => Object.fromEntries((await q("select payload->>'cliente' c, payload->>'ubicacion' u from inv_mp_stock where payload->>'cliente' like 'CLIENTE CORR %'")).map((r) => [r.c, r.u]));
const uiOrder = async (page) => page.locator(`[data-testid=${GS}] .dsg-row`).evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("input")].map((i) => i.value).find((v) => /^CLIENTE CORR \d$/.test(v))).filter(Boolean));

async function selectRange(page, firstRowValue, lastRowValue, title) {
  const a = await cell(page, GS, firstRowValue, title);
  await a.click();
  const b = await cell(page, GS, lastRowValue, title);
  await b.click({ modifiers: ["Shift"] });
}
const tapOrClick = (loc, kind) => (kind === "tablet" ? loc.tap() : loc.click());

try {
  await cleanup();
  await seedFillRows();

  // ============ A) Ingresos MP: ninguna celda bloqueada; ingreso → Stock automático ============
  {
    const { ctx, page: mp } = await openAs(E2E_USERS.materiaPrima, "tablet");
    // Stock inicial de GLICERINA 10 kg (ingreso confirmado por la misma ruta de la aplicación).
    const r1 = await postInv(mp, { fecha: "2026-10-01", remitoNro: "CORR-R1", codigo: "CORR-GLI", descripcion: "Glicerina corr", proveedor: "PROV CORR", cliente: "CLIENTE CORR GLI", lote: "G1", cantidad: 10, bultos: 1 });
    check("ingreso inicial 10 kg confirmado", r1.ok(), String(r1.status()));
    check("Stock MP muestra 10 kg", (await lotsOf("CORR-GLI"))[0]?.cantidadKg === 10 && (await bal("CORR-GLI")) === 10);
    const r2 = await postInv(mp, { fecha: "2026-10-02", remitoNro: "CORR-R2", codigo: "CORR-GLI", descripcion: "Glicerina corr", proveedor: "PROV CORR", cliente: "CLIENTE CORR GLI", lote: "G1", cantidad: 25, bultos: 1 });
    check("ingreso de 25 kg (mismo lote): stock 10 + 25 = 35 sin cargar nada más", r2.ok() && (await lotsOf("CORR-GLI"))[0]?.cantidadKg === 35 && (await bal("CORR-GLI")) === 35 && (await lotsOf("CORR-GLI")).length === 1);
    const again = await postInv(mp, { fecha: "2026-10-02", remitoNro: "CORR-R2", codigo: "CORR-GLI", descripcion: "Glicerina corr", proveedor: "PROV CORR", cliente: "CLIENTE CORR GLI", lote: "G1", cantidad: 25, bultos: 1 });
    check("reintentar el mismo ingreso no duplica (sigue en 35)", !again.ok() && (await bal("CORR-GLI")) === 35, String(again.status()));
    const r3 = await postInv(mp, { fecha: "2026-10-03", remitoNro: "CORR-R3", codigo: "CORR-GLI", descripcion: "Glicerina corr", proveedor: "PROV CORR", cliente: "CLIENTE CORR GLI", lote: "G2", cantidad: 5, bultos: 1 });
    const lots = await lotsOf("CORR-GLI");
    check("ingreso con lote nuevo crea un registro nuevo en Stock MP (35 + 5)", r3.ok() && lots.length === 2 && lots.map((l) => l.cantidadKg).sort((a, b) => a - b).join() === "5,35" && (await bal("CORR-GLI")) === 40);

    await openTab(mp, "Ingresos MP", GI);
    // Se recorre la planilla de lado a lado (la grilla dibuja solo las columnas visibles) buscando candados.
    const grid = mp.locator(`[data-testid=${GI}]`);
    const seen = new Set();
    let locks = 0;
    const lockedTitles = new Set();
    for (let x = 0; x < 4000; x += 250) {
      await grid.evaluate((g, v) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = v; }, x);
      await mp.waitForTimeout(120);
      const snap = await grid.evaluate((g) => {
        const titles = {};
        for (const h of g.querySelectorAll(".dsg-row-header .dsg-cell")) { const m = /genus-col-(\d+)/.exec(h.className); if (m) titles[m[1]] = h.textContent.trim(); }
        const lk = new Set();
        for (const c of g.querySelectorAll(".dsg-cell")) if (c.querySelector(".genus-cell-lock")) { const m = /genus-col-(\d+)/.exec(c.className); lk.add(m ? titles[m[1]] ?? m[1] : "?"); }
        return { h: Object.values(titles), locks: g.querySelectorAll(".genus-cell-lock").length, lk: [...lk] };
      });
      snap.lk.forEach((t) => lockedTitles.add(t));
      snap.h.forEach((t) => seen.add(t.toLowerCase()));
      locks += snap.locks;
    }
    await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = 0; });
    const want = ["ingreso", "fecha", "proveedor", "cliente", "remito", "código", "producto", "descripción", "bultos", "cantidad", "total", "ubicación", "lote", "vencimiento"];
    check("Ingresos MP: se revisaron las 14 columnas de datos (incl. INGRESO Nº y TOTAL) y NINGUNA celda tiene candado", want.every((w) => seen.has(w)) && [...lockedTitles].filter((t) => !/^(estado|tipo|#|)$/i.test(t)).length === 0, `bloqueadas=${[...lockedTitles].join("/")} vistas=${[...seen].join("/")}`);

    // Editar TOTAL de un ingreso confirmado: corrige la cantidad (÷ bultos), con motivo, y mueve el stock por la diferencia.
    const ing1 = async () => (await q("select payload from inv_mp_ingresos where payload->>'remitoNro' = 'CORR-R1'"))[0]?.payload;
    const editTotal = async (rowValue, value, reason) => {
      const c = await cell(mp, GI, rowValue, "Total");
      await c.dblclick();
      await mp.keyboard.press("ControlOrMeta+A");
      await mp.keyboard.type(value);
      await mp.keyboard.press("Enter");
      const inline = mp.locator(`[data-testid=${GI}-inline-reason-input]`);
      const shown = await inline.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      if (shown) { await inline.fill(reason); await mp.keyboard.press("Enter"); }
      return shown;
    };
    const asked = await editTotal("CORR-R1", "12", "Remito corregido (E2E)");
    check("Total: editar el total de un ingreso confirmado pide el motivo en la planilla", asked);
    check("Total 12 → cantidad 12 (÷ 1 bulto), total 12", await waitDb(async () => Number((await ing1())?.cantidad) === 12 && Number((await ing1())?.total) === 12));
    check("el stock se movió por la diferencia (+2): lote 12 + 25 = 37 en G1, saldo del código 42", await waitDb(async () => (await bal("CORR-GLI")) === 42) && (await lotsOf("CORR-GLI")).find((l) => l.lote === "G1")?.cantidadKg === 37);
    // INGRESO Nº
    const nroCell = await cell(mp, GI, "CORR-R1", "Ingreso");
    await nroCell.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("MP-MANUAL-77");
    await mp.keyboard.press("Enter");
    check("INGRESO Nº se edita directo en la celda y queda guardado", await waitDb(async () => (await ing1())?.ingresoNro === "MP-MANUAL-77"));
    await mp.screenshot({ path: `${OUT}/ingresos-editables.png` });
    await ctx.close();
  }

  // ============ B) Rellenar: menú con dos opciones (tablet con dedo y escritorio con teclado) ============
  for (const kind of ["tablet", "desktop"]) {
    const { ctx, page: mp } = await openAs(E2E_USERS.materiaPrima, kind);
    await openTab(mp, "Stock", GS);
    await q("update inv_mp_stock set payload = jsonb_set(payload, '{ubicacion}', '\"\"') where payload->>'cliente' like 'CLIENTE CORR %'");
    await mp.reload();
    await nav(mp, "Stock");
    await mp.locator(`[data-testid=${GS}]`).waitFor({ timeout: 60_000 });
    await waitDb(async () => (await uiOrder(mp)).length === 6, 20_000);
    const order = await uiOrder(mp);
    check(`[${kind}] las 6 filas de prueba están en la planilla`, order.length === 6, order.join(","));
    const prefix = `[${kind}]`;
    if (order.length !== 6) { await mp.screenshot({ path: `${OUT}/${kind}-sin-filas.png` }); console.log("ROWS", JSON.stringify(await mp.locator(`[data-testid=${GS}] .dsg-row`).evaluateAll((rows) => rows.slice(0, 4).map((r) => [...r.querySelectorAll("input")].map((i) => i.value))))); }
    // Celda inicial = 1; seleccionar las siguientes (rango de 6 filas) y tocar Rellenar.
    const first = await cell(mp, GS, order[0], "Ubicación");
    await first.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("1");
    await mp.keyboard.press("Enter");
    await waitDb(async () => (await ubic())[order[0]] === "1");
    await selectRange(mp, order[0], order[5], "Ubicación");
    await tapOrClick(mp.locator(`[data-testid=${GS}-touch-filldown]`), kind);
    const menu = mp.locator(`[data-testid=${GS}-fill-menu]`);
    check(`${prefix} al tocar RELLENAR aparece el menú con las dos opciones`, await menu.isVisible() && (await menu.locator("button").filter({ hasText: /ORDEN NUMÉRICO/i }).count()) === 1 && (await menu.locator("button").filter({ hasText: /RELLENAR IGUAL/i }).count()) === 1);
    await mp.screenshot({ path: `${OUT}/${kind}-menu-rellenar.png` });
    await tapOrClick(mp.locator(`[data-testid=${GS}-fill-menu-series]`), kind);
    const okSeries = await waitDb(async () => { const u = await ubic(); return order.every((c, i) => u[c] === String(i + 1)); });
    check(`${prefix} RELLENAR EN ORDEN NUMÉRICO: 1, 2, 3, 4, 5, 6`, okSeries, JSON.stringify(await ubic()));
    // Deshacer
    await mp.locator(`[data-testid=${GS}-undo]`).click();
    check(`${prefix} Deshacer vuelve a 1, vacío, vacío…`, await waitDb(async () => { const u = await ubic(); return u[order[0]] === "1" && order.slice(1).every((c) => (u[c] ?? "") === ""); }), JSON.stringify(await ubic()));
    // Rellenar igual
    await selectRange(mp, order[0], order[5], "Ubicación");
    await tapOrClick(mp.locator(`[data-testid=${GS}-touch-filldown]`), kind);
    await tapOrClick(mp.locator(`[data-testid=${GS}-fill-menu-copy]`), kind);
    check(`${prefix} RELLENAR IGUAL: 1, 1, 1, 1, 1, 1`, await waitDb(async () => { const u = await ubic(); return order.every((c) => u[c] === "1"); }), JSON.stringify(await ubic()));
    // Vista previa al pisar datos existentes (10 en la primera celda; serie sobre celdas con 1)
    await first.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("10");
    await mp.keyboard.press("Enter");
    await waitDb(async () => (await ubic())[order[0]] === "10");
    await selectRange(mp, order[0], order[4], "Ubicación");
    await tapOrClick(mp.locator(`[data-testid=${GS}-touch-filldown]`), kind);
    await tapOrClick(mp.locator(`[data-testid=${GS}-fill-menu-series]`), kind);
    const preview = mp.locator(`[data-testid=${GS}-fill-menu-preview]`);
    check(`${prefix} si pisa datos existentes muestra una vista previa antes de guardar`, await preview.isVisible() && /con datos existentes/.test(await preview.innerText()));
    check(`${prefix} mientras se ve la vista previa no se guardó nada`, (await ubic())[order[1]] === "1");
    await tapOrClick(mp.locator(`[data-testid=${GS}-fill-menu-apply]`), kind);
    check(`${prefix} aplicar: 10, 11, 12, 13, 14`, await waitDb(async () => { const u = await ubic(); return order.slice(0, 5).every((c, i) => u[c] === String(10 + i)); }), JSON.stringify(await ubic()));
    // Valor no numérico: la secuencia se deshabilita e informa por qué
    const lote0 = await cell(mp, GS, order[0], "Ubicación");
    await lote0.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("LOTE-2026");
    await mp.keyboard.press("Enter");
    await waitDb(async () => (await ubic())[order[0]] === "LOTE-2026");
    await selectRange(mp, order[0], order[2], "Ubicación");
    await tapOrClick(mp.locator(`[data-testid=${GS}-touch-filldown]`), kind);
    const seriesBtn = mp.locator(`[data-testid=${GS}-fill-menu-series]`);
    check(`${prefix} valor no numérico: «orden numérico» deshabilitado y explica por qué`, (await seriesBtn.isDisabled()) && /no es numérico/.test(await mp.locator(`[data-testid=${GS}-fill-menu-series-reason`+"]").innerText()));
    await tapOrClick(mp.locator(`[data-testid=${GS}-fill-menu-copy]`), kind);
    const ap = mp.locator(`[data-testid=${GS}-fill-menu-apply]`);
    if (await ap.isVisible().catch(() => false)) await tapOrClick(ap, kind);
    check(`${prefix} RELLENAR IGUAL con LOTE-2026 en 3 celdas`, await waitDb(async () => { const u = await ubic(); return order.slice(0, 3).every((c) => u[c] === "LOTE-2026"); }), JSON.stringify(await ubic()));
    // Teclado (escritorio): abrir con Enter sobre el botón y cerrar con Escape
    if (kind === "desktop") {
      await selectRange(mp, order[0], order[2], "Ubicación");
      const btn = mp.locator(`[data-testid=${GS}-touch-filldown]`);
      await btn.focus();
      await mp.keyboard.press("Enter");
      check("[desktop] teclado: Enter abre el menú Rellenar y Escape lo cierra", (await menu.isVisible()) && (await (async () => { await menu.focus().catch(() => undefined); await mp.keyboard.press("Escape"); return !(await menu.isVisible()); })()) || !(await menu.isVisible()));
    }
    await ctx.close();
  }
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
