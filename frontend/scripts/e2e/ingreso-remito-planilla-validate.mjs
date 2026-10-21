// E2E (Chromium real, base DESCARTABLE) de la lectura automática del remito con un Gemini SIMULADO.
// Qué prueba: que al subir la foto GENUS OS analiza SOLO (sin segundo botón), muestra «Analizando remito…», completa el formulario
// visible sin recargar, preselecciona el material solo si es inequívoco, informa los fallos con «Reintentar lectura», no mueve stock hasta
// confirmar y no filtra la clave. Qué NO prueba: la calidad de lectura de Gemini real (eso necesita GEMINI_API_KEY y un remito de prueba).
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, devices } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/ingreso-remito-planilla";
const FIX = path.join(OUT, "fixtures");
mkdirSync(FIX, { recursive: true });
const RUN = randomUUID().slice(0, 5).toUpperCase();
const FAKE_KEY = process.env.GEMINI_API_KEY;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

// ───── Gemini SIMULADO (misma forma de pedido/respuesta que la API REST) ─────
const MP_CODE = `E2E-LEC-GLI-${RUN}`;
const MP_CODE2 = `E2E-LEC-ALC-${RUN}`;
const ME_CODE = `E2E-LEC-FR-${RUN}`;
const SUPPLIER = `Droguería Lectura ${RUN}`;
const REM = `0001-${RUN}01`;
const state = { mode: "ok", delayMs: 1500, requests: [], lists: 0 };
const remitoMP = {
  supplier: SUPPLIER, remitoNumber: REM, remitoDate: "2026-10-14", notes: "Entrega parcial 1 de 2", unclearFields: [],
  lines: [
    { supplierCode: "GV-25", description: "Glicerina vegetal USP bidón x 25 kg", quantity: 100, unit: "kg", packages: 4, lot: "LG-2026-77", expiryDate: "2029-06-30", notes: "", confidence: 0.96, unclearFields: [] },
    { supplierCode: "ZX-9", description: "Insumo sin identificar", quantity: "40,5", unit: "KG", packages: null, lot: "", expiryDate: "", notes: "Caja dañada", confidence: 0.5, unclearFields: ["lot"] },
  ],
};
const remitoME = { supplier: SUPPLIER, remitoNumber: `0002-${RUN}02`, remitoDate: "2026-10-14", notes: "", unclearFields: [], lines: [{ supplierCode: "FR-9", description: "Frasco PET 250 ml", quantity: "1.200", unit: "un", packages: 12, lot: "", expiryDate: "", notes: "", confidence: 0.9, unclearFields: [] }] };
const gem = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    const body = raw ? JSON.parse(raw) : {};
    const parts = body.contents?.[0]?.parts ?? [];
    const model = /models\/([^:/?]+):generateContent/.exec(req.url ?? "")?.[1] ?? null;
    state.requests.push({ url: req.url, model, key: req.headers["x-goog-api-key"], mimes: parts.filter((p) => p.inline_data).map((p) => p.inline_data.mime_type), textOnly: parts.every((p) => p.text), gen: body.generationConfig });
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.headers["x-goog-api-key"] !== FAKE_KEY) return send(403, { error: { code: 403, message: "bad key" } });
    if (req.method === "GET" && /^\/v1beta\/models/.test(req.url ?? "")) {
      state.lists += 1;
      return send(200, { models: ["gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-preview-tts", "embedding-001", "gemini-2.5-pro"].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: n === "embedding-001" ? ["embedContent"] : ["generateContent"] })) });
    }
    if (model === "gemini-2.0-flash-retirado") return send(404, { error: { code: 404, status: "NOT_FOUND", message: "models/gemini-2.0-flash-retirado is not found for API version v1beta, or is not supported for generateContent." } });
    if (state.mode === "keyinvalid") return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } });
    if (state.mode === "quota") return send(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota" } });
    if (parts.every((p) => p.text) && req.method === "POST" && state.mode !== "textfail") return send(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] }); // prueba de configuración
    await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.mode === "overloaded") return send(503, { error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded. Please try again later." } });
    if (state.mode === "flaky") {
      state.flakyHits = (state.flakyHits ?? 0) + 1;
      if (state.flakyHits === 1) return send(503, { error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded. Please try again later." } });
    }
    if (state.mode === "garbage") return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Lo siento, no puedo ayudar con eso" }] } }] });
    if (state.mode === "403") return send(403, { error: { code: 403, message: "PERMISSION_DENIED" } });
    const payload = state.custom ?? (state.mode === "me" ? remitoME : remitoMP); // «flaky» responde como «ok» tras el primer 503
    send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  });
});
await new Promise((r) => gem.listen(4599, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"];
void _ignored;
async function openAs(user, mobile) {
  const ctx = await browser.newContext({ baseURL: BASE, ...(mobile ? { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1.5 } : { viewport: { width: 1440, height: 900 } }) });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = async (page, label) => {
  const direct = page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first();
  if (!(await direct.isVisible().catch(() => false))) {
    const menu = page.getByRole("button", { name: /menú|menu|abrir navegación/i }).first();
    if (await menu.isVisible().catch(() => false)) await menu.click();
  }
  await direct.click({ timeout: 120_000 });
};
async function cdpShrink(page, vp) {
  // Simula el teclado en pantalla: reduce la ventana ~40 %.
  await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.6) });
  await page.waitForTimeout(250);
}
const dlg = (page) => page.locator("[data-testid=ingreso-remito-dialog]");
const balance = async (code) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [code]))[0]?.stock_actual ?? 0);
const count = async (table) => Number((await q(`select count(*)::int n from ${table}`))[0].n);
async function pickMaterial(scope, page, code) {
  await scope.locator("[data-testid=linea-buscar-material]").first().fill(code);
  await dlg(page).locator("[data-testid=linea-catalogo-item]").filter({ hasText: code }).first().click({ timeout: 30_000 });
}

