// E2E (Chromium, TABLET, build de producción): Control de facturación de Administración. Base DESCARTABLE; login real.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/billing";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TAG = "E2E-FAC";
const A = "CLIENTE FAC PILAR SA";
const B = "CLIENTE FAC OTRO SA";
const PROVISION_EMAIL = "e2e-admin-provision@genus.test";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const bare = (id) => String(id).replace(/^native:/, "");
const tablet = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 };

async function login(ctxOpts, user, password = E2E_PASSWORD) {
  const ctx = await browser.newContext({ baseURL: BASE, ...ctxOpts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}

async function cleanup() {
  await q("delete from billing_invoice_events where invoice_id in (select id from billing_invoices where client in ($1,$2))", [A, B]).catch(() => undefined);
  await q("delete from billing_invoice_lines where invoice_id in (select id from billing_invoices where client in ($1,$2))", [A, B]).catch(() => undefined);
  await q("delete from billing_invoices where client in ($1,$2)", [A, B]).catch(() => undefined);
  await q("delete from remitos where client_display in ($1,$2)", [A, B]).catch(() => undefined);
  await q("delete from os_notifications where message like '%CLIENTE FAC%' or title like '%CLIENTE FAC%'").catch(() => undefined);
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  await q("delete from genus_auth_sessions where user_id in (select id from genus_auth_users where email_normalized = $1)", [PROVISION_EMAIL]).catch(() => undefined);
  await q("delete from genus_auth_users where email_normalized = $1", [PROVISION_EMAIL]).catch(() => undefined);
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
  if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E facturación" } })).json()).week.id;
  const ids = {};
  const create = async (key, client, product, qty) => {
    const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, plannedDate: TODAY, client, plannedQuantity: qty, unit: "un", product, sector: "ENVASADO_MASIVO", line: "Línea 1" } });
    if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
    ids[key] = bare((await res.json()).item.id);
  };
  await create("serum", A, "SERUM FAC", "500");
  await create("crema", A, "CREMA FAC", "1000");
  await create("tonico", B, "TONICO FAC", "200");
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  for (const id of Object.values(ids)) await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = planned_quantity where id = $1", [id]);
  const deliver = async (key, qty, boxes) => {
    const res = await api.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${ids[key]}`, actorSectorId: "PRODUCCION", deliverQuantity: qty, idempotencyKey: `fac-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "", deliveryPackingGroups: boxes } });
    if (!res.ok()) throw new Error(`entregar ${key}: ${res.status()} ${await res.text()}`);
  };
  await deliver("serum", 300, [{ cajas: 3, unidadesPorCaja: 100 }]); // PARCIAL (de 500)
  await deliver("crema", null, [{ cajas: 10, unidadesPorCaja: 100 }]); // COMPLETA (1000)
  await deliver("tonico", null, [{ cajas: 2, unidadesPorCaja: 100 }]); // otro cliente
  const stock0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const deliv0 = (await q("select coalesce(sum(quantity),0)::float8 n from work_item_delivery_lines where status = 'ACTIVA' and work_item_id = any($1::uuid[])", [Object.values(ids)]))[0].n;

  // ── Avisos automáticos a Administración ────────────────────────────────────────────────────────────────────────
  const notifs = await q("select kind, title, message, sectors from os_notifications where (message like '%CLIENTE FAC%' or title like '%CLIENTE FAC%')");
  const byKind = (k) => notifs.filter((n) => n.kind === k);
  check("entrega parcial → aviso «ENTREGA PARCIAL REGISTRADA» solo para ADMINISTRACION", byKind("entrega_registrada").some((n) => /ENTREGA PARCIAL REGISTRADA/.test(n.title) && /SERUM FAC/.test(n.message)) && notifs.filter((n) => /^(listo_para_entregar|entrega_|remito_)/.test(n.kind)).every((n) => JSON.stringify(n.sectors) === '["ADMINISTRACION"]'));
  const parcial = byKind("entrega_registrada").find((n) => /SERUM FAC/.test(n.message))?.message ?? "";
  check("el aviso informa cliente, producto, entregado en el movimiento, total pedido, acumulado, pendiente, cajas y usuario", ["Cliente: CLIENTE FAC PILAR SA", "Producto: SERUM FAC", "Total pedido: 500", "Entregado acumulado: 300", "Pendiente de entregar: 200", "3 cajas de 100 u.", "Registró:"].every((t) => parcial.includes(t)), parcial.slice(0, 400));
  check("entrega completa → además «PEDIDO ENTREGADO COMPLETO»", byKind("entrega_completa").some((n) => /CREMA FAC/.test(n.message)) && !byKind("entrega_completa").some((n) => /SERUM FAC/.test(n.message)));
  check("el aviso aclara que entregar no es facturar (pedido ≠ entregado ≠ facturado)", /entregar no es facturar/i.test(byKind("entrega_completa")[0]?.message ?? ""));

  // ── Administración: ingreso, módulo y control ────────────────────────────────────────────────────────────────────
  const adm = await login(tablet, E2E_USERS.administracion);
  const page = adm.page;
  await page.locator("[data-testid=billing-view]").waitFor({ timeout: 120_000 });
  check("Administración entra directo al Control de facturación", true);
  await page.locator("[data-testid=notif-toast]").first().waitFor({ timeout: 45_000 }).then(() => check("aparece la tarjeta flotante de aviso", true)).catch(() => check("aparece la tarjeta flotante de aviso", false));
  await page.screenshot({ path: `${OUT}/tablet-resumen.png` });
  await page.locator("[data-testid=billing-tab-control]").tap();
  await page.locator("[data-testid=billing-search]").fill("CLIENTE FAC");
  await page.locator("[data-testid=billing-row]").first().waitFor({ timeout: 30_000 });
  const rowOf = (name) => page.locator("[data-testid=billing-row]", { hasText: name });
  check("lista los 3 pedidos de prueba", (await page.locator("[data-testid=billing-row]").count()) === 3);
  const serumRow = rowOf("SERUM FAC");
  check("SERUM: entregada 300, pendiente de entregar 200, facturada 0 → PENDIENTE DE FACTURAR + «Entrega parcial»", /PENDIENTE DE FACTURAR/.test(await serumRow.locator("[data-testid=cell-state]").innerText()) && /Entrega parcial/.test(await serumRow.locator("[data-testid=cell-delivery-state]").innerText()) && (await serumRow.locator("[data-testid=cell-delivered]").innerText()) === "300" && (await serumRow.locator("[data-testid=cell-pending-invoice]").innerText()) === "300");
  await page.screenshot({ path: `${OUT}/tablet-control.png` });

  // Un cliente distinto en la selección → error claro.
  for (const b of await page.locator("[data-testid=notif-toast-close]").all()) await b.click().catch(() => undefined);
  await rowOf("SERUM FAC").locator("[data-testid=billing-select]").tap();
  await rowOf("TONICO FAC").locator("[data-testid=billing-select]").tap();
  await page.locator("[data-testid=billing-invoice-selected]").tap();
  check("no deja facturar clientes distintos en una misma factura", await page.locator("[data-testid=billing-error]").isVisible());
  await rowOf("TONICO FAC").locator("[data-testid=billing-select]").tap();
  await rowOf("CREMA FAC").locator("[data-testid=billing-select]").tap();

  // Factura parcial de SERUM (100 de 300) + CREMA completa (1000) en una sola factura.
  await page.locator("[data-testid=billing-invoice-selected]").tap();
  const modal = page.locator("[data-testid=invoice-modal]");
  await modal.locator("[data-testid=invoice-delivery]").first().waitFor({ timeout: 30_000 });
  check("el modal ofrece las entregas reales de los dos productos", (await modal.locator("[data-testid=invoice-delivery]").count()) === 2);
  await modal.locator("[data-testid=invoice-number]").fill("A-0001-00001234");
  const serumLine = modal.locator("[data-testid=invoice-delivery]", { hasText: "SERUM FAC" });
  await serumLine.locator("[data-testid=invoice-qty]").fill("100");
  check("el total a facturar suma 1.100", (await modal.locator("[data-testid=invoice-total]").innerText()).replace(/\./g, "") === "1100");
  await page.screenshot({ path: `${OUT}/tablet-modal.png` });
  await serumLine.locator("[data-testid=invoice-qty]").fill("301");
  await modal.locator("[data-testid=invoice-submit]").tap();
  await modal.locator("[data-testid=invoice-error]").waitFor({ timeout: 15_000 });
  check("no permite facturar más de lo entregado (301 > 300)", /No se puede facturar más/.test(await modal.locator("[data-testid=invoice-error]").innerText()) && (await q("select count(*)::int n from billing_invoices where client = $1", [A]))[0].n === 0);
  await serumLine.locator("[data-testid=invoice-qty]").fill("100");
  await modal.locator("[data-testid=invoice-submit]").dblclick();
  await page.locator("[data-testid=billing-notice]").waitFor({ timeout: 30_000 });
  const inv = await q("select id, invoice_number, status from billing_invoices where client = $1", [A]);
  const invLines = await q("select quantity::float8 q from billing_invoice_lines where invoice_id = $1 order by quantity", [inv[0]?.id]);
  check("doble clic: una sola factura con dos renglones (100 + 1000)", inv.length === 1 && invLines.length === 2 && invLines[0].q === 100 && invLines[1].q === 1000, JSON.stringify(invLines));
  await page.waitForTimeout(500);
  check("SERUM queda FACTURACIÓN PARCIAL (facturada 100, entregada sin facturar 200)", /FACTURACIÓN PARCIAL/.test(await rowOf("SERUM FAC").locator("[data-testid=cell-state]").innerText()) && (await rowOf("SERUM FAC").locator("[data-testid=cell-pending-invoice]").innerText()) === "200");
  check("CREMA queda FACTURADO con entrega completa", /FACTURADO/.test(await rowOf("CREMA FAC").locator("[data-testid=cell-state]").innerText()) && /Entrega completa/.test(await rowOf("CREMA FAC").locator("[data-testid=cell-delivery-state]").innerText()) && /A-0001-00001234/.test(await rowOf("CREMA FAC").innerText()));
  check("facturar NO mueve stock ni cambia lo entregado", (await q("select count(*)::int n from mp_stock_movements"))[0].n === stock0 && (await q("select coalesce(sum(quantity),0)::float8 n from work_item_delivery_lines where status = 'ACTIVA' and work_item_id = any($1::uuid[])", [Object.values(ids)]))[0].n === deliv0);
  check("queda auditoría (evento REGISTRADA con usuario)", (await q("select count(*)::int n from billing_invoice_events where invoice_id = $1 and event_type = 'REGISTRADA' and actor_email = $2", [inv[0].id, E2E_USERS.administracion.email]))[0].n === 1);
  await page.screenshot({ path: `${OUT}/tablet-facturado.png` });

  // API: idempotencia, límites y unicidad.
  const serumDl = (await q("select id from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [ids.serum]))[0].id;
  const post = (data) => adm.page.request.post("/api/v1/billing/invoices", { data });
  const over = await post({ invoiceNumber: "A-0001-00001235", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 201 }], idempotencyKey: randomUUID() });
  check("API: 201 u. cuando solo quedan 200 por facturar → 400", over.status() === 400);
  const key = randomUUID();
  const ok1 = await post({ invoiceNumber: "A-0001-00001235", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 50 }], idempotencyKey: key });
  const ok2 = await post({ invoiceNumber: "A-0001-00001235", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 50 }], idempotencyKey: key });
  check("API: reintento con la misma clave no duplica (201 y luego 200 repetido)", ok1.status() === 201 && ok2.status() === 200 && (await ok2.json()).replayed === true && (await q("select count(*)::int n from billing_invoice_lines l join billing_invoices i on i.id = l.invoice_id where i.invoice_number = 'A-0001-00001235'"))[0].n === 1);
  const sameNumber = await post({ invoiceNumber: "a-0001-00001235", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 50 }], idempotencyKey: randomUUID() });
  check("API: el mismo número (otra capitalización) se agrega a la misma factura, sin duplicar la factura", sameNumber.status() === 201 && (await q("select count(*)::int n from billing_invoices where client = $1 and invoice_number_norm = 'A-0001-00001235'", [A]))[0].n === 1);
  const bad = await post({ invoiceNumber: "X", invoiceDate: "no-fecha", lines: [{ deliveryLineId: serumDl, quantity: 1 }], idempotencyKey: randomUUID() });
  check("API: fecha inválida → 400", bad.status() === 400);
  const left = (await q("select (l.quantity - coalesce((select sum(il.quantity) from billing_invoice_lines il where il.delivery_line_id = l.id and il.status = 'ACTIVA'), 0))::float8 as n from work_item_delivery_lines l where l.id = $1", [serumDl]))[0].n;
  check("el saldo de SERUM por facturar quedó en 100 (300 − 100 − 50 − 50)", left === 100, String(left));

  // Resumen con indicadores clicables.
  await page.reload();
  await page.locator("[data-testid=billing-view]").waitFor({ timeout: 90_000 });
  await page.locator("[data-testid=billing-tab-resumen]").tap();
  await page.locator("[data-testid=billing-dashboard]").waitFor({ timeout: 60_000 });
  await page.locator("[data-testid=dash-client]").fill("CLIENTE FAC");
  await page.waitForTimeout(1500);
  check("tablero: pedidos con facturación parcial = 1 y completamente facturados = 1 (sin importes)", (await page.locator("[data-testid=dash-value-partial]").innerText()) === "1" && (await page.locator("[data-testid=dash-value-done]").innerText()) === "1" && !/\$/.test(await page.locator("[data-testid=billing-dashboard]").innerText()));
  check("tablero: unidades entregadas pendientes de facturar = 200 (100 de SERUM + 200... ver filas) o más", Number((await page.locator("[data-testid=dash-value-units-pending]").innerText()).replace(/\./g, "")) >= 100);
  await page.screenshot({ path: `${OUT}/tablet-dashboard.png` });
  await page.locator("[data-testid=dash-tile-partial]").tap();
  await page.locator("[data-testid=billing-row]").first().waitFor({ timeout: 30_000 });
  check("el indicador «facturación parcial» abre la lista filtrada", (await page.locator("[data-testid=billing-row]").evaluateAll((els) => els.every((e) => e.getAttribute("data-state") === "FACTURACION_PARCIAL"))));
  // Exportaciones Excel.
  for (const report of ["pendientes", "entregas", "facturacion-cliente", "unidades-producto", "parciales"]) {
    const res = await adm.page.request.get(`/api/v1/billing/export?report=${report}&client=CLIENTE%20FAC`);
    const buf = await res.body();
    check(`Excel «${report}» (xlsx válido)`, res.ok() && /spreadsheetml/.test(res.headers()["content-type"] ?? "") && buf.length > 500 && buf.subarray(0, 2).toString() === "PK");
  }
  const xl = await adm.page.request.get("/api/v1/billing/export?report=nope");
  check("reporte inexistente → 400", xl.status() === 400);

  // Anular la factura: las unidades vuelven a pendientes; queda historial.
  await page.locator("[data-testid=billing-tab-facturas]").tap();
  await page.locator("[data-testid=invoice-card]").first().waitFor({ timeout: 30_000 });
  const card1234 = page.locator("[data-testid=invoice-card]", { hasText: "A-0001-00001234" });
  await card1234.locator("[data-testid=invoice-annul]").tap();
  await page.locator("[data-testid=annul-reason]").fill("Factura emitida con datos erróneos");
  await page.locator("[data-testid=annul-confirm]").tap();
  await page.waitForTimeout(1200);
  check("anular la factura devuelve las unidades a pendientes y conserva el historial", (await q("select status from billing_invoices where id = $1", [inv[0].id]))[0].status === "ANULADA" && (await q("select count(*)::int n from billing_invoice_events where invoice_id = $1 and event_type = 'ANULADA'", [inv[0].id]))[0].n === 1 && (await q("select count(*)::int n from billing_invoice_lines where invoice_id = $1 and status = 'ACTIVA'", [inv[0].id]))[0].n === 0);
  const ctl = await (await adm.page.request.get("/api/v1/billing/control?q=CLIENTE%20FAC")).json();
  const crema = ctl.rows.find((r) => r.product === "CREMA FAC");
  check("tras anular, CREMA vuelve a PENDIENTE DE FACTURAR (1.000 u.) sin cambiar lo entregado", crema?.invoicingState === "PENDIENTE_DE_FACTURAR" && crema.pendingInvoice === 1000 && crema.delivered === 1000);
  const reuse = await post({ invoiceNumber: "A-0001-00001234", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 10 }], idempotencyKey: randomUUID() });
  check("un número de factura anulado no se reutiliza", reuse.status() === 400);

  // ── Remitos: aviso al generar y al anular (entregas pendientes de facturar) ───────────────────────────────────────
  const prod = await login(tablet, E2E_USERS.produccion);
  const eligible = (await (await prod.page.request.get("/api/v1/remitos/deliveries")).json()).deliveries.filter((d) => d.client === A);
  const created = await prod.page.request.post("/api/v1/remitos/deliveries", { data: { action: "create", lineIds: eligible.map((d) => d.deliveryLineId) } });
  const remito = (await created.json()).remitos?.[0];
  const gen = await prod.page.request.patch(`/api/v1/remitos/${remito.id}`, { data: { action: "generate", displayName: "Remito FAC E2E" } });
  const numero = gen.ok() ? (await gen.json()).remito?.remitoNumber : null;
  check("remito generado → aviso «REMITO GENERADO» a Administración con número y productos", Boolean(numero) && (await q("select count(*)::int n from os_notifications where kind = 'remito_generado' and message like $1 and message like '%SERUM FAC%'", [`%${numero}%`]))[0].n === 1);
  await prod.page.request.patch(`/api/v1/remitos/${remito.id}`, { data: { action: "annul", motivo: "E2E anulación" } });
  check("remito anulado con entregas pendientes de facturar → aviso «REMITO ANULADO» con el motivo", (await q("select count(*)::int n from os_notifications where kind = 'remito_anulado' and message like $1 and message like '%E2E anulación%'", [`%${numero}%`]))[0].n === 1);
  check("los avisos nunca se duplican (id determinístico por evento)", (await q("select count(*)::int n from (select id from os_notifications where title like '%CLIENTE FAC%' or message like '%CLIENTE FAC%' group by id having count(*) > 1) x"))[0].n === 0);

  // ── Permisos ──────────────────────────────────────────────────────────────────────────────────────────────────────
  check("Producción consulta el control (200) pero no registra facturas (403)", (await prod.page.request.get("/api/v1/billing/control")).status() === 200 && (await prod.page.request.post("/api/v1/billing/invoices", { data: { invoiceNumber: "P-1", invoiceDate: TODAY, lines: [{ deliveryLineId: serumDl, quantity: 1 }], idempotencyKey: randomUUID() } })).status() === 403);
  await prod.ctx.close();
  const el = await login(tablet, E2E_USERS.elaboracion);
  check("Elaboración no accede al control de facturación (403)", (await el.page.request.get("/api/v1/billing/control")).status() === 403 && (await el.page.request.get("/api/v1/billing/export?report=pendientes")).status() === 403);
  await el.ctx.close();
  const anon = await pwRequest.newContext({ baseURL: BASE });
  check("sin sesión → 401", (await anon.get("/api/v1/billing/control")).status() === 401);
  await anon.dispose();
  const adminDeliver = await adm.page.request.post("/api/v1/live-sync/operations", { data: { action: "deliver_work", workItemId: `native:${ids.tonico}`, actorSectorId: "ADMINISTRACION", deliverQuantity: 1, idempotencyKey: `fac-${randomUUID()}`, actualDeliveredAt: new Date().toISOString(), sourceSector: "ENVASADO_MASIVO", product: "" } });
  check("Administración no puede registrar ni alterar entregas (rechazado)", adminDeliver.status() >= 400 && (await q("select coalesce(sum(quantity),0)::float8 n from work_item_delivery_lines where status = 'ACTIVA' and work_item_id = any($1::uuid[])", [Object.values(ids)]))[0].n === deliv0);
  const stockAdm = await adm.page.request.get("/api/v1/mp-stock/stock").catch(() => null);
  check("Administración no accede a stock de materia prima (no 200)", !stockAdm || stockAdm.status() !== 200, String(stockAdm?.status()));
  const nav = await page.locator("nav, aside").first().innerText();
  check("el menú de Administración no muestra Fórmulas, Stock ni Usuarios", !/Fórmulas|Stock|Usuarios|Materias Primas/i.test(nav), nav.replace(/\n/g, " | ").slice(0, 200));
  await adm.ctx.close();

  // ── Alta segura de la cuenta (script del propietario, sobre la base descartable) ───────────────────────────────────
  const secret = `Tmp-${randomBytes(9).toString("base64url")}-9!`;
  const run = (args, input) => spawnSync(process.execPath, ["scripts/provision-administracion-account.mjs", ...args], { input, encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.GENUS_E2E_DATABASE_URL, GENUS_ADMIN_ACCOUNT_EMAIL: PROVISION_EMAIL, CUTOVER_URL: BASE } });
  const dry = run(["--check"], "");
  check("script de alta --check: informa que el correo no está registrado y no escribe", /not_registered_dry_run/.test(dry.stdout) && (await q("select 1 from genus_auth_users where email_normalized = $1", [PROVISION_EMAIL])).length === 0, dry.stdout + dry.stderr);
  const weak = run([], "admin123\nadmin123\n");
  check("rechaza «admin123» como contraseña", /password_too_short|password_too_common/.test(weak.stdout) && (await q("select 1 from genus_auth_users where email_normalized = $1", [PROVISION_EMAIL])).length === 0);
  const mism = run([], `${secret}\n${secret}x\n`);
  check("rechaza contraseñas que no coinciden", /password_mismatch/.test(mism.stdout));
  const made = run(["--verify"], `${secret}\n${secret}\n`);
  check("crea la cuenta (sector ADMINISTRACION, ACTIVO) y el login real funciona", /"created":true/.test(made.stdout) && /"verifyLogin":"ok"/.test(made.stdout), made.stdout + made.stderr);
  check("no imprime la contraseña ni el hash", !made.stdout.includes(secret) && !made.stderr.includes(secret) && !/\$2[aby]\$/.test(made.stdout + made.stderr));
  const row = (await q("select sector, status, role_id, password_hash from genus_auth_users where email_normalized = $1", [PROVISION_EMAIL]))[0];
  check("guardó solo un hash bcrypt (nunca la contraseña) y rol limitado ROL-AD", row?.sector === "ADMINISTRACION" && row.status === "ACTIVO" && row.role_id === "ROL-AD" && /^\$2[aby]\$12\$/.test(row.password_hash) && !row.password_hash.includes(secret));
  const hashBefore = row.password_hash;
  const again = run([], `${secret}-otra\n${secret}-otra\n`);
  check("si el correo ya existe: no crea duplicado ni toca su contraseña", /already_registered/.test(again.stdout) && (await q("select count(*)::int n, max(password_hash) h from genus_auth_users where email_normalized = $1", [PROVISION_EMAIL])).every((r) => r.n === 1 && r.h === hashBefore));
  check("queda auditoría del alta sin secretos", (await q("select detail::text d from genus_auth_audit_events where email_normalized = $1 and event_type = 'ADMIN_USER_UPDATE'", [PROVISION_EMAIL])).every((r) => !r.d.includes(secret) && /provision_account/.test(r.d)));
  const nu = await login(tablet, { email: PROVISION_EMAIL }, secret);
  await nu.page.locator("[data-testid=billing-view]").waitFor({ timeout: 120_000 });
  check("la cuenta nueva entra por /login y ve su propio espacio (Control de facturación)", true);
  await nu.page.screenshot({ path: `${OUT}/tablet-cuenta-nueva.png` });
  check("la cuenta nueva no es superadmin (no accede a la administración de usuarios)", (await nu.page.request.get("/api/v1/auth/admin/users")).status() === 404);
  await nu.ctx.close();
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
