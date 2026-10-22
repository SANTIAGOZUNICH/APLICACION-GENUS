// E2E (Chromium real, base DESCARTABLE): Ingresos MP se eliminan libremente (sin motivo, incluso confirmados) con reversión
// de inventario una sola vez, y toda fila NUEVA de Stock MP queda debajo de la última fila escrita del orden manual.
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
const OUT = process.env.OUT ?? "/tmp/mp-ingresos-orden";
const N = Number(process.env.FILAS ?? 1423);
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
const kind = process.env.TABLET ? "tablet" : "desktop";
const TIPS = { desktop: { viewport: { width: 1280, height: 800 } }, tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 } };
const ctx = await browser.newContext({ baseURL: BASE, ...TIPS[kind] });
const page = await ctx.newPage();
await page.goto("/login");
await page.locator('input[type="email"]').fill(E2E_USERS.materiaPrima.email);
await page.locator('input[type="password"]').fill(E2E_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

const nav = (label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
};
const NOWISO = "2026-10-01T00:00:00.000Z";
async function cleanup() {
  await q(`delete from inv_mp_stock where payload->>'createdBy' = 'zze' or payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from inv_mp_ingresos where payload->>'codigo' like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_movements where codigo like 'ZZ%'`).catch(() => undefined);
  await q(`delete from mp_stock_balances where codigo like 'ZZ%'`).catch(() => undefined);
}
async function seedStock(n) {
  await q(`insert into inv_mp_stock (id, payload, updated_at) select md5('zze-stock-' || g.n)::uuid, jsonb_build_object('id', md5('zze-stock-' || g.n), 'codigo','ZZE-' || lpad(g.n::text,5,'0'),'descripcion','Materia ZZE ' || g.n,'proveedor','Prov','cliente','','producto','','lote','L' || g.n,'cantidadKg',10,'ubicacion','U1','vencimiento','2028-01-31','estadoStock','Stock OK','origen','manual','archived',false,'createdBy','zze','updatedBy','zze','createdAt','${NOWISO}','updatedAt','${NOWISO}'), now() from (select n from generate_series(1, ${n}) n) g`);
}
const apiList = async (resource) => (await (await page.request.get(`/api/v1/inventory?resource=${resource}`, { timeout: 180_000 })).json()).data ?? [];
const stockOrder = async () => (await apiList("mp_stock")).filter((r) => !r.archived).map((r) => r.id);
const stockCodes = async () => (await apiList("mp_stock")).filter((r) => !r.archived).map((r) => r.codigo);
let seq = 0;
async function newIngreso(code, qty = 25) {
  seq += 1;
  const id = crypto.randomUUID();
  const res = await page.request.post("/api/v1/inventory", {
    data: { action: "upsert", resource: "mp_ingresos", payload: { id, codigo: code, descripcion: `Ingreso ${code}`, proveedor: "Prov ZZ", lote: `LOTE-${code}`, bultos: 1, cantidad: qty, fecha: "2026-10-05", confirm: true } },
    timeout: 120_000,
  });
  const json = await res.json().catch(() => ({}));
  return { id, ok: res.ok(), json, status: res.status() };
}
const movs = async (code) => (await q(`select count(*)::int n from mp_stock_movements where codigo = $1`, [code]))[0].n;
const balance = async (code) => Number((await q(`select stock_actual from mp_stock_balances where codigo = $1`, [code]))[0]?.stock_actual ?? 0);
const lotKg = async (code) => Number((await q(`select coalesce(sum((payload->>'cantidadKg')::numeric),0) s from inv_mp_stock where payload->>'codigo' = $1 and coalesce((payload->>'archived')::boolean,false) = false`, [code]))[0].s);

/** Texto de la fila n (gutter) de una planilla: celdas + valores de inputs. */
const rowText = (gid, n) => page.evaluate(({ gid, n }) => {
  const root = document.querySelector(`[data-testid=${gid}]`);
  for (const row of [...root.querySelectorAll(".dsg-row")].slice(1)) {
    if (Number((row.querySelector(".dsg-cell-gutter")?.textContent ?? "").trim()) === n) {
      return [...row.querySelectorAll(".dsg-cell")].map((c) => (c.querySelector("input")?.value ?? c.textContent ?? "")).join("|");
    }
  }
  return null;
}, { gid, n });
const snapScroll = (gid) => page.evaluate((gid) => { const sc = document.querySelector(`[data-testid=${gid}] .dsg-container`); return Math.round(sc.scrollTop); }, "mp-stock-grid");
async function wheel(gid, y) {
  const b = await page.locator(`[data-testid=${gid}] .dsg-container`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, y);
  await page.waitForTimeout(700);
}
async function openTab(label, gid) {
  await page.goto("/mi-trabajo");
  await nav(label);
  await page.locator(`[data-testid=${gid}]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
}

try {
  await cleanup();
  await seedStock(N);
  check(`${N} filas de Stock MP sembradas`, (await q(`select count(*)::int n from inv_mp_stock where payload->>'createdBy' = 'zze'`))[0].n === N);

  // ===== 2. NUEVAS FILAS DE STOCK: SIEMPRE DEBAJO DE LA ÚLTIMA ESCRITA =====
  const a = await newIngreso("ZZN-1");
  check("ingreso confirmado nuevo creado", a.ok, JSON.stringify(a.json).slice(0, 160));
  let codes = await stockCodes();
  check(`con ${N} filas, el ingreso nuevo cae en la fila ${N + 1}`, codes.length === N + 1 && codes[N] === "ZZN-1", `total ${codes.length}, última=${codes[codes.length - 1]}`);
  const b = await newIngreso("ZZN-2");
  codes = await stockCodes();
  check(`el segundo ingreso cae en la fila ${N + 2}`, b.ok && codes[N + 1] === "ZZN-2" && codes[N] === "ZZN-1");

  // en la interfaz: fila N+1 y N+2 al final de la planilla Stock
  await openTab("Stock", "mp-stock-grid");
  await page.waitForFunction((gid) => (document.querySelector(`[data-testid=${gid}] .dsg-container`)?.scrollHeight ?? 0) > 5000, "mp-stock-grid", { timeout: 180_000 });
  await wheel("mp-stock-grid", 10_000_000);
  const t1 = await rowText("mp-stock-grid", N + 1), t2 = await rowText("mp-stock-grid", N + 2);
  check(`UI: la fila ${N + 1} de la planilla es ZZN-1 y la ${N + 2} es ZZN-2`, !!t1 && t1.includes("ZZN-1") && !!t2 && t2.includes("ZZN-2"), `${(t1 ?? "null").slice(0, 60)} / ${(t2 ?? "null").slice(0, 60)}`);
  await page.screenshot({ path: `${OUT}/01-final-stock.png` });

  // reintentos: mismo ingreso reenviado → no duplica movimientos ni kg
  const mv0 = await movs("ZZN-1"), kg0 = await lotKg("ZZN-1"), bal0 = await balance("ZZN-1");
  for (let i = 0; i < 2; i++) {
    await page.request.post("/api/v1/inventory", { data: { action: "upsert", resource: "mp_ingresos", payload: { id: a.id, codigo: "ZZN-1", descripcion: "Ingreso ZZN-1", proveedor: "Prov ZZ", lote: "LOTE-ZZN-1", bultos: 1, cantidad: 25, fecha: "2026-10-05", confirm: true } } });
  }
  check("reintentos del mismo ingreso no duplican movimientos, kg ni saldo", (await movs("ZZN-1")) === mv0 && (await lotKg("ZZN-1")) === kg0 && (await balance("ZZN-1")) === bal0, `mov ${mv0}→${await movs("ZZN-1")}, kg ${kg0}→${await lotKg("ZZN-1")}, saldo ${bal0}→${await balance("ZZN-1")}`);
  check("el saldo del código = suma de sus lotes", (await balance("ZZN-1")) === (await lotKg("ZZN-1")), `${await balance("ZZN-1")} vs ${await lotKg("ZZN-1")}`);

  // filas vacías de trabajo debajo: el nuevo va ANTES de ellas
  const ins = async (beforeId) => (await (await page.request.post("/api/v1/inventory/rows", { data: { action: "insert", resource: "mp_stock", beforeId } })).json());
  const ids0 = await stockOrder();
  const blankTail1 = await ins(null), blankTail2 = await ins(null);
  const c3 = await newIngreso("ZZN-3");
  let order = await stockOrder();
  const pos = (id) => order.indexOf(id);
  check("con 2 filas vacías al final, el ingreso nuevo queda justo debajo de la última escrita y las vacías siguen debajo", c3.ok && order.length === ids0.length + 3 && pos(blankTail1.id) === order.length - 2 && pos(blankTail2.id) === order.length - 1 && (await stockCodes())[order.length - 3] === "ZZN-3", `pos blancas ${pos(blankTail1.id)},${pos(blankTail2.id)} de ${order.length}`);
  // fila vacía intermedia: no se reutiliza
  const mid = await ins(ids0[100]);
  const c4 = await newIngreso("ZZN-4");
  order = await stockOrder();
  const posMid = order.indexOf(mid.id);
  check("una fila vacía intermedia NO se reutiliza: el ingreso nuevo no ocupa ese hueco", c4.ok && posMid === 100 && (await stockCodes())[posMid] !== "ZZN-4" && (await stockCodes())[order.length - 3] === "ZZN-4");

  // archivadas
  const archId = ids0[ids0.length - 1];
  await q(`update inv_mp_stock set payload = jsonb_set(payload,'{archived}','true') where id = $1::uuid`, [archId]);
  const before5 = await stockOrder();
  const c5 = await newIngreso("ZZN-5");
  order = await stockOrder();
  check("con filas archivadas, el ingreso nuevo va después de la última fila visible escrita (sin ocupar huecos)", c5.ok && order.length === before5.length + 1 && (await stockCodes())[order.length - 3] === "ZZN-5");

  // orden manual modificado
  const moved = ids0[10];
  await page.request.post("/api/v1/inventory/rows", { data: { action: "move", resource: "mp_stock", id: moved, beforeId: blankTail1.id } });
  const c6 = await newIngreso("ZZN-6");
  order = await stockOrder();
  const codes6 = await stockCodes();
  check("con una fila movida manualmente al final de los datos, el ingreso nuevo queda DESPUÉS de ella", c6.ok && codes6[order.length - 3] === "ZZN-6" && order.indexOf(moved) === order.length - 4, `pos movida ${order.indexOf(moved)} de ${order.length}`);

  // con filtro activo en pantalla
  await openTab("Stock", "mp-stock-grid");
  const search = page.getByPlaceholder(/buscar/i).first();
  await search.fill("ZZE-0001");
  await page.waitForTimeout(800);
  const c7 = await newIngreso("ZZN-7");
  order = await stockOrder();
  check("con un filtro de búsqueda activo, el ingreso nuevo sigue yendo al final del orden", c7.ok && (await stockCodes())[order.length - 3] === "ZZN-7");
  await search.fill("");

  // ===== editar otra fila mientras llegan ingresos: sin saltos ni pérdida de foco =====
  await openTab("Stock", "mp-stock-grid");
  await page.waitForFunction((gid) => (document.querySelector(`[data-testid=${gid}] .dsg-container`)?.scrollHeight ?? 0) > 5000, "mp-stock-grid", { timeout: 180_000 });
  await wheel("mp-stock-grid", 346 * 36);
  let maxDrift = 0, lostFocus = 0, moves = 0;
  for (let i = 0; i < 5; i++) {
    const n = 350 + i;
    const row = page.locator(`[data-testid=mp-stock-grid] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.locator(".dsg-cell").nth(4).click();
    const s0 = await snapScroll("mp-stock-grid");
    await newIngreso(`ZZW-${i}`, 5); // llega un ingreso nuevo (otro usuario) mientras se edita
    await page.keyboard.type(`Edit${i}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const s1 = await snapScroll("mp-stock-grid");
    maxDrift = Math.max(maxDrift, Math.abs(s1 - s0));
    if (!(await page.locator("[data-testid=mp-stock-grid] .dsg-active-cell").count())) lostFocus++;
    const t = await rowText("mp-stock-grid", n);
    if (!t || !t.includes("Materia ZZE") && !t.includes(`Edit${i}`)) moves++;
  }
  check(`editar la fila 350 con ingresos nuevos llegando: sin saltos de pantalla (desvío máx. ${maxDrift}px)`, maxDrift <= 36 * 2.5);
  check("no se pierde la celda activa y las filas existentes no cambian de lugar", lostFocus === 0 && moves === 0, `sin foco ${lostFocus}, filas cambiadas ${moves}`);

  // ===== 1. ELIMINAR INGRESOS MP =====
  const D = [];
  for (let i = 1; i <= 5; i++) D.push(await newIngreso(`ZZD-${i}`, 10 * i));
  check("5 ingresos confirmados creados para eliminar", D.every((d) => d.ok));
  const kgBefore = await lotKg("ZZD-1");
  await openTab("Ingresos MP", "mp-ingresos-grid");
  const visible = async () => (await apiList("mp_ingresos")).filter((r) => r.status !== "ANULADO").map((r) => ({ id: r.id, codigo: r.codigo }));
  const rowOf = async (id) => (await visible()).findIndex((r) => r.id === id) + 1;
  const clickIngresoRow = async (id, col = 5) => {
    const n = await rowOf(id);
    const top = await page.evaluate(() => document.querySelector("[data-testid=mp-ingresos-grid] .dsg-container").scrollTop);
    const want = (n - 4) * 36;
    if (Math.abs(want - top) > 300) await wheel("mp-ingresos-grid", want - top);
    const row = page.locator(`[data-testid=mp-ingresos-grid] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n}$`) }) }).first();
    await row.waitFor({ timeout: 20_000 });
    await row.locator(".dsg-cell").nth(col).click();
    return n;
  };
  // 1) uno, confirmado, sin motivo
  const mv1 = await movs("ZZD-1");
  await clickIngresoRow(D[0].id);
  await page.locator("[data-testid=mp-ingresos-grid-delete-rows]").click();
  await waitDb(async () => (await q(`select payload->>'status' s from inv_mp_ingresos where id = $1::uuid`, [D[0].id]))[0]?.s === "ANULADO");
  const dlg = await page.locator("[role=dialog]").count();
  const st = (await q(`select payload->>'status' s from inv_mp_ingresos where id = $1::uuid`, [D[0].id]))[0];
  check("eliminar un ingreso CONFIRMADO desde la planilla: sin motivo ni confirmación, queda anulado en el historial", st?.s === "ANULADO" && dlg === 0);
  check("la fila desaparece de la planilla de inmediato", (await rowOf(D[0].id)) === 0 && !(await page.locator("[data-testid=mp-ingresos-grid]").innerText()).includes("Ingreso ZZD-1"));
  check("el inventario se corrige una sola vez (kg del lote y saldo del código vuelven a 0, historial conservado)", (await lotKg("ZZD-1")) === 0 && (await balance("ZZD-1")) === 0 && (await movs("ZZD-1")) === mv1 + 1 && kgBefore === 10, `kg ${kgBefore}→${await lotKg("ZZD-1")}, saldo ${await balance("ZZD-1")}, movs ${mv1}→${await movs("ZZD-1")}`);
  // reintento de anulación
  await page.request.post("/api/v1/inventory", { data: { action: "anular", resource: "mp_ingresos", id: D[0].id } });
  await page.request.post("/api/v1/inventory", { data: { action: "anular", resource: "mp_ingresos", id: D[0].id } });
  check("reintentar la eliminación no duplica la reversión", (await movs("ZZD-1")) === mv1 + 1 && (await lotKg("ZZD-1")) === 0);
  const aud = await q(`select count(*)::int n from inv_audit where payload->>'module' = 'mp_ingresos' and payload->>'entityId' = $1 and payload->>'action' = 'anular' and payload->>'actor' is not null`, [D[0].id]);
  check("queda auditado: usuario, fecha y datos anteriores", aud[0].n >= 1);
  // 2) varias seleccionadas (rango de 2 filas)
  const n2 = await rowOf(D[1].id), n3 = await rowOf(D[2].id);
  await clickIngresoRow(D[1].id);
  const rowN3 = page.locator(`[data-testid=mp-ingresos-grid] .dsg-row`).filter({ has: page.locator(".dsg-cell-gutter", { hasText: new RegExp(`^${n3}$`) }) }).first();
  await rowN3.locator(".dsg-cell").nth(5).click({ modifiers: ["Shift"] });
  await page.locator("[data-testid=mp-ingresos-grid-delete-rows]").click();
  await waitDb(async () => (await q(`select count(*)::int n from inv_mp_ingresos where id = any($1::uuid[]) and payload->>'status' = 'ANULADO'`, [[D[1].id, D[2].id]]))[0].n === 2);
  check(`eliminar varias filas seleccionadas a la vez (${n2}–${n3})`, (await rowOf(D[1].id)) === 0 && (await rowOf(D[2].id)) === 0 && (await lotKg("ZZD-2")) === 0 && (await lotKg("ZZD-3")) === 0 && n3 === n2 + 1);
  // 3) con consumo posterior: se baja el lote a mano (consumo) y se elimina el ingreso
  const lot4 = (await q(`select id::text id from inv_mp_stock where payload->>'codigo' = 'ZZD-4'`))[0].id;
  const ver = (await q(`select updated_at from inv_mp_stock where id = $1::uuid`, [lot4]))[0].updated_at;
  await page.request.patch("/api/v1/inventory/cells", { data: { resource: "mp_stock", changes: [{ id: lot4, field: "cantidadKg", value: "15", expectedVersion: new Date(ver).toISOString() }] } });
  const consumed = await lotKg("ZZD-4");
  await clickIngresoRow(D[3].id);
  await page.locator("[data-testid=mp-ingresos-grid-delete-rows]").click();
  await waitDb(async () => (await q(`select payload->>'status' s from inv_mp_ingresos where id = $1::uuid`, [D[3].id]))[0]?.s === "ANULADO");
  check("eliminar un ingreso con consumo posterior: no falla, se conserva el historial y el saldo del código = suma de lotes", consumed === 15 && (await balance("ZZD-4")) === (await lotKg("ZZD-4")), `lote ${consumed}→${await lotKg("ZZD-4")}, saldo ${await balance("ZZD-4")}, movs ${await movs("ZZD-4")}`);
  // persistencia tras recargar
  await openTab("Ingresos MP", "mp-ingresos-grid");
  const txt = await page.locator("[data-testid=mp-ingresos-grid]").innerText();
  check("tras recargar, los ingresos eliminados siguen sin aparecer y el resto sigue", !txt.includes("Ingreso ZZD-1") && !txt.includes("Ingreso ZZD-2") && !txt.includes("Ingreso ZZD-3") && !txt.includes("Ingreso ZZD-4"));
  await page.screenshot({ path: `${OUT}/02-ingresos-tras-recarga.png` });
  // el historial de movimientos no se borra
  check("ningún movimiento histórico se borró (ZZD-1..4 conservan sus altas y reversiones)", (await movs("ZZD-1")) >= 2 && (await movs("ZZD-2")) >= 2 && (await movs("ZZD-3")) >= 2 && (await movs("ZZD-4")) >= 2);
  // integridad global de los códigos usados
  const lots = await q(`select payload->>'codigo' c, sum((payload->>'cantidadKg')::numeric) s from inv_mp_stock where payload->>'codigo' like 'ZZ%' and payload->>'codigo' not like 'ZZE%' and coalesce((payload->>'archived')::boolean,false)=false group by 1`);
  let bad = 0;
  for (const l of lots) if (Number(l.s) !== (await balance(l.c))) bad++;
  check(`inventario coherente: saldo por código = suma de lotes en los ${lots.length} códigos de la prueba`, bad === 0, `${bad} difieren`);
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
} finally {
  await browser.close();
  await cleanup().catch(() => undefined);
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
