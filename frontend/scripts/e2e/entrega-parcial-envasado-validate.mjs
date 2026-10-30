// E2E en Chromium real: ENTREGAS PARCIALES de Envasado Masivo y Premium → Producción. Base DESCARTABLE; login real.
// Trabajo de 2.000 u.: «Entregar parcial» 1.000 → 600 → 400. El trabajo sigue pendiente en Envasado hasta completar; Producción ve cada entrega.
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
const OUT = process.env.OUT ?? "/tmp/entrega-parcial";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-EPAR";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select quantity, kind, status, cumulative_after, pending_after, delivered_by, delivered_by_sector from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const status = async (id) => (await q("select operational_status, planned_quantity from work_items where id = $1", [id]))[0];
const ids = {};

async function login(user, viewport = { width: 1400, height: 900 }) {
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

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E parcial" } })).json()).week.id;
  const mk = async (sector, product, qty, client) => {
    const r = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client, plannedQuantity: qty, unit: "un.", product, sector, line: "Línea 1" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.masivo = await mk("ENVASADO_MASIVO", "ORIGINAL BLACK AFTER SHAVE EPAR", "2000", "CLIENTE EPAR SA");
  ids.premium = await mk("ENVASADO_PREMIUM", "SERUM PREMIUM EPAR", "2000", "CLIENTE EPAR SA");
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();

  // ================= ENVASADO MASIVO =================
  const env = await login(E2E_USERS.envasado);
  const p = env.page;
  const prod = "ORIGINAL BLACK AFTER SHAVE EPAR";
  await card(p, prod).waitFor({ timeout: 120_000 });
  check("la tarjeta del trabajo tiene el botón «Entregar parcial»", (await card(p, prod).getByRole("button", { name: "Entregar parcial" }).count()) === 1);

  // Avance: 1.000 terminadas (como si el operario guardó su avance)
  await q("update work_items set finished_qty = '1000' where id = $1", [ids.masivo]);
  await p.reload();
  await card(p, prod).waitFor({ timeout: 120_000 });
  await card(p, prod).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = p.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  const txt = (await dlg.innerText()).replace(/\s+/g, " ");
  check("ventana simple: cliente, producto, total, ya entregado, pendiente y «Cantidad a entregar ahora»", /CLIENTE EPAR SA/.test(txt) && /ORIGINAL BLACK AFTER SHAVE EPAR/.test(txt) && /Cantidad total del trabajo/.test(txt) && /2000/.test(txt) && /Ya entregado/.test(txt) && /Pendiente de entregar/.test(txt) && /Cantidad a entregar ahora/.test(txt));
  check("no pide motivos, remito ni autorizaciones; tiene Cancelar y Confirmar entrega", (await dlg.locator("[data-testid=deliver-remito], [data-testid=deliver-boxes-toggle], textarea").count()) === 0 && /Cancelar/.test(txt) && /Confirmar entrega/.test(txt));
  await p.screenshot({ path: `${OUT}/1-dialogo-parcial.png` });

  // Validaciones en pantalla
  await dlg.locator("[data-testid=deliver-quantity]").fill("1500");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  check("entregar más de lo terminado se rechaza con mensaje claro y no registra nada", /terminadas/.test(await dlg.locator("[data-testid=deliver-error]").innerText()) && (await lines(ids.masivo)).length === 0);
  await dlg.locator("[data-testid=deliver-quantity]").fill("2500");
  await dlg.locator("[data-testid=confirm-deliver]").click();
  check("entregar más que el saldo se rechaza", /supera el saldo/.test(await dlg.locator("[data-testid=deliver-error]").innerText()));

  // 1.ª parcial: 1.000, con DOBLE CLIC
  await dlg.locator("[data-testid=deliver-quantity]").fill("1000");
  await dlg.locator("[data-testid=confirm-deliver]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 });
  check("1.ª entrega parcial de 1.000: se registra UNA vez (doble clic sin duplicar)", await waitDb(async () => (await lines(ids.masivo)).length === 1));
  let ls = await lines(ids.masivo);
  check("renglón PARCIAL de 1.000, acumulado 1.000, saldo 1.000, con usuario y sector", ls[0].kind === "PARCIAL" && Number(ls[0].quantity) === 1000 && Number(ls[0].cumulative_after) === 1000 && Number(ls[0].pending_after) === 1000 && ls[0].delivered_by_sector === "ENVASADO_MASIVO" && /Envasado/.test(ls[0].delivered_by));
  let st = await status(ids.masivo);
  check("Envasado conserva el MISMO trabajo: no entregado, cantidad asignada 2.000 intacta", st.operational_status !== "entregado" && String(st.planned_quantity) === "2000");
  await p.reload();
  await card(p, prod).waitFor({ timeout: 120_000 });
  check("tras recargar el trabajo sigue en Envasado y no se repitió la entrega", (await lines(ids.masivo)).length === 1 && (await card(p, prod).count()) === 1);
  await card(p, prod).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
  const info = p.locator("[data-testid=drawer-delivery-progress]");
  await info.waitFor({ timeout: 30_000 });
  check("el trabajo muestra «Entregadas a Producción: 1000 · pendientes de entregar: 1000»", /1000/.test(await info.innerText()) && /pendientes de entregar: 1000/.test(await info.innerText()), await info.innerText());
  await p.screenshot({ path: `${OUT}/2-trabajo-con-parcial.png` });
  await p.keyboard.press("Escape");

  // Producción ve la entrega
  const pr = await login(E2E_USERS.produccion);
  await pr.page.getByRole("button", { name: /^Entregados$/ }).or(pr.page.getByRole("link", { name: /^Entregados$/ })).first().click({ timeout: 120_000 });
  await pr.page.getByText(/Parcial · saldo 1000/).first().waitFor({ timeout: 120_000 }).catch(() => undefined);
  check("Producción recibe la entrega: aparece como «Parcial · saldo 1000»", (await pr.page.getByText(/Parcial · saldo 1000/).count()) > 0);
  await pr.page.screenshot({ path: `${OUT}/3-produccion-recibe.png` });

  // 2.ª y 3.ª entrega
  const deliverFromCard = async (qty, finished) => {
    await q("update work_items set finished_qty = $2 where id = $1", [ids.masivo, String(finished)]);
    await p.reload();
    await card(p, prod).waitFor({ timeout: 120_000 });
    await card(p, prod).getByRole("button", { name: "Entregar parcial" }).click();
    const d = p.locator("[data-testid=deliver-work-dialog]");
    await d.waitFor({ timeout: 30_000 });
    await d.locator("[data-testid=deliver-quantity]").fill(String(qty));
    await d.locator("[data-testid=confirm-deliver]").click();
    await d.waitFor({ state: "detached", timeout: 30_000 });
  };
  await deliverFromCard(600, 1600);
  ls = await lines(ids.masivo);
  check("2.ª entrega de 600: acumulado 1.600, saldo 400, el trabajo sigue pendiente", ls.length === 2 && Number(ls[1].cumulative_after) === 1600 && Number(ls[1].pending_after) === 400 && (await status(ids.masivo)).operational_status !== "entregado");
  await deliverFromCard(400, 2000);
  ls = await lines(ids.masivo);
  check("3.ª entrega de 400: acumulado 2.000, saldo 0, renglón FINAL y trabajo ENTREGADO solo ahora", ls.length === 3 && ls[2].kind === "FINAL" && Number(ls[2].cumulative_after) === 2000 && (await status(ids.masivo)).operational_status === "entregado");
  check("las tres entregas quedaron como registros independientes (1.000 / 600 / 400)", JSON.stringify(ls.map((l) => Number(l.quantity))) === "[1000,600,400]");

  // Producción: historial con acumulado, saldo y usuario
  await pr.page.reload();
  await pr.page.getByRole("button", { name: /^Entregados$/ }).or(pr.page.getByRole("link", { name: /^Entregados$/ })).first().click({ timeout: 120_000 });
  await pr.page.getByRole("button", { name: /^Ver detalle$/ }).first().waitFor({ timeout: 120_000 }).catch(() => undefined);
  const toList = pr.page.locator("[data-testid=os-table-mode-toggle]");
  if ((await pr.page.getByRole("button", { name: /^Ver detalle$/ }).count()) === 0 && (await toList.count()) > 0) await toList.first().click();
  await pr.page.getByRole("button", { name: /^Ver detalle$/ }).first().click({ timeout: 60_000 });
  const hist = pr.page.locator("[data-testid=detail-delivery-lines]");
  await hist.waitFor({ timeout: 30_000 });
  const ht = (await hist.innerText()).replace(/\s+/g, " ");
  check("historial en Producción: 3 entregas con cantidad, acumulado, saldo, usuario y sector", /#1/.test(ht) && /acumulado 1000/.test(ht) && /saldo 1000/.test(ht) && /acumulado 1600/.test(ht) && /saldo 400/.test(ht) && /acumulado 2000/.test(ht) && /\(final\)/.test(ht) && /Envasado/.test(ht), ht.slice(0, 300));
  await pr.page.screenshot({ path: `${OUT}/4-historial-produccion.png` });
  await pr.ctx.close();
  await env.ctx.close();

  // ================= ENVASADO PREMIUM =================
  const pre = await login(E2E_USERS.envasadoPremium);
  const prodP = "SERUM PREMIUM EPAR";
  await card(pre.page, prodP).waitFor({ timeout: 120_000 });
  await q("update work_items set finished_qty = '1000' where id = $1", [ids.premium]);
  await pre.page.reload();
  await card(pre.page, prodP).waitFor({ timeout: 120_000 });
  await card(pre.page, prodP).getByRole("button", { name: "Entregar parcial" }).click();
  const dp = pre.page.locator("[data-testid=deliver-work-dialog]");
  await dp.waitFor({ timeout: 30_000 });
  await dp.locator("[data-testid=deliver-quantity]").fill("1000");
  await dp.locator("[data-testid=confirm-deliver]").click();
  await dp.waitFor({ state: "detached", timeout: 30_000 });
  const lp = await lines(ids.premium);
  check("Envasado Premium: entrega parcial de 1.000 registrada y el trabajo sigue pendiente", lp.length === 1 && lp[0].delivered_by_sector === "ENVASADO_PREMIUM" && (await status(ids.premium)).operational_status !== "entregado");
  await pre.page.screenshot({ path: `${OUT}/5-premium.png` });
  await pre.ctx.close();

  check("las entregas internas no generaron despachos externos (Depósito → Entregas Producción)", (await q("select count(*)::int n from deposito_despachos where cliente like 'CLIENTE EPAR%'"))[0].n === 0);
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("delete from os_notifications where message like '%CLIENTE EPAR%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
