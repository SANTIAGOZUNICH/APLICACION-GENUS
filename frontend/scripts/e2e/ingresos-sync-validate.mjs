// E2E en Chromium real — sincronización automática (SOLO LECTURA) de Ingresos ME / MP. Base DESCARTABLE; dos sesiones independientes.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, devices } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/ingresos-sync";
const FIX = path.join(OUT, "fixtures");
mkdirSync(FIX, { recursive: true });
writeFileSync(path.join(FIX, "hoja.jpg"), Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const { defaultBrowserType: _i, ...PHONE } = devices["Pixel 7"];
void _i;

async function open(user, phone) {
  const ctx = await browser.newContext({ baseURL: BASE, ...(phone ? PHONE : { viewport: { width: 1440, height: 900 } }) });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = async (page, label) => {
  const direct = page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first();
  if (!(await direct.isVisible().catch(() => false))) {
    const menu = page.getByRole("button", { name: /menú|menu|abrir navegación/i }).first();
    if (await menu.isVisible().catch(() => false)) await menu.click();
  }
  await direct.click({ timeout: 120_000 });
};
const rowsOf = (page) => page.evaluate(() => document.querySelectorAll(".dsg-row").length);
const syncState = (page) => page.locator("[data-testid=sync-status]").first().getAttribute("data-state");
/** Carga un remito a mano desde el celular y lo pasa al Excel (el ingreso queda persistido en el servidor). */
async function phoneIngreso(ph, tag) {
  await ph.locator("[data-testid=nuevo-ingreso-remito]").click();
  await ph.locator("[data-testid=ingreso-remito-dialog]").waitFor();
  await ph.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja.jpg"));
  await ph.locator("[data-testid=remito-cargar-manual]").click();
  await ph.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  await ph.locator("[data-testid=remito-proveedor]").fill(`PROV SYNC ${tag}`);
  await ph.locator("[data-testid=remito-numero]").fill(`0001-${tag}`);
  await ph.locator("[data-testid=linea-descripcion]").first().fill(`ITEM ${tag}`);
  await ph.locator("[data-testid=linea-cantidad]").first().fill("10");
  await ph.locator("[data-testid=remito-pasar-excel]").click();
  await ph.locator("[data-testid=paso-planilla]").waitFor({ timeout: 60_000 });
  await ph.locator("[data-testid=remito-ir-tabla]").click();
}
const waitRows = (page, n, ms) => page.waitForFunction((x) => document.querySelectorAll(".dsg-row").length >= x, n, { timeout: ms }).then(() => true).catch(() => false);

try {
  // ===== ME: PC de Depósito ya abierta + celular =====
  const pc = await open(E2E_USERS.deposito, false);
  const p = pc.page;
  await nav(p, "Ingresos ME");
  await p.getByRole("button", { name: "Nuevo ingreso", exact: true }).waitFor({ timeout: 120_000 });
  await p.waitForFunction(() => document.querySelector("[data-testid=sync-status]")?.getAttribute("data-state") === "ok", null, { timeout: 40_000 }).catch(() => undefined);
  check("Indicador discreto de sincronización visible en la planilla (Ingresos ME)", (await p.locator("[data-testid=sync-status]").count()) >= 1 && /Sincronizado \d{2}:\d{2}:\d{2}/.test(await p.locator("[data-testid=sync-status]").first().innerText()), await p.locator("[data-testid=sync-status]").first().innerText());
  // Datos locales preexistentes (centinelas) + contador de escrituras de almacenamiento durante la sincronización
  await p.evaluate(() => {
    localStorage.setItem("genus-sentinel:cola", JSON.stringify([{ id: 1, cambio: "pendiente" }]));
    localStorage.setItem("genus-sentinel:borrador", "texto sin enviar");
    window.__removed = 0;
    const rm = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) { window.__removed++; return rm.call(this, k); };
  });
  const rows0 = await rowsOf(p);
  const audit0 = Number((await q("select count(*)::int n from inv_audit"))[0].n);
  const stockRows0 = Number((await q("select count(*)::int n from mp_stock_movements"))[0].n);

  const ph = await open(E2E_USERS.deposito, true);
  await nav(ph.page, "Ingresos ME");
  await ph.page.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
  await phoneIngreso(ph.page, "ME1");
  const t0 = Date.now();
  const seen = await waitRows(p, rows0 + 1, 25_000);
  check("ME: el ingreso del celular aparece en la PC SIN recargar (≤ 25 s)", seen, `${Math.round((Date.now() - t0) / 1000)} s`);
  check("ME: la PC no recargó la página (los datos locales y el contador siguen)", (await p.evaluate(() => window.__removed !== undefined)) && (await p.evaluate(() => localStorage.getItem("genus-sentinel:borrador"))) === "texto sin enviar");
  const dbIng = await q("select payload->>'proveedor' prov from inv_me_ingresos where payload->>'proveedor' = 'PROV SYNC ME1'");
  check("ME: el ingreso está persistido UNA vez en Postgres (sin duplicados)", dbIng.length === 1);

  // Edición en curso: no se interrumpe ni se pisa
  const lastRow = p.locator(".dsg-row").last();
  await lastRow.locator(".dsg-cell").nth(2).dblclick().catch(() => undefined);
  await p.keyboard.type("EDITANDO");
  const editing = await p.evaluate(() => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? ""));
  const rowsEdit = await rowsOf(p);
  await phoneIngreso(ph.page, "ME2");
  await p.waitForTimeout(24_000);
  const stillTyping = await p.evaluate(() => document.activeElement?.value ?? "");
  check("ME: mientras se edita una celda la sincronización se POSTERGA (no interrumpe ni pisa lo escrito)", editing && (await rowsOf(p)) === rowsEdit && /EDITANDO/.test(stillTyping), JSON.stringify({ editing, stillTyping }));
  check("ME: el indicador avisa que actualizará al terminar de editar", /terminar de editar/.test(await p.locator("[data-testid=sync-status]").first().innerText()));
  await p.keyboard.press("Escape");
  await p.locator("h2, h1").first().click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  check("ME: al terminar de editar se pone al día sola (≤ 15 s)", await waitRows(p, rowsEdit + 1, 15_000));

  // Desplazamiento
  await p.evaluate(() => { const c = document.querySelector(".dsg-container"); if (c) c.scrollTop = 0; });
  const scrollBefore = await p.evaluate(() => document.scrollingElement.scrollTop);

  // Solo lectura: una ventana sin cambios no escribe nada
  const quiet0 = { audit: Number((await q("select count(*)::int n from inv_audit"))[0].n), ing: Number((await q("select count(*)::int n from inv_me_ingresos"))[0].n) };
  await p.waitForTimeout(25_000);
  const quiet1 = { audit: Number((await q("select count(*)::int n from inv_audit"))[0].n), ing: Number((await q("select count(*)::int n from inv_me_ingresos"))[0].n) };
  check("La sincronización es SOLO LECTURA: sin cambios en auditoría ni ingresos en 25 s de sondeo", quiet0.audit === quiet1.audit && quiet0.ing === quiet1.ing, JSON.stringify([quiet0, quiet1]));
  check("Sin movimientos de stock por sincronizar (MP) y sin tocar el almacenamiento local (ningún removeItem)", Number((await q("select count(*)::int n from mp_stock_movements"))[0].n) === stockRows0 && (await p.evaluate(() => window.__removed)) === 0);
  check("Datos locales centinela intactos", (await p.evaluate(() => localStorage.getItem("genus-sentinel:cola"))) === JSON.stringify([{ id: 1, cambio: "pendiente" }]));
  check("Posición de desplazamiento sin saltos", Math.abs((await p.evaluate(() => document.scrollingElement.scrollTop)) - scrollBefore) <= 2);

  // Volver a la pestaña: actualización inmediata
  await phoneIngreso(ph.page, "ME3");
  const rowsNow = await rowsOf(p);
  await p.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  check("ME: al volver a la pestaña se actualiza enseguida (≤ 4 s)", await waitRows(p, rowsNow + 1, 4_000));

  // Pérdida de conexión: error visible, datos conservados, recuperación
  const keep = await rowsOf(p);
  await pc.ctx.setOffline(true);
  await p.waitForFunction(() => document.querySelector("[data-testid=sync-status]")?.getAttribute("data-state") === "error", null, { timeout: 25_000 }).catch(() => undefined);
  check("Sin conexión: el indicador muestra el error y la planilla conserva sus datos", (await syncState(p)) === "error" && (await rowsOf(p)) === keep);
  await pc.ctx.setOffline(false);
  await p.waitForFunction(() => document.querySelector("[data-testid=sync-status]")?.getAttribute("data-state") === "ok", null, { timeout: 25_000 }).catch(() => undefined);
  check("Al volver la conexión se recupera sola", (await syncState(p)) === "ok");

  // Verificación de consistencia (solo lectura)
  const c1 = await (await p.request.get("/api/v1/inventory/receipts?module=ME&view=consistency")).json();
  check("Consistencia ME: recepciones ↔ ingresos ↔ fotos sin problemas y con totales correctos", c1.consistency?.ok === true && c1.consistency.totals.ingresosEnPlanilla === 3 && c1.consistency.totals.recepcionesEnPlanilla === 3 && c1.consistency.totals.fotosActivas === 3, JSON.stringify(c1.consistency?.totals));
  await q("delete from inv_me_ingresos where payload->>'proveedor' = 'PROV SYNC ME3'");
  const c2 = await (await p.request.get("/api/v1/inventory/receipts?module=ME&view=consistency")).json();
  check("Consistencia ME: detecta un ingreso faltante (recepción sin su ingreso)", c2.consistency?.ok === false && c2.consistency.problems.ingresosFaltantes.length === 1);
  await ph.ctx.close();
  await pc.ctx.close();

  // ===== MP =====
  const pcm = await open(E2E_USERS.materiaPrima, false);
  const pm = pcm.page;
  await nav(pm, "Ingresos MP");
  await pm.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
  await pm.waitForFunction(() => document.querySelector("[data-testid=sync-status]")?.getAttribute("data-state") === "ok", null, { timeout: 40_000 }).catch(() => undefined);
  check("Indicador de sincronización en Ingresos MP", (await pm.locator("[data-testid=sync-status]").count()) >= 1);
  const mrows0 = await rowsOf(pm);
  const stockMov0 = Number((await q("select count(*)::int n from mp_stock_movements"))[0].n);
  const phm = await open(E2E_USERS.materiaPrima, true);
  await nav(phm.page, "Ingresos MP");
  await phm.page.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
  await phoneIngreso(phm.page, "MP1");
  check("MP: el ingreso del celular aparece en la PC SIN recargar (≤ 25 s)", await waitRows(pm, mrows0 + 1, 25_000));
  check("MP: la sincronización no movió stock ni libro mayor", Number((await q("select count(*)::int n from mp_stock_movements"))[0].n) === stockMov0);
  const cm = await (await pm.request.get("/api/v1/inventory/receipts?module=MP&view=consistency")).json();
  check("Consistencia MP sin problemas", cm.consistency?.ok === true, JSON.stringify(cm.consistency?.totals));
  await phm.ctx.close();
  await pcm.ctx.close();
} catch (e) {
  console.error(e);
  check("Ejecución sin errores", false, String(e.message ?? e).split("\n")[0]);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
  if (failed.length) console.log("FALLARON:\n" + failed.map((f) => "- " + f.name).join("\n"));
  await browser.close();
  await pool.end();
  process.exitCode = failed.length ? 1 : 0;
}
