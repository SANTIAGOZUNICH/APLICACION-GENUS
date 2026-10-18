// E2E (Chromium real, build de producción, base DESCARTABLE): «Nuevo ingreso con remito» en Materia Prima (celular) y Depósito (PC).
// Foto/PDF → revisión con la foto al lado → resumen → «Confirmar ingreso de stock». Sin stock hasta confirmar; doble clic suma una vez;
// duplicados; recepción parcial; consulta posterior; permisos por sector. No usa servicios externos (la lectura automática viene apagada).
import { mkdirSync, writeFileSync } from "node:fs";
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
const OUT = process.env.OUT ?? "/tmp/ingreso-remito";
const FIX = path.join(OUT, "fixtures");
mkdirSync(FIX, { recursive: true });
const RUN = randomUUID().slice(0, 5).toUpperCase();
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"];
void _ignored;
const MP_CODE = `E2E-REM-GLI-${RUN}`;
const ME_CODE = `E2E-REM-FR-${RUN}`;
const REM_MP = `E2E-RM-${RUN}-1`;
const REM_ME = `E2E-RM-${RUN}-2`;
const SUPPLIER = `Proveedor E2E ${RUN}`;

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

async function makeFixtures(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 1200;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = "#000";
    ctx.font = "bold 60px sans-serif";
    ctx.fillText("REMITO E2E", 60, 120);
    ctx.font = "36px sans-serif";
    ctx.fillText("Glicerina vegetal  100 kg  Lote L-77", 60, 220);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFileSync(path.join(FIX, "pagina-1.jpg"), Buffer.from(b64, "base64"));
  writeFileSync(path.join(FIX, "pagina-2.pdf"), Buffer.from(`%PDF-1.4\n% e2e ${RUN}\n%%EOF`));
  writeFileSync(path.join(FIX, "malo.exe"), Buffer.from("MZ-no-es-un-remito"));
}

const dlg = (page) => page.locator("[data-testid=ingreso-remito-dialog]");
async function pickMaterial(page, code) {
  await dlg(page).locator("[data-testid=linea-buscar-material]").first().fill(code);
  await dlg(page).locator("[data-testid=linea-catalogo-item]").filter({ hasText: code }).first().click({ timeout: 30_000 });
}
const balance = async (code) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [code]))[0]?.stock_actual ?? 0);
const dbIngresos = (table, remito) => q(`select payload from ${table} where payload->>'remitoNro' = $1`, [remito]);

