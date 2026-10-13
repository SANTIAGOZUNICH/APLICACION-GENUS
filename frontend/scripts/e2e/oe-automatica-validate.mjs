// E2E (Chromium real, build de producción) de la OE automática con fórmula, con los permisos REALES de cada sector y
// una base DESCARTABLE: Producción asigna el trabajo a Elaboración desde la pantalla → la OE (la misma que ya se creaba,
// mismo número) llega con fórmula, versión, %, kg y lote de fabricación; los lotes de MP llegan VACÍOS y el elaborador
// los carga en la tabla como en Excel; cambios del trabajo antes y después de empezar; cambio de fórmula que quitaría un
// lote del elaborador (advertencia + confirmación); permisos; sin movimientos de stock.
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
const PRODUCT_B = "EMULSION LIVIANA E2E"; // misma base, sin Perfume floral
const PRODUCT_SIN = "SERUM SIN FORMULA E2E";
const OE1 = "OE-2026-990101";
const OE2 = "OE-2026-990102";
const LOT = "L-2610-E2E";
const today = new Date().toISOString().slice(0, 10);
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const oeRow = async (n) => (await q("select * from operational_orders where order_number = $1", [n]))[0];
const audits = async (id, type) => q("select metadata from order_audit_events where order_id = $1 and event_type = $2", [id, type]);

