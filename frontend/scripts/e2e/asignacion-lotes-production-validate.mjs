// E2E del bug de Production «no se pueden editar las celdas de Asignación de lotes» (post PR #112), en Chromium real
// contra un BUILD DE PRODUCCIÓN (`next build` + `next start`, NODE_ENV=production, VERCEL_ENV=production simulado →
// write-back a Google apagado) y Postgres DESCARTABLE. Nunca se llama a Google: el sync usa el motor real con la
// planilla en memoria (src/integration/asignacion-lotes-sync-step.db.integration.test.ts).
//
//   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:asignacion-lotes-production    (desde frontend/)
//
// Cubre: fila de Google como las que existen en Production (sincronizada ANTES de 0043, sin identidad de origen)
// editada por Producción en la grilla → guardada → recarga → sync sin cambios (se mantiene) → sync con cambio de la
// planilla (conflicto visible); pestaña con versión anterior (aviso + recargar); base sin 0043 (motivo explícito).
import { execFileSync } from "node:child_process";
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
const OUT = process.env.OUT ?? "/tmp/asignacion-lotes-production";
mkdirSync(OUT, { recursive: true });
const SRC = "e2e-src-prod";
const TAB = "OCTUBRE 2026";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const lot = async (id) => (await q("select * from asignacion_lotes where id = $1", [id]))[0];
const openEdits = (id) => q("select field, status, sheet_value, local_value, conflict_sheet_value from asignacion_lotes_local_edits where record_id = $1 and resolved_at is null order by field", [id]);

// Planilla de la fuente de prueba (encabezados reales de la hoja de lotes).
const HEADER = ["LOTE", "FECHA", "PRODUCTO", "CÓDIGO", "MARCA", "CANTIDAD", "VTO"];
const sheetRow = (over = {}) => {
  const r = { lote: "E2E-PR-001", fecha: "01/10/2026", producto: "SHAMPOO PROD E2E", codigo: "C-PR-1", marca: "MARCA E2E", cantidad: "1000", vto: "10/2028", ...over };
  return [r.lote, r.fecha, r.producto, r.codigo, r.marca, r.cantidad, r.vto];
};
const otherRow = ["E2E-PR-002", "02/10/2026", "CREMA PROD E2E", "C-PR-2", "MARCA E2E", "500", "10/2028"];

function runSync(rows) {
  const out = execFileSync("npx", ["vitest", "run", "src/integration/asignacion-lotes-sync-step.db.integration.test.ts"], {
    env: { ...process.env, GENUS_E2E_SYNC_STEP: JSON.stringify({ sourceId: SRC, tab: TAB, rows: [HEADER, ...rows] }) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = out.split("\n").find((l) => l.includes("[e2e-sync]")) ?? "";
  if (!/1 passed/.test(out)) throw new Error(`el sync de prueba falló:\n${out.slice(-1500)}`);
  return line.replace(/.*\[e2e-sync\]\s*/, "");
}

async function seed() {
  await q("delete from asignacion_lotes_local_edits where record_id like 'e2e-pr-%'");
  await q("delete from asignacion_lotes_cell_audit where record_id like 'e2e-pr-%'");
  await q("delete from asignacion_lotes where id like 'e2e-pr-%' or source_id = $1", [SRC]);
  // Fuente registrada con planilla inexistente y deshabilitada: el cron/sync oportunista de la app nunca la lee.
  await q(
    "insert into asignacion_lote_sources (id, name, spreadsheet_id, sheet_tab, enabled) values ($1, 'Planilla E2E Production (sin conexión)', 'e2e-no-es-una-planilla', $2, false) on conflict (id) do update set sheet_tab = excluded.sheet_tab",
    [SRC, TAB]
  );
  // Filas como las que YA estaban en Production antes de 0043: source_lote/codigo/producto NULL.
  for (const [id, r] of [["e2e-pr-1", sheetRow()], ["e2e-pr-2", otherRow]]) {
    await q(
      `insert into asignacion_lotes (id, lote, fecha, producto, codigo, marca, cantidades, vto, source_id, source_sheet_tab, created_by, updated_by)
       values ($1,$2,to_date($3,'DD/MM/YYYY'),$4,$5,$6,$7,'2028-10-31',$8,$9,'Sync','Sync')`,
      [id, r[0], r[1], r[2], r[3], r[4], r[5], SRC, TAB]
    );
  }
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const debugPages = [];
async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
async function openLots(page, lote = "E2E-PR-001") {
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  await nav(page, "Asignación de lotes");
  await page.waitForFunction((l) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === l), lote, { timeout: 120_000 });
}
async function cell(page, lote, title) {
  const pos = await page.evaluate(([lote, title]) => {
    const rows = [...document.querySelectorAll(".dsg-row")];
    const header = rows.find((r) => r.classList.contains("dsg-row-header"));
    const col = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === title);
    const ri = rows.findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === lote));
    return { col, ri };
  }, [lote, title]);
  if (pos.col < 0 || pos.ri < 0) throw new Error(`celda no encontrada: ${lote} / ${title} ${JSON.stringify(pos)}`);
  return page.locator(".dsg-row").nth(pos.ri).locator(".dsg-cell").nth(pos.col);
}
const cellLock = async (page, lote, title) =>
  (await cell(page, lote, title)).evaluate((el) => ({ locked: Boolean(el.querySelector(".genus-cell-lock")), reason: el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "" }));
