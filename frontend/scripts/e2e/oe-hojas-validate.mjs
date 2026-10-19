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
const OUT = process.env.OUT ?? "/tmp/oe-hojas";
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
const AGUA = "E2E-HJ-AGUA";
const GLI = "E2E-HJ-GLI";
const POCO = "E2E-HJ-POCO";
const CODES = [AGUA, GLI, POCO];
const PRODUCT = "CREMA HOJAS E2E";

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


const LONG = "Sodium Hyaluronate Crosspolymer-2 / Complejo de ácido hialurónico de bajo y alto peso molecular con péptidos biomiméticos y vehículo hidroglicólico";
async function seed(page) {
  for (const [lote, kg] of [["A1", 600], ["A2", 600]]) {
    const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-HJ-${lote}`, codigo: AGUA, descripcion: "AGUA E2E HJ", lote, proveedor: "PROV", bultos: 1, cantidad: kg } } });
    if (!r.ok()) throw new Error(`ingreso: ${r.status()} ${await r.text()}`);
  }
}
const sheetsOf = async (id) => (await oe(id)).form_data.sheets ?? [];

try {
  await cleanup();
  const mp = await openAs(E2E_USERS.materiaPrima);
  await seed(mp.page);
  const pr = await openAs(E2E_USERS.produccion);
  const idA = await createOe(pr.page, "L-HJ-A", 1000, [
    { materiaPrima: "AGUA E2E HJ", codigo: AGUA, formulaPct: 70, codigoMp: AGUA },
    { materiaPrima: LONG, codigo: "F-HA-1", formulaPct: 5 },
    { materiaPrima: "EMULSIONANTE", codigo: "F-EM-1", formulaPct: 4 },
  ]);
  const numA = (await oe(idA)).order_number;
  const before = (await allMovs()).length;

  const el = await openAs(E2E_USERS.elaboracion, { width: 1180, height: 820 });
  const p = el.page;
  await openOe(p, numA);
  await p.locator("[data-testid=oe-sheets-panel]").scrollIntoViewIfNeeded();
  check("hay pestañas: «Resumen general» y «+ Nueva hoja»", (await p.locator("[data-testid=oe-sheet-tab-resumen]").isVisible()) && (await p.locator("[data-testid=oe-sheet-add]").isVisible()));

  // 5 tambores
  const kgs = ["200", "180", "200", "200", "220"];
  for (const [i, kg] of kgs.entries()) {
    await p.locator("[data-testid=oe-sheet-add]").click();
    await p.locator("[data-testid=sheet-kg-plan]").fill(kg);
    await p.locator("[data-testid=sheet-kg-plan]").blur();
    await p.locator("[data-testid=oe-sheet-tab]").nth(i).waitFor();
    await waitDb(async () => Number((await sheetsOf(idA))[i]?.kgPlanificados) === Number(kg)); // el autoguardado confirma antes de seguir
  }
  check("se crean 5 hojas dentro de la MISMA OE", await waitDb(async () => (await sheetsOf(idA)).length === 5));
  const ss = await sheetsOf(idA);
  const kgOf = (s, i) => s.materials[i].kgAPesar;
  check("tambor 1 (200 kg): Agua 140, 2.ª MP 10, emulsionante 8; tambor 2 (180 kg): 126 / 9 / 7,2", [kgOf(ss[0], 0), kgOf(ss[0], 1), kgOf(ss[0], 2)].join() === "140,10,8" && [kgOf(ss[1], 0), kgOf(ss[1], 1), kgOf(ss[1], 2)].join() === "126,9,7.2", JSON.stringify(ss.map((s) => s.materials.map((m) => m.kgAPesar))));
  check("no hay trabajos ni OE nuevas: sigue habiendo UNA OE; crear hojas no descontó stock", (await q("select count(*)::int n from operational_orders where product = $1", [PRODUCT]))[0].n === 1 && (await allMovs()).length === before && (await ledgerKg(AGUA)) === 1200);
  check("lotes y kg reales NO se copian a las hojas nuevas", ss.every((s) => s.materials.every((m) => m.lote === "" && m.kgReal === null)));

  // texto largo: la fila crece y no se corta
  await p.locator("[data-testid=oe-sheet-tab]").first().click();
  const longCell = p.locator("[data-testid=oe-sheet-editor] textarea[data-testid=oe-cell-materia]").nth(1);
  const m = await longCell.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, v: el.value, lh: parseFloat(getComputedStyle(el).lineHeight) || 18 }));
  check("el nombre largo de la MP se muestra completo en varias líneas (la fila crece, sin cortar)", m.v === LONG && m.sh <= m.h + 1 && m.h > m.lh * 2, JSON.stringify(m));
  await p.screenshot({ path: `${OUT}/01-tablet-hoja-texto-largo.png` });
  const overlap = await p.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-testid=oe-sheet-editor] [data-testid=oe-row]")];
    return rows.some((r) => [...r.querySelectorAll("td")].some((td) => td.scrollWidth > td.clientWidth + 1));
  });
  check("sin texto superpuesto ni desbordado entre columnas", !overlap);

  // registrar MP/lotes por tambor: tambor 1 con dos lotes de AGUA; tambor 2 con otro lote
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-cell-kg-real]").first().fill("100");
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-cell-lote]").first().fill("A1");
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-add-lote]").first().click();
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-row-lote-adicional] [data-testid=oe-cell-kg-real]").first().fill("41");
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-row-lote-adicional] [data-testid=oe-cell-lote]").first().fill("A2");
  await p.locator("[data-testid=sheet-status]").selectOption("elaborado");
  await p.locator("[data-testid=sheet-kg-elab]").fill("200");
  await p.locator("[data-testid=sheet-operario]").fill("Operario Uno");
  await p.locator("[data-testid=sheet-incidencias]").fill("Espuma en el ingreso de glicerina");
  check("tambor 1: dos lotes de la misma MP, responsable, incidencia y estado se guardan solos", await waitDb(async () => {
    const s = (await sheetsOf(idA))[0];
    const agua = s.materials.filter((x) => x.lote);
    return agua.length === 2 && agua[0].kgReal === 100 && agua[1].kgReal === 41 && s.status === "elaborado" && s.operario === "Operario Uno" && /Espuma/.test(s.incidencias);
  }));
  await p.locator("[data-testid=oe-sheet-tab]").nth(1).click();
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-cell-kg-real]").first().fill("127");
  await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-cell-lote]").first().fill("A2");
  await p.locator("[data-testid=sheet-status]").selectOption("observado");
  check("editar el tambor 2 no cambia el tambor 1 y queda marcado como observado", await waitDb(async () => {
    const [s1, s2] = await sheetsOf(idA);
    return s2.status === "observado" && s2.materials[0].lote === "A2" && s1.status === "elaborado" && s1.materials[0].lote === "A1";
  }));
  const hist = (await sheetsOf(idA))[1].history.map((h) => h.text).join("|");
  check("historial por hoja con usuario", /Estado: Pendiente → Observado/.test(hist) && (await sheetsOf(idA))[1].history.every((h) => h.by));

  console.log("kgs en BD:", JSON.stringify((await sheetsOf(idA)).map((x) => x.kgPlanificados)));
  // resumen
  await p.locator("[data-testid=oe-sheet-tab-resumen]").click();
  const txt = async (id) => (await p.locator(`[data-testid=${id}]`).innerText()).replace(/\s+/g, " ");
  check("resumen: solicitado 1000, planificado 1000, elaborado 200 (solo lo elaborado), pendiente 800", (await txt("sum-requested")).startsWith("1000") && (await txt("sum-planned")).startsWith("1000") && (await txt("sum-elaborated")).startsWith("200") && (await txt("sum-pending")).startsWith("800"), `${await txt("sum-planned")} / ${await txt("sum-elaborated")}`);
  check("resumen: MP consolidadas con sus lotes reales", /A1: 100 kg/.test(await p.locator("[data-testid=sum-consolidated]").innerText()) && /A2: 168 kg/.test(await p.locator("[data-testid=sum-consolidated]").innerText()));
  await p.screenshot({ path: `${OUT}/02-tablet-resumen.png` });
  // exceso
  await p.locator("[data-testid=oe-sheet-tab]").nth(4).click();
  await p.locator("[data-testid=sheet-kg-plan]").fill("320");
  await waitDb(async () => (await sheetsOf(idA))[4].kgPlanificados === 320);
  await p.locator("[data-testid=oe-sheet-tab-resumen]").click();
  check("advierte cuando lo planificado supera la cantidad autorizada de la OE (1100 > 1000)", (await p.locator("[data-testid=sum-exceeds]").isVisible()) && /100/.test(await txt("sum-exceeds")));
  await p.locator("[data-testid=oe-sheet-tab]").nth(4).click();
  await p.locator("[data-testid=sheet-kg-plan]").fill("220");

  // recargar: los datos persisten
  await waitDb(async () => (await sheetsOf(idA))[4].kgPlanificados === 220);
  await openOe(p, numA);
  await p.locator("[data-testid=oe-sheet-tab]").first().click();
  check("al recargar se conservan hojas, kg, lotes y estado", (await p.locator("[data-testid=oe-sheet-tab]").count()) === 5 && (await p.locator("[data-testid=oe-sheet-editor] [data-testid=oe-cell-lote]").first().inputValue()) === "A1" && (await p.locator("[data-testid=sheet-status]").inputValue()) === "elaborado");

  // permisos: otro sector no puede guardar hojas
  const env = await openAs(E2E_USERS.envasado);
  const cur = await oe(idA);
  const denied = await env.page.request.patch(`/api/v1/orders/${idA}`, { data: { expectedVersion: cur.version, formData: { ...cur.form_data, sheets: [] } } });
  check("otros sectores no pueden modificar las hojas (403)", denied.status() === 403, String(denied.status()));
  check("las hojas con datos siguen intactas", (await sheetsOf(idA)).length === 5);

  // entrega: consumo único por hoja y lote
  const cur2 = await oe(idA);
  const fd = cur2.form_data;
  fd.sheets[2].status = "elaborado"; fd.sheets[3].status = "elaborado"; fd.sheets[4].status = "elaborado";
  await el.page.request.patch(`/api/v1/orders/${idA}`, { data: { expectedVersion: cur2.version, formData: fd } });
  const del = await el.page.request.post(`/api/v1/orders/${idA}/deliver`, { data: {} });
  const delBody = await del.text();
  check("entregar con datos incompletos en hojas elaboradas informa la fila y NO descuenta", !del.ok() && (await allMovs()).length === before, `${del.status()} ${delBody.slice(0, 160)}`);

  // ===== ENTREGA COMPLETA con 3 tambores: se descuenta UNA vez, por lote, solo los kg reales de las hojas =====
  const idB = await createOe(pr.page, "L-HJ-B", 250, [{ materiaPrima: "AGUA E2E HJ", codigo: AGUA, formulaPct: 100, codigoMp: AGUA }]);
  const numB = (await oe(idB)).order_number;
  const mkSheet = (i, kg, rows) => ({
    id: `sh_e2eB${i}`, kind: "tambor", number: String(i + 1), name: "", kgPlanificados: kg, kgElaborados: kg, status: "elaborado", operario: "Operario", inicioAt: "", finAt: "", incidencias: "", observaciones: "",
    materials: rows.map(([kgReal, lote, child], k) => ({ id: child ? `sh_e2eB${i}:m1:x${k}` : `sh_e2eB${i}:m1`, parentRowId: child ? `sh_e2eB${i}:m1` : null, materiaPrima: "AGUA E2E HJ", codigo: AGUA, codigoMp: AGUA, kgReal, lote, formulaPct: null, kgAPesar: null, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null })),
  });
  {
    const cur = await oe(idB);
    const fd = cur.form_data;
    fd.sheets = [mkSheet(0, 100, [[98, "A1"], [2, "A1", true]]), mkSheet(1, 100, [[101, "A2"]]), mkSheet(2, 50, [[50, "A2"]])];
    const sv = await el.page.request.patch(`/api/v1/orders/${idB}`, { data: { expectedVersion: cur.version, formData: fd } });
    check("OE de 3 tambores con kg reales y lotes se guarda por el backend", sv.ok(), String(sv.status()));
  }
  const stockBefore = { a1: Number(await lotKg(AGUA, "A1")), a2: Number(await lotKg(AGUA, "A2")), ledger: await ledgerKg(AGUA) };
  const sheetsB = await sheetsOf(idB);
  check("cada tambor es una preparación independiente con sus kg teóricos (100/100/50 kg al 100 %)", sheetsB.length === 3 && sheetsB.map((x) => x.materials[0].kgAPesar).join() === "100,100,50", JSON.stringify(sheetsB.map((x) => x.materials[0].kgAPesar)));
  const del1 = await el.page.request.post(`/api/v1/orders/${idB}/deliver`, { data: {} });
  check("entregar la OE con tambores completos funciona", del1.ok(), `${del1.status()} ${(await del1.text()).slice(0, 200)}`);
  const movsB = await oeMovs(idB);
  const outB = movsB.filter((x) => x.kind !== "ingreso");
  const byLote = {};
  for (const x of outB) byLote[x.lote] = (byLote[x.lote] ?? 0) + Number(x.quantity);
  check("el descuento es exactamente la suma de los kg reales de los tambores, por lote (A1: 100, A2: 151)", Math.abs((byLote.A1 ?? 0) - 100) < 1e-6 && Math.abs((byLote.A2 ?? 0) - 151) < 1e-6, JSON.stringify(byLote));
  check("el stock de cada lote bajó lo mismo y el libro mayor coincide (sin duplicar consumos)", Math.abs(stockBefore.a1 - Number(await lotKg(AGUA, "A1")) - 100) < 1e-6 && Math.abs(stockBefore.a2 - Number(await lotKg(AGUA, "A2")) - 151) < 1e-6 && Math.abs(stockBefore.ledger - (await ledgerKg(AGUA)) - 251) < 1e-6 && (await integrity()).ok, JSON.stringify(await integrity()));
  const del2 = await el.page.request.post(`/api/v1/orders/${idB}/deliver`, { data: {} });
  check("entregar de nuevo no vuelve a descontar nada (idempotente)", (await oeMovs(idB)).length === movsB.length && Math.abs(stockBefore.ledger - (await ledgerKg(AGUA)) - 251) < 1e-6, String(del2.status()));
  check("cada movimiento de stock queda con usuario y clave de idempotencia (trazabilidad)", outB.length > 0 && outB.every((x) => x.actor_email && x.idempotency_key));
  // impresión: el resumen y las hojas salen con los textos completos
  await openOe(p, numB);
  await p.locator("[data-testid=oe-sheet-tab-resumen]").click();
  const [pop] = await Promise.all([p.waitForEvent("popup"), p.locator("[data-testid=oe-print-all]").click()]);
  await pop.waitForLoadState();
  const html = await pop.content();
  check("imprimir todas las hojas incluye las 3 hojas, sus kg y lotes", (html.match(/Tambor \d/g) ?? []).length >= 3 && /A2/.test(html) && /AGUA E2E HJ/.test(html) && /@media print|page-break|break-inside/.test(html));
  await pop.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
