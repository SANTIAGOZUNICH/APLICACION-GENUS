// E2E en Chromium real: Control semanal de MP como PLANILLA automática (8 columnas) desde Elaboración + Stock MP.
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
const OUT = process.env.OUT ?? "/tmp/mp-control-semanal";
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
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A1", 20);
  await lot("SEM-AGUA", AGUA, "Aguas SA", "AG1", 1000);
  await lot("SEM-PERF-1", PERF, "Esencias SA", "P1", 3);
  await lot("SEM-ETO", ETO, "Quimica SA", "E1", 0); // en el inventario pero SIN stock
  // Colorante: NO está en el inventario → no identificada (gris), no «stock cero».

  const pr = await openAs(E2E_USERS.produccion);
  for (const [product, qty] of [["CREMA A SEM E2E", "100"], ["CREMA B SEM E2E", "150"]]) {
    const r = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: CLIENT, product, plannedQuantity: qty, unit: "kg", plannedDate: monday, branchOwner: "Cristian", idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  }
  const movs0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal0 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  const oeSnap = async () => JSON.stringify((await q("select count(*)::int n, coalesce(sum(version),0)::int v, coalesce(max(updated_at)::text,'') u from operational_orders"))[0]);
  const oes0 = await oeSnap();
  const lots0 = JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]);

  const mk = async (page, sel) => page.locator(sel);
  const openPanel = async (page, viaVer = false) => {
    await page.goto("/mi-trabajo");
    if (viaVer) await nav(page, "Materias Primas");
    await nav(page, "Control semanal");
    await page.locator("[data-testid=mp-weekly-table]").waitFor({ timeout: 120_000 });
    await page.locator("[data-testid=mpt-row]").first().waitFor({ timeout: 60_000 });
  };
  const rowsOf = async (page, product) => {
    const all = await page.locator("[data-testid=mpt-row]").all();
    const out = [];
    let cur = "";
    for (const r of all) {
      if ((await r.getAttribute("data-first")) === "1") cur = await r.locator("[data-testid=mpt-producto]").innerText();
      if (cur.includes(product)) out.push({ mp: await r.locator("[data-testid=mpt-mp]").innerText(), nec: await r.locator("[data-testid=mpt-necesaria]").innerText(), inv: (await r.locator("[data-testid=mpt-inventario]").innerText()).split("\n")[0], falta: await r.locator("[data-testid=mpt-falta]").innerText(), estado: await r.locator("[data-testid=mpt-estado]").innerText(), fecha: await r.locator("[data-testid=mpt-fecha]").innerText() });
    }
    return out;
  };
  const byMp = (rows, name) => rows.find((r) => r.mp.includes(name));

  const mp = await openAs(E2E_USERS.materiaPrima, "tablet");
  const p = mp.page;
  await openPanel(p);
  const hdr = (await p.locator("[data-testid=mpt-table] thead th").allInnerTexts()).map((s) => s.trim());
  check("1) las ocho columnas del Excel, en orden", JSON.stringify(hdr) === JSON.stringify(["PRODUCTO A ELABORAR", "MATERIA PRIMA", "CANT. NECESARIA", "EN INVENTARIO", "FALTA", "ESTADO", "OBSERVACIÓN", "FECHA"]), hdr.join(" | "));
  const A = await rowsOf(p, "CREMA A SEM E2E");
  const B = await rowsOf(p, "CREMA B SEM E2E");
  check("2) los trabajos programados aparecen sin cargar nada (fórmula completa de cada producto)", A.length === 5 && B.length === 2, `${A.length}/${B.length}`);
  const gA = byMp(A, "Glicerina");
  check("3) cantidad necesaria desde la fórmula y la cantidad real (12 % de 100 kg = 12,000 kg) y EN INVENTARIO del Stock MP (20 kg)", gA?.nec === "12,000 kg" && gA?.inv === "20,000 kg", JSON.stringify(gA));
  check("4) stock suficiente → HAY, falta 0", gA?.estado === "HAY" && gA?.falta === "0,000 kg", JSON.stringify(gA));
  const gB = byMp(B, "Glicerina");
  check("5) ACUMULADO: B necesita 18 kg y solo quedan 8 tras A → FALTA 10,000 kg (el stock no se cuenta dos veces)", gB?.nec === "18,000 kg" && gB?.inv === "8,000 kg" && gB?.falta === "10,000 kg" && gB?.estado === "FALTA", JSON.stringify(gB));
  check("6) MP que no está en el Stock MP → SIN DATOS (no se asume cero)", byMp(A, "Colorante")?.estado === "SIN DATOS" && byMp(A, "Colorante")?.inv === "—");
  check("7) MP con stock 0 → FALTA por todo lo necesario", byMp(A, "Etoxilado")?.estado === "FALTA" && byMp(A, "Etoxilado")?.falta === "5,000 kg", JSON.stringify(byMp(A, "Etoxilado")));
  check("8) la fecha es la programada (formato argentino)", gA?.fecha === monday.split("-").reverse().join("/"), gA?.fecha);
  const sumText = await p.locator("[data-testid=mpt-summary]").innerText();
  check("9) resumen compacto: 2 programadas, 0 con MP suficientes, 2 con faltantes, MP distintas con faltante", /programadas: 2/.test(sumText) && /Con faltantes: 2/.test(sumText) && /MP distintas con faltante: \d+/.test(sumText), sumText.replace(/\n/g, " "));
  const colors = await p.evaluate(() => {
    const th = document.querySelector("[data-testid=mpt-table] thead th");
    const hay = document.querySelector("[data-testid=mpt-row][data-estado=HAY] [data-testid=mpt-estado]");
    const falta = document.querySelector("[data-testid=mpt-row][data-estado=FALTA] [data-testid=mpt-estado]");
    const cs = (e) => (e ? getComputedStyle(e) : null);
    return { head: cs(th)?.backgroundColor, headPos: cs(th)?.position, hay: cs(hay)?.backgroundColor, falta: cs(falta)?.backgroundColor };
  });
  check("10) encabezado oscuro y fijo, HAY verde suave, FALTA rojo suave", colors.head === "rgb(31, 41, 55)" && colors.headPos === "sticky" && colors.hay === "rgb(220, 252, 231)" && colors.falta === "rgb(254, 226, 226)", JSON.stringify(colors));
  await p.screenshot({ path: `${OUT}/01-tablet.png` });

  // Filtros
  await p.locator("[data-testid=mpt-filter-FALTA]").click();
  const onlyFalta = await p.locator("[data-testid=mpt-row]").evaluateAll((els) => els.every((e) => e.getAttribute("data-estado") === "FALTA") && els.length > 0);
  check("11) filtro FALTA muestra solo faltantes", onlyFalta);
  await p.locator("[data-testid=mpt-filter-TODOS]").click();
  await p.locator("[data-testid=mpt-search]").fill("etoxilado");
  check("12) buscador por materia prima", (await p.locator("[data-testid=mpt-row]").count()) === 1);
  await p.locator("[data-testid=mpt-search]").fill("");

  // Observación: persiste al recargar
  await p.locator("[data-testid=mpt-row]").filter({ hasText: "Glicerina" }).first().locator("[data-testid=mpt-obs]").fill("Comprar urgente");
  await p.locator("[data-testid=mpt-row]").filter({ hasText: "Glicerina" }).first().locator("[data-testid=mpt-obs]").press("Enter");
  check("13) la observación se guarda sola", await waitDb(async () => (await q("select count(*)::int n from mp_weekly_row_state where observacion = 'Comprar urgente'"))[0].n >= 1));
  await openPanel(p);
  check("14) la observación persiste al recargar", (await p.locator("[data-testid=mpt-row]").filter({ hasText: "Glicerina" }).first().locator("[data-testid=mpt-obs]").inputValue()) === "Comprar urgente");

  // Ingreso de MP: al actualizar, la disponibilidad cambia (B pasa a HAY)
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A2", 15);
  await p.locator("[data-testid=mpt-refresh]").click();
  await waitDb(async () => true, 800);
  await p.waitForTimeout(1200);
  const B2 = await rowsOf(p, "CREMA B SEM E2E");
  check("15) un ingreso de MP actualiza la disponibilidad al refrescar (35 kg: A 12 + B 18 → HAY)", byMp(B2, "Glicerina")?.estado === "HAY" && byMp(B2, "Glicerina")?.falta === "0,000 kg", JSON.stringify(byMp(B2, "Glicerina")));

  // Cambio de fecha: el trabajo pasa a la otra semana
  const wi = (await q("select id from work_items where product = 'CREMA B SEM E2E' and deleted_at is null limit 1"))[0];
  await q("update work_items set planned_date = $2, planned_date_to = null where id = $1", [wi.id, nextMonday]);
  await p.locator("[data-testid=mpt-refresh]").click();
  await p.waitForTimeout(1500);
  check("16) reprogramar mueve el trabajo a otra semana", (await rowsOf(p, "CREMA B SEM E2E")).length === 0 && (await rowsOf(p, "CREMA A SEM E2E")).length === 5);
  await p.locator("[data-testid=mpt-next]").click();
  await p.waitForTimeout(1500);
  const Bn = await rowsOf(p, "CREMA B SEM E2E");
  check("17) aparece en la semana siguiente con su fecha nueva", Bn.length === 2 && Bn[0].fecha === nextMonday.split("-").reverse().join("/"), JSON.stringify(Bn[0]));
  await q("update work_items set planned_date = $2 where id = $1", [wi.id, monday]);

  // Producción: lectura y observaciones, sin mover nada
  const pro = await openAs(E2E_USERS.produccion, "desktop");
  await openPanel(pro.page, true);
  check("18) Producción ve la planilla (escritorio) y puede escribir observaciones", (await pro.page.locator("[data-testid=mpt-obs]").count()) > 0);
  await pro.page.screenshot({ path: `${OUT}/02-escritorio.png` });

  // Consulta: no modifica Stock MP, movimientos, OE
  const movs1 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal1 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  check("19) Control semanal no crea movimientos ni cambia saldos de Stock MP", movs1 === movs0 && bal1 === bal0, `${movs0}→${movs1}`);
  check("20) no altera las OE (solo consulta): mismas OE, versiones y fecha de modificación", (await oeSnap()) === oes0, oes0);
  await mp.ctx.close();
  await pro.ctx.close();
} catch (error) {
  console.error(error);
  check("ejecución sin excepciones", false, String(error?.message ?? error));
} finally {
  await cleanup().catch(() => undefined);
  await pool.end().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
