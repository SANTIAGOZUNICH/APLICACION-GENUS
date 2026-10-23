// E2E en Chromium real (TABLET 1024×768): PRODUCTO en Stock ME e Ingresos ME; DIFERENCIA SOLO en Ingresos ME (acumulado por pedido, sin usar el saldo de Stock).
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
const id = { env: randomUUID(), tap: randomUUID(), p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID() };
const pl = async (table, rid) => (await q(`select payload from ${table} where id = $1`, [rid]))[0]?.payload;
const mat = (mid, codigo) => ({ id: mid, codigo, descripcion: codigo, cliente: CLI, ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false });

async function seed() {
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-PD-%'`);
  await q("delete from me_material_pedido_links where pedido_id = any($1)", [[id.p1, id.p2, id.p3, id.p4]]);
  await q("delete from production_pedidos where cliente = $1", [CLI]);
  await q("insert into production_pedidos (id, cliente, producto, q, estado) values ($1,$2,'CREMA FACIAL',3000,'INGRESO'),($3,$2,'SHAMPOO',500,'INGRESO'),($4,$2,'GEL DOBLE',100,'INGRESO'),($5,$2,'GEL DOBLE',200,'INGRESO')", [id.p1, CLI, id.p2, id.p3, id.p4]);
  await q("insert into inv_me_materials (id, payload) values ($1,$2),($3,$4)", [id.env, mat(id.env, "E2E-PD-ENV"), id.tap, mat(id.tap, "E2E-PD-TAP")]);
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
  const post = (payload) => page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "me_ingresos", payload } });
  const stockOf = async (codigo) => (await (await page.request.get("/api/v1/inventory?resource=me_inventario")).json()).data.find((r) => r.codigo === codigo)?.cantidadTotal;
  const ingreso = (n, cantidad, extra = {}) => ({ fecha: "2026-10-05", remitoNro: `R-PD-${n}`, codigo: "E2E-PD-ENV", cliente: CLI, producto: "crema facial", descripcionInsumo: "E2E-PD-ENV", bultos: 1, cantidad, ubicacion: "A1", ...extra });

  // 1.º ingreso (por el mismo camino que el alta de la planilla): el pedido único del cliente se vincula solo
  const r1 = await post(ingreso(1, 1000));
  check("ingreso de 1.000 registrado", r1.status() === 200);

  // ============ INGRESOS ME ============
  await nav("Ingresos ME");
  await waitRow("R-PD-1");
  const hIng = await headers();
  check("Ingresos ME: PRODUCTO inmediatamente después de CLIENTE y DIFERENCIA presente (tablet)", hIng.indexOf("PRODUCTO") === hIng.indexOf("CLIENTE") + 1 && hIng.includes("DIFERENCIA"), hIng.join(" | "));
  check("sin consumo por producto configurado: SIN CONFIGURAR (no se asume 1:1)", (await cellText("R-PD-1", "DIFERENCIA")) === "SIN CONFIGURAR", await cellText("R-PD-1", "DIFERENCIA"));
  await clickInRow("R-PD-1", "[data-testid=me-diferencia-vincular]");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=me-diferencia-pedido] option").length > 1, null, { timeout: 30_000 });
  const opts = await page.locator("[data-testid=me-diferencia-pedido] option").allInnerTexts();
  check("el selector lista SOLO pedidos activos del cliente del ingreso", opts.some((o) => /CREMA FACIAL/.test(o)) && opts.some((o) => /SHAMPOO/.test(o)) && opts.length === 5, opts.join(" / "));
  await page.locator("[data-testid=me-diferencia-pedido]").selectOption(id.p1);
  await page.locator("[data-testid=me-diferencia-ratio]").fill("1");
  await page.locator("[data-testid=me-diferencia-guardar]").click({ timeout: 8000 });
  await waitDb(async () => ((await q("select units_per_product u from me_material_pedido_links where pedido_id = $1", [id.p1]))[0]?.u) === 1);
  check("1.er ingreso (1.000 de 3.000): −2.000 FALTAN", await waitDb(async () => ((await pl("inv_me_ingresos", (await q("select id from inv_me_ingresos where payload->>'remitoNro' = 'R-PD-1'"))[0].id))?.difSnapshot?.diferencia) === -2000));
  await post(ingreso(2, 1500));
  await post(ingreso(3, 700));
  await page.reload();
  await nav("Ingresos ME");
  await waitRow("R-PD-3");
  const t = [await cellText("R-PD-1", "DIFERENCIA"), await cellText("R-PD-2", "DIFERENCIA"), await cellText("R-PD-3", "DIFERENCIA")];
  check("acumulados: −2.000 FALTAN → −500 FALTAN → +200 SOBRAN (cada fila conserva el suyo)", t[0] === "−2.000 FALTAN" && t[1] === "−500 FALTAN" && t[2] === "+200 SOBRAN", t.join(" / "));
  check("…y recargando persisten, con color rojo / verde", await (await cell("R-PD-1", "DIFERENCIA")).evaluate((el) => [el, ...el.querySelectorAll("*")].some((n) => getComputedStyle(n).color === "rgb(220, 38, 38)")) && await (await cell("R-PD-3", "DIFERENCIA")).evaluate((el) => [el, ...el.querySelectorAll("*")].some((n) => getComputedStyle(n).color === "rgb(5, 150, 105)")));
  await page.screenshot({ path: `${OUT}/2-ingresos-me-tablet.png` });

  // Producción consume 2.000 envases: baja el stock, NO las diferencias de los ingresos
  const stockAntes = await stockOf("E2E-PD-ENV");
  await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [randomUUID(), { id: randomUUID(), fecha: "2026-10-06", egresoNro: "E2E-PD-OA", cliente: CLI, remitoNro: "", descripcion: "E2E-PD-ENV", bultos: null, cantidad: 2000, total: 2000, control: false, entregado: false, comentarios: "consumo OA", materialId: id.env, codigo: "E2E-PD-ENV", unidad: "u", origen: "OA", oaId: "oa-e2e-pd", oaNumber: "OA-2026-000999", oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "e2e", updatedBy: "e2e", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
  const stockDesp = await stockOf("E2E-PD-ENV");
  await page.reload();
  await nav("Ingresos ME");
  await waitRow("R-PD-3");
  const t2 = [await cellText("R-PD-1", "DIFERENCIA"), await cellText("R-PD-2", "DIFERENCIA"), await cellText("R-PD-3", "DIFERENCIA")];
  check("consumo de 2.000: Stock ME baja (3.200 → 1.200) y las diferencias de los ingresos NO cambian", stockAntes === 3200 && stockDesp === 1200 && t2.join("|") === t.join("|"), `${stockAntes}→${stockDesp} ${t2.join(" / ")}`);

  // el pedido cambia de cantidad: el histórico se conserva y «hoy» se muestra aparte
  await q("update production_pedidos set q = 2000 where id = $1", [id.p1]);
  await page.reload();
  await nav("Ingresos ME");
  await waitRow("R-PD-3");
  const t3 = await cellText("R-PD-2", "DIFERENCIA");
  check("pedido 3.000 → 2.000: el ingreso conserva su resultado histórico y muestra «hoy» aparte", /^−500 FALTAN · hoy \+500 SOBRAN$/.test(t3), t3);
  await q("update production_pedidos set q = 3000 where id = $1", [id.p1]);

  // varios pedidos activos del mismo cliente+producto → elegir
  await post({ ...ingreso(4, 50, { codigo: "E2E-PD-TAP", descripcionInsumo: "E2E-PD-TAP", producto: "GEL DOBLE" }) });
  await page.reload();
  await nav("Ingresos ME");
  await waitRow("R-PD-4");
  check("mismo cliente + producto en dos pedidos activos: ELEGIR PEDIDO, sin vincular", (await cellText("R-PD-4", "DIFERENCIA")) === "ELEGIR PEDIDO");

  // fila nueva sin confirmar: diferencia prevista, sin sumar nada
  const antesPrev = await stockOf("E2E-PD-ENV");
  const dIdx = await page.evaluate(() => [...document.querySelectorAll(".dsg-row")].findIndex((r) => r.classList.contains("genus-draft-row")));
  const dcell = async (tt) => { await reveal(tt); return page.locator(".dsg-row").nth(dIdx).locator(".dsg-cell").nth((await renderedHeaders()).indexOf(tt)); };
  for (const [tt, v] of [["CÓDIGO", "E2E-PD-ENV"], ["CLIENTE", CLI], ["PRODUCTO", "crema facial"], ["CANTIDAD", "100"]]) {
    const c = await dcell(tt);
    await c.dblclick();
    await page.keyboard.type(v);
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(500);
  const prev = (await (await dcell("DIFERENCIA")).locator("input").inputValue().catch(async () => (await (await dcell("DIFERENCIA")).innerText()))).trim();
  await page.screenshot({ path: `${OUT}/3-fila-nueva-prevista.png` });
  check("fila nueva sin confirmar: «≈ +300 SOBRAN» (3.200 + 100 − 3.000) y nada se suma al stock", prev === "≈ +300 SOBRAN" && (await stockOf("E2E-PD-ENV")) === antesPrev, prev);

  // ============ STOCK ME ============
  await nav("Inventario ME");
  await waitRow("E2E-PD-ENV");
  const hInv = await headers();
  check("Stock ME: PRODUCTO inmediatamente después de CLIENTE", hInv.indexOf("PRODUCTO") === hInv.indexOf("CLIENTE") + 1, hInv.join(" | "));
  check("Stock ME: SIN columna DIFERENCIA", !hInv.includes("DIFERENCIA"));
  check("Stock ME: muestra el stock real (1.200 tras el consumo) y el producto", /1\.?200/.test(await cellText("E2E-PD-ENV", "CANTIDAD TOTAL")) && (await cellText("E2E-PD-ENV", "PRODUCTO")).toUpperCase() === "CREMA FACIAL", `${await cellText("E2E-PD-ENV", "CANTIDAD TOTAL")} / ${await cellText("E2E-PD-ENV", "PRODUCTO")}`);
  await page.screenshot({ path: `${OUT}/1-stock-me-tablet.png` });
  await typeInto("E2E-PD-TAP", "PRODUCTO", "GEL DOBLE", "me-inventario-grid");
  check("PRODUCTO editable en Stock ME y persiste al recargar", await waitDb(async () => (await pl("inv_me_materials", id.tap))?.producto === "GEL DOBLE"));
  await page.reload();
  await nav("Inventario ME");
  await waitRow("E2E-PD-TAP");
  check("…recargado sigue GEL DOBLE y el stock no cambió por vincular/editar producto", (await cellText("E2E-PD-TAP", "PRODUCTO")) === "GEL DOBLE" && (await stockOf("E2E-PD-TAP")) === 50 && (await stockOf("E2E-PD-ENV")) === 1200);
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
