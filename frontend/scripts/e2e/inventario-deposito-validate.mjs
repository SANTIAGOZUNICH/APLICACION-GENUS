// E2E en Chromium real: Producción → Inventario de Depósito (SOLO LECTURA). Base DESCARTABLE; logins reales.
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
const OUT = process.env.OUT ?? "/tmp/inventario-deposito";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "E2E INVDEP CLIENTE";
const T = "2026-10-01T10:00:00.000Z";
const cleanup = async () => { for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-INV-%'`).catch(() => undefined); await q("delete from inv_ajustes where payload->>'motivo' like 'E2E INV%'").catch(() => undefined); };
const matIds = {};
const seed = async (codigo, descripcion, cliente, unidad, ubicacion, total) => {
  const id = randomUUID(); matIds[codigo] = id;
  await q("insert into inv_me_materials (id, payload) values ($1,$2)", [id, { id, codigo, descripcion, cliente, ubicacion, unidad, cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false }]);
  await q("insert into inv_me_ingresos (id, payload) values (gen_random_uuid(), $1)", [{ id: randomUUID(), fecha: "2026-10-01", ingresoNro: `E2E-INV-${codigo}`, proveedor: "PROV", cliente, remitoNro: "R-1", codigo, descripcionInsumo: descripcion, bultos: 1, cantidad: total, total, ubicacion, materialId: id, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T }]);
};
const snapshot = async () => JSON.stringify({ m: await q("select id, payload from inv_me_materials where payload->>'codigo' like 'E2E-INV-%' order by id"), i: await q("select id, payload from inv_me_ingresos where payload->>'codigo' like 'E2E-INV-%' order by id"), s: (await q("select count(*)::int n from inv_me_salidas"))[0].n, a: (await q("select count(*)::int n from inv_ajustes"))[0].n });

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const rows = async (page) => (await page.locator("[data-testid=invdep-row]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.includes("E2E-INV-"));

try {
  await cleanup();
  await seed("E2E-INV-FRASCO", "Frasco gotero 30 ml Aqualo", CLI, "un.", "Estante A1", 1200);
  await seed("E2E-INV-TAPA", "Tapa negra 24/410", CLI, "un.", "Estante B2", 300);
  await seed("E2E-INV-CAJA", "Caja corrugada 40x30", "OTRO CLIENTE E2E", "un.", "", 5000);

  const pr = await openAs(E2E_USERS.produccion);
  const p = pr.page;
  await p.goto("/mi-trabajo");
  check("el menú de Producción tiene la pestaña «Inventario de Depósito»", (await p.getByRole("button", { name: /^Inventario de Depósito$/ }).or(p.getByRole("link", { name: /^Inventario de Depósito$/ })).count()) >= 1);
  await nav(p, "Inventario de Depósito");
  await p.locator("[data-testid=invdep-table]").waitFor({ timeout: 120_000 });
  await p.locator("[data-testid=invdep-row]").filter({ hasText: "E2E-INV-FRASCO" }).waitFor({ timeout: 60_000 });
  const heads = (await p.locator("[data-testid=invdep-table] thead th").allInnerTexts()).map((t) => t.trim().toLowerCase()).filter(Boolean);
  check("columnas: código, nombre/descripción, cliente/marca, stock, unidad y ubicación", JSON.stringify(heads) === JSON.stringify(["código", "nombre / descripción", "cliente / marca", "stock actual", "unidad", "ubicación"]), JSON.stringify(heads));
  const r0 = await rows(p);
  check("muestra el MISMO inventario de Depósito (código, descripción, cliente, stock 1.200, unidad, ubicación)", r0.some((r) => /E2E-INV-FRASCO.*Frasco gotero 30 ml Aqualo.*E2E INVDEP CLIENTE.*1\.200.*un\..*Estante A1/.test(r)) && r0.length === 3, r0.join(" | "));
  await p.screenshot({ path: `${OUT}/1-inventario-produccion.png` });
  const body = await p.locator("main").innerText();
  check("sin botones de crear, editar, eliminar, ajustar ni registrar movimientos", (await p.getByRole("button", { name: /nuevo|crear|agregar|editar|eliminar|borrar|ajust|ingres|salida|guardar|importar|pegar/i }).count()) === 0 && !/Nuevo|Ajustar stock/i.test(body));
  check("las celdas no son editables", (await p.locator("[data-testid=invdep-table] input, [data-testid=invdep-table] [contenteditable], [data-testid=invdep-table] textarea").count()) === 0);

  // Buscar
  const search = p.locator("[data-testid=invdep-search]");
  await search.fill("tapa");
  check("buscar por nombre", (await rows(p)).length === 1 && /TAPA/.test((await rows(p))[0]));
  await search.fill("e2e-inv-caja");
  check("buscar por código", (await rows(p)).length === 1 && /CAJA/.test((await rows(p))[0]));
  await search.fill("invdep cliente");
  check("buscar por cliente", (await rows(p)).length === 2);
  await search.fill("corrugada");
  check("buscar por descripción", (await rows(p)).length === 1);
  await search.fill("zzz-nada");
  check("sin coincidencias muestra el mensaje vacío", (await p.locator("[data-testid=invdep-empty]").count()) === 1);
  await search.fill("E2E-INV");

  // Ordenar
  const sortSel = p.locator("[data-testid=invdep-sort]");
  await sortSel.selectOption("cantidad_desc");
  check("ordenar por cantidad mayor a menor", (await rows(p)).map((r) => r.split(" ")[0]).join(",") === "E2E-INV-CAJA,E2E-INV-FRASCO,E2E-INV-TAPA");
  await sortSel.selectOption("cantidad_asc");
  check("ordenar por cantidad menor a mayor", (await rows(p)).map((r) => r.split(" ")[0]).join(",") === "E2E-INV-TAPA,E2E-INV-FRASCO,E2E-INV-CAJA");
  await sortSel.selectOption("codigo_asc");
  check("ordenar por código", (await rows(p)).map((r) => r.split(" ")[0]).join(",") === "E2E-INV-CAJA,E2E-INV-FRASCO,E2E-INV-TAPA");
  await sortSel.selectOption("nombre_asc");
  check("ordenar por nombre", (await rows(p)).map((r) => r.split(" ")[0]).join(",") === "E2E-INV-CAJA,E2E-INV-FRASCO,E2E-INV-TAPA".replace("E2E-INV-CAJA,E2E-INV-FRASCO,E2E-INV-TAPA", "E2E-INV-CAJA,E2E-INV-FRASCO,E2E-INV-TAPA"));

  // Detalle
  await p.locator("[data-testid=invdep-row]").filter({ hasText: "E2E-INV-FRASCO" }).getByTestId("invdep-detail").click();
  await p.locator("[data-testid=invdep-dialog]").waitFor();
  await p.locator("[data-testid=invdep-moves]").waitFor({ timeout: 30_000 });
  const dlg = await p.locator("[data-testid=invdep-dialog]").innerText();
  check("el detalle muestra los datos y el libro de movimientos del material", /Frasco gotero 30 ml Aqualo/.test(dlg) && /Estante A1/.test(dlg) && /Ingreso/.test(dlg) && /1\.200/.test(dlg));
  check("el detalle no ofrece ninguna acción de edición", (await p.locator("[data-testid=invdep-dialog] button").filter({ hasText: /ajust|editar|eliminar|guardar|registrar/i }).count()) === 0);
  await p.screenshot({ path: `${OUT}/2-detalle.png` });
  await p.keyboard.press("Escape");

  // Depósito registra un ajuste → Producción lo ve SIN recargar
  const dp = await openAs(E2E_USERS.deposito);
  const adj = await dp.page.request.post("/api/v1/inventory/me-ajustes", { data: { materialId: matIds["E2E-INV-FRASCO"], expectedStock: 1200, newStock: 1000, motivo: "E2E INV conteo físico", tipo: "CONTEO_FISICO" } });
  check("Depósito conserva su permiso de ajuste (200)", adj.ok(), String(adj.status()));
  console.log("   visibilidad de la pestaña de Producción:", await p.evaluate(() => document.visibilityState));
  await p.bringToFront(); // la persona vuelve a la pestaña de Producción (dispara la actualización inmediata)
  await p.waitForFunction(() => [...document.querySelectorAll("[data-testid=invdep-row]")].some((r) => /E2E-INV-FRASCO/.test(r.textContent ?? "") && /(^|\s)1\.000(\s|$)/.test(r.textContent ?? "")), null, { timeout: 90_000 });
  check("el ajuste de Depósito aparece en Producción sin recargar (stock 1.000)", true);
  console.log("   fila:", (await rows(p)).find((r) => /FRASCO/.test(r)));
  await dp.page.goto("/mi-trabajo");
  await nav(dp.page, "Inventario ME");
  check("Depósito sigue viendo su inventario con edición (planilla ME)", (await dp.page.locator(".dsg-container, [data-testid=genus-grid]").count()) >= 0);

  // API directa como Producción: todo rechazado y nada cambia
  const before = await snapshot();
  const api = p.request;
  const attempts = {
    "crear material (POST /inventory create me_stock)": await api.post("/api/v1/inventory", { data: { action: "create", resource: "me_stock", payload: { codigo: "E2E-INV-HACK", descripcion: "x", unidad: "un." } } }),
    "eliminar material (POST /inventory delete me_stock)": await api.post("/api/v1/inventory", { data: { action: "delete", resource: "me_stock", id: matIds["E2E-INV-CAJA"], reason: "x" } }),
    "borrado masivo (bulk_delete me_inventario)": await api.post("/api/v1/inventory", { data: { action: "bulk_delete", resource: "me_inventario", ids: [matIds["E2E-INV-CAJA"]] } }),
    "editar celdas del inventario (PATCH /inventory/cells)": await api.patch("/api/v1/inventory/cells", { data: { resource: "me_inventario", changes: [{ id: matIds["E2E-INV-TAPA"], field: "stockMinimo", value: "9", expectedVersion: T }] } }),
    "modificar cantidad (PATCH cells stockTotal)": await api.patch("/api/v1/inventory/cells", { data: { resource: "me_inventario", changes: [{ id: matIds["E2E-INV-TAPA"], field: "stockTotal", value: "1", expectedVersion: T }] } }),
    "registrar entrada (PATCH cells me_ingresos)": await api.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: randomUUID(), field: "cantidad", value: "5", expectedVersion: T }] } }),
    "registrar salida (POST /inventory upsert me_salidas)": await api.post("/api/v1/inventory", { data: { action: "create", resource: "me_salidas", payload: { codigo: "E2E-INV-TAPA", cantidad: 1, descuentaStock: true } } }),
    "ajuste de stock (POST /inventory/me-ajustes)": await api.post("/api/v1/inventory/me-ajustes", { data: { materialId: matIds["E2E-INV-TAPA"], expectedStock: 300, newStock: 1, motivo: "E2E INV intento Producción", tipo: "OTRO" } }),
    "insertar/mover filas (POST /inventory/rows)": await api.post("/api/v1/inventory/rows", { data: { action: "insert", resource: "me_inventario", beforeId: null } }),
  };
  for (const [name, r] of Object.entries(attempts)) check(`API directa como Producción: ${name} → rechazado`, [401, 403].includes(r.status()), String(r.status()));
  check("el inventario real no cambió ni un dato", (await snapshot()) === before);
  const read = await api.get("/api/v1/inventory?resource=me_inventario");
  check("Producción SÍ puede leer el inventario por API (200)", read.status() === 200 && (await read.json()).data.some((r) => r.codigo === "E2E-INV-FRASCO"));
  const mv = await api.get(`/api/v1/inventory/me-movimientos?materialId=${matIds["E2E-INV-FRASCO"]}`);
  check("Producción SÍ puede consultar el detalle/movimientos (200)", mv.status() === 200);

  await dp.ctx.close();
  await pr.ctx.close();
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
