// E2E (Chromium real, base DESCARTABLE): CÓDIGO MP + descuento de stock por KG REAL UTILIZADO al entregar una OE.
// - Stock MP como en Production: Ingresos MP acumula los lotes de un código en UN registro (AGUA: A1 + A2); otro código
//   con filas de lote separadas (GLICERINA: G1 por ingreso y G2 creada por MP con ajuste auditado).
// - El elaborador carga kg reales distintos de los teóricos (24,8 en vez de 25; 151,2 en vez de 150) con coma, en el
//   celular (viewport de teléfono), con Enter entre filas y autoguardado. Se descuentan SOLO los kg reales.
// - Sugerencia de CÓDIGO MP inequívoca; una MP en varias fases y una MP desde dos lotes.
// - Faltan datos → se informa la fila exacta y no se descuenta nada.
// - Stock insuficiente → nada se entrega ni se descuenta; Producción autoriza con motivo (auditado).
// - Reintentos y confirmaciones duplicadas/simultáneas no descuentan dos veces.
// - OE entregada devuelta para corrección: se revierte; al re-entregar se descuenta lo corregido; historial intacto.
// - Integridad: suma de lotes = saldo por código en todo momento.
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
const OUT = process.env.OUT ?? "/tmp/oe-consumo-negativo";
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
const AGUA = "E2E-CN-AGUA";
const GLI = "E2E-CN-GLI";
const POCO = "E2E-CN-POCO";
const CODES = [AGUA, GLI, POCO];
const PRODUCT = "CREMA CONSUMO NEGATIVO E2E";

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
    [AGUA, "AGUA E2E CN", "A1", 100],
    [GLI, "GLICERINA E2E CN", "G1", 200],
    [POCO, "ESENCIA E2E CN", "P1", 3],
  ]) {
    const r = await page.request.post("/api/v1/inventory", {
      data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-CN-${lote}`, codigo, descripcion, lote, proveedor: "PROV CN", bultos: 1, cantidad: kg } },
    });
    if (!r.ok()) throw new Error(`ingreso ${codigo}/${lote}: ${r.status()} ${await r.text()}`);
  }
}

/** Producción arma la OE con su fórmula (sin consumos: eso lo carga Elaboración). */
async function createOe(page, lot, quantityKg, materials) {
  const res = await page.request.post("/api/v1/orders", { data: { type: "OE", fromScratch: true, product: PRODUCT, code: "PT-CN", client: "CLIENTE CN", lot, assignedSector: "ELABORACION" } });
  if (!res.ok()) throw new Error(`crear OE: ${res.status()} ${await res.text()}`);
  const o = (await res.json()).order;
  const fd = o.formData;
  fd.header = { ...fd.header, productName: PRODUCT, code: "PT-CN", date: today, quantityKg, lot, client: "CLIENTE CN" };
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

const fmt = (n) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(n);
try {
  await cleanup();
  const mp = await openAs(E2E_USERS.materiaPrima);
  await seedStock(mp.page);
  const pr = await openAs(E2E_USERS.produccion);
  const idC = await createOe(pr.page, "L-CN-C", 100, [
    { materiaPrima: "AGUA E2E CN", codigo: AGUA, codigoMp: AGUA, formulaPct: 90 },
    { materiaPrima: "ESENCIA E2E CN", codigo: POCO, codigoMp: POCO, formulaPct: 5 },
    { materiaPrima: "GLICERINA E2E CN", codigo: GLI, codigoMp: GLI, formulaPct: 5 },
  ]);
  const numC = (await oe(idC)).order_number;
  const elApi = await openAs(E2E_USERS.elaboracion);
  // Elaboración informa los kg REALES: AGUA 5, ESENCIA 5 (hay 3 → queda en -2), GLICERINA 8 (sin lote → por código).
  await elabSave(elApi.page, idC, (ms) => [{ ...ms[0], kgReal: 5, lote: "A1" }, { ...ms[1], kgReal: 5, lote: "P1" }, { ...ms[2], kgReal: 8, lote: "" }]);
  const mov0 = (await allMovs()).length;
  check("Cargar los kg reales (autoguardado) NO descuenta todavía", (await ledgerKg(POCO)) === 3 && (await oeMovs(idC)).length === 0);

  // ===== Guardar avance: el consumo se descuenta aunque no alcance el stock =====
  const el = await openAs(E2E_USERS.elaboracion);
  await openOe(el.page, numC);
  await el.page.getByRole("button", { name: /Guardar avance/ }).first().click();
  check("Guardar avance con stock insuficiente: descuenta IGUAL (ESENCIA 3 − 5 = −2 en el lote y en el código)", await waitDb(async () => (await lotKg(POCO, "P1")) === -2 && (await ledgerKg(POCO)) === -2));
  check("…AGUA 100 − 5 = 95 y GLICERINA 200 − 8 = 192 (sin lote: por código)", (await ledgerKg(AGUA)) === 95 && (await ledgerKg(GLI)) === 192);
  await el.page.locator("[data-testid=oe-mp-consumo-row][data-estado=previsto], [data-testid=oe-mp-consumo-row][data-estado=pendiente]").first().waitFor({ timeout: 5_000 }).catch(() => undefined); // antes de guardar: solo previsto/pendiente
  await el.page.locator("[data-testid=oe-mp-consumo-row][data-estado=confirmado]").nth(2).waitFor({ timeout: 30_000 });
  const rows = await el.page.locator("[data-testid=oe-mp-consumo-row]").allInnerTexts();
  const rowOf = (code) => rows.find((r) => r.includes(code)) ?? "";
  check("Tabla «Consumo de Materias Primas»: ESENCIA stock anterior 3 kg, consumo −5 kg, restante −2 kg", /3 kg/.test(rowOf(POCO)) && /-5 kg/.test(rowOf(POCO)) && /-2 kg/.test(rowOf(POCO)) && /Descontado/.test(rowOf(POCO)), rowOf(POCO).replace(/\s+/g, " "));
  check("…AGUA: 100 kg → −5 kg → 95 kg; GLICERINA: 200 kg → −8 kg → 192 kg", /100 kg.*-5 kg.*95 kg/s.test(rowOf(AGUA)) && /200 kg.*-8 kg.*192 kg/s.test(rowOf(GLI)), `${rowOf(AGUA).replace(/\s+/g, " ")} | ${rowOf(GLI).replace(/\s+/g, " ")}`);
  check("Saldo negativo identificado visualmente (en rojo) y con advertencia; solo el de ESENCIA", (await el.page.locator("[data-testid=oe-mp-consumo-saldo-negativo]").count()) === 1 && /Stock negativo: E2E-CN-POCO/.test(await el.page.locator("[data-testid=oe-mp-consumo-negativo]").innerText()));
  check("Aviso al guardar: el stock quedó negativo y el consumo se descontó igual (no «queda pendiente»)", /quedó negativo/.test(await el.page.locator("[data-testid=oe-deliver-notice]").innerText()) && !/pendiente de regularizar/.test(await el.page.locator("body").innerText()));
  await el.page.screenshot({ path: `${OUT}/01-consumo-negativo.png`, fullPage: true });
  const ms1 = await oeMovs(idC);
  check("Movimientos con OE, usuario, lote y saldo posterior; coinciden con el saldo", ms1.length === 3 && ms1.every((m) => m.actor_email === E2E_USERS.elaboracion.email && m.kind === "CONSUMO_OE") && Number(ms1.find((m) => m.codigo === POCO).quantity) === -5);
  check("Integridad: lotes = libro mayor", (await integrity()).ok, JSON.stringify((await integrity()).out));

  // ===== Idempotencia: guardar de nuevo / recargar =====
  await el.page.getByRole("button", { name: /Guardar avance/ }).first().click();
  await el.page.waitForTimeout(1500);
  check("Guardar de nuevo sin cambios: NO descuenta otra vez", (await oeMovs(idC)).length === 3 && (await ledgerKg(POCO)) === -2);
  await el.page.reload();
  await openOe(el.page, numC);
  await el.page.locator("[data-testid=oe-mp-consumo]").waitFor({ timeout: 30_000 });
  check("Actualizar la página: sin movimientos nuevos y la tabla muestra lo mismo", (await oeMovs(idC)).length === 3 && /-2 kg/.test(await el.page.locator("[data-testid=oe-mp-consumo]").innerText()));

  // ===== Corregir un consumo ya registrado: solo la diferencia =====
  const cur = await oe(idC);
  const fd = cur.form_data;
  fd.materials = fd.materials.map((m, i) => (i === 1 ? { ...m, kgReal: 4 } : m));
  const fix = await elApi.page.request.patch(`/api/v1/orders/${idC}`, { data: { expectedVersion: cur.version, formData: fd, registerMpConsumption: true } });
  check("Corregir 5 → 4 kg y guardar avance: registra solo la diferencia (+1) trazable", fix.ok() && (await waitDb(async () => (await ledgerKg(POCO)) === -1)) && (await oeMovs(idC)).length === 4, String(fix.status()));
  await el.page.reload();
  await openOe(el.page, numC);
  await el.page.locator("[data-testid=oe-mp-consumo]").waitFor({ timeout: 30_000 });
  check("La tabla pasa a consumo −4 kg y restante −1 kg", /-4 kg/.test(await el.page.locator("[data-testid=oe-mp-consumo-row]", { hasText: POCO }).innerText()) && /-1 kg/.test(await el.page.locator("[data-testid=oe-mp-consumo-row]", { hasText: POCO }).innerText()));

  // ===== Entregar: reconoce lo ya descontado y no duplica =====
  await el.page.getByRole("button", { name: /^ENTREGAR OE$/ }).first().click();
  check("ENTREGAR OE: COMPLETA sin pendiente de MP y sin descontar de nuevo", (await waitDb(async () => (await oe(idC)).status === "COMPLETA")) && (await oeMovs(idC)).length === 4 && (await ledgerKg(POCO)) === -1 && (await el.page.locator("[data-testid=oe-mp-pendiente]").count()) === 0);
  await el.page.screenshot({ path: `${OUT}/02-entregada.png`, fullPage: true });

  // ===== Ingreso posterior de stock: el saldo sube; la OE no se descuenta de nuevo ni cambia su historia =====
  const ing = await mp.page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-02", remitoNro: "E2E-CN-P2", codigo: POCO, descripcion: "ESENCIA E2E CN", lote: "P2", proveedor: "PROV CN", bultos: 1, cantidad: 10 } } });
  check("Ingreso posterior de 10 kg de ESENCIA", ing.ok() && (await waitDb(async () => (await ledgerKg(POCO)) === 9)), String(ing.status()));
  await el.page.goto("/");
  await nav(el.page, "Órdenes de Elaboración");
  await el.page.locator("[data-testid=orders-tab-completas]").click(); // ya entregada: se consulta en «Completas»
  await el.page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(numC);
  await el.page.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
  await el.page.waitForTimeout(800);
  await el.page.getByRole("button", { name: /^Abrir$/ }).first().dispatchEvent("click");
  await el.page.locator("[data-testid=oe-mp-consumo]").waitFor({ timeout: 60_000 });
  const rowP = await el.page.locator("[data-testid=oe-mp-consumo-row]", { hasText: POCO }).innerText();
  check("La OE conserva SU consumo (−4 kg, restante de ese momento −1 kg) y no se re-descuenta", /-4 kg/.test(rowP) && /-1 kg/.test(rowP) && (await oeMovs(idC)).length === 4 && (await ledgerKg(POCO)) === 9);
  const hist = await (await mp.page.request.get(`/api/v1/mp-stock/ledger?codigo=${POCO}`)).json();
  const oeMovsHist = (hist.history ?? []).filter((m) => m.refType === "oe" && m.refId === idC);
  check("Los movimientos de la OE figuran en el historial de inventario MP (con OE, lote, usuario y saldo)", oeMovsHist.length === 2 && oeMovsHist.every((m) => m.actorEmail && m.balanceAfter != null && m.reason.includes(numC)), JSON.stringify(oeMovsHist.map((m) => [m.kind, m.quantity, m.balanceAfter])));

  // ===== Anular devuelve lo descontado, una sola vez =====
  const an = await pr.page.request.post(`/api/v1/orders/${idC}/annul`, { data: { reason: "Producción suspendida" } });
  await pr.page.request.post(`/api/v1/orders/${idC}/annul`, { data: { reason: "otra vez" } });
  check("Anular la OE revierte el consumo (ESENCIA 9 + 4 = 13; AGUA 100; GLICERINA 200) una sola vez", an.ok() && (await waitDb(async () => (await ledgerKg(POCO)) === 13)) && (await ledgerKg(AGUA)) === 100 && (await ledgerKg(GLI)) === 200, String(an.status()));
  check("Integridad final: lotes = libro mayor", (await integrity()).ok, JSON.stringify((await integrity()).out));
  await el.ctx.close();
  await elApi.ctx.close();
  void mov0;
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
