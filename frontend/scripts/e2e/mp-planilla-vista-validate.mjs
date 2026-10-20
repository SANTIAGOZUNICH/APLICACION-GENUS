// E2E (Chromium real, build de producción, base DESCARTABLE): Materias Primas como Excel (2/n) — columnas (ocultar /
// ancho / recordar), filtros por columna y orden, buscar y reemplazar (con confirmación y deshacer), cola persistente de
// cambios sin conexión (sobrevive a la recarga y se reintenta sin duplicar), tipo de movimiento en Ingresos. Escritorio + tablet.
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
const OUT = process.env.OUT ?? "/tmp/mp-planilla-vista";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const TAG = "CV";
const SECTIONS = (process.env.SECTIONS ?? "all").split(",");
const run = (n) => SECTIONS.includes("all") || SECTIONS.includes(n);
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
  await page.waitForTimeout(900);
}
const post = (page, data) => page.request.post("/api/v1/inventory", { data });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
const headers = (page, gid) => page.evaluate((gid) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)].map((h) => h.textContent.trim().toLowerCase()), gid);
const headerWidth = (page, gid, title) => page.evaluate(([gid, t]) => { const h = [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)].find((x) => x.textContent.trim().toLowerCase() === t); return h ? Math.round(h.getBoundingClientRect().width) : 0; }, [gid, title.toLowerCase()]);
const tap = async (page, loc, kind) => (kind === "tablet" ? loc.tap() : loc.click());
const stockBy = async (desc) => (await q("select payload from inv_mp_stock where payload->>'descripcion' = $1", [desc]))[0]?.payload;
const allStock = () => q("select payload from inv_mp_stock where payload->>'descripcion' like $1 order by payload->>'descripcion'", [`${TAG} %`]);