const cellValue = async (page, lote, title) => (await cell(page, lote, title)).locator("input").inputValue();
async function typeInto(page, lote, title, value) {
  const c = await cell(page, lote, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}
/** Captura con la grilla a la vista (los avisos y filtros ocupan el primer pantallazo). */
async function shot(page, name) {
  await page.locator("[data-testid^=asignacion-lotes-grid]").first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const hide0043 = async () => {
  await q("alter table asignacion_lotes_local_edits rename to zz_e2e_hidden_local_edits");
  await q("alter table asignacion_lotes rename column source_lote to zz_e2e_hidden_source_lote");
};
const restore0043 = async () => {
  await q("alter table if exists zz_e2e_hidden_local_edits rename to asignacion_lotes_local_edits");
  const hidden = await q("select 1 from information_schema.columns where table_name = 'asignacion_lotes' and column_name = 'zz_e2e_hidden_source_lote'");
  if (hidden.length) await q("alter table asignacion_lotes rename column zz_e2e_hidden_source_lote to source_lote");
};

try {
  await restore0043();
  await seed();
  check("datos: 2 filas de Google sincronizadas ANTES de 0043 (sin identidad de origen), como en Production",
    (await q("select count(*)::int n from asignacion_lotes where source_id = $1 and source_lote is null", [SRC]))[0].n === 2);

  // ============ 1. Producción edita una celda de una fila de Google directamente en la grilla ============
  const prod = await openAs(E2E_USERS.produccion);
  const pp = prod.page;
  const health = await pp.request.get("/api/v1/version").then((r) => r.json()).catch(() => ({}));
  check("servidor en configuración de producción con commit identificado (/api/v1/version)", typeof health.build === "string" && health.build.length >= 7, health.build);
  await openLots(pp);
  const env = await pp.request.get("/api/v1/env-check").then((r) => r.json()).catch(() => ({}));
  check("diagnóstico: /api/v1/env-check informa que 0043 está aplicada", env.asignacionLotesLocalEdits?.ready === true, JSON.stringify(env.asignacionLotesLocalEdits));
  check("sin avisos de versión vieja ni de error de carga", (await pp.locator("[data-testid=asignacion-lotes-stale-build], [data-testid=asignacion-lotes-load-issue]").count()) === 0);
  for (const col of ["Cantidades", "Lote", "VTO", "Observaciones", "Marca / Cliente"]) {
    const l = await cellLock(pp, "E2E-PR-001", col);
    check(`fila de Google · «${col}» sin candado para Producción`, !l.locked, l.reason);
  }
  await shot(pp, "1-produccion-fila-google-editable.png");

  await typeInto(pp, "E2E-PR-001", "Cantidades", "1180");
  check("doble clic + escribir + Enter: la cantidad se guarda en la base", await waitDb(async () => Number((await lot("e2e-pr-1")).cantidades) === 1180));
  await typeInto(pp, "E2E-PR-001", "Observaciones", "Recuento físico Producción");
  check("observaciones editadas en la misma fila", await waitDb(async () => (await lot("e2e-pr-1")).observaciones === "Recuento físico Producción"));
  const le1 = await openEdits("e2e-pr-1");
  check("queda «editado en GENUS» con el valor de la planilla (1000 → 1180)", le1.some((e) => e.field === "cantidades" && e.sheet_value === "1000" && e.local_value === "1180" && e.status === "ACTIVE"), JSON.stringify(le1));
  check("auditoría por celda con usuario y sector", (await q("select count(*)::int n from asignacion_lotes_cell_audit where record_id = 'e2e-pr-1' and field = 'cantidades' and actor_sector = 'PRODUCCION' and new_value = '1180'"))[0].n === 1);

  // ============ 2. Recargar ============
  await pp.reload();
  await openLots(pp);
  check("tras recargar, la grilla muestra 1180", (await cellValue(pp, "E2E-PR-001", "Cantidades")) === "1180");
  check("la celda se marca «editado en GENUS»", await (await cell(pp, "E2E-PR-001", "Cantidades")).evaluate((el) => el.classList.contains("genus-cell-local-edit")));
  await shot(pp, "2-recarga-valor-conservado.png");

  // ============ 3. Nueva sincronización: la planilla NO cambió ese dato (cambió otro) → se mantiene ============
  const s1 = runSync([sheetRow({ marca: "MARCA ACTUALIZADA EN PLANILLA" }), otherRow]);
  check("sync real (motor de Production, planilla en memoria) sin errores", true, s1);
  await pp.reload();
  await openLots(pp);
  check("después del sync: 1180 se MANTIENE (el sync no pisa lo editado en GENUS)", (await cellValue(pp, "E2E-PR-001", "Cantidades")) === "1180" && Number((await lot("e2e-pr-1")).cantidades) === 1180);
  check("…y los campos no editados siguen a la planilla (marca actualizada)", (await lot("e2e-pr-1")).marca === "MARCA ACTUALIZADA EN PLANILLA");
  check("…sin duplicar ni archivar (identidad de origen guardada)", (await q("select count(*)::int n from asignacion_lotes where source_id = $1 and archived = false", [SRC]))[0].n === 2 && (await lot("e2e-pr-1")).source_lote === "E2E-PR-001");
  await shot(pp, "3-sync-mantiene-edicion.png");

  // ============ 4. Nueva sincronización: la planilla cambió el MISMO dato → conflicto visible ============
  const s2 = runSync([sheetRow({ marca: "MARCA ACTUALIZADA EN PLANILLA", cantidad: "1100" }), otherRow]);
  check("sync con cambio de la planilla en el dato editado", true, s2);
  const le2 = await openEdits("e2e-pr-1");
  check("conflicto registrado: GENUS 1180 vs planilla 1100, sin elegir en silencio", Number((await lot("e2e-pr-1")).cantidades) === 1180 && le2.some((e) => e.field === "cantidades" && e.status === "CONFLICT" && e.conflict_sheet_value === "1100"), JSON.stringify(le2));
  await pp.reload();
  await openLots(pp);
  await pp.locator("[data-testid=lotes-local-edit][data-status=CONFLICT]").first().waitFor({ timeout: 30_000 });
  check("conflicto visible en el panel y la celda en ámbar", await (await cell(pp, "E2E-PR-001", "Cantidades")).evaluate((el) => el.classList.contains("genus-cell-local-conflict")));
  await shot(pp, "4-sync-conflicto-visible.png");

  // ============ 5. Pestaña abierta desde antes del deploy (código viejo) ============
  const ctxStale = await browser.newContext({ baseURL: BASE, viewport: { width: 1600, height: 950 }, storageState: await prod.ctx.storageState() });
  const ps = await ctxStale.newPage();
  debugPages.push(ps);
  // El servidor "ya tiene" otro commit: lo que vería una pestaña/PWA que quedó abierta antes del deploy.
  const newerBuild = "0000000e2e-newer-deploy";
  await ps.route("**/api/v1/asignacion-lotes?*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, build: newerBuild } });
  });
  await ps.route("**/api/v1/version", (route) => route.fulfill({ json: { build: newerBuild } }));
  await ps.goto("/mi-trabajo");
  await openLots(ps);
  await ps.locator("[data-testid=asignacion-lotes-stale-build]").waitFor({ timeout: 30_000 });
  const staleLock = await cellLock(ps, "E2E-PR-002", "Cantidades");
  check("versión anterior: aviso «Hay una versión nueva… Recargá» y la grilla no simula que se puede guardar", staleLock.locked && /versión anterior/.test(staleLock.reason), staleLock.reason);
  check("aviso global de la app (PWA) ofrece «Actualizar ahora»", await ps.getByText("Hay una nueva versión de Genus OS").isVisible().catch(() => false));
  await ps.locator("[data-testid=asignacion-lotes-stale-build]").scrollIntoViewIfNeeded();
  await ps.screenshot({ path: `${OUT}/5a-pestana-version-anterior-aviso.png` });
  await shot(ps, "5b-pestana-version-anterior-grilla.png");
  await ctxStale.close();

  // ============ 6. Base sin 0043 (deploy sin migración): motivo explícito, nunca caché «editable» ============
  await hide0043();
  try {
    await pp.reload();
    await nav(pp, "Asignación de lotes");
    await pp.locator("[data-testid=asignacion-lotes-load-issue][data-kind=schema]").waitFor({ timeout: 60_000 });
    const msg = await pp.locator("[data-testid=asignacion-lotes-load-issue]").innerText();
    check("sin 0043: la pantalla dice exactamente qué falta (migración 0043) en vez de un error genérico", /0043/.test(msg), msg.replace(/\s+/g, " ").slice(0, 140));
    const api = await pp.request.patch("/api/v1/asignacion-lotes/cells", { data: { actorSectorId: "PRODUCCION", changes: [{ id: "e2e-pr-2", field: "cantidades", value: "1", expectedVersion: "x" }] } });
    check("sin 0043: la API responde 503 ASIGNACION_LOTES_SCHEMA_PENDING (no 500)", api.status() === 503 && (await api.json()).code === "ASIGNACION_LOTES_SCHEMA_PENDING", String(api.status()));
    const env2 = await pp.request.get("/api/v1/env-check").then((r) => r.json()).catch(() => ({}));
    check("sin 0043: /api/v1/env-check lo informa (faltantes)", env2.asignacionLotesLocalEdits?.ready === false && env2.asignacionLotesLocalEdits.missing.length > 0, JSON.stringify(env2.asignacionLotesLocalEdits?.missing));
    await pp.locator("[data-testid=asignacion-lotes-load-issue]").scrollIntoViewIfNeeded();
    await pp.screenshot({ path: `${OUT}/6-sin-0043-motivo-explicito.png` });
  } finally {
    await restore0043();
  }
  await pp.reload();
  await openLots(pp);
  check("con 0043 restaurada vuelve a ser editable sin intervención", !(await cellLock(pp, "E2E-PR-002", "Cantidades")).locked);
  await typeInto(pp, "E2E-PR-002", "Cantidades", "520");
  check("…y guarda (fila de Google, 500 → 520)", await waitDb(async () => Number((await lot("e2e-pr-2")).cantidades) === 520));
  await prod.ctx.close();

  check("nada de esto escribió en Google (sin operaciones de write-back)", (await q("select count(*)::int n from asignacion_lotes_writeback_ops"))[0].n === 0);
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await restore0043().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
