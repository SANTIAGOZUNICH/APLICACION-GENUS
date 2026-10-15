// E2E en Chromium real: Calendario de Entregas — fechas correctas y correcciones de Producción.
//  - Entregas parciales en su fecha REAL (zona Argentina), no todas en el día del último envío.
//  - Entrega guardada a las 00:00 UTC: en su día argentino y marcada «Revisar fecha».
//  - «Desde trabajo»: editar fecha/cantidad/observaciones de UN producto (los demás quedan), persiste al recargar;
//    quitar del calendario con motivo (no reaparece), «Ver quitadas» y restaurar.
//  - Entrega programada: cambiar la fecha de UN producto, quitar y restaurar un producto, cancelar y restaurar la entrega.
//  - Auditoría de fechas (solo lectura), permisos de Envasado y celular.
//  - Nada de esto toca entregas reales, stock ni consumos de MP.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production.
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/entregas-correcciones";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(new Date());
const MONTH = TODAY.slice(0, 8);
const day = (n) => `${MONTH}${String(n).padStart(2, "0")}`;
// Fechas dentro del MES ACTUAL (visibles en la grilla sin navegar).
const D_A = day(21);
const D_A2 = day(23);
const D_PROG = day(24);
const D_PROG2 = day(26);
const CLIENT = "E2E CORR CLIENTE";
const CLIENT_P = "E2E CORR PARCIAL";
const CLIENT_M = "E2E CORR MEDIANOCHE";
const CLIENT_S = "E2E CORR PROGRAMADA";

async function cleanup() {
  await q("delete from delivery_calendar_hidden where work_item_id in (select id from work_items where client ilike 'E2E CORR%')");
  await q("delete from scheduled_delivery_links where item_id in (select i.id from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client ilike 'E2E CORR%')");
  await q("delete from scheduled_delivery_items where delivery_id in (select id from scheduled_deliveries where client ilike 'E2E CORR%')");
  await q("delete from scheduled_deliveries where client ilike 'E2E CORR%'");
  await q("delete from work_item_delivery_lines where work_item_id in (select id from work_items where client ilike 'E2E CORR%')");
  await q("delete from work_item_deliveries where client ilike 'E2E CORR%'");
  await q("delete from operational_events where work_item_id in (select id from work_items where client ilike 'E2E CORR%')");
  for (const w of await q("select id from work_items where client ilike 'E2E CORR%'")) {
    await q("delete from operational_orders where linked_work_item_id = $1", [String(w.id)]).catch(() => {});
  }
  await q("delete from work_items where client ilike 'E2E CORR%'");
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1500, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = async (page, label) => {
  for (let i = 0; i < 3 && (await page.locator("[role=dialog]").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const burger = page.getByRole("button", { name: "Abrir menú" });
  // En celular el menú está detrás de «Abrir menú»: esperarlo (recién cargada la página todavía no se ve).
  if ((page.viewportSize()?.width ?? 1280) < 768) await burger.click({ timeout: 120_000 });
  else if (await burger.isVisible().catch(() => false)) await burger.click();
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
};
const openEntregas = async (page) => {
  await page.goto("/");
  await nav(page, "Entregas");
  await page.locator("[data-testid=entregas-view]").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
};
const chips = (page, date) => page.locator(`[data-testid=entregas-day][data-date='${date}'] [data-testid=entregas-client]`).allInnerTexts();
const waitChip = (page, date, name, present = true) =>
  page
    .waitForFunction(
      ([d, n, p]) => [...document.querySelectorAll(`[data-testid=entregas-day][data-date='${d}'] [data-testid=entregas-client]`)].some((c) => c.textContent?.trim() === n) === p,
      [date, name, present],
      { timeout: 30_000 }
    )
    .then(() => true)
    .catch(() => false);
const openChip = async (page, date, name) => {
  await page.locator(`[data-testid=entregas-day][data-date='${date}'] [data-testid=entregas-client][data-client='${name}']`).first().click();
  await page.locator("[data-testid=entrega-detail]").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
};
const itemBox = (page, product) => page.locator("[data-testid=entrega-item]").filter({ has: page.locator("[data-testid=entrega-item-name]", { hasText: product }) }).first();
const closeDialog = async (page) => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
};
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
const fingerprint = async () =>
  JSON.stringify({
    wd: await q("select id, quantity, actual_delivered_at, status, deleted_at from work_item_deliveries order by id"),
    l: await q("select id, quantity, actual_delivered_at, status from work_item_delivery_lines order by id"),
    m: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    b: await q("select codigo, stock_actual from mp_stock_balances order by codigo"),
    s: await q("select id, updated_at from inv_mp_stock order by id"),
  });
async function realDelivery(workItemId, client, product, lines) {
  const last = lines[lines.length - 1];
  const total = lines.reduce((s, l) => s + l.qty, 0);
  const [wd] = await q(
    `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
     values ($1, $2, $3, 'ENVASADO_MASIVO', $4, 'un', $5, 'E2E', 'ENVASADO_MASIVO', 'ENTREGADO') returning id`,
    [workItemId, product, client, String(total), last.at]
  );
  if (lines.length > 1) {
    let cum = 0;
    for (const [i, l] of lines.entries()) {
      cum += l.qty;
      await q(
        `insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after)
         values ($1, $2, $3, $4, $5, 'un', $6, 'ACTIVA', 'ENVASADO_MASIVO', 'E2E', 'ENVASADO_MASIVO', $7, $8)`,
        [workItemId, wd.id, `e2e-${randomUUID()}`, i + 1, l.qty, i === lines.length - 1 ? "FINAL" : "PARCIAL", l.at, cum]
      );
    }
  }
}
/** Instante UTC de una fecha y hora LOCAL argentina (UTC−3). */
const arToUtc = (date, hhmm) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh + 3, mm)).toISOString();
};

