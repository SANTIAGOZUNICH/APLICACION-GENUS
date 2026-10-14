// E2E (Chromium real con pantalla de CELULAR, build de producción, base DESCARTABLE): fotos del remito en
// Ingresos de MP (Materia Prima) e Ingresos de ME (Depósito).
// - Sacar foto (input con cámara) y subir varias imágenes (JPG grande que se achica, PNG, HEIC); progreso y errores.
// - Se ven, se amplían y se conservan al editar el ingreso; quitar una foto no borra el archivo.
// - Permisos por sector; no cambia cantidades, movimientos ni stock.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, devices } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/remitos-fotos";
const FILES_DIR = process.env.GENUS_E2E_FILES_DIR ?? path.resolve(".e2e-local/files");
const FIX = path.join(OUT, "fixtures");
mkdirSync(FIX, { recursive: true });
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

const MP_ID = randomUUID();
const ME_ID = randomUUID();
const REM_MP = "E2E-FOTO-MP-1";
const REM_ME = "E2E-FOTO-ME-1";

async function openAs(user, mobile = true) {
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
const post = (page, data) => page.request.post("/api/v1/inventory", { data });
const adj = (module, id) => q("select * from inventory_ingreso_adjuntos where module = $1 and ingreso_id = $2 order by uploaded_at", [module, id]);
const stockState = async () =>
  JSON.stringify({
    movs: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    mp: await q("select payload from inv_mp_ingresos where id = $1", [MP_ID]),
    bal: await q("select codigo, stock_actual from mp_stock_balances where codigo = 'E2E-FOTO-GLI'"),
  });

/** Imágenes de prueba generadas por el propio navegador (JPG grande ~5 MB y PNG chico). */
async function makeFixtures(page) {
  const make = (w, h, type, quality) =>
    page.evaluate(
      async ({ w, h, type, quality }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = Math.random() * 255;
          img.data[i + 1] = Math.random() * 255;
          img.data[i + 2] = Math.random() * 255;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(40, 40, 900, 160);
        ctx.fillStyle = "#000";
        ctx.font = "bold 90px sans-serif";
        ctx.fillText("REMITO E2E", 60, 160);
        const blob = await new Promise((r) => c.toBlob(r, type, quality));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { w, h, type, quality }
    );
  writeFileSync(path.join(FIX, "remito-grande.jpg"), Buffer.from(await make(2600, 2000, "image/jpeg", 0.97), "base64"));
  writeFileSync(path.join(FIX, "remito-camara.jpg"), Buffer.from(await make(1200, 900, "image/jpeg", 0.8), "base64"));
  writeFileSync(path.join(FIX, "remito.png"), Buffer.from(await make(300, 200, "image/png"), "base64"));
  // HEIC (cabecera ftyp/heic real + relleno): se acepta y se guarda tal cual.
  const heic = Buffer.alloc(40_000);
  Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).copy(heic);
  writeFileSync(path.join(FIX, "IMG_0001.HEIC"), heic);
  const heicGrande = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).copy(heicGrande);
  writeFileSync(path.join(FIX, "IMG_GRANDE.HEIC"), heicGrande);
  writeFileSync(path.join(FIX, "factura.pdf"), Buffer.from("%PDF-1.4 e2e"));
}

async function rowButton(page, remito) {
  // Celular: la planilla no muestra todas las columnas; se filtra con el buscador y queda una sola fila.
  const search = page.getByPlaceholder(/Buscar/).first();
  await search.fill(remito);
  await page.waitForTimeout(1200);
  return page.locator("[data-testid=ingreso-fotos-button]").first();
}
async function openFotos(page, remito) {
  const btn = await rowButton(page, remito);
  try {
    await btn.waitFor({ timeout: 60_000 });
  } catch (err) {
    await page.screenshot({ path: `${OUT}/debug-fila-${remito}.png`, fullPage: true }).catch(() => {});
    throw err;
  }
  await btn.click();
  await page.locator("[data-testid=ingreso-fotos-dialog]").waitFor({ timeout: 30_000 });
}

