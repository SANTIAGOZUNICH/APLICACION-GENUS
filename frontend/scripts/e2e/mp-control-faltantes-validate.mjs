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
    await q("delete from mp_weekly_saved_controls where week_start = $1", [w]).catch(() => undefined);
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
  // ── 1) ANTES de guardar ───────────────────────────────────────────────────────────────────────────────────────────
  check("antes de guardar: mensaje «Guardá el control para ver las materias primas faltantes de esta semana»", /Guardá el control para ver las materias primas faltantes de esta semana/.test(await p.locator("[data-testid=mpw-empty-unsaved]").innerText()));
  check("antes de guardar: no se muestran fórmulas ni necesidades arriba", (await p.locator("[data-testid=mpw-row]").count()) === 0 && (await p.locator("[data-testid=mpw-tiles]").count()) === 0 && (await p.locator("[data-testid=mpw-view-productos]").count()) === 0 && !/Por producto y fórmula/.test(await p.locator("[data-testid=mp-weekly-availability]").innerText()));
  check("el control individual de abajo sigue disponible (formulario de nuevo control)", (await p.locator("[data-testid=mp-control-create]").count()) === 1);
  await p.screenshot({ path: `${OUT}/01-antes-de-guardar.png` });

  // ── 2) GUARDAR el control (servidor) y que el panel muestre solo faltantes ────────────────────────────────────────
  const created = await p.request.post("/api/v1/mp-control", { data: { week: monday, client: CLIENT, product: "CREMA A SEM E2E", quantityKg: 100, snapshot: { client: CLIENT, product: "CREMA A SEM E2E", source: "manual", capturedAt: new Date().toISOString(), materials: [{ codigo: "F-AGUA-SEMX", materiaPrima: AGUA, formulaPct: 72 }, { codigo: "F-GLI-SEMX", materiaPrima: GLI, formulaPct: 12 }] } } });
  check("guardar el control responde OK y confirma que el control semanal quedó guardado", created.status() === 201 && (await created.json()).weeklySaved === true, String(created.status()));
  await openPanel(p);
  await p.locator("[data-testid=mpw-saved-meta]").waitFor({ timeout: 30_000 });
  check("después de guardar aparece «MATERIAS PRIMAS A RESOLVER» con el último control guardado (quién y cuándo)", /MATERIAS PRIMAS A RESOLVER/.test(await p.locator("[data-testid=mpw-title]").innerText()) && /guardado el/.test(await p.locator("[data-testid=mpw-saved-meta]").innerText()));
  check("aparecen SOLO las que necesitan atención: glicerina, perfume, etoxilado, colorante", (await p.locator("[data-testid=mpw-row]").count()) === 4 && (await itemOf(p, "Glicerina").count()) === 1 && (await itemOf(p, "Perfume").count()) === 1 && (await itemOf(p, "Etoxilado").count()) === 1 && (await itemOf(p, "Colorante").count()) === 1);
  check("la MP con stock suficiente (agua) NO aparece", (await itemOf(p, "Agua SEMX").count()) === 0);
  check("ROJO: etoxilado (0 kg en inventario) = SIN STOCK", (await itemOf(p, "Etoxilado").getAttribute("data-estado")) === "SIN_STOCK" && /SIN STOCK/.test(await itemOf(p, "Etoxilado").locator("[data-testid=mpw-estado]").innerText()));
  check("AMARILLO: glicerina y perfume = STOCK INSUFICIENTE", (await itemOf(p, "Glicerina").getAttribute("data-estado")) === "INSUFICIENTE" && (await itemOf(p, "Perfume").getAttribute("data-estado")) === "INSUFICIENTE" && /STOCK INSUFICIENTE/.test(await itemOf(p, "Perfume").locator("[data-testid=mpw-estado]").innerText()));
  check("GRIS: colorante (no está en el inventario) = SIN DATOS, sin asumir stock cero", (await itemOf(p, "Colorante").getAttribute("data-estado")) === "SIN_DATOS" && /no se asume stock cero/i.test(await itemOf(p, "Colorante").locator("[data-testid=mpw-sindatos]").innerText()));
  const perf = itemOf(p, "Perfume");
  const perfTxt = (await perf.innerText()).replace(/\s+/g, " ");
  check("cada faltante muestra producto, cliente, OE/semana y cantidades (perfume: necesario 10 kg, disponible 3 kg, falta 7 kg)", /CREMA A SEM E2E/.test(perfTxt) && /CLIENTE SEM E2E/.test(perfTxt) && /Disponible: 3 kg/.test(perfTxt) && /Necesario: 10 kg/.test(perfTxt) && /Faltante: 7 kg/.test(perfTxt) && /elaboración de la semana: 100 kg/.test(perfTxt), perfTxt.slice(0, 300));
  // stock compartido: glicerina la usan A (100 kg) y B (100 + 150 kg) → un solo stock de 35 kg para 42 kg de necesidad
  const gli = (await itemOf(p, "Glicerina").innerText()).replace(/\s+/g, " ");
  check("stock compartido: glicerina muestra stock total 35 kg, necesidad total 42 kg y faltante total 7 kg (una sola vez)", /Stock utilizable total \(compartido\): 35 kg/.test(gli) && /Necesidad total: 42 kg/.test(gli) && /Faltante total: 7 kg/.test(gli), gli.slice(0, 360));
  const prods = await itemOf(p, "Glicerina").locator("[data-testid=mpw-producto]").count();
  const falt = await itemOf(p, "Glicerina").locator("[data-testid=mpw-producto]").evaluateAll((els) => els.map((e) => e.innerText));
  const sumFalta = falt.reduce((s, t) => { const m = /falta ([\d.,]+) kg/.exec(t); return s + (m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : 0); }, 0);
  check("el detalle por producto y OE se conserva y la suma de faltantes por producto = faltante total (no se duplica)", prods >= 2 && Math.abs(sumFalta - 7) < 0.01, `${prods} productos · suma ${sumFalta}`);
  const tiles = async () => ({ sin: await p.locator("[data-testid=mpw-tile-value-sin-stock]").innerText(), ins: await p.locator("[data-testid=mpw-tile-value-insuficientes]").innerText(), dat: await p.locator("[data-testid=mpw-tile-value-sin-datos]").innerText(), tot: await p.locator("[data-testid=mpw-tile-value-total]").innerText() });
  const t = await tiles();
  check("indicadores: MP sin stock 1 · insuficientes 2 · sin identificar/sin datos 1 · total 4", t.sin === "1" && t.ins === "2" && t.dat === "1" && t.tot === "4", JSON.stringify(t));
  await p.locator("[data-testid=mpw-tile-sin-stock]").tap();
  check("los indicadores filtran (tocar «MP sin stock» deja solo etoxilado)", (await p.locator("[data-testid=mpw-row]").count()) === 1 && (await itemOf(p, "Etoxilado").count()) === 1);
  await p.locator("[data-testid=mpw-filter-INSUFICIENTE]").tap();
  check("filtro INSUFICIENTES: glicerina y perfume", (await p.locator("[data-testid=mpw-row]").count()) === 2);
  await p.locator("[data-testid=mpw-filter-SIN_DATOS]").tap();
  check("filtro SIN DATOS: colorante", (await p.locator("[data-testid=mpw-row]").count()) === 1 && (await itemOf(p, "Colorante").count()) === 1);
  await p.locator("[data-testid=mpw-filter-TODAS]").tap();
  await p.screenshot({ path: `${OUT}/02-despues-de-guardar-tablet.png` });
  check("la página no tiene desplazamiento horizontal propio (tablet)", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));

  // ── 3) Observaciones/decisiones, exclusiones y restauración ──────────────────────────────────────────────────────
  {
    const pf = itemOf(p, "Perfume");
    await pf.locator("[data-testid=mpw-note-input]").fill("Pedir a proveedor (SEM)");
    await pf.locator("[data-testid=mpw-note-input]").evaluate((el) => el.blur());
    await pf.locator("[data-testid=mpw-gestion]").selectOption("comprar");
    check("observación y decisión se guardan en la base con usuario y fecha", await waitDb(async () => (await q("select 1 from mp_weekly_row_state where week_start = $1 and observacion = 'Pedir a proveedor (SEM)' and observacion_by is not null and gestion = 'comprar'", [monday])).length > 0));
    await openPanel(p);
    check("tras recargar siguen las observaciones y la decisión", (await itemOf(p, "Perfume").locator("[data-testid=mpw-note-input]").inputValue()) === "Pedir a proveedor (SEM)" && (await itemOf(p, "Perfume").locator("[data-testid=mpw-gestion]").inputValue()) === "comprar");
    await p.locator("[data-testid=mpw-select-toggle]").tap();
    await p.locator("[data-testid=mpw-select-all]").tap();
    check("selección múltiple: «Seleccionar todos» marca las 4", (await p.locator("[data-testid=mpw-selected-count]").innerText()).startsWith("4 "));
    await p.locator("[data-testid=mpw-select-none]").tap();
    await p.locator("[data-testid=mpw-row]").filter({ hasText: "Perfume" }).locator("[data-testid=mpw-check]").tap();
    await p.locator("[data-testid=mpw-delete-selected]").tap();
    check("quitar pide confirmación y aclara que el inventario no se toca", /No se elimina nada del inventario/.test(await p.locator("[data-testid=mpw-confirm-delete]").innerText()));
    await p.locator("[data-testid=mpw-confirm-delete-yes]").tap();
    check("el perfume quitado desaparece del panel y queda auditado", await waitDb(async () => (await itemOf(p, "Perfume").count()) === 0) && (await q("select 1 from mp_weekly_row_state where week_start = $1 and excluded and excluded_by is not null", [monday])).length === 1);
    await openPanel(p);
    check("la exclusión persiste al recargar (no se restaura sola)", (await itemOf(p, "Perfume").count()) === 0 && (await itemOf(p, "Glicerina").count()) === 1);
    await p.locator("[data-testid=mpw-excluded] summary").tap();
    check("el panel de quitadas lista la MP con quién y cuándo", /Perfume/.test(await p.locator("[data-testid=mpw-excluded]").innerText()) && /la quitó/.test(await p.locator("[data-testid=mpw-excluded]").innerText()));
    await p.locator("[data-testid=mpw-restore]").first().tap();
    await p.locator("[data-testid=mpw-restore-yes]").tap();
    check("«Restaurar» devuelve el perfume al panel con su observación intacta", await waitDb(async () => (await itemOf(p, "Perfume").count()) === 1) && (await itemOf(p, "Perfume").locator("[data-testid=mpw-note-input]").inputValue()) === "Pedir a proveedor (SEM)");
  }

  // ── 4) Cambió el stock después de guardar: se distingue lo guardado de lo actual ──────────────────────────────────
  {
    await lot("SEM-PERF-1", PERF, "Esencias SA", "P2", 20); // ahora alcanza (3 + 20 ≥ 10)
    await p.locator("[data-testid=mpw-refresh]").tap();
    await p.locator("[data-testid=mpw-changed-banner]").waitFor({ timeout: 20_000 });
    const pfTxt = (await itemOf(p, "Perfume").innerText()).replace(/\s+/g, " ");
    check("si cambia el stock físico, el panel mantiene lo guardado y muestra aparte «Hoy»", /Disponible: 3 kg/.test(pfTxt) && /Hoy: ya no necesita atención/.test(pfTxt), pfTxt.slice(0, 260));
    await p.locator("[data-testid=mpw-resave]").tap();
    check("«Actualizar resultados» vuelve a guardar y el perfume sale del panel (sin duplicar el registro semanal)", await waitDb(async () => (await itemOf(p, "Perfume").count()) === 0) && (await q("select count(*)::int n, max(version)::int v from mp_weekly_saved_controls where week_start = $1", [monday]))[0].n === 1);
  }
  // ── 5) Semanas distintas no se mezclan ─────────────────────────────────────────────────────────────────────────────
  {
    await p.locator("[data-testid=mpw-week]").fill(nextMonday);
    await p.locator("[data-testid=mpw-empty-unsaved]").waitFor({ timeout: 30_000 });
    check("otra semana sin control guardado muestra el estado vacío (no hereda resultados)", (await p.locator("[data-testid=mpw-row]").count()) === 0);
    await p.locator("[data-testid=mpw-week]").fill(monday);
    await p.locator("[data-testid=mpw-saved-meta]").waitFor({ timeout: 30_000 });
    check("volver a la semana guardada muestra sus resultados", (await p.locator("[data-testid=mpw-row]").count()) >= 3);
  }
  // ── 6) El control individual de abajo sigue funcionando ───────────────────────────────────────────────────────────
  {
    await openPanel(p);
    await p.getByText(/CLIENTE SEM E2E · CREMA A SEM E2E/).first().click();
    await p.locator("[data-testid=mp-control-lines-grid]").waitFor({ timeout: 30_000 });
    await p.locator("[data-testid=os-table-mode-toggle]").first().click();
    await p.locator("[data-testid=mp-control-lines]").waitFor({ timeout: 30_000 });
    const mini = (name) => p.locator("[data-testid=mp-control-line]").filter({ hasText: name });
    check("control individual: fórmula completa con % y semáforo (cada MP contra su propia necesidad)", (await p.locator("[data-testid=mp-control-line]").count()) === 2 && (await mini(AGUA).getAttribute("data-tone")) === "ok" && (await mini(GLI).getAttribute("data-tone")) === "ok", JSON.stringify(await p.locator("[data-testid=mp-control-line]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-tone"), e.textContent?.slice(0, 80)]))));
  }
  // ── 7) Solo lectura del inventario y permisos ─────────────────────────────────────────────────────────────────────
  check("guardar/ver el control no creó movimientos ni cambió saldos ni lotes", (await q("select count(*)::int n from mp_stock_movements"))[0].n === movs0 && (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h === bal0);
  {
    const prRead = await pr.page.request.get(`/api/v1/mp-control/weekly/saved?week=${monday}`);
    check("Producción puede leer el control guardado (200)", prRead.ok());
    const prWrite = await pr.page.request.post("/api/v1/mp-control/weekly/saved", { data: { week: monday } });
    check("Producción NO puede guardar el control semanal (403)", prWrite.status() === 403, String(prWrite.status()));
  }
  await mp.ctx.close();

  // ── 8) Escritorio ─────────────────────────────────────────────────────────────────────────────────────────────────
  const dk = await openAs(E2E_USERS.materiaPrima, "desktop");
  await openPanel(dk.page);
  check("[escritorio] el panel muestra los faltantes guardados", (await dk.page.locator("[data-testid=mpw-row]").count()) >= 3);
  await dk.page.screenshot({ path: `${OUT}/03-despues-de-guardar-escritorio.png` });
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
