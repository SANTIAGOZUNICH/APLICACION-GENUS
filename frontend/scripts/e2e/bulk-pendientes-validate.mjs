// E2E en Chromium real, resolución de TABLET: selección múltiple y acciones masivas en «Pendientes de definir».
// Base DESCARTABLE (marca verificada), login real, planificación nativa. Ver run-bulk-pendientes-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/bulk-pendientes";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const TAG = "E2E-BULK";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const row = async (id) => (await q("select * from work_items where id = $1", [bare(id)]))[0];

async function seed() {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  // el resto de «pendientes» de otros E2E no debe interferir con la lista
  await q("update work_items set operational_status = 'en_curso' where operational_status = 'revision' and notes not like $1", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const login = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (login.status() !== 200) throw new Error(`login: ${await login.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E bulk" } })).json()).week.id;
  const ids = {};
  const create = async (key, data) => {
    const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: "CLIENTE BULK SA", plannedQuantity: "120", unit: "un", ...data } });
    if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
    ids[key] = `native:${(await res.json()).item.id}`;
  };
  for (const k of ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2"]) {
    await create(k, { product: `PRODUCTO ${k.toUpperCase()} E2E`, sector: "ENVASADO_MASIVO", line: "Línea 1" });
  }
  await create("elab", { product: "CREMA ELAB E2E", sector: "ELABORACION", branchOwner: "Cristian", unit: "kg" });
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  for (const id of Object.values(ids)) {
    await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [bare(id)]);
  }
  await api.dispose();
  return ids;
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const debugPages = [];
async function openAs(user, viewport) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, hasTouch: true });
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
const rowOf = (page, product) => page.locator("[data-testid=pendiente-row]", { hasText: product }).first();

/** Compone un rgba() sobre el fondo oscuro de GENUS y devuelve luminancia relativa (0 = negro, 1 = blanco). */
function parseRgba(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
}
function lum({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) });
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

async function runAt(viewport, tag) {
  const ids = await seed();
  const { ctx, page } = await openAs(E2E_USERS.produccion, viewport);
  await nav(page, "Pendientes de definir");
  await page.waitForSelector("[data-testid=pendiente-row]", { timeout: 120_000 });
  const total = await page.locator("[data-testid=pendiente-row]").count();
  check(`[${tag}] la tabla lista los pendientes con checkbox por fila y en el encabezado`, (await page.locator("[data-testid=bulk-select-row]").count()) === total && (await page.locator("[data-testid=bulk-select-all]").count()) === 1, `${total} filas`);
  check(`[${tag}] sin selección no hay barra de acciones`, (await page.locator("[data-testid=bulk-bar]").count()) === 0);

  // --- estilos reales de la fila antes/después de seleccionar ---
  const r1 = rowOf(page, "PRODUCTO A1 E2E");
  const before = await r1.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el.querySelector("td:nth-child(2) .font-medium") ?? el).color, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }));
  await page.screenshot({ path: `${OUT}/${tag}-1-sin-seleccion.png` });
  await r1.locator("[data-testid=bulk-select-row]").click();
  await rowOf(page, "PRODUCTO A2 E2E").locator("[data-testid=bulk-select-row]").click();
  const after = await r1.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el.querySelector("td:nth-child(2) .font-medium") ?? el).color, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, shadow: getComputedStyle(el.querySelector("td")).boxShadow }));
  const bodyBg = parseRgba(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) ?? { r: 10, g: 29, b: 41, a: 1 };
  const base = { r: 10, g: 29, b: 41 }; // --genus-surface-bg
  const sel = parseRgba(after.bg);
  const composed = sel ? over(sel, base) : base;
  const text = parseRgba(after.color);
  check(`[${tag}] fila seleccionada: fondo translúcido turquesa (no blanco / no claro)`, sel && sel.a > 0 && sel.a <= 0.3 && lum(composed) < 0.12 && !(sel.r > 200 && sel.g > 200 && sel.b > 200), `${after.bg} → luminancia ${lum(composed).toFixed(3)} (body ${bodyBg.r},${bodyBg.g},${bodyBg.b})`);
  check(`[${tag}] el texto conserva su color y su contraste (≥ 7:1)`, before.color === after.color && text && contrast(text, composed) >= 7, `${after.color} contraste ${text ? contrast(text, composed).toFixed(1) : "?"}`);
  check(`[${tag}] no cambia el alto ni el ancho de la fila`, Math.abs(before.h - after.h) < 0.5 && Math.abs(before.w - after.w) < 0.5, `${before.h}→${after.h}px`);
  check(`[${tag}] borde lateral fino en la fila seleccionada`, /rgb/.test(after.shadow) && after.shadow !== "none", after.shadow);
  const btn = await page.locator("[data-testid=pendiente-action-REHACER]").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check(`[${tag}] no se alteran los botones de acciones individuales`, !!btn);

  // --- barra: contador, alcance, cuatro botones, sin tapar encabezados ---
  const bar = page.locator("[data-testid=bulk-bar]");
  check(`[${tag}] contador «2 registros seleccionados» y alcance a lo visible`, (await page.locator("[data-testid=bulk-count]").innerText()) === "2 registros seleccionados" && /visibles/.test(await page.locator("[data-testid=bulk-scope]").innerText()));
  const labels = await Promise.all(["bulk-deliver", "bulk-codificado", "bulk-delete", "bulk-clear"].map((t) => page.locator(`[data-testid=${t}]`).innerText()));
  check(`[${tag}] la barra ofrece las tres acciones y Deseleccionar`, labels.join("|") === "Marcar como entregados (2)|Enviar a Codificado (2)|Eliminar seleccionados (2)|Deseleccionar", labels.join("|"));
  // arriba de todo: el flujo normal (la barra es sticky y, con scroll, flota sobre las filas — nunca sobre el encabezado en reposo)
  await page.evaluate(() => {
    let el = document.querySelector("[data-testid=bulk-bar]");
    while (el) { const o = getComputedStyle(el).overflowY; if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = 0; el = el.parentElement; }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
  const bb = await bar.boundingBox();
  const hb = await page.locator("[data-testid=pendientes-table] thead").boundingBox();
  check(`[${tag}] la barra no tapa los encabezados ni los registros`, bb.y + bb.height <= hb.y + 1, `barra termina en ${Math.round(bb.y + bb.height)}, encabezado en ${Math.round(hb.y)}`);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`[${tag}] sin scroll horizontal de página`, noHScroll);
  const bigTouch = await page.locator("[data-testid=bulk-select-row]").first().evaluate((el) => { const b = el.closest("label").getBoundingClientRect(); return Math.min(b.width, b.height); });
  check(`[${tag}] checkbox con área táctil cómoda (≥ 36 px)`, bigTouch >= 36, `${bigTouch}px`);
  await page.screenshot({ path: `${OUT}/${tag}-2-seleccion.png` });

  // --- seleccionar todos / deseleccionar ---
  await page.locator("[data-testid=bulk-select-all]").click();
  check(`[${tag}] seleccionar todos los visibles`, (await page.locator("[data-testid=bulk-count]").innerText()) === `${total} registros seleccionados`);
  await page.locator("[data-testid=bulk-clear]").click();
  check(`[${tag}] deseleccionar limpia la selección`, (await page.locator("[data-testid=bulk-bar]").count()) === 0);
  return { ids, ctx, page };
}

try {
  // ====== TABLET Android horizontal ======
  let { ids, ctx, page } = await runAt({ width: 1280, height: 800 }, "tablet-h");

  // --- MARCAR COMO ENTREGADOS: A1, A2 + Elaboración (no elegible) ---
  for (const p of ["PRODUCTO A1 E2E", "PRODUCTO A2 E2E", "CREMA ELAB E2E"]) await rowOf(page, p).locator("[data-testid=bulk-select-row]").click();
  await page.locator("[data-testid=bulk-deliver]").click();
  await page.locator("[data-testid=bulk-action-included]").waitFor({ timeout: 30_000 });
  check("entregar: el modal separa los elegibles del no elegible con su motivo", /A1/.test(await page.locator("[data-testid=bulk-action-included]").innerText()) && /CREMA ELAB E2E/.test(await page.locator("[data-testid=bulk-action-excluded]").innerText()) && /no está disponible/i.test(await page.locator("[data-testid=bulk-action-excluded]").innerText()));
  check("entregar: ver el modal no cambia nada en la base", (await row(ids.a1)).operational_status === "revision");
  await page.screenshot({ path: `${OUT}/tablet-h-3-modal-entregar.png` });
  await page.locator("[data-testid=bulk-deliver-remito]").fill("R-E2E-1");
  await page.locator("[data-testid=bulk-deliver-received]").fill("Recepción E2E");
  await page.locator("[data-testid=bulk-action-confirm]").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=pendiente-row]").length > 0 && ![...document.querySelectorAll("[data-testid=pendiente-row]")].some((r) => r.textContent.includes("PRODUCTO A1 E2E")), null, { timeout: 60_000 });
  check("entregar: la tabla se actualiza sola y quedan fuera los entregados", (await rowOf(page, "PRODUCTO A1 E2E").count()) === 0 && (await rowOf(page, "CREMA ELAB E2E").count()) === 1);
  const dA1 = (await q("select * from work_item_deliveries where work_item_id = $1", [bare(ids.a1)]))[0];
  check("entregar: A1 y A2 quedaron ENTREGADOS en la base con entrega, remito, línea y auditoría", (await row(ids.a1)).operational_status === "entregado" && (await row(ids.a2)).operational_status === "entregado" && dA1?.status === "ENTREGADO" && dA1?.remito === "R-E2E-1" && (await q("select 1 from work_item_delivery_lines where work_item_id = $1", [bare(ids.a2)])).length === 1 && (await q("select 1 from feature_audit_events where action = 'BULK_DELIVER'")).length >= 1);
  check("entregar: el no elegible no cambió", (await row(ids.elab)).operational_status === "revision");

  // --- ENVIAR A CODIFICADO: B1, B2 ---
  for (const p of ["PRODUCTO B1 E2E", "PRODUCTO B2 E2E"]) await rowOf(page, p).locator("[data-testid=bulk-select-row]").click();
  await page.locator("[data-testid=bulk-codificado]").click();
  await page.locator("[data-testid=bulk-action-included]").waitFor({ timeout: 30_000 });
  check("codificado: el modal propone la cantidad total editable por trabajo", (await page.locator("[data-testid=bulk-action-total]").count()) === 2 && (await page.locator("[data-testid=bulk-action-total]").first().inputValue()) === "120");
  await page.screenshot({ path: `${OUT}/tablet-h-4-modal-codificado.png` });
  await page.locator("[data-testid=bulk-action-confirm]").click();
  await page.waitForFunction(() => ![...document.querySelectorAll("[data-testid=pendiente-row]")].some((r) => r.textContent.includes("PRODUCTO B1 E2E")), null, { timeout: 60_000 });
  const b1 = await row(ids.b1);
  check("codificado: B1 y B2 quedaron en el sector Codificado con historial", b1.sector === "CODIFICADO" && b1.via_codificado === true && (await row(ids.b2)).sector === "CODIFICADO" && (await q("select 1 from operational_events where work_item_id = $1 and type = 'SENT_TO_CODIFICADO'", [bare(ids.b2)])).length === 1);

  // --- ELIMINAR: C1, C2 (cancelar primero) ---
  for (const p of ["PRODUCTO C1 E2E", "PRODUCTO C2 E2E"]) await rowOf(page, p).locator("[data-testid=bulk-select-row]").click();
  await page.locator("[data-testid=bulk-delete]").click();
  await page.locator("[data-testid=bulk-delete-included]").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/tablet-h-5-modal-eliminar.png` });
  await page.locator("[data-testid=bulk-delete-cancel]").click();
  check("eliminar: cancelar no elimina nada", (await row(ids.c1)).deleted_at === null && (await row(ids.c2)).deleted_at === null);
  await page.locator("[data-testid=bulk-delete]").click();
  await page.locator("[data-testid=bulk-delete-included]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=bulk-delete-reason]").fill("Duplicados E2E");
  await page.locator("[data-testid=bulk-delete-confirm]").click();
  await page.waitForFunction(() => ![...document.querySelectorAll("[data-testid=pendiente-row]")].some((r) => r.textContent.includes("PRODUCTO C1 E2E")), null, { timeout: 60_000 });
  check("eliminar: C1 y C2 quedaron eliminados (lógico) con motivo y auditoría", (await row(ids.c1)).deleted_at !== null && (await row(ids.c2)).delete_reason === "Duplicados E2E" && (await q("select 1 from feature_audit_events where action = 'BULK_DELETE'")).length >= 1);
  check("eliminar: los entregados no se tocaron (siguen entregados, no eliminados)", (await row(ids.a1)).deleted_at === null && (await row(ids.a1)).operational_status === "entregado");
  await page.screenshot({ path: `${OUT}/tablet-h-6-final.png` });
  await ctx.close();

  // ====== TABLET vertical (portrait) y notebook ======
  for (const [vp, tag] of [[{ width: 800, height: 1280 }, "tablet-v"], [{ width: 1440, height: 900 }, "desktop"]]) {
    const r = await runAt(vp, tag);
    await r.ctx.close();
  }

  // ====== Backend: otros sectores no pueden ======
  const seeded = await seed();
  const op = await openAs(E2E_USERS.envasado, { width: 1180, height: 820 });
  const bodyDeliver = { action: "DELIVER", items: [{ id: seeded.a3 }], batchKey: "e2e-denied-1234", delivery: { actualDeliveredAt: new Date().toISOString() } };
  const d1 = await op.page.request.post("/api/v1/work-items/bulk-action", { data: bodyDeliver });
  const d2 = await op.page.request.post("/api/v1/work-items/bulk-action", { data: { ...bodyDeliver, action: "SEND_CODIFICADO" } });
  const d3 = await op.page.request.post("/api/v1/work-items/bulk-delete", { data: { ids: [seeded.a3], reason: "intento", batchKey: "e2e-denied-1234" } });
  check("servidor: un operario de Envasado recibe 403 en entregar / Codificado / eliminar masivo", [d1.status(), d2.status(), d3.status()].every((s) => s === 403), `${d1.status()}/${d2.status()}/${d3.status()}`);
  check("servidor: nada cambió por los intentos", (await row(seeded.a3)).operational_status === "revision" && (await row(seeded.a3)).deleted_at === null);
  await op.ctx.close();
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
