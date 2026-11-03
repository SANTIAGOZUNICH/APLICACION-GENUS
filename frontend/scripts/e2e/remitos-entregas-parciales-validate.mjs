// E2E en Chromium real: CAJAS en entregas parciales (Envasado/Codificado) + «Editar trabajo entregado» (Producción → Entregados) + remitos.
// Base DESCARTABLE; logins reales. Ver run-entregas-cajas-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/remitos-parciales";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-RPAR";
const CLI = "AQUALO E2E RPAR";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select id, sequence, quantity, status, packing_groups, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const transfers = (id) => q("select id, seq, quantity, status, packing_groups from work_item_codificado_transfers where work_item_id = $1 order by seq", [id]);
const agg = async (id) => (await q("select quantity, packing_groups from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [id]))[0];
const planned = async (id) => (await q("select planned_quantity, operational_status from work_items where id = $1", [id]))[0];
const ids = {};
const P = { A: "SERUM CAPILAR RPAR-A" };

async function login(user, viewport = { width: 1500, height: 900 }) {
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
const card = (page, product) => page.locator("[data-testid=work-item-card]", { hasText: product }).first();
const num = (t) => Number(String(t).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
const toListMode = async (pg) => { const t = pg.getByText("Ver como lista"); await pg.locator("[data-testid=os-table-mode-toggle]").first().waitFor({ timeout: 120_000 }); if ((await t.count()) > 0) await t.first().click(); };


const deliver = (api, id, qty, boxes, sector) => api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${id}`, actorSectorId: sector, deliverQuantity: qty, partial: true, packingGroups: boxes, idempotencyKey: `rpar-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: sector, product: "" } });
const remLines = (lineId) => q("select rl.total_units, r.status, rl.work_item_id from remito_lines rl join remitos r on r.id = rl.remito_id where rl.work_item_id like $1 and r.status <> 'ANULADO' order by rl.created_at", [`dl:${lineId}%`]);
try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E remitos" } })).json()).week.id;
  const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLI, plannedQuantity: "1500", unit: "un.", product: P.A, sector: "ENVASADO_MASIVO", line: "Línea 1", packagingLote: "L-RPAR" } });
  if (r.status() !== 201) throw new Error(`crear: ${await r.text()}`);
  ids.A = bare((await r.json()).item.id);
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await q("update work_items set finished_qty = '1850' where id = $1", [ids.A]);
  const masApi = await apiAs(E2E_USERS.envasado);
  const depApi = await apiAs(E2E_USERS.deposito);
  check("1) tres entregas parciales (800 en 8, 600 en 6, 450 = 4×100+1×50) con entregas > solicitado (1.850 de 1.500)",
    (await deliver(masApi, ids.A, 800, [{ cajas: 8, unidadesPorCaja: 100 }], "ENVASADO_MASIVO")).status() === 200
    && (await deliver(masApi, ids.A, 600, [{ cajas: 6, unidadesPorCaja: 100 }], "ENVASADO_MASIVO")).status() === 200
    && (await deliver(masApi, ids.A, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], "ENVASADO_MASIVO")).status() === 200);
  const ls = await q("select id, quantity from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [ids.A]);
  check("   quedan 3 renglones de entrega independientes", ls.map((l) => Number(l.quantity)).join() === "800,600,450");

  const pr = await login(E2E_USERS.produccion);
  const pp = pr.page;
  await nav(pp, "Entregados");
  await toListMode(pp);
  const rowOf = pp.locator("tr, [role=row], .dsg-row").filter({ hasText: P.A }).first();
  await rowOf.waitFor({ timeout: 120_000 });
  await rowOf.getByRole("button", { name: /Ver detalle/ }).click();
  const tbl = pp.locator("[data-testid=received-deliveries]");
  await tbl.waitFor({ timeout: 30_000 });
  await tbl.locator("[data-testid=rdt-row]").nth(2).waitFor({ timeout: 30_000 });
  const totals = (await tbl.locator("[data-testid=rdt-totals]").innerText()).replace(/\s+/g, " ");
  check("1) el detalle lista cada entrega y el total recibido 1.850 u. en 19 cajas; remitido 0; disponible 1.850", (await tbl.locator("[data-testid=rdt-row]").count()) === 3 && /1\.850/.test(totals) && /19/.test(totals), totals);
  await pp.screenshot({ path: `${OUT}/1-detalle-entregas.png` });

  // 2-3) preparar remito de la primera entrega (800 → solo 500) desde la pantalla
  await tbl.locator("[data-testid=rdt-prepare]").first().click();
  const dlg = pp.locator("[data-testid=prepare-remito-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=pr-qty]").fill("500");
  await dlg.locator("[data-testid=pr-confirm]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG dlg:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-300)));
  const l1 = String(ls[0].id);
  check("3) remito por PARTE de la entrega (500 de 800): un solo remito, doble clic sin duplicar", await waitDb(async () => (await remLines(l1)).length === 1) && Number((await remLines(l1))[0].total_units) === 500);
  const avail = await (await prodApi.get(`/api/v1/remitos/deliveries?workItemId=${ids.A}`)).json();
  const d1 = avail.deliveries.find((d) => d.deliveryLineId === l1);
  check("   saldo de esa entrega = 300 (recibidas 800, remitidas 500)", d1 && d1.remitted === 500 && d1.available === 300, JSON.stringify(d1 && [d1.delivered, d1.remitted, d1.available]));
  const over = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l1, quantity: 400, packingGroups: [{ cajas: 4, unidadesPorCaja: 100 }] } });
  check("4) no se puede remitir 400 cuando solo quedan 300 (400)", over.status() === 400 && /Solo quedan 300/.test((await over.json()).error ?? ""));
  const rest = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l1, quantity: 300, packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }] } });
  check("3) segundo remito por los 300 restantes con sus cajas", rest.status() === 201 && (await remLines(l1)).reduce((s, x) => s + Number(x.total_units), 0) === 800);
  const again = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l1, quantity: 1 } });
  check("4) con la entrega completa en remitos vigentes ya no se ofrece (400)", again.status() === 400);

  // 2) remito de la entrega 2 completa, usando sus cajas
  const l2 = String(ls[1].id);
  const whole = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l2 } });
  check("2) remito de la entrega de 600 completa con sus 6 × 100", whole.status() === 201 && Number((await remLines(l2))[0].total_units) === 600);

  // 7) corrección incompatible
  const edit = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: l2, quantity: 500 } });
  check("7) bajar de 600 a 500 una entrega con remito vigente se bloquea (400)", edit.status() === 400 && /remito/i.test((await edit.json()).error ?? ""));
  const cancel = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: l2, reason: "prueba" } });
  check("7) cancelarla también (400)", cancel.status() === 400);
  // 6) entrega aún no remitida se corrige
  const l3 = String(ls[2].id);
  const ok = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: l3, observations: "recontada" } });
  check("6) una entrega todavía no remitida se corrige sin problemas", ok.status() === 200);

  // 13) permisos
  const f1 = await depApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l3 } });
  const f2 = await masApi.post("/api/v1/remitos/deliveries", { data: { action: "prepare", lineId: l3 } });
  check("13) Depósito y Envasado no preparan remitos (403)", f1.status() === 403 && f2.status() === 403, `${f1.status()}/${f2.status()}`);

  // 16) sincronización: recargar y ver 1.850 recibido / remitido 1.400 / disponible 450
  await pp.reload();
  await nav(pp, "Entregados");
  await toListMode(pp);
  await rowOf.waitFor({ timeout: 120_000 });
  await rowOf.getByRole("button", { name: /Ver detalle/ }).click();
  await tbl.waitFor({ timeout: 30_000 });
  await tbl.locator("[data-testid=rdt-row]").nth(2).waitFor({ timeout: 30_000 });
  const t2 = (await tbl.locator("[data-testid=rdt-totals]").innerText()).replace(/\s+/g, " ");
  check("16) tras recargar: recibido 1.850, remitido 1.400, disponible 450 (nunca se confunde recibido con remitido)", /1\.850/.test(t2) && /1\.400/.test(t2) && /450/.test(t2), t2);
  await pp.screenshot({ path: `${OUT}/2-detalle-tras-remitos.png` });
  await pr.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
