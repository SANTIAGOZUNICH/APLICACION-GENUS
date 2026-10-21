// E2E (Chromium real, base DESCARTABLE): ENTREGAR OE NUNCA se bloquea por datos de MP.
// - OE con 14 MP (sin CÓDIGO MP, código inexistente, sin KG REAL, sin fórmula): se entrega con un clic (doble clic = 1 envío),
//   sin descontar stock, con el consumo pendiente auditado; tras recargar sigue entregada; no se puede volver a entregar.
// - Stock insuficiente: Elaboración entrega igual; Producción autoriza el descuento con motivo (auditado).
// - Regularización: completar el CÓDIGO MP faltante y descontar UNA sola vez (reintento no duplica).
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
const OUT = process.env.OUT ?? "/tmp/oe-entrega-sin-bloqueo";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

const today = new Date().toISOString().slice(0, 10);
const AGUA = "E2E-SB-AGUA";
const GLI = "E2E-SB-GLI";
const POCO = "E2E-SB-POCO";
const CODES = [AGUA, GLI, POCO];
const PRODUCT = "CREMA SIN BLOQUEO E2E";

async function openAs(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
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
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const oe = async (id) => (await q("select id, order_number, status, version, form_data from operational_orders where id = $1", [id]))[0];
const lotKg = async (codigo, lote) => (await q("select payload from inv_mp_stock where payload->>'codigo' = $1 and payload->>'lote' = $2", [codigo, lote]))[0]?.payload?.cantidadKg;
const ledgerKg = async (codigo) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [codigo]))[0]?.stock_actual ?? NaN);
const oeMovs = async (id) => q("select codigo, lote, kind, quantity, idempotency_key, actor_email, created_at from mp_stock_movements where ref_type = 'oe' and ref_id = $1 order by created_at, id", [id]);
const allMovs = async () => q("select id, codigo, kind, quantity, idempotency_key from mp_stock_movements where codigo = any($1) order by created_at, id", [CODES]);
/** Integridad: por código, suma de kg de sus lotes = saldo del libro mayor. */
async function integrity() {
  const out = {};
  for (const c of CODES) {
    const lots = (await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [c])).reduce((s, r) => s + Number(r.payload.cantidadKg ?? 0), 0);
    out[c] = [Number(lots.toFixed(4)), await ledgerKg(c)];
  }
  return { ok: Object.values(out).every(([a, b]) => Math.abs(a - b) < 1e-6), out };
}

async function cleanup() {
  const prev = await q("select id from operational_orders where product = $1", [PRODUCT]);
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
  }
  await q("delete from operational_orders where product = $1", [PRODUCT]);
  await q("delete from inv_mp_ingresos where payload->>'codigo' = any($1)", [CODES]);
  await q("delete from inv_mp_stock where payload->>'codigo' = any($1)", [CODES]);
  await q("delete from mp_stock_movements where codigo = any($1)", [CODES]);
  await q("delete from mp_stock_balances where codigo = any($1)", [CODES]);
}

