// E2E en Chromium real: Asignación de lotes editable como planilla, también en filas sincronizadas desde Google (0043).
// Base DESCARTABLE (marca verificada) y login real. NUNCA se llama a Google: las filas «de Google» se cargan en la base
// de prueba con una fuente registrada pero deshabilitada (como las dejaría el sync). Ver run-asignacion-lotes-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/asignacion-lotes-edicion";
mkdirSync(OUT, { recursive: true });
const SRC = "e2e-src-lotes";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const lot = async (lote) => (await q("select * from asignacion_lotes where lote = $1 or source_lote = $1 order by created_at limit 1", [lote]))[0];

async function seed() {
  await q("delete from asignacion_lotes_local_edits where record_id in (select id from asignacion_lotes where lote like 'E2E-AL-%' or source_lote like 'E2E-AL-%')");
  await q("delete from asignacion_lotes_cell_audit where lote like 'E2E-AL-%'");
  await q("delete from asignacion_lotes where lote like 'E2E-AL-%' or source_lote like 'E2E-AL-%'");
  await q("insert into asignacion_lote_sources (id, name, spreadsheet_id, enabled) values ($1, 'Planilla E2E (sin conexión)', 'e2e-no-es-una-planilla', false) on conflict (id) do nothing", [SRC]);
  const mk = (id, lote, producto, cantidades, extra = {}) =>
    q(
      `insert into asignacion_lotes (id, lote, fecha, producto, codigo, marca, cantidades, vto, source_id, source_sheet_tab, source_lote, source_codigo, source_producto, created_by, updated_by)
       values ($1,$2,'2026-10-01',$3,$4,'MARCA E2E',$5,'2028-10-01',$6,'OCTUBRE 2026',$2,$4,$3,'Sync','Sync')`,
      [id, lote, producto, extra.codigo ?? `C-${lote}`, cantidades, extra.manual ? null : SRC]
    );
  await mk("e2e-al-1", "E2E-AL-001", "SHAMPOO E2E", 1000);
  await mk("e2e-al-2", "E2E-AL-002", "CREMA E2E", 500);
  await mk("e2e-al-3", "E2E-AL-003", "SERUM E2E", 300);
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
const openLots = async (page) => {
  await nav(page, "Asignación de lotes");
  await page.waitForFunction(() => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === "E2E-AL-001"), null, { timeout: 120_000 });
};

