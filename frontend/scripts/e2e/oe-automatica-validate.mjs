// E2E (Chromium real, build de producción) de la OE automática con fórmula y lotes, con los permisos REALES de cada
// sector y una base DESCARTABLE: Producción asigna el trabajo a Elaboración desde la pantalla → la OE (la misma que ya
// se creaba, mismo número) llega lista al elaborador con fórmula, versión, %, kg, lote de fabricación y lotes de MP;
// lo pendiente se ve; cambios del trabajo antes y después de empezar; acción explícita con vista previa; permisos;
// sin movimientos de stock.
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
const OUT = process.env.OUT ?? "/tmp/oe-automatica";
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
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const CLIENT = "CLIENTE AUTO E2E";
const PRODUCT = "CREMA AUTO E2E";
const PRODUCT_SIN = "SERUM SIN FORMULA E2E";
const OE1 = "OE-2026-990101";
const OE2 = "OE-2026-990102";
const LOT = "L-2610-E2E";
const today = new Date().toISOString().slice(0, 10);
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const oeRow = async (n) => (await q("select * from operational_orders where order_number = $1", [n]))[0];

// ---------- Datos en la base DESCARTABLE: fórmula VIGENTE en el banco y Control semanal armado por Materias Primas.
async function cleanup() {
  const prev = await q("select id from operational_orders where order_number in ($1,$2)", [OE1, OE2]);
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
  }
  await q("delete from operational_orders where order_number in ($1,$2)", [OE1, OE2]);
  await q("delete from work_items where product in ($1,$2)", [PRODUCT, PRODUCT_SIN]);
  await q("delete from mp_weekly_controls where product = $1", [PRODUCT]);
  await q("delete from formula_products where normalized_client = $1", [norm(CLIENT)]);
}
async function seed() {
  const productId = randomUUID();
  const versionId = randomUUID();
  await q(
    `insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,'PT-AUTO-1',$6)`,
    [productId, norm(CLIENT), norm(PRODUCT), CLIENT, PRODUCT, versionId]
  );
  await q(
    `insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet, source_file) values ($1,$2,3,'VIGENTE','src-e2e','sha-e2e-v3-0123456789','OK','Fórmula','CREMA AUTO E2E.xlsx')`,
    [versionId, productId]
  );
  const rows = [["Agua purificada", "MP-E2E-AGUA", "78"], ["Glicerina", "MP-E2E-GLI", "12"], ["Alcohol cetílico", "MP-E2E-CET", "8.5"], ["Perfume floral", "MP-E2E-PERF", "1.5"]];
  let i = 0;
  for (const [n, c, p] of rows) {
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, n, c, p]);
  }
  await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Calentar fase acuosa a 70 °C'),($3,$2,2,'Incorporar fase oleosa y agitar 15 min')`, [randomUUID(), versionId, randomUUID()]);
  const [ctl] = await q(`insert into mp_weekly_controls (status, client, product, quantity_kg, created_by, updated_by) values ('BORRADOR',$1,$2,150,$3,$3) returning id`, [CLIENT, PRODUCT, E2E_USERS.materiaPrima.email]);
  let s = 0;
  for (const [c, n, l] of [["MP-E2E-AGUA", "Agua purificada", "AG-2610"], ["MP-E2E-GLI", "Glicerina", "GL-0099"], ["MP-E2E-CET", "Alcohol cetílico", "CT-5521"], ["MP-E2E-PERF", "Perfume floral", ""]]) {
    await q(`insert into mp_weekly_control_lines (control_id, sort_order, codigo, materia_prima, lote) values ($1,$2,$3,$4,$5)`, [ctl.id, ++s, c, n, l]);
  }
  return { versionId, controlId: ctl.id };
}

async function assignFromUi(page, { product, qty, oe, lot }) {
  await nav(page, "Elaboración");
  await page.locator("[data-testid=open-assign-work-dialog]").click({ timeout: 60_000 });
  await page.locator("#af-client").fill(CLIENT);
  await page.locator("#af-product").fill(product);
  await page.locator("#af-qty").fill(qty);
  await page.locator("[data-testid=assign-oa-number]").fill(oe);
  if (lot) await page.locator("[data-testid=assign-lote-fabricacion]").fill(lot);
}