/** Stock real: ingresos confirmados de Materias Primas (crean el lote y el movimiento del libro mayor). */
async function seedStock(page) {
  for (const [codigo, descripcion, lote, kg] of [
    [AGUA, "AGUA E2E CR", "A1", 100],
    [AGUA, "AGUA E2E CR", "A2", 50],
    [GLI, "GLICERINA E2E CR", "G1", 200],
    [POCO, "ESENCIA E2E CR", "P1", 3],
  ]) {
    const r = await page.request.post("/api/v1/inventory", {
      data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-SB-${lote}`, codigo, descripcion, lote, proveedor: "PROV CR", bultos: 1, cantidad: kg } },
    });
    if (!r.ok()) throw new Error(`ingreso ${codigo}/${lote}: ${r.status()} ${await r.text()}`);
  }
  // Fila separada para el lote G2 de GLICERINA: MP la da de alta y le carga 60 kg con «Ajustar stock» (motivo → libro mayor).
  const up = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_stock", payload: { codigo: GLI, descripcion: "GLICERINA E2E CR", lote: "G2", cantidadKg: 0 } } });
  if (!up.ok()) throw new Error(`alta G2: ${up.status()} ${await up.text()}`);
  const g2 = (await q("select payload from inv_mp_stock where payload->>'codigo' = $1 and payload->>'lote' = 'G2'", [GLI]))[0].payload;
  const aj = await page.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: g2.id, field: "cantidadKg", value: "60", expectedVersion: g2.updatedAt, reason: "Alta lote G2 (E2E)" }] } });
  if (!aj.ok()) throw new Error(`ajuste G2: ${aj.status()} ${await aj.text()}`);
}

/** Producción arma la OE con su fórmula (sin consumos: eso lo carga Elaboración). */
async function createOe(page, lot, quantityKg, materials) {
  const res = await page.request.post("/api/v1/orders", { data: { type: "OE", fromScratch: true, product: PRODUCT, code: "PT-CR", client: "CLIENTE CR", lot, assignedSector: "ELABORACION" } });
  if (!res.ok()) throw new Error(`crear OE: ${res.status()} ${await res.text()}`);
  const o = (await res.json()).order;
  const fd = o.formData;
  fd.header = { ...fd.header, productName: PRODUCT, code: "PT-CR", date: today, quantityKg, lot, client: "CLIENTE CR" };
  fd.materials = materials.map((m, i) => ({ id: `m${i + 1}`, codigoMp: "", kgReal: null, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "", parentRowId: null, kgAPesar: null, ...m }));
  fd.procedureSteps = [{ id: "p1", text: "Mezclar" }];
  fd.processControl = { ...fd.processControl, cantidadObtenida: quantityKg, fechaFin: today };
  fd.qualityControl = { ...fd.qualityControl, resultado: "OK" };
  const up = await page.request.patch(`/api/v1/orders/${o.id}`, { data: { expectedVersion: o.version, formData: fd } });
  if (!up.ok()) throw new Error(`fórmula OE: ${up.status()} ${await up.text()}`);
  return o.id;
}

/** Elaboración guarda por API (para preparar escenarios que no son de UI). */
async function elabSave(page, id, edit) {
  const cur = await oe(id);
  const fd = cur.form_data;
  fd.materials = edit(fd.materials);
  const r = await page.request.patch(`/api/v1/orders/${id}`, { data: { expectedVersion: cur.version, formData: fd } });
  if (!r.ok()) throw new Error(`guardar OE: ${r.status()} ${await r.text()}`);
}

async function openOe(page, number) {
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768) await page.getByRole("button", { name: "Abrir menú" }).click({ timeout: 60_000 }); // celular: menú colapsado
  await nav(page, "Órdenes de Elaboración");
  await page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(number);
  await page.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  // En la grilla de escritorio el encabezado fijo puede tapar el botón: se dispara el clic directamente.
  await page.getByRole("button", { name: /^Abrir$/ }).first().dispatchEvent("click");
  await page.locator("[data-testid=oe-materials-table]").waitFor({ timeout: 60_000 });
}
const AG = AGUA;
async function seed(page) {
  for (const [codigo, descripcion, lote, kg] of [[AG, "AGUA E2E SB", "A1", 100], [POCO, "ESENCIA E2E SB", "P1", 3]]) {
    const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-SB-${lote}`, codigo, descripcion, lote, proveedor: "PROV SB", bultos: 1, cantidad: kg } } });
    if (!r.ok()) throw new Error(`ingreso ${codigo}: ${r.status()} ${await r.text()}`);
  }
}
const auditCount = async (id, type) => (await q("select 1 from order_audit_events where order_id = $1 and event_type = $2", [id, type])).length;

