// E2E en Chromium real: Producción → Pedidos → «Nuevo pedido» con OP correlativo y fecha de hoy (America/Argentina/Buenos_Aires).
// Base DESCARTABLE; login real con el usuario de Producción.
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
const OUT = process.env.OUT ?? "/tmp/pedidos-op";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "CLIENTE POP E2E";
const cleanup = async () => { await q("delete from production_pedidos where cliente like $1", [`${CLI}%`]).catch(() => undefined); };
const BASE_OP = 870000 + (Date.now() % 9000);

async function openAs(user, ctxOpts = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const arDate = (d) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d); const g = (t) => p.find((x) => x.type === t).value; return { iso: `${g("year")}-${g("month")}-${g("day")}`, ddmmaa: `${g("day")}/${g("month")}/${g("year").slice(2)}` }; };

try {
  await cleanup();
  // Último OP real del sistema: pedido histórico sembrado por la API (no se toca después).
  const pr = await openAs(E2E_USERS.produccion, { timezoneId: "Pacific/Auckland" }); // zona del navegador DISTINTA a ART a propósito
  const seed = await pr.page.request.post("/api/v1/production-pedidos", { data: { op: String(BASE_OP), cliente: `${CLI} HIST`, producto: "HIST", fecha: "2026-01-13", q: 10, ml: 10 } });
  check("sembrar pedido histórico con OP numérico", seed.status() === 201);
  const histBefore = JSON.stringify(await q("select id, op, fecha::text f, producto, cliente from production_pedidos where cliente = $1", [`${CLI} HIST`]));

  // Reloj fijo: 28/11/2026 02:00 UTC = 27/11/2026 23:00 ART (el servidor/UTC ya está en el día siguiente).
  await pr.page.clock.setFixedTime(new Date("2026-11-28T02:00:00Z"));
  await pr.page.goto("/mi-trabajo");
  await nav(pr.page, "Pedidos");
  await pr.page.getByRole("button", { name: /nuevo pedido/i }).click({ timeout: 120_000 });
  const opInput = pr.page.locator("[data-testid=pedido-form-op]");
  const fechaInput = pr.page.locator("[data-testid=pedido-form-fecha]");
  await fechaInput.waitFor({ timeout: 60_000 });
  check("la FECHA se autocompleta con hoy en ART (23:00 ART = día siguiente en UTC) en DD/MM/AA", (await fechaInput.inputValue()) === "27/11/26", await fechaInput.inputValue());
  await pr.page.waitForFunction((v) => document.querySelector("[data-testid=pedido-form-op]")?.value === v, String(BASE_OP + 1), { timeout: 30_000 }).catch(() => undefined);
  check("el OP se autocompleta con el siguiente correlativo del último OP real", (await opInput.inputValue()) === String(BASE_OP + 1), await opInput.inputValue());
  await pr.page.screenshot({ path: `${OUT}/1-nuevo-pedido.png` });

  // Otro usuario toma ese OP mientras el formulario sigue abierto (autocompletado «viejo»).
  const other = await openAs(E2E_USERS.produccion);
  const o = await other.page.request.post("/api/v1/production-pedidos", { data: { cliente: `${CLI} OTRO`, producto: "OTRO", opAuto: true } });
  const oj = await o.json();
  check("otro alta simultánea toma el OP sugerido", o.status() === 201 && oj.item.op === String(BASE_OP + 1), JSON.stringify(oj.item?.op));

  await pr.page.locator("label:has-text('CLIENTE') input").first().fill(`${CLI} UI`);
  await pr.page.locator("label:has-text('PRODUCTO') input").first().fill("PRODUCTO UI");
  await pr.page.getByRole("button", { name: /^Guardar$/ }).click();
  await pr.page.locator("text=/ya había sido tomado/").waitFor({ timeout: 30_000 });
  const ui = (await q("select op, fecha::text f from production_pedidos where cliente = $1", [`${CLI} UI`]))[0];
  check("el OP viejo se reasigna al siguiente libre y el usuario es avisado", ui?.op === String(BASE_OP + 2), JSON.stringify(ui));
  check("la FECHA se guardó en ISO según ART (2026-11-27)", ui?.f === "2026-11-27", JSON.stringify(ui));

  // Dos altas automáticas simultáneas por API: OP únicos y correlativos.
  const par = await Promise.all(Array.from({ length: 8 }, (_, i) => other.page.request.post("/api/v1/production-pedidos", { data: { cliente: `${CLI} PAR${i}`, producto: "PAR", opAuto: true } })));
  const ops = (await Promise.all(par.map(async (r) => Number((await r.json()).item.op)))).sort((a, b) => a - b);
  check("8 altas simultáneas: OP únicos y correlativos", ops.every((v, i) => v === BASE_OP + 3 + i), ops.join(","));
  const nx = await (await other.page.request.get("/api/v1/production-pedidos/next-op")).json();
  check("GET /next-op devuelve el siguiente correlativo", nx.nextOp === String(BASE_OP + 11), JSON.stringify(nx));

  // OP editable a mano: se respeta; el histórico no cambió.
  await pr.page.getByRole("button", { name: /nuevo pedido/i }).click();
  await pr.page.locator("[data-testid=pedido-form-op]").waitFor();
  await pr.page.waitForFunction((v) => document.querySelector("[data-testid=pedido-form-op]")?.value === v, String(BASE_OP + 11), { timeout: 30_000 }).catch(() => undefined);
  await pr.page.locator("[data-testid=pedido-form-op]").fill(String(BASE_OP));
  await pr.page.locator("label:has-text('CLIENTE') input").first().fill(`${CLI} MANUAL`);
  await pr.page.locator("label:has-text('PRODUCTO') input").first().fill("LINEA 2");
  await pr.page.getByRole("button", { name: /^Guardar$/ }).click();
  await pr.page.waitForFunction(() => !document.querySelector("[data-testid=pedido-form-op]"), null, { timeout: 30_000 });
  const man = (await q("select op from production_pedidos where cliente = $1", [`${CLI} MANUAL`]))[0];
  check("un OP editado a mano se respeta (otra línea del mismo pedido)", man?.op === String(BASE_OP), JSON.stringify(man));
  check("los pedidos históricos no se modificaron", JSON.stringify(await q("select id, op, fecha::text f, producto, cliente from production_pedidos where cliente = $1", [`${CLI} HIST`])) === histBefore);
  await pr.page.screenshot({ path: `${OUT}/2-listado.png` });
  await other.ctx.close();
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
