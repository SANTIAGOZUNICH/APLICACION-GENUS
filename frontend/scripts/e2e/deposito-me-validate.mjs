// E2E en Chromium real: Depósito ME como planillas editables (Etapa 2) — Ingresos, Salidas e Inventario.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production. Ver run-deposito-me-local.sh.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/deposito-me";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-01T10:00:00.000Z";
const id = { matCaja: randomUUID(), matEti: randomUUID(), i1: randomUUID(), i2: randomUUID(), i3: randomUUID(), oa1: randomUUID(), oa2: randomUUID(), m1: randomUUID(), m2: randomUUID() };
const pl = async (table, rid) => (await q(`select payload from ${table} where id = $1`, [rid]))[0]?.payload;

async function seed() {
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-ME-%'`);
  const mat = (mid, codigo, descripcion) => ({ id: mid, codigo, descripcion, cliente: "CLIENTE E2E", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false });
  const ing = (iid, nro, codigo, materialId, total) => ({ id: iid, fecha: "2026-10-01", ingresoNro: nro, proveedor: "PROV E2E", cliente: "CLIENTE E2E", remitoNro: `R-${nro}`, codigo, descripcionInsumo: codigo === "E2E-ME-CAJA" ? "Cajas E2E" : "Etiquetas E2E", bultos: 1, cantidad: total, total, ubicacion: "A1", materialId, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T });
  const sal = (sid, nro, codigo, materialId, over) => ({ id: sid, fecha: "2026-10-02", egresoNro: nro, cliente: "CLIENTE E2E", remitoNro: "", descripcion: codigo, bultos: null, cantidad: 0, total: 0, control: false, entregado: false, comentarios: "", materialId, codigo, unidad: "u", origen: "MANUAL", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T, ...over });
  await q("insert into inv_me_materials (id, payload) values ($1,$2),($3,$4)", [id.matCaja, mat(id.matCaja, "E2E-ME-CAJA", "Cajas E2E"), id.matEti, mat(id.matEti, "E2E-ME-ETI", "Etiquetas E2E")]);
  await q("insert into inv_me_ingresos (id, payload) values ($1,$2),($3,$4),($5,$6)", [id.i1, ing(id.i1, "E2E-I-1", "E2E-ME-CAJA", id.matCaja, 100), id.i2, ing(id.i2, "E2E-I-2", "E2E-ME-CAJA", id.matCaja, 50), id.i3, ing(id.i3, "E2E-I-3", "E2E-ME-ETI", id.matEti, 10)]);
  await q("insert into inv_me_salidas (id, payload) values ($1,$2),($3,$4),($5,$6),($7,$8)", [
    id.oa1, sal(id.oa1, "E2E-E-OA1", "E2E-ME-CAJA", id.matCaja, { origen: "OA", cantidad: 40, total: 40, oaId: "oa-e2e", oaNumber: "OA-2026-000777", comentarios: "Salida automática OA" }),
    id.m1, sal(id.m1, "E2E-E-M1", "E2E-ME-CAJA", id.matCaja, { cantidad: 40, total: 40, comentarios: "Entregado a Envasado para OA-2026-000777" }),
    id.m2, sal(id.m2, "E2E-E-M2", "E2E-ME-CAJA", id.matCaja, { cantidad: 5, total: 5, comentarios: "Cajas rotas en estantería" }),
    id.oa2, sal(id.oa2, "E2E-E-OA2", "E2E-ME-ETI", id.matEti, { origen: "OA", cantidad: 30, total: 30, oaId: "oa-e2e-2", oaNumber: "OA-2026-000778", comentarios: "Salida automática OA" }),
  ]);
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1500, height: 950 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const waitRow = (page, value) => page.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 120_000 });
async function cell(page, rowValue, title) {
  const pos = await page.evaluate(([v, title]) => {
    const rows = [...document.querySelectorAll(".dsg-row")];
    const header = rows.find((r) => r.classList.contains("dsg-row-header"));
    const col = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === title);
    const ri = rows.findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v));
    return { col, ri };
  }, [rowValue, title]);
  if (pos.col < 0 || pos.ri < 0) throw new Error(`celda no encontrada: ${rowValue} / ${title} ${JSON.stringify(pos)}`);
  return page.locator(".dsg-row").nth(pos.ri).locator(".dsg-cell").nth(pos.col);
}
async function typeInto(page, rowValue, title, value, gridTestId) {
  const c = await cell(page, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridTestId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply.click();
}
/** Clic en un botón de acción de la fila de la grilla que contiene `rowValue`. */
async function clickInRow(page, rowValue, selector) {
  const ok = await page.evaluate(([v, sel]) => {
    const row = [...document.querySelectorAll(".dsg-row")].find((r) => [...r.querySelectorAll("input")].some((i) => i.value === v));
    const btn = row?.querySelector(sel);
    if (btn) btn.click();
    return Boolean(btn);
  }, [rowValue, selector]);
  if (!ok) throw new Error(`acción no encontrada: ${rowValue} ${selector}`);
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
async function stockOf(ctx, codigo) {
  const res = await ctx.get("/api/v1/inventory?resource=me_inventario");
  const rows = (await res.json()).data ?? [];
  return rows.find((r) => r.codigo === codigo)?.cantidadTotal;
}

try {
  await seed();
  check("datos de prueba: ingresos, salidas OA, salidas manuales y un código con stock negativo", true);

  const dep = await openAs(E2E_USERS.deposito, { width: 2400, height: 1000 });
  const dp = dep.page;
  const api = dp.request;
  check("stock inicial: 100 + 50 − 40 (OA); la entrega manual de la misma OA NO descuenta dos veces", (await stockOf(api, "E2E-ME-CAJA")) === 110, String(await stockOf(api, "E2E-ME-CAJA")));

  // ================= INGRESOS ME =================
  await nav(dp, "Ingresos ME");
  await waitRow(dp, "E2E-I-1");
  const locked = await (await cell(dp, "E2E-I-1", "CANTIDAD")).evaluate((el) => el.classList.contains("genus-cell-protected"));
  check("Ingresos: planilla por defecto y celdas editables para Depósito (sin candado)", !locked);
  await dp.screenshot({ path: `${OUT}/1-ingresos-planilla.png` });
  await typeInto(dp, "E2E-I-1", "CANTIDAD", "120", "me-ingresos-grid");
  const okIng = await waitDb(async () => (await pl("inv_me_ingresos", id.i1))?.total === 120);
  check("editar CANTIDAD en la celda: se guarda y TOTAL se recalcula (bultos × cantidad)", okIng, JSON.stringify(await pl("inv_me_ingresos", id.i1).then((p) => ({ cantidad: p.cantidad, total: p.total }))));
  check("…y el inventario se recalcula (110 → 130)", (await stockOf(api, "E2E-ME-CAJA")) === 130);
  await dp.reload();
  await nav(dp, "Ingresos ME");
  await waitRow(dp, "E2E-I-1");
  check("tras recargar, la celda muestra exactamente 120", (await (await cell(dp, "E2E-I-1", "CANTIDAD")).locator("input").inputValue()) === "120");
  const totalLocked = await (await cell(dp, "E2E-I-1", "TOTAL")).evaluate((el) => el.classList.contains("genus-cell-protected"));
  const totalApi = await api.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: id.i1, field: "total", value: "999", expectedVersion: (await pl("inv_me_ingresos", id.i1)).updatedAt }] } });
  check("TOTAL es calculado (no se escribe a mano: celda protegida y el servidor lo rechaza)", totalLocked && totalApi.status() === 403 && (await pl("inv_me_ingresos", id.i1)).total === 120, String(totalApi.status()));
  await clickInRow(dp, "E2E-I-1", "[data-testid=me-history-open]");
  await dp.locator("[data-testid=me-history-entry]").first().waitFor({ timeout: 30_000 });
  const hist = await dp.locator("[data-testid=me-history-dialog]").innerText();
  check("historial del ingreso: cantidad 100 → 120 con usuario y fecha", /100/.test(hist) && /120/.test(hist) && /DEPOSITO/.test(hist), hist.replace(/\s+/g, " ").slice(0, 140));
  await dp.screenshot({ path: `${OUT}/2-ingresos-historial.png` });
  await dp.keyboard.press("Escape");
  const dup = await api.post("/api/v1/inventory", { data: { action: "upsert", resource: "me_ingresos", payload: { fecha: "2026-10-01", remitoNro: "R-E2E-I-2", codigo: "E2E-ME-CAJA", descripcionInsumo: "Cajas E2E", bultos: 1, cantidad: 50 } } });
  check("pegar dos veces el mismo ingreso: rechazado como posible duplicado (no suma stock dos veces)", dup.status() === 400 && /duplicado/i.test(await dup.text()) && (await stockOf(api, "E2E-ME-CAJA")) === 130);

  // ================= SALIDAS ME =================
  await nav(dp, "Salidas ME");
  await waitRow(dp, "E2E-E-M2");
  check("Salidas: la salida automática de OA está protegida (se corrige desde la OA)", await (await cell(dp, "E2E-E-OA1", "CANTIDAD")).evaluate((el) => el.classList.contains("genus-cell-protected")));
  await typeInto(dp, "E2E-E-M2", "MOTIVO", "Descarte", "me-salidas-grid");
  const okMot = await waitDb(async () => (await pl("inv_me_salidas", id.m2))?.descuentaStock === true);
  check("salida manual con motivo «Descarte / rotura»: descuenta stock (130 → 125)", okMot && (await stockOf(api, "E2E-ME-CAJA")) === 125);
  await typeInto(dp, "E2E-E-M1", "DESCUENTA STOCK", "Sí", "me-salidas-grid");
  await dp.waitForTimeout(1500);
  const notice = await dp.locator("[data-testid=me-salidas-grid-notice], [data-testid=me-salidas-grid-failed]").allInnerTexts().catch(() => []);
  const m1 = await pl("inv_me_salidas", id.m1);
  check("marcar «descuenta» una salida que menciona la OA: rechazado (no descuenta dos veces) y nada cambia", !m1.descuentaStock && (await stockOf(api, "E2E-ME-CAJA")) === 125, notice.join(" ").slice(0, 160));
  await dp.screenshot({ path: `${OUT}/3-salidas-planilla.png` });

  // ================= INVENTARIO ME =================
  await nav(dp, "Inventario ME");
  await waitRow(dp, "E2E-ME-CAJA");
  const cajaStock = await (await cell(dp, "E2E-ME-CAJA", "CANTIDAD TOTAL")).locator("input").inputValue();
  check("Inventario muestra el stock recalculado (125)", /125/.test(cajaStock), cajaStock);
  check("CANTIDAD TOTAL no se edita a mano", await (await cell(dp, "E2E-ME-CAJA", "CANTIDAD TOTAL")).evaluate((el) => el.classList.contains("genus-cell-protected")));
  const etiText = await (await cell(dp, "E2E-ME-ETI", "CANTIDAD TOTAL")).locator("input").inputValue();
  check("stock negativo visible (−20), no oculto ni llevado a 0", /-20|−20|NEGATIVO/.test(etiText), etiText);
  await typeInto(dp, "E2E-ME-CAJA", "STOCK MÍNIMO", "30", "me-inventario-grid");
  check("umbral STOCK MÍNIMO editado en la planilla y persistido", await waitDb(async () => (await pl("inv_me_materials", id.matCaja))?.stockMinimo === 30));
  await dp.screenshot({ path: `${OUT}/4-inventario-planilla.png` });

  // corregir el negativo: movimientos + ajuste con motivo (conteo real = 15)
  await clickInRow(dp, "E2E-ME-ETI", "[data-testid=me-stock-open]");
  await dp.locator("[data-testid=me-movimiento]").first().waitFor({ timeout: 30_000 });
  check("«Corregir»: muestra el aviso de negativo y los movimientos con saldo", (await dp.locator("[data-testid=me-stock-negativo]").count()) === 1 && (await dp.locator("[data-testid=me-movimiento]").count()) === 2);
  await dp.screenshot({ path: `${OUT}/5-corregir-negativo.png` });
  await dp.locator("[data-testid=me-ajuste-nuevo]").fill("15");
  await dp.locator("[data-testid=me-ajuste-motivo]").fill("Conteo físico: había 15 etiquetas");
  await dp.locator("[data-testid=me-ajuste-guardar]").click();
  await dp.locator("[data-testid=me-ajuste-ok]").waitFor({ timeout: 30_000 });
  check("ajuste con motivo: stock −20 → 15 y queda como movimiento AJUSTE", (await stockOf(api, "E2E-ME-ETI")) === 15 && (await dp.locator("[data-testid=me-movimiento]").count()) === 3);
  await dp.screenshot({ path: `${OUT}/6-ajuste-registrado.png` });
  await dp.keyboard.press("Escape");
  await dp.reload();
  await nav(dp, "Inventario ME");
  await waitRow(dp, "E2E-ME-ETI");
  check("tras recargar: 15 en Inventario y el umbral en 30", /15/.test(await (await cell(dp, "E2E-ME-ETI", "CANTIDAD TOTAL")).locator("input").inputValue()) && (await (await cell(dp, "E2E-ME-CAJA", "STOCK MÍNIMO")).locator("input").inputValue()) === "30");

  // ================= CONCURRENCIA Y PERMISOS =================
  const stale = await api.post("/api/v1/inventory/me-ajustes", { data: { materialId: id.matEti, expectedStock: -20, newStock: 0, motivo: "Ajuste con dato viejo", tipo: "OTRO" } });
  check("ajuste con stock viejo (−20 cuando ya es 15) → 409, no se pisa", stale.status() === 409 && (await stockOf(api, "E2E-ME-ETI")) === 15, String(stale.status()));
  const v = (await pl("inv_me_ingresos", id.i2)).updatedAt;
  const [a, b] = await Promise.all([
    api.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: id.i2, field: "cantidad", value: "51", expectedVersion: v }] } }),
    api.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: id.i2, field: "cantidad", value: "52", expectedVersion: v }] } }),
  ]);
  check("dos ediciones simultáneas de la misma celda: una 200, la otra 409", [a.status(), b.status()].sort().join(",") === "200,409", `${a.status()},${b.status()}`);
  await dep.ctx.close();

  const prodCtx = await pwRequest.newContext({ baseURL: BASE });
  await prodCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  const prodIng = await prodCtx.patch("/api/v1/inventory/cells", { data: { resource: "me_ingresos", changes: [{ id: id.i1, field: "cantidad", value: "1", expectedVersion: (await pl("inv_me_ingresos", id.i1)).updatedAt }] } });
  check("Producción NO edita ingresos (403); el ingreso no cambia", prodIng.status() === 403 && (await pl("inv_me_ingresos", id.i1)).total === 120, String(prodIng.status()));
  const prodAdj = await prodCtx.post("/api/v1/inventory/me-ajustes", { data: { materialId: id.matEti, expectedStock: 15, newStock: 14, motivo: "Conteo de Producción", tipo: "CONTEO_FISICO" } });
  check("Producción SÍ registra ajustes de inventario (permiso conservado)", prodAdj.status() === 200 && (await stockOf(prodCtx, "E2E-ME-ETI")) === 14, String(prodAdj.status()));
  await prodCtx.dispose();
  const envCtx = await pwRequest.newContext({ baseURL: BASE });
  await envCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.envasado.email, password: E2E_PASSWORD } });
  const envAdj = await envCtx.post("/api/v1/inventory/me-ajustes", { data: { materialId: id.matEti, expectedStock: 14, newStock: 0, motivo: "Intento de Envasado", tipo: "OTRO" } });
  check("Envasado no ajusta inventario (403)", envAdj.status() === 403, String(envAdj.status()));
  await envCtx.dispose();
  const audits = await q("select count(*)::int n from inv_audit where payload->>'entityId' = any($1)", [[id.i1, id.m2, id.matCaja, id.matEti]]);
  check("auditoría en la base para cada cambio (ingreso, salida, umbral, ajustes)", audits[0].n >= 5, String(audits[0].n));
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
