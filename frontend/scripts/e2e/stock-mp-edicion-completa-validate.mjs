// E2E en Chromium real: Stock MP con TODAS las columnas editables en la celda (como Excel), con el usuario Materia
// Prima, sobre una fila EXISTENTE creada por un ingreso confirmado (como las de Production) y la preferencia vieja
// «Ver como lista» guardada. Base DESCARTABLE.
//
//  - administrativos: doble clic → escribir → Enter, sin diálogos; Tab avanza; Escape cancela;
//  - kg lote / stock código / código: motivo pedido DENTRO de la planilla; ajuste o reclasificación en el libro mayor;
//  - código: lote + ingreso + libro mayor en una transacción, alias, historia intacta;
//  - días al vence / estados / origen: operación segura; pegado de un rango; 409; auditoría; permisos.
import { randomUUID } from "node:crypto";
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
const OUT = process.env.OUT ?? "/tmp/stock-mp-edicion-completa";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const T = "2026-10-09T10:00:00.000Z";
const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
/** Navegador de un usuario REAL: ya tiene guardada la preferencia global «lista» de antes. */
async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("__pl_seeded")) {
        localStorage.setItem("genus_os_table_mode", "list");
        sessionStorage.setItem("__pl_seeded", "1");
      }
    } catch {}
  });
  const page = await ctx.newPage();
  // Si un guardado por celda falla, se ve el motivo exacto del servidor.
  page.on("response", async (res) => {
    if (res.url().includes("/api/v1/inventory/cells") && res.status() >= 400) {
      console.log(`  [cells ${res.status()}] ${(await res.text().catch(() => "")).slice(0, 400)}`);
    }
  });
  debugPages.push(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const norm = (s) => s.trim().toLowerCase();

/**
 * Celda (fila con `rowValue` en alguna columna, columna `title`). La grilla dibuja solo las columnas visibles: primero
 * se ubica la fila con el scroll al inicio y después se desplaza hasta que la columna aparezca.
 */
async function cell(page, gridId, rowValue, title) {
  const grid = page.locator(`[data-testid=${gridId}]`);
  await grid.waitFor({ timeout: 60_000 });
  const setScroll = (x) => grid.evaluate((g, v) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft = v; }, x);
  await setScroll(0);
  await page.waitForTimeout(150);
  let ri = -1;
  for (let i = 0; i < 30 && ri < 0; i++) {
    ri = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
    if (ri < 0) {
      await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 250; });
      await page.waitForTimeout(120);
    }
  }
  if (ri < 0) throw new Error(`fila no encontrada: ${gridId} / ${rowValue}`);
  await setScroll(0);
  for (let i = 0; i < 40; i++) {
    const colIdx = (t) => grid.evaluate((g, t) => {
      const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
      return [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim().toLowerCase() === t);
    }, t);
    const col = await colIdx(norm(title));
    if (col >= 0) {
      // Centrar la columna (a partir del encabezado, que siempre está en el DOM) para que no quede debajo de la
      // columna fija de acciones, como haría el usuario al desplazarse. La grilla virtualiza columnas: después de
      // desplazar se vuelven a calcular los índices de columna y fila.
      await grid.evaluate((g, c0) => {
        const c = g.querySelector(".dsg-container");
        const header = [...g.querySelectorAll(".dsg-row")].find((r) => r.classList.contains("dsg-row-header"));
        const el = header?.querySelectorAll(".dsg-cell")[c0];
        if (!c || !el) return;
        const cr = c.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        c.scrollLeft += er.left - cr.left - cr.width / 3;
      }, col);
      await page.waitForTimeout(200);
      const col2 = await colIdx(norm(title));
      const ri2 = await grid.evaluate((g, v) => [...g.querySelectorAll(".dsg-row")].findIndex((r) => [...r.querySelectorAll("input")].some((x) => x.value === v)), rowValue);
      const target = grid.locator(".dsg-row").nth(ri2 >= 0 ? ri2 : ri).locator(".dsg-cell").nth(col2 >= 0 ? col2 : col);
      await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
      return target;
    }
    await grid.evaluate((g) => { const c = g.querySelector(".dsg-container"); if (c) c.scrollLeft += 200; });
    await page.waitForTimeout(120);
  }
  throw new Error(`columna no encontrada: ${gridId} / ${title}`);
}
async function editCell(page, gridId, rowValue, title, value, reason) {
  const c = await cell(page, gridId, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const apply = page.locator(`[data-testid=${gridId}-preview-apply]`);
  if (await apply.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
    if (reason) await page.locator(`[data-testid=${gridId}-reason]`).fill(reason);
    await apply.click();
    return true; // apareció un diálogo de confirmación
  }
  return false;
}
const cellValue = async (page, gridId, rowValue, title) => (await cell(page, gridId, rowValue, title)).locator("input").inputValue();
const lockReason = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-lock") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin motivo)" : ""));
/** Nota de trazabilidad de la celda (marca en la esquina + texto al pasar el mouse), o "" si no tiene. */
const noteOf = async (page, gridId, rowValue, title) =>
  (await cell(page, gridId, rowValue, title)).evaluate((el) => (el.querySelector(".genus-cell-note") ? el.querySelector(".genus-cell-wrap")?.getAttribute("title") ?? "(sin texto)" : ""));
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// ---------- Datos: un lote EXISTENTE como los de Production (creado por un ingreso confirmado, con historia en el libro
// mayor), insertado por SQL en la base DESCARTABLE. No se generan movimientos «para probar»: los que aparecen son los
// que genera la propia edición (ajuste / reclasificación), que es justamente lo que se valida.
const ids = { lot: randomUUID(), lot2: randomUUID(), ing: randomUUID(), mov: randomUUID() };
const OLD = "FULL-MP-OLD";
const NEW = "FULL-MP-NEW";
async function cleanup() {
  await q("delete from inv_mp_ingresos where payload->>'remitoNro' like 'FULL-R%'");
  await q("delete from inv_mp_stock where payload->>'cliente' like 'CLIENTE FULL%'");
  await q("delete from mp_stock_movements where codigo like 'FULL-MP-%'");
  await q("delete from mp_stock_balances where codigo like 'FULL-MP-%'");
}
async function seed() {
  const base = { proveedor: "PROV FULL", cliente: "CLIENTE FULL", ubicacion: "A1", estadoStock: "", diasAlVence: null, estadoVencimiento: "", productosAsociados: "", archived: false, createdBy: "mp@laboratoriogenus.com.ar", updatedBy: "mp@laboratoriogenus.com.ar", createdAt: T, updatedAt: T };
  const lot = { ...base, id: ids.lot, codigo: OLD, descripcion: "Glicerina full", cantidadKg: 25, lote: "L-FULL-1", vencimiento: "2027-05-31", origen: "ingreso", codigoPendiente: false };
  const lot2 = { ...base, id: ids.lot2, codigo: "FULL-MP-2", descripcion: "Vaselina full", cantidadKg: 3, lote: "L-FULL-2", vencimiento: "2027-01-31", origen: "manual", ubicacion: "A2", cliente: "CLIENTE FULL 2" };
  const ing = { id: ids.ing, fecha: "2026-09-01", ingresoNro: "MP-I-07001", proveedor: "PROV FULL", cliente: "CLIENTE FULL", remitoNro: "FULL-R1", pccMeNro: "", codigo: OLD, codigoPendiente: false, producto: "CREMA FULL", descripcion: "Glicerina full", bultos: 1, cantidad: 25, total: 25, ubicacion: "A1", lote: "L-FULL-1", vencimiento: "2027-05-31", stockLotId: ids.lot, status: "CONFIRMADO", stockImpacted: true, createdBy: "mp@laboratoriogenus.com.ar", updatedBy: "mp@laboratoriogenus.com.ar", createdAt: T, updatedAt: T };
  await q("insert into inv_mp_stock (id, payload) values ($1,$2), ($3,$4)", [ids.lot, lot, ids.lot2, lot2]);
  await q("insert into inv_mp_ingresos (id, payload) values ($1,$2)", [ids.ing, ing]);
  // Historia del libro mayor del código, como en Production: el ingreso confirmado.
  await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1, 'Glicerina full', 25), ('FULL-MP-2', 'Vaselina full', 3)", [OLD]);
  await q("insert into mp_stock_movements (id, codigo, kind, quantity, balance_after, reason, ref_type, ref_id, actor_email, actor_sector, idempotency_key) values ($1, $2, 'INGRESO', 25, 25, 'Ingreso MP-I-07001', 'mp_ingreso', $3, 'mp@laboratoriogenus.com.ar', 'MATERIA_PRIMA', $4)", [ids.mov, OLD, ids.ing, `full-seed:${ids.ing}`]);
}
const lot = async () => (await q("select payload from inv_mp_stock where id = $1", [ids.lot]))[0]?.payload;
const ingreso = async () => (await q("select payload from inv_mp_ingresos where id = $1", [ids.ing]))[0]?.payload;
const bal = async (c) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [c]))[0]?.stock_actual ?? 0);
const movs = async (c) => q("select kind, quantity, ref_type, reason from mp_stock_movements where codigo = $1 order by created_at, id", [c]);
const G = "mp-stock-grid";
const ROW = "CLIENTE FULL"; // valor que identifica la fila (no se edita)

