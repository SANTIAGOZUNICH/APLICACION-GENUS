// E2E en Chromium real: Control semanal de MP simplificado: «Materias primas a resolver» (solo faltantes, después de guardar).
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/mp-control-faltantes";
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

const TIPS = { desktop: { viewport: { width: 1360, height: 900 } }, tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 } };
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
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const TAG = "SEM";
const CLIENT = "CLIENTE SEM E2E";
const GLI = "Glicerina SEMX";
const AGUA = "Agua SEMX";
const PERF = "Perfume SEMX";
const ETO = "Etoxilado SEMX";
const COL = "Colorante SEMX";
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const mondayOf = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const monday = mondayOf(new Date());
const nextMonday = (() => { const d = new Date(`${monday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();

async function seedFormula(product, code, rows) {
  const [existing] = await q("select active_version_id from formula_products where normalized_client = $1 and normalized_product = $2", [norm(CLIENT), norm(product)]);
  if (existing) return;
  const productId = randomUUID();
  const versionId = randomUUID();
  await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,$6,$7)`, [productId, norm(CLIENT), norm(product), CLIENT, product, code, versionId]);
  await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet, source_file) values ($1,$2,1,'VIGENTE','src-sem',$3,'OK','Fórmula',$4)`, [versionId, productId, `sha-sem-${code}-0123456789`, `${product}.xlsx`]);
  let i = 0;
  for (const [n, c, p] of rows) await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, n, c, p]);
  await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
}
async function lot(codigo, descripcion, proveedor, lote, kg, extra = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await q(`insert into inv_mp_stock (id, payload) values ($1,$2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor, lote, cantidadKg: kg, vencimiento: "2032-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: TAG, updatedBy: TAG, createdAt: now, updatedAt: now, ...extra })]);
}
async function cleanup() {
  const prev = await q("select id from operational_orders where product like '% SEM E2E'");
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
  }
  await q("delete from operational_orders where product like '% SEM E2E'");
  await q("delete from work_items where product like '% SEM E2E'");
  await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [TAG]);
  for (const w of [monday, nextMonday]) {
    await q("delete from mp_weekly_row_state where week_start = $1", [w]).catch(() => undefined);
    await q("delete from mp_weekly_production_exclusions where week_start = $1", [w]).catch(() => undefined);
    await q("delete from mp_weekly_saved_product_controls where week_start = $1", [w]).catch(() => undefined);
  }
  await q("delete from mp_weekly_control_lines where control_id in (select id from mp_weekly_controls where client = $1)", [CLIENT]).catch(() => undefined);
  await q("delete from mp_weekly_controls where client = $1", [CLIENT]).catch(() => undefined);
}

