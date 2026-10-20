// E2E en Chromium real: Control semanal de MP — disponibilidad contra el stock REAL del inventario.
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
const OUT = process.env.OUT ?? "/tmp/mp-semanal";
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
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const monday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
})();

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
  await q("delete from mp_weekly_row_state where week_start = $1", [monday]).catch(() => undefined);
  await q("delete from mp_weekly_production_exclusions where week_start = $1", [monday]).catch(() => undefined);
}

try {
  await cleanup();
  await seedFormula("CREMA A SEM E2E", "PT-SEM-A", [[AGUA, "F-AGUA-SEMX", "78"], [GLI, "F-GLI-SEMX", "12"], ["Perfume SEMX", "F-PERF-SEMX", "10"]]);
  await seedFormula("CREMA B SEM E2E", "PT-SEM-B", [[AGUA, "F-AGUA-SEMX", "88"], [GLI, "F-GLI-SEMX", "12"]]);
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A1", 10);
  await lot("SEM-GLI-A", `${GLI} — Proveedor A`, "Proveedor A", "A2", 5);
  await lot("SEM-GLI-B", `${GLI} — Proveedor B`, "Proveedor B", "B1", 8);
  await lot("SEM-GLI-C", `${GLI} — Proveedor C`, "Proveedor C", "C1", 12);
  await lot("SEM-GLI-C", `${GLI} — Proveedor C`, "Proveedor C", "C-BLOQ", 9, { estadoStockManual: "Bloqueado" });
  await lot("", GLI, "Proveedor D", "D1", 0.5); // fila de Stock SIN código (antes se descartaba)
  await lot("SEM-AGUA", AGUA, "Aguas SA", "AG1", 1000);
  await lot("SEM-PERF-1", PERF, "Esencias SA", "P1", 3);
  await lot("SEM-PERF-2", "Esencia floral SEMX", "Esencias SA", "P2", 40);

  const pr = await openAs(E2E_USERS.produccion);
  for (const [product, qty] of [["CREMA A SEM E2E", "100"], ["CREMA B SEM E2E", "100"], ["CREMA B SEM E2E", "150"]]) {
    const r = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: CLIENT, product, plannedQuantity: qty, unit: "kg", plannedDate: monday, branchOwner: "Cristian", idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  }
  const movs0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal0 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;

  const openPanel = async (page) => {
    await page.goto("/mi-trabajo");
    await nav(page, "Control semanal");
    await page.locator("[data-testid=mp-weekly-availability]").waitFor({ timeout: 120_000 });
    await page.locator("[data-testid=mpw-view-consolidado]").click({ timeout: 60_000 });
    await page.locator("[data-testid=mpw-table] [data-testid=mpw-row]").first().waitFor({ timeout: 60_000 });
  };
  const rowOf = (page, name) => page.locator("[data-testid=mpw-row]").filter({ hasText: name });
  const cells = async (row) => (await row.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

  for (const kind of ["tablet", "desktop"]) {
    const mp = await openAs(E2E_USERS.materiaPrima, kind);
    const p = mp.page;
    await openPanel(p);
    const g = await cells(rowOf(p, "Glicerina"));
    // 3 proveedores: 10+5 (A) + 8 (B) + 12 (C) = 35 utilizables, 44 físicos (9 bloqueados); necesidad = 12+12+18 = 42... (100·12% + 100·12% + 150·12%)
    check(`[${kind}] glicerina suma los 3 proveedores: físico 44,5, utilizable 35,5`, g[2] === "44,5" && g[3] === "35,5", JSON.stringify(g));
    check(`[${kind}] necesidad semanal consolidada de las 3 producciones: 42 kg`, g[4] === "42", JSON.stringify(g));
    check(`[${kind}] saldo proyectado -6,5 y estado FALTANTE con el faltante real`, /-6,5/.test(g[6]) && /FALTANTE/.test(g[7]) && /falta 6,5 kg/.test(g[7]), JSON.stringify(g));
    const agua = await cells(rowOf(p, "Agua SEMX"));
    check(`[${kind}] agua: stock 1000, necesidad 78+88+132 = 298, SUFICIENTE`, agua[3] === "1000" && agua[4] === "298" && /SUFICIENTE/.test(agua[7]), JSON.stringify(agua));
    const perf = await cells(rowOf(p, "Perfume SEMX"));
    check(`[${kind}] perfume: se busca por nombre en la Descripción del stock → 3 kg, necesita 10, FALTANTE (falta 7)`, perf[3] === "3" && perf[4] === "10" && /FALTANTE/.test(perf[7]) && /falta 7 kg/.test(perf[7]), JSON.stringify(perf));
    await rowOf(p, "Glicerina").click();
    const lots = await p.locator("[data-testid=mpw-lots]").innerText();
    check(`[${kind}] el detalle muestra proveedores y lotes (incluida la fila sin código), y marca el bloqueado como no utilizable`, /Proveedor A/.test(lots) && /Proveedor B/.test(lots) && /Proveedor C/.test(lots) && /Proveedor D/.test(lots) && /C-BLOQ/.test(lots) && /No — Bloqueado/.test(lots));
    await p.screenshot({ path: `${OUT}/${kind}-detalle-glicerina.png` });
    check(`[${kind}] se ve la fecha y hora de la última actualización`, /Última actualización/.test(await p.locator("[data-testid=mpw-updated]").innerText()));
    // sin desbordes horizontales de la página
    check(`[${kind}] la página no tiene desplazamiento horizontal propio`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));

    // ── Observaciones y gestión (persisten, por MP y semana) ─────────────────────────────────────────────────────────
    {
      const pf = rowOf(p, "Perfume SEMX").first();
      const input = pf.locator("[data-testid=mpw-note-input]");
      await input.fill(`Pedir a proveedor (${kind})`);
      await input.evaluate((el) => el.blur());
      check(`[${kind}] la observación se guarda en la base con usuario y fecha`, await waitDb(async () => (await q("select observacion, observacion_by, observacion_at from mp_weekly_row_state where week_start = $1 and observacion like $2", [monday, `Pedir a proveedor (${kind})`])).some((r) => r.observacion_by && r.observacion_at)));
      await pf.locator("[data-testid=mpw-gestion]").selectOption("comprar");
      check(`[${kind}] la gestión «Comprar» se guarda y no cambia necesidad/estado`, await waitDb(async () => (await q("select 1 from mp_weekly_row_state where week_start = $1 and gestion = 'comprar'", [monday])).length > 0) && (await cells(rowOf(p, "Perfume SEMX").first()))[4] === "10");
      await openPanel(p); // recarga completa
      const again = rowOf(p, "Perfume SEMX").first();
      check(`[${kind}] observación y gestión siguen tras recargar (y se ve quién la escribió)`, (await again.locator("[data-testid=mpw-note-input]").inputValue()) === `Pedir a proveedor (${kind})` && (await again.locator("[data-testid=mpw-gestion]").inputValue()) === "comprar" && /@/.test(await again.locator("[data-testid=mpw-note-meta]").innerText()));
    }
    // ── Selección múltiple y exclusión persistente ────────────────────────────────────────────────────────────────────
    {
      const [lotsBefore] = await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]);
      const total = await p.locator("[data-testid=mpw-row]").count();
      await p.locator("[data-testid=mpw-select-toggle]").click();
      await p.locator("[data-testid=mpw-select-all]").click();
      check(`[${kind}] «Seleccionar todos» marca todas las filas y el contador coincide`, (await p.locator("[data-testid=mpw-selected-count]").innerText()).startsWith(`${total} `) && (await p.locator("[data-testid=mpw-check]:checked").count()) === total);
      await p.locator("[data-testid=mpw-select-none]").click();
      check(`[${kind}] «Deseleccionar todos» deja 0`, (await p.locator("[data-testid=mpw-selected-count]").innerText()).startsWith("0 ") && (await p.locator("[data-testid=mpw-delete-selected]").isDisabled()));
      // dedo/click en la fila y en el checkbox
      const gchk = rowOf(p, "Glicerina").first().locator("[data-testid=mpw-check]");
      if (kind === "tablet") await gchk.tap(); else await gchk.check();
      await rowOf(p, "Perfume SEMX").first().click();
      check(`[${kind}] se pueden marcar varias MP (2 seleccionadas)`, (await p.locator("[data-testid=mpw-selected-count]").innerText()).startsWith("2 "));
      await p.locator("[data-testid=mpw-delete-selected]").click();
      check(`[${kind}] la confirmación muestra la cantidad y aclara que el inventario no se toca`, /2/.test(await p.locator("[data-testid=mpw-confirm-delete]").innerText()) && /No se elimina nada del inventario/.test(await p.locator("[data-testid=mpw-confirm-delete]").innerText()));
      await p.screenshot({ path: `${OUT}/${kind}-confirmar-quitar.png` });
      await p.locator("[data-testid=mpw-confirm-delete-yes]").click();
      check(`[${kind}] las 2 MP desaparecen del control`, await waitDb(async () => (await rowOf(p, "Glicerina").count()) === 0 && (await rowOf(p, "Perfume SEMX").count()) === 0));
      check(`[${kind}] la exclusión queda en la base con usuario y fecha`, (await q("select 1 from mp_weekly_row_state where week_start = $1 and excluded and excluded_by is not null and excluded_at is not null", [monday])).length === 2);
      await openPanel(p);
      check(`[${kind}] tras recargar NO reaparecen`, (await rowOf(p, "Glicerina").count()) === 0 && (await rowOf(p, "Perfume SEMX").count()) === 0 && (await rowOf(p, "Agua SEMX").count()) === 1);
      check(`[${kind}] el inventario (lotes y kg) quedó idéntico`, JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]) === JSON.stringify(lotsBefore));
      await p.locator("[data-testid=mpw-excluded] summary").click();
      check(`[${kind}] las quitadas se listan con quién y cuándo`, /la quitó/.test(await p.locator("[data-testid=mpw-excluded]").innerText()));
      await p.screenshot({ path: `${OUT}/${kind}-quitadas.png` });
      const restores = p.locator("[data-testid=mpw-restore]");
      while ((await restores.count()) > 0) { const n = await restores.count(); if (!(await restores.first().isVisible())) await p.locator("[data-testid=mpw-excluded] summary").click(); await restores.first().click(); await p.locator("[data-testid=mpw-restore-yes]").click(); await waitDb(async () => (await restores.count()) < n); }
      check(`[${kind}] «Restaurar» devuelve las MP`, (await rowOf(p, "Glicerina").count()) === 1 && (await rowOf(p, "Perfume SEMX").count()) === 1);
      // quitar UNA con el botón de la fila
      await rowOf(p, "Perfume SEMX").first().locator("[data-testid=mpw-row-remove]").click();
      await p.locator("[data-testid=mpw-confirm-delete-yes]").click();
      check(`[${kind}] quitar una sola MP desde su fila`, await waitDb(async () => (await rowOf(p, "Perfume SEMX").count()) === 0));
      if (!(await p.locator("[data-testid=mpw-restore]").first().isVisible())) await p.locator("[data-testid=mpw-excluded] summary").click();
      await p.locator("[data-testid=mpw-restore]").first().click();
      await p.locator("[data-testid=mpw-restore-yes]").click();
      await waitDb(async () => (await rowOf(p, "Perfume SEMX").count()) === 1);
    }
    if (kind === "desktop") {
      // cambio de stock → «Actualizar stock» lo refleja sin recargar la página
      await lot("SEM-GLI-B", `${GLI} — Proveedor B`, "Proveedor B", "B2", 20);
      const t0 = await p.locator("[data-testid=mpw-updated]").innerText();
      await p.waitForTimeout(1100);
      await p.locator("[data-testid=mpw-refresh]").click();
      check("«Actualizar stock» refleja el ingreso nuevo (utilizable 35,5 → 55,5; SUFICIENTE) y cambia la hora", await waitDb(async () => { const c = await cells(rowOf(p, "Glicerina").first()); return c[3] === "55,5" && /SUFICIENTE/.test(c[7]); }) && (await p.locator("[data-testid=mpw-updated]").innerText()) !== t0);
      // otros sectores: ven pero no pueden confirmar equivalencias
      const prg = await pr.page.request.get(`/api/v1/mp-control/weekly?week=${monday}`);
      check("Producción puede leer el control semanal", prg.ok());
    }
    await p.screenshot({ path: `${OUT}/${kind}-panel.png`, fullPage: false });
    await mp.ctx.close();
  }
  const movs1 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal1 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  check("el control semanal es de solo lectura: no creó movimientos ni cambió saldos del libro mayor", movs1 === movs0 && bal1 === bal0);
  {
    const pg = await pr.page.request.patch("/api/v1/mp-control/weekly/state", { data: { week: monday, rowKey: "x", label: "x", observacion: "no" } });
    check("Producción NO puede escribir observaciones (403)", pg.status() === 403, String(pg.status()));
    const ex = await pr.page.request.post("/api/v1/mp-control/weekly/exclude", { data: { week: monday, rowKeys: ["x"] } });
    check("Producción NO puede quitar MP del control (403)", ex.status() === 403, String(ex.status()));
    const next = new Date(`${monday}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    const w2 = await (await pr.page.request.get(`/api/v1/mp-control/weekly?week=${next.toISOString().slice(0, 10)}`)).json();
    const rowsW2 = w2.data?.rows ?? w2.rows ?? [];
    check("otra semana no hereda observaciones ni gestión", rowsW2.every((r) => !r.state?.observacion && !r.state?.gestion));
  }
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
