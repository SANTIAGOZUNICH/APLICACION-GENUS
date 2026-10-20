// E2E (Chromium real, build de producción, base DESCARTABLE): filas en blanco al final de Ingresos MP.
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
const OUT = process.env.OUT ?? "/tmp/mp-pegado-filas";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const TAG = "PG";
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
  let c;
  for (let i = 0; i < 25 && c === undefined; i++) {
    c = (await colMap(page, gid))[title.toLowerCase()];
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
  await q(`delete from inv_mp_ingresos where payload::text like '%${TAG} %'`);
}
const pasteDoc = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

try {
  await cleanup();
  const u = await openAs(E2E_USERS.materiaPrima, "desktop");
  const p = u.page;
  const GI = "mp-ingresos-grid";
  await openTab(p, "Ingresos MP", GI);
  const mov0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  // Se pega «como sale de Excel»: Fecha, Descripción, Proveedor, Lote, Cantidad (sin tocar las columnas calculadas).
  const c0 = await draftCell(p, GI, 0, "Fecha");
  const b = await c0.boundingBox();
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  const tsv = [1, 2, 3].map((n) => ["21/10/2026", `${TAG} Pegado ${n}`, "Prov PG", `PG-L${n}`, String(10 * n)].join("\t")).join("\n");
  await pasteDoc(p, tsv);
  check("pegar 3 filas: las 3 se crean como ingresos completos (una vez cada una)", await waitDb(async () => (await q("select count(*)::int n from inv_mp_ingresos where payload->>'descripcion' like $1", [`${TAG} Pegado %`]))[0].n === 3, 25_000));
  await p.waitForTimeout(2500);
  const rows = await q("select payload from inv_mp_ingresos where payload->>'descripcion' like $1 order by payload->>'descripcion'", [`${TAG} Pegado %`]);
  check("cada ingreso quedó CONFIRMADO con su lote y cantidad (sin duplicados)", rows.length === 3 && rows.every((r, i) => r.payload.status === "CONFIRMADO" && r.payload.lote === `PG-L${i + 1}` && Number(r.payload.cantidad) === 10 * (i + 1) && r.payload.fecha === "2026-10-21"));
  check("un movimiento de stock por cada ingreso (3), sin repetir", (await q("select count(*)::int n from mp_stock_movements"))[0].n === mov0 + 3);
  // Pegado con encabezados (como copiar desde una hoja con títulos) y una fila incompleta: la incompleta NO se crea.
  const c1 = await draftCell(p, GI, 0, "Fecha");
  const b1 = await c1.boundingBox();
  await p.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await pasteDoc(p, ["Lote\tDescripción\tCantidad\tProveedor\tFecha", `PG-L9\t${TAG} Con titulos\t5\tProv PG\t22/10/2026`, `PG-L10\t${TAG} Incompleta\t7\t\t22/10/2026`].join("\n"));
  check("pegado con encabezados: mapea por nombre y crea la fila completa", await waitDb(async () => (await q("select count(*)::int n from inv_mp_ingresos where payload->>'descripcion' = $1", [`${TAG} Con titulos`]))[0].n === 1, 25_000));
  await p.waitForTimeout(2500);
  check("la fila pegada sin proveedor NO se crea (queda en preparación, avisando)", (await q("select count(*)::int n from inv_mp_ingresos where payload->>'descripcion' = $1", [`${TAG} Incompleta`]))[0].n === 0 && /sin completar/.test(await p.locator(`[data-testid=${GI}-drafts-info]`).innerText()));
  await p.screenshot({ path: `${OUT}/01-pegado.png` });
  await u.ctx.close();
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
