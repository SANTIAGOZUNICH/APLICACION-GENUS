// E2E (Chromium, TABLET): programar la MISMA OA en varios días. Base DESCARTABLE; login real.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/programaciones";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const tablet = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 };
const TAG = "E2E-PRG";
const PRODUCT = "CREMA FACIAL PRG E2E";
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const OA = `OA-2026-${String(950000 + Math.floor(Math.random() * 40000)).padStart(6, "0")}`;

async function login(user) {
  const ctx = await browser.newContext({ baseURL: BASE, ...tablet });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const cardsOf = (page) => page.locator("[data-testid=week-job-card]", { hasText: PRODUCT });
async function cleanup() {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
}
try {
  await cleanup();
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const res = await api.post("/api/v1/work-assignments", { data: { sector: "ENVASADO_MASIVO", client: "CLIENTE PRG SA", product: PRODUCT, plannedQuantity: "5000", unit: "u", plannedDate: monday, line: "Línea 1", orderNumber: OA, packagingLote: "PRG-1", notes: TAG, idempotencyKey: randomUUID() } });
  if (!res.ok()) throw new Error(`asignar: ${res.status()} ${await res.text()}`);
  const created = await res.json();
  const rootId = String(created.item?.id ?? created.workItem?.id).replace(/^native:/, "");
  const ordersBefore = (await q("select count(*)::int n from operational_orders"))[0].n;
  const movsBefore = (await q("select count(*)::int n from mp_stock_movements"))[0].n;

  const { ctx, page } = await login(E2E_USERS.produccion);
  await page.getByRole("button", { name: /^Envasado Masivo$/ }).or(page.getByRole("link", { name: /^Envasado Masivo$/ })).first().click({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 60_000 });
  await cardsOf(page).first().waitFor({ timeout: 60_000 }).catch(async (e) => { console.log("DEBUG", page.url(), JSON.stringify(await page.locator("[data-testid]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-testid")))].slice(0, 40))), (await page.locator("body").innerText()).slice(0, 600).replace(/\n+/g, " | ")); await page.screenshot({ path: `${OUT}/debug.png` }); throw e; });
  check("al inicio hay UNA tarjeta de la OA (5.000 u.)", (await cardsOf(page).count()) === 1);
  await cardsOf(page).first().click();
  await page.locator("[data-testid=sched-panel]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=sched-open]").tap();
  const dlg = page.locator("[data-testid=sched-dialog]");
  await dlg.waitFor({ timeout: 15_000 });
  await dlg.locator("[data-testid=sched-row-date]").first().fill(addDays(monday, 1));
  await dlg.locator("[data-testid=sched-row-qty]").first().fill("1500");
  await dlg.locator("[data-testid=sched-add-row]").tap();
  await dlg.locator("[data-testid=sched-row-date]").nth(1).fill(addDays(monday, 2));
  await dlg.locator("[data-testid=sched-row-qty]").nth(1).fill("1500");
  check("la vista previa dice que la original queda con 2000", /queda con 2000/.test(await dlg.locator("[data-testid=sched-preview]").innerText()));
  await page.screenshot({ path: `${OUT}/tablet-dialogo.png` });
  await dlg.locator("[data-testid=sched-submit]").tap();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByRole("button", { name: /^Envasado Masivo$/ }).or(page.getByRole("link", { name: /^Envasado Masivo$/ })).first().click({ timeout: 120_000 });
  await page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 60_000 });
  await cardsOf(page).first().waitFor({ timeout: 120_000 });
  check("el calendario muestra TRES tarjetas del mismo producto", (await cardsOf(page).count()) === 3, String(await cardsOf(page).count()));
  const qtys = (await cardsOf(page).locator("[data-testid=week-job-qty]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).sort();
  check("con 2.000 / 1.500 / 1.500", JSON.stringify(qtys).includes("2000") && qtys.filter((t) => t.startsWith("1500")).length === 2, JSON.stringify(qtys));
  await page.screenshot({ path: `${OUT}/tablet-calendario.png` });
  const rows = await q("select id, order_id, order_number, planned_quantity, schedule_root_id from work_items where (id = $1 or schedule_root_id = $1) and deleted_at is null order by planned_date", [rootId]);
  check("las tres son la MISMA OA (mismo order_id y número)", rows.length === 3 && new Set(rows.map((r) => r.order_id)).size === 1 && rows.every((r) => r.order_number === OA));
  check("no se crearon órdenes ni movimientos de stock", (await q("select count(*)::int n from operational_orders"))[0].n === ordersBefore && (await q("select count(*)::int n from mp_stock_movements"))[0].n === movsBefore);

  // Quitar una programación desde la pantalla
  await cardsOf(page).filter({ hasText: "1500" }).last().click();
  await page.locator("[data-testid=sched-panel]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=sched-item]").first().waitFor({ timeout: 30_000 });
  check("el panel lista las 3 programaciones", (await page.locator("[data-testid=sched-item]").count()) === 3);
  await page.locator("[data-testid=sched-remove]").first().tap();
  await page.locator("[data-testid=sched-remove-confirm]").tap();
  await page.waitForTimeout(2500);
  check("al quitar una programación, la orden y las demás se mantienen", (await q("select count(*)::int n from work_items where (id = $1 or schedule_root_id = $1) and deleted_at is null", [rootId]))[0].n === 2 && (await q("select count(*)::int n from operational_orders where order_number = $1 and deleted_at is null", [OA]))[0].n === 1);
  await ctx.close();

  // Permisos: otros sectores no programan (403) ni ven el botón.
  const env = await login(E2E_USERS.envasado);
  const forb = await env.page.request.post(`/api/v1/work-items/${rootId}/schedules`, { data: { items: [{ plannedDate: addDays(monday, 3), quantity: "10" }], idempotencyKey: `prg-${randomUUID()}` } });
  check("Envasado no puede programar (403)", forb.status() === 403, String(forb.status()));
  const list = await env.page.request.get(`/api/v1/work-items/${rootId}/schedules`);
  check("pero sí puede consultar las programaciones", list.ok());
  await env.ctx.close();
  await api.dispose();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup();
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
