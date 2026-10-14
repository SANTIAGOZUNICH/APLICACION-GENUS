// E2E (Chromium real, build de producción, base DESCARTABLE): Producción elimina OE en cualquier estado.
// - OE entregada (ya descontó MP), OE archivada y OE en borrador; motivo obligatorio y doble confirmación.
// - Se conservan los movimientos y saldos de stock MP (no se devuelve nada) y la auditoría.
// - La OE eliminada desaparece del listado, aparece en «Ver eliminadas» con usuario y motivo, y queda solo para
//   consulta: no se edita, no se entrega (no vuelve a mover stock) y su número no se vuelve a vincular a un trabajo.
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
const OUT = process.env.OUT ?? "/tmp/oe-eliminar";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

const CLIENT = "CLIENTE ELIMINAR E2E";
const OE_ENTREGADA = "OE-2026-990501";
const OE_ARCHIVADA = "OE-2026-990502";
const OE_BORRADOR = "OE-2026-990503";
const NUMS = [OE_ENTREGADA, OE_ARCHIVADA, OE_BORRADOR];
const COD1 = "MP-E2E-DEL-1";
const COD2 = "MP-E2E-DEL-2";
const today = new Date().toISOString().slice(0, 10);

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const oeRow = async (n) => (await q("select * from operational_orders where order_number = $1", [n]))[0];
const stockSnapshot = async () =>
  JSON.stringify({
    movs: await q("select id, codigo, kind, quantity, idempotency_key, reversed from mp_stock_movements where codigo in ($1,$2) order by id", [COD1, COD2]),
    bal: await q("select codigo, stock_actual from mp_stock_balances where codigo in ($1,$2) order by codigo", [COD1, COD2]),
  });

async function cleanup() {
  const prev = await q("select id from operational_orders where order_number = any($1)", [NUMS]);
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
    await q("delete from mp_stock_movements where ref_type = 'oe' and ref_id = $1", [r.id]);
  }
  await q("delete from operational_orders where order_number = any($1)", [NUMS]);
  await q("delete from work_items where client = $1", [CLIENT]);
  await q("delete from mp_stock_movements where codigo in ($1,$2)", [COD1, COD2]);
  await q("delete from mp_stock_balances where codigo in ($1,$2)", [COD1, COD2]);
  await q("delete from inv_mp_ingresos where payload->>'codigo' in ($1,$2)", [COD1, COD2]);
  await q("delete from inv_mp_stock where payload->>'codigo' in ($1,$2)", [COD1, COD2]);
}

/** Stock MP real (ingresos confirmados de MP): lote + libro mayor, para que las OE puedan entregarse. */
async function seedStock(page) {
  for (const [codigo, descripcion, lote] of [[COD1, "Agua E2E", "LA-1"], [COD2, "Glicerina E2E", "LG-1"]]) {
    const r = await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { fecha: "2026-10-01", remitoNro: `E2E-DEL-${lote}`, codigo, descripcion, lote, proveedor: "PROV E2E", bultos: 1, cantidad: 1000 } } });
    if (!r.ok()) throw new Error(`ingreso ${codigo}: ${r.status()} ${await r.text()}`);
  }
}

/** Producción asigna el trabajo (crea la OE) y carga la fórmula con códigos de MP. */
async function prepareOe(pr, number, product) {
  const res = await pr.request.post("/api/v1/work-assignments", {
    data: { sector: "ELABORACION", client: CLIENT, product, plannedQuantity: "100", plannedDate: today, branchOwner: "Cristian", orderNumber: number, packagingLote: `L-${number.slice(-3)}`, idempotencyKey: randomUUID() },
  });
  if (!res.ok()) throw new Error(`asignación ${number}: ${res.status()} ${await res.text()}`);
  const row = await oeRow(number);
  const fd = row.form_data;
  const formData = {
    ...fd,
    header: { ...fd.header, productName: product, client: CLIENT, quantityKg: 100, lot: `L-${number.slice(-3)}`, date: today },
    materials: [
      { id: randomUUID(), materiaPrima: "Agua E2E", codigo: COD1, codigoMp: COD1, formulaPct: 80, kgAPesar: 80, kgReal: 80, ajusteMotivo: "", lote: "LA-1" },
      { id: randomUUID(), materiaPrima: "Glicerina E2E", codigo: COD2, codigoMp: COD2, formulaPct: 20, kgAPesar: 20, kgReal: 19.5, ajusteMotivo: "Merma", lote: "LG-1" },
    ],
    procedureSteps: [{ id: randomUUID(), text: "Mezclar" }],
    processControl: { ...fd.processControl, cantidadObtenida: 99, fechaFin: today },
  };
  const patch = await pr.request.patch(`/api/v1/orders/${row.id}`, { data: { expectedVersion: row.version, formData } });
  if (!patch.ok()) throw new Error(`patch ${number}: ${patch.status()} ${await patch.text()}`);
  return row.id;
}