// ---------- Datos en la base DESCARTABLE ----------
async function cleanup() {
  const prev = await q("select id from operational_orders where order_number in ($1,$2)", [OE1, OE2]);
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
  }
  await q("delete from operational_orders where order_number in ($1,$2)", [OE1, OE2]);
  await q("delete from work_items where product in ($1,$2,$3)", [PRODUCT, PRODUCT_B, PRODUCT_SIN]);
  await q("delete from mp_weekly_controls where product = $1", [PRODUCT]);
}
/** Fórmulas VIGENTES en el banco. Se siembran una sola vez: el banco queda en memoria del servidor (como en Production). */
async function seedFormula(product, code, rows) {
  const [existing] = await q("select active_version_id from formula_products where normalized_client = $1 and normalized_product = $2", [norm(CLIENT), norm(product)]);
  if (existing) return existing.active_version_id;
  const productId = randomUUID();
  const versionId = randomUUID();
  await q(
    `insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [productId, norm(CLIENT), norm(product), CLIENT, product, code, versionId]
  );
  await q(
    `insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet, source_file) values ($1,$2,3,'VIGENTE','src-e2e',$3,'OK','Fórmula',$4)`,
    [versionId, productId, `sha-e2e-${code}-0123456789`, `${product}.xlsx`]
  );
  let i = 0;
  for (const [n, c, p] of rows) {
    await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, n, c, p]);
  }
  await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Calentar fase acuosa a 70 °C'),($3,$2,2,'Incorporar fase oleosa y agitar 15 min')`, [randomUUID(), versionId, randomUUID()]);
  return versionId;
}
async function seed() {
  const versionId = await seedFormula(PRODUCT, "PT-AUTO-1", [["Agua purificada", "MP-E2E-AGUA", "78"], ["Glicerina", "MP-E2E-GLI", "12"], ["Alcohol cetílico", "MP-E2E-CET", "8.5"], ["Perfume floral", "MP-E2E-PERF", "1.5"]]);
  await seedFormula(PRODUCT_B, "PT-AUTO-2", [["Agua purificada", "MP-E2E-AGUA", "79.5"], ["Glicerina", "MP-E2E-GLI", "12"], ["Alcohol cetílico", "MP-E2E-CET", "8.5"]]);
  // Un Control semanal de Materias Primas con lotes para este producto: la OE NO debe tomarlos.
  const [ctl] = await q(`insert into mp_weekly_controls (status, client, product, quantity_kg, created_by, updated_by) values ('BORRADOR',$1,$2,150,$3,$3) returning id`, [CLIENT, PRODUCT, E2E_USERS.materiaPrima.email]);
  let s = 0;
  for (const [c, n, l] of [["MP-E2E-AGUA", "Agua purificada", "CTRL-AG"], ["MP-E2E-GLI", "Glicerina", "CTRL-GL"]]) {
    await q(`insert into mp_weekly_control_lines (control_id, sort_order, codigo, materia_prima, lote) values ($1,$2,$3,$4,$5)`, [ctl.id, ++s, c, n, l]);
  }
  // Stock histórico de MP (saldo + movimiento) para verificar que nada lo toca.
  await q(`insert into mp_stock_balances (codigo, descripcion, stock_actual) values ('MP-E2E-AGUA','Agua purificada',500) on conflict (codigo) do nothing`);
  await q(
    `insert into mp_stock_movements (codigo, kind, quantity, balance_after, reason, actor_email, actor_sector, idempotency_key) values ('MP-E2E-AGUA','INGRESO',500,500,'Ingreso histórico E2E','e2e-mp@genus.test','MATERIA_PRIMA','e2e-oe-auto-hist-1') on conflict do nothing`
  );
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
  check("Hay stock histórico de MP para comparar (saldo y movimientos)", movs0.n > 0 && bal0.includes("MP-E2E-AGUA"));

  // ===== PRODUCCIÓN asigna el trabajo a Elaboración (pantalla real) =====
  const pr = await openAs(E2E_USERS.produccion);
  await assignFromUi(pr.page, { product: PRODUCT, qty: "150", oe: OE1, lot: LOT });
  check("Asignar a Elaboración: el diálogo pide el lote de fabricación", await pr.page.locator("[data-testid=assign-lote-fabricacion]").isVisible());
  await pr.page.screenshot({ path: `${OUT}/01-produccion-asigna-con-lote.png` });
  await pr.page.locator("[data-testid=assign-submit]").click();
  await pr.page.waitForFunction(() => /OE preparada|OE lista/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  const fb = await pr.page.locator("[data-testid=assign-feedback]").innerText().catch(() => "");
  check("Producción ve que la OE quedó lista (fórmula, cantidades y lote)", /OE-2026-990101 creada/.test(fb) && /OE lista con fórmula/.test(fb), fb);
  await pr.page.screenshot({ path: `${OUT}/02-produccion-oe-preparada.png` });

  const row = await oeRow(OE1);
  const fd = row?.form_data;
  check("Una sola OE, con el número indicado y vinculada al trabajo", Boolean(row) && (await q("select count(*)::int n from operational_orders where order_number = $1", [OE1]))[0].n === 1 && Boolean(row.linked_work_item_id));
  check("Fórmula del banco con versión guardada en la OE (ids y hash)", row?.formula_version_id === versionId && row?.formula_version_hash === "sha-e2e-PT-AUTO-1-0123456789" && fd?.autoPrep?.formula?.status === "ok", `${row?.formula_version_id}`);
  check("Encabezado desde el trabajo: producto, cliente, 150 kg y lote de fabricación exacto", fd?.header?.productName === PRODUCT && fd?.header?.client === CLIENT && fd?.header?.quantityKg === 150 && fd?.header?.lot === LOT && row?.lot === LOT);
  check(
    "MP, códigos, % y kg calculados (150 × %): 117 · 18 · 12,75 · 2,25",
    JSON.stringify(fd?.materials?.map((m) => [m.materiaPrima, m.codigo, m.formulaPct, m.kgAPesar])) ===
      JSON.stringify([["Agua purificada", "MP-E2E-AGUA", 78, 117], ["Glicerina", "MP-E2E-GLI", 12, 18], ["Alcohol cetílico", "MP-E2E-CET", 8.5, 12.75], ["Perfume floral", "MP-E2E-PERF", 1.5, 2.25]])
  );
  check("Lotes de MP VACÍOS (no se toman del Control semanal aunque exista)", JSON.stringify(fd?.materials?.map((m) => m.lote)) === JSON.stringify(["", "", "", ""]));
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
  const openOe = async (search) => {
    await nav(el, "Órdenes de Elaboración");
    const back = el.getByRole("button", { name: /Volver al listado/ });
    if (await back.isVisible().catch(() => false)) await back.click();
    await el.getByPlaceholder("Número, producto, código, cliente, lote…").fill(search);
    try {
      await el.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
    } catch (err) {
      await el.screenshot({ path: `${OUT}/debug-listado-oe.png`, fullPage: true }).catch(() => {});
      throw err;
    }
    await el.waitForTimeout(800);
    await el.getByRole("button", { name: /^Abrir$/ }).first().click();
    await el.locator("[data-testid=oe-autoprep-panel]").waitFor({ timeout: 60_000 });
  };
  await openOe(OE1);
  const panel = el.locator("[data-testid=oe-autoprep-panel]");
  const ptext = await panel.innerText();
  check("Elaborador: ve producto, lote de fabricación y cantidad", ptext.includes(PRODUCT) && ptext.includes(LOT) && /150 kg/.test(ptext), ptext.slice(0, 200));
  check("Elaborador: ve la fórmula, su origen y la versión", /Banco de fórmulas/.test(ptext) && /versión sha-e2e-/.test(ptext));
  check("Elaborador: ve que los lotes de MP los completa él (0 de 4)", /Lotes de MP: 0 de 4 cargados/.test(ptext));
  const lotCells = el.locator("[data-testid=oe-cell-lote]");
  const ph = await lotCells.evaluateAll((xs) => xs.map((x) => [x.value, x.placeholder]));
  check("Tabla: 4 celdas de lote vacías, editables, con «Completar lote»", JSON.stringify(ph) === JSON.stringify(Array(4).fill(["", "Completar lote"])) && !(await lotCells.first().isDisabled()), JSON.stringify(ph));
  const rowsVals = await lotCells.evaluateAll((xs) => xs.map((x) => [...x.closest("tr").querySelectorAll("td")].map((td) => td.querySelector("input")?.value ?? td.innerText.trim()).join(" | ")));
  check("Tabla: MP, % y kg a pesar visibles", rowsVals.length === 4 && /Perfume floral/.test(rowsVals[3]) && /1[.,]5/.test(rowsVals[3]) && /2[.,]25/.test(rowsVals[3]), rowsVals[3]);
  await el.screenshot({ path: `${OUT}/04-elaborador-oe-lista.png`, fullPage: true });

  // ===== Lotes de MP como en Excel: escribir + Enter baja; pegar varias líneas completa las filas siguientes =====
  await lotCells.nth(0).click();
  await el.keyboard.type("AG-2610");
  await el.keyboard.press("Enter");
  const focused = await el.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("Enter en el lote baja a la fila siguiente (como Excel)", focused === "Lote de Glicerina", String(focused));
  await el.keyboard.press("ArrowUp");
  check("↑ vuelve a la fila anterior", (await el.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Lote de Agua purificada");
  await lotCells.nth(1).focus();
  await el.evaluate(() => {
    const target = document.activeElement;
    const dt = new DataTransfer();
    dt.setData("text/plain", "GL-0099\nCT-5521\nPF-7781\n");
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check(
    "Pegar 3 lotes copiados de una planilla completa las 3 filas y se guarda",
    await waitDb(async () => JSON.stringify((await oeRow(OE1))?.form_data?.materials?.map((m) => m.lote)) === JSON.stringify(["AG-2610", "GL-0099", "CT-5521", "PF-7781"])),
    JSON.stringify((await oeRow(OE1))?.form_data?.materials?.map((m) => m.lote))
  );
  await el.waitForTimeout(800);
  check("Panel: 4 de 4 lotes cargados", /Lotes de MP: 4 de 4 cargados/.test(await panel.innerText()));
  const ap2 = (await oeRow(OE1)).form_data.autoPrep;
  check("El guardado del elaborador no altera el registro de la preparación", ap2?.formula?.versionHash === "sha-e2e-PT-AUTO-1-0123456789");
  await el.screenshot({ path: `${OUT}/05-elaborador-carga-lotes-mp.png` });

  // ===== Producción corrige la cantidad ANTES de empezar → kg recalculados, lotes del elaborador intactos =====
  const wid = (await oeRow(OE1)).linked_work_item_id;
  const workVersion = async () => (await q("select version from work_items where id = $1", [wid]))[0].version;
  const c1 = await pr.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wid}`, field: "plannedQuantity", value: "200", expectedVersion: await workVersion(), reason: "Pedido ampliado" }] } });
  check("Producción corrige la cantidad del trabajo (200 kg)", c1.ok(), String(c1.status()));
  const r3 = await oeRow(OE1);
  check(
    "Antes de empezar: la OE se recalcula (200 kg) y conserva los lotes del elaborador",
    r3.form_data.header.quantityKg === 200 &&
      JSON.stringify(r3.form_data.materials.map((m) => m.kgAPesar)) === JSON.stringify([156, 24, 17, 3]) &&
      JSON.stringify(r3.form_data.materials.map((m) => m.lote)) === JSON.stringify(["AG-2610", "GL-0099", "CT-5521", "PF-7781"]),
    JSON.stringify(r3.form_data.materials.map((m) => [m.kgAPesar, m.lote]))
  );
  await el.reload();
  await openOe(OE1);
  check("El elaborador ve 200 kg y sus lotes", /200 kg/.test(await el.locator("[data-testid=oe-autoprep-panel]").innerText()) && (await lotCells.nth(3).inputValue()) === "PF-7781");
  await el.screenshot({ path: `${OUT}/06-elaborador-tras-cambio-cantidad.png` });

  // ===== Producción cambia a un producto cuya fórmula NO tiene Perfume floral (que ya tiene lote) =====
  const before = await oeRow(OE1);
  const c2 = await pr.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wid}`, field: "product", value: PRODUCT_B, expectedVersion: await workVersion(), reason: "Cambio de producto" }] } });
  const afterProduct = await oeRow(OE1);
  check(
    "Cambio de fórmula que quitaría un lote del elaborador: NO se aplica solo",
    c2.ok() && afterProduct.version === before.version && JSON.stringify(afterProduct.form_data) === JSON.stringify(before.form_data)
  );
  const need = await audits(before.id, "OE_AUTOPREP_NEEDS_CONFIRMATION");
  check("…y queda auditado qué se perdería (Perfume floral, lote PF-7781)", need.length === 1 && JSON.stringify(need[0].metadata).includes("PF-7781"));

  await el.reload();
  await openOe(OE1);
  await el.locator("[data-testid=oe-autoprep-refresh]").click();
  await el.locator("[data-testid=oe-autoprep-preview]").waitFor({ timeout: 30_000 });
  const lost = el.locator("[data-testid=oe-autoprep-lost]");
  check("Vista previa: advierte que se quita Perfume floral con su lote", (await lost.isVisible()) && /Perfume floral — lote PF-7781/.test(await lost.innerText()));
  check("«Aplicar» bloqueado hasta confirmar la pérdida", await el.locator("[data-testid=oe-autoprep-confirm]").isDisabled());
  await el.screenshot({ path: `${OUT}/07-elaborador-advertencia-mp-quitada.png` });
  await el.locator("[data-testid=oe-autoprep-accept-lost]").check();
  await el.locator("[data-testid=oe-autoprep-confirm]").click();
  check(
    "Confirmado: fórmula nueva, lotes conservados en las MP que siguen, Perfume quitado",
    await waitDb(async () => {
      const r = await oeRow(OE1);
      return r.product === PRODUCT_B && JSON.stringify(r.form_data.materials.map((m) => [m.codigo, m.lote])) === JSON.stringify([["MP-E2E-AGUA", "AG-2610"], ["MP-E2E-GLI", "GL-0099"], ["MP-E2E-CET", "CT-5521"]]);
    }),
    JSON.stringify((await oeRow(OE1)).form_data.materials.map((m) => [m.codigo, m.lote]))
  );
  const manual = await audits(before.id, "OE_AUTOPREP_MANUAL_REFRESH");
  check("Auditoría de la actualización: lotes antes/después y la MP quitada con su lote", manual.length === 1 && JSON.stringify(manual[0].metadata.removedWithConfirmation).includes("PF-7781"));
  check("El historial de versiones conserva la OE anterior con el lote quitado", (await q("select 1 from order_versions where order_id = $1 and snapshot::text like '%PF-7781%'", [before.id])).length > 0);
  await el.locator("[data-testid=oe-autoprep-msg]").waitFor({ timeout: 10_000 }).catch(() => {});
  await el.screenshot({ path: `${OUT}/08-elaborador-actualizada.png` });

  // ===== El elaborador EMPIEZA (registra la cantidad obtenida) → los cambios del trabajo ya no la pisan =====
  await el.reload();
  await openOe(OE1);
  const sec = el.locator("#oe-sec-control");
  if (!(await sec.evaluate((d) => d.open))) await sec.locator("summary").first().click();
  await sec.getByLabel("Cantidad obtenida").fill("197,5");
  check("Registro del proceso guardado (cantidad obtenida 197,5)", await waitDb(async () => (await oeRow(OE1))?.form_data?.processControl?.cantidadObtenida === 197.5));
  await el.waitForTimeout(1500);
  const started = await oeRow(OE1);
  const c3 = await pr.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${wid}`, field: "plannedQuantity", value: "180", expectedVersion: await workVersion(), reason: "Ajuste de pedido" }] } });
  const afterStart = await oeRow(OE1);
  check(
    "Ya empezada: el cambio del trabajo NO reemplaza cantidades ni lotes de la OE",
    c3.ok() && afterStart.version === started.version && JSON.stringify(afterStart.form_data) === JSON.stringify(started.form_data)
  );
  check("…y queda auditado que no se actualizó por estar empezada", (await audits(started.id, "OE_AUTOPREP_SKIPPED_STARTED")).length === 1);

  // OE sin fórmula, vista por el elaborador.
  await openOe(OE2);
  const p2 = await el.locator("[data-testid=oe-autoprep-panel]").innerText();
  check("OE sin fórmula: el elaborador ve el motivo y los pendientes", /Pendiente/.test(p2) && /No se encontr/.test(p2) && /Lote de fabricación/.test(p2), p2.slice(0, 200));
  await el.screenshot({ path: `${OUT}/09-elaborador-oe-sin-formula.png` });

  // ===== Permisos =====
  const ca = await openAs(E2E_USERS.calidad);
  const asCalidad = await ca.page.request.post(`/api/v1/orders/${started.id}/auto-prep`, { data: {} });
  check("Calidad no puede actualizar la OE desde la fórmula (403)", asCalidad.status() === 403, String(asCalidad.status()));
  const mp = await openAs(E2E_USERS.materiaPrima);
  const asMp = await mp.page.request.post(`/api/v1/orders/${started.id}/auto-prep`, { data: { confirm: true } });
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
