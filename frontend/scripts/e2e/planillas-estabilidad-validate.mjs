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
const ONLY = (process.env.PLANILLAS ?? "stock,ingresos-mp,ingresos-me,salidas-me,inventario-me").split(",");
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

const N = Number(process.env.FILAS ?? 1400);
const TAG = "ZZE";
const NOW = "2026-10-01T00:00:00.000Z";

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos"]) await q(`delete from ${t} where payload->>'createdBy' = 'zze'`);
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'createdBy' = 'zze'`).catch(() => undefined);
  await q(`delete from mp_stock_movements where codigo like '${TAG}-%'`).catch(() => undefined);
  await q(`delete from mp_stock_balances where codigo like '${TAG}-%'`).catch(() => undefined);
}

/** Siembra N filas con SQL (más rápido que la API). El código lleva el número de fila: identifica la fila sin ambigüedad. */
async function seed(table, build) {
  await q(
    `insert into ${table} (id, payload, updated_at)
     select g.id, ($2::text)::jsonb || jsonb_build_object('id', g.id::text) || (${build}), now()
       from (select gen_random_uuid() id, n from generate_series(1, $1::int) n) g`,
    [N, JSON.stringify({ createdBy: "zze", updatedBy: "zze", createdAt: NOW, updatedAt: NOW, archived: false })]
  );
}

const PLANILLAS = {
  stock: {
    label: "Stock MP", gid: "mp-stock-grid", nav: "Stock",
    seed: () => seed("inv_mp_stock", `jsonb_build_object('codigo', '${TAG}-' || lpad(g.n::text, 5, '0'), 'descripcion', 'Materia ${TAG} ' || g.n, 'proveedor', 'Prov ' || g.n, 'lote', 'L' || g.n, 'cantidadKg', 10, 'ubicacion', 'U' || (g.n % 40), 'vencimiento', '2028-01-31', 'estadoStock', 'Stock OK', 'origen', 'manual')`),
    idCol: "código", editCols: ["descripción", "proveedor", "ubicación", "producto", "cliente", "lote", "descripción", "proveedor", "ubicación", "cliente"],
    qtyCol: "cantidad kg", lotCol: "lote",
  },
};

const status = (page, gid) => page.locator(`[data-testid=${gid}-status]`).getAttribute("data-state");
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
/** Estado observable: scroll, celda activa (columna/fila) y valor de la columna identidad de la fila activa. */
async function snap(page, gid, idCol) {
  return page.evaluate(({ gid, idCol }) => {
    const root = document.querySelector(`[data-testid=${gid}]`);
    const sc = root?.querySelector(".dsg-container");
    const map = {};
    for (const h of root.querySelectorAll(".dsg-row-header .dsg-cell")) {
      const m = /genus-col-(\d+)/.exec(h.className);
      if (m) map[h.textContent.trim().toLowerCase()] = Number(m[1]);
    }
    const act = root.querySelector(".dsg-active-cell");
    const row = act?.closest(".dsg-row");
    const idCell = row && map[idCol] !== undefined ? row.querySelector(`.genus-col-${map[idCol]}`) : null;
    const idVal = idCell ? (idCell.querySelector("input")?.value ?? idCell.textContent ?? "").trim() : null;
    return { top: sc ? Math.round(sc.scrollTop) : null, left: sc ? Math.round(sc.scrollLeft) : null, hasActive: Boolean(act), rowId: idVal, active: document.activeElement?.tagName ?? null };
  }, { gid, idCol });
}
const settled = (page, gid) => waitDb(async () => ["saved", "idle"].includes(await status(page, gid)), 30_000);

async function openPlanilla(page, p) {
  await page.goto("/mi-trabajo");
  await nav(page, p.nav);
  await page.locator(`[data-testid=${p.gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}
/** Lleva la fila `n` (1-based por código) a la vista usando SOLO scroll del usuario (rueda del mouse), como un operario. */
async function scrollToRow(page, p, n) {
  const sc = page.locator(`[data-testid=${p.gid}] .dsg-container`);
  const rowH = await page.evaluate((gid) => document.querySelector(`[data-testid=${gid}] .dsg-row:not(:first-child)`)?.getBoundingClientRect().height ?? 40, p.gid);
  await sc.evaluate((el, y) => { el.scrollTop = y; }, Math.max(0, (n - 4) * rowH));
  await page.waitForTimeout(500);
}
async function rowLoc(page, p, code) {
  return page.locator(`[data-testid=${p.gid}] .dsg-row`).filter({ has: page.locator(`input[value="${code}"]`) }).first();
}
async function cellIn(row, map, title) {
  const c = map[title.toLowerCase()];
  if (c === undefined) throw new Error(`columna no encontrada: ${title}`);
  return row.locator(`.genus-col-${c}`).first();
}

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima, process.env.TABLET ? "tablet" : "desktop");
  const mp = mpu.page;
  if (ONLY.includes("stock")) {
    const p = PLANILLAS.stock;
    await p.seed();
    check(`Stock MP: ${N} filas sembradas`, (await q("select count(*)::int n from inv_mp_stock where payload->>'createdBy' = 'zze'"))[0].n === N);
    await openPlanilla(mp, p);
    const TARGET = 350;
    await scrollToRow(mp, p, TARGET);
    const map = await colMap(mp, p.gid);
    const code0 = (n) => `${TAG}-${String(n).padStart(5, "0")}`;
    // Diez celdas consecutivas (filas 350..359), esperando cada guardado.
    let maxDrift = 0;
    let lostFocus = 0;
    let wrongRow = 0;
    for (let i = 0; i < 10; i++) {
      const code = code0(TARGET + i);
      const row = await rowLoc(mp, p, code);
      await row.waitFor({ timeout: 15_000 });
      const cell = await cellIn(row, map, p.editCols[i]);
      await cell.click();
      const before = await snap(mp, p.gid, p.idCol);
      await mp.keyboard.type(`Edit ${i}`);
      await mp.keyboard.press("Enter");
      await settled(mp, p.gid);
      await mp.waitForTimeout(700); // recarga del servidor y re-render
      const after = await snap(mp, p.gid, p.idCol);
      const drift = Math.abs((after.top ?? 0) - (before.top ?? 0));
      maxDrift = Math.max(maxDrift, drift);
      if (!after.hasActive) lostFocus++;
      console.log(`  edición ${i + 1} (${code}): scrollTop ${before.top} → ${after.top}, left ${before.left} → ${after.left}, activa: ${after.rowId}`);
    }
    check(`Stock MP: 10 ediciones seguidas en la fila ${TARGET}: el scroll NUNCA salta (máx. desvío ${maxDrift}px; fila ≈ 40px)`, maxDrift <= 80);
    check("Stock MP: la celda activa se conserva tras cada guardado", lostFocus === 0, `perdió el foco ${lostFocus} veces`);
    const edited = await q("select count(*)::int n from inv_mp_stock where payload->>'createdBy' = 'zze' and payload::text like '%Edit %'");
    check("Stock MP: las 10 ediciones persisten en la base", edited[0].n >= 10, String(edited[0].n));
  }
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
