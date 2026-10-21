// E2E (Chromium real, build de producción, base DESCARTABLE): filas en blanco al final de Stock MP e Ingresos MP.
// Se escribe directo en la fila en blanco; el registro se crea SOLO cuando la fila está completa (nunca incompleta),
// una sola vez (reintentos/doble Enter no duplican), conserva lo escrito sin conexión y recarga. Escritorio + tablet táctil.
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
const OUT = process.env.OUT ?? "/tmp/mp-filas-vacias";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const TAG = "FV";
const TIPS = {
  desktop: { viewport: { width: 1280, height: 900 } },
  tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1.5 },
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
async function openTab(page, label, gid) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
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
/** Lleva la hoja al final (filas en blanco) y centra la columna, como haría el usuario al desplazarse. */
async function scrollToDraftCol(page, gid, colIdx) {
  await page.evaluate(([gid, c]) => {
    const grid = document.querySelector(`[data-testid=${gid}]`);
    const sc = grid.querySelector(".dsg-container");
    sc.scrollTop = sc.scrollHeight;
    const h = grid.querySelector(`.dsg-row-header .genus-col-${c}`);
    if (h) {
      const cr = sc.getBoundingClientRect();
      const er = h.getBoundingClientRect();
      sc.scrollLeft += er.left - cr.left - cr.width / 3;
    }
  }, [gid, colIdx]);
  await page.waitForTimeout(250);
}
/** Celda de la fila en blanco número `k` (0 = la primera libre) en la columna con ese título. */
async function draftCell(page, gid, k, title) {
  // La planilla virtualiza columnas: se desplaza a la derecha hasta que aparezca el encabezado buscado.
  await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft = 0; }, gid);
  await page.waitForTimeout(350); // la planilla vuelve a dibujar las primeras columnas
  let c;
  for (let i = 0; i < 25 && c === undefined; i++) {
    { const m = await colMap(page, gid); const t = title.toLowerCase(); c = m[t] ?? Object.entries(m).find(([k]) => k.startsWith(`${t} `))?.[1]; } // «Fecha / Ingreso» = Fecha
    if (c === undefined) {
      await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft += 260; }, gid);
      await page.waitForTimeout(150);
    }
  }
  if (c === undefined) throw new Error(`columna no encontrada: ${title} (${Object.keys(await colMap(page, gid))})`);
  await scrollToDraftCol(page, gid, c);
  return page.locator(`[data-testid=${gid}] .genus-draft-row`).nth(k).locator(`.genus-col-${c}`).first();
}
async function typeDraft(page, gid, k, title, value, kind) {
  const c = await draftCell(page, gid, k, title);
  // La hoja se ajusta al alto de la ventana: la fila en blanco puede quedar bajo el encabezado fijo o fuera de la vista.
  await c.evaluate((el) => {
    const sc = el.closest(".dsg-container");
    if (!sc) return;
    const r = el.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    if (r.top < s.top + 44 || r.bottom > s.bottom - 8) sc.scrollTop += r.top - s.top - 60;
  });
  await page.waitForTimeout(250);
  const b = await c.boundingBox();
  if (!b) throw new Error(`celda sin caja: ${title}`);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (kind === "tablet") await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}
const blankCount = (page, gid) => page.locator(`[data-testid=${gid}] .genus-draft-row`).count();
const stockRows = (desc) => q("select payload from inv_mp_stock where payload->>'descripcion' = $1", [desc]);
const ingRows = (desc) => q("select payload from inv_mp_ingresos where payload->>'descripcion' = $1", [desc]);

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos"]) await q(`delete from ${t} where payload::text like '%${TAG} %'`);
  await q(`delete from mp_stock_movements where codigo like 'INT-MP-%' and created_at > now() - interval '1 day' and reason like '%${TAG}%'`).catch(() => undefined);
}

