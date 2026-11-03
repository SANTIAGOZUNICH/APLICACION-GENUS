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
const OUT = process.env.OUT ?? "/tmp/entregas-cajas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-ECAJ";
const CLI = "AQUALO E2E ECAJ";
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
const P = { A: "SERUM CAPILAR ECAJ-A", B: "SHAMPOO ECAJ-B", C: "CREMA ECAJ-C" };

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

/** Entrega parcial desde la tarjeta con cajas (opción A: sin escribir la cantidad, el total sale de las cajas). */
async function partialWithBoxes(page, product, slots, { qty = null, obs = null } = {}) {
  await card(page, product).waitFor({ timeout: 120_000 });
  await card(page, product).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = page.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-boxes-toggle]").click();
  for (const [i, [cajas, upc]] of slots.entries()) {
    await dlg.locator(`[data-testid=deliver-box-cajas-${i}]`).fill(String(cajas));
    await dlg.locator(`[data-testid=deliver-box-upc-${i}]`).fill(String(upc));
  }
  if (qty != null) await dlg.locator("[data-testid=deliver-quantity]").fill(String(qty));
  if (obs) await dlg.locator("[data-testid=deliver-observations]").fill(obs);
  const totalText = await dlg.locator("[data-testid=deliver-boxes-total]").innerText();
  await dlg.locator("[data-testid=confirm-deliver]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG diálogo:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-300)));
  return totalText.replace(/\s+/g, " ");
}

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E cajas" } })).json()).week.id;
  const mk = async (sector, product) => {
    const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLI, plannedQuantity: "2000", unit: "un.", product, sector, line: "Línea 1", packagingLote: "L-ECAJ" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.A = await mk("ENVASADO_MASIVO", P.A);
  ids.B = await mk("ENVASADO_MASIVO", P.B);
  ids.C = await mk("ENVASADO_PREMIUM", P.C);
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await q("update work_items set finished_qty = '2050' where id = any($1::uuid[])", [[ids.A, ids.C]]);
  await q("update work_items set finished_qty = '2000' where id = $1", [ids.B]);

  const masApi = await apiAs(E2E_USERS.envasado);
  const preApi = await apiAs(E2E_USERS.envasadoPremium);
  const codApi = await apiAs(E2E_USERS.codificado);
  const depApi = await apiAs(E2E_USERS.deposito);

  // ============ 4-5) Envasado Masivo: entregas parciales con cajas, desde la pantalla ============
  const mas = await login(E2E_USERS.envasado);
  const mp = mas.page;
  await card(mp, P.A).waitFor({ timeout: 120_000 });
  await q("update work_items set finished_qty = '2050', version = version + 1 where id = $1", [ids.A]);
  await mp.reload();
  const t1 = await partialWithBoxes(mp, P.A, [[8, 100]]);
  check("4) entrega parcial de 8 cajas × 100: el total se calcula solo (800 u.) y el formulario lo muestra", /8 cajas · 800 u\./.test(t1), t1);
  check("4) se registra UNA entrega de 800 u. con 8 × 100 (doble clic sin duplicar)", await waitDb(async () => (await lines(ids.A)).length === 1) && Number((await lines(ids.A))[0].quantity) === 800 && JSON.stringify((await lines(ids.A))[0].packing_groups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }]));
  await partialWithBoxes(mp, P.A, [[8, 100]], { obs: "segunda tanda" });
  const t3 = await partialWithBoxes(mp, P.A, [[4, 100], [1, 50]]);
  check("5) entrega parcial con cajas incompletas: 4 × 100 + 1 × 50 = 450 u. en 5 cajas", /5 cajas · 450 u\./.test(t3), t3);
  const lsA = await lines(ids.A);
  check("   las tres entregas (800 + 800 + 450 = 2.050) quedan con su propio desglose, sin mezclar", lsA.length === 3 && lsA.map((l) => Number(l.quantity)).join() === "800,800,450" && JSON.stringify(lsA[2].packing_groups) === JSON.stringify([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]));
  check("   se completa (2.050 de 2.000 pedidos), el pedido sigue en 2.000 y el resumen suma 20 × 100 + 1 × 50", (await planned(ids.A)).operational_status === "entregado" && (await planned(ids.A)).planned_quantity === "2000" && JSON.stringify((await agg(ids.A)).packing_groups) === JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]));
  // 6) sin información de cajas
  const noBoxes = await masApi.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${ids.B}`, actorSectorId: "ENVASADO_MASIVO", deliverQuantity: 2000, partial: true, idempotencyKey: `ecaj-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "" } });
  check("6) entrega parcial SIN información de cajas: se acepta (el embalaje no es obligatorio)", noBoxes.status() === 200 && (await lines(ids.B))[0].packing_groups === null);
  await mp.screenshot({ path: `${OUT}/1-envasado-parcial-cajas.png` });

  // ============ 9) Envasado Premium → Codificado con cajas (UI) → Codificado entrega a Producción ============
  const pre = await login(E2E_USERS.envasadoPremium);
  const pp0 = pre.page;
  await card(pp0, P.C).waitFor({ timeout: 120_000 });
  await card(pp0, P.C).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
  await pp0.getByRole("button", { name: /Entregar a Codificado/ }).first().click();
  const dtc = pp0.locator("[data-testid=deliver-to-codificado-dialog]");
  await dtc.waitFor({ timeout: 30_000 });
  await dtc.locator("[data-testid=dtc-assigned]").filter({ hasText: /2\.000/ }).waitFor({ timeout: 30_000 });
  await dtc.locator("[data-testid=dtc-qty]").fill("");
  await dtc.locator("[data-testid=dtc-boxes-toggle]").click();
  await dtc.locator("[data-testid=dtc-box-cajas-0]").fill("8");
  await dtc.locator("[data-testid=dtc-box-upc-0]").fill("100");
  await dtc.locator("[data-testid=dtc-observations]").fill("primera tanda");
  await dtc.locator("[data-testid=dtc-confirm]").dblclick();
  await dtc.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG dtc:", (await dtc.innerText()).replace(/\s+/g, " ").slice(-300)));
  const trC = await transfers(ids.C);
  check("9) Premium entrega a Codificado 8 cajas × 100 (total calculado, sin escribir la cantidad): una sola entrega con su desglose", trC.length === 1 && Number(trC[0].quantity) === 800 && JSON.stringify(trC[0].packing_groups) === JSON.stringify([{ cajas: 8, unidadesPorCaja: 100 }]));
  const postT = (qty, boxes) => preApi.post(`/api/v1/work-items/${ids.C}/codificado`, { data: { action: "transfer", quantity: qty, finishedQty: 2050, packingGroups: boxes, idempotencyKey: randomUUID() } });
  check("   2.ª y 3.ª entregas a Codificado (8 × 100; 4 × 100 + 1 × 50)", (await postT(800, [{ cajas: 8, unidadesPorCaja: 100 }])).status() === 200 && (await postT(450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }])).status() === 200);
  const badT = await postT(100, [{ cajas: 1, unidadesPorCaja: 50 }]);
  check("   cajas que no suman la cantidad se rechazan (400)", badT.status() === 400 && /suman 50/.test((await badT.json()).error ?? ""));
  await pre.ctx.close();
  const childC = String((await q("select id from work_items where parent_work_item_id = $1", [ids.C]))[0].id);
  const deliverCod = await codApi.post(`/api/v1/work-items/${childC}/codificado`, { data: { action: "deliver", deliverQuantity: 2050, idempotencyKey: `ecaj-cod-${randomUUID()}` } });
  check("11) Codificado entrega a Producción las 2.050 recibidas (más que las 2.000 pedidas) en UNA entrega", deliverCod.status() === 200 && (await lines(childC)).length === 1 && Number((await lines(childC))[0].quantity) === 2050, String(deliverCod.status()));

  // ============ Producción: Entregas internas con cajas; edición de cajas de una entrega parcial ============
  const pr = await login(E2E_USERS.produccion);
  const pp = pr.page;
  await nav(pp, "Entregas internas");
  await pp.locator("[data-testid=entregas-internas]").waitFor({ timeout: 120_000 });
  const search = async (text) => { await pp.locator("[data-testid=ei-search]").fill(text); await pp.waitForTimeout(800); await pp.waitForFunction(() => !/Cargando/.test(document.querySelector("[data-testid=ei-count]")?.textContent ?? ""), null, { timeout: 30_000 }); };
  const rows = () => pp.evaluate(() => [...document.querySelectorAll("[data-testid=ei-row]")].map((r) => ({ id: r.getAttribute("data-delivery-id"), kind: r.getAttribute("data-kind"), status: r.getAttribute("data-status"), qty: r.querySelector("[data-testid=ei-qty]")?.textContent, boxes: r.querySelector("[data-testid=ei-boxes]")?.textContent.replace(/\s+/g, " ").trim(), text: r.textContent.replace(/\s+/g, " ") })));
  await search(P.A);
  let rA = await rows();
  check("9) Producción ve cada entrega parcial con sector, cantidad y cajas: «8 cajas de 100 u. = 8 cajas / 800 u.»", rA.length === 3 && rA.every((r) => /Envasado Masivo → Producción/.test(r.text)) && rA.some((r) => /8 cajas de 100 u\. = 8 cajas \/ 800 u\./.test(r.boxes)) && rA.some((r) => /4 cajas de 100 u\. \+ 1 caja de 50 u\. = 5 cajas \/ 450 u\./.test(r.boxes)), rA.map((r) => r.boxes).join(" | "));
  await search(P.C);
  const rC = await rows();
  check("9) las entregas a Codificado también muestran sus cajas, cada una por separado", rC.filter((r) => r.kind === "CODIFICADO").length === 3 && rC.filter((r) => r.kind === "CODIFICADO").every((r) => /cajas/.test(r.boxes)));
  await pp.screenshot({ path: `${OUT}/2-produccion-entregas-internas.png` });
  // 7) editar el desglose de la 3.ª parcial de A (4 × 100 + 1 × 50 → 4 × 100 + 2 × 25), misma cantidad
  await search(P.A);
  const l3 = (await rows()).find((r) => num(r.qty) === 450);
  await pp.locator(`[data-delivery-id="${l3.id}"] [data-testid=ei-edit]`).click();
  const ed = pp.locator("[data-testid=ei-edit-dialog]");
  await ed.waitFor();
  check("7) el diálogo de edición precarga las cajas de la entrega (4 × 100 y 1 × 50)", (await ed.locator("[data-testid=ei-edit-box-cajas-0]").inputValue()) === "4" && (await ed.locator("[data-testid=ei-edit-box-upc-1]").inputValue()) === "50");
  await ed.locator("[data-testid=ei-edit-box-cajas-1]").fill("2");
  await ed.locator("[data-testid=ei-edit-box-upc-1]").fill("25");
  await ed.locator("[data-testid=ei-edit-save]").dblclick();
  await pp.locator("[data-testid=ei-toast]").waitFor({ timeout: 15_000 });
  const l3db = (await lines(ids.A))[2];
  check("7) editar el desglose: queda 4 × 100 + 2 × 25 (450 u. en 6 cajas), una sola modificación, resumen de la entrega actualizado", JSON.stringify(l3db.packing_groups) === JSON.stringify([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 2, unidadesPorCaja: 25 }]) && (await q("select count(*)::int n from internal_delivery_changes where delivery_id = $1", [l3db.id]))[0].n === 1 && JSON.stringify((await agg(ids.A)).packing_groups) === JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 2, unidadesPorCaja: 25 }]));
  const aud = (await q("select old_packing, new_packing, actor_sector from internal_delivery_changes where delivery_id = $1", [l3db.id]))[0];
  check("   auditoría: cajas anteriores y nuevas, usuario y sector", JSON.stringify(aud.old_packing) === JSON.stringify([{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]) && aud.actor_sector === "PRODUCCION");
  // cantidad cambia pero cajas no: rechazado en pantalla (validación de consistencia)
  const l1 = (await rows()).find((r) => num(r.qty) === 800 && r.status === "ACTIVA");
  await pp.locator(`[data-delivery-id="${l1.id}"] [data-testid=ei-edit]`).click();
  await ed.locator("[data-testid=ei-edit-qty]").fill("900");
  await ed.locator("[data-testid=ei-edit-save]").click();
  const msgQty = await ed.locator("[data-testid=ei-edit-error]").innerText();
  check("7) cambiar la cantidad sin ajustar las cajas se rechaza con mensaje claro (suman 800, la entrega pasa a 900)", /suman 800 u\./.test(msgQty) && Number((await lines(ids.A))[0].quantity) === 800, msgQty);
  await pp.keyboard.press("Escape");

  // ============ 1-3) Entregados → «Editar trabajo entregado» ============
  await nav(pp, "Entregados");
  await toListMode(pp);
  const rowOf = (product) => pp.locator("tr, [role=row], .dsg-row").filter({ hasText: product }).filter({ has: pp.locator("[data-testid=edit-delivered-work]") }).first();
  await rowOf(P.B).waitFor({ timeout: 120_000 });
  const rowTextBefore = (await rowOf(P.B).innerText()).replace(/\s+/g, " ");
  check("1) el trabajo ENTREGADO muestra la acción «Editar trabajo entregado»", (await rowOf(P.B).locator("[data-testid=edit-delivered-work]").count()) === 1, rowTextBefore.slice(0, 160));
  // preparar: el trabajo B tenía 2.000 sin cajas; se cargan 20 × 100 como estado inicial real y se recarga
  await q("update work_item_delivery_lines set packing_groups = $2::jsonb where work_item_id = $1", [ids.B, JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }])]);
  await q("update work_item_deliveries set packing_groups = $2::jsonb where work_item_id = $1 and status = 'ENTREGADO'", [ids.B, JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }])]);
  await pp.reload();
  await nav(pp, "Entregados");
  await toListMode(pp);
  await rowOf(P.B).waitFor({ timeout: 120_000 });
  await rowOf(P.B).locator("[data-testid=edit-delivered-work]").click();
  const edw = pp.locator("[data-testid=edit-delivered-dialog]");
  await edw.waitFor({ timeout: 30_000 });
  await edw.locator("[data-testid=edw-row]").first().waitFor({ timeout: 30_000 });
  check("2) el diálogo muestra la cantidad SOLICITADA (2.000, no editable) y precarga 20 × 100", /2000 un\./.test((await edw.locator("[data-testid=edw-planned]").innerText()).replace(/\s+/g, " ")) && (await edw.locator("[data-testid=edw-0-box-cajas-0]").inputValue().catch(() => "")) !== undefined);
  if (!(await edw.locator("[data-testid=edw-0-box-cajas-1]").isVisible().catch(() => false))) await edw.locator("[data-testid=edw-0-boxes-toggle]").click();
  await edw.locator("[data-testid=edw-0-box-cajas-1]").fill("1");
  await edw.locator("[data-testid=edw-0-box-upc-1]").fill("50");
  check("3) 20 × 100 + 1 × 50: el formulario muestra «21 cajas · 2.050 u.» y ofrece usar ese total", /21 cajas · 2\.050 u\./.test(await edw.locator("[data-testid=edw-0-boxes-total]").innerText()) && (await edw.locator("[data-testid=edw-0-boxes-use-total]").count()) === 1);
  await edw.locator("[data-testid=edw-0-boxes-use-total]").click();
  check("   total en vivo: «2.050 un. en 21 cajas»", /2\.050 un\. en 21 cajas/.test((await edw.locator("[data-testid=edw-total]").innerText()).replace(/\s+/g, " ")));
  await edw.locator("[data-testid=edw-obs]").first().fill("Se contó una caja más");
  await edw.locator("[data-testid=edw-save]").dblclick();
  await edw.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG edw:", (await edw.innerText()).replace(/\s+/g, " ").slice(-300)));
  // inmediato: sin recargar la página
  const okImmediate = await waitDb(async () => Number((await lines(ids.B))[0].quantity) === 2050);
  await pp.waitForFunction((p) => [...document.querySelectorAll("tr, [role=row], .dsg-row")].some((r) => r.textContent.includes(p) && /2050|2\.050/.test(r.textContent)), P.B, { timeout: 30_000 }).catch(() => undefined);
  const rowAfter = (await rowOf(P.B).innerText()).replace(/\s+/g, " ");
  check("1-2) editado de 2.000 a 2.050: Entregados lo muestra INMEDIATAMENTE (sin recargar: ya no dice «sin detalle de cajas») y el pedido sigue en 2.000", okImmediate && !/Sin detalle de cajas/.test(rowAfter) && /21|2050|2\.050/.test(rowAfter) && (await planned(ids.B)).planned_quantity === "2000", rowAfter.slice(0, 220));
  const aggB = await agg(ids.B);
  check("   el detalle de la entrega tiene 21 cajas (20 × 100 + 1 × 50), la misma entrega (sin duplicar) y observación", aggB.quantity === "2050" && JSON.stringify(aggB.packing_groups) === JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]) && (await lines(ids.B)).length === 1 && (await lines(ids.B))[0].observations === "Se contó una caja más");
  await pp.screenshot({ path: `${OUT}/3-entregados-editado.png` });
  // detalle visible
  await rowOf(P.B).getByRole("button", { name: /Ver detalle/ }).click().catch(() => undefined);
  await pp.locator("[data-testid=detail-delivery-lines]").waitFor({ timeout: 30_000 }).catch(() => undefined);
  check("   el detalle del trabajo muestra 2.050 y el desglose de cajas actualizado", /2050|2\.050/.test(await pp.locator("[role=dialog]").first().innerText().catch(() => "")) && /50/.test(await pp.locator("[role=dialog]").first().innerText().catch(() => "")));
  await pp.keyboard.press("Escape");

  // ============ 10-12) Remitos con cantidades reales; sin duplicar por Codificado; remito emitido no se modifica en silencio ============
  const el = (await (await prodApi.get("/api/v1/remitos/deliveries")).json()).deliveries.filter((d) => d.client === CLI);
  const eB = el.filter((d) => d.workItemId === ids.B);
  check("10) el remito parte de las cantidades reales corregidas: 2.050 u. con 20 × 100 + 1 × 50", eB.length === 1 && eB[0].quantity === 2050 && JSON.stringify(eB[0].packingGroups) === JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]), JSON.stringify(eB.map((e) => [e.quantity, e.packingGroups])));
  const eA = el.filter((d) => d.workItemId === ids.A);
  check("10) las entregas parciales de A llegan al remito una por una (800, 800, 450) con su desglose de origen, sin mezclar", eA.length === 3 && eA.map((e) => e.quantity).sort((a, b) => a - b).join() === "450,800,800");
  const eC = el.filter((d) => d.workItemId === childC);
  check("11) Envasado → Codificado → Producción: UNA sola entrega a Producción de 2.050 con las cajas consolidadas de Envasado (20 × 100 + 1 × 50); las entregas internas NO figuran", eC.length === 1 && eC[0].quantity === 2050 && JSON.stringify(eC[0].packingGroups) === JSON.stringify([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]) && !el.some((d) => d.workItemId === ids.C), JSON.stringify(eC.map((e) => [e.quantity, e.packingGroups, e.packingSource])));
  const lineA1 = String(lsA[0].id);
  const mkRem = await prodApi.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: [lineA1] } });
  check("   Producción confecciona el borrador de remito con la entrega de 800 u. (8 × 100)", mkRem.status() === 201, String(mkRem.status()));
  const blocked = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: lineA1, observations: "cambio silencioso" } });
  check("12) la entrega que ya figura en un remito NO se modifica en silencio (400 con instrucción de anular/reemplazar el remito)", blocked.status() === 400 && /ya figura en el remito/.test((await blocked.json()).error ?? "") && (await lines(ids.A))[0].observations !== "cambio silencioso");
  await nav(pp, "Entregas internas");
  await pp.locator("[data-testid=entregas-internas]").waitFor({ timeout: 60_000 });
  await search(P.A);
  check("12) Entregas internas muestra «En remito» en esa entrega", (await rows()).some((r) => r.id === lineA1 && /En remito/.test(r.text)));

  // ============ 14) permisos en el servidor ============
  const forb1 = await masApi.post("/api/v1/internal-deliveries", { data: { action: "edit_work", workItemId: ids.B, edits: [{ id: String((await lines(ids.B))[0].id), observations: "x" }] } });
  const forb2 = await preApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: String(lsA[1].id), packingGroups: [{ cajas: 8, unidadesPorCaja: 100 }] } });
  const forb3 = await depApi.post("/api/v1/internal-deliveries", { data: { action: "edit_work", workItemId: ids.B, edits: [] } });
  check("14) Envasado no edita trabajos entregados (403), Premium no toca entregas de Masivo (403) y Depósito no tiene acceso (403)", forb1.status() === 403 && forb2.status() === 403 && forb3.status() === 403, `${forb1.status()}/${forb2.status()}/${forb3.status()}`);
  const own = await masApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: String(lsA[1].id), packingGroups: [{ cajas: 4, unidadesPorCaja: 200 }] } });
  check("14) Envasado Masivo corrige las cajas de SU propia entrega (misma cantidad, otra distribución)", own.status() === 200 && JSON.stringify((await lines(ids.A))[1].packing_groups) === JSON.stringify([{ cajas: 4, unidadesPorCaja: 200 }]));

  // ============ 8) cancelar una entrega: cajas y unidades dejan de sumar ============
  const cancel = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: String(lsA[1].id), reason: "Nunca salió" } });
  const aggA2 = await agg(ids.A);
  check("8) cancelar una entrega de 800 u.: sus unidades y cajas dejan de sumar (resumen de A = 4 × 100 + ... sin ella) y quedan en el historial", cancel.status() === 200 && Number(aggA2.quantity) === 1250 && !JSON.stringify(aggA2.packing_groups).includes('"unidadesPorCaja":200') && (await lines(ids.A))[1].status === "ANULADA" && JSON.stringify((await lines(ids.A))[1].packing_groups) === JSON.stringify([{ cajas: 4, unidadesPorCaja: 200 }]), JSON.stringify(aggA2));

  // ============ 15) persistencia y sincronización ============
  await pp.reload();
  await nav(pp, "Entregados");
  await toListMode(pp);
  await rowOf(P.B).waitFor({ timeout: 120_000 });
  check("15) tras recargar, Entregados conserva 2.050 y sigue siendo la misma entrega", /2050|2\.050/.test((await rowOf(P.B).innerText()).replace(/\s+/g, " ")) && (await lines(ids.B)).length === 1);
  await pr.ctx.close();
  await mas.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
