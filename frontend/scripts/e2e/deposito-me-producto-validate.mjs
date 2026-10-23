// E2E en Chromium real (TABLET 1024×768): PRODUCTO en Stock ME e Ingresos ME + DIFERENCIA también en Ingresos ME.
// Base DESCARTABLE (marca verificada) y login real. Ver run-deposito-me-producto-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/deposito-me-producto";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-01T10:00:00.000Z";
const CLI = "CLIENTE E2E PD";
const id = { env: randomUUID(), tap: randomUUID(), i1: randomUUID(), i2: randomUUID(), i3: randomUUID(), p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID() };
const pl = async (table, rid) => (await q(`select payload from ${table} where id = $1`, [rid]))[0]?.payload;
const mat = (mid, codigo) => ({ id: mid, codigo, descripcion: codigo, cliente: CLI, ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false });
const ing = (iid, nro, codigo, materialId, total) => ({ id: iid, fecha: "2026-10-01", ingresoNro: nro, proveedor: "PROV", cliente: CLI, remitoNro: `R-${nro}`, codigo, descripcionInsumo: codigo, bultos: 1, cantidad: total, total, ubicacion: "A1", materialId, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T });

async function seed() {
  for (const t of ["inv_me_ingresos", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-PD-%'`);
  await q("delete from me_material_pedido_links where pedido_id = any($1)", [[id.p1, id.p2, id.p3, id.p4]]);
  await q("delete from production_pedidos where cliente = $1", [CLI]);
  await q("insert into production_pedidos (id, cliente, producto, q, estado) values ($1,$2,'CREMA FACIAL',3000,'INGRESO'),($3,$2,'SHAMPOO',500,'INGRESO'),($4,$2,'GEL DOBLE',100,'INGRESO'),($5,$2,'GEL DOBLE',200,'INGRESO')", [id.p1, CLI, id.p2, id.p3, id.p4]);
  await q("insert into inv_me_materials (id, payload) values ($1,$2),($3,$4)", [id.env, mat(id.env, "E2E-PD-ENV"), id.tap, mat(id.tap, "E2E-PD-TAP")]);
  await q("insert into inv_me_ingresos (id, payload) values ($1,$2),($3,$4),($5,$6)", [id.i1, ing(id.i1, "PD-1", "E2E-PD-ENV", id.env, 1000), id.i2, ing(id.i2, "PD-2", "E2E-PD-ENV", id.env, 1500), id.i3, ing(id.i3, "PD-3", "E2E-PD-TAP", id.tap, 3200)]);
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1024, height: 768 }, hasTouch: true });
const page = await ctx.newPage();
const nav = (label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const waitRow = (value) => page.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 120_000 });
// La grilla virtualiza columnas (en tablet solo se dibujan las visibles): se recorre de izquierda a derecha.
const scrollX = async (x) => {
  const c = page.locator(".dsg-container").first();
  await c.evaluate((el, x) => { el.scrollLeft = x < 0 ? el.scrollWidth : x; el.dispatchEvent(new Event("scroll", { bubbles: true })); }, x);
  await page.mouse.move(300, 400);
  await page.mouse.wheel(x < 0 ? 5000 : x === 0 ? -5000 : 0, 0);
};
const renderedHeaders = () => page.evaluate(() => [...document.querySelectorAll(".dsg-row-header .dsg-cell")].map((c) => c.textContent.trim()));
async function headers() {
  const all = [];
  for (const x of [0, 400, 800, 1200, 1600, -1]) { await scrollX(x); await page.waitForTimeout(150); for (const h of await renderedHeaders()) if (!all.includes(h)) all.push(h); }
  await scrollX(0);
  return all;
}
async function reveal(title) {
  for (const x of [0, 400, 800, 1200, 1600, -1]) { await scrollX(x); await page.waitForTimeout(150); if ((await renderedHeaders()).includes(title)) return; }
}
async function cell(rowValue, title) {
  await scrollX(0);
  await page.waitForTimeout(200);
  const ri = await page.evaluate((v) => [...document.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v)), rowValue);
  await reveal(title);
  const col = await page.evaluate((t) => [...document.querySelector(".dsg-row-header").querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === t), title);
  if (col < 0 || ri < 0) throw new Error(`celda no encontrada: ${rowValue} / ${title} ${JSON.stringify({ col, ri })}`);
  return page.locator(".dsg-row").nth(ri).locator(".dsg-cell").nth(col);
}
const cellText = async (rowValue, title) => ((await (await cell(rowValue, title)).locator("input").inputValue().catch(() => null)) ?? (await (await cell(rowValue, title)).innerText())).trim();
async function typeInto(rowValue, title, value, gridTestId) {
  const c = await cell(rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridTestId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply.click();
}
const waitDb = async (fn, timeout = 20_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
async function clickInRow(rowValue, selector) {
  await scrollX(0);
  await page.waitForTimeout(200);
  const ok = await page.evaluate(([v, sel]) => { const row = [...document.querySelectorAll(".dsg-row")].find((r) => [...r.querySelectorAll("input")].some((i) => i.value === v)); const b = row?.querySelector(sel); if (b) b.click(); return Boolean(b); }, [rowValue, selector]);
  if (!ok) throw new Error(`acción no encontrada: ${rowValue} ${selector}`);
}

try {
  await seed();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.deposito.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");

  // ============ STOCK ME (Inventario) ============
  await nav("Inventario ME");
  await waitRow("E2E-PD-ENV");
  const hInv = await headers();
  check("Stock ME: PRODUCTO va inmediatamente después de CLIENTE y existe DIFERENCIA", hInv.indexOf("PRODUCTO") === hInv.indexOf("CLIENTE") + 1 && hInv.includes("DIFERENCIA"), hInv.join(" | "));
  check("registro sin producto sigue funcionando: DIFERENCIA «SIN DATOS»", (await cellText("E2E-PD-ENV", "DIFERENCIA")) === "SIN DATOS");
  await typeInto("E2E-PD-ENV", "PRODUCTO", "crema facial", "me-inventario-grid");
  check("PRODUCTO escrito en la celda: pedido único del cliente → vinculado solo (referencia estable)", await waitDb(async () => (await pl("inv_me_materials", id.env))?.pedidoId === id.p1));
  await page.reload();
  await nav("Inventario ME");
  await waitRow("E2E-PD-ENV");
  check("tras recargar conserva el producto y, sin consumo configurado, DIFERENCIA = SIN CONFIGURAR", (await cellText("E2E-PD-ENV", "PRODUCTO")) === "crema facial" && (await cellText("E2E-PD-ENV", "DIFERENCIA")) === "SIN CONFIGURAR");
  // consumo por producto con el selector (producto/pedido del cliente)
  await clickInRow("E2E-PD-ENV", "[data-testid=me-diferencia-vincular]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=me-diferencia-pedido] option").length > 1, null, { timeout: 30_000 });
  const opts = await page.locator("[data-testid=me-diferencia-pedido] option").allInnerTexts();
  check("el selector lista SOLO pedidos activos del cliente del material", opts.some((o) => /CREMA FACIAL/.test(o)) && opts.some((o) => /SHAMPOO/.test(o)) && opts.length === 5, opts.join(" / "));
  await page.locator("[data-testid=me-diferencia-pedido]").selectOption(id.p1);
  await page.locator("[data-testid=me-diferencia-ratio]").fill("1");
  await page.screenshot({ path: `${OUT}/0-selector-pedido.png` });
  await page.locator("[data-testid=me-diferencia-guardar]").click({ timeout: 8000 });
  await waitDb(async () => (await q("select units_per_product u from me_material_pedido_links where material_id = $1", [id.env]))[0]?.u === 1);
  await page.reload();
  await nav("Inventario ME");
  await waitRow("E2E-PD-ENV");
  check("Stock ME: 1.000 + 1.500 = 2.500 vs pedido 3.000 → −500 FALTAN", (await cellText("E2E-PD-ENV", "DIFERENCIA")) === "−500 FALTAN", await cellText("E2E-PD-ENV", "DIFERENCIA"));
  const difCell = await cell("E2E-PD-ENV", "DIFERENCIA");
  await page.screenshot({ path: `${OUT}/1-stock-me-tablet.png` });
  console.log("DBGC", JSON.stringify(await difCell.evaluate((el) => ({ cls: el.className, html: el.innerHTML.slice(0, 200), colors: [el, ...el.querySelectorAll("*")].map((n) => getComputedStyle(n).color) }))));
  check("…en ROJO", await difCell.evaluate((el) => [el, ...el.querySelectorAll("*")].some((n) => getComputedStyle(n).color === "rgb(220, 38, 38)")));

  // producto con VARIOS pedidos activos → ELEGIR PEDIDO (no se asume)
  await typeInto("E2E-PD-TAP", "PRODUCTO", "GEL DOBLE", "me-inventario-grid");
  await waitDb(async () => (await pl("inv_me_materials", id.tap))?.producto === "GEL DOBLE");
  await page.reload();
  await nav("Inventario ME");
  await waitRow("E2E-PD-TAP");
  check("mismo producto en dos pedidos activos: pide elegir (ELEGIR PEDIDO), sin vincular", (await cellText("E2E-PD-TAP", "DIFERENCIA")) === "ELEGIR PEDIDO" && !(await pl("inv_me_materials", id.tap)).pedidoId);

  // ============ INGRESOS ME ============
  await nav("Ingresos ME");
  await waitRow("PD-1");
  const hIng = await headers();
  check("Ingresos ME: PRODUCTO inmediatamente después de CLIENTE y columna DIFERENCIA presente (tablet)", hIng.indexOf("PRODUCTO") === hIng.indexOf("CLIENTE") + 1 && hIng.includes("DIFERENCIA"), hIng.join(" | "));
  check("Ingresos: DIFERENCIA usa el stock ACUMULADO del material (no solo este ingreso): −500 FALTAN en ambos", (await cellText("PD-1", "DIFERENCIA")) === "−500 FALTAN" && (await cellText("PD-2", "DIFERENCIA")) === "−500 FALTAN", `${await cellText("PD-1", "DIFERENCIA")} / ${await cellText("PD-2", "DIFERENCIA")}`);
  await typeInto("PD-1", "PRODUCTO", "CREMA FACIAL", "me-ingresos-grid");
  check("PRODUCTO del ingreso se guarda y guarda la referencia al pedido", await waitDb(async () => { const p = await pl("inv_me_ingresos", id.i1); return p?.producto === "CREMA FACIAL" && p?.pedidoId === id.p1; }));
  await page.screenshot({ path: `${OUT}/2-ingresos-me-tablet.png` });
  // fila nueva: diferencia PREVISTA sin sumar al stock
  const stockAntes = (await (await page.request.get("/api/v1/inventory?resource=me_inventario")).json()).data.find((r) => r.codigo === "E2E-PD-ENV").cantidadTotal;
  const draft = page.locator(".dsg-row.genus-draft-row, .genus-draft-row").first();
  const dIdx = await page.evaluate(() => { const rows = [...document.querySelectorAll(".dsg-row")]; return rows.findIndex((r) => r.classList.contains("genus-draft-row")); });
  const colIdx = async (t) => (await renderedHeaders()).indexOf(t);
  const dcell = async (t) => { await reveal(t); return page.locator(".dsg-row").nth(dIdx).locator(".dsg-cell").nth(await colIdx(t)); };
  for (const [t, v] of [["CÓDIGO", "E2E-PD-ENV"], ["CLIENTE", CLI], ["CANTIDAD", "700"]]) {
    const c = await dcell(t);
    await c.dblclick();
    await page.keyboard.type(v);
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
  const prev = (await (await dcell("DIFERENCIA")).locator("input").inputValue().catch(async () => (await (await dcell("DIFERENCIA")).innerText()))).trim();
  await page.screenshot({ path: `${OUT}/3-fila-nueva-prevista.png` });
  check("fila nueva sin confirmar: diferencia PREVISTA (+200 SOBRAN con ≈) y el stock NO cambia", /^≈ \+200 SOBRAN$/.test(prev) && (await (await page.request.get("/api/v1/inventory?resource=me_inventario")).json()).data.find((r) => r.codigo === "E2E-PD-ENV").cantidadTotal === stockAntes, prev);
  void draft;
  // ingreso confirmado por API (mismo camino que el alta de la planilla): suma una sola vez
  const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "me_ingresos", payload: { fecha: "2026-10-05", remitoNro: "R-PD-4", codigo: "E2E-PD-ENV", cliente: CLI, producto: "CREMA FACIAL", descripcionInsumo: "E2E-PD-ENV", bultos: 1, cantidad: 700, ubicacion: "A1" } } });
  const stockDesp = (await (await page.request.get("/api/v1/inventory?resource=me_inventario")).json()).data.find((x) => x.codigo === "E2E-PD-ENV").cantidadTotal;
  check("ingreso confirmado de 700: stock 2.500 → 3.200 (una sola vez)", r.status() === 200 && stockAntes === 2500 && stockDesp === 3200, `${r.status()} ${stockAntes}→${stockDesp}`);
  await page.reload();
  await nav("Ingresos ME");
  await waitRow("PD-1");
  check("…y DIFERENCIA pasa a +200 SOBRAN en Ingresos", (await cellText("PD-1", "DIFERENCIA")) === "+200 SOBRAN", await cellText("PD-1", "DIFERENCIA"));
  await nav("Inventario ME");
  await waitRow("E2E-PD-ENV");
  check("…y en Stock ME (mismo cálculo, sin duplicar)", (await cellText("E2E-PD-ENV", "DIFERENCIA")) === "+200 SOBRAN" && (await cellText("E2E-PD-ENV", "PRODUCTO")) === "CREMA FACIAL", `${await cellText("E2E-PD-ENV", "DIFERENCIA")} / ${await cellText("E2E-PD-ENV", "PRODUCTO")}`);
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  await page.screenshot({ path: `${OUT}/debug.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
