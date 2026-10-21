// E2E en Chromium real: Materias Primas «como Excel». Base DESCARTABLE (marca verificada), login real.
// Ver run-mp-excel-local.sh. Capturas en $OUT.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/mp-excel";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

const TIPS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1.5 },
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const debugPages = [];
async function openAs(user, kind = "desktop") {
  const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin }).catch(() => undefined);
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const post = (page, data) => page.request.post("/api/v1/inventory", { data });
const TAG = "XL";

async function cleanup() {
  for (const t of ["inv_mp_stock", "inv_mp_ingresos", "inv_mp_compras"]) await q(`delete from ${t} where payload::text like '%${TAG}-%' or payload::text like '%${TAG} %'`);
  await q(`delete from mp_stock_movements where codigo like '${TAG}-%'`);
  await q(`delete from mp_stock_balances where codigo like '${TAG}-%'`);
}
async function openTab(page, label, gridId) {
  await page.goto("/mi-trabajo");
  await nav(page, label);
  await page.locator(`[data-testid=${gridId}]`).waitFor({ timeout: 120_000 });
}


const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const noDialog = (page) => page.locator("[role=dialog]").count().then((n) => n === 0);

/** Índice de columna por título (clase genus-col-N de los encabezados renderizados). */
async function colMap(page, gid) {
  return page.evaluate((gid) => {
    const out = {};
    for (const h of document.querySelectorAll(`[data-testid=${gid}] .dsg-row-header .dsg-cell`)) {
      const m = /genus-col-(\d+)/.exec(h.className);
      if (m) out[h.textContent.trim().toLowerCase()] = Number(m[1]);
    }
    return out;
  }, gid);
}
async function cellLoc(page, gid, row, title) {
  const map = await colMap(page, gid);
  const c = map[title.toLowerCase()];
  if (c === undefined) throw new Error(`columna no encontrada: ${title} (${Object.keys(map)})`);
  return page.locator(`[data-testid=${gid}] .dsg-row`).nth(row + 1).locator(`.genus-col-${c}`).first();
}
const centerOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function typeInCell(page, gid, row, title, value) {
  const c = await cellLoc(page, gid, row, title);
  await c.click();
  await page.keyboard.type(value); // seleccionar y escribir REEMPLAZA el contenido (como Excel)
  await page.keyboard.press("Enter");
}
async function pasteText(page, text) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
const stockBy = async (codigo) => (await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [codigo]))[0]?.payload;
const compraBy = async (mat) => (await q("select payload from inv_mp_compras where payload->>'materiaPrima' = $1", [mat]))[0]?.payload;
const status = (page, gid) => page.locator(`[data-testid=${gid}-status]`).getAttribute("data-state");
const savedStatus = (page, gid) => waitDb(async () => (await status(page, gid)) === "saved" || (await status(page, gid)) === "idle");

async function dragFill(page, gid, toRow, toTitle, { hold = 0 } = {}) {
  const h = page.locator(`[data-testid=${gid}-fill-handle]`);
  await h.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300); // el controlador se reposiciona tras cambiar la selección
  const hb = await h.boundingBox();
  const target = await centerOf(await cellLoc(page, gid, toRow, toTitle));
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 14 });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}