try {
  // Limpieza de corridas anteriores (solo datos E2E-FOTO de esta base descartable).
  await q("delete from inventory_ingreso_adjuntos where ingreso_id in (select id from inv_mp_ingresos where payload->>'remitoNro' = $1) or ingreso_id in (select id from inv_me_ingresos where payload->>'remitoNro' = $2)", [REM_MP, REM_ME]);
  await q("delete from inv_mp_ingresos where payload->>'remitoNro' = $1", [REM_MP]);
  await q("delete from inv_me_ingresos where payload->>'remitoNro' = $1", [REM_ME]);
  await q("delete from inv_mp_stock where payload->>'codigo' = 'E2E-FOTO-GLI'");
  await q("delete from mp_stock_movements where codigo = 'E2E-FOTO-GLI'");
  await q("delete from mp_stock_balances where codigo = 'E2E-FOTO-GLI'");

  // ===== Datos: un ingreso de MP (confirmado, suma stock) y uno de ME =====
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const mp = mpu.page;
  await makeFixtures(mp);
  const sizeGrande = (await import("node:fs")).statSync(path.join(FIX, "remito-grande.jpg")).size;
  check("Prueba con una foto grande de celular (> 4 MB)", sizeGrande > 4 * 1024 * 1024, `${(sizeGrande / 1024 / 1024).toFixed(1)} MB`);
  const c1 = await post(mp, { action: "upsert", resource: "mp_ingresos", payload: { id: MP_ID, fecha: "2026-10-13", remitoNro: REM_MP, codigo: "E2E-FOTO-GLI", descripcion: "Glicerina foto E2E", lote: "GF1", proveedor: "PROV FOTO E2E", bultos: 2, cantidad: 25 } });
  check("Ingreso MP creado", c1.ok(), String(c1.status()));
  const dep = await openAs(E2E_USERS.deposito);
  const c2 = await post(dep.page, { action: "upsert", resource: "me_ingresos", payload: { id: ME_ID, fecha: "2026-10-13", remitoNro: REM_ME, codigo: "E2E-FOTO-CAJA", descripcionInsumo: "Caja foto E2E", proveedor: "PROV FOTO E2E", bultos: 1, cantidad: 100 } });
  check("Ingreso ME creado", c2.ok(), String(c2.status()));
  const stock0 = await stockState();

  // ===== Materia Prima, desde el celular: sacar foto + subir varias =====
  await mp.goto("/mi-trabajo");
  await nav(mp, "Ingresos MP");
  await openFotos(mp, REM_MP);
  check("Celular: botones grandes «Sacar foto» y «Subir imágenes»", (await mp.locator("[data-testid=ingreso-fotos-camara]").isVisible()) && (await mp.locator("[data-testid=ingreso-fotos-subir]").isVisible()));
  check("«Sacar foto» abre la cámara trasera (capture=environment)", (await mp.locator("[data-testid=ingreso-fotos-input-camara]").getAttribute("capture")) === "environment");
  await mp.screenshot({ path: `${OUT}/01-celular-dialogo-vacio.png` });
  await mp.locator("[data-testid=ingreso-fotos-input-camara]").setInputFiles(path.join(FIX, "remito-camara.jpg"));
  await mp.locator("[data-testid=ingreso-fotos-input]").setInputFiles([path.join(FIX, "remito-grande.jpg"), path.join(FIX, "remito.png"), path.join(FIX, "IMG_0001.HEIC")]);
  await mp.waitForFunction(() => document.querySelectorAll("[data-testid=ingreso-foto]").length >= 4, null, { timeout: 60_000 }).catch(() => {});
  const rows1 = await adj("MP", MP_ID);
  check("4 fotos asociadas al ingreso (cámara + JPG + PNG + HEIC)", rows1.length === 4, String(rows1.length));
  const grande = rows1.find((r) => /remito-grande/.test(r.file_name));
  check("La foto grande se achicó antes de subir (JPG < 4 MB)", Boolean(grande) && grande.content_type === "image/jpeg" && grande.size_bytes < 4 * 1024 * 1024, grande ? `${(grande.size_bytes / 1024).toFixed(0)} KB` : "—");
  check("Tipos guardados: JPG, PNG y HEIC", ["image/jpeg", "image/png", "image/heic"].every((t) => rows1.some((r) => r.content_type === t)));
  check("Quién y cuándo: Materia Prima, con fecha", rows1.every((r) => r.uploaded_by === E2E_USERS.materiaPrima.email && r.uploaded_by_sector === "MATERIA_PRIMA" && r.uploaded_at));
  check("Archivos persistentes (almacenamiento privado, no en la página)", rows1.every((r) => existsSync(path.join(FILES_DIR, r.storage_key))), FILES_DIR);
  await mp.screenshot({ path: `${OUT}/02-celular-fotos-subidas.png` });

  // Errores: formato y tamaño.
  await mp.locator("[data-testid=ingreso-fotos-input]").setInputFiles([path.join(FIX, "factura.pdf"), path.join(FIX, "IMG_GRANDE.HEIC")]);
  await mp.waitForTimeout(2500);
  const errs = await mp.locator("[data-testid=ingreso-fotos-error]").allInnerTexts();
  check("PDF rechazado con mensaje claro", errs.some((e) => /formato no permitido/.test(e)), errs.join(" | "));
  check("HEIC de 5 MB rechazado con mensaje claro (máximo 4 MB)", errs.some((e) => /máximo es 4 MB/.test(e)), errs.join(" | "));
  check("Los rechazados no se guardaron", (await adj("MP", MP_ID)).length === 4);
  await mp.screenshot({ path: `${OUT}/03-celular-errores.png` });

  // Ver y ampliar.
  await mp.locator("[data-testid=ingreso-foto] button[title=Ampliar]").first().click();
  await mp.locator("[data-testid=ingreso-foto-visor-img]").waitFor({ timeout: 30_000 });
  const natural = await mp.locator("[data-testid=ingreso-foto-visor-img]").evaluate((img) => img.naturalWidth);
  check("La foto se abre ampliada (se ve la imagen real)", natural > 100, String(natural));
  await mp.screenshot({ path: `${OUT}/04-celular-visor.png` });
  await mp.locator("[data-testid=ingreso-foto-visor-img]").click();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${OUT}/05-celular-visor-zoom.png` });
  await mp.keyboard.press("Escape");
  await mp.waitForTimeout(500);

  // Quitar una foto: deja de verse, el archivo se conserva.
  mp.once("dialog", (d) => void d.accept());
  await mp.locator("[data-testid=ingreso-foto-quitar]").last().click();
  await mp.waitForTimeout(1500);
  const rows2 = await adj("MP", MP_ID);
  const removed = rows2.find((r) => r.deleted_at);
  check("Quitar foto: queda registrada como quitada (quién) y el archivo se conserva", Boolean(removed) && removed.deleted_by === E2E_USERS.materiaPrima.email && existsSync(path.join(FILES_DIR, removed.storage_key)));
  check("Quedan 3 fotos visibles", (await mp.locator("[data-testid=ingreso-foto]").count()) === 3);
  await mp.keyboard.press("Escape");

  // ===== Editar el ingreso no pierde fotos; adjuntar no cambia cantidades ni stock =====
  check("Adjuntar fotos no cambió cantidades, movimientos ni saldos", (await stockState()) === stock0);
  const ed = await post(mp, { action: "upsert", resource: "mp_ingresos", payload: { id: MP_ID, ubicacion: "Estante E2E", auditReason: "Ubicación corregida (E2E)" } });
  check("Ingreso editado (ubicación)", ed.ok(), String(ed.status()));
  const list = await (await mp.request.get(`/api/v1/inventory/ingreso-adjuntos?module=MP&ingresoId=${MP_ID}`)).json();
  check("Después de editar el ingreso, las fotos siguen ahí", (list.items ?? []).length === 3, String((list.items ?? []).length));
  await mp.reload();
  await nav(mp, "Ingresos MP");
  const badge = await (await rowButton(mp, REM_MP)).innerText();
  await mp.screenshot({ path: `${OUT}/05b-celular-fila-con-fotos.png` });
  check("En la fila se ve que el ingreso tiene 3 fotos", /3/.test(badge), badge);

  // ===== Permisos =====
  const pr = await openAs(E2E_USERS.produccion, false);
  const prList = await pr.page.request.get(`/api/v1/inventory/ingreso-adjuntos?module=MP&ingresoId=${MP_ID}`);
  check("Producción puede VER las fotos de MP", prList.ok() && ((await prList.json()).items ?? []).length === 3);
  const prImg = await pr.page.request.get(`/api/v1/inventory/ingreso-adjuntos/${rows1[0].id}`);
  check("Producción puede abrir una foto (imagen, sin caché pública)", prImg.ok() && /image\//.test(prImg.headers()["content-type"] ?? "") && /no-store/.test(prImg.headers()["cache-control"] ?? ""));
  const jpgBytes = (await import("node:fs")).readFileSync(path.join(FIX, "remito-camara.jpg"));
  const upload = (page, module, ingresoId) =>
    page.request.post("/api/v1/inventory/ingreso-adjuntos", { multipart: { module, ingresoId, file: { name: "x.jpg", mimeType: "image/jpeg", buffer: jpgBytes } } });
  check("Producción NO puede adjuntar en MP (403)", (await upload(pr.page, "MP", MP_ID)).status() === 403);
  check("Depósito NO puede adjuntar en MP (403)", (await upload(dep.page, "MP", MP_ID)).status() === 403);
  check("Materia Prima NO puede adjuntar en ME (403)", (await upload(mp, "ME", ME_ID)).status() === 403);
  const el = await openAs(E2E_USERS.elaboracion, false);
  check("Elaboración no ve fotos de ingresos MP (403)", (await el.page.request.get(`/api/v1/inventory/ingreso-adjuntos?module=MP&ingresoId=${MP_ID}`)).status() === 403);
  const anon = await browser.newContext({ baseURL: BASE });
  check("Sin sesión no se puede abrir una foto", !(await anon.request.get(`/api/v1/inventory/ingreso-adjuntos/${rows1[0].id}`)).ok());
  await anon.close();

  // ===== Depósito: Ingresos ME, mismo funcionamiento =====
  const dp = dep.page;
  await dp.goto("/mi-trabajo");
  await nav(dp, "Ingresos ME");
  await openFotos(dp, REM_ME);
  await dp.locator("[data-testid=ingreso-fotos-input-camara]").setInputFiles(path.join(FIX, "remito-camara.jpg"));
  await dp.locator("[data-testid=ingreso-fotos-input]").setInputFiles([path.join(FIX, "remito.png")]);
  await dp.waitForFunction(() => document.querySelectorAll("[data-testid=ingreso-foto]").length >= 2, null, { timeout: 60_000 }).catch(() => {});
  const me = await adj("ME", ME_ID);
  check("Ingresos ME: Depósito adjunta 2 fotos desde el celular", me.length === 2 && me.every((r) => r.uploaded_by_sector === "DEPOSITO"), String(me.length));
  await dp.screenshot({ path: `${OUT}/06-deposito-me.png` });
  const edMe = await post(dp, { action: "upsert", resource: "me_ingresos", payload: { id: ME_ID, fecha: "2026-10-13", remitoNro: REM_ME, codigo: "E2E-FOTO-CAJA", descripcionInsumo: "Caja foto E2E", proveedor: "PROV FOTO E2E", bultos: 1, cantidad: 100, ubicacion: "Depósito E2E" } });
  const meList = await (await dp.request.get(`/api/v1/inventory/ingreso-adjuntos?module=ME&ingresoId=${ME_ID}`)).json();
  check("Ingresos ME: editar el ingreso no pierde fotos", edMe.ok() && (meList.items ?? []).length === 2);
  check("Al final: stock MP intacto", JSON.parse(await stockState()).movs === JSON.parse(stock0).movs);

  for (const c of [mpu, dep, pr, el]) await c.ctx.close();
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