async function openList(page, search, { completas = false, eliminadas = false } = {}) {
  await page.goto("/");
  await nav(page, "Órdenes de Elaboración");
  if (completas) await page.getByRole("button", { name: /^Completas/ }).first().click();
  if (eliminadas) await page.locator("[data-testid=filter-show-deleted]").check();
  await page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(search);
  await page.waitForTimeout(1200);
  const lista = page.getByText("Ver como lista");
  if (await lista.isVisible().catch(() => false)) {
    await lista.click();
    await page.waitForTimeout(600);
  }
}

async function deleteFromUi(page, number, reason, opts) {
  await openList(page, number, opts);
  await page.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
  await page.locator("[data-testid=lifecycle-row-delete]").first().click({ force: true });
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15_000 });
  const submit = page.locator("[data-testid=lifecycle-confirm-submit]");
  const box = dialog.locator('input[type="checkbox"]');
  if (await box.count()) await box.first().check();
  // Sin motivo: no elimina y lo pide.
  await submit.click();
  await page.waitForTimeout(800);
  const askedReason = /El motivo es obligatorio/.test(await dialog.innerText());
  const stillAlive = !(await oeRow(number)).deleted_at;
  const disabledWithoutReason = askedReason && stillAlive;
  await page.locator("[data-testid=lifecycle-confirm-reason]").fill(reason);
  const dialogText = await dialog.innerText();
  await page.screenshot({ path: `${OUT}/${number}-confirmacion.png` });
  await submit.click();
  await page.waitForTimeout(2500);
  return { disabledWithoutReason, dialogText };
}

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima);
  await seedStock(mpu.page);
  await mpu.ctx.close();
  const pr = await openAs(E2E_USERS.produccion);
  const el = await openAs(E2E_USERS.elaboracion);
  const ca = await openAs(E2E_USERS.calidad);

  // ===== Preparación: OE entregada (descuenta MP), OE entregada y archivada, OE en borrador =====
  const idEntregada = await prepareOe(pr.page, OE_ENTREGADA, "CREMA ELIMINAR E2E");
  const idArchivada = await prepareOe(pr.page, OE_ARCHIVADA, "GEL ELIMINAR E2E");
  await pr.page.request.post("/api/v1/work-assignments", {
    data: { sector: "ELABORACION", client: CLIENT, product: "SERUM ELIMINAR E2E", plannedQuantity: "10", plannedDate: today, branchOwner: "Cristian", orderNumber: OE_BORRADOR, idempotencyKey: randomUUID() },
  });
  for (const id of [idEntregada, idArchivada]) {
    const d = await el.page.request.post(`/api/v1/orders/${id}/deliver`, { data: { confirm: true, allowIncomplete: true } });
    if (!d.ok()) throw new Error(`deliver: ${d.status()} ${await d.text()}`);
  }
  const arch = await pr.page.request.post(`/api/v1/orders/${idArchivada}/archive`, { data: {} });
  check("Preparación: una OE archivada", arch.ok() && (await oeRow(OE_ARCHIVADA)).status === "ARCHIVADA");
  const consumo = await q("select codigo, sum(quantity)::float as kg from mp_stock_movements where ref_type='oe' and ref_id = $1 group by codigo order by codigo", [idEntregada]);
  check("Preparación: la OE entregada descontó MP (80 y 19,5 kg reales)", JSON.stringify(consumo) === JSON.stringify([{ codigo: COD1, kg: -80 }, { codigo: COD2, kg: -19.5 }]), JSON.stringify(consumo));
  const stock0 = await stockSnapshot();

  // ===== Permisos y motivo (servidor) =====
  const borrador = await oeRow(OE_BORRADOR);
  const asCalidad = await ca.page.request.post(`/api/v1/orders/${borrador.id}/delete-oe`, { data: { reason: "x" } });
  check("Calidad no puede eliminar OE (403)", asCalidad.status() === 403, String(asCalidad.status()));
  const asElab = await el.page.request.post(`/api/v1/orders/${borrador.id}/delete-oe`, { data: { reason: "x" } });
  check("Elaboración no puede eliminar OE (403)", asElab.status() === 403, String(asElab.status()));
  const sinMotivo = await pr.page.request.post(`/api/v1/orders/${borrador.id}/delete-oe`, { data: { reason: "  " } });
  check("Sin motivo: rechazado (400)", sinMotivo.status() === 400, String(sinMotivo.status()));

  // ===== Producción elimina desde la pantalla: entregada y archivada =====
  const d1 = await deleteFromUi(pr.page, OE_ENTREGADA, "Cargada dos veces (E2E)", { completas: true });
  check("Confirmación: sin motivo no elimina y lo pide", d1.disabledWithoutReason);
  check("Confirmación: avisa que el stock de MP no se modifica", /stock de MP no se modifica/.test(d1.dialogText), d1.dialogText.slice(0, 160));
  const r1 = await oeRow(OE_ENTREGADA);
  check("OE ENTREGADA eliminada: usuario, fecha, motivo; estado anterior conservado", Boolean(r1.deleted_at) && r1.deleted_by === E2E_USERS.produccion.email && r1.delete_reason === "Cargada dos veces (E2E)" && /^COMPLETA/.test(r1.status), `${r1.deleted_by} · ${r1.delete_reason} · ${r1.status}`);
  await deleteFromUi(pr.page, OE_ARCHIVADA, "Archivada por error (E2E)", { completas: true });
  const r2 = await oeRow(OE_ARCHIVADA);
  check("OE ARCHIVADA eliminada", Boolean(r2.deleted_at) && r2.status === "ARCHIVADA" && r2.delete_reason === "Archivada por error (E2E)");
  const viaApi = await pr.page.request.post(`/api/v1/orders/${borrador.id}/delete-oe`, { data: { reason: "No corresponde (E2E)" } });
  check("OE BORRADOR eliminada", viaApi.ok() && Boolean((await oeRow(OE_BORRADOR)).deleted_at));

  // ===== Stock intacto =====
  check("Stock MP intacto: mismos movimientos y saldos (no se devolvió nada)", (await stockSnapshot()) === stock0);
  const audit = await q("select metadata from order_audit_events where order_id = $1 and event_type = 'ORDER_OE_DELETED'", [idEntregada]);
  check(
    "Auditoría: número de OE, estado anterior, motivo y consumo conservado (sin reverso)",
    audit.length === 1 && audit[0].metadata.orderNumber === OE_ENTREGADA && audit[0].metadata.stockReverted === false && audit[0].metadata.stockMovementsKept.length === 2,
    JSON.stringify(audit[0]?.metadata ?? {}).slice(0, 200)
  );
  check("Se conservan versiones e historial de la OE", (await q("select count(*)::int n from order_versions where order_id = $1", [idEntregada]))[0].n > 0);
  const work = await q("select order_id, deleted_at from work_items where order_id = $1", [idEntregada]);
  check("El trabajo vinculado no se borra ni se modifica", work.length === 1 && work[0].deleted_at === null);

  // ===== La OE eliminada no vuelve a operar =====
  const again = await el.page.request.post(`/api/v1/orders/${idEntregada}/deliver`, { data: { confirm: true, allowIncomplete: true } });
  check("Entregar una OE eliminada: rechazado", !again.ok() && /eliminada/.test(await again.text()));
  const rB = await oeRow(OE_BORRADOR);
  const edit = await pr.page.request.patch(`/api/v1/orders/${rB.id}`, { data: { expectedVersion: rB.version, formData: rB.form_data } });
  check("Editar una OE eliminada: rechazado", !edit.ok() && /eliminada/.test(await edit.text()));
  const relink = await pr.page.request.post("/api/v1/work-assignments", {
    data: { sector: "ELABORACION", client: CLIENT, product: "OTRO E2E", plannedQuantity: "5", plannedDate: today, branchOwner: "Cristian", orderNumber: OE_ENTREGADA, idempotencyKey: randomUUID() },
  });
  check("Su número no se vuelve a vincular a un trabajo nuevo", !relink.ok() && /eliminada/.test(await relink.text()));
  const del2 = await pr.page.request.post(`/api/v1/orders/${idEntregada}/delete-oe`, { data: { reason: "otra vez" } });
  check("Eliminar dos veces: sin cambios (idempotente)", del2.ok() && (await oeRow(OE_ENTREGADA)).delete_reason === "Cargada dos veces (E2E)");
  check("Después de todo: stock MP sigue intacto", (await stockSnapshot()) === stock0);

  // ===== Listados =====
  await openList(pr.page, OE_ENTREGADA, { completas: true });
  check("Ya no aparece en el listado operativo", await pr.page.getByText(/^0 resultados$|No hay/).first().isVisible().catch(() => false));
  await openList(pr.page, "ELIMINAR E2E", { completas: true, eliminadas: true });
  await pr.page.waitForTimeout(1000);
  const info = await pr.page.locator("[data-testid=order-deleted-info]").allInnerTexts();
  check("«Ver eliminadas»: muestra ELIMINADA con usuario y motivo", info.some((t) => /ELIMINADA/.test(t) && /Cargada dos veces/.test(t) && /e2e-produccion/.test(t)), info.join(" | ").slice(0, 200));
  await pr.page.screenshot({ path: `${OUT}/ver-eliminadas.png`, fullPage: true });
  await pr.page.locator("[data-testid=lifecycle-row-open]").first().click({ force: true });
  await pr.page.locator("[data-testid=oe-deleted-banner]").waitFor({ timeout: 60_000 });
  const banner = await pr.page.locator("[data-testid=oe-deleted-banner]").innerText();
  check("Al abrirla: aviso de OE eliminada, solo consulta", /OE ELIMINADA/.test(banner) && /no mueve stock/.test(banner), banner.slice(0, 160));
  await pr.page.screenshot({ path: `${OUT}/oe-eliminada-abierta.png`, fullPage: true });
  const elabList = await el.page.request.get("/api/v1/orders?type=OE&includeDeleted=1&q=ELIMINAR");
  const elabItems = (await elabList.json()).items ?? [];
  check("Elaboración no ve las OE eliminadas", !elabItems.some((o) => NUMS.includes(o.orderNumber)));

  await pr.ctx.close();
  await el.ctx.close();
  await ca.ctx.close();
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