try {
  await cleanup();
  const { versionId, controlId } = await seed();
  const [movs0] = await q("select count(*)::int as n from mp_stock_movements");
  const bal0 = JSON.stringify(await q("select codigo, stock_actual from mp_stock_balances order by codigo"));

  // ===== PRODUCCIÓN asigna el trabajo a Elaboración (pantalla real) =====
  const pr = await openAs(E2E_USERS.produccion);
  await assignFromUi(pr.page, { product: PRODUCT, qty: "150", oe: OE1, lot: LOT });
  check("Asignar a Elaboración: el diálogo pide el lote de fabricación", await pr.page.locator("[data-testid=assign-lote-fabricacion]").isVisible());
  await pr.page.screenshot({ path: `${OUT}/01-produccion-asigna-con-lote.png` });
  await pr.page.locator("[data-testid=assign-submit]").click();
  await pr.page.waitForFunction(() => /OE preparada|OE lista/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  const fb = await pr.page.locator("[data-testid=assign-feedback]").innerText().catch(() => "");
  check("Producción ve que la OE quedó preparada y qué falta", /OE-2026-990101 creada/.test(fb) && /OE preparada\. Falta: Lote de MP pendiente: Perfume floral/.test(fb), fb);
  await pr.page.screenshot({ path: `${OUT}/02-produccion-oe-preparada.png` });

  const row = await oeRow(OE1);
  const fd = row?.form_data;
  check("Una sola OE, con el número indicado y vinculada al trabajo", Boolean(row) && (await q("select count(*)::int n from operational_orders where order_number = $1", [OE1]))[0].n === 1 && Boolean(row.linked_work_item_id));
  check("Fórmula del banco con versión guardada en la OE (ids y hash)", row?.formula_version_id === versionId && row?.formula_version_hash === "sha-e2e-v3-0123456789" && fd?.autoPrep?.formula?.status === "ok", `${row?.formula_version_id}`);
  check("Encabezado desde el trabajo: producto, cliente, 150 kg y lote de fabricación exacto", fd?.header?.productName === PRODUCT && fd?.header?.client === CLIENT && fd?.header?.quantityKg === 150 && fd?.header?.lot === LOT && row?.lot === LOT);
  check(
    "MP, % y kg calculados (150 × %): 117 · 18 · 12,75 · 2,25",
    JSON.stringify(fd?.materials?.map((m) => [m.materiaPrima, m.formulaPct, m.kgAPesar])) === JSON.stringify([["Agua purificada", 78, 117], ["Glicerina", 12, 18], ["Alcohol cetílico", 8.5, 12.75], ["Perfume floral", 1.5, 2.25]])
  );
  check("Lotes de MP del Control semanal; Perfume sin lote → pendiente", JSON.stringify(fd?.materials?.map((m) => m.lote)) === JSON.stringify(["AG-2610", "GL-0099", "CT-5521", ""]) && fd?.autoPrep?.mpLots?.controlId === controlId);
  const [ctlAfter] = await q("select linked_oe_id, updated_by from mp_weekly_controls where id = $1", [controlId]);
  check("El Control semanal de Materias Primas no se modificó", ctlAfter.linked_oe_id === null && ctlAfter.updated_by === E2E_USERS.materiaPrima.email);
  const audit1 = await q("select event_type from order_audit_events where order_id = $1 order by timestamp", [row.id]);
  check("Auditoría: OE creada desde la asignación + preparada automáticamente", audit1.map((a) => a.event_type).join(",") === "OE_CREATED_FROM_ASSIGN,OE_AUTOPREP_APPLIED", audit1.map((a) => a.event_type).join(","));

  // Sin fórmula y sin lote: la OE se crea igual, pendiente, con el aviso claro.
  await pr.page.goto("/");
  await assignFromUi(pr.page, { product: PRODUCT_SIN, qty: "40", oe: OE2, lot: "" });
  await pr.page.locator("[data-testid=assign-submit]").click();
  await pr.page.waitForFunction(() => /OE preparada|OE lista/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  const fb2 = await pr.page.locator("[data-testid=assign-feedback]").innerText().catch(() => "");
  check("Sin fórmula ni lote: Producción ve los pendientes (no se inventa nada)", /Fórmula:/.test(fb2) && /Lote de fabricación/.test(fb2), fb2);
  await pr.page.screenshot({ path: `${OUT}/03-produccion-sin-formula.png` });
  const row2 = await oeRow(OE2);
  check("OE sin fórmula: sin materias primas inventadas", Array.isArray(row2?.form_data?.materials) && row2.form_data.materials.length === 0 && row2.form_data.autoPrep.formula.status === "not_found");

  // ===== ELABORACIÓN abre la OE =====
  const { ctx: elc, page: el } = await openAs(E2E_USERS.elaboracion);
  const openOe = async (product) => {
    await nav(el, "Órdenes de Elaboración");
    await el.getByPlaceholder("Número, producto, código, cliente, lote…").fill(product);
    await el.getByText(product, { exact: true }).first().waitFor({ timeout: 60_000 });
    await el.waitForTimeout(800);
    await el.getByRole("button", { name: /^Abrir$/ }).first().click();
    await el.locator("[data-testid=oe-autoprep-panel]").waitFor({ timeout: 60_000 });
  };
  await openOe(PRODUCT);
  const panel = el.locator("[data-testid=oe-autoprep-panel]");
  const ptext = await panel.innerText();
  check("Elaborador: ve producto, lote de fabricación y cantidad", ptext.includes(PRODUCT) && ptext.includes(LOT) && /150 kg/.test(ptext), ptext.slice(0, 200));
  check("Elaborador: ve la fórmula, su origen y la versión", /Banco de fórmulas/.test(ptext) && /versión sha-e2e-/.test(ptext) && /hoja «Fórmula»/.test(ptext));
  check("Elaborador: ve lo pendiente (lote de Perfume floral)", /Falta completar \(1\)/.test(ptext) && /Lote de MP pendiente: Perfume floral/.test(ptext));
  const lotes = await el.locator("[data-testid=oe-cell-lote]").evaluateAll((xs) => xs.map((x) => [x.value, x.placeholder, x.className.includes("border-rose-400")]));
  check("Tabla: lotes de MP cargados y el pendiente resaltado", JSON.stringify(lotes) === JSON.stringify([["AG-2610", "Pendiente", false], ["GL-0099", "Pendiente", false], ["CT-5521", "Pendiente", false], ["", "Pendiente", true]]), JSON.stringify(lotes));
  const pcts = await el.locator("table").filter({ hasText: /Lote N\.º/ }).locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ")));
  check("Tabla: % y kg a pesar visibles", pcts.length === 4 && /Perfume floral/.test(pcts[3] ?? ""), pcts[3]);
  await el.screenshot({ path: `${OUT}/04-elaborador-oe-lista.png`, fullPage: true });

  // Completa el lote pendiente (dato de proceso): deja de figurar como pendiente.
  await el.locator("[data-testid=oe-cell-lote]").nth(3).fill("PF-7781");
  check("Elaborador completa el lote pendiente y se guarda", await waitDb(async () => (await oeRow(OE1))?.form_data?.materials?.[3]?.lote === "PF-7781"));
  await el.locator("[data-testid=oe-autoprep-ready]").waitFor({ timeout: 10_000 }).catch(() => {});
  check("Sin pendientes: «Fórmula, cantidades y lotes listos»", await el.locator("[data-testid=oe-autoprep-ready]").isVisible());
  const ap2 = (await oeRow(OE1)).form_data.autoPrep;
  check("El guardado del elaborador no altera el registro de la preparación", ap2?.formula?.versionHash === "sha-e2e-v3-0123456789" && ap2?.mpLots?.controlId === controlId);
  await el.screenshot({ path: `${OUT}/05-elaborador-sin-pendientes.png` });

  // ===== Producción corrige la cantidad ANTES de empezar → la OE se recalcula =====
  const wid = (await oeRow(OE1)).linked_work_item_id;
  const v1 = (await q("select version from work_items where id = $1", [wid]))[0].version;
  const c1 = await pr.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wid}`, field: "plannedQuantity", value: "200", expectedVersion: v1, reason: "Pedido ampliado" }] } });
  check("Producción corrige la cantidad del trabajo (200 kg)", c1.ok(), String(c1.status()));
  const r3 = await oeRow(OE1);
  check(
    "Antes de empezar: la OE se recalcula (200 kg) y conserva los lotes",
    r3.form_data.header.quantityKg === 200 &&
      JSON.stringify(r3.form_data.materials.map((m) => m.kgAPesar)) === JSON.stringify([156, 24, 17, 3]) &&
      r3.form_data.materials[3].lote === "PF-7781",
    JSON.stringify(r3.form_data.materials.map((m) => [m.kgAPesar, m.lote]))
  );
  check("Aviso: el Control semanal era para 150 kg", r3.form_data.autoPrep.pendientes.some((p) => /150 kg y la OE es de 200 kg/.test(p)));
  await el.reload();
  await openOe(PRODUCT);
  check("El elaborador ve 200 kg", /200 kg/.test(await el.locator("[data-testid=oe-autoprep-panel]").innerText()));
  await el.screenshot({ path: `${OUT}/06-elaborador-tras-cambio-cantidad.png` });

  // ===== El elaborador EMPIEZA (registra la cantidad obtenida) → los cambios del trabajo ya no la pisan =====
  const sec = el.locator("#oe-sec-control");
  if (!(await sec.evaluate((d) => d.open))) await sec.locator("summary").first().click();
  await sec.getByLabel("Cantidad obtenida").fill("197,5");
  check("Registro del proceso guardado (cantidad obtenida 197,5)", await waitDb(async () => (await oeRow(OE1))?.form_data?.processControl?.cantidadObtenida === 197.5));
  await el.waitForTimeout(1500);
  const before = await oeRow(OE1);
  const v2 = (await q("select version from work_items where id = $1", [wid]))[0].version;
  const c2 = await pr.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wid}`, field: "plannedQuantity", value: "180", expectedVersion: v2, reason: "Ajuste de pedido" }] } });
  const after = await oeRow(OE1);
  check(
    "Ya empezada: el cambio del trabajo NO reemplaza cantidades ni lotes de la OE",
    c2.ok() && after.version === before.version && after.form_data.header.quantityKg === 200 && JSON.stringify(after.form_data.materials) === JSON.stringify(before.form_data.materials)
  );
  const skipped = await q("select metadata from order_audit_events where order_id = $1 and event_type = 'OE_AUTOPREP_SKIPPED_STARTED'", [after.id]);
  check("…y queda auditado que no se actualizó por estar empezada", skipped.length === 1);

  // Acción explícita: vista previa → confirmar.
  await el.reload();
  await openOe(PRODUCT);
  await el.locator("[data-testid=oe-autoprep-refresh]").click();
  await el.locator("[data-testid=oe-autoprep-preview]").waitFor({ timeout: 30_000 });
  const pv = await el.locator("[data-testid=oe-autoprep-preview]").innerText();
  check("Vista previa: muestra 180 kg y los kg nuevos antes de aplicar", /Cantidad 180 kg/.test(pv) && /140,4/.test(pv), pv.slice(0, 200));
  check("Vista previa: todavía no se guardó nada", (await oeRow(OE1)).version === after.version);
  await el.screenshot({ path: `${OUT}/07-elaborador-vista-previa-actualizar.png` });
  await el.locator("[data-testid=oe-autoprep-confirm]").click();
  check("Confirmado: OE a 180 kg conservando lo registrado (cantidad obtenida y lote escrito)", await waitDb(async () => {
    const r = await oeRow(OE1);
    return r.form_data.header.quantityKg === 180 && r.form_data.processControl.cantidadObtenida === 197.5 && r.form_data.materials[3].lote === "PF-7781";
  }));
  check("Auditoría de la actualización manual", (await q("select 1 from order_audit_events where order_id = $1 and event_type = 'OE_AUTOPREP_MANUAL_REFRESH'", [after.id])).length === 1);
  await el.locator("[data-testid=oe-autoprep-msg]").waitFor({ timeout: 10_000 }).catch(() => {});
  await el.screenshot({ path: `${OUT}/08-elaborador-actualizada.png` });

  // OE sin fórmula, vista por el elaborador.
  await openOe(PRODUCT_SIN);
  const p2 = await el.locator("[data-testid=oe-autoprep-panel]").innerText();
  check("OE sin fórmula: el elaborador ve el motivo y los pendientes", /Pendiente/.test(p2) && /No se encontr|no se encontr|No hay/.test(p2) && /Lote de fabricación/.test(p2), p2.slice(0, 200));
  await el.screenshot({ path: `${OUT}/09-elaborador-oe-sin-formula.png` });

  // ===== Permisos =====
  const ca = await openAs(E2E_USERS.calidad);
  const asCalidad = await ca.page.request.post(`/api/v1/orders/${after.id}/auto-prep`, { data: {} });
  check("Calidad no puede actualizar la OE desde fórmula y lotes (403)", asCalidad.status() === 403, String(asCalidad.status()));
  const mp = await openAs(E2E_USERS.materiaPrima);
  const asMp = await mp.page.request.post(`/api/v1/orders/${after.id}/auto-prep`, { data: { confirm: true } });
  check("Materias Primas tampoco (403)", asMp.status() === 403, String(asMp.status()));
  const asElabWorkAssign = await el.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: CLIENT, product: PRODUCT, plannedQuantity: "1", plannedDate: today, branchOwner: "Cristian", idempotencyKey: randomUUID() } });
  check("Elaboración no puede asignar trabajos (403)", asElabWorkAssign.status() === 403, String(asElabWorkAssign.status()));

  // ===== Stock intacto =====
  const [movs1] = await q("select count(*)::int as n from mp_stock_movements");
  const bal1 = JSON.stringify(await q("select codigo, stock_actual from mp_stock_balances order by codigo"));
  check("Ningún movimiento de stock MP ni cambio de saldos en todo el flujo", movs1.n === movs0.n && bal1 === bal0, `${movs0.n} → ${movs1.n}`);

  await elc.close();
  await ca.ctx.close();
  await mp.ctx.close();
  await pr.ctx.close();
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