try {
  await cleanup();
  // ================= STOCK · ESCRITORIO =================
  const mpu = await openAs(E2E_USERS.materiaPrima, "desktop");
  const mp = mpu.page;
  const GS = "mp-stock-grid";
  await openTab(mp, "Stock", GS);
  check("Stock: hay filas en blanco al final para escribir directo (sin «Nuevo»)", (await blankCount(mp, GS)) >= 6, String(await blankCount(mp, GS)));
  const blanks0 = await blankCount(mp, GS);
  await typeDraft(mp, GS, 0, "Descripción", `${TAG} Glicerina fila`, "desktop");
  await typeDraft(mp, GS, 0, "Lote", "FV-L1", "desktop");
  await mp.waitForTimeout(2800);
  check("fila incompleta (falta cantidad): NO se crea en la base", (await stockRows(`${TAG} Glicerina fila`)).length === 0);
  check("avisa qué falta y que no se guarda hasta completar", /sin completar/.test((await mp.locator(`[data-testid=${GS}-drafts-info]`).innerText()).toLowerCase()) || /sin completar/.test(await mp.locator(`[data-testid=${GS}-drafts-info]`).innerText()));
  await mp.screenshot({ path: `${OUT}/01-fila-incompleta.png` });
  // Recargar: lo escrito en la fila incompleta se conserva en el navegador (no se pierde).
  await mp.reload();
  await mp.locator(`[data-testid=${GS}]`).waitFor({ timeout: 120_000 });
  await mp.waitForTimeout(1200);
  const keptVal = await (await draftCell(mp, GS, 0, "Descripción")).locator("input").first().inputValue().catch(async () => (await (await draftCell(mp, GS, 0, "Descripción")).innerText()));
  check("al recargar, la fila incompleta conserva lo escrito (almacenamiento local)", /FV Glicerina fila/.test(keptVal), keptVal);
  await typeDraft(mp, GS, 0, "Kg lote", "25,5", "desktop");
  const created = await waitDb(async () => (await stockRows(`${TAG} Glicerina fila`)).length === 1, 15_000);
  check("al completar la fila se CREA el registro en Stock (una sola vez)", created);
  await mp.waitForTimeout(2500);
  const rowsNow = await stockRows(`${TAG} Glicerina fila`);
  check("sin duplicados tras reintentos/recargas", rowsNow.length === 1 && Number(rowsNow[0].payload.cantidadKg) === 25.5 && rowsNow[0].payload.lote === "FV-L1", JSON.stringify(rowsNow[0]?.payload ?? {}).slice(0, 140));
  check("las filas en blanco se reponen (siempre hay filas libres)", (await blankCount(mp, GS)) >= blanks0 - 1);
  // Fecha inválida: no crea nada y avisa.
  await typeDraft(mp, GS, 0, "Descripción", `${TAG} Mala fecha`, "desktop");
  await typeDraft(mp, GS, 0, "Lote", "FV-L2", "desktop");
  await typeDraft(mp, GS, 0, "Kg lote", "5", "desktop");
  await typeDraft(mp, GS, 0, "Vencimiento", "31/02/2027", "desktop");
  await mp.waitForTimeout(3000);
  check("vencimiento inválido: no se crea y se explica el error", (await stockRows(`${TAG} Mala fecha`)).length === 0 && /Vencimiento/.test(await mp.locator(`[data-testid=${GS}-drafts-error]`).first().innerText().catch(() => "")));
  await mpu.ctx.close();

  // ================= STOCK · TABLET (dedo) =================
  const tb = await openAs(E2E_USERS.materiaPrima, "tablet");
  await openTab(tb.page, "Stock", GS);
  await typeDraft(tb.page, GS, 0, "Descripción", `${TAG} Tablet gel`, "tablet");
  await typeDraft(tb.page, GS, 0, "Lote", "FV-T1", "tablet");
  await typeDraft(tb.page, GS, 0, "Kg lote", "12", "tablet");
  check("tablet táctil: escribir con el dedo en la fila en blanco crea el lote", await waitDb(async () => (await stockRows(`${TAG} Tablet gel`)).length === 1, 15_000));
  await tb.page.screenshot({ path: `${OUT}/02-tablet-stock.png` });
  await tb.ctx.close();

  // ================= INGRESOS · ESCRITORIO =================
  const iu = await openAs(E2E_USERS.materiaPrima, "desktop");
  const ip = iu.page;
  const GI = "mp-ingresos-grid";
  await openTab(ip, "Ingresos MP", GI);
  check("Ingresos: filas en blanco al final", (await blankCount(ip, GI)) >= 6);
  const mov0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  await typeDraft(ip, GI, 0, "Fecha", "20/10/2026", "desktop");
  await typeDraft(ip, GI, 0, "Descripción", `${TAG} Agua ingreso`, "desktop");
  await typeDraft(ip, GI, 0, "Proveedor", "Proveedor FV", "desktop");
  await typeDraft(ip, GI, 0, "Lote", "FV-I1", "desktop");
  await typeDraft(ip, GI, 0, "Cantidad", "100", "desktop");
  check("Ingresos: la fila completa registra el ingreso (una sola vez)", await waitDb(async () => (await ingRows(`${TAG} Agua ingreso`)).length === 1, 15_000));
  await ip.waitForTimeout(2500);
  const ing = (await ingRows(`${TAG} Agua ingreso`))[0]?.payload ?? {};
  check("el ingreso queda CONFIRMADO y suma al stock (es un ingreso, no un ajuste)", ing.status === "CONFIRMADO" && ing.fecha === "2026-10-20" && Number(ing.cantidad) === 100, JSON.stringify(ing).slice(0, 160));
  check("movimiento de stock registrado una sola vez", (await q("select count(*)::int n from mp_stock_movements"))[0].n === mov0 + 1, String((await q("select count(*)::int n from mp_stock_movements"))[0].n - mov0));
  // Pegar varias filas desde Excel/Sheets en las filas en blanco.
  const c0 = await draftCell(ip, GI, 0, "Fecha");
  const b0 = await c0.boundingBox();
  await ip.mouse.click(b0.x + b0.width / 2, b0.y + b0.height / 2);
  const rowsTsv = [1, 2, 3].map((n) => ["21/10/2026", `${TAG} Pegado ${n}`, `Prov ${n}`].join("\t")).join("\n");
  // columnas contiguas en el orden de la planilla: Fecha, (Ingreso Nº bloqueado)… → se pega por celda con el portapapeles
  await ip.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, rowsTsv);
  await ip.waitForTimeout(800);
  check("pegar varias filas cae en filas en blanco (incompletas: no se crean)", (await ingRows(`${TAG} Pegado 1`)).length === 0);
  // Sin conexión: la fila completa se conserva y se crea una sola vez al volver.
  await typeDraft(ip, GI, 1, "Fecha", "22/10/2026", "desktop");
  await typeDraft(ip, GI, 1, "Descripción", `${TAG} Offline mp`, "desktop");
  await typeDraft(ip, GI, 1, "Proveedor", "Proveedor Off", "desktop");
  await typeDraft(ip, GI, 1, "Lote", "FV-OFF", "desktop");
  await iu.ctx.setOffline(true);
  await typeDraft(ip, GI, 1, "Cantidad", "40", "desktop");
  await ip.waitForTimeout(3000);
  const offN = (await ingRows(`${TAG} Offline mp`)).length;
  const offErr = (await ip.locator(`[data-testid=${GI}-drafts-error]`).count()) + (await ip.locator(`[data-testid=${GI}-failed]`).count()); // aviso de reintento: de la fila o de la cola sin conexión
  check("sin conexión: no se crea y la fila queda visible con aviso de reintento", offN === 0 && offErr >= 1, JSON.stringify({ offN, offErr, info: await ip.locator(`[data-testid=${GI}-drafts-info]`).innerText().catch(() => "") }));
  await iu.ctx.setOffline(false);
  await ip.evaluate(() => window.dispatchEvent(new Event("online")));
  check("al volver la conexión se crea automáticamente, sin duplicar", await waitDb(async () => (await ingRows(`${TAG} Offline mp`)).length === 1, 20_000));
  await ip.waitForTimeout(2500);
  check("sigue habiendo un solo registro tras el reintento", (await ingRows(`${TAG} Offline mp`)).length === 1);
  await ip.screenshot({ path: `${OUT}/03-ingresos.png` });
  await iu.ctx.close();

  // ================= PERMISOS =================
  const cal = await openAs(E2E_USERS.calidad, "desktop");
  const denied = await cal.page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_stock", payload: { descripcion: `${TAG} Sin permiso`, lote: "X", cantidadKg: 1 } } });
  check("un sector sin permiso de escritura no puede crear (403)", denied.status() === 403 && (await stockRows(`${TAG} Sin permiso`)).length === 0, String(denied.status()));
  await cal.ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
