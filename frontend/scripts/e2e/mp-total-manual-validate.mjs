// E2E en Chromium real: MP → Control semanal total con edición directa de observaciones, reemplazo MANUAL de MP (buscador libre del
// inventario, aunque los nombres sean totalmente distintos) y selección/eliminación/restauración. Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/mp-total-manual";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 20_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

const TAG = "WTM";
const CLIENT = "CLIENTE WTM E2E";
const EMX = "EMULSIONANTE X WTM";
const ESP = "ESPESANTE Y WTM";
const GLI = "Glicerina WTMX";
const REAL = "EMULCARE EI WTM";
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const mondayOf = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const monday = mondayOf(new Date());

async function seedFormula(product, code, rows) {
  const [existing] = await q("select 1 from formula_products where normalized_client = $1 and normalized_product = $2", [norm(CLIENT), norm(product)]);
  if (existing) return;
  const productId = randomUUID(); const versionId = randomUUID();
  await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,$6,$7)`, [productId, norm(CLIENT), norm(product), CLIENT, product, code, versionId]);
  await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet, source_file) values ($1,$2,1,'VIGENTE','src-wtm',$3,'OK','Fórmula',$4)`, [versionId, productId, `sem-${versionId}`, "wtm.xlsx"]);
  let i = 0;
  for (const [n, c, p] of rows) await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, n, c, p]);
  await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
}
async function lot(codigo, descripcion, lote, kg) {
  const id = randomUUID(); const now = new Date().toISOString();
  await q(`insert into inv_mp_stock (id, payload) values ($1,$2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor: "Prov", lote, cantidadKg: kg, vencimiento: "2032-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: TAG, updatedBy: TAG, createdAt: now, updatedAt: now })]);
}
async function cleanup() {
  const prev = await q("select id from operational_orders where product like '% WTM E2E'");
  for (const r of prev) { await q("delete from order_audit_events where order_id = $1", [r.id]); await q("delete from order_versions where order_id = $1", [r.id]); }
  await q("delete from operational_orders where product like '% WTM E2E'");
  await q("delete from work_items where product like '% WTM E2E'");
  await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [TAG]);
  await q("delete from mp_weekly_row_state where row_key like 'T|%'").catch(() => undefined);
  await q("delete from mp_weekly_total_replacements where source_key like '%wtm%' or target_code like '%WTM%'").catch(() => undefined);
}

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
async function openTotal(page) {
  await page.goto("/mi-trabajo");
  await nav(page, "Control semanal");
  await page.getByRole("button", { name: /^Control semanal total$/ }).click({ timeout: 60_000 });
  await page.locator("[data-testid=mp-total]").waitFor({ timeout: 120_000 });
  await page.locator("[data-testid=mp-total-row]").first().waitFor({ timeout: 120_000 });
}
const rowBy = (page, text) => page.locator("[data-testid=mp-total-row]").filter({ hasText: text });
const names = async (page) => (await page.locator("[data-testid=mp-total-nombre]").allInnerTexts()).map((t) => t.replace(/^[▸▾]\s*/, "").trim());

try {
  await cleanup();
  await seedFormula("PROD A WTM E2E", "PT-WTM-A", [[EMX, "F-EMX-WTM", "5"], [ESP, "F-ESP-WTM", "2"], [GLI, "F-GLI-WTM", "10"]]);
  await seedFormula("PROD B WTM E2E", "PT-WTM-B", [[EMX, "F-EMX-WTM", "5"]]);
  await lot("MP023-WTM", `${REAL} — Proveedor Z`, "R1", 20);
  await lot("GLI-WTM", `${GLI} — Prov`, "G1", 500);
  await lot("CBM-WTM", "Carbomero 940 WTM", "C1", 7);

  const pr = await openAs(E2E_USERS.produccion);
  for (const product of ["PROD A WTM E2E", "PROD B WTM E2E"]) {
    const r = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: CLIENT, product, plannedQuantity: "100", unit: "kg", plannedDate: monday, branchOwner: "Cristian", idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  }
  const inv0 = JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]);
  const ing0 = (await q("select count(*)::int n from formula_ingredients where material_name in ($1,$2)", [EMX, ESP]))[0].n;

  const mp = await openAs(E2E_USERS.materiaPrima);
  const p = mp.page;
  await openTotal(p);
  check("el control muestra EMULSIONANTE X (sin identificar), ESPESANTE Y y Glicerina", (await rowBy(p, EMX).count()) === 1 && (await rowBy(p, ESP).count()) === 1 && (await rowBy(p, GLI).count()) === 1);
  check("EMULSIONANTE X suma 10 kg de las dos OE y figura «sin identificar»", /sin identificar/.test(await rowBy(p, EMX).innerText()) && /\b10\b/.test(await rowBy(p, EMX).locator("[data-testid=mp-total-necesario]").innerText()));
  check("hay columna OBSERVACIONES con celda editable, botón «Buscar coincidencia» y casilla en cada fila", (await p.locator("[data-testid=mp-total-obs]").count()) === 3 && (await p.locator("[data-testid=mp-total-buscar-coincidencia]").count()) === 3 && (await p.locator("[data-testid=mp-total-select]").count()) === 3);
  await p.screenshot({ path: `${OUT}/0-control-total.png` });

  // ============ PRUEBA A — escribir directo ============
  const obs = rowBy(p, GLI).locator("[data-testid=mp-total-obs]");
  await obs.click();
  await obs.fill("Pedir 200 kg al proveedor");
  await rowBy(p, GLI).locator("[data-testid=mp-total-obs-state]").getByText(/guardado/).waitFor({ timeout: 15_000 });
  check("A: escribir en la celda guarda solo (aparece «✓ guardado»), sin formularios ni botón de editar", true);
  check("A: la observación está en la base de datos", await waitDb(async () => (await q("select observacion from mp_weekly_row_state where row_key like 'T|%' and observacion = 'Pedir 200 kg al proveedor'")).length === 1));
  await p.reload();
  await openTotal(p);
  check("A: tras RECARGAR la observación sigue escrita", (await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").inputValue()) === "Pedir 200 kg al proveedor");
  const obs2 = rowBy(p, GLI).locator("[data-testid=mp-total-obs]");
  await obs2.fill("Pedido OK");
  await obs2.press("Enter");
  await waitDb(async () => (await q("select 1 from mp_weekly_row_state where observacion = 'Pedido OK'")).length === 1);
  await p.reload();
  await openTotal(p);
  check("A: se puede MODIFICAR y persiste", (await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").inputValue()) === "Pedido OK");
  await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").fill("");
  await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").press("Enter");
  await waitDb(async () => (await q("select 1 from mp_weekly_row_state where row_key like 'T|%' and observacion = ''")).length >= 1);
  await p.reload();
  await openTotal(p);
  check("A: se puede BORRAR y sigue vacía tras recargar", (await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").inputValue()) === "");
  await rowBy(p, GLI).locator("[data-testid=mp-total-obs]").fill("Texto final para Excel");

  // ============ PRUEBA B — reemplazo manual ============
  await rowBy(p, EMX).locator("[data-testid=mp-total-buscar-coincidencia]").click();
  const dlg = p.locator("[data-testid=mp-total-replace-dialog]");
  await dlg.waitFor({ timeout: 15_000 });
  await dlg.locator("[data-testid=mp-total-replace-search]").fill("emulcare");
  await dlg.locator("[data-testid=mp-total-hit][data-codigo='MP023-WTM']").waitFor({ timeout: 15_000 });
  const hitText = await dlg.locator("[data-testid=mp-total-hit][data-codigo='MP023-WTM']").innerText();
  check("B: el buscador devuelve una MP del inventario con un nombre COMPLETAMENTE distinto al original (EMULCARE EI)", /EMULCARE EI WTM/.test(hitText) && !/EMULSIONANTE/.test(hitText), hitText.replace(/\s+/g, " "));
  await dlg.locator("[data-testid=mp-total-replace-search]").fill("CBM");
  await dlg.locator("[data-testid=mp-total-hit][data-codigo='CBM-WTM']").waitFor({ timeout: 15_000 });
  check("B: también busca por código y entre TODO el inventario (no solo sugerencias de la IA)", (await dlg.locator("[data-testid=mp-total-hit]").count()) >= 1);
  await dlg.locator("[data-testid=mp-total-replace-search]").fill("emulcare");
  await dlg.locator("[data-testid=mp-total-hit][data-codigo='MP023-WTM']").click();
  check("B: al elegir muestra el resumen del reemplazo con kg y stock", /EMULSIONANTE X WTM/.test(await dlg.locator("[data-testid=mp-total-replace-summary]").innerText()) && /MP023-WTM/.test(await dlg.locator("[data-testid=mp-total-replace-summary]").innerText()));
  await p.screenshot({ path: `${OUT}/1-buscar-coincidencia.png` });
  await dlg.locator("[data-testid=mp-total-replace-confirm]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  await rowBy(p, REAL).first().waitFor({ timeout: 30_000 });
  check("B: EMULSIONANTE X desaparece y la fila pasa a EMULCARE EI", (await rowBy(p, EMX).count()) === 0 && (await rowBy(p, REAL).count()) === 1);
  const rr = rowBy(p, REAL);
  check("B: mantiene los 10 kg necesarios y usa el stock de EMULCARE (20 kg): faltante 0", /\b10\b/.test(await rr.locator("[data-testid=mp-total-necesario]").innerText()) && /\b20\b/.test((await rr.innerText()).replace(/\s+/g, " ")) && /\b0\b/.test(await rr.locator("[data-testid=mp-total-faltante]").innerText()));
  check("B: la fila marca «reemplazo manual» y conserva la MP original en el detalle", (await rr.locator("[data-testid=mp-total-reemplazo-badge]").count()) === 1);
  await rr.click();
  const det = p.locator("[data-testid=mp-total-reemplazos]");
  await det.waitFor({ timeout: 10_000 });
  check("B: el detalle muestra la MP original (EMULSIONANTE X) con sus kg para trazabilidad", /EMULSIONANTE X WTM/.test(await det.innerText()));
  await p.screenshot({ path: `${OUT}/2-reemplazo-aplicado.png` });
  check("B: el reemplazo quedó guardado en la base", await waitDb(async () => (await q("select 1 from mp_weekly_total_replacements where target_code = 'MP023-WTM' and source_key like '%emulsionante x wtm%'")).length === 1));
  await p.reload();
  await openTotal(p);
  check("B: tras RECARGAR el reemplazo persiste (EMULCARE EI con 10 kg)", (await rowBy(p, REAL).count()) === 1 && (await rowBy(p, EMX).count()) === 0 && /\b10\b/.test(await rowBy(p, REAL).locator("[data-testid=mp-total-necesario]").innerText()));
  // Dos MP reemplazadas por la MISMA se consolidan
  await rowBy(p, ESP).locator("[data-testid=mp-total-buscar-coincidencia]").click();
  await dlg.waitFor({ timeout: 15_000 });
  await dlg.locator("[data-testid=mp-total-replace-search]").fill("emulcare ei");
  await dlg.locator("[data-testid=mp-total-hit][data-codigo='MP023-WTM']").click();
  await dlg.locator("[data-testid=mp-total-replace-confirm]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=mp-total-row]").length === 2, null, { timeout: 30_000 });
  check("B: dos MP reemplazadas por la misma se CONSOLIDAN en una fila (10 + 2 = 12 kg)", (await rowBy(p, REAL).count()) === 1 && /\b12\b/.test(await rowBy(p, REAL).locator("[data-testid=mp-total-necesario]").innerText()) && (await p.locator("[data-testid=mp-total-row]").count()) === 2);

  // ============ PRUEBA C — seleccionar y eliminar ============
  await p.locator("[data-testid=mp-total-select-all]").check();
  check("C: «seleccionar todas las visibles» marca todas y muestra la barra con el contador", (await p.locator("[data-testid=mp-total-selected-count]").innerText()) === "2 seleccionadas");
  await p.locator("[data-testid=mp-total-deselect-all]").click();
  check("C: «Deseleccionar todas» limpia la selección", (await p.locator("[data-testid=mp-total-selection-bar]").count()) === 0);
  await rowBy(p, GLI).locator("[data-testid=mp-total-select]").check();
  await rowBy(p, REAL).locator("[data-testid=mp-total-select]").check();
  check("C: se pueden seleccionar varias MP (2 seleccionadas)", (await p.locator("[data-testid=mp-total-selected-count]").innerText()) === "2 seleccionadas");
  await p.screenshot({ path: `${OUT}/3-seleccion.png` });
  await p.locator("[data-testid=mp-total-delete-selected]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=mp-total-row]").length === 0 || !document.querySelector("[data-testid=mp-total-row]"), null, { timeout: 30_000 }).catch(() => undefined);
  check("C: «Eliminar seleccionadas» quita las 2 filas del control", (await p.locator("[data-testid=mp-total-row]").count()) === 0);
  check("C: quedaron excluidas en la base", await waitDb(async () => (await q("select count(*)::int n from mp_weekly_row_state where row_key like 'T|%' and excluded = true"))[0].n === 2));
  await p.reload();
  await p.goto("/mi-trabajo");
  await nav(p, "Control semanal");
  await p.getByRole("button", { name: /^Control semanal total$/ }).click({ timeout: 60_000 });
  await p.locator("[data-testid=mp-total]").waitFor({ timeout: 120_000 });
  await p.locator("[data-testid=mp-total-resumen]").waitFor({ timeout: 120_000 });
  await p.waitForTimeout(1500);
  check("C: tras RECARGAR siguen excluidas (no vuelven a aparecer)", (await p.locator("[data-testid=mp-total-row]").count()) === 0);
  await p.locator("[data-testid=mp-total-ver-excluidas]").click();
  await p.locator("[data-testid=mp-total-excluidas]").waitFor({ timeout: 10_000 });
  check("C: «Ver excluidas» lista las 2 eliminadas", (await p.locator("[data-testid=mp-total-excluida]").count()) === 2);
  await p.screenshot({ path: `${OUT}/4-excluidas.png` });
  await p.locator("[data-testid=mp-total-excluida]").filter({ hasText: REAL }).locator("[data-testid=mp-total-restore]").click();
  await rowBy(p, REAL).first().waitFor({ timeout: 30_000 });
  check("C: restaurar una la devuelve al control (con su reemplazo y kg)", (await rowBy(p, REAL).count()) === 1 && /\b12\b/.test(await rowBy(p, REAL).locator("[data-testid=mp-total-necesario]").innerText()));
  await p.reload();
  await openTotal(p);
  check("C: la restaurada persiste tras recargar y la otra sigue excluida", (await rowBy(p, REAL).count()) === 1 && (await rowBy(p, GLI).count()) === 0);
  // Eliminación individual
  await rowBy(p, REAL).locator("[data-testid=mp-total-delete-one]").click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=mp-total-row]").length === 0, null, { timeout: 30_000 });
  check("C: eliminar una MP individualmente (botón de la fila) funciona", (await p.locator("[data-testid=mp-total-row]").count()) === 0);

  // ============ No se tocó nada maestro ============
  check("el inventario maestro no cambió", JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]) === inv0);
  check("las fórmulas y las OE/trabajos no se tocaron", (await q("select count(*)::int n from formula_ingredients where material_name in ($1,$2)", [EMX, ESP]))[0].n === ing0 && (await q("select count(*)::int n from work_items where product like '% WTM E2E' and deleted_at is null"))[0].n === 2);

  // ============ Permisos ============
  const ro = await openAs(E2E_USERS.produccion);
  const w = await ro.page.request.put("/api/v1/mp-control/weekly-total/note", { data: { week: monday, rowKey: "cod:X", observacion: "x" } });
  const rp = await ro.page.request.post("/api/v1/mp-control/weekly-total/replace", { data: { sourceKey: "cod:X", targetCode: "MP023-WTM" } });
  const ex = await ro.page.request.post("/api/v1/mp-control/weekly-total/exclude", { data: { week: monday, rows: [{ rowKey: "cod:X", label: "x" }] } });
  check("Producción solo consulta: observar, reemplazar y excluir se rechazan (403)", w.status() === 403 && rp.status() === 403 && ex.status() === 403, `${w.status()}/${rp.status()}/${ex.status()}`);
  await ro.ctx.close();
  await mp.ctx.close();
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
