// E2E en Chromium real: Control de ME + alerta persistente en Depósito. Base DESCARTABLE; logins reales.
import { randomUUID } from "node:crypto";
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
const OUT = process.env.OUT ?? "/tmp/me-control";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "E2E MC AQUALO";
const PROD = "SERUM CAPILAR";
const T = "2026-10-01T10:00:00.000Z";

// Lunes de dentro de 2 semanas (dentro del horizonte automático) y martes de esa semana como fecha del trabajo.
const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 14); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d; })();
const iso = (d) => d.toISOString().slice(0, 10);
const WEEK = iso(monday);
const JOB_DAY = iso(new Date(monday.getTime() + 86_400_000));
const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

const cleanup = async () => {
  await q("delete from me_control_alerts where client like 'E2E MC%'").catch(() => undefined);
  await q("delete from me_product_materials where client like 'E2E MC%'").catch(() => undefined);
  await q("delete from me_material_compat where base_codigo like 'E2E-MC-%' or accessory_codigo like 'E2E-MC-%'").catch(() => undefined);
  const wi = (await q("select id from work_items where client like 'E2E MC%'")).map((r) => String(r.id));
  if (wi.length) {
    await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => undefined);
    for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => undefined);
    await q("delete from work_items where id = any($1::uuid[])", [wi]).catch(() => undefined);
  }
  for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'E2E-MC-%'`).catch(() => undefined);
};
const meCounts = async () => JSON.stringify({ i: (await q("select count(*)::int n from inv_me_ingresos"))[0].n, s: (await q("select count(*)::int n from inv_me_salidas"))[0].n, a: (await q("select count(*)::int n from inv_ajustes"))[0].n });
const seedMat = (codigo, descripcion) => q("insert into inv_me_materials (id, payload) values (gen_random_uuid(), $1)", [{ id: randomUUID(), codigo, descripcion, cliente: CLI, ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false }]);
const seedIng = (codigo, total) => q("insert into inv_me_ingresos (id, payload) values (gen_random_uuid(), $1)", [{ id: randomUUID(), fecha: "2026-10-01", ingresoNro: `E2E-${codigo}-${total}`, proveedor: "PROV E2E", cliente: CLI, remitoNro: "R", codigo, descripcionInsumo: codigo, bultos: 1, cantidad: total, total, ubicacion: "A1", materialId: null, anulado: false, createdBy: "e2e", updatedBy: "e2e", createdAt: T, updatedAt: T }]);

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const alertOf = (page) => page.locator("[data-testid=me-alert]").filter({ hasText: CLI });
const waitAlert = (page, re, timeout = 90_000) => page.waitForFunction(([cli, src]) => [...document.querySelectorAll("[data-testid=me-alert]")].some((a) => (a.textContent ?? "").includes(cli) && new RegExp(src).test(a.textContent ?? "")), [CLI, re.source], { timeout });

try {
  await cleanup();
  await seedMat("E2E-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
  await seedMat("E2E-MC-DROP", "Dropper Aqualo 30 ml");
  await seedMat("E2E-MC-ETIQ", "Etiqueta Aqualo Serum Capilar");
  await seedIng("E2E-MC-FRASCO", 1200);
  await seedIng("E2E-MC-ETIQ", 2500);

  const pr = await openAs(E2E_USERS.produccion);
  await pr.page.goto("/mi-trabajo");
  const dp = await openAs(E2E_USERS.deposito);
  const p = dp.page;
  await p.goto("/mi-trabajo");
  check("el menú de Depósito tiene la pestaña «Control de ME»", (await p.getByRole("button", { name: /^Control de ME$/ }).or(p.getByRole("link", { name: /^Control de ME$/ })).count()) >= 1);
  check("sin trabajos que revisar no hay alerta", (await alertOf(p).count()) === 0);

  // Producción programa 2.000 unidades de SERUM CAPILAR de AQUALO (Envasado Masivo). Nadie avisa a Depósito.
  const stockBefore = await meCounts();
  const asg = await pr.page.request.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: JOB_DAY, plannedDateTo: JOB_DAY, sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLI, product: PROD, plannedQuantity: "2000", idempotencyKey: randomUUID() } });
  check("Producción programa 2.000 unidades en Envasado", asg.ok(), `${asg.status()}`);

  await waitAlert(p, /no tiene materiales de empaque asociados/i);
  const a0 = alertOf(p);
  const t0 = await a0.innerText();
  check("la alerta aparece SOLA en Depósito (sin recargar) con cliente, producto, cantidad y semana", /FALTAN MATERIALES|REVISAR MATERIALES/.test(t0) && t0.includes(CLI) && t0.includes(PROD) && /2\.000 unidades/.test(t0) && t0.includes(dmy(WEEK)), t0.replace(/\s+/g, " ").slice(0, 160));
  check("producto sin materiales: pide REVISAR y no inventa faltantes", /REVISAR/.test(t0) && !/FALTAN:/.test(t0));
  await p.screenshot({ path: `${OUT}/1-alerta-sin-asociacion.png` });

  // «Ver detalle» abre el Control de ME en esa semana
  await a0.getByTestId("me-alert-detail").click();
  await p.locator("[data-testid=me-table]").waitFor({ timeout: 60_000 });
  check("«Ver detalle» abre el Control de ME en la semana del trabajo", (await p.locator("[data-testid=me-week-input]").inputValue()) === WEEK);
  check("la pantalla muestra el trabajo, su cantidad y el estado «Material sin identificar»", /Material sin identificar/.test(await p.locator("[data-testid=me-job]").filter({ hasText: CLI }).innerText()));

  // Asociar materiales: búsqueda libre en todo el inventario de ME
  await p.locator("[data-testid=me-config-open-empty]").first().click();
  await p.locator("[data-testid=me-config-panel]").waitFor();
  await p.locator("[data-testid=me-add]").click();
  await p.locator("[data-testid=me-search]").fill("frasco gotero");
  await p.locator("[data-testid=me-hit]").filter({ hasText: "E2E-MC-FRASCO" }).click();
  await p.locator("[data-testid=me-config-row]").filter({ hasText: "E2E-MC-FRASCO" }).waitFor({ timeout: 30_000 });
  check("Depósito asocia el frasco (búsqueda libre en el inventario de ME)", (await p.locator("[data-testid=me-config-row][data-status=CONFIRMADO]").filter({ hasText: "E2E-MC-FRASCO" }).count()) === 1);
  await p.keyboard.press("Escape");
  await p.locator("[data-testid=me-config-panel]").waitFor({ state: "detached" });

  // 1.200 frascos de 2.000 → faltan 800; y el dropper todavía no está identificado
  await waitAlert(p, /800/);
  const t1 = await alertOf(p).innerText();
  check("la alerta pasa a FALTAN 800 frascos goteros (necesario 2.000 · stock 1.200)", /FALTAN:/.test(t1) && /800/.test(t1) && /E2E-MC-FRASCO/.test(t1) && /necesario 2\.000/.test(t1) && /stock 1\.200/.test(t1), t1.replace(/\s+/g, " ").slice(0, 220));
  check("y avisa que falta identificar el dropper (REVISAR), con la necesidad estimada de 2.000", /REVISAR/.test(t1) && /Dispensador sin identificar|dropper|Dispensador/i.test(t1) && /2\.000/.test(t1) && /falta identificar el material exacto/.test(t1));

  // Agregar el dropper → faltan 2.000
  await p.locator("[data-testid=me-config-open]").first().click();
  await p.locator("[data-testid=me-add]").click();
  await p.locator("[data-testid=me-search]").fill("dropper");
  await p.locator("[data-testid=me-hit]").filter({ hasText: "E2E-MC-DROP" }).click();
  await p.locator("[data-testid=me-config-row]").filter({ hasText: "E2E-MC-DROP" }).waitFor({ timeout: 30_000 });
  await p.keyboard.press("Escape");
  await waitAlert(p, /2\.000 ×|2\.000 ×/);
  const t2 = await alertOf(p).innerText();
  check("resultado final: FALTAN 800 frascos goteros y 2.000 droppers", /800/.test(t2) && /E2E-MC-FRASCO/.test(t2) && /E2E-MC-DROP/.test(t2) && /2\.000/.test(t2) && !/sin identificar/.test(t2), t2.replace(/\s+/g, " ").slice(0, 260));
  await p.screenshot({ path: `${OUT}/2-alerta-faltantes.png` });

  // Tabla de control
  const lines = (await p.locator("[data-testid=me-line]").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
  check("el control muestra material, necesario, stock y faltante por línea", lines.some((l) => /E2E-MC-FRASCO.*2\.000.*1\.200.*800/.test(l)) && lines.some((l) => /E2E-MC-DROP.*2\.000.*0.*2\.000/.test(l)), lines.join(" | ").slice(0, 300));
  check("estado del trabajo: «Stock insuficiente»", /Stock insuficiente/.test(await p.locator("[data-testid=me-job-state]").first().innerText()));
  await p.screenshot({ path: `${OUT}/3-control-me.png`, fullPage: true });

  // La alerta persiste al recargar y al navegar
  await p.reload();
  await waitAlert(p, /800/, 60_000);
  check("la alerta sigue ahí después de RECARGAR la página (persistida en la base)", (await alertOf(p).count()) === 1);
  await nav(p, "Ingresos ME");
  await p.waitForTimeout(500);
  check("y es visible desde cualquier pantalla de Depósito", (await alertOf(p).count()) === 1);
  const dp2 = await openAs(E2E_USERS.deposito);
  await dp2.page.goto("/mi-trabajo");
  await waitAlert(dp2.page, /800/, 60_000);
  check("y también en otra sesión/dispositivo de Depósito", (await alertOf(dp2.page).count()) === 1);
  await dp2.ctx.close();

  // Cierre manual
  await alertOf(p).getByTestId("me-alert-close").click();
  await p.waitForFunction((cli) => ![...document.querySelectorAll("[data-testid=me-alert]")].some((a) => (a.textContent ?? "").includes(cli)), CLI, { timeout: 30_000 });
  const row = (await q("select status, closed_by, closed_at from me_control_alerts where client = $1", [CLI]))[0];
  check("«Cerrar notificación» la oculta y guarda quién y cuándo", row.status === "CERRADA" && row.closed_by === E2E_USERS.deposito.email && row.closed_at);
  await p.reload();
  await p.waitForTimeout(2500);
  check("cerrada, no vuelve al recargar", (await alertOf(p).count()) === 0);
  await nav(p, "Control de ME");
  await p.locator("[data-testid=me-week-input]").fill(WEEK);
  await p.locator("[data-testid=me-table]").waitFor({ timeout: 60_000 });
  const afterClose = (await p.locator("[data-testid=me-line]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | ");
  check("cerrar NO borra el faltante: el control sigue mostrando 800 y 2.000", /E2E-MC-FRASCO.*800/.test(afterClose) && /E2E-MC-DROP.*2\.000/.test(afterClose));

  // Nuevo trabajo del mismo producto → empeora → vuelve la alerta
  const asg2 = await pr.page.request.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: JOB_DAY, plannedDateTo: JOB_DAY, sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLI, product: PROD, plannedQuantity: "500", idempotencyKey: randomUUID() } });
  await waitAlert(p, /1\.300/, 90_000);
  check("un trabajo nuevo que agranda el faltante reabre la alerta (1.300 frascos)", asg2.ok() && (await alertOf(p).count()) === 1);
  check("sin duplicados: una sola alerta para el producto", (await q("select count(*)::int n from me_control_alerts where client = $1", [CLI]))[0].n === 1);

  // Recepción de material (movimiento real de inventario) → se resuelve sola
  await seedIng("E2E-MC-FRASCO", 1300);
  await seedIng("E2E-MC-DROP", 2500);
  await p.waitForFunction((cli) => ![...document.querySelectorAll("[data-testid=me-alert]")].some((a) => (a.textContent ?? "").includes(cli)), CLI, { timeout: 90_000 });
  check("al recibir los materiales la alerta desaparece sola", (await q("select status from me_control_alerts where client = $1", [CLI]))[0].status === "RESUELTA");

  // Permisos en el servidor
  const api = dp.page.request;
  const attempts = {
    "Depósito asigna un pedido a un sector (POST /work-assignments)": await api.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: JOB_DAY, plannedDateTo: JOB_DAY, sector: "ENVASADO_MASIVO", line: "Línea 1", client: `${CLI} HACK`, product: "X", plannedQuantity: "10", idempotencyKey: randomUUID() } }),
    "Depósito modifica la planificación (PATCH /work-items/cells)": await api.patch("/api/v1/work-items/cells", { data: { changes: [{ id: randomUUID(), field: "plannedQuantity", value: "1", expectedVersion: 1 }] } }),
  };
  for (const [name, r] of Object.entries(attempts)) check(`${name} → rechazado`, [401, 403].includes(r.status()), String(r.status()));
  check("no quedó ningún trabajo creado por Depósito", (await q("select count(*)::int n from work_items where client like 'E2E MC AQUALO HACK%'"))[0].n === 0);
  const prApi = pr.page.request;
  const prAdd = await prApi.post("/api/v1/me-control/products", { data: { client: CLI, product: PROD, materialCodigo: "E2E-MC-ETIQ" } });
  check("Producción no puede confirmar/editar asociaciones de ME (403)", prAdd.status() === 403, String(prAdd.status()));
  const alertId = (await q("select id from me_control_alerts where client = $1", [CLI]))[0].id;
  const prClose = await prApi.post(`/api/v1/me-control/alerts/${alertId}/close`, { data: {} });
  check("Producción no puede cerrar alertas de Depósito (403)", prClose.status() === 403, String(prClose.status()));
  const prList = await prApi.get("/api/v1/me-control/alerts");
  check("Producción SÍ puede consultar las alertas (200)", prList.status() === 200);
  const prRep = await prApi.get(`/api/v1/me-control?week=${WEEK}`);
  check("Producción SÍ puede consultar el control semanal (200)", prRep.status() === 200 && (await prRep.json()).jobs.length >= 2);
  check("Producción no recibe el banner de Depósito", (await pr.page.locator("[data-testid=me-alert-banner]").count()) === 0);
  const cal = await openAs(E2E_USERS.calidad);
  const calList = await cal.page.request.get("/api/v1/me-control/alerts");
  check("Calidad no puede consultar el Control de ME (403)", calList.status() === 403, String(calList.status()));
  await cal.ctx.close();
  const dpAdd = await api.post("/api/v1/me-control/products", { data: { client: CLI, product: PROD, materialCodigo: "E2E-MC-ETIQ", qtyPerUnit: 1 } });
  check("Depósito SÍ puede confirmar materiales (201)", dpAdd.status() === 201, String(dpAdd.status()));

  // Ningún movimiento de stock salió de planificar / configurar / cerrar
  check("planificar, configurar y cerrar alertas no generó ningún movimiento de stock", (await meCounts()) === JSON.stringify({ i: JSON.parse(stockBefore).i + 2, s: JSON.parse(stockBefore).s, a: JSON.parse(stockBefore).a }) );

  await pr.ctx.close();
  await dp.ctx.close();
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