/** Celda de la fila cuyo input vale `rowValue`, en la columna `title` (desplaza las columnas virtualizadas). */
async function rowCell(page, gid, rowValue, title) {
  await page.evaluate((gid) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); sc.scrollLeft = 0; sc.scrollTop = 0; }, gid);
  await page.waitForTimeout(150);
  let ri = -1;
  for (let i = 0; i < 25 && ri < 0; i++) {
    ri = await page.evaluate(([gid, v]) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), [gid, rowValue]);
    if (ri < 0) { await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft += 260; }, gid); await page.waitForTimeout(120); }
  }
  if (ri < 0) throw new Error(`fila no encontrada: ${rowValue}`);
  let c;
  await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft = 0; }, gid);
  for (let i = 0; i < 25 && c === undefined; i++) {
    const map = await page.evaluate((gid) => { const o = {}; for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) { const m = /genus-col-(\d+)/.exec(h.className); if (m) o[h.textContent.trim().toLowerCase()] = Number(m[1]); } return o; }, gid);
    c = map[title.toLowerCase()];
    if (c === undefined) { await page.evaluate((gid) => { document.querySelector(`[data-testid=${gid}] .dsg-container`).scrollLeft += 260; }, gid); await page.waitForTimeout(120); }
  }
  if (c === undefined) throw new Error(`columna no encontrada: ${title}`);
  await page.evaluate(([gid, c]) => { const grid = document.querySelector(`[data-testid=${gid}]`); const sc = grid.querySelector(".dsg-container"); const h = grid.querySelector(`.dsg-row-header .genus-col-${c}`); if (h) { const cr = sc.getBoundingClientRect(); const er = h.getBoundingClientRect(); sc.scrollLeft += er.left - cr.left - cr.width / 3; } }, [gid, c]);
  await page.waitForTimeout(250);
  return page.locator(`[data-testid=${gid}] .dsg-row`).nth(ri).locator(`.genus-col-${c}`).first();
}
async function clickCell(page, loc, kind) {
  const b = await loc.boundingBox();
  if (kind === "tablet") await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos"]) await q(`delete from ${t} where payload::text like '%${TAG} %'`);
}

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima, "desktop");
  const mp = mpu.page;
  for (let i = 0; i < 12; i++) {
    await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: `${TAG} Materia ${String(i).padStart(2, "0")}`, codigo: `${TAG}-${String(i).padStart(3, "0")}`, lote: `CVL${i}`, cantidadKg: 10 + i * 5, proveedor: `Prov ${i % 3}`, ubicacion: `U${i}`, vencimiento: "2027-06-30", cliente: `Cli ${i}`, origen: "manual" } });
  }
  const GS = "mp-stock-grid";
  await openTab(mp, "Stock", GS);

  if (run("columnas")) {
  // ===== COLUMNAS =====
  check("la barra de la planilla ofrece «Columnas» y «Filtros y orden»", (await mp.locator(`[data-testid=${GS}-cols-btn]`).count()) === 1 && (await mp.locator(`[data-testid=${GS}-filters-btn]`).count()) === 1);
  check("antes de ocultar: existe la columna Cliente", (await headers(mp, GS)).includes("cliente"));
  await mp.locator(`[data-testid=${GS}-cols-btn]`).click();
  await mp.locator(`[data-testid=${GS}-col-toggle][data-col="CLIENTE"]`).uncheck();
  await mp.waitForTimeout(500);
  check("ocultar «Cliente»: desaparece de la planilla", !(await headers(mp, GS)).includes("cliente"));
  check("las columnas obligatorias para crear filas no se pueden ocultar", await mp.locator(`[data-testid=${GS}-col-toggle][data-col="LOTE"]`).isDisabled());
  const w0 = await headerWidth(mp, GS, "Descripción");
  await mp.locator(`[data-testid=${GS}-col-wide][data-col="DESCRIPCIÓN MATERIA PRIMA"]`).click();
  await mp.locator(`[data-testid=${GS}-col-wide][data-col="DESCRIPCIÓN MATERIA PRIMA"]`).click();
  await mp.waitForTimeout(500);
  const w1 = await headerWidth(mp, GS, "Descripción");
  console.log("  [diag] ancho en el panel:", await mp.locator(`[data-testid=${GS}-col-width][data-col="DESCRIPCIÓN MATERIA PRIMA"]`).innerText(), "| header:", w0, "→", w1);
  check("«Ensanchar» agranda la columna", w1 > w0 + 30, `${w0} → ${w1}`);
  await mp.reload();
  await mp.locator(`[data-testid=${GS}]`).waitFor({ timeout: 120_000 });
  await mp.waitForTimeout(900);
  check("la vista se recuerda al recargar (Cliente sigue oculta y el ancho se mantiene)", !(await headers(mp, GS)).includes("cliente") && (await headerWidth(mp, GS, "Descripción")) >= w1 - 4);
  check("ocultar una columna no toca los datos", (await allStock()).every((r) => String(r.payload.cliente).startsWith("Cli ")));
  await mp.screenshot({ path: `${OUT}/01-columnas.png` });
  await mp.locator(`[data-testid=${GS}-view-reset]`).click();
  await mp.waitForTimeout(500);
  check("«Restablecer vista» devuelve las columnas", (await headers(mp, GS)).includes("cliente"));

  }
  if (run("filtros")) {
  // ===== FILTROS Y ORDEN =====
  await mp.locator(`[data-testid=${GS}-filters-btn]`).click();
  await mp.locator(`[data-testid=${GS}-filter][data-col="DESCRIPCIÓN MATERIA PRIMA"]`).fill("materia 03");
  await mp.waitForTimeout(600);
  check("filtrar por columna: muestra solo lo que coincide y cuenta", /Mostrando 1 de/.test(await mp.locator(`[data-testid=${GS}-filter-count]`).innerText()));
  await mp.locator(`[data-testid=${GS}-filter][data-col="DESCRIPCIÓN MATERIA PRIMA"]`).fill("");
  await mp.locator(`[data-testid=${GS}-filter][data-col="PROVEEDOR"]`).fill("prov 1");
  await mp.waitForTimeout(600);
  check("filtro por proveedor (sin importar mayúsculas)", /Mostrando 4 de/.test(await mp.locator(`[data-testid=${GS}-filter-count]`).innerText()), await mp.locator(`[data-testid=${GS}-filter-count]`).innerText());
  await mp.locator(`[data-testid=${GS}-filter][data-col="PROVEEDOR"]`).fill("");
  await mp.locator(`[data-testid=${GS}-sort-col]`).selectOption("CANTIDAD (KG)");
  await mp.locator(`[data-testid=${GS}-sort-dir]`).click(); // descendente
  await mp.waitForTimeout(700);
  const firstKg = await (await rowCell(mp, GS, `${TAG} Materia 11`, "Kg lote")).evaluate((el) => el.closest(".dsg-row") !== null);
  const order = await mp.evaluate((gid) => [...document.querySelectorAll(`[data-testid=${gid}] .dsg-row`)].filter((r) => !r.classList.contains("dsg-row-header")).slice(0, 3).map((r) => [...r.querySelectorAll("input")].map((i) => i.value).find((v) => /^CV Materia/.test(v)) ?? ""), GS);
  check("ordenar por «Kg lote» descendente pone primero al de más kg (la fila mayor)", firstKg && order[0] === `${TAG} Materia 11` && order[1] === `${TAG} Materia 10`, order.join(" | "));
  check("filtrar y ordenar no modifican datos", (await allStock()).length === 12);
  await mp.locator(`[data-testid=${GS}-view-reset]`).click();

  }
  if (run("reemplazo")) {
  // ===== BUSCAR Y REEMPLAZAR =====
  await mp.locator(`[data-testid=${GS}-find-btn]`).click();
  await mp.locator(`[data-testid=${GS}-find-text]`).fill(`${TAG} Materia`);
  await mp.locator(`[data-testid=${GS}-replace-text]`).fill(`${TAG} Mat`);
  await mp.locator(`[data-testid=${GS}-find-col]`).selectOption("DESCRIPCIÓN MATERIA PRIMA");
  await mp.waitForTimeout(400);
  check("buscar cuenta las celdas a cambiar antes de reemplazar", /12 celdas en 12 filas/.test(await mp.locator(`[data-testid=${GS}-find-count]`).innerText()), await mp.locator(`[data-testid=${GS}-find-count]`).innerText());
  await mp.locator(`[data-testid=${GS}-replace-all]`).click();
  check("un reemplazo masivo pide confirmación antes de aplicar", (await mp.locator(`[data-testid=${GS}-replace-confirm]`).count()) === 1 && (await stockBy(`${TAG} Materia 00`)) !== undefined);
  await mp.locator(`[data-testid=${GS}-replace-confirm]`).click();
  check("al confirmar se reemplazan las 12 celdas (en la base)", await waitDb(async () => (await q("select count(*)::int n from inv_mp_stock where payload->>'descripcion' like $1", [`${TAG} Mat %`]))[0].n === 12, 25_000));
  const aud = await q("select count(*)::int n from inv_audit where payload::text like $1", [`%${TAG} Mat %`]);
  check("auditoría: los reemplazos quedaron registrados (valor anterior y nuevo)", aud[0].n >= 12, String(aud[0].n));
  await mp.waitForTimeout(1500);
  await mp.locator(`[data-testid=${GS}-undo]`).click();
  check("Deshacer revierte el reemplazo", await waitDb(async () => (await q("select count(*)::int n from inv_mp_stock where payload->>'descripcion' like $1", [`${TAG} Materia %`]))[0].n === 12, 25_000));

  }
  if (run("cola")) {
  // ===== COLA PERSISTENTE (sin conexión + recarga) =====
  await mp.waitForTimeout(1500);
  // El panel de filtros/columnas ocupa lugar sobre la hoja: se cierra antes de editar.
  for (const id of ["filters-btn", "cols-btn"]) {
    if ((await mp.locator(`[data-testid=${GS}-${id}]`).getAttribute("aria-expanded")) === "true") await mp.locator(`[data-testid=${GS}-${id}]`).click();
  }
  await mp.waitForTimeout(300);
  const cell = await rowCell(mp, GS, `${TAG} Materia 05`, "Ubicación");
  // Corte de red SOLO para los guardados de celdas (así se puede recargar la página con el corte activo).
  await mp.route("**/api/v1/inventory/cells", (route) => route.abort("internetdisconnected"));
  await clickCell(mp, cell, "desktop");
  await mp.keyboard.type("COLA-1");
  await mp.keyboard.press("Enter");
  await mp.waitForTimeout(2500);
  console.log("  [diag] failed bar:", await mp.locator(`[data-testid=${GS}-failed]`).count(), "| ubicacion db:", (await stockBy(`${TAG} Materia 05`)).ubicacion);
  check("sin conexión: el cambio no se guarda y queda en la barra roja con reintento", (await stockBy(`${TAG} Materia 05`)).ubicacion === "U5" && (await mp.locator(`[data-testid=${GS}-failed]`).count()) >= 1);
  await mp.reload();
  await mp.locator(`[data-testid=${GS}]`).waitFor({ timeout: 120_000 });
  await mp.waitForTimeout(1500);
  check("tras recargar (con el corte activo) el cambio pendiente sigue en la barra roja", (await mp.locator(`[data-testid=${GS}-failed]`).count()) >= 1 && (await stockBy(`${TAG} Materia 05`)).ubicacion === "U5");
  await mp.unroute("**/api/v1/inventory/cells");
  await mp.evaluate(() => window.dispatchEvent(new Event("online")));
  check("al volver la conexión se guarda solo", await waitDb(async () => (await stockBy(`${TAG} Materia 05`)).ubicacion === "COLA-1", 25_000));
  await mp.waitForTimeout(2000);
  console.log("  [diag] colas en localStorage:", JSON.stringify(await mp.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("genus-queue:")).map((k) => [k, localStorage.getItem(k)])))));
  check("se guardó una sola vez y la cola quedó vacía", (await q("select count(*)::int n from inv_mp_stock where payload->>'ubicacion' = 'COLA-1'"))[0].n === 1 && !(await mp.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("genus-queue:") && localStorage.getItem(k) && localStorage.getItem(k) !== "[]"))));
  }
  await mpu.ctx.close();

  if (run("ingresos")) {
  // ===== INGRESOS: TIPO DE MOVIMIENTO =====
  const iu = await openAs(E2E_USERS.materiaPrima, "desktop");
  const ip = iu.page;
  await post(ip, { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", proveedor: "Prov CV", descripcion: `${TAG} Ingreso tipo`, codigo: `${TAG}-IT1`, lote: "CVT1", cantidad: 50 } });
  await openTab(ip, "Ingresos MP", "mp-ingresos-grid");
  await ip.evaluate(() => { const sc = document.querySelector("[data-testid=mp-ingresos-grid] .dsg-container"); sc.scrollLeft = sc.scrollWidth; });
  await ip.waitForTimeout(500);
  const hdr = await headers(ip, "mp-ingresos-grid");
  const colsTxt = await ip.locator("[data-testid=mp-ingresos-grid]").innerText();
  check("Ingresos muestra la columna «Tipo» (nuevo lote / adicional / borrador)", hdr.includes("tipo") || /Ingreso · nuevo lote|Borrador \(no mueve stock\)/.test(colsTxt), hdr.join(","));
  await iu.ctx.close();
  }

  if (run("tablet")) {
  // ===== TABLET =====
  const tb = await openAs(E2E_USERS.materiaPrima, "tablet");
  await openTab(tb.page, "Stock", GS);
  await tb.page.locator(`[data-testid=${GS}-cols-btn]`).tap();
  await tb.page.locator(`[data-testid=${GS}-col-toggle][data-col="CLIENTE"]`).tap();
  await tb.page.waitForTimeout(500);
  check("tablet táctil: ocultar una columna con el dedo", !(await headers(tb.page, GS)).includes("cliente"));
  await tb.page.locator(`[data-testid=${GS}-view-reset]`).tap();
  await tb.page.locator(`[data-testid=${GS}-find-btn]`).tap();
  await tb.page.locator(`[data-testid=${GS}-find-text]`).fill("zzzz-no-existe");
  check("tablet táctil: buscar y reemplazar abre y cuenta (0 coincidencias)", /0 celdas/.test(await tb.page.locator(`[data-testid=${GS}-find-count]`).innerText()));
  await tb.page.screenshot({ path: `${OUT}/02-tablet.png` });
  await tb.ctx.close();
  }
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
