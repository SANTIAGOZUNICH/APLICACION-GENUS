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
const OUT = process.env.OUT ?? "/tmp/oe-consumo-real";
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
const AGUA = "E2E-CR-AGUA";
const GLI = "E2E-CR-GLI";
const POCO = "E2E-CR-POCO";
const CODES = [AGUA, GLI, POCO];
const PRODUCT = "CREMA CONSUMO REAL E2E";

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
      data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-CR-${lote}`, codigo, descripcion, lote, proveedor: "PROV CR", bultos: 1, cantidad: kg } },
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

try {
  await cleanup();
  const mp = await openAs(E2E_USERS.materiaPrima);
  await seedStock(mp.page);
  const pr = await openAs(E2E_USERS.produccion);
  const elApi = await openAs(E2E_USERS.elaboracion);
  check(
    "Stock inicial como en Production: AGUA un registro (A1+A2 = 150), GLICERINA G1 200 + G2 60, ESENCIA 3; lotes = libro mayor",
    (await lotKg(AGUA, "A1")) === 150 && (await lotKg(AGUA, "A2")) === undefined && (await lotKg(GLI, "G1")) === 200 && (await lotKg(GLI, "G2")) === 60 && (await ledgerKg(GLI)) === 260 && (await ledgerKg(POCO)) === 3 && (await integrity()).ok,
    JSON.stringify((await integrity()).out)
  );

  // ===== OE A: 1000 kg. AGUA en dos fases (2,5 % y 0,5 %), GLICERINA 15 % (código de fórmula distinto al de Stock MP) =====
  const idA = await createOe(pr.page, "L-CR-A", 1000, [
    { materiaPrima: "AGUA E2E CR", codigo: AGUA, formulaPct: 2.5 },
    { materiaPrima: "GLICERINA E2E CR", codigo: "F-GLI-999", formulaPct: 15 },
    { materiaPrima: "AGUA E2E CR", codigo: AGUA, formulaPct: 0.5 },
  ]);
  const numA = (await oe(idA)).order_number;
  const movs0 = (await allMovs()).length;
  check("Crear la OE y cargar la fórmula no descuenta stock", (await allMovs()).length === movs0 && (await ledgerKg(AGUA)) === 150);

  // ===== ELABORACIÓN en el celular =====
  const el = await openAs(E2E_USERS.elaboracion, { width: 390, height: 844 });
  await openOe(el.page, numA);
  const p = el.page;
  const kgReal = p.locator("[data-testid=oe-cell-kg-real]");
  const kgTeo = await p.locator("[data-testid=oe-cell-kg]").allInnerTexts();
  check("KG A PESAR teórico visible (25 · 150 · 5) y KG REAL vacío (no se copia el teórico)", JSON.stringify(kgTeo) === JSON.stringify(["25", "150", "5"]) && (await kgReal.evaluateAll((xs) => xs.map((x) => x.value))).every((v) => v === ""), JSON.stringify(kgTeo));
  // El catálogo de Stock MP carga de forma asíncrona: se espera a que aparezcan las sugerencias antes de leerlas.
  await p.locator("[data-testid=oe-codigo-mp-sugerido]").first().waitFor({ timeout: 60_000 }).catch(() => {});
  const sugeridos = await p.locator("[data-testid=oe-codigo-mp-sugerido]").allInnerTexts();
  check("CÓDIGO MP: sugiere solo coincidencias inequívocas (por código y por nombre)", JSON.stringify(sugeridos) === JSON.stringify([`Usar ${AGUA}`, `Usar ${GLI}`, `Usar ${AGUA}`]), JSON.stringify(sugeridos));
  for (let i = 0; i < 3; i++) await p.locator("[data-testid=oe-codigo-mp-sugerido]").first().click();
  check("CÓDIGO MP elegido y guardado (la sugerencia no se aplica sola)", await waitDb(async () => JSON.stringify((await oe(idA)).form_data.materials.map((m) => m.codigoMp)) === JSON.stringify([AGUA, GLI, AGUA])));
  await p.screenshot({ path: `${OUT}/01-celular-codigo-mp.png`, fullPage: true });

  // KG REAL con coma; Enter baja a la fila siguiente.
  await kgReal.nth(0).click();
  await p.keyboard.type("20");
  await p.keyboard.press("Enter");
  const focusedIdx = await p.evaluate(() => [...document.querySelectorAll("[data-testid=oe-cell-kg-real]")].indexOf(document.activeElement));
  check("Enter en KG REAL baja a la fila siguiente (como Excel)", focusedIdx === 1, String(focusedIdx));
  await p.keyboard.type("151,2");
  await p.keyboard.press("Enter");
  await p.keyboard.type("5");
  await p.keyboard.press("Enter");
  // AGUA fase 1 se usó de dos lotes: «+ lote» y 4,8 kg del A2.
  await p.locator("[data-testid=oe-add-lote]").first().click();
  await p.locator("[data-testid=oe-row-lote-adicional]").waitFor();
  await p.locator("[data-testid=oe-row-lote-adicional] [data-testid=oe-cell-kg-real]").fill("4,8");
  const lotes = p.locator("[data-testid=oe-cell-lote]");
  await lotes.nth(0).fill("A1");
  check(
    "Autoguardado: kg reales (20 + 4,8 · 151,2 · 5) y lote adicional heredan MP y CÓDIGO MP",
    await waitDb(async () => {
      const ms = (await oe(idA)).form_data.materials;
      return JSON.stringify(ms.map((m) => [m.kgReal, m.codigoMp, Boolean(m.parentRowId)])) === JSON.stringify([[20, AGUA, false], [4.8, AGUA, true], [151.2, GLI, false], [5, AGUA, false]]);
    }),
    JSON.stringify((await oe(idA)).form_data.materials.map((m) => [m.kgReal, m.codigoMp, m.parentRowId]))
  );
  const difs = await p.locator("[data-testid=oe-cell-dif]").allInnerTexts();
  check("Dif. visible respecto del teórico (−0,2 y +1,2)", difs[0] === "-0,2" && difs[2] === "+1,2", JSON.stringify(difs));
  const pend = await p.locator("[data-testid=oe-consumo-pendientes]").innerText();
  check("Antes de entregar indica exactamente qué falta (lotes de las filas 2, 3 y 4)", /Fila 2 \(lote adicional\) — AGUA E2E CR: falta LOTE MP/.test(pend) && /Fila 3 — GLICERINA E2E CR: falta LOTE MP/.test(pend) && /Fila 4 — AGUA E2E CR: falta LOTE MP/.test(pend), pend);
  await p.screenshot({ path: `${OUT}/02-celular-kg-real-pendientes.png`, fullPage: true });

  // GLICERINA tiene dos filas en Stock MP: un lote que no es ninguna de las dos se marca (no se elige una al azar).
  await lotes.nth(2).fill("G9");
  check(
    "Lote inexistente en un código con varias filas: se marca y se listan los lotes válidos",
    await waitDb(async () => /el lote «G9» no está en Stock MP para el código E2E-CR-GLI \(lotes: G[12], G[12]\)/.test(await p.locator("[data-testid=oe-consumo-pendientes]").innerText()), 10_000),
    await p.locator("[data-testid=oe-consumo-pendientes]").innerText().catch(() => "(sin panel)")
  );
  // Entregar con un lote faltante: se informa la fila, no se descuenta nada.
  await lotes.nth(1).fill("A2");
  await lotes.nth(2).fill("G1");
  await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /^Entregar$/ }).first().click();
  await p.locator("[data-testid=deliver-confirm]").click();
  await p.locator("[data-testid=mp-consumo-issues]").waitFor({ timeout: 30_000 });
  const issuesTxt = await p.locator("[data-testid=mp-consumo-issues]").innerText();
  check("Entregar con un dato faltante: informa la fila (4, falta LOTE MP) y no entrega", /Fila 4 — AGUA E2E CR: falta LOTE MP/.test(issuesTxt) && !/COMPLETA/.test((await oe(idA)).status), issuesTxt);
  check("…y no se descontó nada", (await allMovs()).length === movs0 && (await lotKg(AGUA, "A1")) === 150);
  await p.screenshot({ path: `${OUT}/03-celular-falta-lote.png`, fullPage: true });
  await p.keyboard.press("Escape");
  await lotes.nth(3).fill("A1");
  await p.waitForTimeout(2500);

  // Entregar: doble clic no entrega dos veces.
  let delivers = 0;
  p.on("request", (r) => { if (r.url().includes(`/orders/${idA}/deliver`)) delivers += 1; });
  await p.getByRole("button", { name: /^Entregar$/ }).first().click();
  await p.locator("[data-testid=deliver-confirm]").dblclick();
  check("OE entregada (COMPLETA)", await waitDb(async () => (await oe(idA)).status === "COMPLETA"), (await oe(idA)).status);
  check("Doble clic en «Entregar»: un solo envío", delivers === 1, String(delivers));
  check(
    "Se descontaron SOLO los kg reales: AGUA (registro único) 150−29,8 = 120,2; GLICERINA fila G1 200−151,2 = 48,8 y G2 intacta",
    (await lotKg(AGUA, "A1")) === 120.2 && (await lotKg(GLI, "G1")) === 48.8 && (await lotKg(GLI, "G2")) === 60,
    JSON.stringify([await lotKg(AGUA, "A1"), await lotKg(GLI, "G1"), await lotKg(GLI, "G2")])
  );
  check("Libro mayor por código: AGUA 120,2; GLI 260−151,2 = 108,8", (await ledgerKg(AGUA)) === 120.2 && (await ledgerKg(GLI)) === 108.8);
  const mA = await oeMovs(idA);
  check(
    "Un movimiento por (código, lote real) — la MP en dos fases no se duplica; los lotes A1 y A2 quedan registrados",
    JSON.stringify(mA.map((m) => [m.codigo, m.lote, m.kind, m.quantity]).sort()) === JSON.stringify([[AGUA, "A1", "CONSUMO_OE", -25], [AGUA, "A2", "CONSUMO_OE", -4.8], [GLI, "G1", "CONSUMO_OE", -151.2]].sort()),
    JSON.stringify(mA.map((m) => [m.codigo, m.lote, m.quantity]))
  );
  check("Cada movimiento: OE de origen, usuario, fecha/hora y clave única", mA.every((m) => m.actor_email === E2E_USERS.elaboracion.email && m.created_at && m.idempotency_key.startsWith(`oe-consumo:${idA}:`)) && new Set(mA.map((m) => m.idempotency_key)).size === mA.length);
  const auditA = await q("select metadata from order_audit_events where order_id = $1 and event_type = 'OE_MP_CONSUMO'", [idA]);
  check("Auditoría OE_MP_CONSUMO con número de OE, kg reales y lotes", auditA.length === 1 && auditA[0].metadata.orderNumber === numA && auditA[0].metadata.consumos.some((c) => c.codigo === GLI && c.kgReal === 151.2));
  check("Integridad tras la entrega: lotes = libro mayor", (await integrity()).ok, JSON.stringify((await integrity()).out));
  await p.screenshot({ path: `${OUT}/04-celular-entregada.png`, fullPage: true });

  // Reintento / confirmación duplicada por API: rechazado, sin segundo descuento.
  const again = await elApi.page.request.post(`/api/v1/orders/${idA}/deliver`, { data: { confirm: true } });
  check("Reintento de entrega: rechazado (400) y sin movimientos nuevos", again.status() === 400 && (await oeMovs(idA)).length === 3, String(again.status()));

  // ===== OE entregada devuelta para corrección: reverso + re-entrega con kg corregidos =====
  const histBefore = JSON.stringify(mA);
  const ret = await pr.page.request.post(`/api/v1/orders/${idA}/return`, { data: { reason: "Corregir glicerina: fueron 150 kg" } });
  check("Producción devuelve la OE entregada para corrección", ret.ok(), String(ret.status()));
  check("…se revierte TODO lo descontado (lotes y libro mayor como antes)", (await lotKg(AGUA, "A1")) === 150 && (await lotKg(GLI, "G1")) === 200 && (await lotKg(GLI, "G2")) === 60 && (await ledgerKg(AGUA)) === 150 && (await ledgerKg(GLI)) === 260);
  await elabSave(elApi.page, idA, (ms) => ms.map((m) => (m.codigoMp === GLI ? { ...m, kgReal: 150 } : m)));
  const re = await elApi.page.request.post(`/api/v1/orders/${idA}/deliver`, { data: { confirm: true } });
  check("Re-entrega con kg corregidos: descuenta 150 de GLI (no 151,2)", re.ok() && (await lotKg(GLI, "G1")) === 50 && (await ledgerKg(GLI)) === 110 && (await lotKg(AGUA, "A1")) === 120.2, String(re.status()));
  const mA2 = await oeMovs(idA);
  check("Historial intacto: los movimientos originales siguen iguales; se agregaron reversos y consumos nuevos", JSON.stringify(mA2.slice(0, 3)) === histBefore && mA2.filter((m) => m.kind === "REVERSO").length === 3 && mA2.length === 9, String(mA2.length));
  check("Integridad tras corrección: lotes = libro mayor", (await integrity()).ok, JSON.stringify((await integrity()).out));

  // ===== Confirmaciones simultáneas (OE B): una sola entrega descuenta =====
  const idB = await createOe(pr.page, "L-CR-B", 100, [{ materiaPrima: "AGUA E2E CR", codigo: AGUA, codigoMp: AGUA, formulaPct: 100 }]);
  await elabSave(elApi.page, idB, (ms) => [{ ...ms[0], kgReal: 10, lote: "A2" }]);
  const [r1, r2] = await Promise.all([
    elApi.page.request.post(`/api/v1/orders/${idB}/deliver`, { data: { confirm: true } }),
    el.page.request.post(`/api/v1/orders/${idB}/deliver`, { data: { confirm: true } }),
  ]);
  check("Dos confirmaciones simultáneas: una entrega, la otra rechazada", [r1.status(), r2.status()].filter((s) => s === 200).length === 1, `${r1.status()} ${r2.status()}`);
  check("…y se descontó una sola vez (AGUA 120,2 → 110,2)", (await lotKg(AGUA, "A1")) === 110.2 && (await oeMovs(idB)).length === 1, String(await lotKg(AGUA, "A1")));

  // ===== Stock insuficiente (OE C): bloquea; Producción autoriza con motivo =====
  const idC = await createOe(pr.page, "L-CR-C", 100, [
    { materiaPrima: "AGUA E2E CR", codigo: AGUA, codigoMp: AGUA, formulaPct: 95 },
    { materiaPrima: "ESENCIA E2E CR", codigo: POCO, codigoMp: POCO, formulaPct: 5 },
  ]);
  const numC = (await oe(idC)).order_number;
  await elabSave(elApi.page, idC, (ms) => [{ ...ms[0], kgReal: 5, lote: "A1" }, { ...ms[1], kgReal: 5, lote: "P1" }]);
  const elC = await openAs(E2E_USERS.elaboracion);
  await openOe(elC.page, numC);
  await elC.page.getByRole("button", { name: /^Entregar$/ }).first().click();
  await elC.page.locator("[data-testid=deliver-confirm]").click();
  await elC.page.locator("[data-testid=mp-stock-shortages]").waitFor({ timeout: 30_000 });
  const shortTxt = await elC.page.locator("[data-testid=mp-stock-shortages]").innerText();
  check("Stock insuficiente: muestra el faltante (ESENCIA lote P1: hay 3, faltan 2)", /E2E-CR-POCO · lote P1 — hay 3 kg, se necesitan 5 kg \(faltan 2 kg\)/.test(shortTxt), shortTxt);
  check("Elaboración no puede autorizar (sin botón)", (await elC.page.locator("[data-testid=mp-shortage-authorize]").count()) === 0);
  check("Nada parcial: ni la MP con stock se descontó, la OE sigue sin entregar", (await lotKg(AGUA, "A1")) === 110.2 && (await lotKg(POCO, "P1")) === 3 && !/COMPLETA/.test((await oe(idC)).status));
  await elC.page.screenshot({ path: `${OUT}/05-faltante-elaboracion.png` });
  await elC.ctx.close();

  const idD = await createOe(pr.page, "L-CR-D", 100, [{ materiaPrima: "AGUA E2E CR", codigo: AGUA, codigoMp: AGUA, formulaPct: 100 }]);
  await elabSave(elApi.page, idD, (ms) => [{ ...ms[0], kgReal: 1, lote: "A1" }]);
  const prDenied = await pr.page.request.post(`/api/v1/orders/${idD}/deliver`, { data: { confirm: true, allowNegativeMpStock: true, negativeMpStockReason: "x" } });
  check("Sin faltante, Producción no entrega la OE (403: la entrega es de Elaboración) y no se descuenta", prDenied.status() === 403 && (await oeMovs(idD)).length === 0 && (await oe(idD)).status !== "COMPLETA", String(prDenied.status()));
  await openOe(pr.page, numC);
  await pr.page.locator("[data-testid=mp-authorize-open]").click();
  await pr.page.locator("[data-testid=mp-shortage-reason]").waitFor({ timeout: 30_000 });
  check("Producción: «Autorizar y entregar» deshabilitado sin motivo", await pr.page.locator("[data-testid=mp-shortage-authorize]").isDisabled());
  await pr.page.locator("[data-testid=mp-shortage-reason]").fill("Ingreso de esencia en camino (remito 123)");
  await pr.page.screenshot({ path: `${OUT}/06-faltante-produccion-autoriza.png` });
  await pr.page.locator("[data-testid=mp-shortage-authorize]").click();
  check("Autorizado: OE entregada y stock de ESENCIA en negativo (−2), AGUA descontada", await waitDb(async () => (await oe(idC)).status === "COMPLETA" && (await lotKg(POCO, "P1")) === -2 && (await ledgerKg(POCO)) === -2 && (await lotKg(AGUA, "A1")) === 105.2));
  const auditC = await q("select metadata, actor from order_audit_events where order_id = $1 and event_type = 'OE_MP_CONSUMO'", [idC]);
  check("Autorización auditada: quién y motivo", auditC.length === 1 && auditC[0].actor === E2E_USERS.produccion.email && auditC[0].metadata.stockNegativoAutorizado?.motivo === "Ingreso de esencia en camino (remito 123)");

  // ===== Anular devuelve lo descontado (una sola vez) =====
  const an = await pr.page.request.post(`/api/v1/orders/${idC}/annul`, { data: { reason: "Producción suspendida" } });
  await pr.page.request.post(`/api/v1/orders/${idC}/annul`, { data: { reason: "otra vez" } });
  check("Anular la OE devuelve el stock una sola vez (ESENCIA 3, AGUA 110,2)", an.ok() && (await lotKg(POCO, "P1")) === 3 && (await ledgerKg(POCO)) === 3 && (await lotKg(AGUA, "A1")) === 110.2);
  check("Integridad final: lotes = libro mayor en todos los códigos", (await integrity()).ok, JSON.stringify((await integrity()).out));

  await el.ctx.close();
  await elApi.ctx.close();
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