try {
  await cleanup();
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;
  const asg = (data) => pp.request.post("/api/v1/work-assignments", {
    data: { unit: "un.", plannedDate: TODAY, plannedDateTo: TODAY, sector: "ENVASADO_MASIVO", line: "Línea 1", idempotencyKey: randomUUID(), plannedQuantity: "500", ...data },
  });
  const wid = async (client, product) => String((await q("select id from work_items where client = $1 and product = $2", [client, product]))[0].id);

  // ===== Datos: dos trabajos del mismo cliente el mismo día; uno con entregas parciales; uno guardado a las 00:00 UTC =====
  for (const product of ["E2E CORR CREMA A", "E2E CORR CREMA B"]) {
    const r = await asg({ client: CLIENT, product, deliveryDate: D_A });
    if (!r.ok()) throw new Error(`asignación ${product}: ${r.status()} ${await r.text()}`);
  }
  await asg({ client: CLIENT_P, product: "E2E CORR SHAMPOO", deliveryDate: day(5) });
  await asg({ client: CLIENT_M, product: "E2E CORR GEL", deliveryDate: day(16) });
  const wA = await wid(CLIENT, "E2E CORR CREMA A");
  const wB = await wid(CLIENT, "E2E CORR CREMA B");
  const wP = await wid(CLIENT_P, "E2E CORR SHAMPOO");
  const wM = await wid(CLIENT_M, "E2E CORR GEL");
  // Parciales: 300 el día 8 a las 14:00 y 200 el día 13 a las 23:00 (hora argentina; en UTC ya es el 14).
  await realDelivery(wP, CLIENT_P, "E2E CORR SHAMPOO", [
    { at: arToUtc(day(8), "14:00"), qty: 300 },
    { at: arToUtc(day(13), "23:00"), qty: 200 },
  ]);
  // Fecha cargada sin hora → 00:00 UTC del 18 (= 17 a las 21:00 en Argentina).
  await realDelivery(wM, CLIENT_M, "E2E CORR GEL", [{ at: `${day(18)}T00:00:00.000Z`, qty: 500 }]);
  await q("update work_items set operational_status = 'entregado' where id = any($1::uuid[])", [[wP, wM]]);
  const fp0 = await fingerprint();

  await openEntregas(pp);
  // ===== 1. Fechas: parciales en su fecha real y zona argentina =====
  check("Parciales: el envío del día 8 aparece el día 8", await waitChip(pp, day(8), CLIENT_P));
  check("Parciales: el envío de las 23:00 del día 13 aparece el 13 (no el 14 en UTC)", (await waitChip(pp, day(13), CLIENT_P)) && !(await chips(pp, day(14))).includes(CLIENT_P));
  check("Medianoche UTC: la entrega del 18 00:00 UTC se ve el 17 (Argentina)", await waitChip(pp, day(17), CLIENT_M));
  const mChip = pp.locator(`[data-testid=entregas-day][data-date='${day(17)}'] [data-testid=entregas-client][data-client='${CLIENT_M}']`);
  check("…y queda marcada «Revisar fecha» en el calendario", (await mChip.getAttribute("data-review")) === "1");
  await openChip(pp, day(17), CLIENT_M);
  check("…el detalle explica qué revisar", /00:00 UTC/.test(await pp.locator("[data-testid=entrega-review-flag]").first().innerText()));
  await closeDialog(pp);

  // ===== 2. «Desde trabajo»: editar UN producto; el otro del mismo cliente queda en su fecha =====
  check("Dos productos del mismo cliente el mismo día: un solo nombre de cliente", (await chips(pp, D_A)).filter((c) => c === CLIENT).length === 1);
  await openChip(pp, D_A, CLIENT);
  const boxA = itemBox(pp, "E2E CORR CREMA A");
  await boxA.locator("[data-testid=entrega-work-edit-open]").click();
  await boxA.locator("[data-testid=entrega-work-edit-date]").fill(D_A2);
  await boxA.locator("[data-testid=entrega-work-edit-qty]").fill("480");
  await boxA.locator("[data-testid=entrega-work-edit-notes]").fill("Retira el cliente");
  await boxA.locator("[data-testid=entrega-work-edit-reason]").fill("corto");
  check("Editar: sin motivo suficiente no se puede guardar", await boxA.locator("[data-testid=entrega-work-edit-confirm]").isDisabled());
  await boxA.locator("[data-testid=entrega-work-edit-reason]").fill("El cliente pidió pasarla al día 23");
  await pr.page.screenshot({ path: `${OUT}/01-editar-desde-trabajo.png` });
  await boxA.locator("[data-testid=entrega-work-edit-confirm]").click();
  check(
    "Editar: se guarda en el trabajo (fecha, cantidad y observaciones)",
    await waitDb(async () => {
      const [w] = await q("select to_char(delivery_date,'YYYY-MM-DD') d, planned_quantity, notes from work_items where id = $1", [wA]);
      return w.d === D_A2 && w.planned_quantity === "480" && w.notes === "Retira el cliente";
    })
  );
  await closeDialog(pp);
  check("Editar: el producto pasa al día nuevo", await waitChip(pp, D_A2, CLIENT));
  await openChip(pp, D_A, CLIENT);
  const onA = await pp.locator("[data-testid=entrega-item-name]").allInnerTexts();
  check("…y el otro producto del cliente queda en su fecha original", onA.length === 1 && onA[0] === "E2E CORR CREMA B", onA.join(","));
  await closeDialog(pp);
  await pp.reload();
  await openEntregas(pp);
  check("Persistencia: tras recargar sigue en el día nuevo", (await waitChip(pp, D_A2, CLIENT)) && (await waitChip(pp, D_A, CLIENT)));
  const hist = await q("select action from feature_audit_events where domain = 'entregas' and entity_id = $1", [`work:${wA}`]);
  check("Auditoría: la edición queda registrada (con motivo)", hist.some((h) => h.action === "work_edit"));

  // ===== 3. Quitar del calendario (lógico) → no reaparece → «Ver quitadas» → restaurar =====
  await openChip(pp, D_A, CLIENT);
  const boxB = itemBox(pp, "E2E CORR CREMA B");
  await boxB.locator("[data-testid=entrega-work-hide-open]").click();
  await boxB.locator("[data-testid=entrega-work-hide-reason]").fill("Se carga en una entrega programada aparte");
  await boxB.locator("[data-testid=entrega-work-hide-confirm]").click();
  check("Quitar: desaparece del calendario", await waitChip(pp, D_A, CLIENT, false));
  await pp.reload();
  await openEntregas(pp);
  check("Quitar: tras recargar no reaparece", !(await chips(pp, D_A)).includes(CLIENT));
  check("Quitar: el trabajo no se borró ni cambió de estado", (await q("select deleted_at, to_char(delivery_date,'YYYY-MM-DD') d from work_items where id = $1", [wB]))[0].d === D_A);
  await pp.locator("[data-testid=entregas-show-hidden]").check();
  check("«Ver quitadas»: aparece tachada", await waitChip(pp, D_A, CLIENT));
  check("…marcada como quitada", (await pp.locator(`[data-testid=entregas-day][data-date='${D_A}'] [data-testid=entregas-client][data-client='${CLIENT}']`).getAttribute("data-hidden")) === "1");
  await openChip(pp, D_A, CLIENT);
  check("…con motivo, usuario y fecha", /Se carga en una entrega programada aparte/.test(await pp.locator("[data-testid=entrega-hidden-note]").innerText()));
  await pp.screenshot({ path: `${OUT}/02-quitada-restaurar.png` });
  await pp.locator("[data-testid=entrega-work-restore-open]").click();
  await pp.locator("[data-testid=entrega-work-restore-reason]").fill("Se confirmó que va sola");
  await pp.locator("[data-testid=entrega-work-restore-confirm]").click();
  await pp.waitForTimeout(800);
  await closeDialog(pp);
  await pp.locator("[data-testid=entregas-show-hidden]").uncheck();
  check("Restaurar: vuelve a aparecer normal", await waitChip(pp, D_A, CLIENT));

  // ===== 4. Entrega programada: cambiar la fecha de UN producto, quitar y restaurar un producto, cancelar y restaurar =====
  const created = await pp.request.post("/api/v1/entregas", {
    data: { client: CLIENT_S, deliveryDate: D_PROG, items: [
      { product: "E2E CORR X", quantity: "100", unit: "un", sector: "ENVASADO_MASIVO" },
      { product: "E2E CORR Y", quantity: "200", unit: "un", sector: "ENVASADO_MASIVO" },
      { product: "E2E CORR Z", quantity: "300", unit: "un", sector: "ENVASADO_MASIVO" },
    ] },
  });
  check("Entrega programada con 3 productos creada", created.ok(), String(created.status()));
  await pp.reload();
  await openEntregas(pp);
  await openChip(pp, D_PROG, CLIENT_S);
  const boxX = itemBox(pp, "E2E CORR X");
  await boxX.locator("[data-testid=entrega-item-move-open]").click();
  await boxX.locator("[data-testid=entrega-item-move-date]").fill(D_PROG2);
  await boxX.locator("[data-testid=entrega-item-move-reason]").fill("El cliente adelanta solo este producto");
  await boxX.locator("[data-testid=entrega-item-move-confirm]").click();
  await pp.waitForTimeout(1000);
  await closeDialog(pp);
  check("Cambiar fecha de UN producto: aparece el cliente en el día nuevo", await waitChip(pp, D_PROG2, CLIENT_S));
  const rows = await q("select to_char(d.delivery_date,'YYYY-MM-DD') d, i.product from scheduled_delivery_items i join scheduled_deliveries d on d.id = i.delivery_id where d.client = $1 and i.deleted_at is null order by 1, 2", [CLIENT_S]);
  check(
    "…X en la fecha nueva; Y y Z quedan en la original",
    JSON.stringify(rows) === JSON.stringify([{ d: D_PROG, product: "E2E CORR Y" }, { d: D_PROG, product: "E2E CORR Z" }, { d: D_PROG2, product: "E2E CORR X" }]),
    JSON.stringify(rows)
  );
  await openChip(pp, D_PROG, CLIENT_S);
  const boxZ = itemBox(pp, "E2E CORR Z");
  await boxZ.locator("[data-testid=entrega-item-delete-open]").click();
  await boxZ.locator("[data-testid=entrega-item-delete-reason]").fill("El cliente ya no lo pide");
  await boxZ.locator("[data-testid=entrega-item-delete-confirm]").click();
  await pp.waitForTimeout(1200);
  check("Quitar producto: deja de verse en la entrega", (await pp.locator("[data-testid=entrega-item-name]").allInnerTexts()).join(",") === "E2E CORR Y");
  await pp.locator("[data-testid=entrega-deleted-items] summary").click();
  check("…queda en «Productos quitados» con motivo", /El cliente ya no lo pide/.test(await pp.locator("[data-testid=entrega-deleted-item]").innerText()));
  await pp.screenshot({ path: `${OUT}/03-producto-quitado.png` });
  await pp.locator("[data-testid=entrega-item-restore-open]").click();
  await pp.locator("[data-testid=entrega-item-restore-reason]").fill("Lo volvió a pedir hoy");
  await pp.locator("[data-testid=entrega-item-restore-confirm]").click();
  await pp.waitForTimeout(1200);
  check("Restaurar producto: vuelve a la entrega", (await pp.locator("[data-testid=entrega-item-name]").allInnerTexts()).sort().join(",") === "E2E CORR Y,E2E CORR Z");
  // Cancelar (flujo existente) y restaurar (nuevo).
  await pp.locator("[data-testid=entrega-cancel-open]").first().click();
  await pp.locator("[data-testid=entrega-cancel-reason]").fill("Cliente suspendió la entrega");
  await pp.locator("[data-testid=entrega-cancel-confirm]").click();
  await pp.waitForTimeout(1000);
  check("Cancelar: queda cancelada (historial, no se borra)", (await q("select status from scheduled_deliveries where client = $1 and delivery_date = $2", [CLIENT_S, D_PROG]))[0].status === "cancelada");
  await pp.locator("[data-testid=entrega-restore-open]").click();
  await pp.locator("[data-testid=entrega-restore-reason]").fill("El cliente confirmó de nuevo");
  await pp.locator("[data-testid=entrega-restore-confirm]").click();
  check("Restaurar entrega: vuelve a programada", await waitDb(async () => (await q("select status from scheduled_deliveries where client = $1 and delivery_date = $2", [CLIENT_S, D_PROG]))[0].status === "programada"));
  const acts = (await q("select action from feature_audit_events where domain = 'entregas' and entity_id in (select id::text from scheduled_deliveries where client = $1) order by created_at", [CLIENT_S])).map((r) => r.action);
  check("Historial completo de la entrega", ["create", "move_item_out", "delete_item", "restore_item", "cancel", "restore"].every((a) => acts.includes(a)), acts.join(","));
  await closeDialog(pp);

  // ===== 5. Auditoría de fechas (solo lectura) =====
  const nAudit0 = (await q("select count(*)::int n from feature_audit_events"))[0].n;
  await pp.locator("[data-testid=entregas-audit-summary]").click();
  await pp.locator("[data-testid=entregas-audit-list]").waitFor({ timeout: 30_000 });
  const cat = async (key) => Number(await pp.locator(`[data-testid=entregas-audit-category][data-key=${key}]`).getAttribute("data-count"));
  check("Auditoría: detecta las entregas parciales en distintos días", (await cat("parciales_en_un_solo_dia")) >= 1);
  check("Auditoría: detecta la entrega guardada a las 00:00 UTC", (await cat("entrega_hora_utc_medianoche")) >= 1);
  check("Auditoría: no escribe nada", (await q("select count(*)::int n from feature_audit_events"))[0].n === nAudit0);
  await pp.screenshot({ path: `${OUT}/04-auditoria.png`, fullPage: true });

  // ===== 6. Permisos: Envasado consulta pero no corrige =====
  const env = await openAs(E2E_USERS.envasado);
  await openEntregas(env.page);
  check("Envasado: no ve «Ver quitadas» ni la auditoría", (await env.page.locator("[data-testid=entregas-show-hidden]").count()) === 0 && (await env.page.locator("[data-testid=entregas-audit]").count()) === 0);
  if (await waitChip(env.page, D_A, CLIENT)) {
    await openChip(env.page, D_A, CLIENT);
    check("Envasado: sin botones de edición ni de quitar", (await env.page.locator("[data-testid=entrega-work-edit-open], [data-testid=entrega-work-hide-open]").count()) === 0);
    await closeDialog(env.page);
  } else check("Envasado: sin botones de edición ni de quitar", false, "no vio el cliente");
  const denied = await env.page.request.patch(`/api/v1/entregas/work/${wB}`, { data: { action: "hide", reason: "Intento sin permiso" } });
  check("Envasado: el servidor rechaza quitar (403)", denied.status() === 403, String(denied.status()));
  const deniedAudit = await env.page.request.get("/api/v1/entregas/audit");
  check("Envasado: el servidor rechaza la auditoría (403)", deniedAudit.status() === 403, String(deniedAudit.status()));
  await env.ctx.close();

  // ===== 7. Celular: Producción edita desde el teléfono =====
  const mob = await openAs(E2E_USERS.produccion, { width: 390, height: 844 });
  await openEntregas(mob.page);
  await mob.page.locator(`[data-testid=entregas-day][data-date='${D_A2}']`).click();
  await mob.page.locator(`[data-testid=entregas-agenda] [data-testid=entregas-client][data-client='${CLIENT}']`).click();
  await mob.page.locator("[data-testid=entrega-detail]").waitFor({ timeout: 30_000 });
  const mA = itemBox(mob.page, "E2E CORR CREMA A");
  await mA.locator("[data-testid=entrega-work-edit-open]").click();
  await mA.locator("[data-testid=entrega-work-edit-notes]").fill("Retira el cliente a la mañana");
  await mA.locator("[data-testid=entrega-work-edit-reason]").fill("Aclaración del cliente por WhatsApp");
  await mob.page.screenshot({ path: `${OUT}/05-celular-editar.png` });
  await mA.locator("[data-testid=entrega-work-edit-confirm]").click();
  check("Celular: la edición se guarda", await waitDb(async () => (await q("select notes from work_items where id = $1", [wA]))[0].notes === "Retira el cliente a la mañana"));
  await mob.ctx.close();

  // ===== 8. Integridad =====
  check("Integridad: entregas reales, líneas, stock y movimientos de MP sin cambios", (await fingerprint()) === fp0);
  await pr.ctx.close();
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  // Limpia lo propio aunque falle a mitad: otros E2E del mismo Postgres limpian «E2E %» sin conocer estas tablas.
  await cleanup().catch((e) => console.error("cleanup", e));
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
