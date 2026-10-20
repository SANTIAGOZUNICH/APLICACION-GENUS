// E2E (Chromium, TABLET Android emulada + escritorio): Control semanal de MP POR PRODUCTO, colores de disponibilidad,
// mini control individual y restauración de MP quitadas. Base DESCARTABLE; login real; nunca Google/Neon/Production.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/mp-semanal-productos";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
// Tablet Android emulada (Galaxy Tab: 1280×800 en horizontal) y vertical.
const TABLET = { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1.5, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" };
const TABLET_V = { ...TABLET, viewport: { width: 800, height: 1280 } };

const TAG = "PRDX";
const C1 = "THELMA PRDX";
const C2 = "AGUEDA PRDX";
const C3 = "CLIENTE C PRDX";
const P1 = "PROTECTOR SOLAR PRDX E2E";
const P2 = "SHAMPOO SEBO PRDX E2E";
const P3 = "CREMA C PRDX E2E";
const AGUA = "Agua PRDX";
const GLI = "Glicerina PRDX";
const FILTRO = "Filtro PRDX";
const RARO = "Extracto raro PRDX";
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.:;/_-]+/g, " ").replace(/\s+/g, " ").trim();
const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const waitDb = async (fn, timeout = 20_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

async function seedFormula(client, product, code, rows) {
  const productId = randomUUID(); const versionId = randomUUID();
  await q(`insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id) values ($1,$2,$3,$4,$5,$6,$7)`, [productId, norm(client), norm(product), client, product, code, versionId]);
  await q(`insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet, source_file) values ($1,$2,1,'VIGENTE','src-prdx',$3,'OK','Fórmula',$4)`, [versionId, productId, `sha-prdx-${code}-0123456789`, `${product}.xlsx`]);
  let i = 0;
  for (const [n, c, p] of rows) await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++i, n, c, p]);
  await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Mezclar')`, [randomUUID(), versionId]);
}
async function lot(codigo, descripcion, lote, kg) {
  const id = randomUUID(); const now = new Date().toISOString();
  await q(`insert into inv_mp_stock (id, payload) values ($1,$2::jsonb)`, [id, JSON.stringify({ id, codigo, descripcion, proveedor: "Prov PRDX", lote, cantidadKg: kg, vencimiento: "2032-12-31", estadoStock: "Stock OK", ubicacion: "Dep", origen: "manual", createdBy: TAG, updatedBy: TAG, createdAt: now, updatedAt: now })]);
}
async function cleanup() {
  const prev = await q("select id from operational_orders where product like '% PRDX E2E'");
  for (const r of prev) { await q("delete from order_audit_events where order_id = $1", [r.id]); await q("delete from order_versions where order_id = $1", [r.id]); }
  await q("delete from operational_orders where product like '% PRDX E2E'");
  await q("delete from work_items where product like '% PRDX E2E'");
  await q("delete from mp_weekly_controls where product like '% PRDX E2E'").catch(() => undefined);
  await q("delete from inv_mp_stock where payload->>'createdBy' = $1", [TAG]);
  await q("delete from formula_products where display_client in ($1,$2,$3)", [C1, C2, C3]).catch(() => undefined);
  await q("delete from mp_weekly_row_state where week_start = $1", [monday]).catch(() => undefined);
  await q("delete from mp_weekly_production_exclusions where week_start = $1", [monday]).catch(() => undefined);
}
async function openAs(user, opts) {
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
// Los colores computados pueden venir en oklch/lab: se normalizan a RGB con un canvas.
const toRgb = (page, css) => page.evaluate((c) => { const cv = document.createElement("canvas"); cv.width = cv.height = 1; const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, css);

try {
  await cleanup();
  await seedFormula(C1, P1, "PT-PRDX-1", [[AGUA, "F-AG", "60"], [GLI, "F-GL", "20"], [FILTRO, "F-FI", "20"]]);
  await seedFormula(C2, P2, "PT-PRDX-2", [[AGUA, "F-AG", "70"], [GLI, "F-GL", "20"], [RARO, "F-RA", "10"]]);
  await seedFormula(C3, P3, "PT-PRDX-3", [[AGUA, "F-AG", "100"]]);
  await lot("PRDX-AGUA", AGUA, "AG1", 1000);
  await lot("PRDX-GLI", `${GLI} — Prov PRDX`, "G1", 100);
  await lot("PRDX-FIL", FILTRO, "F0", 0); // existe en el inventario pero en cero → SIN STOCK (rojo)
  // «Extracto raro» NO existe en el inventario → NO IDENTIFICADA (gris), nunca stock cero.

  const pr = await openAs(E2E_USERS.produccion, TABLET);
  let oeSeq = 0;
  const OE_BASE = 700000 + Math.floor(Math.random() * 2000) * 10;
  const oeNo = () => `OE-2026-${String(OE_BASE + ++oeSeq).padStart(6, "0")}`;
  for (const [client, product, qty] of [[C1, P1, "310"], [C2, P2, "310"], [C3, P3, "50"], [C3, P3, "70"]]) {
    const r = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client, product, plannedQuantity: qty, unit: "kg", plannedDate: monday, branchOwner: "Cristian", orderNumber: oeNo(), idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignar ${product}: ${r.status()} ${await r.text()}`);
  }
  const movs0 = (await q("select count(*)::int n from mp_stock_movements"))[0].n;
  const bal0 = (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h;
  const lots0 = JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]);
  const form0 = (await q("select md5(string_agg(material_name||percentage::text, ';' order by material_name)) h from formula_ingredients where material_name like '% PRDX'"))[0].h;

  const mp = await openAs(E2E_USERS.materiaPrima, TABLET);
  const p = mp.page;
  await p.goto("/mi-trabajo");
  await nav(p, "Control semanal");
  await p.locator("[data-testid=mpp-section]").first().waitFor({ timeout: 120_000 });
  const sec = (name) => p.locator("[data-testid=mpp-section]").filter({ has: p.locator("[data-testid=mpp-title]", { hasText: name }) });
  const lineOf = (s, mpName) => s.locator("[data-testid=mpp-line]").filter({ hasText: mpName });
  const open = async (s) => { if ((await s.locator("[data-testid=mpp-body]").count()) === 0) await s.locator("[data-testid=mpp-header]").tap(); await s.locator("[data-testid=mpp-body]").waitFor(); };

  // 1) Vista principal: una sección por producto con encabezado completo.
  check("la vista principal es POR PRODUCTO: 3 secciones (la fórmula de dos OE se agrupa)", (await p.locator("[data-testid=mpp-section]").count()) === 3);
  const s1 = sec(P1), s2 = sec(P2), s3 = sec(P3);
  const h1 = await s1.locator("[data-testid=mpp-header]").innerText();
  check("encabezado: cliente, producto, OE vinculada, 310 kg, fecha, conteos y estado general", h1.includes(C1) && h1.includes(P1) && /OE-2026-\d+/.test(h1) && /310 kg/.test(h1) && h1.includes(monday) && /Suficientes: 1/.test(h1) && /Faltantes: 1/.test(h1) && /Sin stock: 1/.test(h1) && /CON MP SIN STOCK/.test(h1), h1.replace(/\n/g, " | "));
  await open(s1); await open(s2); await open(s3);
  check("la fórmula se muestra COMPLETA (3 MP) con % y cantidad necesaria", (await s1.locator("[data-testid=mpp-line]").count()) === 3 && /60/.test(await lineOf(s1, AGUA).innerText()) && (await lineOf(s1, AGUA).locator("[data-testid=mpp-need]").innerText()) === "186" && (await lineOf(s1, GLI).locator("[data-testid=mpp-need]").innerText()) === "62");
  // 2) Colores + texto.
  const aguaL = lineOf(s1, AGUA), gliL = lineOf(s1, GLI), filL = lineOf(s1, FILTRO);
  check("VERDE · SUFICIENTE (agua 186 vs 1000)", (await aguaL.getAttribute("data-tone")) === "ok" && /SUFICIENTE/.test(await aguaL.locator("[data-testid=mpp-estado]").innerText()) && /\+/.test(await aguaL.locator("[data-testid=mpp-dif]").innerText()));
  check("AMARILLO · FALTANTE PARCIAL (glicerina: 38 de 62 → faltan 24)", (await gliL.getAttribute("data-tone")) === "partial" && /FALTANTE PARCIAL/.test(await gliL.locator("[data-testid=mpp-estado]").innerText()) && /-24/.test(await gliL.locator("[data-testid=mpp-dif]").innerText()) && /faltan 24/.test(await gliL.locator("[data-testid=mpp-dif]").innerText()));
  check("ROJO · SIN STOCK (filtro 62 vs 0)", (await filL.getAttribute("data-tone")) === "none" && /SIN STOCK/.test(await filL.locator("[data-testid=mpp-estado]").innerText()) && /-62/.test(await filL.locator("[data-testid=mpp-dif]").innerText()));
  const ex = s2.locator("[data-testid=mpp-line]").filter({ hasText: RARO });
  check("GRIS · NO IDENTIFICADA (extracto): no se muestra como stock cero", (await ex.getAttribute("data-tone")) === "unknown" && /NO IDENTIFICADA/.test(await ex.locator("[data-testid=mpp-estado]").innerText()) && (await ex.locator("[data-testid=mpp-util]").innerText()).startsWith("—"));
  const cg = await toRgb(p, await colorOf(aguaL.locator("[data-testid=mpp-util]"))), ca = await toRgb(p, await colorOf(gliL.locator("[data-testid=mpp-util]"))), cr = await toRgb(p, await colorOf(filL.locator("[data-testid=mpp-util]"))), cu = await toRgb(p, await colorOf(ex.locator("[data-testid=mpp-estado]")));
  check("los colores reales son distintos: verde (G alto), amarillo (R y G), rojo (R alto), gris", cg[1] > cg[0] && ca[0] > 200 && ca[1] > 150 && cr[0] > cr[1] + 40 && Math.abs(cu[0] - cu[1]) < 40, JSON.stringify({ cg, ca, cr, cu }));
  check("colores en stock utilizable, diferencia, saldo proyectado y estado (clases por celda)", (await gliL.locator("[data-testid=mpp-util]").getAttribute("class")).includes("amber") && (await gliL.locator("[data-testid=mpp-dif]").getAttribute("class")).includes("amber") && (await gliL.locator("[data-testid=mpp-saldo]").getAttribute("class")).includes("amber") && (await gliL.locator("[data-testid=mpp-estado]").getAttribute("class")).includes("amber"));
  check("los negativos se destacan (negrita) en diferencia y saldo", (await filL.locator("[data-testid=mpp-dif]").getAttribute("class")).includes("font-bold") && (await gliL.locator("[data-testid=mpp-saldo]").getAttribute("class")).includes("font-bold"));
  // 5) Stock compartido.
  const g2 = s2.locator("[data-testid=mpp-line]").filter({ hasText: GLI });
  check("stock COMPARTIDO: la glicerina figura compartida en ambos productos y el primero (AGUEDA) la tiene cubierta; el segundo queda parcial", /COMPARTIDO/.test(await g2.locator("[data-testid=mpp-shared]").innerText()) && /COMPARTIDO/.test(await gliL.locator("[data-testid=mpp-shared]").innerText()) && (await g2.getAttribute("data-tone")) === "ok" && (await gliL.getAttribute("data-tone")) === "partial");
  check("AGUEDA: datos incompletos (MP no identificada) pese a tener lo demás cubierto", /DATOS INCOMPLETOS/.test(await s2.locator("[data-testid=mpp-overall]").innerText()));
  // 6) Varias OE del mismo producto.
  const h3 = await s3.locator("[data-testid=mpp-header]").innerText();
  check("varias OE del mismo producto: una sección con 2 OE y el total 120 kg", /120 kg/.test(h3) && (await s3.locator("[data-testid=mpp-oe-list] li").count()) === 2 && /FÓRMULA CUBIERTA/.test(h3));
  await p.screenshot({ path: `${OUT}/tablet-por-producto.png` });
  // Expandir / contraer.
  await s3.locator("[data-testid=mpp-header]").tap();
  check("las secciones se contraen y se expanden", (await s3.locator("[data-testid=mpp-body]").count()) === 0);
  await s3.locator("[data-testid=mpp-header]").tap();
  check("…y vuelven a expandirse", (await s3.locator("[data-testid=mpp-body]").count()) === 1);
  // Resumen + filtros.
  const tile = async (id) => Number(await p.locator(`[data-testid=mpw-tile-value-${id}]`).innerText());
  check("resumen: 3 productos, 1 cubierto, 2 con faltantes, MP sin stock 1, parcial 1 (glicerina), no identificadas 1", (await tile("prod")) === 3 && (await tile("cubiertos")) === 1 && (await tile("faltantes")) === 1 && (await tile("mp-sin-stock")) === 1 && (await tile("mp-parcial")) === 1 && (await tile("mp-no-id")) === 1, JSON.stringify({ prod: await tile("prod"), cub: await tile("cubiertos"), fal: await tile("faltantes") }));
  await p.locator("[data-testid=mpw-filter-SIN_STOCK]").tap();
  check("filtro SIN STOCK → solo el producto con MP sin stock", (await p.locator("[data-testid=mpp-section]").count()) === 1 && (await sec(P1).count()) === 1);
  await p.locator("[data-testid=mpw-filter-DATOS_INCOMPLETOS]").tap();
  check("filtro DATOS INCOMPLETOS → solo el de la MP no identificada", (await p.locator("[data-testid=mpp-section]").count()) === 1 && (await sec(P2).count()) === 1);
  await p.locator("[data-testid=mpw-filter-SUFICIENTES]").tap();
  check("filtro SUFICIENTES → solo la fórmula cubierta", (await p.locator("[data-testid=mpp-section]").count()) === 1 && (await sec(P3).count()) === 1);
  await p.locator("[data-testid=mpw-filter-TODOS]").tap();
  await p.locator("[data-testid=mpw-tile-mp-sin-stock]").tap();
  check("el indicador «MP sin stock» abre el consolidado filtrado", (await p.locator("[data-testid=mpw-consolidado]").count()) === 1 && (await p.locator("[data-testid=mpw-row]").count()) === 1 && /Filtro PRDX/.test(await p.locator("[data-testid=mpw-row]").first().innerText()));
  // 4) Consolidado para compras: el stock se cuenta UNA vez.
  await p.locator("[data-testid=mpw-filter-TODOS]").tap();
  await p.locator("[data-testid=mpw-view-consolidado]").tap();
  const gRow = p.locator("[data-testid=mpw-row]").filter({ hasText: GLI });
  const gc = (await gRow.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("consolidado: glicerina necesita 124 (62+62) contra 100 de stock (no 200): saldo −24, FALTANTE PARCIAL, falta 24", gc[4] === "124" && gc[3] === "100" && /-24/.test(gc[6]) && /FALTANTE PARCIAL/.test(gc[7]) && /falta 24 kg/.test(gc[7]), JSON.stringify(gc));
  const aRow = (await p.locator("[data-testid=mpw-row]").filter({ hasText: AGUA }).locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("consolidado: agua 186+217+120 = 523 contra 1000 → SUFICIENTE", aRow[4] === "523" && /SUFICIENTE/.test(aRow[7]), JSON.stringify(aRow));
  check("consolidado: colores del estado y del saldo", (await gRow.locator("[data-testid=mpw-estado]").getAttribute("class")).includes("amber") && (await gRow.locator("[data-testid=mpw-saldo]").getAttribute("class")).includes("font-bold"));
  await p.screenshot({ path: `${OUT}/tablet-consolidado.png` });
  await p.locator("[data-testid=mpw-view-productos]").tap();

  // 9) Quitar / restaurar (varias a la vez, con confirmación) sin tocar nada real.
  await open(sec(P1));
  await lineOf(sec(P1), AGUA).locator("[data-testid=mpp-line-remove]").tap();
  check("quitar desde el producto pide confirmación", (await p.locator("[data-testid=mpw-confirm-delete]").count()) === 1);
  await p.locator("[data-testid=mpw-confirm-delete-yes]").tap();
  check("la MP quitada queda marcada en la fórmula (la fórmula sigue completa) y no cuenta", await waitDb(async () => (await sec(P1).locator("[data-testid=mpp-line]").count()) === 3 && /Quitada del control/.test(await lineOf(sec(P1), AGUA).innerText())));
  await p.locator("[data-testid=mpw-excluded] summary").tap();
  const alcance = await p.locator("[data-testid=mpw-excluded-scope]").first().innerText();
  check("la MP quitada muestra alcance claro (producciones y necesidad al quitarla) y quién/cuándo", /Alcance/.test(alcance) && /PROTECTOR SOLAR/.test(alcance) && /\d/.test(alcance) && /la quitó/.test(await p.locator("[data-testid=mpw-excluded]").innerText()));
  await p.locator("[data-testid=mpw-restore-check]").first().tap();
  await p.locator("[data-testid=mpw-restore-selected]").tap();
  check("restaurar por selección pide confirmación y la detalla", /Vas a restaurar 1/.test(await p.locator("[data-testid=mpw-restore-confirm]").innerText()));
  await p.screenshot({ path: `${OUT}/tablet-restaurar.png` });
  await p.locator("[data-testid=mpw-restore-yes]").tap();
  check("la MP restaurada vuelve a contarse", await waitDb(async () => !/Quitada del control/.test(await sec(P1).innerText())) && (await q("select 1 from mp_weekly_row_state where week_start = $1 and excluded", [monday])).length === 0);
  // Una exclusión vieja no oculta necesidades nuevas: se quita el agua y se programa un producto nuevo que la usa.
  await lineOf(sec(P1), AGUA).locator("[data-testid=mpp-line-remove]").tap();
  await p.locator("[data-testid=mpw-confirm-delete-yes]").tap();
  await waitDb(async () => /Quitada del control/.test(await sec(P1).innerText()));
  const nuevo = await pr.page.request.post("/api/v1/work-assignments", { data: { sector: "ELABORACION", client: C3, product: P3, plannedQuantity: "30", unit: "kg", plannedDate: monday, branchOwner: "Cristian", orderNumber: oeNo(), idempotencyKey: randomUUID() } });
  check("(preparación) se programa una producción nueva que usa el agua", nuevo.ok());
  await p.locator("[data-testid=mpw-refresh]").tap();
  await p.locator("[data-testid=mpw-view-consolidado]").tap();
  check("la exclusión vieja NO oculta la necesidad nueva: el agua vuelve a verse con aviso y motivo", await waitDb(async () => /nueva/.test(await p.locator("[data-testid=mpw-review]").first().innerText().catch(() => ""))) && (await p.locator("[data-testid=mpw-review-banner]").count()) === 1);
  await p.locator("[data-testid=mpw-review-restore]").first().tap();
  await p.locator("[data-testid=mpw-restore-yes]").tap();
  await p.locator("[data-testid=mpw-view-productos]").tap();
  await open(sec(P1));

  // 8) Control anulado: su producción se distingue de una exclusión manual y se puede volver a sumar.
  const created = await mp.page.request.post("/api/v1/mp-control", { data: { client: C2, product: P2, quantityKg: 310, snapshot: { client: C2, product: P2, source: "manual", capturedAt: new Date().toISOString(), materials: [{ codigo: "F-AG", materiaPrima: AGUA, formulaPct: 70 }, { codigo: "F-GL", materiaPrima: GLI, formulaPct: 20 }, { codigo: "F-RA", materiaPrima: RARO, formulaPct: 10 }] } } });
  const ctl = (await created.json()).control;
  const done = await mp.page.request.patch(`/api/v1/mp-control/${ctl.id}`, { data: { status: "COMPLETADO" } });
  const annul = await mp.page.request.patch(`/api/v1/mp-control/${ctl.id}`, { data: { lifecycleAction: "annul", reason: "E2E anulado" } });
  check("(preparación) el control se completa y se anula", done.ok() && annul.ok(), `${done.status()}/${annul.status()} ${annul.ok() ? "" : await annul.text()}`);
  await p.locator("[data-testid=mpw-refresh]").tap();
  check("control ANULADO: su producción sale del cálculo del Control semanal", await waitDb(async () => (await sec(P2).count()) === 0));
  await p.locator("[data-testid=mpw-excluded] summary").tap();
  check("se distingue «control eliminado, anulado o archivado» de las quitadas a mano", /control eliminado, anulado o archivado/.test(await p.locator("[data-testid=mpw-prod-excluded-panel]").innerText()));
  await p.screenshot({ path: `${OUT}/tablet-control-anulado.png` });
  await p.locator("[data-testid=mpw-prod-restore-panel]").first().tap();
  check("«Volver a sumar» devuelve la producción", await waitDb(async () => (await sec(P2).count()) === 1));

  // 10) Mini control individual con los mismos colores.
  const created2 = await mp.page.request.post("/api/v1/mp-control", { data: { client: C1, product: P1, quantityKg: 500, snapshot: { client: C1, product: P1, source: "manual", capturedAt: new Date().toISOString(), materials: [{ codigo: "F-AG", materiaPrima: AGUA, formulaPct: 10 }, { codigo: "F-GL", materiaPrima: GLI, formulaPct: 30 }, { codigo: "F-FI", materiaPrima: FILTRO, formulaPct: 10 }, { codigo: "F-RA", materiaPrima: RARO, formulaPct: 5 }] } } });
  const ctl2 = (await created2.json()).control;
  await p.reload();
  await nav(p, "Control semanal").catch(() => undefined);
  await p.getByText(`${C1} · ${P1}`).first().tap({ timeout: 60_000 });
  const grid = p.locator("[data-testid=mp-control-lines-grid]");
  await grid.waitFor({ timeout: 60_000 });
  const cell = (tone) => grid.locator(`.genus-tone-${tone}`);
  const txt = async (tone) => (await cell(tone).evaluateAll((els) => els.map((e) => (e.querySelector("input")?.value ?? e.textContent ?? "").trim()))).join(" | ");
  check("mini control (planilla) — VERDE: agua 50 kg vs 1000 → stock 1000, proyectado +950", (await cell("ok").count()) >= 3 && /1000/.test(await txt("ok")) && /950/.test(await txt("ok")), await txt("ok"));
  check("mini control — AMARILLO: glicerina 150 vs 100 → stock 100, diferencia −50", (await cell("partial").count()) >= 3 && /100/.test(await txt("partial")) && /-50/.test(await txt("partial")), await txt("partial"));
  check("mini control — ROJO: filtro 50 vs 0 → stock 0, diferencia −50", (await cell("none").count()) >= 3 && /-50/.test(await txt("none")), await txt("none"));
  check("mini control — GRIS: extracto no identificado (celdas grises, sin cantidad inventada)", (await cell("unknown").count()) >= 3 && !/\b0\b/.test(await txt("unknown")), await txt("unknown"));
  check("mini control: los negativos se destacan", (await grid.locator(".genus-tone-neg").count()) >= 2);
  const gx = await toRgb(p, await colorOf(cell("ok").locator(".dsg-input").first())), ax = await toRgb(p, await colorOf(cell("partial").locator(".dsg-input").first())), rx = await toRgb(p, await colorOf(cell("none").locator(".dsg-input").first()));
  check("mini control: los números llevan color distinto (verde / amarillo / rojo)", gx[1] > gx[0] && ax[0] > 200 && ax[1] > 150 && rx[0] > rx[1] + 40, JSON.stringify({ gx, ax, rx }));
  await p.screenshot({ path: `${OUT}/tablet-mini-control-planilla.png` });
  // Vista de lista del mismo mini control (mismos colores y textos).
  await p.locator("[data-testid=os-table-mode-toggle]").first().tap();
  await p.locator("[data-testid=mp-control-lines]").waitFor({ timeout: 30_000 });
  const mini = (name) => p.locator("[data-testid=mp-control-line]").filter({ hasText: name });
  check("mini control (lista) — VERDE/AMARILLO/ROJO/GRIS con texto", (await mini(AGUA).getAttribute("data-tone")) === "ok" && (await mini(GLI).getAttribute("data-tone")) === "partial" && /FALTANTE PARCIAL/.test(await mini(GLI).locator("[data-testid=mp-control-estado]").innerText()) && (await mini(FILTRO).getAttribute("data-tone")) === "none" && /NO IDENTIFICADA/.test(await mini(RARO).locator("[data-testid=mp-control-estado]").innerText()) && (await mini(RARO).locator("[data-testid=mp-control-stock]").innerText()) === "—");
  check("mini control: fórmula completa con % y cantidades (4 líneas)", (await p.locator("[data-testid=mp-control-line]").count()) === 4 && (await mini(GLI).locator("[data-testid=mp-control-pct]").innerText()) === "30");
  await p.screenshot({ path: `${OUT}/tablet-mini-control.png` });

  // 11) Tablet: sin desbordes ni botones superpuestos; tamaños táctiles.
  check("tablet horizontal: la página no tiene scroll horizontal propio", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  const hdr = await p.locator("[data-testid=mpp-header]").first().boundingBox().catch(() => null);
  const chip = await p.locator("[data-testid=mpw-filter-TODOS]").boundingBox().catch(() => null);
  check("controles táctiles ≥ 44 px (encabezado de producto y filtros)", Boolean(chip && chip.height >= 44) && (!hdr || hdr.height >= 56), JSON.stringify({ chip: chip?.height, hdr: hdr?.height }));
  await mp.ctx.close();
  const mpv = await openAs(E2E_USERS.materiaPrima, TABLET_V);
  await mpv.page.goto("/mi-trabajo");
  await nav(mpv.page, "Control semanal");
  await mpv.page.locator("[data-testid=mpp-section]").first().waitFor({ timeout: 120_000 });
  await mpv.page.locator("[data-testid=mpw-expand-all]").tap();
  check("tablet vertical (800 px): sin scroll horizontal de la página", await mpv.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
  const overlap = await mpv.page.evaluate(() => { const bs = [...document.querySelectorAll("[data-testid=mpw-filters] button")].map((b) => b.getBoundingClientRect()); return bs.some((a, i) => bs.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)); });
  check("tablet vertical: los filtros no se superponen", !overlap);
  await mpv.page.screenshot({ path: `${OUT}/tablet-vertical.png` });
  await mpv.ctx.close();

  // 8) Invariantes: solo lectura / sin tocar stock ni fórmulas.
  await q("delete from mp_weekly_controls where product like '% PRDX E2E'").catch(() => undefined);
  void ctl2;
  check("nada tocó stock, lotes, movimientos ni fórmulas", (await q("select count(*)::int n from mp_stock_movements"))[0].n === movs0 && (await q("select md5(coalesce(string_agg(codigo||stock_actual::text, ';' order by codigo),'')) h from mp_stock_balances"))[0].h === bal0 && JSON.stringify((await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::numeric),0)::float kg from inv_mp_stock where payload->>'createdBy' = $1", [TAG]))[0]) === lots0 && (await q("select md5(string_agg(material_name||percentage::text, ';' order by material_name)) h from formula_ingredients where material_name like '% PRDX'"))[0].h === form0);
  await pr.ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
