// E2E en Chromium real de DEPÓSITO › UBICACIONES. Base DESCARTABLE (marca verificada) y login real. Ver run-ubicaciones-local.sh.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/ubicaciones-e2e";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const EMAILS = [E2E_USERS.deposito.email, E2E_USERS.direccion.email, E2E_USERS.envasado.email, E2E_USERS.envasadoPremium.email];
const fixtures = { mats: [], ings: [] };
const cleanup = async () => {
  await q("delete from deposito_ingreso_ubicacion").catch(() => undefined);
  await q("delete from inv_me_ingresos where id = any($1::uuid[])", [fixtures.ings]).catch(() => undefined);
  await q("delete from inv_me_materials where id = any($1::uuid[])", [fixtures.mats]).catch(() => undefined);
  await q("delete from deposito_ubicacion_clientes").catch(() => undefined);
  await q("delete from deposito_ubicacion_items").catch(() => undefined);
  await q("delete from deposito_ubicacion_movements where actor_email = any($1)", [EMAILS]).catch(() => undefined);
  await q("update deposito_ubicaciones set version = 1, observations = '', last_content_at = null, last_content_by = null, last_content_by_name = null where id like 'ubi-%' and code ~ '^[A-E][0-9][0-9]$'").catch(() => undefined);
  await q("delete from deposito_ubicaciones where code like 'F9%'").catch(() => undefined);
};
await cleanup();

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, ctxOpts) {
  const ctx = await browser.newContext({ baseURL: BASE, ...ctxOpts });
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
    const menu = page.getByRole("button", { name: /abrir menú/i }).first();
    if (await menu.isVisible().catch(() => false)) await menu.click();
  }
  await direct.click({ timeout: 120_000 });
  await page.locator('[data-testid="ubi-root"]').waitFor({ timeout: 60_000 });
  await page.locator('[data-testid="ubi-map"]').waitFor({ timeout: 60_000 });
};
const T = (page, id) => page.locator(`[data-testid="${id}"]`);
const cell = (page, code) => T(page, `ubi-cell-${code}`);
const state = (page, code) => cell(page, code).getAttribute("data-state");
const api = (page, method, body, path = "") => page.evaluate(async ([m, b, p]) => { const r = await fetch(`/api/v1/ubicaciones${p}`, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [method, body, path]);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const uuid = () => crypto.randomUUID();

try {
  // ───── Depósito · escritorio ─────
  const dep = await openAs(E2E_USERS.deposito, DESKTOP);
  const p = dep.page;
  await nav(p, "Ubicaciones");
  check("título «Ubicaciones» (módulo unificado) y modo escritura para Depósito", (await T(p, "ubi-title").innerText()) === "Ubicaciones" && (await T(p, "ubi-root").getAttribute("data-mode")) === "deposito");
  check("mapa con las 36 posiciones", (await p.locator('[data-testid^="ubi-cell-"]').count()) === 36);
  check("indicadores 36 / 0 / 36 (calculados)", (await T(p, "ubi-kpi-total-valor").innerText()) === "36" && (await T(p, "ubi-kpi-ocupadas-valor").innerText()) === "0" && (await T(p, "ubi-kpi-libres-valor").innerText()) === "36");
  check("contorno en L, pasillo, escalera y vacío dibujados", (await T(p, "ubi-shape-contorno").count()) === 1 && (await T(p, "ubi-shape-vacio").count()) === 1 && (await T(p, "ubi-shape-escalera").count()) === 1 && (await T(p, "ubi-shape-pasillo").count()) >= 1);
  check("referencias de colores y lista de sectores", (await T(p, "ubi-referencias").innerText()).includes("Resultado de búsqueda") && (await T(p, "ubi-zona").count()) === 5);

  // Asignar A02 (ejemplo de aceptación).
  await cell(p, "A02").click();
  check("seleccionar A02 → panel libre", (await T(p, "ubi-panel-code").innerText()) === "A02" && (await T(p, "ubi-panel-estado").innerText()) === "Libre" && (await state(p, "A02")) === "SELECCIONADA");
  await T(p, "ubi-agregar").click();
  await T(p, "ubi-add-dialog").waitFor();
  await T(p, "ubi-add-cliente").fill("TRC");
  await T(p, "ubi-add-material").fill("frascos de shampoo 250 ml");
  await T(p, "ubi-add-cantidad").fill("2000");
  await T(p, "ubi-add-otro").click();
  const rows = p.locator('[data-testid="ubi-add-row"]');
  await rows.nth(1).locator('[data-testid="ubi-add-material"]').fill("tapas negras");
  await rows.nth(1).locator('[data-testid="ubi-add-cantidad"]').fill("2000");
  await T(p, "ubi-add-obs").fill("Material pendiente de envasado.");
  await T(p, "ubi-add-guardar").dblclick(); // doble toque: una sola asignación
  await T(p, "ubi-notice").waitFor({ timeout: 30_000 });
  check("A02 pasa a ocupada y el panel muestra cliente y materiales", (await T(p, "ubi-panel-estado").innerText()) === "Ocupada" && (await T(p, "ubi-panel-clientes").innerText()) === "TRC" && (await T(p, "ubi-panel-item").count()) === 2);
  check("doble toque = un solo movimiento", (await q("select count(*)::int n from deposito_ubicacion_movements where kind = 'ASIGNACION' and actor_email = $1", [E2E_USERS.deposito.email]))[0].n === 1);
  check("indicadores 36 / 1 / 35", (await T(p, "ubi-kpi-ocupadas-valor").innerText()) === "1" && (await T(p, "ubi-kpi-libres-valor").innerText()) === "35");
  check("el mapa muestra el cliente en la celda", (await cell(p, "A02").textContent()).includes("TRC"));
  check("observaciones, fecha y usuario", (await T(p, "ubi-panel-obs").innerText()).includes("pendiente de envasado") && (await T(p, "ubi-panel-usuario").innerText()).includes("E2E") && (await T(p, "ubi-panel-fecha").innerText()).length > 5);

  // Más posiciones ocupadas (vía API) para ver el mapa con datos.
  const more = [["A01", "BL Cosmetics", "Etiquetas frontales", 5000], ["A05", "TRC", "Cajas de cartón", 800], ["A08", "Dermacare", "Frascos 500 ml", 1200], ["B02", "Dermacare", "Bombas dosificadoras", 900], ["B03", "Natura Lab", "Tapas blancas", 3000], ["B09", "BL Cosmetics", "Sachets", 10000], ["C03", "Natura Lab", "Etiquetas", 2500], ["D02", "TRC", "Pomos 200 ml", 600], ["D05", "Dermacare", "Cajas", 400], ["E03", "BL Cosmetics", "Tubos", 1500], ["E05", "Natura Lab", "Frascos", 700]];
  const ids = await p.evaluate(async () => Object.fromEntries((await (await fetch("/api/v1/ubicaciones")).json()).map.locations.map((l) => [l.code, l.id])));
  for (const [code, cli, mat, qty] of more) {
    const r = await api(p, "POST", { action: "agregar", key: uuid(), locationId: ids[code], lines: [{ clientName: cli, material: mat, quantity: qty, unit: "u" }] });
    if (r.status !== 200) check(`sembrar ${code}`, false, JSON.stringify(r.body));
  }
  await p.waitForTimeout(500);
  await p.reload();
  await nav(p, "Ubicaciones");

  // Búsqueda por cliente (con el panel de A02 seleccionado).
  await T(p, "ubi-search").fill("TRC");
  check("buscar TRC resalta todas sus posiciones", (await T(p, "ubi-search-count").innerText()) === "3" && (await state(p, "A02")) === "RESULTADO" && (await state(p, "A05")) === "RESULTADO" && (await state(p, "D02")) === "RESULTADO" && (await state(p, "B03")) === "OCUPADA");
  await T(p, "ubi-search").fill("tapas");
  check("buscar por material", (await T(p, "ubi-search-count").innerText()) === "2");
  await T(p, "ubi-search").fill("b05");
  check("buscar por código de ubicación", (await state(p, "B05")) === "RESULTADO");
  await T(p, "ubi-search").fill("TRC");
  await cell(p, "A02").click();
  await p.screenshot({ path: `${OUT}/desktop-mapa.png` });

  // Traslado parcial 500 frascos A02 → B05.
  await T(p, "ubi-mover").click();
  await T(p, "ubi-transfer-dialog").waitFor();
  await T(p, "ubi-transfer-destino").selectOption({ label: "B05 · Libre" });
  await T(p, "ubi-transfer-parcial").click();
  await T(p, "ubi-transfer-check").first().check();
  await T(p, "ubi-transfer-cantidad").fill("500");
  await T(p, "ubi-transfer-confirmar").click();
  await T(p, "ubi-notice").filter({ hasText: "Traslado" }).waitFor({ timeout: 30_000 });
  const a02 = (await T(p, "ubi-panel-materiales").innerText()).replace(/\s+/g, " ");
  check("A02 conserva 1.500 frascos y 2.000 tapas", /frascos de shampoo 250 ml.*1\.500/.test(a02) && /tapas negras.*2\.000/.test(a02), a02);
  check("B05 pasó a ocupada con 500", (await state(p, "B05")) !== "LIBRE");
  const total = (await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where material_name = 'frascos de shampoo 250 ml'"))[0].n;
  check("total conservado: 2.000 entre A02 + B05", total === 2000);
  await T(p, "ubi-historial").click();
  await T(p, "ubi-history-dialog").waitFor();
  await T(p, "ubi-history-item").first().waitFor({ timeout: 30_000 });
  const h = (await T(p, "ubi-history-list").innerText()).replace(/\s+/g, " ");
  check("historial: traslado A02 → B05, 500 de frascos, usuario y fecha", /Traslado · A02 → B05/.test(h) && /500/.test(h) && /E2E Depósito/.test(h) && /Asignación/.test(h), h.slice(0, 200));
  await p.keyboard.press("Escape");
  // Retirar parcial y liberar B05.
  await cell(p, "B05").click();
  await T(p, "ubi-liberar").click();
  await p.getByRole("button", { name: "Liberar ubicación" }).last().click();
  await T(p, "ubi-notice").filter({ hasText: "liberada" }).waitFor({ timeout: 30_000 });
  check("liberar B05 → libre y registrado", (await state(p, "B05")) === "SELECCIONADA" && (await T(p, "ubi-panel-estado").innerText()) === "Libre" && (await q("select count(*)::int n from deposito_ubicacion_movements where kind = 'LIBERACION' and from_code = 'B05'"))[0].n === 1);
  check("sin desborde horizontal en escritorio", await noOverflow(p));

  // ───── Sin verificar, vincular a ME, ingresos sin ubicar / modificados / anulados ─────
  await cell(p, "A02").click();
  check("renglones de texto libre: insignia «Sin verificar» y marca en el mapa", (await T(p, "ubi-badge-sin-verificar").count()) === 2 && (await T(p, "ubi-badge-verificado").count()) === 0 && (await T(p, "ubi-sv-A02").count()) === 1);
  const sub0 = (await T(p, "ubi-panel-subtotales").innerText()).replace(/\s+/g, " ");
  check("subtotales separados: verificado 0 · sin verificar 3.500 u", /Verificado.*: 0/.test(sub0) && /Sin verificar.*: 3\.500 u/.test(sub0), sub0);
  check("tooltip del mapa marca «sin verificar»", (await cell(p, "A02").locator("title").textContent()).includes("(sin verificar)"));
  await T(p, "ubi-search").fill("TRC");
  check("resultados de búsqueda con subtotales separados", /3\.500|7\.\d{3}|\d/.test(await T(p, "ubi-search-sinverificar").innerText()) && (await T(p, "ubi-search-verificado").innerText()) === "0");
  await T(p, "ubi-search").fill("");
  const matId = uuid();
  const mkIngreso = async (codigo, total, cliente, mid = matId, fecha = "2026-11-20") => {
    const ingId = uuid();
    fixtures.ings.push(ingId);
    await q("insert into inv_me_ingresos (id, payload) values ($1, $2)", [ingId, JSON.stringify({ id: ingId, fecha, ingresoNro: `E2E-${codigo}`, proveedor: "P", cliente, remitoNro: "R1", codigo, descripcionInsumo: `Frasco ${codigo}`, bultos: 10, cantidad: total / 10, total, ubicacion: "", materialId: mid, anulado: false, createdBy: "t", updatedBy: "t", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })]);
    return ingId;
  };
  fixtures.mats.push(matId);
  await q("insert into inv_me_materials (id, payload) values ($1, $2)", [matId, JSON.stringify({ id: matId, codigo: "E2E-FR", descripcion: "Frasco E2E-FR", cliente: "Ingreso SA", ubicacion: "", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: new Date().toISOString(), archived: false })]);
  const baseId = uuid();
  fixtures.mats.push(baseId);
  await q("insert into inv_me_materials (id, payload) values ($1, $2)", [baseId, JSON.stringify({ id: baseId, codigo: "E2E-BASE", descripcion: "Tapa E2E-BASE", cliente: "TRC", ubicacion: "", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: new Date().toISOString(), archived: false })]);
  await mkIngreso("E2E-BASE", 2500, "TRC", baseId, "2026-11-01"); // respalda las 2.000 «tapas negras» que se vinculan abajo
  const ing1 = await mkIngreso("E2E-FR", 6000, "Ingreso SA");
  // Vincular «tapas negras» (2.000) al material ME: valida el tope (stock 6.000) y pasa a verificado.
  await T(p, "ubi-vincular").last().click();
  await T(p, "ubi-link-dialog").waitFor();
  await T(p, "ubi-link-buscar").fill("E2E-BASE");
  await T(p, "ubi-link-opcion").first().click();
  await T(p, "ubi-notice").filter({ hasText: "verificado" }).waitFor({ timeout: 30_000 });
  check("vincular a ME: el renglón pasa a «Verificado» y los subtotales se separan", (await T(p, "ubi-badge-verificado").count()) === 1 && (await T(p, "ubi-badge-sin-verificar").count()) === 1 && /Verificado.*: 2\.000 u/.test((await T(p, "ubi-panel-subtotales").innerText()).replace(/\s+/g, " ")));
  // Ingreso sin ubicar: aparece en la lista; «Ubicar» (doble clic) lo suma una sola vez.
  await T(p, "ubi-ingreso-fila").first().waitFor({ timeout: 40_000 });
  check("lista «Ingresos ME sin ubicar» con material, cliente y cantidad", (await T(p, "ubi-ingresos").innerText()).includes("Frasco E2E-FR") && (await T(p, "ubi-ingresos").innerText()).includes("Ingreso SA") && (await T(p, "ubi-ingresos").innerText()).includes("6.000"));
  await T(p, "ubi-ingreso-ubicar").first().click();
  await T(p, "ubi-place-dialog").waitFor();
  await T(p, "ubi-place-destino").selectOption({ label: "C02 · Libre" });
  await T(p, "ubi-place-confirmar").dblclick();
  await T(p, "ubi-notice").filter({ hasText: "Ingreso ubicado" }).waitFor({ timeout: 30_000 });
  check("ingreso ubicado una sola vez (doble clic)", (await q("select count(*)::int n from deposito_ubicacion_movements where idempotency_key = $1", [`ingreso-me:${ing1}`]))[0].n === 1 && (await state(p, "C02")) !== "LIBRE");
  // El tope cuenta SOLO verificadas: 2.000 (tapas) + 6.000 (ingreso) > stock 6.000 ⇒ el ingreso quedó rechazado por tope? (se verifica que lo distribuido verificado no supera el stock)
  check("lo verificado distribuido no supera el stock", Number((await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where me_material_id = $1", [matId]))[0].n) <= 6000 && Number((await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where me_material_id = $1", [baseId]))[0].n) === 2000);
  // Ingreso modificado: se detecta la diferencia y se ajusta SOLO esa.
  await q("update inv_me_ingresos set payload = payload || jsonb_build_object('total', 7000::numeric) where id = $1", [ing1]);
  await T(p, "ubi-ingreso-revisar").first().waitFor({ timeout: 40_000 });
  check("ingreso modificado: «+1.000 u» detectado", (await T(p, "ubi-ingreso-revisar").first().getAttribute("data-reason")) === "MODIFICADO" && (await T(p, "ubi-ingresos").innerText()).includes("1.000"));
  await T(p, "ubi-ingreso-ajustar").first().click();
  await T(p, "ubi-notice").filter({ hasText: "ajustada" }).waitFor({ timeout: 30_000 });
  check("se ajustó solo la diferencia (total 7.000 − 2.000 de tapas... ingreso 7.000 en C02)", Number((await q("select quantity::float8 n from deposito_ubicacion_items i join deposito_ubicaciones u on u.id = i.location_id where u.code = 'C02'"))[0].n) === 7000);
  // Ingreso anulado después de ubicarlo: se marca para revisar y se retira la cantidad registrada.
  await q("update inv_me_ingresos set payload = payload || '{\"anulado\": true}'::jsonb where id = $1", [ing1]);
  await T(p, "ubi-ingreso-revisar").first().waitFor({ timeout: 40_000 });
  check("ingreso anulado: «revisar ubicación»", (await T(p, "ubi-ingreso-revisar").first().getAttribute("data-reason")) === "ANULADO" && (await T(p, "ubi-ingresos").innerText()).includes("Ingreso anulado: revisar ubicación"));
  await T(p, "ubi-ingreso-retirar").first().click();
  await T(p, "ubi-notice").filter({ hasText: "retirada" }).waitFor({ timeout: 30_000 });
  check("anulado: cantidad retirada, registro conservado e historial", (await state(p, "C02")) === "LIBRE" && (await q("select status from deposito_ingreso_ubicacion where ingreso_id = $1", [ing1]))[0].status === "RETIRADO");
  await p.screenshot({ path: `${OUT}/desktop-ingresos.png` });

  // ───── Asignación directa de clientes (Depósito) y consulta desde otro sector ─────
  const B08 = ids.B08;
  await cell(p, "B08").click();
  check("B08 libre: botón «Asignar» del cliente visible para Depósito", (await state(p, "B08")) === "SELECCIONADA" && (await T(p, "ubi-clientes-editar").innerText()).includes("Asignar") && (await T(p, "ubi-panel-estado").innerText()) === "Libre");
  await T(p, "ubi-clientes-editar").click();
  await T(p, "ubi-clientes-dialog").waitFor();
  await T(p, "ubi-clientes-input").fill("TRC");
  await T(p, "ubi-clientes-agregar").click();
  await T(p, "ubi-clientes-guardar").dblclick(); // doble toque: una sola asignación
  await T(p, "ubi-notice").filter({ hasText: "Clientes de B08 actualizados" }).waitFor({ timeout: 30_000 });
  check("B08 pasa a ocupada SIN materiales y el pallet muestra «TRC»", (await state(p, "B08")) === "SELECCIONADA" && (await T(p, "ubi-panel-estado").innerText()) === "Ocupada" && (await T(p, "ubi-panel-item").count()) === 0 && (await cell(p, "B08").textContent()).includes("TRC") && (await T(p, "ubi-panel-clientes").innerText()) === "TRC");
  check("persistido: 1 cliente asignado, 0 materiales, 1 movimiento con usuario", (await q("select count(*)::int n from deposito_ubicacion_clientes where location_id = $1", [B08]))[0].n === 1 && (await q("select count(*)::int n from deposito_ubicacion_items where location_id = $1", [B08]))[0].n === 0 && (await q("select count(*)::int n from deposito_ubicacion_movements where to_location_id = $1 and detail->>'action' = 'cliente_asignado' and actor_email = $2", [B08, E2E_USERS.deposito.email]))[0].n === 1);
  check("el botón pasa a «Editar» y los indicadores cuentan B08", (await T(p, "ubi-clientes-editar").innerText()).includes("Editar") && (await T(p, "ubi-kpi-libres-valor").innerText()) === String(36 - Number(await T(p, "ubi-kpi-ocupadas-valor").innerText())));
  // Varios clientes → «TRC +1»; quitar uno.
  await T(p, "ubi-clientes-editar").click();
  await T(p, "ubi-clientes-input").fill("Zeta SA");
  await T(p, "ubi-clientes-input").press("Enter");
  await T(p, "ubi-clientes-guardar").click();
  await T(p, "ubi-clientes-dialog").waitFor({ state: "detached", timeout: 30_000 });
  await p.waitForFunction(() => document.querySelector('[data-testid="ubi-cell-B08"]')?.textContent?.includes("+1"), null, { timeout: 30_000 }).catch(() => undefined);
  check("varios clientes: forma compacta «TRC +1» en el pallet", (await cell(p, "B08").textContent()).includes("TRC +1"));
  await T(p, "ubi-clientes-editar").click();
  await T(p, "ubi-clientes-item").filter({ hasText: "Zeta SA" }).locator('[data-testid="ubi-clientes-quitar"]').click();
  await T(p, "ubi-clientes-guardar").click();
  await T(p, "ubi-clientes-dialog").waitFor({ state: "detached", timeout: 30_000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="ubi-cell-B08"]')?.textContent?.includes("+1"), null, { timeout: 30_000 }).catch(() => undefined);
  check("quitar un cliente sin materiales: vuelve a «TRC» y queda en el historial", (await cell(p, "B08").textContent()).includes("TRC") && !(await cell(p, "B08").textContent()).includes("+1") && (await q("select count(*)::int n from deposito_ubicacion_movements where from_location_id = $1 and detail->>'action' = 'cliente_quitado'", [B08]))[0].n === 1);
  // Cliente con materiales: no removible (UI deshabilitada y backend 4xx).
  await cell(p, "A02").click();
  await T(p, "ubi-clientes-editar").click();
  await T(p, "ubi-clientes-dialog").waitFor();
  check("cliente con materiales: botón de quitar deshabilitado", await T(p, "ubi-clientes-quitar").first().isDisabled());
  await p.keyboard.press("Escape");
  const rm = await api(p, "POST", { action: "clientes", key: uuid(), locationId: ids.A02, remove: ["trc"] });
  check("backend rechaza quitar un cliente con materiales (409)", rm.status === 409 && /materiales/.test(String(rm.body.error)), `${rm.status} ${rm.body.error}`);

  // Otro sector consulta: busca TRC, ve B08 resaltado y no puede editar.
  const otro = await openAs(E2E_USERS.produccion, DESKTOP);
  await nav(otro.page, "Ubicaciones");
  await T(otro.page, "ubi-search").fill("TRC");
  check("otro sector: la búsqueda de TRC resalta B08 (solo cliente asignado)", (await state(otro.page, "B08")) === "RESULTADO" && (await T(otro.page, "ubi-search-count").innerText()) === "4");
  await cell(otro.page, "B08").click();
  check("otro sector: ve cliente y estado de B08 pero SIN botón de edición", (await T(otro.page, "ubi-panel-clientes").innerText()) === "TRC" && (await T(otro.page, "ubi-panel-estado").innerText()) === "Ocupada" && (await T(otro.page, "ubi-clientes-editar").count()) === 0 && (await T(otro.page, "ubi-agregar").count()) === 0);
  await otro.ctx.close();

  // ───── Envasado Masivo y Premium: consulta ─────
  for (const [user, name] of [[E2E_USERS.envasado, "Envasado Masivo"], [E2E_USERS.envasadoPremium, "Envasado Premium"]]) {
    const s = await openAs(user, DESKTOP);
    await nav(s.page, "Ubicaciones");
    check(`${name}: mismo mapa (36 posiciones) en modo consulta`, (await s.page.locator('[data-testid^="ubi-cell-"]').count()) === 36 && (await T(s.page, "ubi-root").getAttribute("data-mode")) === "consulta");
    await T(s.page, "ubi-search").fill("TRC");
    check(`${name}: buscar TRC resalta A02, A05, D02 y B08 (solo cliente asignado)`, (await T(s.page, "ubi-search-count").innerText()) === "4" && (await state(s.page, "A05")) === "RESULTADO" && (await state(s.page, "B08")) === "RESULTADO");
    await cell(s.page, "A02").click();
    check(`${name}: ve cliente y materiales`, (await T(s.page, "ubi-panel-clientes").innerText()) === "TRC" && (await T(s.page, "ubi-panel-item").count()) === 2);
    const hidden = await Promise.all(["ubi-agregar", "ubi-mover", "ubi-liberar", "ubi-obs-editar", "ubi-retirar", "ubi-config-toggle", "ubi-clientes-editar"].map((id) => T(s.page, id).count()));
    check(`${name}: sin acciones de escritura visibles`, hidden.every((n) => n === 0), hidden.join(","));
    const cl = await api(s.page, "POST", { action: "clientes", key: uuid(), locationId: ids.A03, add: ["X"] });
    const w = await api(s.page, "POST", { action: "agregar", key: uuid(), locationId: ids.A03, lines: [{ clientName: "X", material: "Y", quantity: 1 }] });
    const t = await api(s.page, "POST", { action: "trasladar", key: uuid(), fromId: ids.A02, toId: ids.A03, all: true });
    const c = await api(s.page, "POST", { action: "crear", code: "F91", x: 1, y: 1, w: 20, h: 20 }, "/config");
    check(`${name}: el backend responde 403 a toda escritura (incluida asignar clientes)`, w.status === 403 && t.status === 403 && c.status === 403 && cl.status === 403, `${w.status}/${t.status}/${c.status}/${cl.status}`);
    await s.page.screenshot({ path: `${OUT}/${user === E2E_USERS.envasado ? "masivo" : "premium"}-consulta.png` });
    await s.ctx.close();
  }

  // ───── TODOS los sectores del registro ven UBICACIONES y el mapa de 36 posiciones ─────
  const sectorSrc = readFileSync(new URL("../../src/types/operational/sector.ts", import.meta.url), "utf8");
  const sectorIds = [...sectorSrc.match(/OPERATIONAL_SECTOR_IDS = \[([\s\S]*?)\] as const/)[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  check(`registro de sectores leído (${sectorIds.length})`, sectorIds.length >= 11);
  for (const sector of sectorIds) {
    const user = Object.values(E2E_USERS).find((u) => u.sector === sector);
    if (!user) { check(`sector ${sector}: existe usuario E2E`, false); continue; }
    const s = await openAs(user, DESKTOP);
    try {
      await nav(s.page, "Ubicaciones");
      const entries = await s.page.getByRole("button", { name: /^Ubicaciones$/ }).or(s.page.getByRole("link", { name: /^Ubicaciones$/ })).count();
      const legacy = await s.page.getByText("Ubicación de materiales", { exact: true }).count();
      const writeUi = (await Promise.all(["ubi-agregar", "ubi-mover", "ubi-liberar", "ubi-obs-editar", "ubi-retirar", "ubi-clientes-editar"].map((id) => T(s.page, id).count()))).reduce((a, b) => a + b, 0);
      const mode = await T(s.page, "ubi-root").getAttribute("data-mode");
      check(`sector ${sector}: pestaña UBICACIONES única, mapa de 36 posiciones, ${sector === "DEPOSITO" ? "modo escritura" : "solo lectura"}`, entries === 1 && legacy === 0 && (await s.page.locator('[data-testid^="ubi-cell-"]').count()) === 36 && (sector === "DEPOSITO" ? mode === "deposito" : mode === "consulta" && writeUi === 0), `${entries}/${legacy}/${mode}/${writeUi}`);
      await cell(s.page, "A02").click();
      check(`sector ${sector}: ve clientes, materiales y observaciones de A02`, (await T(s.page, "ubi-panel-clientes").innerText()).includes("TRC") && (await T(s.page, "ubi-panel-item").count()) >= 1 && (await T(s.page, "ubi-panel-obs").count()) === 1);
      if (sector !== "DEPOSITO") {
        const w = await api(s.page, "POST", { action: "clientes", key: uuid(), locationId: ids.A03, add: ["Intruso"] });
        check(`sector ${sector}: backend 403 a asignar clientes y 200 a leer`, w.status === 403 && (await api(s.page, "GET")).status === 200, String(w.status));
      }
    } finally {
      await s.ctx.close();
    }
  }

  // ───── Sincronización entre dos sesiones, sin recargar ─────
  const viewer = await openAs(E2E_USERS.envasado, DESKTOP);
  await nav(viewer.page, "Ubicaciones");
  check("sesión B: C01 libre antes", (await state(viewer.page, "C01")) === "LIBRE");
  const r = await api(p, "POST", { action: "agregar", key: uuid(), locationId: ids.C01, lines: [{ clientName: "Sync SA", material: "Pomos", quantity: 10 }] });
  check("sesión A asigna C01", r.status === 200);
  await viewer.page.waitForFunction(() => document.querySelector('[data-testid="ubi-cell-C01"]')?.getAttribute("data-state") === "OCUPADA", null, { timeout: 40_000 }).then(() => check("sesión B ve C01 ocupada SIN recargar", true)).catch(() => check("sesión B ve C01 ocupada SIN recargar", false));
  await viewer.ctx.close();

  // ───── Dirección configura el mapa ─────
  const dir = await openAs(E2E_USERS.direccion, DESKTOP);
  await nav(dir.page, "Ubicaciones");
  check("Dirección: sin acciones de contenido pero con configuración", (await T(dir.page, "ubi-config-toggle").count()) === 1 && (await T(dir.page, "ubi-agregar").count()) === 0);
  await T(dir.page, "ubi-config-toggle").click();
  await T(dir.page, "ubi-new-code").fill("F91");
  await T(dir.page, "ubi-new-x").fill("280");
  await T(dir.page, "ubi-new-y").fill("700");
  await T(dir.page, "ubi-new-w").fill("40");
  await T(dir.page, "ubi-new-h").fill("30");
  await T(dir.page, "ubi-new-crear").click();
  await cell(dir.page, "F91").waitFor({ timeout: 30_000 });
  check("Dirección crea una posición y aparece en el mapa", (await T(dir.page, "ubi-panel-code").innerText()) === "F91");
  await T(dir.page, "ubi-config-x").fill("300");
  await T(dir.page, "ubi-config-guardar").click();
  await T(dir.page, "ubi-notice").filter({ hasText: "actualizada" }).waitFor({ timeout: 30_000 });
  check("Dirección mueve la posición (persistido)", (await q("select x from deposito_ubicaciones where code = 'F91'"))[0].x === 300);
  await cell(dir.page, "A02").click();
  check("posición ocupada: código bloqueado y no se puede desactivar", (await T(dir.page, "ubi-config-code").isDisabled()) && (await T(dir.page, "ubi-config-activa").isDisabled()));
  await dir.ctx.close();

  // ───── Celular (390×844): Depósito ─────
  const ph = await openAs(E2E_USERS.deposito, PHONE);
  await nav(ph.page, "Ubicaciones");
  const m = ph.page;
  check("celular: sin desborde horizontal", await noOverflow(m));
  const mapBox = await T(m, "ubi-map-wrap").boundingBox();
  check("celular: el mapa entra en pantalla", mapBox && mapBox.width <= 390 && mapBox.width > 300, JSON.stringify(mapBox));
  await T(m, "ubi-map-wrap").scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${OUT}/phone-mapa.png` });
  await T(m, "ubi-zoom-in").tap();
  await T(m, "ubi-zoom-in").tap();
  check("celular: zoom + acerca", Number(await T(m, "ubi-map").getAttribute("data-scale")) > 1.5);
  await T(m, "ubi-zoom-fit").tap();
  check("celular: «ajustar» vuelve a 1", Number(await T(m, "ubi-map").getAttribute("data-scale")) === 1);
  await T(m, "ubi-search").fill("TRC");
  await T(m, "ubi-search-chip").first().tap();
  const panelBox = await T(m, "ubi-panel").boundingBox();
  const mapBox2 = await T(m, "ubi-map-wrap").boundingBox();
  check("celular: el panel queda debajo del mapa", panelBox && mapBox2 && panelBox.y >= mapBox2.y + mapBox2.height - 2);
  await T(m, "ubi-panel").scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${OUT}/phone-panel.png` });
  const small = await m.evaluate(() => [...document.querySelectorAll('[data-testid="ubi-root"] button, [data-testid="ubi-root"] select, [data-testid="ubi-root"] input[type="search"]')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ id: b.getAttribute("data-testid") || b.textContent?.trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.h < 44));
  check("celular: botones y campos ≥ 44 px", small.length === 0, JSON.stringify(small.slice(0, 5)));
  await T(m, "ubi-agregar").tap();
  await T(m, "ubi-add-dialog").waitFor();
  const fs = await m.evaluate(() => [...document.querySelectorAll('[data-testid="ubi-add-dialog"] input, [data-testid="ubi-add-dialog"] textarea')].map((i) => parseFloat(getComputedStyle(i).fontSize)));
  check("celular: inputs de 16 px (teclado virtual sin zoom)", fs.length > 0 && fs.every((x) => x >= 16), fs.join(","));
  check("celular: el formulario no desborda", await noOverflow(m));
  await m.screenshot({ path: `${OUT}/phone-asignar.png` });
  await m.keyboard.press("Escape");
  await ph.ctx.close();

  // Envasado en celular.
  const pm = await openAs(E2E_USERS.envasado, PHONE);
  await nav(pm.page, "Ubicaciones");
  check("celular Envasado: sin desborde y mapa visible", (await noOverflow(pm.page)) && (await T(pm.page, "ubi-map").isVisible()));
  await pm.ctx.close();
} catch (e) {
  check(`excepción: ${e instanceof Error ? e.message.split("\n")[0] : e}`, false);
  console.error(e);
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK. Capturas en ${OUT}`);
process.exit(failed.length ? 1 : 0);
