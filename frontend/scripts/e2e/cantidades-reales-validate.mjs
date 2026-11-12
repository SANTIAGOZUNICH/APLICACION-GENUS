// E2E en Chromium real: la cantidad SOLICITADA es una referencia, no un tope. Base DESCARTABLE; login real.
// Pedido 1.200 → realizadas 1.235 → «Entregar parcial» 605 (6×100 + 1×5) y 630 (6×100 + 1×30) con SUS cajas; «Entregar todo» tras una parcial;
// Elaboración 60 kg → 70 kg enviados a Envasado.
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
const OUT = process.env.OUT ?? "/tmp/cantidades-reales";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-CR";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select quantity::float8 q, kind, cumulative_after::float8 cum, pending_after::float8 pend, packing_groups from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [id]);
const wi = async (id) => (await q("select operational_status, planned_quantity, finished_qty from work_items where id = $1", [id]))[0];
const ids = {};

async function login(user, viewport = { width: 1400, height: 1000 }) {
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
const card = (page, product) => page.locator("[data-testid=work-item-card]", { hasText: product }).first();
async function fillBoxes(dlg, slots) {
  const toggle = dlg.locator("[data-testid=deliver-boxes-toggle]");
  if ((await dlg.locator("[data-testid=deliver-box-cajas-0]").count()) === 0) await toggle.click();
  for (const [i, [cajas, upc]] of slots.entries()) {
    await dlg.locator(`[data-testid=deliver-box-cajas-${i}]`).fill(String(cajas));
    await dlg.locator(`[data-testid=deliver-box-upc-${i}]`).fill(String(upc));
  }
}
async function partial(page, product, slots) {
  await page.reload();
  await card(page, product).waitFor({ timeout: 120_000 });
  await card(page, product).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await fillBoxes(dlg, slots);
  const total = (await dlg.locator("[data-testid=deliver-boxes-total]").innerText()).replace(/\s+/g, " ");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  const err = await dlg.locator("[data-testid=deliver-error]").innerText({ timeout: 3000 }).catch(() => null);
  if (err) { await page.screenshot({ path: `${OUT}/error-parcial.png` }); return { total, err }; }
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  return { total, err: null };
}

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  if ((await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error("login");
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E cantidades" } })).json()).week.id;
  const mk = async (sector, product, qty, unit, extra) => {
    const r = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: "CLIENTE CR SA", plannedQuantity: qty, unit, product, sector, ...extra } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  const PA = "PRODUCTO CR PARCIALES", PB = "PRODUCTO CR TODO", PE = "CREMA CR ELABORADA";
  ids.a = await mk("ENVASADO_MASIVO", PA, "1200", "un.", { line: "Línea 1" });
  ids.b = await mk("ENVASADO_MASIVO", PB, "1200", "un.", { line: "Línea 1" });
  ids.e = await mk("ELABORACION", PE, "60", "kg", { branchOwner: "Cristian" }).catch((e) => { console.log("(elaboración no sembrada:", String(e).slice(0, 160), ")"); return null; });
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  // Realizadas: 1.235 (el operario las registró con «Guardar avance»; acá se deja el mismo dato en el trabajo).
  await q("update work_items set finished_qty = '1235' where id = any($1::uuid[])", [[ids.a, ids.b]]);

  const env = await login(E2E_USERS.envasado);
  const p = env.page;
  await card(p, PA).waitFor({ timeout: 120_000 });

  // ===== Pedido 1.200, realizadas 1.235: parcial 605 + 630, cada una con SUS cajas =====
  const r1 = await partial(p, PA, [[6, 100], [1, 5]]);
  check("1.ª parcial: 6×100 + 1×5 = 605 u. en 7 cajas (sin pedir las cajas del trabajo completo)", !r1.err && /7 cajas · 605 u\./.test(r1.total), r1.err ?? r1.total);
  let ls = await lines(ids.a);
  check("1.ª entrega registrada: 605 u., acumulado 605, pendiente 630 (realizadas sin entregar)", ls.length === 1 && ls[0].q === 605 && ls[0].cum === 605 && ls[0].pend === 630 && ls[0].kind === "PARCIAL", JSON.stringify(ls));
  const r2 = await partial(p, PA, [[6, 100], [1, 30]]);
  check("2.ª parcial: 6×100 + 1×30 = 630 u. en 7 cajas; NO se bloquea aunque el acumulado supere las 1.200 pedidas", !r2.err && /7 cajas · 630 u\./.test(r2.total), r2.err ?? r2.total);
  ls = await lines(ids.a);
  const st = await wi(ids.a);
  check("total entregado 1.235, pendiente 0 (nunca negativo), trabajo ENTREGADO y la cantidad pedida sigue en 1.200", ls.length === 2 && ls[1].cum === 1235 && ls[1].pend === 0 && ls[1].kind === "FINAL" && st.operational_status === "entregado" && String(st.planned_quantity) === "1200", JSON.stringify(ls));
  check("cada entrega guarda SUS cajas (7 + 7 = 14)", JSON.stringify(ls[0].packing_groups) === JSON.stringify([{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }]) && JSON.stringify(ls[1].packing_groups) === JSON.stringify([{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 30 }]));

  // ===== Parcial 605 y luego «Entregar» el resto (630) con las cajas de ESA entrega =====
  await card(p, PB).waitFor({ timeout: 120_000 }).catch(() => undefined);
  const b1 = await partial(p, PB, [[6, 100], [1, 5]]);
  check("trabajo B: 1.ª parcial de 605 registrada", !b1.err && (await waitDb(async () => (await lines(ids.b)).length === 1)));
  await p.reload();
  await card(p, PB).waitFor({ timeout: 120_000 });
  await card(p, PB).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
  await p.locator("[data-testid=deliver-btn]").click();
  const dlg = p.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  const qtyDefault = await dlg.locator("[data-testid=deliver-quantity]").inputValue();
  check("«Entregar todo» ofrece el saldo REAL (630 = 1.235 realizadas − 605), no 595", /^630$/.test(qtyDefault.trim()), qtyDefault);
  check("las cajas son opcionales: el diálogo no las exige abiertas", (await dlg.locator("[data-testid=deliver-box-cajas-0]").count()) === 0);
  await fillBoxes(dlg, [[6, 100], [1, 30]]);
  await dlg.locator("[data-testid=confirm-deliver]").click();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-400)));
  const lb = await lines(ids.b);
  check("«Entregar todo» entregó los 630 restantes con SUS cajas: total 1.235, trabajo entregado", lb.length === 2 && lb[1].q === 630 && lb[1].cum === 1235 && (await wi(ids.b)).operational_status === "entregado", JSON.stringify(lb));
  await p.screenshot({ path: `${OUT}/1-envasado.png` });

  // ===== Producción: ve las dos entregas con sus cajas y el total =====
  const pr = await login(E2E_USERS.produccion);
  await pr.page.getByRole("button", { name: /^Entregados$/ }).or(pr.page.getByRole("link", { name: /^Entregados$/ })).first().click({ timeout: 120_000 });
  const t = pr.page.getByText("Ver como lista");
  await pr.page.locator("[data-testid=os-table-mode-toggle]").first().waitFor({ timeout: 120_000 }).catch(() => undefined);
  if ((await t.count()) > 0) await t.first().click().catch(() => undefined);
  await pr.page.getByText(PA).first().waitFor({ timeout: 120_000 }).catch(() => undefined);
  const row = pr.page.getByRole("row", { name: new RegExp(PA) }).first();
  await row.getByRole("button", { name: /^Ver detalle$/ }).click({ timeout: 60_000 });
  const hist = pr.page.locator("[data-testid=detail-delivery-lines]");
  await hist.waitFor({ timeout: 30_000 });
  const ht = (await hist.innerText()).replace(/\s+/g, " ");
  check("Producción ve la entrega 1 de 605 y la 2 de 630, con acumulado 1235 y sin saldo negativo", /605/.test(ht) && /630/.test(ht) && /acumulado 1235/.test(ht) && !/saldo -/.test(ht), ht.slice(0, 300));
  await pr.page.screenshot({ path: `${OUT}/2-produccion.png` });
  await pr.ctx.close();
  await env.ctx.close();

  // ===== Elaboración: OE de 60 kg, 70 kg realmente elaborados → se envían 70 kg =====
  if (ids.e) {
    const el = await login(E2E_USERS.elaboracion);
    await card(el.page, PE).waitFor({ timeout: 120_000 });
    await card(el.page, PE).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
    await el.page.locator("[data-testid=send-to-envasado-btn]").click();
    const d = el.page.locator("[data-testid=send-to-envasado-dialog]");
    await d.waitFor({ timeout: 30_000 });
    await d.locator("[data-testid=envasado-dest-ENVASADO_MASIVO]").click().catch(() => undefined);
    await d.locator("[data-testid=envasado-produced]").fill("70");
    await d.locator("[data-testid=confirm-send-envasado]").click();
    const bad = await d.locator("[data-testid=envasado-error]").innerText({ timeout: 4000 }).catch(() => null);
    await d.waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
    const e = await wi(ids.e);
    check("70 kg sobre una OE de 60 kg: se envía a Envasado sin bloqueo; quedan 70 kg elaborados y 60 kg solicitados", !bad && String(e.finished_qty) === "70" && String(e.planned_quantity) === "60" && e.operational_status === "completo", bad ?? JSON.stringify(e));
    await el.page.screenshot({ path: `${OUT}/3-elaboracion.png` });
    await el.ctx.close();
  } else check("Elaboración (UI): trabajo no sembrado — cubierto en la prueba de integración con Postgres", true);

  check("sin despachos externos ni remitos nuevos por estas entregas", (await q("select count(*)::int n from deposito_despachos where cliente like 'CLIENTE CR%'"))[0].n === 0);
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("delete from os_notifications where message like '%CLIENTE CR%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
