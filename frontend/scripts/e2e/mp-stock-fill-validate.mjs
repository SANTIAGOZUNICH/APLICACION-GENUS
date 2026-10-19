// E2E en Chromium real (escritorio + TABLET con dedo): relleno numérico arrastrando en Stock MP. Base DESCARTABLE.
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
const OUT = process.env.OUT ?? "/tmp/mp-stock-fill";
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
const debugPages = [];
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
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
const TAG = "XF";

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos", "inv_mp_compras"]) await q(`delete from ${t} where payload::text like '%${TAG}-%' or payload::text like '%${TAG} %'`);
  await q(`delete from mp_stock_movements where codigo like '${TAG}-%'`);
  await q(`delete from mp_stock_balances where codigo like '${TAG}-%'`);
}
async function openTab(page, label, gridId) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator(`[data-testid=${gridId}]`).waitFor({ timeout: 120_000 });
}


const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const noDialog = (page) => page.locator("[role=dialog]").count().then((n) => n === 0);

/** Índice de columna por título (clase genus-col-N de los encabezados renderizados). */
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
async function cellLoc(page, gid, row, title) {
  const map = await colMap(page, gid);
  const c = map[title.toLowerCase()];
  if (c === undefined) throw new Error(`columna no encontrada: ${title} (${Object.keys(map)})`);
  return page.locator(`[data-testid=${gid}] .dsg-row`).nth(row + 1).locator(`.genus-col-${c}`).first();
}
const centerOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function typeInCell(page, gid, row, title, value) {
  const c = await cellLoc(page, gid, row, title);
  await c.click();
  await page.keyboard.type(value); // seleccionar y escribir REEMPLAZA el contenido (como Excel)
  await page.keyboard.press("Enter");
}
async function pasteText(page, text) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
const stockBy = async (codigo) => (await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [codigo]))[0]?.payload;
const compraBy = async (mat) => (await q("select payload from inv_mp_compras where payload->>'materiaPrima' = $1", [mat]))[0]?.payload;
const status = (page, gid) => page.locator(`[data-testid=${gid}-status]`).getAttribute("data-state");
const savedStatus = (page, gid) => waitDb(async () => (await status(page, gid)) === "saved" || (await status(page, gid)) === "idle");

async function dragFill(page, gid, toRow, toTitle, { hold = 0 } = {}) {
  const h = page.locator(`[data-testid=${gid}-fill-handle]`);
  await h.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300); // el controlador se reposiciona tras cambiar la selección
  const hb = await h.boundingBox();
  const target = await centerOf(await cellLoc(page, gid, toRow, toTitle));
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 14 });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}

