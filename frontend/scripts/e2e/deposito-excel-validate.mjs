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
const OUT = process.env.OUT ?? "/tmp/deposito-excel";
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
const TAG = "DEPX";
const COD = "DEPX-TAPA";
async function cleanup() {
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'DEPX%'`);
  await q("delete from inv_ajustes where payload->>'entityId' in (select id::text from inv_me_materials where payload->>'codigo' like 'DEPX%')").catch(() => undefined);
  await q("delete from inv_me_ingresos where payload->>'remitoNro' like 'DEPX-%'");
}
const post = (page, payload, resource = "me_ingresos", action = "upsert") => page.request.post("/api/v1/inventory", { data: { action, resource, payload } });
const ingByRemito = async (r) => (await q("select payload from inv_me_ingresos where payload->>'remitoNro' = $1", [r]))[0]?.payload;
const stockOf = async (codigo) => Number((await q("select coalesce(sum((payload->>'total')::numeric),0) s from inv_me_ingresos where payload->>'codigo' = $1 and coalesce((payload->>'anulado')::boolean,false) = false", [codigo]))[0].s)
  - Number((await q("select coalesce(sum((payload->>'total')::numeric),0) s from inv_me_salidas where payload->>'codigo' = $1 and coalesce((payload->>'descuentaStock')::boolean,false) = true and coalesce((payload->>'reverted')::boolean,false) = false", [codigo]))[0].s)
  + Number((await q("select coalesce(sum((a.payload->>'diferencia')::numeric),0) s from inv_ajustes a join inv_me_materials m on m.id::text = a.payload->>'entityId' where m.payload->>'codigo' = $1", [codigo]))[0].s);
async function openTab(page, label, gid) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
}
async function colMap(page, gid) {
  return page.evaluate((gid) => {
    const out = {};
    for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) {
      const m = /genus-col-(\d+)/.exec(h.className);
      if (m) out[h.textContent.trim().toLowerCase()] = Number(m[1]);
    }
    return out;
  }, gid);
}
async function scrollToDraftCol(page, gid, colIdx) {
  await page.evaluate(([gid, c]) => {
    const grid = document.querySelector(`[data-testid=${gid}]`);
    const sc = grid.querySelector(".dsg-container");
    sc.scrollTop = sc.scrollHeight;
    const h = grid.querySelector(`.dsg-row-header .genus-col-${c}`);
    if (h) { const cr = sc.getBoundingClientRect(); const er = h.getBoundingClientRect(); sc.scrollLeft += er.left - cr.left - cr.width / 3; }
  }, [gid, colIdx]);
  await page.waitForTimeout(250);
}
async function draftCell(page, gid, k, title) {
  let c = (await colMap(page, gid))[title.toLowerCase()];
  // La planilla virtualiza columnas: se prueba desde el inicio y después hacia la derecha hasta que aparezca el encabezado.
  for (let pass = 0; pass < 3 && c === undefined; pass++) {
    await page.keyboard.press("Escape");
    await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft = 0; }, gid);
    await page.waitForTimeout(350);
    c = (await colMap(page, gid))[title.toLowerCase()];
  }
  for (let i = 0; i < 25 && c === undefined; i++) {
    await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft += 260; }, gid);
    await page.waitForTimeout(150);
    c = (await colMap(page, gid))[title.toLowerCase()];
  }
  if (c === undefined) throw new Error(`columna no encontrada: ${title} (${Object.keys(await colMap(page, gid))})`);
  await scrollToDraftCol(page, gid, c);
  return page.locator(`[data-testid=${gid}] .genus-draft-row`).nth(k).locator(`.genus-col-${c}`).first();
}
async function clickBox(page, loc, kind) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("celda sin caja");
  if (kind === "tablet") await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function typeDraft(page, gid, k, title, value, kind) {
  await clickBox(page, await draftCell(page, gid, k, title), kind);
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}
const pasteDoc = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
async function lockScan(page, gid, allowed = []) {
  const grid = page.locator(`[data-testid=${gid}]`);
  const seen = new Set();
  const lockedTitles = new Set();
  for (let x = 0; x < 4000; x += 250) {
    await grid.evaluate((g, v) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = v; }, x);
    await page.waitForTimeout(100);
    const snap = await grid.evaluate((g) => {
      const titles = {};
      for (const h of g.querySelectorAll(".dsg-row-header .dsg-cell")) { const m = /genus-col-(\d+)/.exec(h.className); if (m) titles[m[1]] = h.textContent.trim(); }
      const lk = new Set();
      // Solo filas con datos (las filas en blanco bloquean lo que se completa solo al crear: se revisa aparte).
      for (const r of g.querySelectorAll(".dsg-row:not(.dsg-row-header):not(.genus-draft-row)")) for (const c of r.querySelectorAll(".dsg-cell")) if (c.querySelector(".genus-cell-lock")) { const m = /genus-col-(\d+)/.exec(c.className); lk.add(m ? titles[m[1]] ?? m[1] : "?"); }
      return { h: Object.values(titles), lk: [...lk] };
    });
    snap.lk.forEach((t) => lockedTitles.add(t));
    snap.h.forEach((t) => seen.add(t.toLowerCase()));
  }
  await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = 0; });
  return { seen, locked: [...lockedTitles].filter((t) => !allowed.some((a) => a.toLowerCase() === t.toLowerCase())) };
}
const download = async (page, clickFn) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), clickFn()]);
  const stream = await dl.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};
async function selectRange(page, gid, firstRow, lastRow, title) {
  const a = await cell(page, gid, firstRow, title);
  await a.click();
  const b = await cell(page, gid, lastRow, title);
  await b.click({ modifiers: ["Shift"] });
}
const uiRemitos = (page, gid) => page.locator(`[data-testid=${gid}] .dsg-row`).evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("input")].map((i) => i.value).find((v) => /^DEPX-R\d+$/.test(v))).filter(Boolean));

try {
  await cleanup();
  const GI = "me-ingresos-grid";
  for (const kind of (process.env.ONLY ? [] : ["tablet", "desktop"])) {
    const pre = `[${kind}]`;
    const { ctx, page } = await openAs(E2E_USERS.deposito, kind);
    // Tres ingresos de la tapa DEPX (4 bultos × 25 = 100 cada uno el primero)
    if (kind === "tablet") {
      for (const [n, qty] of [[1, 25], [2, 10], [3, 5]]) {
        const r = await post(page, { fecha: "2026-10-0" + n, proveedor: "Prov DX", cliente: "CLIENTE DX", remitoNro: `DEPX-R${n}`, codigo: COD, descripcionInsumo: "Tapa DEPX", bultos: 4, cantidad: qty, ubicacion: "" });
        check(`ingreso ${n} registrado`, r.ok(), String(r.status()));
      }
      check("el stock del código es 4×25 + 4×10 + 4×5 = 160 (calculado, sin cargar nada más)", (await stockOf(COD)) === 160);
    }
    await openTab(page, "Ingresos ME", GI);
    check(`${pre} Ingresos ME abre como planilla con barra (columnas, filtros, exportar) y SIN paginación`, (await page.locator(`[data-testid=${GI}-viewbar]`).count()) === 1 && (await page.getByText(/Página \d+ \/ \d+/).count()) === 0);
    const scan = await lockScan(page, GI);
    check(`${pre} ninguna celda de datos tiene candado (incl. TOTAL)`, ["fecha", "ingreso nº", "proveedor", "cliente", "remito nº", "código", "descripción insumo", "bultos", "cantidad", "total", "ubicación"].every((w) => scan.seen.has(w)) && scan.locked.length === 0, `bloqueadas=${scan.locked.join("/")} vistas=${[...scan.seen].join("/")}`);
    // TOTAL de un ingreso existente: corrige la cantidad por bulto
    if (kind === "tablet") {
      const c = await cell(page, GI, "DEPX-R1", "Total");
      await c.dblclick();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("120");
      await page.keyboard.press("Enter");
      const apply = page.locator(`[data-testid=${GI}-preview-apply]`);
      if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply.click();
      check("TOTAL 120 ÷ 4 bultos → cantidad 30, total 120 y el stock sube a 180", await waitDb(async () => Number((await ingByRemito("DEPX-R1"))?.cantidad) === 30 && Number((await ingByRemito("DEPX-R1"))?.total) === 120) && (await stockOf(COD)) === 180);
    }
    // Fila en blanco: escribir directo crea el ingreso (una sola vez) y suma al stock
    const rem = kind === "tablet" ? "DEPX-R4" : "DEPX-R8";
    await typeDraft(page, GI, 0, "Fecha", "10/10/2026", kind);
    await typeDraft(page, GI, 0, "Remito Nº", rem, kind);
    await typeDraft(page, GI, 0, "Código", COD, kind);
    await typeDraft(page, GI, 0, "Descripción insumo", "Tapa DEPX", kind);
    await typeDraft(page, GI, 0, "Cantidad", "7", kind);
    const okDraft = await waitDb(async () => (await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' = $1", [rem]))[0].n === 1, 25_000);
    if (!okDraft) console.log("DEBUG draft", JSON.stringify(await page.locator(`[data-testid=${GI}-draft-info], [data-testid=${GI}-notice]`).allInnerTexts()), JSON.stringify(await page.locator(`[data-testid=${GI}] .genus-draft-row`).first().evaluate((r) => [...r.querySelectorAll("input")].map((i) => i.value))));
    check(`${pre} fila en blanco completa: se crea UN ingreso y suma al stock`, await waitDb(async () => (await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' = $1", [rem]))[0].n === 1, 25_000) && Number((await ingByRemito(rem))?.total) === 7);
    // Pegado de varias filas (orden de la planilla): Fecha, Ingreso Nº, Proveedor, Cliente, Remito, Código, Descripción, Bultos, Cantidad, Total, Ubicación
    const base = kind === "tablet" ? 10 : 20;
    await clickBox(page, await draftCell(page, GI, 0, "Fecha"), kind);
    await pasteDoc(page, [1, 2, 3].map((n) => [`${14 - n}/${kind === "tablet" ? "10" : "11"}/2026`, "", "Prov DX", "", `DEPX-R${base + n}`, COD, "Tapa DEPX", "", String(n), "", ""].join("\t")).join("\n"));
    check(`${pre} pegar 3 filas desde Excel: se crean las 3 (una vez cada una)`, await waitDb(async () => (await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' in ($1,$2,$3)", [`DEPX-R${base + 1}`, `DEPX-R${base + 2}`, `DEPX-R${base + 3}`]))[0].n === 3, 30_000));
    await page.waitForTimeout(2500);
    check(`${pre} sin duplicados tras esperar`, (await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' like 'DEPX-R%'"))[0].n === (kind === "tablet" ? 7 : 11));
    // Rellenar numérico / igual sobre «Ubicación» de los 3 pegados
    const trio = new Set([`DEPX-R${base + 1}`, `DEPX-R${base + 2}`, `DEPX-R${base + 3}`]);
    await waitDb(async () => (await uiRemitos(page, GI)).filter((x) => trio.has(x)).length === 3, 20_000);
    // El orden de filas con la misma fecha puede cambiar al recargar: se relee antes de cada selección.
    const order3 = async () => (await uiRemitos(page, GI)).filter((x) => trio.has(x));
    const pickRange = async () => { const o = await order3(); await selectRange(page, GI, o[0], o[2], "Ubicación"); return o; };
    let o = await order3();
    const first = await cell(page, GI, o[0], "Ubicación");
    await first.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("1");
    await page.keyboard.press("Enter");
    await waitDb(async () => (await ingByRemito(o[0]))?.ubicacion === "1");
    await page.waitForTimeout(1200);
    o = await pickRange();
    const [r1, r2, r3] = o;
    await (kind === "tablet" ? page.locator(`[data-testid=${GI}-touch-filldown]`).tap() : page.locator(`[data-testid=${GI}-touch-filldown]`).click());
    check(`${pre} RELLENAR muestra las dos opciones`, (await page.locator(`[data-testid=${GI}-fill-menu-series]`).isVisible()) && (await page.locator(`[data-testid=${GI}-fill-menu-copy]`).isVisible()));
    await (kind === "tablet" ? page.locator(`[data-testid=${GI}-fill-menu-series]`).tap() : page.locator(`[data-testid=${GI}-fill-menu-series]`).click());
    check(`${pre} RELLENAR EN ORDEN NUMÉRICO: 1, 2, 3`, await waitDb(async () => (await ingByRemito(r1))?.ubicacion === "1" && (await ingByRemito(r2))?.ubicacion === "2" && (await ingByRemito(r3))?.ubicacion === "3", 25_000));
    await page.locator(`[data-testid=${GI}-undo]`).click();
    check(`${pre} Deshacer vuelve a 1, vacío, vacío`, await waitDb(async () => (await ingByRemito(r3))?.ubicacion === "" , 25_000));
    await page.waitForTimeout(1200);
    await pickRange();
    await (kind === "tablet" ? page.locator(`[data-testid=${GI}-touch-filldown]`).tap() : page.locator(`[data-testid=${GI}-touch-filldown]`).click());
    await (kind === "tablet" ? page.locator(`[data-testid=${GI}-fill-menu-copy]`).tap() : page.locator(`[data-testid=${GI}-fill-menu-copy]`).click());
    check(`${pre} RELLENAR IGUAL: 1, 1, 1`, await waitDb(async () => (await ingByRemito(r3))?.ubicacion === "1" && (await ingByRemito(r2))?.ubicacion === "1", 25_000));
    // Filtros, orden, exportar
    await page.locator(`[data-testid=${GI}-filters-btn]`).click();
    await page.locator(`[data-testid=${GI}-filter][data-col="REMITO Nº"]`).fill(`DEPX-R${base + 2}`);
    await page.waitForTimeout(500);
    check(`${pre} filtro por columna: solo el ingreso buscado`, (await uiRemitos(page, GI)).length === 1 && /Mostrando 1 de/.test(await page.locator(`[data-testid=${GI}-filter-count]`).innerText()));
    const csv = await download(page, () => page.locator(`[data-testid=${GI}-export-csv]`).click());
    check(`${pre} exportar CSV: respeta el filtro (encabezados + 1 fila)`, /FECHA/.test(csv) && csv.trim().split(/\r?\n/).length === 2 && csv.includes(`DEPX-R${base + 2}`), csv.slice(0, 120));
    await page.locator(`[data-testid=${GI}-filter][data-col="REMITO Nº"]`).fill("");
    await page.locator(`[data-testid=${GI}-sort-col]`).selectOption("CANTIDAD");
    await page.locator(`[data-testid=${GI}-sort-dir]`).click();
    await page.waitForTimeout(400);
    const ordered = await uiRemitos(page, GI);
    const qtyOf = async (rm) => Number((await ingByRemito(rm))?.cantidad);
    check(`${pre} ordenar por cantidad (descendente): la primera fila tiene la mayor cantidad`, ordered.length >= 3 && (await qtyOf(ordered[0])) >= (await qtyOf(ordered[1])) && (await qtyOf(ordered[1])) >= (await qtyOf(ordered[ordered.length - 1])), ordered.join(","));
    await page.locator(`[data-testid=${GI}-view-reset]`).click().catch(() => undefined);
    // Buscar y reemplazar
    await page.locator(`[data-testid=${GI}-find-btn]`).click();
    await page.locator(`[data-testid=${GI}-find-text]`).fill("Prov DX");
    await page.locator(`[data-testid=${GI}-replace-text]`).fill("Prov DX2");
    await page.locator(`[data-testid=${GI}-find-col]`).selectOption("PROVEEDOR");
    await page.waitForTimeout(400);
    await page.locator(`[data-testid=${GI}-replace-all]`).click();
    const conf = page.locator(`[data-testid=${GI}-replace-confirm]`);
    if (await conf.isVisible().catch(() => false)) await conf.click();
    check(`${pre} buscar y reemplazar cambia el proveedor en las filas`, await waitDb(async () => (await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' like 'DEPX-R%' and payload->>'proveedor' = 'Prov DX2'"))[0].n >= 4, 30_000));
    await page.keyboard.press("Escape");
    await page.reload();
    await nav(page, "Ingresos ME");
    await page.locator(`[data-testid=${GI}]`).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
    check(`${pre} después de recargar los datos siguen (planilla con ${kind === "tablet" ? 7 : 11} ingresos de prueba)`, (await uiRemitos(page, GI)).length >= 4);
    await page.screenshot({ path: `${OUT}/${kind}-ingresos.png` });
    await ctx.close();
  }

  // ============ Recuperación sin conexión (escritorio) ============
  if (!process.env.ONLY) {
    const { ctx, page } = await openAs(E2E_USERS.deposito, "desktop");
    await openTab(page, "Ingresos ME", GI);
    let blocked = true;
    await page.route("**/api/v1/inventory/cells", (route) => (blocked ? route.abort() : route.continue()));
    const c = await cell(page, GI, "DEPX-R1", "Ubicación");
    await c.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("SIN-RED");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    check("sin conexión: el cambio NO se pierde (queda pendiente/reintentable) y la base no cambió", (await ingByRemito("DEPX-R1"))?.ubicacion !== "SIN-RED" && (await page.locator(`[data-testid=${GI}-status]`).getAttribute("data-state")) !== "saved");
    blocked = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    check("al volver la conexión se reintenta solo y se guarda", await waitDb(async () => (await ingByRemito("DEPX-R1"))?.ubicacion === "SIN-RED", 40_000));
    await ctx.close();
  }

  // ============ Inventario ME ============
  if (!process.env.ONLY) {
    const GV = "me-inventario-grid";
    const { ctx, page } = await openAs(E2E_USERS.deposito, "tablet");
    await openTab(page, "Inventario ME", GV);
    check("Inventario ME abre como planilla con barra", (await page.locator(`[data-testid=${GV}-viewbar]`).count()) === 1);
    const scan = await lockScan(page, GV);
    check("Inventario: ninguna celda de datos con candado (código, bultos, cantidad total incluidos)", ["código", "cliente", "insumo", "bultos", "cantidad total", "ubicación"].every((w) => scan.seen.has(w)) && scan.locked.length === 0, `bloqueadas=${scan.locked.join("/")}`);
    const stock0 = await stockOf(COD);
    const c = await cell(page, GV, COD, "Cantidad total");
    await c.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(String(stock0 - 10));
    await page.keyboard.press("Enter");
    const apply = page.locator(`[data-testid=${GV}-preview-apply]`);
    if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply.click();
    check("CANTIDAD TOTAL: genera un AJUSTE auditado de −10 (el stock calculado baja 10)", await waitDb(async () => (await stockOf(COD)) === stock0 - 10, 25_000) && (await q("select count(*)::int n from inv_ajustes where payload->>'diferencia' = '-10' and payload->>'module' = 'ME'"))[0].n >= 1);
    // Fila en blanco: alta de material
    await typeDraft(page, GV, 0, "Código", "DEPX-NUEVO", "tablet");
    await typeDraft(page, GV, 0, "Insumo", "Material nuevo DEPX", "tablet");
    check("fila en blanco de Inventario: crea el material (stock 0, una sola vez)", await waitDb(async () => (await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = 'DEPX-NUEVO'"))[0].n === 1, 25_000));
    // CÓDIGO: renombrar
    const cc = await cell(page, GV, "DEPX-NUEVO", "Código");
    await cc.dblclick();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("DEPX-NUEVO2");
    await page.keyboard.press("Enter");
    const apply2 = page.locator(`[data-testid=${GV}-preview-apply]`);
    if (await apply2.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply2.click();
    check("CÓDIGO: se renombra el material (sin duplicar)", await waitDb(async () => (await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = 'DEPX-NUEVO2'"))[0].n === 1 && (await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = 'DEPX-NUEVO'"))[0].n === 0, 25_000));
    await page.screenshot({ path: `${OUT}/tablet-inventario.png` });
    await ctx.close();
  }

  // ============ Salidas ME ============
  {
    const GSA = "me-salidas-grid";
    const { ctx, page } = await openAs(E2E_USERS.deposito, "desktop");
    await openTab(page, "Salidas ME", GSA);
    check("Salidas ME abre como planilla con barra y sin paginación", (await page.locator(`[data-testid=${GSA}-viewbar]`).count()) === 1 && (await page.getByText(/Página \d+ \/ \d+/).count()) === 0);
    const stockAntes = await stockOf(COD);
    // Se pega una fila completa «como sale de Excel» (en el orden de la planilla): Fecha, Egreso, Cliente, Remito, Descripción, Bultos,
    // Cantidad, Total, Control, Entregado, Comentarios, Código, Motivo, Descuenta stock.
    await clickBox(page, await draftCell(page, GSA, 0, "Fecha"), "desktop");
    await pasteDoc(page, ["15/10/2026", "", "CLIENTE DX", "", "Salida DEPX", "", "3", "", "", "", "", COD, "", ""].join("\t"));
    await page.waitForTimeout(1500);
    check("fila en blanco de Salidas: registra una salida MANUAL que NO descuenta (solo registro)", await waitDb(async () => (await q("select count(*)::int n from inv_me_salidas where payload->>'descripcion' = 'Salida DEPX'"))[0].n === 1, 25_000) && (await q("select payload from inv_me_salidas where payload->>'descripcion' = 'Salida DEPX'"))[0].payload.descuentaStock === false);
    check("el stock no cambió por esa salida (no descuenta)", (await stockOf(COD)) === stockAntes);
    await ctx.close();
  }

  // ============ Permisos ============
  {
    const { ctx, page } = await openAs(E2E_USERS.produccion, "desktop");
    const r = await post(page, { fecha: "2026-10-05", remitoNro: "DEPX-NOPERM", codigo: COD, bultos: 1, cantidad: 1 });
    check("Producción no registra ingresos de Depósito (403)", r.status() === 403, String(r.status()));
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