try {
  writeFileSync(path.join(FIX, "hoja-1.jpg"), Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
  const matId = randomUUID();
  const nowIso = new Date().toISOString();
  await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1,$2,0) on conflict (codigo) do nothing", [MP_CODE, "GLICERINA VEGETAL USP"]);
  await q("insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, $2::jsonb, now())", [matId, JSON.stringify({ id: matId, codigo: ME_CODE, descripcion: "FRASCO PET 250 ML", cliente: "", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", archived: false, createdBy: "e2e", updatedBy: "e2e", createdAt: nowIso, updatedAt: nowIso })]);
  const mpMovs = async () => Number((await q("select count(*)::int n from mp_stock_movements where codigo = $1", [MP_CODE]))[0].n);
  const sheetRows = (table, like) => q(`select id, payload from ${table} where payload->>'proveedor' like $1 or payload->>'descripcion' like $1 or payload->>'descripcionInsumo' like $1 order by payload->>'createdAt'`, [like]);
  const L = (o) => ({ supplierCode: "", description: "", quantity: null, unit: "", packages: null, lot: "", expiryDate: "", notes: "", confidence: 0.4, unclearFields: [], ...o });

  /** Una foto → lectura simulada → «Pasar al Excel» SIN tocar nada. */
  async function flow(page, tab, payload, tag) {
    state.custom = payload;
    state.mode = "ok";
    state.delayMs = 200;
    await page.goto("/mi-trabajo");
    await nav(page, tab);
    await page.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
    await page.locator("[data-testid=nuevo-ingreso-remito]").click();
    await dlg(page).waitFor();
    await page.locator("[data-testid=remito-input-archivos]").setInputFiles([path.join(FIX, "hoja-1.jpg")]);
    // La lectura puede traer datos (revisión) o nada interpretable (aviso de fallo): en ambos casos se puede pasar al Excel.
    await page.locator("[data-testid=paso-revision], [data-testid=remito-lectura-fallo]").first().waitFor({ timeout: 60_000 });
    await page.screenshot({ path: `${OUT}/${tag}-revision.png` });
    if (await page.locator("[data-testid=paso-revision]").count()) await page.locator("[data-testid=remito-pasar-excel]").click();
    else await page.locator("[data-testid=remito-pasar-excel-foto]").click();
    await page.locator("[data-testid=paso-planilla]").waitFor({ timeout: 60_000 });
    check(`${tag}: «Pasar al Excel» sin corregir nada → aviso de filas cargadas (sin pantallas obligatorias)`, /Pasado al Excel/.test(await page.locator("[data-testid=paso-planilla]").innerText()));
    await page.screenshot({ path: `${OUT}/${tag}-pasado.png` });
    await page.locator("[data-testid=remito-ir-tabla]").click();
  }
  /** La planilla virtualiza columnas: se recorre hacia la derecha hasta ver el valor. */
  async function gridHasValue(page, gid, value) {
    const g = page.locator(`[data-testid=${gid}]`);
    await g.evaluate((el) => { const c = el.querySelector(".dsg-container"); if (c) c.scrollLeft = 0; });
    for (let i = 0; i < 20; i++) {
      if ((await g.locator(`input[value="${value}"]`).count()) > 0) return true;
      await g.evaluate((el) => { const c = el.querySelector(".dsg-container"); if (c) c.scrollLeft += 240; });
      await page.waitForTimeout(150);
    }
    return false;
  }
  const mpStock0 = Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [MP_CODE]))[0].stock_actual);

  for (const [device, mobile] of [["escritorio", false], ["tablet", true]]) {
    const u = await openAs(E2E_USERS.materiaPrima, mobile);
    const p = u.page;
    const S = `${SUPPLIER} ${device}`;
    // 1) UN SOLO CAMPO reconocido (y mal leído): descripción con errores, nada más.
    await flow(p, "Ingresos MP", { supplier: "", remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [L({ description: `Glicerna vgetal ${device}` })] }, `mp-${device}-un-campo`);
    let rows = await sheetRows("inv_mp_ingresos", `%Glicerna vgetal ${device}%`);
    check(`MP ${device} · un solo campo: la fila está en la base (persistente), BORRADOR, sin código/lote/cantidad`, rows.length === 1 && rows[0].payload.status === "BORRADOR" && rows[0].payload.codigo === "" && rows[0].payload.lote === "" && rows[0].payload.cantidad === null);
    // la tabla la muestra y es editable: corrijo la descripción mal leída directo en la celda
    await p.waitForTimeout(1200);
    const grid = p.locator("[data-testid=mp-ingresos-grid]");
    await grid.waitFor({ timeout: 60_000 });
    const found = grid.locator(`input[value="Glicerna vgetal ${device}"]`).first();
    check(`MP ${device} · la fila aparece en la tabla de Ingresos MP`, await found.count().then((n) => n > 0));
    // 2) VARIOS PRODUCTOS, sin lote / sin proveedor / sin código / sin cantidad / datos mal leídos
    await flow(p, "Ingresos MP", { supplier: "", remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [L({ description: `Prod A ${device}`, quantity: 10 }), L({ description: `Prod B ${device}`, supplierCode: "ZZ-1", lot: "LX-1" }), L({ description: `Prod C ${device}`, quantity: "4,5", unit: "KG" })] }, `mp-${device}-varios`);
    rows = await sheetRows("inv_mp_ingresos", `%Prod _ ${device}%`);
    check(`MP ${device} · varios productos incompletos: 3 filas guardadas; solo lleva código el que figuraba en el documento (ZZ-1)`, rows.length === 3 && rows.every((r) => r.payload.status === "BORRADOR") && rows.find((r) => r.payload.descripcion === `Prod B ${device}`)?.payload.codigo === "ZZ-1" && rows.filter((r) => r.payload.codigo === "").length === 2);
    check(`MP ${device} · el stock y el libro mayor NO se movieron (borradores)`, (await q("select stock_actual from mp_stock_balances where codigo = $1", [MP_CODE]))[0].stock_actual === mpStock0 && (await mpMovs()) === 0);
    // 3) SIN NADA RECONOCIDO: solo la foto
    await flow(p, "Ingresos MP", { supplier: "", remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [] }, `mp-${device}-vacio`);
    check(`MP ${device} · lectura vacía: igual se cargó una fila (vacía) para completar en la tabla`, (await q("select count(*)::int n from inv_mp_ingresos where payload->>'status' = 'BORRADOR'"))[0].n >= 5);
    // Edición posterior de una celda en la tabla + persistencia tras recargar
    await p.goto("/mi-trabajo");
    await nav(p, "Ingresos MP");
    const g2 = p.locator("[data-testid=mp-ingresos-grid]");
    await g2.waitFor({ timeout: 120_000 });
    const cell = g2.locator(`input[value="Prod A ${device}"]`).first();
    await cell.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" })); // fuera de la columna fija
    await p.waitForTimeout(300);
    await cell.dblclick({ force: true });
    await p.keyboard.press("ControlOrMeta+A");
    await p.keyboard.type(`Prod A corregido ${device}`);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(2500);
    check(`MP ${device} · corregir una celda en la tabla se guarda solo`, (await sheetRows("inv_mp_ingresos", `%Prod A corregido ${device}%`)).length === 1);
    await p.reload();
    await nav(p, "Ingresos MP");
    await p.locator("[data-testid=mp-ingresos-grid]").waitFor({ timeout: 120_000 });
    check(`MP ${device} · tras cerrar y volver a abrir, la fila incompleta y la corrección siguen ahí`, (await gridHasValue(p, "mp-ingresos-grid", `Prod A corregido ${device}`)) && (await gridHasValue(p, "mp-ingresos-grid", `Prod B ${device}`)));
    await u.ctx.close();
  }

  // ===== Depósito =====
  for (const [device, mobile] of [["escritorio", false], ["tablet", true]]) {
    const u = await openAs(E2E_USERS.deposito, mobile);
    const p = u.page;
    await flow(p, "Ingresos ME", { supplier: `${SUPPLIER} ${device}`, remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [L({ description: `Frasco mal leido ${device}`, quantity: 20 }), L({ description: `Tapa ${device}`, supplierCode: "TP-1" })] }, `me-${device}`);
    const rows = await sheetRows("inv_me_ingresos", `%${device}%`);
    check(`ME ${device} · 2 filas guardadas aunque falten código y datos; sin código no suman stock`, rows.filter((r) => String(r.payload.descripcionInsumo).includes(device)).length === 2 && rows.filter((r) => String(r.payload.descripcionInsumo).includes(device)).every((r) => r.payload.codigo === "" || r.payload.codigo === "TP-1"));
    await u.ctx.close();
  }

  // ===== Celular: «PASAR A EXCEL» siempre visible (vertical y horizontal) =====
  for (const [label, vp] of [["celular vertical", { width: 393, height: 740 }], ["celular horizontal", { width: 740, height: 360 }]]) {
    const ctx = await browser.newContext({ baseURL: BASE, ...PHONE, viewport: vp });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_USERS.materiaPrima.email);
    await page.locator('input[type="password"]').fill(E2E_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    state.custom = { supplier: "", remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [1, 2, 3, 4].map((n) => L({ description: `Producto ${n} ${label}`, quantity: n, supplierCode: `PH-${n}` })) };
    state.mode = "ok";
    state.delayMs = 100;
    await page.goto("/mi-trabajo");
    await nav(page, "Ingresos MP");
    await page.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
    await page.locator("[data-testid=nuevo-ingreso-remito]").click();
    await dlg(page).waitFor();
    await page.locator("[data-testid=remito-input-archivos]").setInputFiles([path.join(FIX, "hoja-1.jpg")]);
    await page.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
    const btn = page.locator("[data-testid=remito-pasar-excel]");
    const inView = async () => btn.evaluate((el) => { const r = el.getBoundingClientRect(); const v = window.visualViewport; const h = v ? v.height : window.innerHeight; const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { ok: r.top >= 0 && r.bottom <= h + 1 && r.width > 40 && (top === el || el.contains(top)), top: r.top, bottom: r.bottom, h }; });
    let v = await inView();
    check(`${label}: PASAR A EXCEL visible sin scrollear (${JSON.stringify(v)})`, v.ok);
    check(`${label}: el botón dice PASAR A EXCEL`, /pasar a excel/i.test(await btn.innerText()));
    // Con el teclado abierto el visualViewport se achica: el botón debe seguir dentro.
    await cdpShrink(page, vp);
    v = await inView();
    check(`${label}: con teclado (viewport reducido) sigue visible (${JSON.stringify(v)})`, v.ok);
    await page.screenshot({ path: `${OUT}/${label.replace(/ /g, "-")}.png` });
    await btn.click();
    await page.locator("[data-testid=paso-planilla]").waitFor({ timeout: 60_000 });
    check(`${label}: un toque en PASAR A EXCEL pasa las filas sin pantallas intermedias`, /Pasado al Excel/.test(await page.locator("[data-testid=paso-planilla]").innerText()));
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
  gem.close();
  await q("delete from inventory_receipt_lines where receipt_id in (select id from inventory_receipts where payload::text like $1 or supplier like $1)", [`%${RUN}%`]).catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