try {
  await cleanup();
  const mp = await openAs(E2E_USERS.materiaPrima);
  await seed(mp.page);
  const pr = await openAs(E2E_USERS.produccion);
  check("Stock inicial: AGUA 100, ESENCIA 3; lotes = libro mayor", (await lotKg(AG, "A1")) === 100 && (await lotKg(POCO, "P1")) === 3 && (await integrity()).ok, JSON.stringify((await integrity()).out));

  // ===== Caso de la captura: 14 MP incompletas =====
  const rows14 = Array.from({ length: 14 }, (_, i) => ({ materiaPrima: `MP E2E ${i}`, codigo: "", codigoMp: i < 8 ? "" : i === 8 ? "NO-EXISTE-E2E" : AG, formulaPct: i < 12 ? 5 : null }));
  const idE = await createOe(pr.page, "L-SB-E", 100, rows14);
  const numE = (await oe(idE)).order_number;
  const movs0 = (await allMovs()).length;
  const elE = await openAs(E2E_USERS.elaboracion);
  await openOe(elE.page, numE);
  let delivers = 0;
  elE.page.on("request", (r) => { if (r.url().includes(`/orders/${idE}/deliver`) && r.method() === "POST") delivers += 1; });
  await elE.page.getByRole("button", { name: /^ENTREGAR OE$/ }).first().dblclick();
  check("14 MP incompletas: la OE se ENTREGA (COMPLETA) con un clic", await waitDb(async () => (await oe(idE)).status === "COMPLETA"), (await oe(idE)).status);
  check("…una sola solicitud aunque se pulse dos veces", delivers === 1, String(delivers));
  await elE.page.locator("[data-testid=oe-mp-pendiente]").waitFor({ timeout: 30_000 });
  const bodyTxt = await elE.page.locator("body").innerText();
  check("…sin «No se entregó», sin diálogo con las 14 filas", !/No se entregó/.test(bodyTxt) && (await elE.page.locator("[data-testid=mp-consumo-issues]").count()) === 0);
  check("…aviso informativo posterior", /OE entregada\. El descuento de materias primas quedó pendiente por datos incompletos/.test(await elE.page.locator("[data-testid=oe-deliver-notice]").innerText()));
  check("…sin movimientos ni stock inventado (AGUA sigue 100)", (await allMovs()).length === movs0 && (await lotKg(AG, "A1")) === 100 && (await integrity()).ok);
  check("…consumo pendiente auditado y entrega auditada", (await auditCount(idE, "OE_MP_CONSUMO_PENDIENTE")) === 1 && (await auditCount(idE, "ORDER_DELIVERED_INCOMPLETE")) + (await auditCount(idE, "ORDER_DELIVERED")) === 1);
  await elE.page.screenshot({ path: `${OUT}/01-entrega-14-mp.png`, fullPage: true });
  await elE.page.reload();
  await openOe(elE.page, numE);
  check("Tras recargar: entrega registrada y descuento pendiente visible", (await oe(idE)).status === "COMPLETA" && (await elE.page.locator("[data-testid=oe-mp-pendiente]").count()) === 1);
  const again = await elE.page.request.post(`/api/v1/orders/${idE}/deliver`, { data: { confirm: true } });
  check("Nueva entrega: rechazada (400) y sin duplicar", again.status() === 400 && (await allMovs()).length === movs0, String(again.status()));
  check("Aparece en el sector destinatario (notificación a Producción)", (await q("select 1 from os_notifications where order_id = $1 and kind like 'oe_completada%'", [idE])).length >= 1);
  await elE.ctx.close();

  // ===== Stock insuficiente: Elaboración entrega; Producción autoriza el descuento =====
  const idC = await createOe(pr.page, "L-SB-C", 100, [{ materiaPrima: "AGUA E2E SB", codigo: AG, codigoMp: AG, formulaPct: 95 }, { materiaPrima: "ESENCIA E2E SB", codigo: POCO, codigoMp: POCO, formulaPct: 5 }]);
  const numC = (await oe(idC)).order_number;
  const el = await openAs(E2E_USERS.elaboracion);
  await elabSave(el.page, idC, (ms) => [{ ...ms[0], kgReal: 5, lote: "A1" }, { ...ms[1], kgReal: 5, lote: "P1" }]);
  await openOe(el.page, numC);
  await el.page.getByRole("button", { name: /^ENTREGAR OE$/ }).first().click();
  await el.page.locator("[data-testid=oe-mp-pendiente]").waitFor({ timeout: 30_000 });
  check("Stock insuficiente: la OE se entrega (COMPLETA) y nada parcial se descuenta", await waitDb(async () => (await oe(idC)).status === "COMPLETA") && (await lotKg(AG, "A1")) === 100 && (await lotKg(POCO, "P1")) === 3 && (await oeMovs(idC)).length === 0);
  await el.ctx.close();
  await openOe(pr.page, numC);
  await pr.page.locator("[data-testid=mp-authorize-open]").click();
  await pr.page.locator("[data-testid=mp-shortage-reason]").waitFor({ timeout: 30_000 });
  check("Producción: «Autorizar y descontar» deshabilitado sin motivo", await pr.page.locator("[data-testid=mp-shortage-authorize]").isDisabled());
  await pr.page.locator("[data-testid=mp-shortage-reason]").fill("Ingreso de esencia en camino (remito 123)");
  await pr.page.locator("[data-testid=mp-shortage-authorize]").click();
  check("Autorizado: ESENCIA en negativo (−2) y AGUA −5, una sola vez", await waitDb(async () => (await lotKg(POCO, "P1")) === -2 && (await ledgerKg(POCO)) === -2 && (await lotKg(AG, "A1")) === 95));
  const aud = await q("select metadata, actor from order_audit_events where order_id = $1 and event_type = 'OE_MP_CONSUMO'", [idC]);
  check("Autorización auditada (quién, motivo)", aud.length === 1 && aud[0].actor === E2E_USERS.produccion.email && aud[0].metadata.stockNegativoAutorizado?.motivo === "Ingreso de esencia en camino (remito 123)");

  // ===== Regularización: completar el CÓDIGO MP faltante y descontar una sola vez =====
  const idF = await createOe(pr.page, "L-SB-F", 100, [{ materiaPrima: "AGUA E2E SB", codigo: AG, codigoMp: AG, formulaPct: 50 }, { materiaPrima: "OTRA E2E SB", codigo: "", codigoMp: "", formulaPct: 50 }]);
  const elF = await openAs(E2E_USERS.elaboracion);
  await elabSave(elF.page, idF, (ms) => [{ ...ms[0], kgReal: 10, lote: "A1" }, { ...ms[1], kgReal: 2, lote: "A1" }]);
  const dF = await elF.page.request.post(`/api/v1/orders/${idF}/deliver`, { data: { confirm: true } });
  check("Entrega con una fila sin CÓDIGO MP: OK (200) y sin descuento", dF.ok() && (await oeMovs(idF)).length === 0 && (await lotKg(AG, "A1")) === 95, String(dF.status()));
  const s1 = await elF.page.request.post(`/api/v1/orders/${idF}/mp-consumption`, { data: {} });
  check("Regularizar sin completar: informa lo que falta (400) y no cambia nada", s1.status() === 400 && (await oeMovs(idF)).length === 0);
  const s2 = await elF.page.request.post(`/api/v1/orders/${idF}/mp-consumption`, { data: { rows: [{ rowId: "m2", codigoMp: AG }] } });
  check("Completando el código: se descuenta (AGUA 95 → 83)", s2.ok() && (await lotKg(AG, "A1")) === 83 && (await integrity()).ok, `${s2.status()} ${await lotKg(AG, "A1")}`);
  const s3 = await elF.page.request.post(`/api/v1/orders/${idF}/mp-consumption`, { data: {} });
  check("Reintento: rechazado y NO duplica el descuento", s3.status() === 400 && (await lotKg(AG, "A1")) === 83 && (await oeMovs(idF)).length === 1);
  check("Auditoría de la regularización", (await auditCount(idF, "OE_MP_CONSUMO")) === 1);
  await elF.ctx.close();
  check("Integridad final: lotes = libro mayor", (await integrity()).ok, JSON.stringify((await integrity()).out));
  await pr.ctx.close();
  await mp.ctx.close();
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
