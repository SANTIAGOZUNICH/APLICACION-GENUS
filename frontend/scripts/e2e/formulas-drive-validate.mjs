// E2E (Chromium real, build de producción, base DESCARTABLE) de la fuente de fórmulas en la carpeta NUEVA de Drive.
// Drive se simula con una carpeta del disco (GENUS_E2E_FAKE_FORMULAS_DRIVE_DIR): carpetas de clientes con .xlsx/.xls.
// Producción actualiza el índice → asigna trabajos a Elaboración → la OE llega con la fórmula del archivo correcto;
// casos ambiguos (copias), otro cliente, archivo nuevo, sin acceso; Elaboración abre «Ver OE / Fórmula»; permisos;
// OE ya emitida intacta; sin cambios de stock, consumos de MP, lotes ni órdenes anteriores.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/formulas-drive";
const DRIVE = process.env.GENUS_E2E_FAKE_FORMULAS_DRIVE_DIR;
if (!DRIVE) throw new Error("Falta GENUS_E2E_FAKE_FORMULAS_DRIVE_DIR");
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

const TODAY = new Date().toISOString().slice(0, 10);
const TAG = `E2E-FORMULAS-${Date.now().toString().slice(-6)}`;
const OE_BASE = 970000 + Math.floor(Math.random() * 90) * 100;
let oeSeq = 0;
const oeNumber = () => `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;

// ---------- Drive simulado (carpeta del disco) ----------
function xlsxBuffer(product, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["PRODUCTO:", product], ["MATERIA PRIMA", "CÓDIGO", "Fórmula %"], ...rows, ["PROCEDIMIENTO"], ["Mezclar a 40 °C"]]), "Hoja1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const put = (rel, product, rows = [["Agua E2E", "MP-E2E-1", 80], ["Glicerina E2E", "MP-E2E-2", 15], ["Perfume E2E", "MP-E2E-3", 5]]) => {
  const full = path.join(DRIVE, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, xlsxBuffer(product, rows));
};
rmSync(DRIVE, { recursive: true, force: true });
mkdirSync(DRIVE, { recursive: true });
put("E2E ALL BEAUTY/EMULSION CORPORAL- E2E ALL BEAUTY.xlsx", "EMULSION CORPORAL");
put("E2E ALL BEAUTY/CREMA DE ORDEÑE - E2E ALL BEAUTY.xlsx", "CREMA DE ORDEÑE");
put("E2E ALL BEAUTY/Copia de CREMA DE ORDEÑE - E2E ALL BEAUTY.xlsx", "CREMA DE ORDEÑE");
put("E2E FIRMEA/SERUM-ADN 1%.xls", "SERUM ADN 1%");
put("E2E FIRMEA/EMULSION CORPORAL- E2E ALL BEAUTY.xlsx", "EMULSION CORPORAL");
put("E2E LUCENT/__sin_acceso/GEL FRIO.xlsx", "GEL FRIO");

async function openAs(user, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const assign = async (page, client, product, extra = {}) => {
  const r = await page.request.post("/api/v1/work-assignments", {
    data: { sector: "ELABORACION", client, product, plannedQuantity: "100", unit: "kg", plannedDate: TODAY, plannedDateTo: TODAY, branchOwner: "Cristian", orderNumber: oeNumber(), packagingLote: "E2E-F-L1", notes: TAG, idempotencyKey: randomUUID(), ...extra },
  });
  if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  const [w] = await q("select id, order_id from work_items where product = $1 and notes = $2 order by created_at desc limit 1", [product, TAG]);
  return w;
};
const oeOf = async (orderId) => (await q("select id, order_number, version, form_data from operational_orders where id = $1", [orderId]))[0];
/** Abre el detalle del trabajo (tarjeta → «Ver / Registrar avance» o «Ver detalle»). */
async function openWork(page, product) {
  await page.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const card = page.locator("[data-testid=work-item-card]", { hasText: product }).first();
  await card.getByRole("button", { name: /Registrar avance|Ver detalle/ }).first().click();
  const panel = page.locator("[data-testid=work-formula-panel]");
  await panel.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("[data-testid=work-formula-panel]")?.getAttribute("data-status") !== "loading", null, { timeout: 30_000 });
  return panel;
}
const closeDrawer = (page) => page.keyboard.press("Escape");
const integrity = async () =>
  JSON.stringify({
    movs: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    bal: await q("select codigo, stock_actual from mp_stock_balances order by codigo"),
    inv: await q("select count(*)::int n from inv_mp_stock"),
    lotes: await q("select count(*)::int n from asignacion_lotes"),
  });

try {
  const integ0 = await integrity();
  const ordersBefore = await q("select id, version, md5(form_data::text) h from operational_orders");
  const pr = await openAs(E2E_USERS.produccion);
  const pp = pr.page;

  // ===== Índice: primera actualización (valida la carpeta nueva) =====
  const sync1 = await pp.request.post("/api/v1/formulas/drive-index");
  const s1 = await sync1.json();
  check("Producción actualiza el índice: clientes y archivos de la carpeta nueva (incluye .xls y subcarpetas)", sync1.ok() && s1.result.ok && s1.result.clientCount === 3 && s1.result.fileCount === 6, JSON.stringify(s1.result));
  const st = await (await pp.request.get("/api/v1/formulas/drive-index")).json();
  check("Estado del índice: validado (la ubicación anterior ya no se consulta) y con revisión de repetidos/otro cliente", st.status.validated === true && st.review.duplicates.length === 1 && st.review.otherClient.length === 1, JSON.stringify({ d: st.review?.duplicates?.length, o: st.review?.otherClient?.length }));

  // ===== Asignar trabajos a Elaboración =====
  const wExact = await assign(pp, "E2E All Beauty", "Emulsión corporal");
  const wDup = await assign(pp, "E2E ALL BEAUTY", "CREMA DE ORDEÑE");
  const wOther = await assign(pp, "E2E FIRMEA", "EMULSION CORPORAL");
  const wVar = await assign(pp, "e2e firmea", "Serum ADN 1 %");
  const oe1 = await oeOf(wExact.order_id);
  check("Cliente y producto exactos: la OE llega con la fórmula del archivo correcto", oe1.form_data.autoPrep?.formula?.status === "ok" && oe1.form_data.materials.some((m) => m.materiaPrima === "Agua E2E"), oe1.form_data.autoPrep?.formula?.message);
  const oeVar = await oeOf(wVar.order_id);
  check("Nombre ligeramente distinto (guiones, signos, .xls): se encuentra", oeVar.form_data.autoPrep?.formula?.status === "ok", oeVar.form_data.autoPrep?.formula?.message);
  const oeDup = await oeOf(wDup.order_id);
  check("Copias del mismo producto: la OE NO elige ninguna (queda pendiente con el motivo)", oeDup.form_data.autoPrep?.formula?.status === "ambiguous" && oeDup.form_data.materials.length === 0, oeDup.form_data.autoPrep?.formula?.message);
  const oeOther = await oeOf(wOther.order_id);
  check("Archivo que parece de otro cliente: no se usa solo", oeOther.form_data.autoPrep?.formula?.status === "ambiguous" && /otro cliente/.test(oeOther.form_data.autoPrep?.formula?.message ?? ""), oeOther.form_data.autoPrep?.formula?.message);

  // ===== Producción: elegir y vincular en el detalle del trabajo =====
  await nav(pp, "Elaboración");
  let panel = await openWork(pp, "CREMA DE ORDEÑE");
  const cands = await panel.locator("[data-testid=work-formula-candidate]").evaluateAll((els) => els.map((e) => e.getAttribute("data-file-name")));
  const flags = await panel.locator("[data-testid=work-formula-flag]").allInnerTexts();
  check("Producción ve las opciones (original y copia) marcadas como copia/repetido", cands.length === 2 && flags.some((f) => /copia/.test(f)) && flags.some((f) => /repetido/.test(f)), `${cands.join(" | ")} · ${flags.join(",")}`);
  check("…y el aviso de por qué no se eligió sola", /elegí cuál es la fórmula correcta/.test(await panel.locator("[data-testid=work-formula-status]").innerText()));
  await pp.screenshot({ path: `${OUT}/1-produccion-opciones.png` });
  await panel.locator("[data-testid=work-formula-candidate]", { hasText: /^CREMA DE ORDEÑE - E2E/ }).locator("input").check();
  await panel.locator("[data-testid=work-formula-link-confirm]").click();
  await pp.waitForFunction(() => /Fórmula vinculada/.test(document.querySelector("[data-testid=work-formula-notice]")?.textContent ?? ""), null, { timeout: 30_000 });
  const notice = await panel.locator("[data-testid=work-formula-notice]").innerText();
  check("Vincular: se guarda y la OE se prepara con ese archivo", /se preparó con esta fórmula/.test(notice), notice);
  const oeDup2 = await oeOf(wDup.order_id);
  check("…en la base: la OE tiene la fórmula del archivo elegido", oeDup2.form_data.autoPrep?.formula?.status === "ok" && oeDup2.form_data.materials.length === 3);
  const docName = await panel.locator("[data-testid=work-formula-doc-name]").innerText();
  check("El detalle muestra el documento vinculado", docName === "CREMA DE ORDEÑE - E2E ALL BEAUTY.xlsx", docName);
  const links = await q("select * from formula_drive_links where client_key = 'e2e all beauty' and ended_at is null");
  const linkAudit = await q("select * from feature_audit_events where domain = 'formulas_drive' and action = 'link' and entity_id = $1", [links[0]?.id]);
  check("Vínculo explícito guardado (uno activo) y auditado", links.length === 1 && links[0].file_name === "CREMA DE ORDEÑE - E2E ALL BEAUTY.xlsx" && linkAudit.length === 1);
  await pp.screenshot({ path: `${OUT}/2-produccion-vinculada.png` });
  await closeDrawer(pp);

  // ===== Archivo sin acceso: aviso claro, no se vincula =====
  const wNoAcc = await assign(pp, "E2E LUCENT", "GEL FRIO");
  const [noAccFile] = await q("select file_id from formula_drive_index where file_name = 'GEL FRIO.xlsx' and client_folder_name = 'E2E LUCENT' and removed_at is null");
  const linkNoAcc = await pp.request.post("/api/v1/formulas/drive-links", { data: { client: "E2E LUCENT", product: "GEL FRIO", fileId: noAccFile.file_id, workItemId: wNoAcc.id } });
  const linkNoAccBody = await linkNoAcc.json();
  check("Sin permiso sobre el archivo: no se vincula y el aviso lo explica", linkNoAcc.status() === 403 && /no tiene permiso/.test(linkNoAccBody.error ?? ""), linkNoAccBody.error);
  const oeNoAcc = await oeOf(wNoAcc.order_id);
  check("…y la OE queda pendiente (no se usa otro archivo)", oeNoAcc.form_data.autoPrep?.formula?.status !== "ok");

  // ===== Agregar un archivo nuevo y actualizar el índice desde la pantalla =====
  const wNew = await assign(pp, "E2E FIRMEA", "BALSAMO LABIAL");
  put("E2E FIRMEA/BALSAMO LABIAL.xlsx", "BALSAMO LABIAL", [["Cera E2E", "MP-E2E-9", 60], ["Aceite E2E", "MP-E2E-8", 40]]);
  await pp.reload();
  await nav(pp, "Elaboración");
  panel = await openWork(pp, "BALSAMO LABIAL");
  check("Antes de actualizar: falta la fórmula (aviso claro para Producción)", (await panel.getAttribute("data-status")) === "not_found" && (await panel.locator("[data-testid=work-formula-status]").count()) === 1);
  await panel.locator("[data-testid=work-formula-sync]").click();
  await pp.waitForFunction(() => /Índice actualizado/.test(document.querySelector("[data-testid=work-formula-notice]")?.textContent ?? ""), null, { timeout: 60_000 });
  await pp.waitForFunction(() => document.querySelector("[data-testid=work-formula-panel]")?.getAttribute("data-status") === "ok", null, { timeout: 30_000 }).catch(() => {});
  const syncNotice = await panel.locator("[data-testid=work-formula-notice]").innerText();
  check("«Actualizar índice» agrega el archivo nuevo y el trabajo ya lo encuentra", /1 nuevos/.test(syncNotice) && (await panel.getAttribute("data-status")) === "ok" && (await panel.locator("[data-testid=work-formula-doc-name]").innerText()) === "BALSAMO LABIAL.xlsx", syncNotice);
  await pp.screenshot({ path: `${OUT}/3-produccion-indice-actualizado.png` });
  await closeDrawer(pp);
  void wNew;

  // ===== Una versión nueva del archivo NO cambia la OE ya preparada =====
  const before = await oeOf(wExact.order_id);
  put("E2E ALL BEAUTY/EMULSION CORPORAL- E2E ALL BEAUTY.xlsx", "EMULSION CORPORAL", [["Agua E2E", "MP-E2E-1", 70], ["Aceite E2E", "MP-E2E-8", 30]]);
  await pp.request.post("/api/v1/formulas/drive-index");
  const after = await oeOf(wExact.order_id);
  check("OE emitida: actualizar el índice con otra versión no la modifica", after.version === before.version && JSON.stringify(after.form_data) === JSON.stringify(before.form_data));

  // ===== ELABORACIÓN abre «Ver OE / Fórmula» =====
  const el = await openAs(E2E_USERS.elaboracion);
  const ep = el.page;
  panel = await openWork(ep, "Emulsión corporal");
  const edoc = await panel.locator("[data-testid=work-formula-doc]").innerText();
  check("Elaboración ve el acceso a la OE y la fórmula usada en la OE", (await panel.locator("[data-testid=work-formula-open-oe]").innerText()).includes(oe1.order_number) && /EMULSION CORPORAL- E2E ALL BEAUTY\.xlsx/.test(edoc) && /usada en la OE/.test(edoc), edoc);
  check("Elaboración no ve opciones ni botones de vincular/actualizar", (await panel.locator("[data-testid=work-formula-candidates]").count()) === 0 && (await panel.locator("[data-testid=work-formula-sync]").count()) === 0);
  const [download] = await Promise.all([ep.waitForEvent("download", { timeout: 30_000 }), panel.locator("[data-testid=work-formula-download]").click()]);
  check("«Ver fórmula» descarga el archivo correcto por GENUS OS", download.suggestedFilename() === "EMULSION CORPORAL- E2E ALL BEAUTY.xlsx", download.suggestedFilename());
  await panel.locator("[data-testid=work-formula-open-oe]").click();
  const viewer = ep.locator("[data-testid=work-formula-oe-viewer]");
  await viewer.waitFor({ timeout: 30_000 });
  await ep.waitForFunction(() => /Agua E2E/.test(document.querySelector("[data-testid=work-formula-oe-viewer]")?.textContent ?? "") || [...document.querySelectorAll("[data-testid=work-formula-oe-viewer] input")].some((i) => i.value === "Agua E2E"), null, { timeout: 60_000 }).catch(() => {});
  const viewerText = (await viewer.innerText()) + (await viewer.locator("input").evaluateAll((els) => els.map((e) => e.value).join(" ")));
  check("«Ver OE» abre la OE (mismo editor) con las materias primas de la fórmula", viewerText.includes(oe1.order_number.replace("OE-2026-", "OE-")) && viewerText.includes("Agua E2E"));
  await ep.screenshot({ path: `${OUT}/4-elaboracion-ver-oe.png` });
  await closeDrawer(ep);
  await closeDrawer(ep);
  panel = await openWork(ep, "GEL FRIO");
  const elWarn = await panel.locator("[data-testid=work-formula-status]").innerText().catch(() => "");
  check("Elaboración: si falta la fórmula, el aviso dice que Producción tiene que definirla", /Producción todavía no definió la fórmula/.test(elWarn), elWarn);
  await ep.screenshot({ path: `${OUT}/5-elaboracion-sin-formula.png` });
  await closeDrawer(ep);

  // Tablet: el panel entra en pantalla
  const tb = await openAs(E2E_USERS.elaboracion, { width: 820, height: 1100 });
  panel = await openWork(tb.page, "Emulsión corporal");
  const box = await panel.boundingBox();
  check("tablet: el panel «OE / Fórmula» entra en pantalla sin scroll horizontal", box && box.width <= 820 && !(await tb.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  await tb.page.screenshot({ path: `${OUT}/6-tablet.png` });

  // ===== Permisos (servidor) =====
  const env = await openAs(E2E_USERS.envasado);
  const fileRow = (await q("select file_id from formula_drive_index where file_name = 'EMULSION CORPORAL- E2E ALL BEAUTY.xlsx' and client_folder_name = 'E2E ALL BEAUTY'"))[0];
  const denied = [
    await env.page.request.get(`/api/v1/formulas/work/${wExact.id}`),
    await env.page.request.get(`/api/v1/formulas/drive-file/${encodeURIComponent(fileRow.file_id)}`),
    await ep.request.post("/api/v1/formulas/drive-links", { data: { client: "E2E ALL BEAUTY", product: "CREMA DE ORDEÑE", fileId: fileRow.file_id } }),
    await ep.request.post("/api/v1/formulas/drive-index"),
  ];
  check("Permisos: Envasado no ve fórmulas; Elaboración no vincula ni actualiza el índice (403)", denied.every((r) => r.status() === 403), denied.map((r) => r.status()).join(","));
  const notIndexed = await pp.request.get(`/api/v1/formulas/drive-file/${encodeURIComponent("otro-archivo-de-drive")}`);
  check("La descarga solo sirve archivos del índice (no es un acceso libre a Drive)", notIndexed.status() === 404);

  // ===== Integridad =====
  check("Nada tocó stock, consumos de MP ni lotes", (await integrity()) === integ0);
  const afterOrders = new Map((await q("select id, version, md5(form_data::text) h from operational_orders")).map((r) => [r.id, `${r.version}|${r.h}`]));
  check("Las órdenes que ya existían siguen idénticas", ordersBefore.every((o) => afterOrders.get(o.id) === `${o.version}|${o.h}`));
} catch (err) {
  console.error(err);
  check("sin errores inesperados", false, String(err?.message ?? err));
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
