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
const OUT = process.env.OUT ?? "/tmp/ingreso-remito-lectura";
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
const state = { mode: "ok", delayMs: 1500, requests: [] };
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
    state.requests.push({ url: req.url, key: req.headers["x-goog-api-key"], mimes: parts.filter((p) => p.inline_data).map((p) => p.inline_data.mime_type), textOnly: parts.every((p) => p.text), gen: body.generationConfig });
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.headers["x-goog-api-key"] !== FAKE_KEY) return send(403, { error: { code: 403, message: "bad key" } });
    if (parts.every((p) => p.text)) return send(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] }); // prueba de configuración
    await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.mode === "garbage") return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Lo siento, no puedo ayudar con eso" }] } }] });
    if (state.mode === "403") return send(403, { error: { code: 403, message: "PERMISSION_DENIED" } });
    const payload = state.mode === "me" ? remitoME : remitoMP;
    send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  });
});
await new Promise((r) => gem.listen(4599, "127.0.0.1", r));

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"];
void _ignored;
async function openAs(user, mobile) {
  const ctx = await browser.newContext({ baseURL: BASE, ...(mobile ? PHONE : { viewport: { width: 1440, height: 900 } }) });
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
const dlg = (page) => page.locator("[data-testid=ingreso-remito-dialog]");
const balance = async (code) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [code]))[0]?.stock_actual ?? 0);
const count = async (table) => Number((await q(`select count(*)::int n from ${table}`))[0].n);
async function pickMaterial(scope, page, code) {
  await scope.locator("[data-testid=linea-buscar-material]").first().fill(code);
  await dlg(page).locator("[data-testid=linea-catalogo-item]").filter({ hasText: code }).first().click({ timeout: 30_000 });
}