/** Doble clic → escribir → Enter. Devuelve qué apareció: "none" | "inline" (motivo en la planilla) | "dialog". */
async function typeCell(page, title, value, rowValue = ROW) {
  const c = await cell(page, G, rowValue, title);
  await c.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  const inline = page.locator(`[data-testid=${G}-inline-reason-input]`);
  const dialog = page.locator(`[data-testid=${G}-preview]`);
  for (let i = 0; i < 20; i++) {
    if (await inline.isVisible().catch(() => false)) return "inline";
    if (await dialog.isVisible().catch(() => false)) return "dialog";
    await page.waitForTimeout(100);
  }
  return "none";
}
async function reloadStock(page) {
  await page.reload();
  await nav(page, "Stock");
  await page.locator(`[data-testid=${G}]`).waitFor({ timeout: 60_000 });
}
const today = new Date();
const plusDays = (n) => { const d = new Date(today); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

try {
  await cleanup();
  await seed();
  const { ctx, page: mp } = await openAs(E2E_USERS.materiaPrima);
  await nav(mp, "Stock");
  check("Stock MP abre como planilla (con la preferencia vieja «lista» guardada)", await mp.locator(`[data-testid=${G}]`).waitFor({ timeout: 60_000 }).then(() => true).catch(() => false));

  // 1) Sin candados: TODAS las columnas visibles, en una fila existente de un ingreso confirmado.
  const cols = ["Código", "Producto", "Proveedor", "Cliente", "Descripción", "Kg lote", "Stock código", "Ubicación", "Lote", "Vencimiento", "Estado stock", "Días VTO", "Estado VTO", "Origen"];
  const locked = [];
  for (const col of cols) if ((await lockReason(mp, G, ROW, col)) !== "") locked.push(col);
  check(`ninguna de las ${cols.length} columnas tiene candado (usuario Materia Prima, fila de ingreso confirmado)`, locked.length === 0, locked.join(", "));

  // 2) Datos administrativos: Enter guarda directo, sin diálogos ni pedidos de motivo; persisten al recargar.
  for (const [col, field, value] of [["Producto", "producto", "CREMA FULL B"], ["Proveedor", "proveedor", "PROV FULL 2"], ["Descripción", "descripcion", "Glicerina full USP"], ["Ubicación", "ubicacion", "B7"], ["Lote", "lote", "L-FULL-1B"], ["Vencimiento", "vencimiento", "2027-08-31"], ["Origen", "origen", "manual"]]) {
    const shown = await typeCell(mp, col, value);
    check(`«${col}»: doble clic → escribir → Enter guarda sin diálogo`, shown === "none", shown);
    check(`«${col}»: guardado en PostgreSQL`, await waitDb(async () => (await lot())?.[field] === value), String((await lot())?.[field]));
  }
  await reloadStock(mp);
  check("tras recargar: Producto, Proveedor, Descripción, Ubicación, Lote, Vencimiento y Origen muestran lo editado",
    (await cellValue(mp, G, ROW, "Producto")) === "CREMA FULL B" && (await cellValue(mp, G, ROW, "Proveedor")) === "PROV FULL 2" && (await cellValue(mp, G, ROW, "Ubicación")) === "B7" && (await cellValue(mp, G, ROW, "Lote")) === "L-FULL-1B" && (await cellValue(mp, G, ROW, "Origen")) === "manual");
  check("el ingreso original conserva lo recibido", (await ingreso())?.proveedor === "PROV FULL" && (await ingreso())?.lote === "L-FULL-1" && (await ingreso())?.producto === "CREMA FULL");

  // 3) Teclado: Tab guarda y pasa a la celda siguiente; Escape cancela.
  {
    const c = await cell(mp, G, ROW, "Producto");
    await c.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("CREMA TAB");
    await mp.keyboard.press("Tab");
    await mp.keyboard.press("Enter");
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("PROV TAB");
    await mp.keyboard.press("Enter");
    check("Tab: guarda Producto y pasa a Proveedor (que también se guarda)", await waitDb(async () => (await lot())?.producto === "CREMA TAB" && (await lot())?.proveedor === "PROV TAB"), JSON.stringify({ p: (await lot())?.producto, pr: (await lot())?.proveedor }));
    const c2 = await cell(mp, G, ROW, "Ubicación");
    await c2.dblclick();
    await mp.keyboard.press("ControlOrMeta+A");
    await mp.keyboard.type("NO-GUARDAR");
    await mp.keyboard.press("Escape");
    await mp.waitForTimeout(800);
    check("Escape cancela la edición (no se guarda)", (await lot())?.ubicacion === "B7");
  }

  // 4) Kg lote: Enter → motivo DENTRO de la planilla (sin ventana) → ajuste del lote + libro mayor.
  {
    const shown = await typeCell(mp, "Kg lote", "30");
    check("Kg lote: Enter pide el motivo en la misma planilla (sin ventana modal)", shown === "inline", shown);
    await mp.screenshot({ path: `${OUT}/1-kg-motivo-en-la-planilla.png` });
    await mp.locator(`[data-testid=${G}-inline-reason-input]`).fill("Conteo físico de depósito");
    await mp.keyboard.press("Enter");
    check("Kg lote: el lote queda en 30", await waitDb(async () => (await lot())?.cantidadKg === 30), String((await lot())?.cantidadKg));
    const aj = (await movs(OLD)).filter((m) => m.kind === "AJUSTE");
    check("Kg lote: el libro mayor registra el AJUSTE +5 con el motivo", aj.length === 1 && aj[0].quantity === 5 && /Conteo físico/.test(aj[0].reason) && (await bal(OLD)) === 30, JSON.stringify(aj));
    // Escape en la barra de motivo: no se guarda nada.
    const shown2 = await typeCell(mp, "Kg lote", "99");
    await mp.locator(`[data-testid=${G}-inline-reason-input]`).press("Escape");
    await mp.waitForTimeout(800);
    check("Kg lote: Escape en el motivo cancela (no cambia el lote ni el libro mayor)", shown2 === "inline" && (await lot())?.cantidadKg === 30 && (await bal(OLD)) === 30);
  }

  // 5) Stock código: Enter → motivo en la planilla (chip) → ajuste del saldo del código por la diferencia.
  {
    const shown = await typeCell(mp, "Stock código", "40");
    check("Stock código: pide el motivo en la planilla", shown === "inline", shown);
    await mp.getByRole("button", { name: "Conteo físico" }).click();
    check("Stock código: el saldo del código queda en 40 (AJUSTE +10, ref. saldo del código)", await waitDb(async () => (await bal(OLD)) === 40) && (await movs(OLD)).some((m) => m.ref_type === "mp_saldo_codigo" && m.quantity === 10));
    check("Stock código: el lote no cambia (30 kg)", (await lot())?.cantidadKg === 30);
    await reloadStock(mp);
    check("Stock código: tras recargar muestra 40", (await cellValue(mp, G, ROW, "Stock código")) === "40", await cellValue(mp, G, ROW, "Stock código"));
  }

  // 6) Código: reclasificación transaccional (lote + ingreso + libro mayor), historia intacta.
  {
    const historia = await movs(OLD);
    const shown = await typeCell(mp, "Código", NEW);
    check("Código: pide el motivo en la planilla", shown === "inline", shown);
    await mp.locator(`[data-testid=${G}-inline-reason-input]`).fill("Código de proveedor mal cargado");
    await mp.keyboard.press("Enter");
    check("Código: el lote pasa al código nuevo", await waitDb(async () => (await lot())?.codigo === NEW), String((await lot())?.codigo));
    const ing = await ingreso();
    check("Código: el ingreso vinculado pasa al código nuevo y conserva el recibido", ing?.codigo === NEW && ing?.codigoRecibido === OLD && ing?.status === "CONFIRMADO", JSON.stringify({ c: ing?.codigo, r: ing?.codigoRecibido }));
    const despues = await movs(OLD);
    check("Código: la historia del código viejo no se modificó (solo se agregó la salida por reclasificación)", JSON.stringify(despues.slice(0, historia.length)) === JSON.stringify(historia) && despues.length === historia.length + 1 && despues.at(-1).kind === "RECLASIFICACION" && despues.at(-1).quantity === -40);
    check("Código: el saldo pasó completo al código nuevo (viejo 0, nuevo 40)", (await bal(OLD)) === 0 && (await bal(NEW)) === 40);
    check("Código: alias viejo → nuevo para OE y control semanal", (await q("select payload->>'reclasificadoA' a from mp_stock_balances where codigo = $1", [OLD]))[0]?.a === NEW);
    await reloadStock(mp);
    check("Código: tras recargar la celda muestra el código nuevo y su nota cita el anterior", (await cellValue(mp, G, ROW, "Código")) === NEW && /antes: FULL-MP-OLD/.test(await noteOf(mp, G, ROW, "Código")));
    check("Código: «Stock código» muestra el saldo del código nuevo (40)", (await cellValue(mp, G, ROW, "Stock código")) === "40");
    await mp.screenshot({ path: `${OUT}/2-codigo-corregido.png` });
  }

  // 7) Columnas que dependen de otros datos: operación segura.
  {
    let shown = await typeCell(mp, "Días VTO", "45");
    check("Días VTO: Enter sin diálogo fija el vencimiento en hoy + 45", shown === "none" && (await waitDb(async () => (await lot())?.vencimiento === plusDays(45))), String((await lot())?.vencimiento));
    shown = await typeCell(mp, "Estado stock", "En cuarentena");
    check("Estado stock: se fija a mano sin tocar kg ni libro mayor", shown === "none" && (await waitDb(async () => (await lot())?.estadoStockManual === "En cuarentena")) && (await lot())?.cantidadKg === 30 && (await bal(NEW)) === 40);
    await reloadStock(mp);
    check("Estado stock: tras recargar muestra «En cuarentena» con nota «Fijado a mano»", (await cellValue(mp, G, ROW, "Estado stock")) === "En cuarentena" && /Fijado a mano/.test(await noteOf(mp, G, ROW, "Estado stock")));
    check("Días VTO: tras recargar muestra 45", (await cellValue(mp, G, ROW, "Días VTO")) === "45");
    shown = await typeCell(mp, "Estado VTO", "Re-análisis aprobado");
    check("Estado VTO: se fija a mano", shown === "none" && (await waitDb(async () => (await lot())?.estadoVencimientoManual === "Re-análisis aprobado")));
    // Vaciar la celda: vuelve al cálculo.
    const c = await cell(mp, G, ROW, "Estado stock");
    await c.click();
    await mp.keyboard.press("Delete");
    check("Estado stock: vaciar la celda vuelve al cálculo", await waitDb(async () => (await lot())?.estadoStockManual === ""));
    await mp.screenshot({ path: `${OUT}/3-stock-mp-todas-editables.png` });
  }

  // 8) Pegado desde Excel: un rango de 2 filas en Ubicación.
  {
    const grid = mp.locator(`[data-testid=${G}]`);
    const order = await grid.evaluate((g) => [...g.querySelectorAll(".dsg-row")].flatMap((r) => [...r.querySelectorAll("input")].map((x) => x.value).filter((v) => v === "Glicerina full USP" || v === "Vaselina full")));
    await (await cell(mp, G, order[0], "Ubicación")).click();
    await mp.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "RACK-1\nRACK-2");
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    });
    const byDesc = async (d) => (await q("select payload from inv_mp_stock where payload->>'descripcion' = $1", [d]))[0]?.payload?.ubicacion;
    check("pegar desde Excel un rango de 2 filas (Ubicación): ambas guardadas", await waitDb(async () => (await byDesc(order[0])) === "RACK-1" && (await byDesc(order[1])) === "RACK-2"), JSON.stringify(order));
  }

  // 9) Concurrencia, auditoría y permisos.
  {
    const stale = await mp.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: ids.lot, field: "proveedor", value: "PISAR", expectedVersion: T }] } });
    check("concurrencia: versión vieja → 409 y no se pisa", stale.status() === 409 && (await lot())?.proveedor !== "PISAR", String(stale.status()));
    const staleSaldo = await mp.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: ids.lot, field: "stockLibroMayor", value: "1", expectedVersion: (await lot()).updatedAt, reason: "Conteo físico viejo", expectedValue: "25" }] } });
    check("concurrencia: «Stock código» con un saldo visto viejo → 409 y el saldo no cambia", staleSaldo.status() === 409 && (await bal(NEW)) === 40, String(staleSaldo.status()));
    const n = Number((await q("select count(*)::int n from inv_audit where payload->>'entityId' = $1", [ids.lot]))[0].n);
    check("auditoría: cada edición de la fila quedó registrada", n >= 14, String(n));
  }
  await ctx.close();
  const prod = await openAs(E2E_USERS.produccion);
  const deny = await prod.page.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: ids.lot, field: "codigo", value: "X1", expectedVersion: (await lot()).updatedAt, reason: "Intento sin permiso" }] } });
  check("permisos: Producción no edita Stock MP (403)", deny.status() === 403, String(deny.status()));
  await prod.ctx.close();
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