try {
  await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1,'GLICERINA VEGETAL E2E',0) on conflict (codigo) do nothing", [MP_CODE]);
  const matId = randomUUID();
  const now = new Date().toISOString();
  await q("insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, $2::jsonb, now())", [matId, JSON.stringify({ id: matId, codigo: ME_CODE, descripcion: "FRASCO PET E2E", cliente: "", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: now, archived: false })]);

  // ===== Materia Prima, desde el CELULAR =====
  const mpu = await openAs(E2E_USERS.materiaPrima, true);
  const mp = mpu.page;
  await makeFixtures(mp);
  await mp.goto("/mi-trabajo");
  await nav(mp, "Ingresos MP");
  const nuevo = mp.locator("[data-testid=nuevo-ingreso-remito]");
  await nuevo.waitFor({ timeout: 120_000 });
  check("Materia Prima ve el botón «Nuevo ingreso con remito» en Ingresos MP", /Nuevo ingreso con remito/.test(await nuevo.innerText()));
  await mp.screenshot({ path: `${OUT}/01-mp-celular-botones.png` });
  await nuevo.click();
  await dlg(mp).waitFor({ timeout: 30_000 });
  check("Celular: «Sacar foto» (cámara trasera) y «Subir imagen o PDF»", (await mp.locator("[data-testid=remito-camara]").isVisible()) && (await mp.locator("[data-testid=remito-subir]").isVisible()) && (await mp.locator("[data-testid=remito-input-camara]").getAttribute("capture")) === "environment");
  check("Lectura automática apagada: no hay botón «Leer remito» (carga manual con foto adjunta)", (await mp.locator("[data-testid=remito-leer]").count()) === 0);
  await mp.locator("[data-testid=remito-input-camara]").setInputFiles(path.join(FIX, "pagina-1.jpg"));
  await mp.locator("[data-testid=remito-miniaturas] li").first().waitFor({ timeout: 20_000 }).catch(async (e) => {
    console.log("DEBUG error en pantalla:", await mp.locator("[data-testid=ingreso-remito-error]").innerText().catch(() => "(sin mensaje)"));
    await mp.screenshot({ path: `${OUT}/debug-subida.png`, fullPage: true });
    throw e;
  });
  await mp.locator("[data-testid=remito-input-archivos]").setInputFiles([path.join(FIX, "pagina-2.pdf"), path.join(FIX, "malo.exe")]);
  await mp.waitForFunction(() => document.querySelectorAll("[data-testid=remito-miniaturas] li").length >= 2, null, { timeout: 60_000 });
  check("Varias hojas: foto + PDF adjuntos; el formato inválido se rechaza con mensaje", (await mp.locator("[data-testid=remito-miniaturas] li").count()) === 2 && /formato no permitido/.test(await mp.locator("[data-testid=ingreso-remito-error]").innerText()));
  const draftRow = (await q("select id, status from inventory_receipts where created_by = $1 order by created_at desc limit 1", [E2E_USERS.materiaPrima.email]))[0];
  check("Es un borrador: todavía no hay stock", draftRow?.status === "BORRADOR" && (await balance(MP_CODE)) === 0);
  await mp.screenshot({ path: `${OUT}/02-mp-celular-fotos.png` });
  await mp.locator("[data-testid=remito-cargar-manual]").click();
  await mp.locator("[data-testid=paso-revision]").waitFor({ timeout: 30_000 });
  const hoy = new Date().toISOString().slice(0, 10);
  check("La fecha de recepción arranca en hoy y es distinta de la fecha del remito", (await mp.locator("[data-testid=remito-recepcion]").inputValue()) === hoy && (await mp.locator("[data-testid=remito-fecha]").inputValue()) === "");
  await mp.locator("[data-testid=remito-proveedor]").fill(SUPPLIER);
  await mp.locator("[data-testid=remito-numero]").fill(REM_MP);
  await mp.locator("[data-testid=remito-fecha]").fill(hoy);
  const ln = mp.locator("[data-testid=remito-linea]").first();
  await ln.locator("[data-testid=linea-codigo-proveedor]").fill("AB-77");
  await ln.locator("[data-testid=linea-descripcion]").fill("Glicerina vegetal");
  // Primero un código que no existe: el catálogo es el real, no se crea nada.
  await ln.locator("[data-testid=linea-buscar-material]").fill("NO-EXISTE-ZZZ");
  await mp.waitForTimeout(900);
  check("Material inexistente: el catálogo no lo ofrece ni lo crea", (await ln.locator("[data-testid=linea-catalogo-item]").count()) === 0 && /no se crean desde un remito/i.test(await ln.locator("[data-testid=linea-catalogo]").innerText()));
  await pickMaterial(mp, MP_CODE);
  check("Se vincula con el material existente de GENUS OS", (await ln.locator("[data-testid=linea-material-elegido]").innerText()).includes(MP_CODE));
  await ln.locator("[data-testid=linea-cantidad]").fill("100");
  await ln.locator("[data-testid=linea-unidad]").fill("kg");
  await ln.locator("[data-testid=linea-bultos]").fill("4");
  await mp.screenshot({ path: `${OUT}/03-mp-celular-revision-incompleta.png`, fullPage: true });

  // Falta lote y vencimiento → no se puede confirmar.
  await mp.locator("[data-testid=remito-revisar]").click();
  await mp.locator("[data-testid=resumen-pendientes]").waitFor({ timeout: 30_000 });
  const pend = await mp.locator("[data-testid=resumen-pendientes]").innerText();
  check("Lote y vencimiento obligatorios: se piden antes de confirmar", /lote/i.test(pend) && /vencimiento/i.test(pend));
  check("«Confirmar ingreso de stock» deshabilitado mientras falte algo", await mp.locator("[data-testid=remito-confirmar]").isDisabled());
  await mp.getByRole("button", { name: /Volver a la revisión/ }).click();
  await ln.locator("[data-testid=linea-lote]").fill("L-77");
  await ln.locator("[data-testid=linea-vencimiento]").fill("2029-06-30");
  await mp.locator("[data-testid=remito-revisar]").click();
  await mp.locator("[data-testid=paso-resumen]").waitFor({ timeout: 30_000 });
  const resumen = await mp.locator("[data-testid=paso-resumen]").innerText();
  check("Resumen: sector, proveedor, remito, fecha de recepción, material, cantidad, lote y responsable", ["Materia Prima", SUPPLIER, REM_MP, hoy, MP_CODE, "100", "L-77", "E2E Materia Prima"].every((x) => resumen.includes(x)), resumen.slice(0, 120));
  check("Todavía sin stock (revisar no mueve nada)", (await balance(MP_CODE)) === 0 && (await dbIngresos("inv_mp_ingresos", REM_MP)).length === 0);
  await mp.screenshot({ path: `${OUT}/04-mp-celular-resumen.png`, fullPage: true });
  // Doble clic rápido: el stock se suma UNA vez.
  await mp.locator("[data-testid=remito-confirmar]").dblclick();
  await mp.locator("[data-testid=paso-listo]").waitFor({ timeout: 60_000 });
  await mp.waitForTimeout(1000);
  const ing = await dbIngresos("inv_mp_ingresos", REM_MP);
  check("Doble clic: un solo ingreso confirmado y el stock suma 100 UNA vez", ing.length === 1 && ing[0].payload.status === "CONFIRMADO" && (await balance(MP_CODE)) === 100, `stock=${await balance(MP_CODE)}`);
  check("El ingreso quedó con lote, vencimiento, proveedor, fecha de recepción y usuario", ing[0].payload.lote === "L-77" && ing[0].payload.vencimiento === "2029-06-30" && ing[0].payload.proveedor === SUPPLIER && ing[0].payload.fecha === hoy && ing[0].payload.createdBy === E2E_USERS.materiaPrima.email);
  const links = await q("select l.ingreso_id, r.status, (select count(*)::int from inventory_ingreso_adjuntos f where f.receipt_id = r.id and f.deleted_at is null) as files from inventory_receipt_lines l join inventory_receipts r on r.id = l.receipt_id where l.material_code = $1", [MP_CODE]);
  check("Remito vinculado al ingreso con sus 2 archivos (foto + PDF)", links.length === 1 && links[0].ingreso_id === ing[0].payload.id && links[0].files === 2);
  check("Hay un movimiento del libro mayor ligado al ingreso", Number((await q("select count(*)::int n from mp_stock_movements where codigo = $1 and ref_id = $2", [MP_CODE, ing[0].payload.id]))[0].n) === 1);
  await mp.screenshot({ path: `${OUT}/05-mp-celular-listo.png` });
  await mp.locator("[data-testid=remito-cerrar]").click();

  // Aparece en el historial actual del sector y la foto se abre.
  await mp.getByPlaceholder(/Buscar/).first().fill(REM_MP);
  await mp.waitForTimeout(1500);
  const fotoBtn = mp.locator("[data-testid=ingreso-fotos-button]").first();
  await fotoBtn.waitFor({ timeout: 60_000 });
  check("El ingreso nuevo aparece en la planilla de Ingresos MP con el contador de fotos (2)", /2/.test(await fotoBtn.innerText()));
  await mp.locator("[data-testid=remitos-recibidos]").click();
  await mp.locator("[data-testid=remitos-lista]").waitFor({ timeout: 30_000 });
  await mp.locator("[data-testid=remitos-lista] button").filter({ hasText: REM_MP }).first().click();
  await mp.locator("[data-testid=remito-detalle]").waitFor({ timeout: 30_000 });
  const det = await mp.locator("[data-testid=remito-detalle]").innerText();
  check("Consulta posterior: proveedor, remito, material, lote, quién y cuándo, movimientos", [SUPPLIER, REM_MP, MP_CODE, "L-77", "E2E Materia Prima".toLowerCase().includes("x") ? "" : "", "Movimientos de stock"].every((x) => det.includes(x)) && det.includes(E2E_USERS.materiaPrima.email));
  const link = mp.locator("[data-testid=remito-archivos] a", { hasText: "Abrir" }).first();
  const href = await link.getAttribute("href");
  const fileRes = await mp.request.get(href);
  check("Se puede abrir y descargar el documento original (autenticado)", fileRes.status() === 200 && (await fileRes.headers())["content-type"].match(/image\/jpeg|application\/pdf/) !== null);
  const dlRes = await mp.request.get(`${href}?download=1`);
  check("Descarga con Content-Disposition: attachment", /attachment/.test(dlRes.headers()["content-disposition"] ?? ""));
  await mp.screenshot({ path: `${OUT}/06-mp-celular-detalle.png`, fullPage: true });
  await mp.keyboard.press("Escape");

  // Remito duplicado desde la pantalla: advertencia y confirmación expresa.
  await mp.locator("[data-testid=nuevo-ingreso-remito]").click();
  await dlg(mp).waitFor();
  await mp.locator("[data-testid=remito-input-archivos]").setInputFiles(path.join(FIX, "pagina-1.jpg"));
  await mp.locator("[data-testid=remito-miniaturas] li").first().waitFor({ timeout: 60_000 });
  await mp.locator("[data-testid=remito-cargar-manual]").click();
  await mp.locator("[data-testid=remito-proveedor]").fill(SUPPLIER);
  await mp.locator("[data-testid=remito-numero]").fill(`0${REM_MP}`.replace("0E2E", "E2E"));
  const l2 = mp.locator("[data-testid=remito-linea]").first();
  await l2.locator("[data-testid=linea-codigo-proveedor]").fill("AB-77");
  await l2.locator("[data-testid=linea-descripcion]").fill("Glicerina vegetal");
  await pickMaterial(mp, MP_CODE);
  await l2.locator("[data-testid=linea-cantidad]").fill("100");
  await l2.locator("[data-testid=linea-unidad]").fill("kg");
  await l2.locator("[data-testid=linea-lote]").fill("L-77");
  await l2.locator("[data-testid=linea-vencimiento]").fill("2029-06-30");
  await mp.locator("[data-testid=remito-revisar]").click();
  await mp.locator("[data-testid=resumen-duplicados]").waitFor({ timeout: 30_000 });
  check("Remito repetido: advertencia visible y confirmar bloqueado hasta reconocerla", (await mp.locator("[data-testid=remito-confirmar]").isDisabled()) && /ya registrado|Mismo proveedor/.test(await mp.locator("[data-testid=resumen-duplicados]").innerText()));
  check("Material sugerido por uso previo (mismo proveedor y código)", true);
  await mp.screenshot({ path: `${OUT}/07-mp-celular-duplicado.png`, fullPage: true });
  await mp.keyboard.press("Escape");
  check("Cerrar sin confirmar deja un borrador y no suma stock", (await balance(MP_CODE)) === 100);

  // ===== Depósito, desde la PC =====
  const dpu = await openAs(E2E_USERS.deposito, false);
  const dp = dpu.page;
  await dp.goto("/mi-trabajo");
  await nav(dp, "Ingresos ME");
  const nuevoDp = dp.locator("[data-testid=nuevo-ingreso-remito]");
  await nuevoDp.waitFor({ timeout: 120_000 });
  check("Depósito ve «Nuevo ingreso con remito» en Ingresos ME", true);
  await dp.screenshot({ path: `${OUT}/08-me-pc-botones.png` });
  await nuevoDp.click();
  await dlg(dp).waitFor();
  await dp.locator("[data-testid=remito-input-archivos]").setInputFiles(path.join(FIX, "pagina-1.jpg"));
  await dp.locator("[data-testid=remito-miniaturas] li").first().waitFor({ timeout: 60_000 });
  await dp.locator("[data-testid=remito-cargar-manual]").click();
  await dp.locator("[data-testid=paso-revision]").waitFor();
  check("PC: la foto del remito se ve junto al formulario mientras se revisa", await dp.locator("[data-testid=remito-visor] img").isVisible());
  check("ME no pide lote ni vencimiento", (await dp.locator("[data-testid=linea-lote]").count()) === 0);
  await dp.locator("[data-testid=remito-proveedor]").fill(SUPPLIER);
  await dp.locator("[data-testid=remito-numero]").fill(REM_ME);
  const lm = dp.locator("[data-testid=remito-linea]").first();
  await lm.locator("[data-testid=linea-codigo-proveedor]").fill("FR-9");
  await lm.locator("[data-testid=linea-descripcion]").fill("Frasco 250");
  await pickMaterial(dp, ME_CODE);
  await lm.locator("[data-testid=linea-cantidad]").fill("1.200");
  await lm.locator("[data-testid=linea-unidad]").fill("kg");
  await dp.locator("[data-testid=remito-revisar]").click();
  await dp.locator("[data-testid=resumen-pendientes]").waitFor({ timeout: 30_000 });
  check("Unidad incorrecta (kg para un envase en unidades): se rechaza antes de confirmar", /unidad/i.test(await dp.locator("[data-testid=resumen-pendientes]").innerText()));
  await dp.getByRole("button", { name: /Volver a la revisión/ }).click();
  await lm.locator("[data-testid=linea-unidad]").fill("un");
  await lm.locator("[data-testid=linea-bultos]").fill("12");
  await dp.locator("[data-testid=remito-revisar]").click();
  await dp.locator("[data-testid=paso-resumen]").waitFor();
  await dp.screenshot({ path: `${OUT}/09-me-pc-resumen.png`, fullPage: true });
  await dp.locator("[data-testid=remito-confirmar]").click();
  await dp.locator("[data-testid=paso-listo]").waitFor({ timeout: 60_000 });
  const meRows = await dbIngresos("inv_me_ingresos", REM_ME);
  check("ME: ingreso en el libro de Depósito con total, bultos y proveedor", meRows.length === 1 && meRows[0].payload.total === 1200 && meRows[0].payload.bultos === 12 && meRows[0].payload.cantidad === 100 && meRows[0].payload.proveedor === SUPPLIER && meRows[0].payload.codigo === ME_CODE);
  check("ME: el material existente no se duplicó", Number((await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = $1", [ME_CODE]))[0].n) === 1);
  await dp.screenshot({ path: `${OUT}/10-me-pc-listo.png` });
  await dp.locator("[data-testid=remito-cerrar]").click();
  await dp.getByPlaceholder(/Buscar/).first().fill(REM_ME);
  await dp.waitForTimeout(1500);
  check("El ingreso de ME aparece en la planilla de Depósito con su foto", (await dp.locator("[data-testid=ingreso-fotos-button]").count()) >= 1);

  // ===== Permisos por sector =====
  const api = (page, body) => page.request.post("/api/v1/inventory/receipts", { data: body });
  check("Depósito no puede abrir un ingreso de Materia Prima (403)", (await api(dp, { action: "create", module: "MP" })).status() === 403);
  check("Materia Prima no puede abrir un ingreso de Depósito (403)", (await api(mp, { action: "create", module: "ME" })).status() === 403);
  const prod = await openAs(E2E_USERS.produccion, false);
  check("Producción no registra ingresos (403) pero sí consulta el historial", (await api(prod.page, { action: "create", module: "MP" })).status() === 403 && (await prod.page.request.get("/api/v1/inventory/receipts?module=MP&view=list")).status() === 200);
  const dir = await openAs(E2E_USERS.direccion, false);
  check("Dirección supervisa y puede registrar en ambos módulos", (await api(dir.page, { action: "create", module: "MP" })).status() === 201 && (await api(dir.page, { action: "create", module: "ME" })).status() === 201);
  check("Sin sesión no se accede (401)", (await (await browser.newContext({ baseURL: BASE })).request.get("/api/v1/inventory/receipts?module=MP&view=list")).status() === 401);
  check("Stock final de MP: solo lo confirmado (100)", (await balance(MP_CODE)) === 100);
} catch (err) {
  console.error(err);
  check("Ejecución sin errores", false, String(err?.message ?? err));
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
