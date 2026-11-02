// E2E en Chromium real: Depósito → Ingresos (historial permanente) vs Inventario (stock). Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/deposito-ingresos-historial";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const cleanup = async () => { for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-IH-%'`).catch(() => undefined); };
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const debugPages = [];
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const gridHas = (page, v) => page.waitForFunction((x) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === x), v, { timeout: 60_000 }).then(() => true, () => false);
const dbIngresos = async () => q("select payload from inv_me_ingresos where payload->>'codigo' like 'E2E-IH-%' order by payload->>'createdAt'").then((r) => r.map((x) => x.payload));
const stockOf = async (api, codigo) => ((await (await api.get("/api/v1/inventory?resource=me_inventario")).json()).data ?? []).find((r) => r.codigo === codigo)?.cantidadTotal;

try {
  await cleanup();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 2400, height: 1000 } });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.deposito.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  const api = page.request;

  const crear = async (codigo, cantidad, remito, fecha) => {
    await page.getByRole("button", { name: "Nuevo ingreso", exact: true }).click();
    const dlg = page.locator("div.fixed.inset-0").filter({ hasText: "Nuevo ingreso ME" });
    const set = async (label, v) => dlg.locator("label").filter({ hasText: new RegExp(`^${label}`) }).locator("input").first().fill(v);
    await set("FECHA", fecha); await set("PROVEEDOR", "PROV E2E"); await set("CLIENTE", "CLIENTE E2E"); await set("REMITO Nº", remito);
    await set("CÓDIGO", codigo); await set("DESCRIPCIÓN INSUMO", "Frasco E2E"); await set("BULTOS", "1"); await set("CANTIDAD", String(cantidad));
    return dlg;
  };

  await nav(page, "Ingresos ME");
  await page.getByRole("button", { name: "Nuevo ingreso", exact: true }).waitFor({ timeout: 120_000 });

  // 1-2) ingreso de 2.000 por el formulario; doble clic en Guardar guarda una sola vez
  const dlg = await crear("E2E-IH-FRASCO", 2000, "R-IH-1", "2026-11-02");
  const guardar = dlg.getByRole("button", { name: "Guardar" });
  await guardar.evaluate((b) => { b.click(); b.click(); }); // dos envíos en el mismo instante
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
  check("1) ingreso de 2.000 registrado: una sola fila en la base (doble clic no duplica)", (await dbIngresos()).filter((r) => r.total === 2000).length === 1, JSON.stringify((await dbIngresos()).map((r) => r.total)));
  check("2) el inventario suma exactamente 2.000", (await stockOf(api, "E2E-IH-FRASCO")) === 2000, String(await stockOf(api, "E2E-IH-FRASCO")));
  check("3) el ingreso es visible en Ingresos", await gridHas(page, "R-IH-1"));
  await page.screenshot({ path: `${OUT}/1-ingreso-registrado.png` });

  // 4) recargar
  await page.reload();
  await nav(page, "Ingresos ME");
  check("4) tras recargar el ingreso sigue en Ingresos", await gridHas(page, "R-IH-1"));
  check("4b) …y el stock sigue en 2.000 (recargar no suma)", (await stockOf(api, "E2E-IH-FRASCO")) === 2000);

  // 5-7) salida de 500 por API (como la UI de Salidas): stock 1.500, ingreso intacto
  const sal = await api.post("/api/v1/inventory", { data: { action: "upsert", resource: "me_salidas", payload: { fecha: "2026-11-03", cliente: "CLIENTE E2E", codigo: "E2E-IH-FRASCO", cantidad: 500, motivoSalida: "DESCARTE", descuentaStock: true } } });
  check("5) salida de 500 registrada", sal.status() === 200, String(sal.status()));
  check("6) stock disponible 1.500", (await stockOf(api, "E2E-IH-FRASCO")) === 1500);
  await page.reload();
  await nav(page, "Ingresos ME");
  check("7) el ingreso histórico sigue mostrando 2.000 ingresadas", (await gridHas(page, "R-IH-1")) && (await dbIngresos())[0].total === 2000);

  // 8) varios ingresos separados
  const dlg2 = await crear("E2E-IH-FRASCO", 300, "R-IH-2", "2026-11-04");
  await dlg2.getByRole("button", { name: "Guardar" }).click();
  await dlg2.waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
  check("8) un segundo ingreso del mismo material aparece por separado", (await gridHas(page, "R-IH-1")) && (await gridHas(page, "R-IH-2")) && (await dbIngresos()).length === 2);
  check("8b) stock = 1.500 + 300", (await stockOf(api, "E2E-IH-FRASCO")) === 1800);

  // búsqueda por material / cliente / fecha
  const search = page.getByPlaceholder("Buscar…");
  const visible = async (v) => page.evaluate((x) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === x), v);
  await search.fill("04/11/2026"); await page.waitForTimeout(400);
  check("búsqueda por fecha (dd/mm/aaaa)", (await visible("R-IH-2")) && !(await visible("R-IH-1")));
  await search.fill("2026-11-02"); await page.waitForTimeout(400);
  check("búsqueda por fecha (aaaa-mm-dd)", (await visible("R-IH-1")) && !(await visible("R-IH-2")));
  await search.fill("E2E-IH-FRASCO"); await page.waitForTimeout(400);
  check("búsqueda por material", (await visible("R-IH-1")) && (await visible("R-IH-2")));
  await search.fill("CLIENTE E2E"); await page.waitForTimeout(400);
  check("búsqueda por cliente", (await visible("R-IH-1")) && (await visible("R-IH-2")));
  await search.fill("");

  // 9) baja del material: los ingresos quedan en el historial como anulados
  const mats = (await (await api.get("/api/v1/inventory?resource=me_stock")).json()).data ?? [];
  const mat = mats.find((m) => m.codigo === "E2E-IH-FRASCO");
  const del = await api.post("/api/v1/inventory", { data: { action: "delete", resource: "me_stock", id: mat.id, reason: "E2E baja" } });
  check("9) baja del material aceptada", del.status() === 200, String(del.status()));
  const after = await dbIngresos();
  check("9b) los ingresos NO se borran: siguen en la base, anulados, con motivo de la baja", after.length === 2 && after.every((r) => r.anulado === true && /baja/i.test(r.anuladoReason ?? "")), JSON.stringify(after.map((r) => [r.anulado, r.anuladoReason])));
  await page.reload();
  await nav(page, "Ingresos ME");
  check("9c) siguen visibles en Ingresos marcados como ANULADO", (await gridHas(page, "R-IH-1")) && (await page.evaluate(() => [...document.querySelectorAll(".dsg-row")].filter((r) => /ANULADO · Material dado de baja/.test(r.textContent + [...r.querySelectorAll("input")].map((i) => i.value).join(" "))).length)) >= 2);
  await page.screenshot({ path: `${OUT}/2-anulados-visibles.png` });
  await page.locator("[data-testid=me-ingresos-show-anulados]").uncheck();
  await page.waitForTimeout(400);
  check("9d) el interruptor «Mostrar anulados» los oculta/muestra sin tocar datos", !(await visible("R-IH-1")) && (await dbIngresos()).length === 2);
  await page.locator("[data-testid=me-ingresos-show-anulados]").check();

  // permisos: Producción lee pero no registra
  const prodCtx = await browser.newContext({ baseURL: BASE });
  const pp = await prodCtx.newPage();
  await pp.goto("/login");
  await pp.locator('input[type="email"]').fill(E2E_USERS.produccion.email);
  await pp.locator('input[type="password"]').fill(E2E_PASSWORD);
  await pp.locator('button[type="submit"]').click();
  await pp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  const w = await pp.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "me_ingresos", payload: { codigo: "E2E-IH-NOPE", cantidad: 1 } } });
  check("permisos: Producción no puede registrar ingresos (403)", w.status() === 403, String(w.status()));
  await prodCtx.close();
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
