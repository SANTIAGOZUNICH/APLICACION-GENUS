// E2E en Chromium real: ENTREGAS INTERNAS — entregar más de lo pedido, editar y cancelar, desde los sectores y desde Producción.
// Base DESCARTABLE; logins reales. Ver run-entregas-internas-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/entregas-internas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-EINT";
const CLI = "AQUALO E2E EINT";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const lines = (id) => q("select id, quantity, status, kind, cumulative_after, pending_after, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
const transfers = (id) => q("select id, seq, quantity, cumulative, status, note from work_item_codificado_transfers where work_item_id = $1 order by seq", [id]);
const wi = async (id) => (await q("select operational_status, planned_quantity, finished_qty, sample_units from work_items where id = $1", [id]))[0];
const changesOf = (deliveryId) => q("select action, old_quantity, new_quantity, old_observations, new_observations, reason, actor_email, actor_sector, finished_before, finished_after from internal_delivery_changes where delivery_id = $1 order by created_at", [deliveryId]);
const ids = {};
const PRODUCTS = { A: "SERUM CAPILAR EINT-A", B: "SHAMPOO EINT-B", C: "CREMA EINT-C", D: "TONICO EINT-D", E: "GEL EINT-E" };

async function login(user, viewport = { width: 1500, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, hasTouch: viewport.width < 900 });
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
const openInternas = async (page) => {
  await nav(page, "Entregas internas").catch(async () => { await page.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => undefined); await nav(page, "Entregas internas"); });
  await page.locator("[data-testid=entregas-internas]").waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => !/Cargando/.test(document.querySelector("[data-testid=ei-count]")?.textContent ?? "Cargando"), null, { timeout: 60_000 });
};
const rowsOf = async (page) => page.evaluate(() => [...document.querySelectorAll("[data-testid=ei-row]")].map((r) => ({ id: r.getAttribute("data-delivery-id"), kind: r.getAttribute("data-kind"), status: r.getAttribute("data-status"), text: r.textContent.replace(/\s+/g, " ").trim(), client: r.querySelector("[data-testid=ei-client]")?.textContent, product: r.querySelector("[data-testid=ei-product]")?.textContent, qty: r.querySelector("[data-testid=ei-qty]")?.textContent, obs: r.querySelector("[data-testid=ei-observations]")?.textContent, hasEdit: Boolean(r.querySelector("[data-testid=ei-edit]")), hasCancel: Boolean(r.querySelector("[data-testid=ei-cancel]")) })));
const rowFor = (page, product, nth = 0) => page.locator("[data-testid=ei-row]").filter({ hasText: product }).nth(nth);
const search = async (page, text) => { await page.locator("[data-testid=ei-search]").fill(text); await page.waitForTimeout(700); await page.waitForFunction(() => !/Cargando/.test(document.querySelector("[data-testid=ei-count]")?.textContent ?? ""), null, { timeout: 30_000 }); };
const card = (page, product) => page.locator("[data-testid=work-item-card]", { hasText: product }).first();
const num = (t) => Number(String(t).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E entregas internas" } })).json()).week.id;
  const mk = async (sector, product) => {
    const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client: CLI, plannedQuantity: "2000", unit: "un.", product, sector, line: "Línea 1", packagingLote: "L-EINT" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.A = await mk("ENVASADO_MASIVO", PRODUCTS.A);
  ids.B = await mk("ENVASADO_PREMIUM", PRODUCTS.B);
  ids.C = await mk("ENVASADO_MASIVO", PRODUCTS.C);
  ids.D = await mk("ENVASADO_MASIVO", PRODUCTS.D);
  ids.E = await mk("ENVASADO_PREMIUM", PRODUCTS.E);
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);

  const masApi = await apiAs(E2E_USERS.envasado);
  const preApi = await apiAs(E2E_USERS.envasadoPremium);
  const codApi = await apiAs(E2E_USERS.codificado);
  const deliverApi = (api, sector, id, qty) => api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${id}`, actorSectorId: sector, deliverQuantity: qty, partial: true, idempotencyKey: `eint-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: sector, product: "" } });
  const transferApi = (api, id, qty, finished, obs = null) => api.post(`/api/v1/work-items/${id}/codificado`, { data: { action: "transfer", quantity: qty, finishedQty: finished, observation: obs, idempotencyKey: randomUUID() } });

  // ============ 1-4) Envasado Masivo entrega 2.050 de un pedido de 2.000 DESDE LA PANTALLA ============
  await q("update work_items set finished_qty = '2050' where id = $1", [ids.A]);
  const mas = await login(E2E_USERS.envasado);
  const mp = mas.page;
  await card(mp, PRODUCTS.A).waitFor({ timeout: 120_000 });
  await q("update work_items set finished_qty = '2050', version = version + 1 where id = $1", [ids.A]);
  await mp.reload();
  await card(mp, PRODUCTS.A).waitFor({ timeout: 120_000 });
  await card(mp, PRODUCTS.A).getByRole("button", { name: "Entregar parcial" }).click();
  const dlg = mp.locator("[data-testid=deliver-work-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  await dlg.locator("[data-testid=deliver-quantity]").fill("2050");
  await dlg.locator("[data-testid=deliver-observations]").fill("50 unidades de más");
  await dlg.locator("[data-testid=confirm-deliver]").dblclick();
  await dlg.waitFor({ state: "detached", timeout: 30_000 }).catch(async () => console.log("DEBUG diálogo:", (await dlg.innerText()).replace(/\s+/g, " ").slice(-300)));
  check("1) pedido 2.000 → Envasado Masivo entrega 2.050 desde la pantalla (doble clic: una sola entrega)", await waitDb(async () => (await lines(ids.A)).length === 1) && Number((await lines(ids.A))[0].quantity) === 2050);
  let st = await wi(ids.A);
  check("   el trabajo queda entregado, sin pendiente negativo, y la cantidad pedida sigue en 2.000", st.operational_status === "entregado" && String(st.planned_quantity) === "2000" && Number((await lines(ids.A))[0].pending_after) === 0, JSON.stringify(st));
  check("3) la observación opcional «50 unidades de más» quedó en la entrega", (await lines(ids.A))[0].observations === "50 unidades de más");

  // Entregas parciales 1.000 + 800 + 250 (Premium) por la misma ruta de la pantalla
  await q("update work_items set finished_qty = '2050' where id = $1", [ids.B]);
  const r1 = await deliverApi(preApi, "ENVASADO_PREMIUM", ids.B, 1000);
  const r2 = await deliverApi(preApi, "ENVASADO_PREMIUM", ids.B, 800);
  const r3 = await deliverApi(preApi, "ENVASADO_PREMIUM", ids.B, 250);
  check("2) entregas parciales 1.000 + 800 + 250 = 2.050: las tres se aceptan y se completa", [r1, r2, r3].every((r) => r.status() === 200) && (await lines(ids.B)).length === 3 && (await wi(ids.B)).operational_status === "entregado");

  // Trabajo C: entrega de 2.000 (para editarla a 2.050 desde la pantalla)
  await q("update work_items set finished_qty = '2000' where id = $1", [ids.C]);
  check("   (preparación) entrega de 2.000 en el trabajo C", (await deliverApi(masApi, "ENVASADO_MASIVO", ids.C, 2000)).status() === 200);
  // Trabajo D: dos entregas a Codificado 800 + 700 (movimiento interno)
  const t1 = await transferApi(masApi, ids.D, 800, 800);
  const t2 = await transferApi(masApi, ids.D, 700, 1500);
  check("   (preparación) entregas a Codificado 800 + 700", t1.status() === 200 && t2.status() === 200 && (await transfers(ids.D)).length === 2);
  // Trabajo E: 1.000 a Codificado y Codificado ya procesó 900
  check("   (preparación) E: 1.000 entregados a Codificado", (await transferApi(preApi, ids.E, 1000, 1000)).status() === 200);
  const childE = String((await q("select id from work_items where parent_work_item_id = $1", [ids.E]))[0].id);
  const prog = await codApi.post(`/api/v1/work-items/${childE}/codificado`, { data: { action: "progress", codedUnits: 900 } });
  check("   (preparación) Codificado ya procesó 900", prog.status() === 200, String(prog.status()));

  // ============ 4) El informe: 2.050 entregadas, sin columnas de excedente ============
  await openInternas(mp);
  await search(mp, PRODUCTS.A);
  let rows = await rowsOf(mp);
  const rowA = rows.find((r) => r.product === PRODUCTS.A);
  check("4) el informe muestra Cliente, Producto y «2.050 un.» como entrega normal", rowA && rowA.client === CLI && num(rowA.qty) === 2050 && rowA.obs.trim() === "50 unidades de más", JSON.stringify(rowA));
  const headers = (await mp.locator("[data-testid=ei-table] thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
  check("   sin columnas ni textos de excedente / sobreproducción / unidades adicionales", !/exced|sobrepro|adicional/i.test(headers.join(" ") + (await mp.locator("[data-testid=ei-table]").innerText())), headers.join(" | "));
  await mp.screenshot({ path: `${OUT}/1-envasado-informe.png` });

  // ============ 5) Editar 2.000 → 2.050 (con doble clic) ============
  await search(mp, PRODUCTS.C);
  await rowFor(mp, PRODUCTS.C).locator("[data-testid=ei-edit]").click();
  const ed = mp.locator("[data-testid=ei-edit-dialog]");
  await ed.waitFor({ timeout: 15_000 });
  const edText = (await ed.innerText()).replace(/\s+/g, " ");
  check("   el diálogo muestra cliente, producto, lote y origen→destino de solo lectura", /AQUALO E2E EINT/.test(edText) && /CREMA EINT-C/.test(edText) && /Lote/i.test(edText) && /Envasado Masivo → Producción/.test(edText), edText.slice(0, 260));
  check("   solo permite modificar cantidad y observaciones", (await ed.locator("input, textarea").count()) === 2);
  await ed.locator("[data-testid=ei-edit-qty]").fill("2050");
  await ed.locator("[data-testid=ei-edit-obs]").fill("50 unidades de más");
  await ed.locator("[data-testid=ei-edit-save]").dblclick();
  await mp.locator("[data-testid=ei-toast]").waitFor({ timeout: 15_000 });
  const lC = (await lines(ids.C))[0];
  check("5) editada de 2.000 a 2.050: totales actualizados, trabajo entregado, pedido intacto, una sola modificación (doble clic)", Number(lC.quantity) === 2050 && Number(lC.cumulative_after) === 2050 && (await wi(ids.C)).operational_status === "entregado" && (await wi(ids.C)).planned_quantity === "2000" && (await changesOf(lC.id)).length === 1);
  const chC = (await changesOf(lC.id))[0];
  check("16) trazabilidad: antes/después, usuario, sector y las realizadas declaradas", chC.old_quantity === 2000 && chC.new_quantity === 2050 && chC.new_observations === "50 unidades de más" && chC.actor_email === E2E_USERS.envasado.email && chC.actor_sector === "ENVASADO_MASIVO" && chC.finished_before === "2000" && chC.finished_after === "2050", JSON.stringify(chC));
  rows = await rowsOf(mp);
  check("   la lista muestra 2.050, observaciones y «editada»", num(rows.find((r) => r.product === PRODUCTS.C).qty) === 2050 && /editada/.test(rows.find((r) => r.product === PRODUCTS.C).text));
  await rowFor(mp, PRODUCTS.C).locator("[data-testid=ei-history]").click();
  const hist = mp.locator("[data-testid=ei-history-dialog]");
  await hist.waitFor();
  await hist.locator("[data-testid=ei-history-entry]").first().waitFor();
  check("   el historial muestra quién, sector, fecha y 2.000 → 2.050", /2\.000 → 2\.050/.test(await hist.innerText()) && /Envasado Masivo/.test(await hist.innerText()) && /E2E Envasado/.test(await hist.innerText()));
  await mp.keyboard.press("Escape");

  // ============ permisos desde la pantalla: Masivo no ve ni edita lo de Premium ============
  await search(mp, "EINT");
  rows = await rowsOf(mp);
  check("14) Envasado Masivo ve SOLO sus entregas (ninguna de Premium)", rows.length >= 3 && rows.every((r) => !/Premium/.test(r.text.replace(/Origen.*/, "")) || /Envasado Masivo →/.test(r.text)) && !rows.some((r) => [PRODUCTS.B, PRODUCTS.E].includes(r.product)), rows.map((r) => r.product).join(","));
  const premiumLine = String((await lines(ids.B))[0].id);
  const forbidden = await masApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: premiumLine, quantity: 5 } });
  check("14) el servidor rechaza (403) que Masivo edite una entrega de Premium aunque llame a la API directo", forbidden.status() === 403 && Number((await lines(ids.B))[0].quantity) === 1000);
  const depApi = await apiAs(E2E_USERS.deposito);
  check("14) Depósito no puede consultar ni modificar (403)", (await depApi.get("/api/v1/internal-deliveries")).status() === 403 && (await depApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: premiumLine, reason: "x" } })).status() === 403);
  const calApi = await apiAs(E2E_USERS.calidad);
  check("14) Calidad tampoco (403)", (await calApi.get("/api/v1/internal-deliveries")).status() === 403);
  await mas.ctx.close();

  // ============ Producción: ve todo; edita 700 → 900; cancela una de 800 ============
  const pr = await login(E2E_USERS.produccion);
  const pp = pr.page;
  await openInternas(pp);
  await search(pp, "EINT");
  rows = await rowsOf(pp);
  const sectors = new Set(rows.map((r) => (/Envasado Premium →/.test(r.text) ? "P" : /Envasado Masivo →/.test(r.text) ? "M" : "?")));
  check("10) Producción ve las entregas de TODOS los sectores (Masivo y Premium, a Producción y a Codificado)", sectors.has("M") && sectors.has("P") && rows.some((r) => r.kind === "CODIFICADO") && rows.some((r) => r.kind === "PRODUCCION"), `${rows.length} filas`);
  await pp.locator("[data-testid=ei-sector]").selectOption("ENVASADO_PREMIUM");
  await pp.waitForTimeout(800);
  check("   filtro por sector (solo Premium)", (await rowsOf(pp)).every((r) => /Envasado Premium →/.test(r.text)) && (await rowsOf(pp)).length >= 3);
  await pp.locator("[data-testid=ei-sector]").selectOption("");
  await search(pp, PRODUCTS.D);
  rows = await rowsOf(pp);
  check("   búsqueda por producto + muestra las entregas a Codificado de D (800 y 700)", rows.length === 2 && rows.map((r) => num(r.qty)).sort((a, b) => a - b).join() === "700,800");
  const t2Row = rows.find((r) => num(r.qty) === 700);
  await pp.locator(`[data-delivery-id="${t2Row.id}"] [data-testid=ei-edit]`).click();
  const ed2 = pp.locator("[data-testid=ei-edit-dialog]");
  await ed2.locator("[data-testid=ei-edit-qty]").fill("900");
  await ed2.locator("[data-testid=ei-edit-save]").click();
  await pp.locator("[data-testid=ei-toast]").waitFor({ timeout: 15_000 });
  check("6) Producción edita la 2.ª entrega a Codificado de 700 a 900 → 1.700 recibidas", (await transfers(ids.D)).map((t) => Number(t.quantity)).join() === "800,900");
  const childD = String((await q("select id from work_items where parent_work_item_id = $1", [ids.D]))[0].id);
  const viewD = await (await codApi.get(`/api/v1/work-items/${childD}/codificado`)).json();
  const received = viewD.view?.summary?.received ?? viewD.summary?.received;
  const inbox = (await (await codApi.get("/api/v1/codificado-transfers")).json()).items.filter((i) => i.workItemId === ids.D).map((i) => i.quantity).sort((a, b) => a - b);
  check("9) Codificado recibe las cantidades corregidas (1.700 recibidas; bandeja 800 + 900)", received === 1700 && inbox.join() === "800,900", `received=${received} inbox=${inbox}`);
  // cancelar la de 800 con confirmación y motivo
  const t1Row = (await rowsOf(pp)).find((r) => num(r.qty) === 800);
  await pp.locator(`[data-delivery-id="${t1Row.id}"] [data-testid=ei-cancel]`).click();
  const cd = pp.locator("[data-testid=ei-cancel-dialog]");
  await cd.locator("[data-testid=ei-cancel-confirm]").click();
  check("7) cancelar exige un motivo (sin motivo no se cancela)", (await cd.locator("[data-testid=ei-cancel-error]").count()) === 1 && (await transfers(ids.D))[0].status === "ACTIVA");
  await cd.locator("[data-testid=ei-cancel-reason]").fill("Nunca se entregó");
  await cd.locator("[data-testid=ei-cancel-confirm]").dblclick();
  await pp.locator("[data-testid=ei-toast]").filter({ hasText: /cancelada/i }).waitFor({ timeout: 15_000 });
  const tr = await transfers(ids.D);
  check("7) la entrega de 800 queda CANCELADA (no se borra) y las recibidas pasan a 900", tr.length === 2 && tr[0].status === "ANULADA" && Number(tr[1].cumulative) === 900);
  const viewD2 = await (await codApi.get(`/api/v1/work-items/${childD}/codificado`)).json();
  check("8) totales recalculados en Codificado (900 recibidas) y en Producción", (viewD2.view?.summary?.received ?? viewD2.summary?.received) === 900);
  const cancelledRow = (await rowsOf(pp)).find((r) => r.id === t1Row.id);
  check("   la cancelada sigue visible en el historial como «Cancelada» con el motivo, sin botones de acción", cancelledRow.status === "CANCELADA" && /Cancelada · Nunca se entregó/.test(cancelledRow.text) && !cancelledRow.hasEdit && !cancelledRow.hasCancel);
  check("16) auditoría de la cancelación (motivo, usuario, sector)", (await changesOf(t1Row.id))[0]?.reason === "Nunca se entregó" && (await changesOf(t1Row.id))[0]?.actor_sector === "PRODUCCION");
  await pp.screenshot({ path: `${OUT}/2-produccion-entregas-internas.png` });

  // ============ 11) protección: Codificado ya procesó 900 de 1.000 ============
  await search(pp, PRODUCTS.E);
  const eRow = (await rowsOf(pp))[0];
  await pp.locator(`[data-delivery-id="${eRow.id}"] [data-testid=ei-edit]`).click();
  const ed3 = pp.locator("[data-testid=ei-edit-dialog]");
  await ed3.locator("[data-testid=ei-edit-qty]").fill("500");
  await ed3.locator("[data-testid=ei-edit-save]").click();
  const msg = await ed3.locator("[data-testid=ei-edit-error]").innerText();
  check("11) no se puede reducir 1.000 → 500 si Codificado ya procesó 900 (mensaje claro, nada cambia)", /No se puede reducir esta entrega porque Codificado ya procesó 900 unidades/.test(msg) && Number((await transfers(ids.E))[0].quantity) === 1000, msg);
  await pp.keyboard.press("Escape");
  const cancelBlocked = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "CODIFICADO", id: eRow.id, reason: "x" } });
  check("11) tampoco se puede cancelar (400) y la entrega sigue vigente", cancelBlocked.status() === 400 && (await transfers(ids.E))[0].status === "ACTIVA");

  // ============ 13) ediciones simultáneas ============
  const lineB = String((await lines(ids.B))[0].id);
  const [ra, rb] = await Promise.all([
    prodApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: lineB, quantity: 1100, expectedVersion: 0 } }),
    preApi.post("/api/v1/internal-deliveries", { data: { action: "edit", kind: "PRODUCCION", id: lineB, quantity: 1200, expectedVersion: 0 } }),
  ]);
  check("13) dos ediciones simultáneas de la misma entrega: una se aplica y la otra se rechaza (409)", [ra.status(), rb.status()].sort().join() === "200,409" && (await changesOf(lineB)).length === 1);

  // ============ 15) persistencia tras recargar ============
  await pp.reload();
  await openInternas(pp);
  await search(pp, PRODUCTS.D);
  const after = await rowsOf(pp);
  check("15) tras recargar se conservan las cantidades, estados y observaciones", after.length === 2 && after.some((r) => r.status === "CANCELADA" && num(r.qty) === 800) && after.some((r) => r.status === "ACTIVA" && num(r.qty) === 900));
  await pr.ctx.close();

  // ============ Codificado y tablet ============
  const cod = await login(E2E_USERS.codificado, { width: 1024, height: 768 });
  await openInternas(cod.page);
  check("14) Codificado ve su propia sección (sin entregas de Envasado) y no puede editar las ajenas", (await rowsOf(cod.page)).every((r) => !r.hasEdit) && (await cod.page.locator("[data-testid=ei-empty], [data-testid=ei-row]").count()) >= 1);
  await cod.page.screenshot({ path: `${OUT}/3-codificado-tablet.png` });
  await cod.ctx.close();

  // ============ 17-19) nada cambió fuera de las entregas internas ============
  const planned = await q("select planned_quantity, sample_units from work_items where id = any($1::uuid[]) order by planned_quantity", [[ids.A, ids.B, ids.C, ids.D, ids.E]]);
  check("17) las cantidades originales del pedido siguen en 2.000 en todos los trabajos", planned.every((r) => String(r.planned_quantity) === "2000"));
  const ext = await q("select count(*)::int n from work_item_deliveries where work_item_id = any($1::uuid[]) and status = 'ENTREGADO'", [[ids.D, ids.E]]);
  check("18) las entregas a Codificado no generaron entregas externas ni movimientos de stock de Depósito", Number(ext[0].n) === 0 && Number((await q("select count(*)::int n from inv_me_salidas where payload->>'comentarios' like $1", [`%${TAG}%`]))[0].n) === 0);
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
