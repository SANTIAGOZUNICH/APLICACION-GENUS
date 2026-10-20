// E2E (Chromium, TABLET, build de producción): «Generar remitos» desde entregas reales. Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/remitos-entregas";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-REM";
const A = "CLIENTE REM PILAR SA";
const B = "CLIENTE REM OTRO SA";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const bare = (id) => String(id).replace(/^native:/, "");

async function login(ctxOpts, user) {
  const ctx = await browser.newContext({ baseURL: BASE, ...ctxOpts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const tablet = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 };

async function cleanup() {
  await q("delete from remitos where client_display in ($1,$2)", [A, B]).catch(() => undefined);
  await q("delete from delivery_remito_mark_events where delivery_line_id in (select l.id from work_item_delivery_lines l join work_items w on w.id = l.work_item_id where w.notes like $1)", [`${TAG}%`]).catch(() => undefined);
  await q("delete from delivery_remito_marks where delivery_line_id in (select l.id from work_item_delivery_lines l join work_items w on w.id = l.work_item_id where w.notes like $1)", [`${TAG}%`]).catch(() => undefined);
  await q("delete from os_notifications where message like '%CLIENTE REM%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
}

try {
  await cleanup();
  await q("update work_items set operational_status = 'en_curso' where operational_status = 'revision' and notes not like $1", [`${TAG}%`]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error(`login: ${await lg.text()}`);
  const weekStart = mondayOf(TODAY);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
  const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E remitos" } })).json()).week.id;
  const ids = {};
  const create = async (key, client, product, qty) => {
    const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client, plannedQuantity: qty, unit: "un", product, sector: "ENVASADO_MASIVO", line: "Línea 1" } });
    if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
    ids[key] = bare((await res.json()).item.id);
  };
  await create("serum", A, "SERUM KOLLAREN REM", "500");
  await create("crema", A, "CREMA FACIAL REM", "1000");
  await create("gel", A, "GEL DE LIMPIEZA REM", "300");
  await create("otro", B, "TONICO REM", "200");
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  for (const id of Object.values(ids)) await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [id]);
  const deliver = async (key, qty, boxes) => {
    const res = await api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${ids[key]}`, actorSectorId: "PRODUCCION", deliverQuantity: qty, idempotencyKey: `rem-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "", deliveryPackingGroups: boxes } });
    if (!res.ok()) throw new Error(`entregar ${key}: ${res.status()} ${await res.text()}`);
  };
  await deliver("serum", null, [{ cajas: 5, unidadesPorCaja: 100 }]);
  await deliver("crema", 400, [{ cajas: 4, unidadesPorCaja: 100 }]);
  await deliver("gel", null, [{ cajas: 2, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 100 }]);
  await deliver("otro", null, [{ cajas: 2, unidadesPorCaja: 100 }]);

  const { ctx, page } = await login(tablet, E2E_USERS.produccion);
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  await page.getByRole("button", { name: /^Remitos$/ }).or(page.getByRole("link", { name: /^Remitos$/ })).first().click({ timeout: 120_000 });
  await page.locator("[data-testid=remitos-tab-generar]").click({ timeout: 60_000 });
  await page.locator("[data-testid=remitos-generar-row]").first().waitFor({ timeout: 60_000 });
  check("la pestaña «Generar remitos» lista las 4 entregas reales, agrupadas por cliente y fecha", (await page.locator("[data-testid=remitos-generar-row]").count()) === 4 && (await page.locator("[data-testid=remitos-generar-group]").count()) === 2);
  check("muestra cajas distintas por entrega (2 cajas de 100 + 1 caja de 100)", /3 cajas|2 cajas de 100/.test(await page.locator("[data-testid=remitos-generar-group]").first().innerText()));
  await page.screenshot({ path: `${OUT}/tablet-generar.png` });
  check("«Hacer remito» está deshabilitado sin selección", await page.locator("[data-testid=remitos-hacer]").isDisabled());

  // Un pedido (cliente Pilar) con tres productos: se eligen las tres entregas.
  const grpA = page.locator("[data-testid=remitos-generar-group]", { hasText: A });
  for (const r of await grpA.locator("[data-testid=remitos-generar-row]").all()) await r.locator("[data-testid=remitos-generar-check]").tap();
  await page.locator("[data-testid=remitos-hacer]").tap();
  const dlg = page.locator("[data-testid=remitos-preview-dialog]");
  await dlg.waitFor({ timeout: 30_000 });
  check("la vista previa muestra UN remito (un cliente y fecha) con los 3 productos y el total", (await dlg.locator("[data-testid=remitos-preview-group]").count()) === 1 && /SERUM KOLLAREN REM/.test(await dlg.innerText()) && /CREMA FACIAL REM/.test(await dlg.innerText()) && /GEL DE LIMPIEZA REM/.test(await dlg.innerText()) && /Total 1\.200 u\./.test(await dlg.innerText()));
  await page.screenshot({ path: `${OUT}/tablet-preview.png` });
  const confirmBtn = dlg.locator("[data-testid=remitos-confirmar]");
  await confirmBtn.tap();
  await page.locator("[data-testid=remitos-generar-notice]").waitFor({ timeout: 30_000 });
  const rem = await q("select id, status, total_units, client_display from remitos where client_display = $1", [A]);
  const remLines = rem[0] ? await q("select count(*)::int n from remito_lines where remito_id = $1", [rem[0].id]) : [{ n: 0 }];
  check("se guardó UN borrador con 3 renglones y 1.200 u. (entregas reales)", rem.length === 1 && rem[0].status === "BORRADOR" && Number(rem[0].total_units) === 1200 && remLines[0].n === 3);
  check("cada renglón conserva su entrega (trazabilidad cliente → pedido → producto → entrega)", (await q("select count(*)::int n from remito_lines where remito_id = $1 and payload->'trace'->>'deliveryLineId' is not null", [rem[0].id]))[0].n === 3);
  check("las entregas ya remitidas dejan de ofrecerse (no se duplican); queda solo la del otro cliente", (await page.locator("[data-testid=remitos-generar-row]").count()) === 1);
  // La entrega parcial y su saldo: nueva entrega de la crema (600) → es OTRA línea, sin repetir las 400.
  await deliver("crema", 600, [{ cajas: 6, unidadesPorCaja: 100 }]);
  await page.locator("[data-testid=remitos-tab-borradores]").click();
  await page.locator("[data-testid=remitos-tab-generar]").click();
  await page.waitForTimeout(1500);
  check("el saldo entregado después aparece aparte (600 u.), sin las 400 ya remitidas", (await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "CREMA FACIAL REM" }).count()) === 1 && /600/.test(await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "CREMA FACIAL REM" }).innerText()));
  // Doble solicitud directa a la API con la misma entrega ya remitida: se rechaza sin duplicar.
  const serumLine = (await q("select l.id from work_item_delivery_lines l where l.work_item_id = $1", [ids.serum]))[0].id;
  const dup = await api.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: [serumLine] } });
  check("reintento sobre una entrega ya remitida: rechazado, sin duplicar", dup.status() >= 400 && (await q("select count(*)::int n from remito_work_links where work_item_id = $1", [`dl:${serumLine}`]))[0].n === 1);
  // ── Selección múltiple, «Quitar de pendientes» y «Marcar como remito ya creado» (tablet, con el dedo) ──────────────────
  await page.locator("[data-testid=remitos-select-all]").tap();
  check("«Seleccionar todo lo visible» marca todas las entregas visibles", (await page.locator("[data-testid=remitos-generar-check]:checked").count()) === (await page.locator("[data-testid=remitos-generar-row]").count()) && (await page.locator("[data-testid=remitos-generar-row]").count()) >= 2);
  await page.locator("[data-testid=remitos-deselect]").tap();
  check("«Deseleccionar» limpia la selección", (await page.locator("[data-testid=remitos-generar-check]:checked").count()) === 0 && (await page.locator("[data-testid=remitos-hacer]").isDisabled()));
  const stock0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const remitos0 = (await q("select count(*)::int n from remitos"))[0].n;
  const lines0 = JSON.stringify(await q("select id, quantity, status, remito from work_item_delivery_lines where work_item_id = any($1::uuid[]) order by id", [Object.values(ids)]));
  const tonico = page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "TONICO REM" });
  await tonico.locator("[data-testid=remitos-generar-check]").tap();
  await page.locator("[data-testid=remitos-quitar]").tap();
  await page.locator("[data-testid=remitos-mark-dialog]").waitFor();
  check("«Quitar de pendientes» pide confirmación pero NO pide motivo", (await page.locator("[data-testid=remitos-mark-dialog] textarea, [data-testid=remitos-mark-dialog] input").count()) === 0);
  await page.locator("[data-testid=remitos-mark-confirmar]").dblclick();
  await page.locator("[data-testid=remitos-generar-notice]").filter({ hasText: /quitada/ }).waitFor({ timeout: 30_000 });
  check("la entrega quitada deja de ofrecerse para remito", (await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "TONICO REM" }).count()) === 0);
  const tonicoLine = (await q("select l.id from work_item_delivery_lines l where l.work_item_id = $1", [ids.otro]))[0].id;
  const m1 = await q("select mark, active, created_by from delivery_remito_marks where delivery_line_id = $1", [tonicoLine]);
  check("queda auditada la exclusión (usuario, un solo registro aun con doble toque)", m1.length === 1 && m1[0].mark === "EXCLUIDA" && m1[0].active === true && m1[0].created_by === E2E_USERS.produccion.email && (await q("select count(*)::int n from delivery_remito_mark_events where delivery_line_id = $1", [tonicoLine]))[0].n === 1);
  await page.locator("[data-testid=remitos-marcadas-toggle]").tap();
  check("la vista de quitadas muestra la entrega con su detalle de cajas", /TONICO REM/.test(await page.locator("[data-testid=remitos-marcadas]").innerText()) && /2 cajas de 100 u\./.test(await page.locator("[data-testid=remitos-marcadas]").innerText()));
  await page.locator("[data-testid=remitos-restaurar]").first().tap();
  await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "TONICO REM" }).waitFor({ timeout: 30_000 });
  check("«Restaurar» devuelve la entrega a pendientes (reversible)", (await q("select active from delivery_remito_marks where delivery_line_id = $1", [tonicoLine]))[0].active === false);
  await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "TONICO REM" }).locator("[data-testid=remitos-generar-check]").tap();
  await page.locator("[data-testid=remitos-ya-creado]").tap();
  await page.locator("[data-testid=remitos-ext-numero]").fill("0003-00001234");
  await page.locator("[data-testid=remitos-ext-obs]").fill("Hecho a mano");
  await page.locator("[data-testid=remitos-mark-confirmar]").tap();
  await page.locator("[data-testid=remitos-generar-notice]").filter({ hasText: /remito ya creado/ }).waitFor({ timeout: 30_000 });
  const m2 = await q("select mark, external_remito_number, notes from delivery_remito_marks where delivery_line_id = $1 and active", [tonicoLine]);
  check("«Marcar como remito ya creado» guarda número y observaciones, sin crear remito ni numeración interna", m2.length === 1 && m2[0].mark === "REMITO_EXTERNO" && m2[0].external_remito_number === "0003-00001234" && (await q("select count(*)::int n from remitos"))[0].n === remitos0 && (await q("select count(*)::int n from remito_work_links where work_item_id = $1", [`dl:${tonicoLine}`]))[0].n === 0);
  check("no cambia entregas, no mueve stock", JSON.stringify(await q("select id, quantity, status, remito from work_item_delivery_lines where work_item_id = any($1::uuid[]) order by id", [Object.values(ids)])) === lines0 && (await q("select count(*)::int n from mp_stock_movements"))[0].n === stock0);
  const admB = await login(tablet, E2E_USERS.administracion);
  const ctl = await (await admB.page.request.get(`/api/v1/billing/control?q=${encodeURIComponent(B)}`)).json();
  check("Control de facturación sigue mostrando la entrega y muestra el remito externo", JSON.stringify(ctl).includes("0003-00001234") && JSON.stringify(ctl).includes("TONICO REM"));
  const bd = await (await admB.page.request.get(`/api/v1/billing/deliveries?client=${encodeURIComponent(B)}`)).json();
  check("la entrega externa-remitada sigue facturable (cantidades sin cambios)", JSON.stringify(bd).includes("0003-00001234") && JSON.stringify(bd).includes('"quantity":200'));
  const aMark = await admB.page.request.post("/api/v1/remitos/deliveries/marks", { data: { action: "exclude", lineIds: [tonicoLine] } });
  check("Administración no puede marcar ni quitar entregas (403)", aMark.status() === 403, String(aMark.status()));
  await admB.ctx.close();
  if (!(await page.locator("[data-testid=remitos-restaurar]").first().isVisible().catch(() => false))) await page.locator("[data-testid=remitos-marcadas-toggle]").tap();
  await page.locator("[data-testid=remitos-restaurar]").first().tap();
  await page.locator("[data-testid=remitos-generar-row]").filter({ hasText: "TONICO REM" }).waitFor({ timeout: 30_000 });
  check("el remito externo también se revierte con confirmación y vuelve a pendientes", (await q("select active from delivery_remito_marks where delivery_line_id = $1", [tonicoLine]))[0].active === false);
  await page.screenshot({ path: `${OUT}/tablet-marcas.png` });

  // ── Ciclo de vida del remito (datos descartables) ───────────────────────────────────────────────────────────────────
  const mov0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const deliv0 = (await q("select coalesce(sum(quantity),0)::float8 n from work_item_delivery_lines where status = 'ACTIVA' and work_item_id = any($1::uuid[])", [Object.values(ids)]))[0].n;
  const gen = await api.patch(`/api/v1/remitos/${rem[0].id}`, { data: { action: "generate", displayName: "Remito Pilar E2E" } });
  const genBody = gen.ok() ? await gen.json() : { error: await gen.text() };
  const number1 = genBody.remito?.remitoNumber;
  check("generar el remito deja número y estado GENERADO", gen.ok() && /^R-\d{8}-/.test(number1 ?? "") && genBody.remito.status === "GENERADO", gen.ok() ? number1 : JSON.stringify(genBody).slice(0, 200));
  const lineNums = await q("select remito from work_item_delivery_lines where id in (select (payload->'trace'->>'deliveryLineId')::uuid from remito_lines where remito_id = $1)", [rem[0].id]);
  check("el número del remito queda asociado a sus 3 entregas", lineNums.length === 3 && lineNums.every((r) => r.remito === number1));
  check("generar un remito no mueve stock ni cambia lo entregado", (await q("select count(*)::int n from mp_stock_movements"))[0].n === mov0 && (await q("select coalesce(sum(quantity),0)::float8 n from work_item_delivery_lines where status = 'ACTIVA' and work_item_id = any($1::uuid[])", [Object.values(ids)]))[0].n === deliv0);
  const del1 = await api.delete(`/api/v1/remitos/${rem[0].id}`);
  check("un remito GENERADO no se puede borrar (solo anular)", del1.status() >= 400 && (await q("select 1 from remitos where id = $1", [rem[0].id])).length === 1);
  const ann = await api.patch(`/api/v1/remitos/${rem[0].id}`, { data: { action: "annul", motivo: "E2E" } });
  check("anular un remito generado (queda ANULADO, no se borra)", ann.ok() && (await q("select status from remitos where id = $1", [rem[0].id]))[0].status === "ANULADO");
  check("al anular, las entregas se liberan (sin ese número) y vuelven a ofrecerse", (await q("select count(*)::int n from work_item_delivery_lines where remito = $1", [number1]))[0].n === 0 && (await (await api.get("/api/v1/remitos/deliveries")).json()).deliveries.filter((d) => d.client === A).length >= 3);
  const again = await api.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: (await (await api.get("/api/v1/remitos/deliveries")).json()).deliveries.filter((d) => d.client === A).map((d) => d.deliveryLineId) } });
  const againBody = await again.json();
  check("un remito nuevo para las mismas entregas NO reutiliza la numeración anulada", again.status() === 201 && againBody.remitos.length === 1 && againBody.remitos[0].version === 2, JSON.stringify(againBody).slice(0, 200));
  const draft2 = againBody.remitos?.[0]?.id;
  const delDraft = await api.delete(`/api/v1/remitos/${draft2}`);
  check("un BORRADOR sí se elimina y libera sus entregas", delDraft.ok() && (await q("select 1 from remitos where id = $1", [draft2])).length === 0 && (await (await api.get("/api/v1/remitos/deliveries")).json()).deliveries.filter((d) => d.client === A).length >= 3);
  check("el remito anulado se conserva para auditoría", (await q("select status from remitos where id = $1", [rem[0].id]))[0].status === "ANULADO");
  await ctx.close();

  // Producción ve la pestaña «Órdenes de Acondicionamiento».
  const oaUser = await login({ viewport: { width: 1440, height: 900 } }, E2E_USERS.produccion);
  await oaUser.page.getByRole("button", { name: /^Órdenes de Acondicionamiento$/ }).or(oaUser.page.getByRole("link", { name: /^Órdenes de Acondicionamiento$/ })).first().click({ timeout: 60_000 });
  await oaUser.page.getByText(/Órdenes de Acondicionamiento/).first().waitFor({ timeout: 60_000 });
  check("Producción tiene la pestaña «Órdenes de Acondicionamiento» con su buscador", (await oaUser.page.getByPlaceholder(/Número, producto, código, cliente, lote/).count()) >= 1);
  await oaUser.ctx.close();

  // Permisos: solo Producción crea; Administración consulta pero no escribe; el resto no accede.
  const adm = await login(tablet, E2E_USERS.administracion);
  const aGet = await adm.page.request.get("/api/v1/remitos/deliveries");
  const aPost = await adm.page.request.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: [serumLine] } });
  check("Administración consulta las entregas pendientes de remito (200) pero no crea (403)", aGet.status() === 200 && aPost.status() === 403, `${aGet.status()}/${aPost.status()}`);
  const aList = await adm.page.request.get("/api/v1/remitos?tab=borradores");
  check("Administración puede consultar remitos", aList.status() === 200, String(aList.status()));
  const rid = rem[0].id;
  const aDel = await adm.page.request.delete(`/api/v1/remitos/${rid}`);
  check("Administración NO puede eliminar ni anular remitos", aDel.status() === 403, String(aDel.status()));
  await adm.ctx.close();
  const el = await login(tablet, E2E_USERS.elaboracion);
  check("Elaboración no accede a las entregas pendientes de remito (403)", (await el.page.request.get("/api/v1/remitos/deliveries")).status() === 403);
  await el.ctx.close();
  await api.dispose();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