try {
  await cleanup();
  const mpu = await openAs(E2E_USERS.materiaPrima);
  const mp = mpu.page;
  for (let i = 0; i < 30; i++) {
    await post(mp, { action: "upsert", resource: "mp_stock", payload: { descripcion: `${TAG} Materia ${String(i).padStart(2, "0")}`, codigo: `${TAG}-${String(i).padStart(3, "0")}`, lote: `L${i}`, cantidadKg: 10 + i, proveedor: `Proveedor ${i}`, ubicacion: `U${i}`, vencimiento: "2027-06-30", producto: `Producto ${i}`, cliente: `Cliente ${i}`, origen: "manual" } });
  }
  for (let i = 0; i < 14; i++) {
    await post(mp, { action: "upsert", resource: "mp_compras", payload: { fecha: "2026-03-01", materiaPrima: `${TAG} Compra ${String(i).padStart(2, "0")}`, cantidad: null, unidad: "kg", proveedor: `Prov ${i}`, estado: "Solicitada" } });
  }
  const GS = "mp-stock-grid";
  await openTab(mp, "Stock", GS);
  await mp.waitForTimeout(1200);

  // ================= 1) BARRAS DE DESPLAZAMIENTO =================
  {
    const vh = 800;
    const hb = await mp.locator(`[data-testid=${GS}-hscroll]`).boundingBox();
    const vb = await mp.locator(`[data-testid=${GS}-vscroll]`).boundingBox();
    check("barra horizontal fija: visible sin bajar la página, gruesa (≥ 18 px) y pegada al marco", hb && hb.height >= 18 && hb.y + hb.height <= vh && hb.y > 0, JSON.stringify(hb));
    check("barra vertical gruesa (≥ 18 px)", vb && vb.width >= 18, JSON.stringify(vb));
    check("la hoja tiene desplazamiento horizontal y las barras lo reflejan", (await mp.locator(`[data-testid=${GS}-hscroll]`).getAttribute("data-scrollable")) === "true");
    const sc = mp.locator(`[data-testid=${GS}-frame] .dsg-container`);
    const nativeHidden = await sc.evaluate((el) => getComputedStyle(el).scrollbarWidth === "none");
    check("sin barras nativas duplicadas (una sola barra por eje)", nativeHidden);
    // arrastrar el pulgar con el mouse → desplaza la hoja de forma proporcional
    const th = await mp.locator(`[data-testid=${GS}-hscroll-thumb]`).boundingBox();
    const before = await sc.evaluate((el) => el.scrollLeft);
    await mp.mouse.move(th.x + th.width / 2, th.y + th.height / 2);
    await mp.mouse.down();
    await mp.mouse.move(th.x + th.width / 2 + 160, th.y + th.height / 2, { steps: 8 });
    await mp.mouse.up();
    const after = await sc.evaluate((el) => el.scrollLeft);
    check("arrastrar la barra horizontal desplaza la hoja", after > before + 100, `${before} → ${after}`);
    const th2 = await mp.locator(`[data-testid=${GS}-hscroll-thumb]`).boundingBox();
    check("la barra queda sincronizada con la hoja (el pulgar avanzó)", th2.x > th.x + 100);
    await mp.screenshot({ path: `${OUT}/01-barras-y-columna-fija.png` });
    const frozen = mp.locator(`[data-testid=${GS}-frozen-col]`);
    check("la primera columna queda fija al desplazar a un costado", (await frozen.isVisible()) && /XL-000/.test(await frozen.innerText()));
    await sc.evaluate((el) => { el.scrollLeft = 0; el.scrollTop = 300; });
    await mp.waitForTimeout(300);
    const hdr = await mp.locator(`[data-testid=${GS}-frame] .dsg-row-header`).boundingBox();
    const scb = await sc.boundingBox();
    check("el encabezado de columnas permanece visible al desplazar hacia abajo", Math.abs(hdr.y - scb.y) < 2, `${hdr.y} vs ${scb.y}`);
    await sc.evaluate((el) => { el.scrollTop = 0; });
  }

  // ================= 2) EDICIÓN DIRECTA, SOBRESCRIBIR Y BORRAR (sin motivos ni confirmaciones) =================
  const snap0 = {
    mov: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    bal: (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h,
    ajustes: (await q("select count(*)::int n from inv_ajustes"))[0].n,
  };
  await typeInCell(mp, GS, 0, "Descripción", "XL Materia EDITADA");
  check("escribir sobre una celda reemplaza el contenido y guarda solo (sin ventanas)", (await waitDb(async () => (await stockBy("XL-000"))?.descripcion === "XL Materia EDITADA")) && (await noDialog(mp)), JSON.stringify({ d: (await stockBy("XL-000"))?.descripcion, dlg: !(await noDialog(mp)) }));
  await typeInCell(mp, GS, 0, "Descripción", "XL Materia SOBRESCRITA");
  check("sobrescribir una celda editable no pide confirmación ni motivo", (await waitDb(async () => (await stockBy("XL-000"))?.descripcion === "XL Materia SOBRESCRITA")) && (await noDialog(mp)));
  await (await cellLoc(mp, GS, 1, "Ubicación")).click();
  await mp.keyboard.press("Delete");
  check("Delete borra el contenido de la celda al instante y guarda solo", (await waitDb(async () => !(await stockBy("XL-001"))?.ubicacion)) && (await noDialog(mp)));
  await (await cellLoc(mp, GS, 2, "Proveedor")).click();
  await (await cellLoc(mp, GS, 5, "Ubicación")).click({ modifiers: ["Shift"] });
  await mp.keyboard.press("Backspace");
  const wipedAll = await waitDb(async () => {
    for (const i of [2, 3, 4, 5]) {
      const r = await stockBy(`XL-${String(i).padStart(3, "0")}`);
      if (r?.proveedor || r?.ubicacion) return false;
    }
    return true;
  });
  check("seleccionar un rango y borrar vacía todas sus celdas de una vez, sin vista previa ni motivo", wipedAll && (await noDialog(mp)));
  await mp.screenshot({ path: `${OUT}/02-rango-borrado.png` });
  await mp.keyboard.press("Control+z");
  const undone = await waitDb(async () => (await stockBy("XL-003"))?.proveedor === "Proveedor 3" && (await stockBy("XL-005"))?.ubicacion === "U5");
  check("Ctrl+Z recupera el rango borrado (Deshacer)", undone, undone ? "" : JSON.stringify({ p3: (await stockBy("XL-003"))?.proveedor, u5: (await stockBy("XL-005"))?.ubicacion, st: await status(mp, GS), notice: await mp.locator(`[data-testid=${GS}-notice]`).innerText().catch(() => "") }));
  await mp.locator(`[data-testid=${GS}-redo]`).click();
  check("Rehacer (botón) vuelve a borrar el rango", await waitDb(async () => !(await stockBy("XL-003"))?.proveedor && !(await stockBy("XL-005"))?.ubicacion));
  await mp.keyboard.press("Control+z");
  await waitDb(async () => (await stockBy("XL-003"))?.proveedor === "Proveedor 3");
  await mp.keyboard.press("Control+y");
  check("Ctrl+Y rehace", await waitDb(async () => !(await stockBy("XL-003"))?.proveedor));
  await mp.keyboard.press("Control+z");
  await waitDb(async () => (await stockBy("XL-003"))?.proveedor === "Proveedor 3");

  // pegar un rango de 8 celdas (antes: vista previa por encima de 5 celdas)
  await (await cellLoc(mp, GS, 6, "Producto")).click();
  await pasteText(mp, "Pegado A\tProv A\nPegado B\tProv B\nPegado C\tProv C\nPegado D\tProv D");
  check("pegar un rango (8 celdas) se guarda directo, sin vista previa", (await waitDb(async () => (await stockBy("XL-009"))?.producto === "Pegado D" && (await stockBy("XL-009"))?.proveedor === "Prov D")) && (await noDialog(mp)));
  // copiar y pegar con el teclado
  await (await cellLoc(mp, GS, 6, "Producto")).click();
  await mp.keyboard.press("Control+c");
  await (await cellLoc(mp, GS, 12, "Producto")).click();
  await mp.keyboard.press("Control+v");
  check("Ctrl+C / Ctrl+V copia una celda a otra", (await waitDb(async () => (await stockBy("XL-012"))?.producto === "Pegado A")) && (await noDialog(mp)));
  // «Stock código» (saldo del libro mayor) ya NO falla ni pide motivo: se guarda y queda auditado (se prueba más abajo).
  // integridad: nada de lo anterior movió stock
  const snap1 = {
    mov: (await q("select count(*)::int n from mp_stock_movements"))[0].n,
    bal: (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h,
    ajustes: (await q("select count(*)::int n from inv_ajustes"))[0].n,
  };
  check("integridad: editar/borrar/pegar datos administrativos (descriptivos) no movió stock (movimientos, saldos, ajustes)", snap1.mov === snap0.mov && snap1.bal === snap0.bal && snap1.ajustes === snap0.ajustes);

  // Lo que SÍ mueve stock se guarda directo (sin ventana ni motivo manual) y queda auditado con motivo automático.
  await typeInCell(mp, GS, 7, "Kg lote", "500");
  const kgOk = await waitDb(async () => (await q("select count(*)::int n from inv_mp_stock where payload->>'codigo' like 'XL-%' and (payload->>'cantidadKg')::numeric = 500"))[0].n === 1 && (await q("select count(*)::int n from mp_stock_movements"))[0].n > snap0.mov);
  check("corregir kg se guarda directo, sin ventana ni motivo manual, y deja el ajuste en el libro mayor", kgOk && (await noDialog(mp)) && (await mp.locator(`[data-testid=${GS}-inline-reason]`).count()) === 0, kgOk ? "" : JSON.stringify({ st: await status(mp, GS), notice: await mp.locator(`[data-testid=${GS}-notice]`).innerText().catch(() => "") }));
  const aud = await q("select reason from mp_stock_movements order by created_at desc limit 1").catch(() => []);
  check("el ajuste queda con motivo automático y usuario (auditoría)", aud.length === 1 && /Edición directa en la planilla de Stock/.test(String(aud[0].reason ?? "")), JSON.stringify(aud));
  // ================= 3) RELLENO ARRASTRANDO =================
  const GC = "mp-compras-grid";
  await openTab(mp, "Compras MP", GC);
  await mp.waitForTimeout(1000);
  await typeInCell(mp, GC, 0, "Cantidad", "1");
  await waitDb(async () => Number((await compraBy(`${TAG} Compra 00`))?.cantidad) === 1);
  await (await cellLoc(mp, GC, 0, "Cantidad")).click();
  check("al seleccionar una celda aparece el controlador de relleno", await mp.locator(`[data-testid=${GC}-fill-handle]`).isVisible());
  await mp.screenshot({ path: `${OUT}/04-controlador-relleno.png` });
  // vista previa durante el arrastre
  {
    const h = await mp.locator(`[data-testid=${GC}-fill-handle]`).boundingBox();
    const t = await centerOf(await cellLoc(mp, GC, 5, "Cantidad"));
    await mp.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await mp.mouse.down();
    await mp.mouse.move(t.x, t.y, { steps: 10 });
    await mp.waitForTimeout(250);
    const prev = mp.locator(`[data-testid=${GC}-fill-preview]`);
    check("durante el arrastre se muestra la vista previa del rango (5 celdas)", (await prev.isVisible()) && /5 celdas/.test(await prev.innerText()));
    await mp.screenshot({ path: `${OUT}/05-vista-previa-relleno.png` });
    await mp.mouse.up();
  }
  check("1 → arrastrar hacia abajo = 2, 3, 4, 5, 6 (serie)", await waitDb(async () => {
    for (let i = 1; i <= 5; i++) if (Number((await compraBy(`${TAG} Compra ${String(i).padStart(2, "0")}`))?.cantidad) !== i + 1) return false;
    return true;
  }));
  check("el relleno se guardó en la base sin ventanas", await noDialog(mp));
  // 10 y 20 → 30, 40, 50, 60
  await typeInCell(mp, GC, 6, "Cantidad", "10");
  await typeInCell(mp, GC, 7, "Cantidad", "20");
  await waitDb(async () => Number((await compraBy(`${TAG} Compra 07`))?.cantidad) === 20);
  await (await cellLoc(mp, GC, 6, "Cantidad")).click();
  await (await cellLoc(mp, GC, 7, "Cantidad")).click({ modifiers: ["Shift"] });
  await dragFill(mp, GC, 11, "Cantidad");
  const serie2 = await waitDb(async () => {
    const want = [30, 40, 50, 60];
    for (const [k, w] of want.entries()) if (Number((await compraBy(`${TAG} Compra ${String(8 + k).padStart(2, "0")}`))?.cantidad) !== w) return false;
    return true;
  });
  check("10 y 20 → 30, 40, 50, 60 (continúa la serie de las dos celdas)", serie2, serie2 ? "" : JSON.stringify(await Promise.all([6, 7, 8, 9, 10, 11].map(async (i) => (await compraBy(`${TAG} Compra ${String(i).padStart(2, "0")}`))?.cantidad))) + " " + (await mp.locator(`[data-testid=${GC}-notice]`).innerText().catch(() => "")));
  if (!serie2) await mp.screenshot({ path: `${OUT}/debug-serie2.png` });
  // «Copiar celdas» en lugar de «Rellenar serie»
  await mp.locator(`[data-testid=${GC}-fill-copy]`).click();
  check("«Copiar celdas» repite 10, 20, 10, 20 en lugar de la serie", await waitDb(async () => {
    const want = [10, 20, 10, 20];
    for (const [k, w] of want.entries()) if (Number((await compraBy(`${TAG} Compra ${String(8 + k).padStart(2, "0")}`))?.cantidad) !== w) return false;
    return true;
  }));
  await mp.locator(`[data-testid=${GC}-fill-series]`).click();
  check("y «Rellenar serie» vuelve a 30, 40, 50, 60", await waitDb(async () => Number((await compraBy(`${TAG} Compra 11`))?.cantidad) === 60));
  // fechas
  await typeInCell(mp, GC, 0, "Fecha", "01/03/2026");
  await waitDb(async () => String((await compraBy(`${TAG} Compra 00`))?.fecha).startsWith("2026-03-01"));
  await (await cellLoc(mp, GC, 0, "Fecha")).click();
  await dragFill(mp, GC, 3, "Fecha");
  check("fechas: 01/03/2026 arrastrado = 02, 03 y 04/03/2026", await waitDb(async () => {
    for (let i = 1; i <= 3; i++) if (!String((await compraBy(`${TAG} Compra ${String(i).padStart(2, "0")}`))?.fecha).startsWith(`2026-03-0${i + 1}`)) return false;
    return true;
  }));
  // lateral (copia horizontal): UNIDAD → PROVEEDOR
  await (await cellLoc(mp, GC, 0, "Fecha")).click(); // colapsa la selección del relleno anterior (que incluía esta fila)
  await (await cellLoc(mp, GC, 8, "Unidad")).click();
  await dragFill(mp, GC, 8, "Proveedor");
  const latOk = await waitDb(async () => (await compraBy(`${TAG} Compra 08`))?.proveedor === "kg");
  check("relleno lateral: copia «kg» hacia la derecha", latOk, latOk ? "" : JSON.stringify({ prov: (await compraBy(`${TAG} Compra 08`))?.proveedor, unidad: (await compraBy(`${TAG} Compra 08`))?.unidad, notice: await mp.locator(`[data-testid=${GC}-notice]`).innerText().catch(() => ""), chip: await mp.locator(`[data-testid=${GC}-fill-chip]`).innerText().catch(() => "") }));
  if (!latOk) await mp.screenshot({ path: `${OUT}/debug-lateral.png` });
  // autoscroll: arrastrar hasta el borde inferior y esperar
  await typeInCell(mp, GC, 0, "Cantidad", "100");
  await waitDb(async () => Number((await compraBy(`${TAG} Compra 00`))?.cantidad) === 100);
  await (await cellLoc(mp, GC, 0, "Cantidad")).click();
  await mp.waitForTimeout(400); // el controlador se reposiciona tras cambiar la selección (igual que en dragFill)
  {
    const h = await mp.locator(`[data-testid=${GC}-fill-handle]`).boundingBox();
    const sc = await mp.locator(`[data-testid=${GC}-frame] .dsg-container`).boundingBox();
    await mp.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await mp.mouse.down();
    await mp.mouse.move(h.x + h.width / 2, sc.y + sc.height - 10, { steps: 10 });
    await mp.waitForTimeout(1800); // el autoscroll avanza mientras se mantiene en el borde
    await mp.mouse.up();
  }
  check("autoscroll: arrastrar al borde inferior rellena más allá de las filas visibles", await waitDb(async () => {
    const last = await compraBy(`${TAG} Compra 13`);
    return Number(last?.cantidad) > 100;
  }));
  await mp.screenshot({ path: `${OUT}/06-autoscroll.png` });

  // ================= 4) STOCK MP: serie en kg (con motivo), copia de texto y códigos intactos =================
  await openTab(mp, "Stock", GS);
  await mp.waitForTimeout(1200);
  const movs0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const kgOf = async (i) => Number((await stockBy(`XL-${String(i).padStart(3, "0")}`)).cantidadKg);
  // datos descartables: filas 14 y 15 con 100 y 110 kg (el resto sube de a 1 kg)
  await q("update inv_mp_stock set payload = jsonb_set(payload, '{cantidadKg}', '100') where payload->>'codigo' = 'XL-014'");
  await q("update inv_mp_stock set payload = jsonb_set(payload, '{cantidadKg}', '110') where payload->>'codigo' = 'XL-015'");
  await openTab(mp, "Stock", GS);
  await mp.waitForTimeout(1200);
  // El relleno numérico de «Kg lote» (confirmación conjunta, mouse y dedo) se prueba en mp-stock-fill-validate.mjs.
  // Copia de texto y protección del código al rellenar: se prueban con datos controlados en mp-stock-fill-validate.mjs.
  // «Stock código» ya no es una columna de la planilla (el libro mayor se conserva internamente).
  check("«Stock código» no aparece como columna del Stock MP", !(await mp.locator(`[data-testid=${GS}]`).innerText().catch(() => "")).match(/stock c[óo]digo/i));

  // ================= 5) TABLET: relleno con el dedo =================
  const tab = await openAs(E2E_USERS.materiaPrima, "tablet");
  const tp = tab.page;
  await tp.setViewportSize({ width: 1180, height: 1000 }); // sin que el destino quede pegado al borde (activaría el desplazamiento automático)
  await openTab(tp, "Compras MP", GC);
  await tp.waitForTimeout(1200);
  const cdp = await tab.ctx.newCDPSession(tp);
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await (await cellLoc(tp, GC, 0, "Cantidad")).tap();
  await tp.keyboard.type("7");
  await tp.keyboard.press("Enter");
  await waitDb(async () => Number((await compraBy(`${TAG} Compra 00`))?.cantidad) === 7);
  await (await cellLoc(tp, GC, 0, "Cantidad")).tap();
  await tp.waitForTimeout(500); // la hoja se reajusta al alto de la ventana al cambiar los avisos de arriba
  const th = await tp.locator(`[data-testid=${GC}-fill-handle]`).boundingBox();
  check("tablet: el controlador de relleno es lo bastante grande para tocarlo con el dedo (≥ 44 px)", th.width >= 44 && th.height >= 44, JSON.stringify(th));
  await tp.screenshot({ path: `${OUT}/08-tablet-controlador.png` });
  const t3 = await centerOf(await cellLoc(tp, GC, 4, "Cantidad"));
  await touch("touchStart", th.x + th.width / 2, th.y + th.height / 2);
  for (let k = 1; k <= 12; k++) await touch("touchMove", th.x + th.width / 2, th.y + th.height / 2 + ((t3.y - (th.y + th.height / 2)) * k) / 12);
  await tp.waitForTimeout(250);
  check("tablet: durante el arrastre con el dedo se ve la vista previa del rango", await tp.locator(`[data-testid=${GC}-fill-preview]`).isVisible());
  await tp.screenshot({ path: `${OUT}/09-tablet-arrastre.png` });
  await touch("touchEnd", 0, 0);
  check("tablet: arrastrar con el dedo completa y guarda la serie (7 → 8, 9, 10, 11) en las filas siguientes", await waitDb(async () => {
    for (let i = 1; i <= 4; i++) if (Number((await compraBy(`${TAG} Compra ${String(i).padStart(2, "0")}`))?.cantidad) !== 7 + i) return false;
    return true;
  }));
  await tab.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