/** Celda de la grilla: fila que contiene `lote`, columna por título. */
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
async function typeInto(page, lote, title, value) {
  const c = await cell(page, lote, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

try {
  await seed();
  check("datos de prueba: 3 lotes «de Google» (fuente registrada, sin conexión)", (await q("select count(*)::int n from asignacion_lotes where source_id = $1", [SRC]))[0].n === 3);

  // ================= PRODUCCIÓN: edición directa en la grilla =================
  const prod = await openAs(E2E_USERS.produccion);
  const pp = prod.page;
  await openLots(pp);
  const locks = await pp.evaluate(() => [...document.querySelectorAll(".dsg-row")].filter((r) => [...r.querySelectorAll("input")].some((i) => i.value.startsWith("E2E-AL-"))).flatMap((r) => [...r.querySelectorAll(".genus-cell-protected")]).length);
  check("filas sincronizadas desde Google SIN candados en las columnas de Producción", locks <= 3 * 4, `${locks} celdas protegidas (solo las columnas de Calidad: muestras/cj/fecha análisis + Origen)`);
  await pp.screenshot({ path: `${OUT}/1-lotes-grilla-sin-candados.png` });

  await typeInto(pp, "E2E-AL-001", "Cantidades", "1250");
  const okQty = await waitDb(async () => Number((await lot("E2E-AL-001")).cantidades) === 1250);
  check("doble clic + escribir + Enter: la cantidad se guarda en la base", okQty);
  await typeInto(pp, "E2E-AL-001", "Marca / Cliente", "CLIENTE CORREGIDO").catch(async () => typeInto(pp, "E2E-AL-001", "Marca", "CLIENTE CORREGIDO"));
  const okMarca = await waitDb(async () => (await lot("E2E-AL-001")).marca === "CLIENTE CORREGIDO");
  check("marca / cliente editada en la grilla", okMarca);
  const le = await q("select field, status, sheet_value, local_value from asignacion_lotes_local_edits where record_id = 'e2e-al-1' and resolved_at is null order by field");
  check("queda registrado «editado en GENUS» con el valor de la planilla (el sync no lo pisa)", le.some((e) => e.field === "cantidades" && e.sheet_value === "1000" && e.local_value === "1250"), JSON.stringify(le));

  // recargar y encontrar exactamente el valor corregido
  await pp.reload();
  await openLots(pp);
  const shown = await (await cell(pp, "E2E-AL-001", "Cantidades")).locator("input").inputValue();
  check("tras recargar, la grilla muestra exactamente el valor corregido (1250)", shown === "1250", shown);
  const marked = await (await cell(pp, "E2E-AL-001", "Cantidades")).evaluate((el) => el.classList.contains("genus-cell-local-edit"));
  check("la celda editada se distingue (marca «editado en GENUS»)", marked);
  check("panel: datos editados en GENUS sobre filas de Google", /editado\(s\) en GENUS/.test(await pp.locator("[data-testid=lotes-local-edits-panel]").innerText()));
  await pp.screenshot({ path: `${OUT}/2-lotes-editado-en-genus.png`, fullPage: true });

  // pegar un rango desde Excel (2 filas × 1 columna) en Observaciones
  const target = await cell(pp, "E2E-AL-002", "Observaciones");
  await target.click();
  await pp.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Revisado por Producción\nPendiente de análisis");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });
  const apply = pp.locator("[data-testid$=preview-apply]");
  if (await apply.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await apply.click();
  const okPaste = await waitDb(async () => (await lot("E2E-AL-002")).observaciones === "Revisado por Producción" && (await lot("E2E-AL-003")).observaciones === "Pendiente de análisis");
  check("pegar desde Excel un rango de 2 filas: ambas celdas guardadas", okPaste);

  // deshacer el último guardado (el pegado)
  const undo = pp.locator("[data-testid$=-undo]").first();
  if (await undo.isVisible().catch(() => false)) {
    await undo.click();
    const okUndo = await waitDb(async () => (await lot("E2E-AL-002")).observaciones === "" && (await lot("E2E-AL-003")).observaciones === "");
    check("deshacer revierte el último guardado (y queda auditado)", okUndo);
  } else check("deshacer revierte el último guardado (y queda auditado)", false, "sin botón deshacer");

  // historial del lote
  await pp.getByRole("button", { name: "Historial de E2E-AL-001" }).first().click();
  await pp.locator("[data-testid=lote-history-entry]").first().waitFor({ timeout: 30_000 });
  const hist = await pp.locator("[data-testid=lote-history-dialog]").innerText();
  check("historial: Cantidades 1000 → 1250 con usuario y fecha", /Cantidades/.test(hist) && /1000/.test(hist) && /1250/.test(hist), hist.replace(/\s+/g, " ").slice(0, 120));
  await pp.screenshot({ path: `${OUT}/3-lotes-historial.png` });
  await pp.keyboard.press("Escape");

  // conflicto: la planilla cambió el mismo dato (estado que deja el sync; la regla del sync se prueba en integración)
  await q("update asignacion_lotes_local_edits set status = 'CONFLICT', conflict_sheet_value = '1100' where record_id = 'e2e-al-1' and field = 'cantidades' and resolved_at is null");
  await pp.reload();
  await openLots(pp);
  await pp.locator("[data-testid=lotes-local-edit][data-status=CONFLICT]").first().waitFor({ timeout: 30_000 });
  check("conflicto visible: GENUS 1250 vs planilla 1100, con decisión explícita", /1250/.test(await pp.locator("[data-testid=lotes-local-edit][data-status=CONFLICT]").first().innerText()));
  check("la celda en conflicto se marca en ámbar", await (await cell(pp, "E2E-AL-001", "Cantidades")).evaluate((el) => el.classList.contains("genus-cell-local-conflict")));
  await pp.screenshot({ path: `${OUT}/4-lotes-conflicto.png`, fullPage: true });
  await pp.locator("[data-testid=lotes-local-edit][data-status=CONFLICT] [data-testid=local-edit-keep]").first().click();
  const okKeep = await waitDb(async () => (await q("select status, sheet_value from asignacion_lotes_local_edits where record_id = 'e2e-al-1' and field = 'cantidades' and resolved_at is null"))[0]?.status === "ACTIVE");
  check("«Mantener GENUS»: conserva 1250 y toma 1100 como nuevo valor de la planilla (auditado)", okKeep && Number((await lot("E2E-AL-001")).cantidades) === 1250 && (await q("select count(*)::int n from asignacion_lotes_cell_audit where record_id = 'e2e-al-1' and batch_id like 'resolve-%'"))[0].n >= 1);

  // agregar un registro nuevo (alta) y verlo tras recargar
  await pp.getByRole("button", { name: /Nuevo lote/ }).first().click();
  const dlg = pp.getByRole("dialog");
  await dlg.getByLabel(/^Lote/).first().fill("E2E-AL-NUEVO");
  await dlg.getByLabel(/^Fecha/).first().fill("2026-10-09");
  await dlg.getByLabel(/^Producto/).first().fill("TONICO E2E");
  await dlg.getByLabel(/^Cantidades/).first().fill("80");
  await dlg.locator('button[type="submit"]').click();
  const okNew = await waitDb(async () => Boolean(await lot("E2E-AL-NUEVO")));
  await pp.reload();
  await openLots(pp);
  check("agregar fila: el lote nuevo persiste y aparece tras recargar", okNew && (await pp.evaluate(() => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === "E2E-AL-NUEVO"))));

  // concurrencia: versión vieja → 409, nada se pisa
  const stale = await pp.request.patch("/api/v1/asignacion-lotes/cells", { data: { actorSectorId: "PRODUCCION", changes: [{ id: "e2e-al-1", field: "cantidades", value: "9", expectedVersion: "2020-01-01T00:00:00.000Z" }] } });
  check("versión vieja → 409 y no se pisa", stale.status() === 409 && Number((await lot("E2E-AL-001")).cantidades) === 1250, String(stale.status()));
  await prod.ctx.close();

  // ================= PERMISOS =================
  const cal = await openAs(E2E_USERS.calidad);
  await openLots(cal.page);
  await typeInto(cal.page, "E2E-AL-002", "Muestras", "3");
  check("Calidad edita sus columnas (muestras) en una fila de Google", await waitDb(async () => (await lot("E2E-AL-002")).muestras === "3"));
  await cal.ctx.close();

  const cod = await openAs(E2E_USERS.codificado);
  const denyQty = await cod.page.request.patch("/api/v1/asignacion-lotes/cells", { data: { actorSectorId: "CODIFICADO", changes: [{ id: "e2e-al-3", field: "cantidades", value: "1", expectedVersion: (await lot("E2E-AL-003")).updated_at.toISOString() }] } });
  check("Codificado NO puede cambiar cantidades (403)", denyQty.status() === 403, String(denyQty.status()));
  await cod.ctx.close();
  const env = await pwRequest.newContext({ baseURL: BASE });
  await env.post("/api/v1/auth/login", { data: { email: E2E_USERS.envasado.email, password: E2E_PASSWORD } });
  const denyEnv = await env.patch("/api/v1/asignacion-lotes/cells", { data: { actorSectorId: "ENVASADO_MASIVO", changes: [{ id: "e2e-al-3", field: "observaciones", value: "x", expectedVersion: "x" }] } });
  check("Envasado (sin acceso al módulo) → 403", denyEnv.status() === 403, String(denyEnv.status()));
  await env.dispose();
  check("nada de esto escribió en Google (no hay operaciones de write-back)", (await q("select count(*)::int n from asignacion_lotes_writeback_ops"))[0].n === 0);
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
