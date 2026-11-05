// E2E en Chromium real: ENTREGAS PARCIALES de CODIFICADO → Producción con cajas (misma experiencia que Envasado). Base DESCARTABLE; logins reales.
// Codificado recibe 2.050 de Envasado y entrega 800 (8×100) + 600 (6×100) + 650 (6×100 + 1×50). Producción las ve por separado y prepara remitos.
import { randomUUID } from "node:crypto";
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
const OUT = process.env.OUT ?? "/tmp/codificado-entregas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CEP";
const CLI = "CLIENTE CEP SA";
const PROD = "SERUM CAPILAR CEP";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select id, sequence, quantity::float8 as quantity, status, packing_groups, source_sector, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const ids = {};

async function login(user, viewport = { width: 1500, height: 950 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const apiAs = async (user) => { const a = await pwRequest.newContext({ baseURL: BASE }); if ((await a.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error(`login ${user.email}`); return a; };
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const toListMode = async (pg) => { const t = pg.getByText("Ver como lista"); await pg.locator("[data-testid=os-table-mode-toggle]").first().waitFor({ timeout: 120_000 }).catch(() => undefined); if ((await t.count()) > 0) await t.first().click().catch(() => undefined); };
const num = (t) => Number(String(t).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

/** «Entregar parcial» desde el trabajo abierto en Codificado, con cajas (sin escribir la cantidad: el total sale de las cajas). */
async function partial(page, slots, { qty = null, obs = null } = {}) {
  await page.locator("[data-testid=codificado-deliver-partial]").click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  if (slots.length) {
    await dlg.locator("[data-testid=deliver-boxes-toggle]").click();
    for (const [i, [cajas, upc]] of slots.entries()) {
      await dlg.locator(`[data-testid=deliver-box-cajas-${i}]`).fill(String(cajas));
      await dlg.locator(`[data-testid=deliver-box-upc-${i}]`).fill(String(upc));
    }
  }
  if (qty != null) await dlg.locator("[data-testid=deliver-quantity]").fill(String(qty));
  if (obs) await dlg.locator("[data-testid=deliver-observations]").fill(obs);
  const totalText = slots.length ? (await dlg.locator("[data-testid=deliver-boxes-total]").innerText()).replace(/\s+/g, " ") : "";
  const balance = (await dlg.locator("[data-testid=deliver-balance]").innerText()).replace(/\s+/g, " ");
  await dlg.locator("[data-testid=confirm-deliver]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG diálogo:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-300)));
  return { totalText, balance };
}

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  await q("update work_items set deleted_at = now() where parent_work_item_id in (select id from work_items where notes like $1) and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  const prodApi = await apiAs(E2E_USERS.produccion);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E codificado cajas" } })).json()).week.id;
  const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLI, plannedQuantity: "2000", unit: "un.", product: PROD, sector: "ENVASADO_MASIVO", line: "Línea 1", packagingLote: "L-CEP-01" } });
  if (r.status() !== 201) throw new Error(`crear: ${await r.text()}`);
  ids.parent = bare((await r.json()).item.id);
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await q("update work_items set finished_qty = '2050' where id = $1", [ids.parent]);
  const masApi = await apiAs(E2E_USERS.envasado);
  const codApi = await apiAs(E2E_USERS.codificado);
  const depApi = await apiAs(E2E_USERS.deposito);
  // Envasado entrega a Codificado 2.050 (800 + 800 + 450) con SUS cajas.
  for (const [qty, boxes] of [[800, [{ cajas: 8, unidadesPorCaja: 100 }]], [800, [{ cajas: 8, unidadesPorCaja: 100 }]], [450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]]]) {
    const t = await masApi.post(`/api/v1/work-items/${ids.parent}/codificado`, { data: { action: "transfer", quantity: qty, finishedQty: 2050, packingGroups: boxes, idempotencyKey: randomUUID() } });
    if (t.status() !== 200) throw new Error(`transfer: ${await t.text()}`);
  }
  ids.child = String((await q("select id from work_items where parent_work_item_id = $1 and deleted_at is null", [ids.parent]))[0].id);

  // ============ CODIFICADO: entregas parciales con cajas desde la pantalla ============
  const cod = await login(E2E_USERS.codificado);
  const c = cod.page;
  await c.getByRole("button", { name: /Ver como lista/ }).click({ timeout: 60_000 }).catch(() => undefined);
  await c.getByText(/Recibidas 2050 de/).first().waitFor({ timeout: 120_000 }).catch(async (e) => { await c.screenshot({ path: `${OUT}/debug-codificado.png` }); console.log("DEBUG:", (await c.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 700)); throw e; });
  await c.getByRole("button", { name: /^Abrir/ }).first().click();
  await c.locator("[data-testid=codificado-deliver-partial]").waitFor({ timeout: 30_000 });
  check("0) el trabajo de Codificado ofrece «Entregar parcial» además de «Entregar» (igual que Envasado)", (await c.locator("[data-testid=codificado-deliver]").count()) === 1);

  const a = await partial(c, [[8, 100]], { obs: "primera tanda" });
  check("1-2) 8 cajas × 100: el total se calcula solo (800 u.) y el diálogo muestra el saldo (recibidas 2.050)", /8 cajas · 800 u\./.test(a.totalText) && /2\.?050/.test(a.balance), `${a.totalText} | ${a.balance}`);
  check("   se registra UNA entrega de 800 con 8 × 100, origen Codificado (el doble clic no duplica)", await waitDb(async () => (await lines(ids.child)).length === 1) && (await lines(ids.child))[0].quantity === 800 && (await lines(ids.child))[0].source_sector === "CODIFICADO" && JSON.stringify((await lines(ids.child))[0].packing_groups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }]) && (await lines(ids.child))[0].observations === "primera tanda");
  await c.locator("[data-testid=wd-list]").waitFor({ timeout: 30_000 });
  await partial(c, [[6, 100]]);
  await c.locator("[data-testid=wd-row]").nth(1).waitFor({ timeout: 30_000 });
  const mid = (await c.locator("[data-testid=wd-total]").innerText()).replace(/\s+/g, " ");
  check("4) con el trabajo abierto, Codificado consulta sus entregas anteriores una por una y el total acumulado (1.400 u. en 14 cajas · 2 entregas)", (await c.locator("[data-testid=wd-row]").count()) === 2 && /1\.400 u\. en 14 cajas/.test(mid) && /2 entregas/.test(mid), mid);
  await c.screenshot({ path: `${OUT}/1-codificado-entregas.png` });
  const b3 = await partial(c, [[6, 100], [1, 50]]);
  check("   cajas incompletas: 6 × 100 + 1 × 50 = 650 u. en 7 cajas", /7 cajas · 650 u\./.test(b3.totalText), b3.totalText);
  const ls = await lines(ids.child);
  check("3) tres entregas independientes (800 + 600 + 650 = 2.050), cada una con su desglose", ls.length === 3 && ls.map((l) => l.quantity).join() === "800,600,650" && JSON.stringify(ls[2].packing_groups) === JSON.stringify([{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]));
  const done = (await q("select operational_status from work_items where id = $1", [ids.child]))[0].operational_status;
  check("   al completar lo recibido (2.050 > 2.000 pedidas) el trabajo queda entregado y no hubo bloqueo por superar lo solicitado", done === "entregado");

  // entrega sin cajas / validación de diferencias (otro trabajo no hace falta: se prueba por API en el trabajo completo)
  const over = await codApi.post(`/api/v1/work-items/${ids.child}/codificado`, { data: { action: "deliver", deliverQuantity: 10, idempotencyKey: `${randomUUID()}-x`, deliveryPackingGroups: null } });
  check("5) sin unidades recibidas pendientes no se puede seguir entregando (400)", over.status() === 400, String(over.status()));
  await cod.ctx.close();

  // ============ PRODUCCIÓN recibe cada entrega por separado y prepara remitos ============
  const pr = await login(E2E_USERS.produccion);
  const pp = pr.page;
  await nav(pp, "Entregados");
  await toListMode(pp);
  const row = pp.locator("tr, [role=row], .dsg-row").filter({ hasText: PROD }).first();
  await row.waitFor({ timeout: 120_000 });
  await row.getByRole("button", { name: /Ver detalle/ }).click();
  const tbl = pp.locator("[data-testid=received-deliveries]");
  await tbl.waitFor({ timeout: 30_000 });
  await tbl.locator("[data-testid=rdt-row]").nth(2).waitFor({ timeout: 30_000 });
  const rows = await tbl.locator("[data-testid=rdt-row]").evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ")));
  check("6) Producción ve cada entrega por separado, de origen Codificado, con su embalaje", rows.length === 3 && rows.every((t) => /Codificado/.test(t)) && /8 cajas de 100/.test(rows[0]) && /6 cajas de 100 u\. \+ 1 caja de 50/.test(rows[2]), rows.map((t) => t.slice(0, 90)).join(" || "));
  const totals = (await tbl.locator("[data-testid=rdt-totals]").innerText()).replace(/\s+/g, " ");
  check("   total recibido 2.050 u. en 21 cajas, remitido 0, disponible 2.050 (no se duplican las cajas de Envasado)", /2\.050 u\. en 21 cajas/.test(totals) && /Total remitido: 0/.test(totals), totals);
  await pp.screenshot({ path: `${OUT}/2-produccion-recibe.png` });
  // Preparar remito de la 1.ª entrega desde la pantalla
  await tbl.locator("[data-testid=rdt-prepare]").first().click();
  const dlg = pp.locator("[data-testid=prepare-remito-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=pr-confirm]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG prepare:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-300)));
  const remLines = (lineId) => q("select rl.total_units::float8 as units, rl.cajas1, rl.unidades1 from remito_lines rl join remitos r on r.id = rl.remito_id where rl.work_item_id like $1 and r.status <> 'ANULADO'", [`dl:${lineId}%`]);
  check("7) «Preparar remito» de la entrega de 800: un solo remito con 800 u. y 8 × 100 (sin duplicar por el doble clic)", await waitDb(async () => (await remLines(String(ls[0].id))).length === 1) && Number((await remLines(String(ls[0].id)))[0].units) === 800 && Number((await remLines(String(ls[0].id)))[0].cajas1) === 8);
  const second = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: String(ls[1].id) } });
  check("8) otro remito de otra entrega del mismo trabajo (600 u. en 6 cajas); la primera no se vuelve a ofrecer", second.status() === 201 && Number((await remLines(String(ls[1].id)))[0].cajas1) === 6 && (await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: String(ls[0].id) } })).status() === 400);
  await pr.ctx.close();

  // ============ Edición / cancelación / permisos (módulo «Entregas internas») ============
  const edit = await codApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: String(ls[2].id), quantity: 640, packingGroups: [{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 40 }], observations: "una caja con 40" } });
  check("9) Codificado edita unidades, cajas y observación de su propia entrega (aún sin remito)", edit.status() === 200 && (await lines(ids.child))[2].quantity === 640 && (await lines(ids.child))[2].observations === "una caja con 40", String(edit.status()));
  const blocked = await codApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: String(ls[0].id), quantity: 700, packingGroups: [{ cajas: 7, unidadesPorCaja: 100 }] } });
  check("10) una entrega con remito vigente NO se modifica en silencio (400 con la instrucción de anular el remito)", blocked.status() === 400 && /ya figuran en el remito/.test((await blocked.json()).error ?? ""));
  const cancel = await codApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: String(ls[2].id), reason: "prueba E2E" } });
  const after = await lines(ids.child);
  check("11) Codificado cancela una entrega suya: deja de sumar (queda en el historial como ANULADA)", cancel.status() === 200 && after[2].status === "ANULADA" && after.filter((l) => l.status === "ACTIVA").reduce((s, l) => s + l.quantity, 0) === 1400);
  const f1 = await masApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: String(ls[1].id), observations: "x" } });
  const f2 = await depApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: String(ls[1].id), reason: "x" } });
  const f3 = await masApi.post(`/api/v1/work-items/${ids.child}/codificado`, { data: { action: "deliver", deliverQuantity: 10, idempotencyKey: `${randomUUID()}-y` } });
  check("12) Envasado no edita entregas de Codificado (403), Depósito no tiene acceso (403) y Envasado no entrega desde Codificado (403)", f1.status() === 403 && f2.status() === 403 && f3.status() === 403, `${f1.status()}/${f2.status()}/${f3.status()}`);

  // ============ Persistencia y sincronización tras recargar ============
  const cod2 = await login(E2E_USERS.codificado);
  const c2 = cod2.page;
  await c2.getByRole("button", { name: /Ver como lista/ }).click({ timeout: 60_000 }).catch(() => undefined);
  await nav(c2, "Entregados").catch(() => undefined);
  await c2.getByRole("tab", { name: /Entregad/ }).click({ timeout: 5_000 }).catch(() => undefined);
  await c2.getByRole("button", { name: /^Abrir/ }).first().click({ timeout: 60_000 });
  await c2.locator("[data-testid=wd-list]").waitFor({ timeout: 30_000 });
  const rowsAfter = await c2.locator("[data-testid=wd-row]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-status"), e.textContent.replace(/\s+/g, " ")]));
  const t2 = (await c2.locator("[data-testid=wd-total]").innerText()).replace(/\s+/g, " ");
  check("13) tras recargar Codificado ve las 3 entregas (la cancelada marcada) y el total activo 1.400 u. en 14 cajas", rowsAfter.length === 3 && rowsAfter.filter((x) => x[0] === "CANCELADA").length === 1 && /1\.400 u\. en 14 cajas/.test(t2), t2);
  await c2.screenshot({ path: `${OUT}/3-codificado-recargado.png` });
  await cod2.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await q("update work_items set deleted_at = now() where parent_work_item_id in (select id from work_items where notes like $1) and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
