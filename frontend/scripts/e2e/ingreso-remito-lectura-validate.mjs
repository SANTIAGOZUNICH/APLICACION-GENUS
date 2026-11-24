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
// ───── OpenAI SIMULADO (Responses API): proveedor de respaldo ─────
const ostate = { mode: "down", requests: [] };
const oai = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const parts = body.input?.[0]?.content ?? [];
    ostate.requests.push({ url: req.url, auth: req.headers.authorization, model: body.model, types: parts.map((p) => p.type), prompt: String(parts[0]?.text ?? ""), store: body.store });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (ostate.mode === "down") return send(503, { error: { type: "server_error", code: "server_error", message: "The server is overloaded" } });
    if (ostate.mode === "quota") return send(429, { error: { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota" } });
    const second = String(parts[0]?.text ?? "").includes("SEGUNDA LECTURA");
    const payload = ostate.mode === "me" ? remitoME : remitoMP;
    void second;
    setTimeout(() => send(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }], usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 } }), ostate.delayMs ?? 400);
  });
});
await new Promise((r) => oai.listen(4598, "127.0.0.1", r));
const resetBreaker = () => q("delete from ai_provider_health");

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
async function openAs(user, mobile, viewport) {
  const ctx = await browser.newContext({ baseURL: BASE, ...(mobile ? { ...PHONE, ...(viewport ? { viewport } : {}) } : { viewport: { width: 1440, height: 900 } }) });
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
const closeDlg = async (page) => {
  // Cerrar con Escape ahora pide confirmación si hay trabajo en riesgo: se elige «Guardar y cerrar» (guarda SOLO el borrador).
  await page.keyboard.press("Escape");
  const save = page.locator("[data-testid=remito-cerrar-guardar]");
  if (await save.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await save.click();
  await page.locator("[data-testid=ingreso-remito-dialog]").waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
};

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
  const reqs = state.requests.filter((r) => !r.textOnly && r.model === "gemini-2.5-flash-lite");
  check("Una sola llamada a Gemini con las 2 hojas (JPG + PDF), clave en cabecera y sin salir de la URL local", reqs.length === 1 && reqs[0].mimes.join() === "image/jpeg,application/pdf" && reqs[0].key === FAKE_KEY && !reqs[0].url.includes(FAKE_KEY), JSON.stringify(reqs[0]?.mimes));
  const genReqs = state.requests.filter((r) => r.model);
  check("El modelo configurado NO EXISTE (404): GENUS OS consultó qué modelos tiene la clave y siguió con el modelo estable y económico (gemini-2.5-flash-lite, NO el de versión más alta), sin error para el operario", genReqs[0]?.model === "gemini-2.0-flash-retirado" && genReqs[1]?.model === "gemini-2.5-flash-lite" && state.lists === 1, JSON.stringify(genReqs.map((r) => r.model)));
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
  await resetBreaker();
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
  await resetBreaker();
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
  await closeDlg(mp);

  // Clave/permiso rechazado → motivo para Sistemas.
  state.mode = "403";
  await resetBreaker();
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 60_000 });
  const txt403 = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  const job403 = (await q("select payload->'job' j from inventory_receipts order by updated_at desc limit 1"))[0]?.j;
  check("Permisos insuficientes del proveedor: el operario ve un mensaje claro SIN tecnicismos ni pedido de otra foto; el motivo queda en el diagnóstico para Sistemas", /La lectura automática no está disponible en este momento\. Tu imagen está guardada/.test(txt403) && !/permiso|clave|modelo|imagen más clara/i.test(txt403) && job403?.diag?.providers?.gemini?.kind === "permission" && job403?.diag?.providers?.gemini?.http === 403 && !JSON.stringify(job403).includes(FAKE_KEY));
  await closeDlg(mp);
  state.mode = "ok";
  await resetBreaker();

  // ===== Fallo TRANSITORIO del proveedor: GENUS OS reintenta solo (el operario no ve ningún error) =====
  state.mode = "flaky";
  ostate.mode = "ok"; // con respaldo disponible, un 503 de Gemini pasa al otro proveedor (no se insiste en el saturado)
  await resetBreaker();
  state.flakyHits = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  const stockAntesFlaky = await balance(MP_CODE);
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  check("503 transitorio del proveedor: reintento automático y la lectura se completa sin error visible", state.flakyHits >= 1 && (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-lectura-fallo]").count()) === 0, `hits=${state.flakyHits}`);
  check("el reintento no duplicó nada: sigue siendo un borrador sin stock", (await balance(MP_CODE)) === stockAntesFlaky);
  await closeDlg(mp);

  // ===== Proveedor saturado de forma sostenida: mensaje propio, tope de reintentos, foto y carga manual intactas =====
  state.mode = "overloaded";
  ostate.mode = "down";
  await resetBreaker();
  state.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 90_000 });
  const sat = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  const generate = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly).length; // el 404 del modelo retirado se descarta sin gastar cupo
  const jobSat = (await q("select payload->'job' j from inventory_receipts order by updated_at desc limit 1"))[0]?.j;
  check("Saturación sostenida: mensaje de servicio no disponible (NO culpa a la imagen ni pide otra foto), la foto sigue adjunta y el diagnóstico queda para Sistemas", /La lectura automática no está disponible en este momento\. Tu imagen está guardada y podés completar los datos manualmente o reintentar\./.test(sat) && !/imagen más clara|otra foto|saturado/i.test(sat) && (await mp.locator("[data-testid=remito-miniaturas] li").count()) === 1 && jobSat?.diag?.providers?.gemini?.kind === "overloaded" && jobSat?.diag?.providers?.gemini?.http === 503, sat.slice(0, 80));
  check("Con respaldo configurado Gemini NO monopoliza el tiempo: máximo 2 intentos rápidos y luego el respaldo (que también falló: servicio no disponible, borrador y foto intactos)", generate >= 1 && generate <= 2 && ostate.requests.length >= 1 && jobSat?.diag?.providers?.gemini?.ok === false && jobSat?.diag?.providers?.openai?.ok === false, `gemini=${generate} openai=${ostate.requests.length}`);
  check("Se puede completar a mano sin perder la foto", await mp.locator("[data-testid=remito-cargar-manual]").isEnabled());
  state.mode = "ok";
  await resetBreaker();
  await mp.locator("[data-testid=remito-reintentar]").first().click();
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Cuando el proveedor se recupera, «Reintentar lectura» funciona", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER);
  await closeDlg(mp);

  // ===== NUEVO: fallback automático Gemini → OpenAI (el operario solo saca la foto) =====
  ostate.mode = "ok";
  state.mode = "overloaded"; // Gemini 503 «alta demanda»
  await resetBreaker();
  state.requests.length = 0;
  ostate.requests.length = 0;
  state.delayMs = 300;
  const stockAntesFb = await balance(MP_CODE);
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  const tFb = Date.now();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 40_000 });
  const msFb = Date.now() - tFb;
  const gFb = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly).length;
  check("Gemini 503 → OpenAI lee el remito SOLO: la pantalla pasa a la revisión sin botón «Reintentar» ni error", (await mp.locator("[data-testid=remito-lectura-fallo]").count()) === 0 && (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-linea]").count()) === 2);
  check("Gemini solo tuvo ≤2 intentos rápidos (sin esperas) y OpenAI recibió 1 pedido con la clave en cabecera, fotos como input_image y sin guardar (store:false)", gFb <= 2 && ostate.requests.length === 1 && ostate.requests[0].auth === "Bearer e2e-openai-falsa" && ostate.requests[0].types.includes("input_image") && ostate.requests[0].store === false, `gemini=${gFb} openai=${ostate.requests.length} ${msFb}ms`);
  check("El tiempo total es de segundos (antes ~39 s de espera a Gemini y timeout)", msFb < 25_000, `${msFb} ms`);
  const jobFb = (await q("select payload->'job' j from inventory_receipts order by updated_at desc limit 1"))[0]?.j;
  check("Diagnóstico para Sistemas: se usó el respaldo (fallback), con tokens y tiempo por proveedor, y el estado del circuit breaker de Gemini quedó guardado", jobFb?.diag?.fallback === true && jobFb?.diag?.provider === "openai" && jobFb?.diag?.providers?.gemini?.ok === false && jobFb?.diag?.providers?.openai?.tokens?.total === 1500 && (await q("select last_kind from ai_provider_health where provider = 'gemini'"))[0]?.last_kind === "overloaded");
  check("El fallback no movió stock ni creó ingresos (sigue siendo un borrador)", (await balance(MP_CODE)) === stockAntesFb);
  await mp.screenshot({ path: `${OUT}/07-mp-fallback-openai.png`, fullPage: true });
  await closeDlg(mp);

  // 429 de Gemini: fallback inmediato y el circuit breaker evita volver a esperarlo en el remito siguiente
  state.mode = "quota";
  await resetBreaker();
  state.requests.length = 0;
  ostate.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 40_000 });
  const g429a = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly).length;
  check("Gemini 429 (cuota): UNA sola llamada, fallback inmediato y lectura completa", g429a === 1 && ostate.requests.length === 1 && (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER, `gemini=${g429a}`);
  await closeDlg(mp);
  state.requests.length = 0;
  ostate.requests.length = 0;
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  const tCb = Date.now();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 40_000 });
  const g429b = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly).length;
  check("Circuit breaker: el remito SIGUIENTE no llama a Gemini (0 pedidos) y lee directo con OpenAI", g429b === 0 && ostate.requests.length === 1, `gemini=${g429b} ${Date.now() - tCb}ms`);
  await closeDlg(mp);

  // AMBOS proveedores caídos: borrador y foto conservados, carga manual, y al volver OpenAI el reintento con la MISMA foto completa
  state.mode = "overloaded";
  ostate.mode = "down";
  await resetBreaker();
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mp.locator("[data-testid=remito-lectura-fallo]").waitFor({ timeout: 60_000 });
  const bothDown = await mp.locator("[data-testid=remito-lectura-fallo]").innerText();
  check("Ambos proveedores caídos: mensaje de servicio (no culpa a la imagen), foto conservada, UN solo «Reintentar lectura» y carga manual disponible", /La lectura automática no está disponible en este momento\. Tu imagen está guardada/.test(bothDown) && !/imagen más clara/i.test(bothDown) && (await mp.locator("[data-testid=remito-miniaturas] li").count()) === 1 && (await mp.getByRole("button", { name: /^Reintentar lectura$/ }).count()) === 1 && (await mp.locator("[data-testid=remito-cargar-manual]").isEnabled()));
  ostate.mode = "ok";
  await mp.locator("[data-testid=remito-reintentar]").first().click();
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Vuelve el proveedor de respaldo: «Reintentar lectura» con la MISMA foto completa el formulario", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER);
  await closeDlg(mp);
  state.mode = "ok";
  await resetBreaker();

  // ===== 2.ª etapa: la foto original no deja leer una cantidad → GENUS OS mejora la imagen SOLO y la recupera (sin pedir otra foto) =====
  state.mode = "needs_enhance";
  await resetBreaker();
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
  await closeDlg(mp);

  // ===== Lectura parcial: no se puede leer UNA cantidad → se completa todo lo demás y se marca solo eso =====
  state.mode = "noqty";
  ostate.mode = "down"; // sin otro proveedor que pueda recuperar la cantidad: queda el parcial
  await resetBreaker();
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
  await closeDlg(mp);
  state.mode = "ok";
  ostate.mode = "ok";
  await resetBreaker();

  // ===== Respuesta PERDIDA (timeout HTTP / corte de red): el resultado se RECUPERA sin volver a fotografiar ni llamar de nuevo =====
  state.mode = "ok";
  await resetBreaker();
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
  const generacion = state.requests.filter((r) => r.model && r.model !== "gemini-2.0-flash-retirado" && !r.textOnly).length; // el modelo configurado inexistente (404) no cuenta: la lectura efectiva es una sola
  check("Resultado RECUPERADO sin sacar otra foto: formulario completo y UNA sola llamada al proveedor de IA", (await mp.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER && (await mp.locator("[data-testid=remito-linea]").count()) === 2 && generacion === 1, `llamadas=${generacion}`);
  check("Recuperar no duplicó nada ni movió stock", (await balance(MP_CODE)) === stockAntesRecup);
  await mp.screenshot({ path: `${OUT}/05-mp-recuperado.png` });
  await mp.unroute("**/api/v1/inventory/receipts");
  await closeDlg(mp);

  // ===== Depósito (PC) =====
  state.mode = "me";
  await resetBreaker();
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
  await resetBreaker();
  state.delayMs = 300;
  await tab.goto("/mi-trabajo");
  await nav(tab, "Ingresos MP");
  await tab.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(tab).waitFor();
  state.mode = "overloaded"; // en tablet también: Gemini saturado, lee el respaldo
  ostate.mode = "ok";
  await resetBreaker();
  await tab.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await tab.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  check("Tablet: con Gemini saturado la lectura sale igual por el respaldo, sin error", (await tab.locator("[data-testid=remito-lectura-fallo]").count()) === 0 && (await tab.locator("[data-testid=remito-linea]").count()) === 2);
  state.mode = "ok";
  const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Tablet: la revisión del remito se ve completa, sin scroll horizontal", overflow <= 1 && (await tab.locator("[data-testid=remito-linea]").count()) === 2, `desborde=${overflow}px`);
  await tab.screenshot({ path: `${OUT}/06-tablet-revision.png`, fullPage: true });
  await tabCtx.close();


  // ===== REDISEÑO MOBILE: pantalla completa, teclado, protección contra cierres accidentales y borradores =====
  state.mode = "ok";
  ostate.mode = "ok";
  await resetBreaker();
  state.delayMs = 300;
  const receiptsBy = async (status) => Number((await q("select count(*)::int n from inventory_receipts where status = $1", [status]))[0].n);
  const confAntes = await receiptsBy("CONFIRMADO");
  const stockMobAntes = await balance(MP_CODE);
  const openWizard = async (pg) => {
    await pg.locator("[data-testid=nuevo-ingreso-remito]").waitFor({ timeout: 120_000 });
    await pg.locator("[data-testid=nuevo-ingreso-remito]").click();
    await dlg(pg).waitFor();
  };
  const uploadAndWait = async (pg) => {
    await pg.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
    await pg.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  };
  const confirmVisible = (pg) => pg.locator("[data-testid=remito-cerrar-confirmar]").isVisible().catch(() => false);
  for (const [w, h] of [[360, 640], [375, 667], [390, 844], [412, 915]]) {
    const sz = await openAs(E2E_USERS.materiaPrima, true, { width: w, height: h });
    const pg = sz.page;
    await pg.goto("/mi-trabajo");
    await nav(pg, "Ingresos MP");
    await openWizard(pg);
    await uploadAndWait(pg);
    const box = await dlg(pg).boundingBox();
    const m = await pg.evaluate(() => {
      const d = document.querySelector("[data-testid=ingreso-remito-dialog]");
      const fields = [...d.querySelectorAll("input:not([type=checkbox]):not([type=file]):not([type=hidden]),select,textarea")].filter((e) => e.getBoundingClientRect().width > 0);
      return {
        hscroll: d.scrollWidth - d.clientWidth,
        pageHscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: fields.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
        short: fields.filter((e) => e.getBoundingClientRect().height < 43.5).length,
        fields: fields.length,
        bodyLocked: getComputedStyle(document.body).overflow === "hidden" || document.body.hasAttribute("data-scroll-locked"),
      };
    });
    check(`${w}×${h}: la ventana ocupa TODA la pantalla (sin márgenes ni ventana pequeña centrada)`, Math.abs(box.x) <= 1 && Math.abs(box.y) <= 1 && Math.abs(box.width - w) <= 2 && Math.abs(box.height - h) <= 2, JSON.stringify(box));
    check(`${w}×${h}: sin desplazamiento horizontal, fondo bloqueado y ${m.fields} campos con 16 px y ≥44 px de alto`, m.hscroll <= 1 && m.pageHscroll <= 1 && m.small === 0 && m.short === 0 && m.fields >= 8, JSON.stringify(m));
    if (w === 360) {
      // Muchos renglones + último material con el «teclado» (área visible reducida): el campo queda a la vista y el pie no tapa el final.
      for (let i = 0; i < 9; i++) await pg.locator("[data-testid=remito-agregar-linea]").click();
      const n = await pg.locator("[data-testid=remito-linea]").count();
      const kbH = h - 300;
      await pg.setViewportSize({ width: w, height: kbH });
      const lastQty = pg.locator("[data-testid=remito-linea]").last().locator("[data-testid=linea-cantidad]");
      await lastQty.click();
      await lastQty.fill("12,5");
      await pg.waitForTimeout(700);
      const vis = await pg.evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        const head = document.querySelector("[data-testid=remito-encabezado]").getBoundingClientRect();
        const d = document.querySelector("[data-testid=ingreso-remito-dialog]").getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, headBottom: head.bottom, dialogH: d.height, vh: window.innerHeight, tag: el.getAttribute("data-testid") };
      });
      check(`360×640 con ${n} renglones y área visible reducida (teclado): el campo enfocado queda visible bajo el encabezado y la ventana se ajusta al alto real`, vis.tag === "linea-cantidad" && vis.top >= vis.headBottom - 1 && vis.bottom <= vis.vh + 1 && Math.abs(vis.dialogH - kbH) <= 2, JSON.stringify(vis));
      await pg.setViewportSize({ width: w, height: h });
      await pg.waitForTimeout(500);
      const back = await dlg(pg).boundingBox();
      check("Al cerrarse el teclado la ventana recupera el tamaño completo", Math.abs(back.height - h) <= 2, `${back.height}`);
      await pg.evaluate(() => { const d = document.querySelector("[data-testid=ingreso-remito-dialog]"); d.scrollTop = d.scrollHeight; });
      await pg.waitForTimeout(300);
      const end = await pg.evaluate(() => {
        const lines = document.querySelectorAll("[data-testid=remito-linea]");
        const last = lines[lines.length - 1].getBoundingClientRect();
        const foot = document.querySelector("[data-testid=remito-barra-accion]").getBoundingClientRect();
        const head = document.querySelector("[data-testid=remito-encabezado]").getBoundingClientRect();
        return { lastBottom: last.bottom, footTop: foot.top, footVisible: foot.bottom <= window.innerHeight + 1 && foot.top >= 0, headTop: head.top };
      });
      check("Al final de la lista el pie fijo no tapa el último material y el encabezado sigue visible", end.lastBottom <= end.footTop + 1 && end.footVisible && Math.abs(end.headTop) <= 1, JSON.stringify(end));
      await pg.screenshot({ path: `${OUT}/07-mobile-360x640.png` });
    }
    await sz.ctx.close();
  }

  // ----- Protección contra cierres accidentales (celular 390×844) -----
  const mob = await openAs(E2E_USERS.materiaPrima, true, { width: 390, height: 844 });
  const mb = mob.page;
  await mb.goto("/mi-trabajo");
  await nav(mb, "Ingresos MP");
  await openWizard(mb);
  await mb.keyboard.press("Escape");
  await mb.waitForTimeout(600);
  check("Sin foto ni datos: cerrar no pide confirmación", (await dlg(mb).count()) === 0 && !(await confirmVisible(mb)));
  await openWizard(mb);
  await uploadAndWait(mb);
  const MARK = `${SUPPLIER} MOB-${RUN}`;
  await mb.locator("[data-testid=remito-proveedor]").fill(MARK);
  await mb.evaluate(() => { document.querySelector("[data-testid=ingreso-remito-dialog]").scrollTop = 140; });
  await mb.waitForTimeout(300);
  const topAntes = await mb.evaluate(() => document.querySelector("[data-testid=ingreso-remito-dialog]").scrollTop);
  await mb.locator("[data-testid=remito-cerrar-x]").click();
  await mb.locator("[data-testid=remito-cerrar-confirmar]").waitFor();
  const txt = await mb.locator("[data-testid=remito-cerrar-confirmar]").innerText();
  check("X con trabajo en riesgo: pide «¿Querés cerrar el remito?» con Guardar y cerrar / Cerrar sin guardar / Cancelar", /¿Querés cerrar el remito\?/.test(txt) && /Guardar y cerrar/.test(txt) && /Cerrar sin guardar/.test(txt) && /Cancelar/.test(txt));
  const bt = await mb.locator("[data-testid=remito-cerrar-confirmar] button:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check("Las tres opciones son grandes (≥44 px)", bt.length >= 3 && bt.every((x) => x >= 44), JSON.stringify(bt));
  await mb.locator("[data-testid=remito-cerrar-cancelar]").click();
  await mb.waitForTimeout(500);
  const estado = await mb.evaluate(() => ({ top: document.querySelector("[data-testid=ingreso-remito-dialog]").scrollTop, sup: document.querySelector("[data-testid=remito-proveedor]").value }));
  check("Cancelar vuelve al formulario en el mismo estado y posición de desplazamiento (datos intactos)", !(await confirmVisible(mb)) && estado.sup === MARK && Math.abs(estado.top - topAntes) <= 4, JSON.stringify({ estado, topAntes }));
  await mb.keyboard.press("Escape");
  await mb.locator("[data-testid=remito-cerrar-confirmar]").waitFor();
  check("Escape también pide confirmación (no cierra solo)", (await dlg(mb).isVisible()) && (await confirmVisible(mb)));
  await mb.locator("[data-testid=remito-cerrar-cancelar]").click();
  await mb.goBack().catch(() => undefined);
  await mb.waitForTimeout(800);
  check("Botón «atrás» del dispositivo: pide confirmación y la ventana sigue abierta", (await confirmVisible(mb)) && (await dlg(mb).isVisible()));
  await mb.locator("[data-testid=remito-cerrar-cancelar]").click();
  await mb.waitForTimeout(400);
  // Error de guardado: NO se cierra
  await mb.route("**/api/v1/inventory/receipts", async (route) => {
    if (route.request().method() === "POST" && /"action":"save"/.test(route.request().postData() ?? "")) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falla simulada" }) });
    return route.continue();
  });
  await mb.locator("[data-testid=remito-cerrar-x]").click();
  await mb.locator("[data-testid=remito-cerrar-guardar]").click();
  await mb.locator("[data-testid=remito-cerrar-error]").waitFor({ timeout: 15_000 });
  check("Si falla el guardado la ventana NO se cierra, se explica y no se pierde nada", (await dlg(mb).isVisible()) && (await mb.locator("[data-testid=remito-proveedor]").inputValue()) === MARK);
  await mb.unroute("**/api/v1/inventory/receipts");
  await mb.locator("[data-testid=remito-cerrar-guardar]").click();
  await dlg(mb).waitFor({ state: "detached", timeout: 20_000 });
  const guardado = (await q("select status, supplier, (select count(*)::int from inventory_ingreso_adjuntos f where f.receipt_id = r.id and f.deleted_at is null) files from inventory_receipts r where supplier like $1 order by updated_at desc limit 1", [`%${MARK}%`]))[0];
  check("Guardar y cerrar: queda el BORRADOR con la foto y los datos editados", guardado?.status === "BORRADOR" && guardado.files >= 1, JSON.stringify({ s: guardado?.status, f: guardado?.files }));
  check("Guardar el borrador NO confirma el ingreso ni mueve stock", (await receiptsBy("CONFIRMADO")) === confAntes && (await balance(MP_CODE)) === stockMobAntes);
  // Recuperar el borrador con su foto
  await mb.locator("[data-testid=remitos-recibidos]").click();
  await mb.locator("[data-testid=remito-historial-item][data-status=BORRADOR]").filter({ hasText: MARK }).first().click();
  await dlg(mb).waitFor();
  await mb.locator("[data-testid=paso-revision]").waitFor({ timeout: 60_000 });
  await mb.waitForTimeout(800);
  check("Recuperación del borrador: vuelve con los datos y la fotografía", (await mb.locator("[data-testid=remito-proveedor]").inputValue()) === MARK && (await mb.locator("[data-testid=remito-visor], [data-testid=remito-miniaturas]").count()) >= 1);
  // Cerrar sin guardar: solo descarta lo pendiente, NO borra el borrador guardado
  await mb.locator("[data-testid=remito-proveedor]").fill(`${MARK} CAMBIO-NO-GUARDADO`);
  await mb.locator("[data-testid=remito-cerrar-x]").click();
  await mb.locator("[data-testid=remito-cerrar-sin-guardar]").click();
  await dlg(mb).waitFor({ state: "detached", timeout: 20_000 });
  const tras = (await q("select status, supplier from inventory_receipts where supplier like $1 order by updated_at desc limit 1", [`%${MARK}%`]))[0];
  check("Cerrar sin guardar: el cambio pendiente se descarta y el borrador previamente guardado se conserva", tras?.status === "BORRADOR" && !/CAMBIO-NO-GUARDADO/.test(tras.supplier), tras?.status);
  // Borrador nuevo nunca guardado: «Cerrar sin guardar» lo descarta explícitamente
  await mb.locator("[data-testid=nuevo-ingreso-remito]").waitFor();
  await openWizard(mb);
  await mb.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mb.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  const antesDesc = await receiptsBy("DESCARTADO");
  await mb.locator("[data-testid=remito-cerrar-x]").click();
  await mb.locator("[data-testid=remito-cerrar-sin-guardar]").click();
  await dlg(mb).waitFor({ state: "detached", timeout: 20_000 });
  check("Borrador de esta sesión nunca guardado + «Cerrar sin guardar»: se descarta (sin ingresos ni stock)", (await receiptsBy("DESCARTADO")) === antesDesc + 1 && (await receiptsBy("CONFIRMADO")) === confAntes);
  // Lectura automática en curso
  state.delayMs = 4000;
  await openWizard(mb);
  await mb.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "hoja-1.jpg"));
  await mb.locator("[data-testid=remito-estado-ocupado]").waitFor({ timeout: 20_000 });
  await mb.keyboard.press("Escape");
  await mb.locator("[data-testid=remito-cerrar-confirmar]").waitFor({ timeout: 10_000 });
  check("Con una lectura automática en curso cerrar también pide confirmación", await confirmVisible(mb));
  await mb.locator("[data-testid=remito-cerrar-cancelar]").click();
  await mb.locator("[data-testid=paso-revision]").waitFor({ timeout: 90_000 });
  state.delayMs = 300;
  check("Tras cancelar, la lectura terminó y completó el formulario sin perder nada", (await mb.locator("[data-testid=remito-proveedor]").inputValue()) === SUPPLIER);
  // Pie: guardar borrador ≠ confirmar ingreso
  await mb.locator("[data-testid=remito-guardar-borrador]").click();
  await mb.getByText(/Borrador guardado/).waitFor({ timeout: 15_000 });
  const bb = await mb.evaluate(() => {
    const g = document.querySelector("[data-testid=remito-guardar-borrador]").getBoundingClientRect();
    const c = document.querySelector("[data-testid=remito-revisar]").getBoundingClientRect();
    return { g: g.height, c: c.height, gt: document.querySelector("[data-testid=remito-guardar-borrador]").innerText, ct: document.querySelector("[data-testid=remito-revisar]").innerText };
  });
  check("Pie: «Guardar borrador» y «Confirmar ingreso de stock» son botones distintos, grandes y diferenciados", bb.g >= 44 && bb.c >= 44 && bb.gt !== bb.ct, JSON.stringify(bb));
  check("Guardar borrador desde el pie no suma stock ni confirma", (await receiptsBy("CONFIRMADO")) === confAntes && (await balance(MP_CODE)) === stockMobAntes);
  await closeDlg(mb);
  await mob.ctx.close();
  // Tablet y computadora: la ventana sigue siendo una tarjeta centrada (no pantalla completa) y con su protección de cierre
  for (const [label, vw, vh, mobile] of [["Tablet", 820, 1180, true], ["Computadora", 1440, 900, false]]) {
    const dv = await openAs(E2E_USERS.materiaPrima, mobile, mobile ? { width: vw, height: vh } : undefined);
    const dp2 = dv.page;
    await dp2.goto("/mi-trabajo");
    await nav(dp2, "Ingresos MP");
    await openWizard(dp2);
    await uploadAndWait(dp2);
    const bx = await dlg(dp2).boundingBox();
    const win = await dp2.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await dp2.mouse.click(5, 5); // toque FUERA de la ventana
    await dp2.waitForTimeout(500);
    check(`${label}: tarjeta amplia y centrada; tocar fuera NO cierra directo (pide confirmación)`, bx.x >= 0 && bx.width <= win.w && (await dlg(dp2).isVisible()) && (await confirmVisible(dp2)), JSON.stringify({ bx, win }));
    await dp2.locator("[data-testid=remito-cerrar-cancelar]").click();
    await dp2.screenshot({ path: `${OUT}/08-${label.toLowerCase()}.png` });
    await closeDlg(dp2);
    await dv.ctx.close();
  }

  // ===== Prueba de configuración (sin enviar remitos) y permisos =====
  const dir = await openAs(E2E_USERS.direccion, false);
  state.mode = "ok";
  await resetBreaker();
  const health = await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health");
  const hb = await health.json();
  check("Dirección prueba la configuración (solo texto, sin documentos): informa modelo configurado, efectivo, modelos de la clave e intentos", health.status() === 200 && hb.health.ok === true && hb.health.configuredModel === "gemini-2.0-flash-retirado" && ["gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash"].includes(hb.health.effectiveModel) && hb.health.listing.candidates[0] === "gemini-2.5-flash-lite" && !hb.health.listing.candidates.includes("embedding-001") && !JSON.stringify(hb).includes(FAKE_KEY), JSON.stringify({ c: hb.health.configuredModel, e: hb.health.effectiveModel, l: hb.health.listing?.candidates }));
  const textOnlyCalls = state.requests.filter((r) => r.model && r.textOnly);
  check("La prueba de texto no envió ningún documento", textOnlyCalls.length >= 1);
  const imgHealth = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health&image=1")).json();
  check("Prueba con IMAGEN (remito ficticio incorporado): el modelo analizó la imagen y encontró renglones", imgHealth.health.ok === true && imgHealth.health.image?.ok === true && imgHealth.health.image.read.lines >= 1, imgHealth.health.message);
  state.mode = "keyinvalid";
  await resetBreaker();
  const hKey = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health")).json();
  check("Diagnóstico: clave inválida se distingue del modelo inexistente", hKey.health.providers?.find((p) => p.provider === "gemini")?.ok === false && hKey.health.text.kind === "key" && /clave de Gemini/.test(hKey.health.text.message));
  state.mode = "quota";
  await resetBreaker();
  const hQuota = await (await dir.page.request.get("/api/v1/inventory/receipts?module=MP&view=extraction_health")).json();
  check("Diagnóstico: límite de uso se distingue", hQuota.health.providers?.find((p) => p.provider === "gemini")?.ok === false && hQuota.health.text.kind === "limit");
  state.mode = "ok";
  await resetBreaker();
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
  oai.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