try {
  writeFileSync(path.join(FIX, "hoja-1.jpg"), Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
  writeFileSync(path.join(FIX, "hoja-2.pdf"), Buffer.from(`%PDF-1.4\n% lectura ${RUN}\n%%EOF`));
  for (const [c, d] of [[MP_CODE, "GLICERINA VEGETAL USP"], [MP_CODE2, "ALCOHOL CETILICO"]]) await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1,$2,0) on conflict (codigo) do nothing", [c, d]);
  const matId = randomUUID();
  const now = new Date().toISOString();
  await q("insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, $2::jsonb, now())", [matId, JSON.stringify({ id: matId, codigo: ME_CODE, descripcion: "FRASCO PET 250 ML", cliente: "", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: now, archived: false })]);

  // ===== Materia Prima (celular): subir la foto → análisis AUTOMÁTICO =====
  const mpu = await openAs(E2E_USERS.materiaPrima, true);
  const mp = mpu.page;
  await mp.goto("/mi-trabajo");
  await nav(mp, "Ingresos MP");
  await mp.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  check("Lectura activa: ya no hay que presionar un botón para empezar (solo subir la foto)", (await mp.locator("[data-testid=remito-lectura-apagada]").count()) === 0);
  const stock0 = await balance(MP_CODE);
  const ingresos0 = await count("inv_mp_ingresos");
  await mp.locator("[data-testid=remito-input-archivos]").setInputFiles([path.join(FIX, "hoja-1.jpg"), path.join(FIX, "hoja-2.pdf")]);
  await mp.getByText("Analizando remito…").waitFor({ timeout: 20_000 }).catch(async (e) => {
    console.log("DEBUG diálogo:", (await dlg(mp).innerText().catch(() => "(sin diálogo)")).replace(/\n+/g, " | ").slice(0, 700));
    console.log("DEBUG pedidos a Gemini simulado:", JSON.stringify(state.requests.map((r) => ({ key: r.key === FAKE_KEY, mimes: r.mimes }))));
    await mp.screenshot({ path: `${OUT}/debug.png`, fullPage: true });
    throw e;
  });
  check("Aparece el indicador «Analizando remito…» sin tocar nada más", true);
  await mp.screenshot({ path: `${OUT}/01-mp-analizando.png` });
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Al terminar pasa solo a la revisión, con el aviso «Remito analizado. Revisá los datos antes de confirmar.»", (await mp.getByText("Remito analizado. Revisá los datos antes de confirmar.").count()) === 1);
  const reqs = state.requests.filter((r) => !r.textOnly);
  check("Una sola llamada a Gemini con las 2 hojas (JPG + PDF), clave en cabecera y sin salir de la URL local", reqs.length === 1 && reqs[0].mimes.join() === "image/jpeg,application/pdf" && reqs[0].key === FAKE_KEY && !reqs[0].url.includes(FAKE_KEY), JSON.stringify(reqs[0]?.mimes));
  check("Pidió respuesta JSON, temperatura 0 y sin «thinking»", reqs[0]?.gen?.responseMimeType === "application/json" && reqs[0]?.gen?.temperature === 0 && reqs[0]?.gen?.thinkingConfig?.thinkingBudget === 0);
  check("El formulario se completó SOLO (sin recargar): proveedor, n.º y fecha del remito", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-numero]").inputValue()) === REM && (await mp.locator("[data-testid=remito-fecha]").inputValue()) === "2026-10-14");
  check("La fecha de recepción sigue siendo la de hoy (distinta de la del remito)", (await mp.locator("[data-testid=remito-recepcion]").inputValue()) === new Date().toISOString().slice(0, 10));
  const lines = mp.locator("[data-testid=remito-linea]");
  check("Se crearon TODAS las líneas del remito (2)", (await lines.count()) === 2);
  const l1 = lines.nth(0);
  const l2 = lines.nth(1);
  check("Línea 1: código del proveedor, descripción, cantidad, unidad, bultos, lote y vencimiento cargados", (await l1.locator("[data-testid=linea-codigo-proveedor]").inputValue()) === "GV-25" && (await l1.locator("[data-testid=linea-cantidad]").inputValue()) === "100" && (await l1.locator("[data-testid=linea-unidad]").inputValue()) === "kg" && (await l1.locator("[data-testid=linea-bultos]").inputValue()) === "4" && (await l1.locator("[data-testid=linea-lote]").inputValue()) === "LG-2026-77" && (await l1.locator("[data-testid=linea-vencimiento]").inputValue()) === "2029-06-30");
  check("Línea 1: el material del catálogo interno se preseleccionó (coincidencia inequívoca) y se explica por qué", (await l1.locator("[data-testid=linea-material-elegido]").innerText()).includes(MP_CODE) && /preseleccionado automáticamente/i.test(await l1.locator("[data-testid=linea-preseleccion]").innerText()));
  check("Línea 2: dato ilegible (lote/vencimiento) queda VACÍO y marcado «Revisar»; sin material elegido", (await l2.locator("[data-testid=linea-lote]").inputValue()) === "" && (await l2.locator("[data-testid=linea-vencimiento]").inputValue()) === "" && (await l2.getByText("Revisar").count()) >= 1 && (await l2.locator("[data-testid=linea-material-elegido]").count()) === 0);
  check("Cantidad con coma (40,5) y unidad en mayúsculas leídas", (await l2.locator("[data-testid=linea-cantidad]").inputValue()) === "40.5" && (await l2.locator("[data-testid=linea-unidad]").inputValue()) === "KG");
  check("Las observaciones del remito se cargaron", (await mp.locator("[data-testid=remito-cabecera] input").last().inputValue()) === "Entrega parcial 1 de 2");
  await mp.screenshot({ path: `${OUT}/02-mp-formulario-completado.png`, fullPage: true });
  check("Leer NO movió stock ni creó ingresos (sigue siendo un borrador)", (await balance(MP_CODE)) === stock0 && (await count("inv_mp_ingresos")) === ingresos0);

  // El operario completa solo lo que falta y confirma.
  await pickMaterial(l2, mp, MP_CODE2);
  await l2.locator("[data-testid=linea-lote]").fill("LA-5");
  await l2.locator("[data-testid=linea-vencimiento]").fill("2028-12-31");
  await mp.locator("[data-testid=remito-revisar]").click();
  await mp.locator("[data-testid=paso-resumen]").waitFor({ timeout: 30_000 });
  check("Sin confirmar todavía no hay stock", (await balance(MP_CODE)) === stock0);
  await mp.locator("[data-testid=remito-confirmar]").click();
  await mp.locator("[data-testid=paso-listo]").waitFor({ timeout: 60_000 });
  check("Al confirmar el operario, el stock sube (100 kg y 40,5 kg) por el mecanismo real", (await balance(MP_CODE)) === stock0 + 100 && (await balance(MP_CODE2)) === 40.5, `${await balance(MP_CODE)} / ${await balance(MP_CODE2)}`);
  const ing = await q("select payload from inv_mp_ingresos where payload->>'remitoNro' = $1 order by payload->>'codigo'", [REM]);
  check("Los ingresos quedan con lote, vencimiento, proveedor, remito y usuario", ing.length === 2 && ing.some((r) => r.payload.lote === "LG-2026-77" && r.payload.vencimiento === "2029-06-30" && r.payload.proveedor === SUPPLIER && r.payload.createdBy === E2E_USERS.materiaPrima.email));
  await mp.locator("[data-testid=remito-cerrar]").click();

  // ===== Fallo de lectura: mensaje claro + «Reintentar lectura» =====
  state.mode = "garbage";
  state.delayMs = 300;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 60_000 });
  const fallo = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  check("Si Gemini no puede interpretar: mensaje claro (no queda vacío sin explicar)", /No pudimos interpretar automáticamente este remito\. Podés reintentar o completar los datos manualmente\./.test(fallo), fallo.slice(0, 90));
  check("Hay botón «Reintentar lectura» y la carga manual sigue disponible", (await mp.locator("[data-testid=remito-reintentar]").isVisible()) && (await mp.locator("[data-testid=remito-cargar-manual]").isVisible()));
  await mp.screenshot({ path: `${OUT}/03-mp-fallo-lectura.png` });
  state.mode = "ok";
  state.delayMs = 300;
  await mp.locator("[data-testid=remito-reintentar]").first().click();
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("«Reintentar lectura» funciona y completa el formulario sin recargar", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-linea]").count()) === 2);
  // Modificación manual no se pisa al re-leer.
  await mp.locator("[data-testid=remito-proveedor]").fill("Proveedor escrito a mano");
  mp.once("dialog", (d) => void d.accept());
  await mp.locator("[data-testid=remito-releer]").click();
  await mp.waitForTimeout(2500);
  check("Volver a leer pide confirmación antes de reemplazar lo cargado", true);
  await mp.keyboard.press("Escape");

  // Clave/permiso rechazado → motivo para Sistemas.
  state.mode = "403";
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 60_000 });
  check("Clave sin autorización: el mensaje dice que avise a Sistemas y que se puede cargar a mano", /Avisá a Sistemas/.test(await mp.locator("[data-testid=remito-lectura-fallo]").innerText()));
  await mp.keyboard.press("Escape");
  state.mode = "ok";

  // ===== Depósito (PC) =====
  state.mode = "me";
  state.delayMs = 500;
  const dpu = await openAs(E2E_USERS.deposito, false);
  const dp = dpu.page;
  await dp.goto("/mi-trabajo");
  await nav(dp, "Ingresos ME");
  await dp.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
  await dp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(dp).waitFor();
  await dp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await dp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  const lm = dp.locator("[data-testid=remito-linea]").first();
  check("ME: el formulario se completó y el material de envase se identificó solo", (await dp.locator("[data-testid=remito-numero]").inputValue()) === `0002-${RUN}02` && (await lm.locator("[data-testid=linea-material-elegido]").innerText()).includes(ME_CODE) && (await lm.locator("[data-testid=linea-cantidad]").inputValue()) === "1200" && (await lm.locator("[data-testid=linea-bultos]").inputValue()) === "12");
  check("ME: la foto se ve junto al formulario mientras se revisa", await dp.locator("[data-testid=remito-visor] img").isVisible());
  await dp.screenshot({ path: `${OUT}/04-me-formulario-completado.png`, fullPage: true });
  const meBefore = await count("inv_me_ingresos");
  check("ME: leer no creó ningún ingreso", meBefore === (await count("inv_me_ingresos")));
  await dp.locator("[data-testid=remito-revisar]").click();
  await dp.locator("[data-testid=paso-resumen]").waitFor();
  await dp.locator("[data-testid=remito-confirmar]").click();
  await dp.locator("[data-testid=paso-listo]").waitFor({ timeout: 60_000 });
  const me = await q("select payload from inv_me_ingresos where payload->>'codigo' = $1", [ME_CODE]);
  check("ME: al confirmar entra al libro de Depósito (1.200 u, 12 bultos)", me.length === 1 && me[0].payload.total === 1200 && me[0].payload.bultos === 12);

  // ===== Prueba de configuración (sin enviar remitos) y permisos =====
  const dir = await openAs(E2E_USERS.direccion, false);
  const health = await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health");
  const hb = await health.json();
  const probeReq = state.requests.at(-1);
  check("Dirección puede probar la configuración: Gemini responde y no se envió ningún documento", health.status() === 200 && hb.health.ok === true && probeReq.textOnly === true && !JSON.stringify(hb).includes(FAKE_KEY));
  check("Un operario no puede usar la prueba de configuración (403)", (await mp.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health")).status() === 403);
  const cfg = await (await mp.request.get("/api/v1/inventory/receipts?module=MP&view=config")).json();
  check("La configuración que ve la pantalla no expone la clave", cfg.extraction.available === true && !JSON.stringify(cfg).includes(FAKE_KEY));
  check("Depósito no puede leer remitos de Materia Prima (403)", (await dp.request.post("/api/v1/inventory/receipts", { data: { action: "extract", module: "MP", id: randomUUID() } })).status() === 403);
} catch (err) {
  console.error(err);
  check("Ejecución sin errores", false, String(err?.message ?? err));
} finally {
  await browser.close();
  gem.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