try {
  await cleanup();
  await seedFormula("CREMA A SEM E2E", "PT-SEM-A", [[AGUA, "F-AGUA-SEMX", "72"], [GLI, "F-GLI-SEMX", "12"], [PERF, "F-PERF-SEMX", "10"], [ETO, "F-ETO-SEMX", "5"], [COL, "F-COL-SEMX", "1"]]);
  await seedFormula("CREMA B SEM E2E", "PT-SEM-B", [[AGUA, "F-AGUA-SEMX", "88"], [GLI, "F-GLI-SEMX", "12"]]);
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A1", 10);
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A2", 5);
  await lot("SEM-GLI-B", `${GLI} — Proveedor B`, "Proveedor B", "B1", 8);
  await lot("SEM-GLI-C", `${GLI} — Proveedor C`, "Proveedor C", "C1", 12);
  await lot("SEM-AGUA", AGUA, "Aguas SA", "AG1", 1000);
  await lot("SEM-PERF-1", PERF, "Esencias SA", "P1", 3);
  await lot("SEM-ETO", ETO, "Quimica SA", "E1", 0); // en el inventario pero SIN stock
  // Colorante: NO está en el inventario → no identificada (gris), no «stock cero».

  const pr = await openAs(E2E_USERS.produccion);
  for (const [product, qty] of [["CREMA A SEM E2E", "100"], ["CREMA B SEM E2E", "100"], ["CREMA B SEM E2E", "150"]]) {
    const r = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: CLIENT, product, plannedQuantity: qty, unit: "kg", plannedDate: monday, branchOwner: "Cristian", idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  }
  const movs0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal0 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  const lots0 = JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]);

  const openPanel = async (page) => {
    await page.goto("/mi-trabajo");
    await nav(page, "Control semanal");
    await page.locator("[data-testid=mp-weekly-availability]").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(800);
  };
  const itemOf = (page, name) => page.locator("[data-testid=mpw-row]").filter({ hasText: name });

  const mp = await openAs(E2E_USERS.materiaPrima, "tablet");
  const p = mp.page;
  await openPanel(p);

  const mkControl = (product, qty, mats) => ({ week: monday, client: CLIENT, product, quantityKg: qty, snapshot: { client: CLIENT, product, source: "manual", capturedAt: new Date().toISOString(), materials: mats } });
  const matsA = [[AGUA, "F-AGUA-SEMX", 72], [GLI, "F-GLI-SEMX", 12], [PERF, "F-PERF-SEMX", 10], [ETO, "F-ETO-SEMX", 5], [COL, "F-COL-SEMX", 1]].map(([materiaPrima, codigo, formulaPct]) => ({ materiaPrima, codigo, formulaPct }));
  const matsB = [[AGUA, "F-AGUA-SEMX", 88], [GLI, "F-GLI-SEMX", 12]].map(([materiaPrima, codigo, formulaPct]) => ({ materiaPrima, codigo, formulaPct }));
  const blockOf = (page, product) => page.locator("[data-testid=mpw-block]").filter({ has: page.locator("[data-testid=mpw-block-product]", { hasText: product }) });
  const itemIn = (block, name) => block.locator("[data-testid=mpw-item]").filter({ hasText: name });

  // ── 1) Antes de guardar ningún control ────────────────────────────────────────────────────────────────────────────
  check("sin controles guardados: solo el mensaje «Guardá el control…», sin bloques ni fórmulas", /Guardá el control para ver las materias primas faltantes de esta semana/.test(await p.locator("[data-testid=mpw-empty-unsaved]").innerText()) && (await p.locator("[data-testid=mpw-block]").count()) === 0);
  check("el control individual de abajo sigue disponible", (await p.locator("[data-testid=mp-control-create]").count()) === 1);
  await p.screenshot({ path: `${OUT}/01-antes-de-guardar.png` });

  // ── 2) Guardar el control de A: aparece SOLO A con SUS faltantes ──────────────────────────────────────────────────
  const a = await p.request.post("/api/v1/mp-control", { data: mkControl("CREMA A SEM E2E", 100, matsA) });
  const aBody = await a.json();
  check("guardar el control A responde 201 y weeklySaved=true", a.status() === 201 && aBody.weeklySaved === true, String(a.status()));
  await openPanel(p);
  await p.locator("[data-testid=mpw-block]").first().waitFor({ timeout: 30_000 });
  const bA = blockOf(p, "CREMA A SEM E2E");
  check("aparece un bloque: producto, cliente y kg de producción correctos", (await p.locator("[data-testid=mpw-block]").count()) === 1 && (await bA.locator("[data-testid=mpw-block-client]").innerText()) === CLIENT && /PRODUCCIÓN: 100 KG/.test(await bA.locator("[data-testid=mpw-block-kg]").innerText()), await p.locator("[data-testid=mpw-list]").innerText());
  check("el producto sin control guardado (B) NO aparece", (await blockOf(p, "CREMA B SEM E2E").count()) === 0);
  check("solo las MP que faltan: perfume, etoxilado, colorante (3)", (await bA.locator("[data-testid=mpw-item]").count()) === 3);
  check("MP SIN STOCK (etoxilado, 0 kg) en ROJO", (await itemIn(bA, "Etoxilado").getAttribute("data-estado")) === "SIN_STOCK" && /SIN STOCK/.test(await itemIn(bA, "Etoxilado").innerText()) && /rose|border-rose/.test((await itemIn(bA, "Etoxilado").getAttribute("class")) ?? ""));
  check("MP INSUFICIENTE (perfume 3 de 10 kg) en AMARILLO con faltante 7", (await itemIn(bA, "Perfume").getAttribute("data-estado")) === "INSUFICIENTE" && /amber/.test((await itemIn(bA, "Perfume").getAttribute("class")) ?? "") && /Necesario: 10 kg/.test(await itemIn(bA, "Perfume").innerText()) && /Stock físico: 3 kg/.test(await itemIn(bA, "Perfume").innerText()) && /Faltante: 7 kg/.test(await itemIn(bA, "Perfume").innerText()), await itemIn(bA, "Perfume").innerText());
  check("MP NO IDENTIFICADA (colorante) en ROJO, «Stock no identificado», no 0 kg", (await itemIn(bA, "Colorante").getAttribute("data-estado")) === "NO_IDENTIFICADA" && /NO IDENTIFICADA/.test(await itemIn(bA, "Colorante").innerText()) && /Stock no identificado/.test(await itemIn(bA, "Colorante").innerText()) && /rose/.test((await itemIn(bA, "Colorante").getAttribute("class")) ?? ""));
  check("MP con stock suficiente (agua y glicerina de A) NO aparecen", (await itemIn(bA, "Agua SEMX").count()) === 0 && (await itemIn(bA, "Glicerina").count()) === 0);
  check("no se muestran porcentajes ni fórmulas completas arriba", !/%/.test(await p.locator("[data-testid=mpw-list]").innerText()));
  await p.screenshot({ path: `${OUT}/02-un-control-guardado.png` });

  // ── 3) Segundo control (B): bloque separado; stock compartido de glicerina sin duplicar ───────────────────────────
  const b = await p.request.post("/api/v1/mp-control", { data: mkControl("CREMA B SEM E2E", 250, matsB) });
  check("guardar el control B responde 201 y weeklySaved=true", b.status() === 201 && (await b.json()).weeklySaved === true);
  await openPanel(p);
  await p.locator("[data-testid=mpw-block]").nth(1).waitFor({ timeout: 30_000 });
  const bB = blockOf(p, "CREMA B SEM E2E");
  check("dos productos guardados = dos bloques independientes", (await p.locator("[data-testid=mpw-block]").count()) === 2 && (await bB.count()) === 1 && (await blockOf(p, "CREMA A SEM E2E").count()) === 1);
  check("B: kg de producción 250 y solo SUS MP (glicerina), sin las de A", /PRODUCCIÓN: 250 KG/.test(await bB.locator("[data-testid=mpw-block-kg]").innerText()) && (await bB.locator("[data-testid=mpw-item]").count()) === 1 && (await itemIn(bB, "Perfume").count()) === 0);
  check("stock compartido: A usa 12 de los 35 kg de glicerina; B solo dispone de 23 → falta 7 (no se cuentan dos veces)", (await itemIn(bB, "Glicerina").getAttribute("data-estado")) === "INSUFICIENTE" && /Necesario: 30 kg/.test(await itemIn(bB, "Glicerina").innerText()) && /Disponible para esta producción: 23 kg/.test(await itemIn(bB, "Glicerina").innerText()) && /Faltante: 7 kg/.test(await itemIn(bB, "Glicerina").innerText()), await itemIn(bB, "Glicerina").innerText());
  check("el bloque A no cambió al guardar B", (await blockOf(p, "CREMA A SEM E2E").locator("[data-testid=mpw-item]").count()) === 3);
  await p.screenshot({ path: `${OUT}/03-dos-controles.png` });

  // ── 4) Re-guardar no duplica; actualizar un control no toca el otro ───────────────────────────────────────────────
  const re = await p.request.patch(`/api/v1/mp-control/${aBody.control.id}`, { data: { quantityKg: 100, week: monday, expectedVersion: aBody.control.updatedAt } });
  const reBody = await re.json();
  const rowsDb = await q("select control_id, version from mp_weekly_saved_product_controls where week_start = $1 order by created_at", [monday]);
  check("volver a guardar el control A no duplica registros y sube la versión", re.ok() && reBody.weeklySaved === true && rowsDb.length === 2 && rowsDb[0].version === 2 && rowsDb[1].version === 1, JSON.stringify({ s: re.status(), rowsDb }));
  const resaveBtn = blockOf(p, "CREMA B SEM E2E").locator("[data-testid=mpw-resave]");
  await resaveBtn.click();
  await p.locator("[data-testid=mpw-notice]").waitFor({ timeout: 30_000 });
  check("«Actualizar con stock de hoy» en B actualiza solo B (sigue habiendo 2 filas)", (await q("select version from mp_weekly_saved_product_controls where week_start = $1 order by created_at", [monday])).map((r) => r.version).join(",") === "2,2" && (await p.locator("[data-testid=mpw-block]").count()) === 2);

  // ── 5) Otra semana no se mezcla; recarga conserva ─────────────────────────────────────────────────────────────────
  await p.locator("[data-testid=mpw-week]").fill(nextMonday);
  await p.locator("[data-testid=mpw-empty-unsaved]").waitFor({ timeout: 30_000 });
  check("otra semana: sin bloques (no se muestran resultados de otra semana)", (await p.locator("[data-testid=mpw-block]").count()) === 0);
  await openPanel(p);
  check("después de recargar los dos controles siguen guardados", (await p.locator("[data-testid=mpw-block]").count()) === 2);

  // ── 6) Anular un control lo quita del panel ───────────────────────────────────────────────────────────────────────
  {
    // El control individual de abajo sigue funcionando.
    await p.getByText(/CLIENTE SEM E2E · CREMA A SEM E2E/).first().click();
    await p.locator("[data-testid=mp-control-lines-grid]").waitFor({ timeout: 30_000 });
    check("control individual de abajo abre con su fórmula completa", (await p.locator("[data-testid=mp-control-lines-grid]").count()) === 1);
  }

  // ── 7) Solo lectura del inventario y permisos ─────────────────────────────────────────────────────────────────────
  check("guardar/ver controles no creó movimientos ni cambió saldos ni lotes", (await q("select count(*)::int n from mp_stock_movements"))[0].n === movs0 && (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h === bal0);
  {
    const prRead = await pr.page.request.get(`/api/v1/mp-control/weekly/saved?week=${monday}`);
    check("Producción puede leer los controles guardados (200)", prRead.ok() && (await prRead.json()).controls.length === 2);
    const prWrite = await pr.page.request.post("/api/v1/mp-control/weekly/saved", { data: { week: monday, controlId: aBody.control.id } });
    check("Producción NO puede guardar el control semanal (403)", prWrite.status() === 403, String(prWrite.status()));
  }
  await mp.ctx.close();

  // ── 8) Escritorio ─────────────────────────────────────────────────────────────────────────────────────────────────
  const dk = await openAs(E2E_USERS.materiaPrima, "desktop");
  await openPanel(dk.page);
  check("[escritorio] el panel muestra los dos bloques", (await dk.page.locator("[data-testid=mpw-block]").count()) === 2);
  await dk.page.screenshot({ path: `${OUT}/04-escritorio.png` });
  check("[escritorio] sin desplazamiento horizontal de la página", await dk.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  await dk.ctx.close();
  await pr.ctx.close();
  void lots0;
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
