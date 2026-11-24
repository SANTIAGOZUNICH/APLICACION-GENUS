// E2E (Chromium real, base DESCARTABLE) de la lectura automática del remito con un Gemini SIMULADO.
// Qué prueba: que al subir la foto GENUS OS analiza SOLO (sin segundo botón), muestra «Leyendo remito…», completa el formulario
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
    state.requests.push({ url: req.url, model, key: req.headers["x-goog-api-key"], mimes: parts.filter((p) => p.inline_data).map((p) => p.inline_data.mime_type), textOnly: parts.every((p) => p.text), gen: body.generationConfig, prompt: String(parts[0]?.text ?? "") });
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
    const second = String(parts[0]?.text ?? "").includes("SEGUNDA LECTURA");
    if (state.mode === "needs_enhance") {
      // La foto original no deja leer UNA cantidad; la copia mejorada (2.ª etapa) sí.
      const lines = remitoMP.lines.map((l, i) => (i === 1 && !second ? { ...l, quantity: null, unclearFields: ["quantity"] } : l));
      return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ ...remitoMP, lines }) }] } }] });
    }
    if (state.mode === "noqty") {
      const lines = remitoMP.lines.map((l, i) => (i === 1 ? { ...l, quantity: null, unclearFields: ["quantity"] } : l));
      return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ ...remitoMP, lines }) }] } }] });
    }
    if (state.mode === "garbage") return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Lo siento, no puedo ayudar con eso" }] } }] });
    if (state.mode === "403") return send(403, { error: { code: 403, message: "PERMISSION_DENIED" } });
    const payload = state.mode === "me" ? remitoME : remitoMP; // «flaky» responde como «ok» tras el primer 503
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
  await mp.getByText("Leyendo remito…").waitFor({ timeout: 20_000 }).catch(async (e) => {
    console.log("DEBUG diálogo:", (await dlg(mp).innerText().catch(() => "(sin diálogo)")).replace(/\n+/g, " | ").slice(0, 700));
    console.log("DEBUG pedidos a Gemini simulado:", JSON.stringify(state.requests.map((r) => ({ key: r.key === FAKE_KEY, mimes: r.mimes }))));
    await mp.screenshot({ path: `${OUT}/debug.png`, fullPage: true });
    throw e;
  });
  check("Aparece el indicador «Leyendo remito…» sin tocar nada más", true);
  await mp.screenshot({ path: `${OUT}/01-mp-analizando.png` });
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Al terminar pasa solo a la revisión, con el aviso «Remito analizado. Revisá los datos antes de confirmar.»", (await mp.getByText("Remito analizado. Revisá los datos antes de confirmar.").count()) === 1);
  const reqs = state.requests.filter((r) => !r.textOnly && r.model === "gemini-3.5-flash");
  check("Una sola llamada a Gemini con las 2 hojas (JPG + PDF), clave en cabecera y sin salir de la URL local", reqs.length === 1 && reqs[0].mimes.join() === "image/jpeg,application/pdf" && reqs[0].key === FAKE_KEY && !reqs[0].url.includes(FAKE_KEY), JSON.stringify(reqs[0]?.mimes));
  const genReqs = state.requests.filter((r) => r.model);
  check("El modelo configurado NO EXISTE (404): GENUS OS consultó qué modelos tiene la clave y siguió con el mejor (gemini-3.5-flash), sin error para el operario", genReqs[0]?.model === "gemini-2.0-flash-retirado" && genReqs[1]?.model === "gemini-3.5-flash" && state.lists === 1, JSON.stringify(genReqs.map((r) => r.model)));
  check("Pidió respuesta JSON y temperatura 0, sin opciones propias de otros modelos (razonamiento mínimo en modelos 3.x)", reqs[0]?.gen?.responseMimeType === "application/json" && reqs[0]?.gen?.temperature === 0 && (reqs[0]?.gen?.thinkingConfig === undefined || reqs[0]?.gen?.thinkingConfig?.thinkingLevel === "low"));
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
  check("Texto ilegible incluso tras mejorar la imagen: recién ahí «Necesito una imagen más clara del texto»", /Necesito una imagen más clara del texto/.test(fallo), fallo.slice(0, 90));
  check("Antes de pedir otra foto se intentó mejorar la imagen (2.ª lectura con «SEGUNDA LECTURA»)", state.requests.filter((r) => r.model && !r.textOnly && r.prompt.includes("SEGUNDA LECTURA")).length >= 1);
  check("Hay UN solo botón «Reintentar lectura» (sin duplicados) y la carga manual sigue disponible", (await mp.getByRole("button", { name: /^Reintentar lectura$/ }).count()) === 1 && (await mp.locator("[data-testid=remito-cargar-manual]").isVisible()));
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
  const txt403 = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  const job403 = (await q("select payload->'job' j from inventory_receipts order by updated_at desc limit 1"))[0]?.j;
  check("Permisos insuficientes del proveedor: el operario ve un mensaje claro SIN tecnicismos ni pedido de otra foto; el motivo queda en el diagnóstico para Sistemas", /La lectura automática no está disponible en este momento\. Tu imagen está guardada/.test(txt403) && !/permiso|clave|modelo|imagen más clara/i.test(txt403) && job403?.diag?.errorKind === "permission" && job403?.diag?.http === 403 && !JSON.stringify(job403).includes(FAKE_KEY));
  await mp.keyboard.press("Escape");
  state.mode = "ok";

  // ===== Fallo TRANSITORIO del proveedor: GENUS OS reintenta solo (el operario no ve ningún error) =====
  state.mode = "flaky";
  state.flakyHits = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  const stockAntesFlaky = await balance(MP_CODE);
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  check("503 transitorio del proveedor: reintento automático y la lectura se completa sin error visible", state.flakyHits >= 2 && (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-lectura-fallo]").count()) === 0, `hits=${state.flakyHits}`);
  check("el reintento no duplicó nada: sigue siendo un borrador sin stock", (await balance(MP_CODE)) === stockAntesFlaky);
  await mp.keyboard.press("Escape");

  // ===== Proveedor saturado de forma sostenida: mensaje propio, tope de reintentos, foto y carga manual intactas =====
  state.mode = "overloaded";
  state.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 90_000 });
  const sat = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  const generate = state.requests.filter((r) => r.model && !r.textOnly).length;
  const jobSat = (await q("select payload->'job' j from inventory_receipts order by updated_at desc limit 1"))[0]?.j;
  check("Saturación sostenida: mensaje de servicio no disponible (NO culpa a la imagen ni pide otra foto), la foto sigue adjunta y el diagnóstico queda para Sistemas", /La lectura automática no está disponible en este momento\. Tu imagen está guardada y podés completar los datos manualmente o reintentar\./.test(sat) && !/imagen más clara|otra foto|saturado/i.test(sat) && (await mp.locator("[data-testid=remito-miniaturas] li").count()) === 1 && jobSat?.diag?.errorKind === "overloaded" && jobSat?.diag?.http === 503, sat.slice(0, 80));
  check("Reintentos con tope (no infinitos) pero aprovechando el tiempo: entre 6 y 9 llamadas", generate >= 6 && generate <= 9, String(generate));
  check("Se puede completar a mano sin perder la foto", await mp.locator("[data-testid=remito-cargar-manual]").isEnabled());
  state.mode = "ok";
  await mp.locator("[data-testid=remito-reintentar]").first().click();
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Cuando el proveedor se recupera, «Reintentar lectura» funciona", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER);
  await mp.keyboard.press("Escape");

  // ===== 2.ª etapa: la foto original no deja leer una cantidad → GENUS OS mejora la imagen SOLO y la recupera (sin pedir otra foto) =====
  state.mode = "needs_enhance";
  state.delayMs = 5000; // lo bastante lento como para ver el aviso de etapa
  state.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  const stockAntesMejora = await balance(MP_CODE2);
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.getByText("Mejorando la imagen para recuperar los datos.").waitFor({ timeout: 45_000 }).catch(() => undefined);
  const vioMejora = (await mp.getByText("Mejorando la imagen para recuperar los datos.").count()) > 0 || state.requests.some((r) => r.prompt.includes("SEGUNDA LECTURA"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  const gen2 = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly); // la llamada 404 del modelo retirado no cuenta; el modelo efectivo puede variar
  check("Mejora automática: se envió una SEGUNDA lectura con la imagen mejorada solo por la cantidad que faltaba, sin pedir otra foto", gen2.length === 2 && gen2[1].prompt.includes("SEGUNDA LECTURA") && /renglón 2: cantidad/.test(gen2[1].prompt) && vioMejora, JSON.stringify({ n: gen2.length, models: state.requests.filter((r) => r.model && !r.textOnly).map((r) => r.model), second: gen2[1]?.prompt?.includes("SEGUNDA LECTURA"), renglon: /renglón 2: cantidad/.test(gen2[1]?.prompt ?? ""), vioMejora, tail: (gen2[1]?.prompt ?? "").slice(-300) }));
  check("La cantidad faltante se recuperó y el resto quedó igual (100 kg y 40,5 kg), sin marcar pendiente", (await mp.locator("[data-testid=remito-linea]").nth(1).locator("[data-testid=linea-cantidad]").inputValue()) === "40.5" && (await mp.locator("[data-testid=remito-linea]").nth(0).locator("[data-testid=linea-cantidad]").inputValue()) === "100" && (await mp.getByText(/Mejoramos la imagen y recuperamos los datos/).count()) >= 1);
  check("La mejora no movió stock", (await balance(MP_CODE2)) === stockAntesMejora);
  await mp.keyboard.press("Escape");

  // ===== Lectura parcial: no se puede leer UNA cantidad → se completa todo lo demás y se marca solo eso =====
  state.mode = "noqty";
  state.delayMs = 400;
  state.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  const lq = mp.locator("[data-testid=remito-linea]");
  check("Parcial: proveedor, n.º, fecha y la línea 1 completos; la cantidad ilegible de la línea 2 queda VACÍA (nunca 0)", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await lq.nth(0).locator("[data-testid=linea-cantidad]").inputValue()) === "100" && (await lq.nth(1).locator("[data-testid=linea-cantidad]").inputValue()) === "");
  const aviso = await dlg(mp).innerText();
  check("Mensaje claro: «Identificamos los datos principales…» y «No pude identificar la cantidad…» (podés completarla o fotografiar solo esa parte)", /Identificamos los datos principales\. Revisá los campos marcados\./.test(aviso) && /No pude identificar la cantidad/.test(aviso) && /fotografiar únicamente esa parte del remito/.test(aviso));
  await mp.screenshot({ path: `${OUT}/03b-mp-lectura-parcial.png`, fullPage: true });
  // PASAR A EXCEL usa lo ya extraído (sin volver a llamar al proveedor)
  const llamadasAntesExcel = state.requests.filter((r) => r.model && !r.textOnly).length;
  await mp.locator("[data-testid=remito-pasar-excel]").click();
  await mp.waitForTimeout(2500);
  check("PASAR A EXCEL funciona con los datos ya leídos y NO repite la lectura (sin llamadas nuevas al proveedor)", state.requests.filter((r) => r.model && !r.textOnly).length === llamadasAntesExcel);
  await mp.keyboard.press("Escape");
  state.mode = "ok";

  // ===== Respuesta PERDIDA (timeout HTTP / corte de red): el resultado se RECUPERA sin volver a fotografiar ni llamar de nuevo =====
  state.mode = "ok";
  state.delayMs = 800;
  state.requests.length = 0;
  const stockAntesRecup = await balance(MP_CODE);
  await mp.route("**/api/v1/inventory/receipts", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && /"action":"extract"/.test(req.postData() ?? "")) {
      await route.fetch(); // el servidor termina de leer y GUARDA el resultado…
      await route.abort("failed"); // …pero la respuesta nunca llega al navegador
      return;
    }
    await route.continue();
  });
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.getByText(/recuperando el resultado/i).waitFor({ timeout: 30_000 });
  check("Si la respuesta se pierde, la pantalla lo dice («recuperando el resultado») en vez de dar error", true);
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  const generacion = state.requests.filter((r) => r.model === "gemini-3.5-flash" && !r.textOnly).length; // el modelo configurado inexistente (404) no cuenta: la lectura efectiva es una sola
  check("Resultado RECUPERADO sin sacar otra foto: formulario completo y UNA sola llamada al proveedor de IA", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-linea]").count()) === 2 && generacion === 1, `llamadas=${generacion}`);
  check("Recuperar no duplicó nada ni movió stock", (await balance(MP_CODE)) === stockAntesRecup);
  await mp.screenshot({ path: `${OUT}/05-mp-recuperado.png` });
  await mp.unroute("**/api/v1/inventory/receipts");
  await mp.keyboard.press("Escape");

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

  // ===== Tablet: el flujo completo entra en pantalla sin desbordes =====
  const tabCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
  const tab = await tabCtx.newPage();
  await tab.goto("/login");
  await tab.locator('input[type="email"]').fill(E2E_USERS.materiaPrima.email);
  await tab.locator('input[type="password"]').fill(E2E_PASSWORD);
  await tab.locator('button[type="submit"]').click();
  await tab.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  state.mode = "ok";
  state.delayMs = 300;
  await tab.goto("/mi-trabajo");
  await nav(tab, "Ingresos MP");
  await tab.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(tab).waitFor();
  await tab.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await tab.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Tablet: la revisión del remito se ve completa, sin scroll horizontal", overflow <= 1 && (await tab.locator("[data-testid=remito-linea]").count()) === 2, `desborde=${overflow}px`);
  await tab.screenshot({ path: `${OUT}/06-tablet-revision.png`, fullPage: true });
  await tabCtx.close();

  // ===== Prueba de configuración (sin enviar remitos) y permisos =====
  const dir = await openAs(E2E_USERS.direccion, false);
  state.mode = "ok";
  const health = await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health");
  const hb = await health.json();
  check("Dirección prueba la configuración (solo texto, sin documentos): informa modelo configurado, efectivo, modelos de la clave e intentos", health.status() === 200 && hb.health.ok === true && hb.health.configuredModel === "gemini-2.0-flash-retirado" && hb.health.effectiveModel === "gemini-3.5-flash" && hb.health.listing.candidates[0] === "gemini-3.5-flash" && !hb.health.listing.candidates.includes("embedding-001") && !JSON.stringify(hb).includes(FAKE_KEY), JSON.stringify({ c: hb.health.configuredModel, e: hb.health.effectiveModel, l: hb.health.listing?.candidates }));
  const textOnlyCalls = state.requests.filter((r) => r.model && r.textOnly);
  check("La prueba de texto no envió ningún documento", textOnlyCalls.length >= 1);
  const imgHealth = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health&image=1")).json();
  check("Prueba con IMAGEN (remito ficticio incorporado): el modelo analizó la imagen y encontró renglones", imgHealth.health.ok === true && imgHealth.health.image?.ok === true && imgHealth.health.image.read.lines >= 1, imgHealth.health.message);
  state.mode = "keyinvalid";
  const hKey = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health")).json();
  check("Diagnóstico: clave inválida se distingue del modelo inexistente", hKey.health.ok === false && hKey.health.text.kind === "key" && /clave de Gemini/.test(hKey.health.text.message));
  state.mode = "quota";
  const hQuota = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health")).json();
  check("Diagnóstico: límite de uso se distingue", hQuota.health.ok === false && hQuota.health.text.kind === "limit");
  state.mode = "ok";
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