const GS = "mp-stock-grid";
const KG = [100, 110, 5, 6, 7, 100, 90, 9]; // fila 0..7
const codeOf = (i) => `${TAG}-${String(i).padStart(3, "0")}`;
const kgNow = async (i) => Number((await stockBy(codeOf(i))).cantidadKg);
const movCount = async () => (await q("select count(*)::int n from mp_stock_movements"))[0].n;
const reseed = async () => {
  for (let i = 0; i < KG.length; i++) await q("update inv_mp_stock set payload = jsonb_set(payload, '{cantidadKg}', $2::jsonb) where payload->>'codigo' = $1", [codeOf(i), String(KG[i])]);
};
const openStock = async (page) => { await openTab(page, "Stock", GS); await page.waitForTimeout(1200); };
const clickKg = async (page, row, opts) => (await cellLoc(page, GS, row, "Kg lote")).click(opts);
const dialog = (page) => page.locator(`[data-testid=${GS}-preview]`);

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const mp = mpu.page;
  await mp.setViewportSize({ width: 1280, height: 1000 });
  for (let i = 0; i < KG.length; i++) {
    await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: `${TAG} Materia ${i}`, codigo: codeOf(i), lote: `L${i}`, cantidadKg: KG[i], proveedor: `Proveedor ${i}`, ubicacion: `U${i}`, vencimiento: "2027-06-30", producto: `Producto ${i}`, cliente: `Cliente ${i}`, origen: "manual" } });
  }
  await openStock(mp);
  const mov0 = await movCount();

  // 1) Mouse: 100, 110 → 120, 130, 140 (stock real → confirmación conjunta, sin motivo por celda)
  await clickKg(mp, 0);
  await clickKg(mp, 1, { modifiers: ["Shift"] });
  await dragFill(mp, GS, 4, "Kg lote");
  await dialog(mp).waitFor({ timeout: 10_000 });
  check("100, 110 arrastrado 3 filas: muestra UNA confirmación conjunta con 120, 130, 140 y sin pedir motivo", /120/.test(await dialog(mp).innerText()) && /130/.test(await dialog(mp).innerText()) && /140/.test(await dialog(mp).innerText()) && (await mp.locator(`[data-testid=${GS}-reason]`).count()) === 0);
  check("antes de confirmar NO se guardó nada", (await kgNow(2)) === 5 && (await kgNow(3)) === 6 && (await kgNow(4)) === 7 && (await movCount()) === mov0);
  await mp.screenshot({ path: `${OUT}/01-confirmacion.png` });
  await mp.locator(`[data-testid=${GS}-preview-apply]`).click();
  check("confirmado: se guardan 120, 130, 140 en las filas siguientes", await waitDb(async () => (await kgNow(2)) === 120 && (await kgNow(3)) === 130 && (await kgNow(4)) === 140));
  check("cada cambio de stock queda en el libro mayor con motivo automático («Autocompletar arrastrando») y usuario", await waitDb(async () => (await q("select count(*)::int n from mp_stock_movements where reason like '%Autocompletar arrastrando%' and codigo in ($1,$2,$3) and actor_email is not null", [codeOf(2), codeOf(3), codeOf(4)]))[0].n === 3), JSON.stringify(await q("select codigo, kind, reason from mp_stock_movements where codigo in ($1,$2,$3) order by created_at", [codeOf(2), codeOf(3), codeOf(4)])));
  check("las filas de origen no cambiaron (100 y 110)", (await kgNow(0)) === 100 && (await kgNow(1)) === 110);

  // 2) Descendente: 100, 90 → 80
  await openStock(mp);
  await clickKg(mp, 5);
  await clickKg(mp, 6, { modifiers: ["Shift"] });
  await dragFill(mp, GS, 7, "Kg lote");
  await dialog(mp).waitFor({ timeout: 10_000 });
  await mp.locator(`[data-testid=${GS}-preview-apply]`).click();
  check("100, 90 arrastrado: continúa 80", await waitDb(async () => (await kgNow(7)) === 80));

  // 3) Cancelar la confirmación no guarda nada
  await reseed();
  await openStock(mp);
  const movBeforeCancel = await movCount();
  await clickKg(mp, 0);
  await clickKg(mp, 1, { modifiers: ["Shift"] });
  await dragFill(mp, GS, 3, "Kg lote");
  await dialog(mp).waitFor({ timeout: 10_000 });
  await dialog(mp).getByRole("button", { name: /Cancelar/ }).click();
  await mp.waitForTimeout(800);
  check("cancelar la confirmación no cambia ningún dato ni libro mayor", (await kgNow(2)) === 5 && (await kgNow(3)) === 6 && (await movCount()) === movBeforeCancel);

  // 4) Texto: se copia hacia abajo, directo (columna descriptiva). Valor distinto de los existentes para que se note.
  await q("update inv_mp_stock set payload = jsonb_set(payload, '{lote}', '\"LOTE-ALFA\"') where payload->>'codigo' = $1", [codeOf(0)]);
  await openStock(mp);
  await (await cellLoc(mp, GS, 0, "Lote")).click();
  await dragFill(mp, GS, 2, "Lote");
  check("una celda de texto (Lote) se copia hacia abajo, sin confirmación y sin tocar stock", await waitDb(async () => (await stockBy(codeOf(1))).lote === "LOTE-ALFA" && (await stockBy(codeOf(2))).lote === "LOTE-ALFA") && (await dialog(mp).count()) === 0 && (await movCount()) === movBeforeCancel, JSON.stringify({ l: [(await stockBy(codeOf(0))).lote, (await stockBy(codeOf(1))).lote, (await stockBy(codeOf(2))).lote], dlg: await dialog(mp).count(), mov: [await movCount(), movBeforeCancel] }));

  // 5) Identificadores y columnas calculadas no se rellenan
  await openStock(mp);
  const codes = [(await stockBy(codeOf(1))).codigo, (await stockBy(codeOf(2))).codigo];
  check("el código de MP no cambia por relleno accidental", (await stockBy(codeOf(1))).codigo === codes[0] && (await stockBy(codeOf(2))).codigo === codes[1]);
  await mpu.ctx.close();

  // 6) TABLET con el dedo: touchStart sobre el controlador, arrastre y confirmación (la página no se desplaza)
  await reseed();
  const tab = await openAs(E2E_USERS.materiaPrima, "tablet");
  const tp = tab.page;
  await tp.setViewportSize({ width: 1180, height: 1000 });
  await openStock(tp);
  const cdp = await tab.ctx.newCDPSession(tp);
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await (await cellLoc(tp, GS, 0, "Kg lote")).tap();
  const th = await tp.locator(`[data-testid=${GS}-fill-handle]`).boundingBox();
  check("tablet: el controlador de relleno mide al menos 44 px (se toca con el dedo)", th.width >= 44 && th.height >= 44, JSON.stringify(th));
  const scrollY0 = await tp.evaluate(() => window.scrollY);
  const target = await centerOf(await cellLoc(tp, GS, 3, "Kg lote"));
  await touch("touchStart", th.x + th.width / 2, th.y + th.height / 2);
  for (let k = 1; k <= 12; k++) await touch("touchMove", th.x + th.width / 2, th.y + th.height / 2 + ((target.y - (th.y + th.height / 2)) * k) / 12);
  await tp.waitForTimeout(250);
  check("tablet: mientras se arrastra con el dedo se ve la vista previa y la página NO se desplaza", (await tp.locator(`[data-testid=${GS}-fill-preview]`).isVisible()) && (await tp.evaluate(() => window.scrollY)) === scrollY0);
  await tp.screenshot({ path: `${OUT}/02-tablet-arrastre.png` });
  await touch("touchEnd", 0, 0);
  await dialog(tp).waitFor({ timeout: 10_000 });
  check("tablet: al soltar aparece la confirmación conjunta (stock real) y no se guardó nada todavía", (await dialog(tp).locator(`[data-testid=${GS}-stock-note]`).count()) === 1 && (await kgNow(1)) === 110 && (await kgNow(2)) === 5);
  await tp.screenshot({ path: `${OUT}/03-tablet-confirmacion.png` });
  await tp.locator(`[data-testid=${GS}-preview-apply]`).tap();
  check("tablet: confirmado, la serie desde 100 se guarda en las filas siguientes (101, 102, 103) con auditoría", await waitDb(async () => (await kgNow(1)) === 101 && (await kgNow(2)) === 102 && (await kgNow(3)) === 103) && (await q("select count(*)::int n from mp_stock_movements where reason like '%Autocompletar arrastrando%' and codigo = $1", [codeOf(3)]))[0].n >= 1, JSON.stringify([await kgNow(1), await kgNow(2), await kgNow(3), await q("select reason from mp_stock_movements where codigo = $1", [codeOf(3)])]));
  await tab.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
