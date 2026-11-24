// E2E en Chromium real del módulo INSUMOS: formulario de 3 pasos en celular (390×844) y pestaña de Administración
// (filtros, Excel, anulación). Base DESCARTABLE (marca verificada) y login real. Ver run-insumos-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/insumos-e2e";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const EMAILS = [E2E_USERS.envasado.email, E2E_USERS.codificado.email];
const cleanup = async () => {
  const ids = "select id from insumo_retiros where registrado_por_email = any($1)";
  await q(`delete from insumo_retiro_events where retiro_id in (${ids})`, [EMAILS]).catch(() => undefined);
  await q(`delete from insumo_retiro_items where retiro_id in (${ids})`, [EMAILS]).catch(() => undefined);
  await q("delete from insumo_retiros where registrado_por_email = any($1)", [EMAILS]).catch(() => undefined);
};
await cleanup();
const count = async (email) => (await q("select count(*)::int n from insumo_retiros where registrado_por_email = $1", [email]))[0].n;

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, ctxOpts) {
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true, ...ctxOpts });
  const page = await ctx.newPage();
  debugPages.push(page);
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
};
const T = (page, id) => page.locator(`[data-testid="${id}"]`);
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const tap = (page, id, times = 1) => (async () => { for (let i = 0; i < times; i++) await T(page, id).tap(); })();

try {
  // ───── Celular: Envasado Masivo ─────
  const env = await openAs(E2E_USERS.envasado, PHONE);
  const p = env.page;
  await nav(p, "Insumos");
  await T(p, "insumos-paso-1").waitFor({ timeout: 60_000 });
  const names = await p.locator("[data-testid^=insumo-fila-] span").allTextContents();
  check("paso 1: los seis insumos del catálogo (FILM y STRETCH FILM distintos)", JSON.stringify(names) === JSON.stringify(["PAPEL HIGIENICO", "BOBINA DE PAPEL", "GUANTES", "CINTA", "FILM", "STRETCH FILM"]), names.join("|"));
  const qtys = await p.locator("[data-testid^=insumo-cantidad-]").allTextContents();
  check("todas las cantidades arrancan en 0", qtys.length === 6 && qtys.every((x) => x.trim() === "0"));
  check("SIGUIENTE deshabilitado sin cantidades", await T(p, "insumos-siguiente").isDisabled());
  const sizes = await p.evaluate(() => [...document.querySelectorAll("[data-testid^=insumo-mas-], [data-testid^=insumo-menos-]")].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check("botones −/+ de al menos 44 px", sizes.length === 12 && sizes.every((s) => s >= 44), `mín ${Math.min(...sizes)}`);
  check("sin desborde horizontal en 390 px", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.screenshot({ path: `${OUT}/m-paso1.png` });

  await tap(p, "insumo-mas-guantes", 2);
  await tap(p, "insumo-mas-film", 1);
  await tap(p, "insumo-mas-stretch-film", 3);
  await tap(p, "insumo-menos-stretch-film", 1);
  check("−/+ ajustan y no bajan de 0", (await T(p, "insumo-cantidad-guantes").innerText()) === "2" && (await T(p, "insumo-cantidad-stretch-film").innerText()) === "2" && (await T(p, "insumo-menos-cinta").isDisabled()));
  check("SIGUIENTE se habilita con al menos una cantidad > 0", await T(p, "insumos-siguiente").isEnabled());

  // CANCELAR con cantidades pide confirmación (y SEGUIR CARGANDO conserva todo).
  await T(p, "insumos-cancelar").tap();
  await T(p, "insumos-cancelar-confirmar").waitFor();
  await T(p, "insumos-seguir").tap();
  check("«SEGUIR CARGANDO» conserva lo cargado", (await T(p, "insumo-cantidad-guantes").innerText()) === "2");

  await T(p, "insumos-siguiente").tap();
  await T(p, "insumos-paso-2").waitFor();
  const resp = await p.locator("[data-testid^=responsable-]").allTextContents();
  check("paso 2: solo los responsables de Envasado Masivo", JSON.stringify(resp) === JSON.stringify(["GABO", "NICO Y", "NICO M", "AGUS"]), resp.join("|"));
  check("SIGUIENTE deshabilitado sin responsable", await T(p, "insumos-siguiente").isDisabled());
  await p.screenshot({ path: `${OUT}/m-paso2.png` });
  await T(p, "responsable-envasado-masivo-gabo").tap();
  await T(p, "insumos-siguiente").tap();
  await T(p, "insumos-paso-3").waitFor();
  check("paso 3: muestra sector y responsable", (await T(p, "confirm-sector").innerText()) === "Envasado Masivo" && (await T(p, "confirm-responsable").innerText()) === "GABO");
  const lineas = await T(p, "confirm-lineas").innerText();
  check("paso 3: muestra insumos y cantidades", /GUANTES\s+2/.test(lineas) && /FILM\s+1/.test(lineas) && /STRETCH FILM\s+2/.test(lineas) && !/CINTA/.test(lineas), lineas.replace(/\n/g, " "));
  check("paso 3: REGISTRAR RETIRO, VOLVER y CANCELAR", (await T(p, "insumos-registrar").isVisible()) && (await T(p, "insumos-volver").isVisible()) && (await T(p, "insumos-cancelar").isVisible()));
  await p.screenshot({ path: `${OUT}/m-paso3.png` });

  // Doble toque: un solo retiro.
  await T(p, "insumos-registrar").dblclick();
  await T(p, "insumos-exito").waitFor({ timeout: 30_000 });
  check("mensaje de éxito y formulario reiniciado al paso 1 con todo en 0", (await T(p, "insumos-paso-1").isVisible()) && (await p.locator("[data-testid^=insumo-cantidad-]").allTextContents()).every((x) => x.trim() === "0"));
  await new Promise((r) => setTimeout(r, 800));
  check("el doble toque registró UN solo retiro", (await count(E2E_USERS.envasado.email)) === 1);
  const row = (await q("select r.sector, r.responsable_id, r.responsable_name, r.registrado_por_email, r.status, (select count(*)::int from insumo_retiro_items i where i.retiro_id = r.id) lineas from insumo_retiros r where registrado_por_email = $1", [E2E_USERS.envasado.email]))[0];
  check("persistido: sector, responsable (id estable), usuario que registra y 3 renglones", row?.sector === "ENVASADO_MASIVO" && row.responsable_id === "envasado-masivo-gabo" && row.responsable_name === "GABO" && row.status === "ACTIVO" && row.lineas === 3, JSON.stringify(row));
  await p.screenshot({ path: `${OUT}/m-exito.png` });
  await env.ctx.close();

  // ───── Celular: Codificado (otros responsables) ─────
  const cod = await openAs(E2E_USERS.codificado, PHONE);
  const c = cod.page;
  await nav(c, "Insumos");
  await T(c, "insumos-paso-1").waitFor({ timeout: 60_000 });
  await tap(c, "insumo-mas-cinta", 4);
  await T(c, "insumos-siguiente").tap();
  const respC = await c.locator("[data-testid^=responsable-]").allTextContents();
  check("Codificado ve JULIAN y GABO (solo los suyos)", JSON.stringify(respC) === JSON.stringify(["JULIAN", "GABO"]), respC.join("|"));
  await T(c, "responsable-codificado-gabo").tap();
  await T(c, "insumos-siguiente").tap();
  await T(c, "insumos-registrar").tap();
  await T(c, "insumos-exito").waitFor({ timeout: 30_000 });
  check("Codificado: GABO de Codificado (id propio) registrado", (await q("select responsable_id from insumo_retiros where registrado_por_email = $1", [E2E_USERS.codificado.email]))[0]?.responsable_id === "codificado-gabo");
  await cod.ctx.close();

  // ───── Administración (escritorio) ─────
  const adm = await openAs(E2E_USERS.administracion, { viewport: { width: 1440, height: 900 } });
  const a = adm.page;
  await T(a, "billing-view").waitFor({ timeout: 120_000 });
  await T(a, "billing-tab-insumos").click();
  await T(a, "insumos-admin").waitFor();
  await a.locator("[data-testid^=retiro-]").first().waitFor({ timeout: 30_000 });
  check("Administración ve los retiros recién registrados (sin recargar la app)", (await a.locator("[data-testid^=retiro-][data-status]").count()) >= 2);
  check("KPI: 2 retiros y 9 unidades (2+1+2 de Envasado, 4 de Codificado)", (await T(a, "kpi-retiros").innerText()) === "2" && (await T(a, "kpi-unidades").innerText()) === "9", `${await T(a, "kpi-retiros").innerText()} / ${await T(a, "kpi-unidades").innerText()}`);
  check("hay gráficos y tablas resumen", (await T(a, "grafico-insumos").isVisible()) && (await T(a, "grafico-serie").isVisible()) && (await T(a, "tabla-responsables").isVisible()));
  await a.screenshot({ path: `${OUT}/admin-reportes.png`, fullPage: true });

  await T(a, "insumos-filtro-sector").selectOption("CODIFICADO");
  await a.waitForFunction(() => document.querySelector("[data-testid=kpi-retiros]")?.textContent === "1", null, { timeout: 30_000 });
  check("filtro por sector Codificado: 1 retiro, 4 unidades", (await T(a, "kpi-unidades").innerText()) === "4");
  await T(a, "insumos-filtro-sector").selectOption("");
  await T(a, "insumos-filtro-insumo").selectOption("film");
  await a.waitForFunction(() => document.querySelector("[data-testid=kpi-unidades]")?.textContent === "1", null, { timeout: 30_000 });
  check("filtro por insumo FILM: solo FILM (1 unidad), sin mezclar STRETCH FILM", true);
  await T(a, "insumos-filtro-insumo").selectOption("");
  await T(a, "insumos-preset-hoy").click();
  await a.waitForFunction(() => document.querySelector("[data-testid=kpi-retiros]")?.textContent === "2", null, { timeout: 30_000 });
  check("atajo «Hoy» incluye los retiros de hoy", true);

  const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 30_000 }), T(a, "insumos-exportar").click()]);
  check("exporta a Excel (.xlsx)", /^insumos-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // Anular: motivo obligatorio, queda marcado y deja de sumar.
  const envRow = a.locator("[data-testid^=retiro-]", { hasText: "GABO" }).filter({ hasText: "Envasado Masivo" }).first();
  await envRow.locator("[data-testid=retiro-anular]").click();
  check("anular exige motivo", await T(a, "anular-confirmar").isDisabled());
  await T(a, "anular-motivo").fill("Carga duplicada de prueba");
  await T(a, "anular-confirmar").click();
  await T(a, "insumos-admin-aviso").waitFor({ timeout: 30_000 });
  await a.waitForFunction(() => document.querySelector("[data-testid=kpi-retiros]")?.textContent === "1", null, { timeout: 30_000 });
  check("el anulado sale de los totales y queda marcado en el historial", (await a.locator("[data-status=ANULADO]").count()) === 1 && (await T(a, "kpi-unidades").innerText()) === "4");
  await a.locator("[data-status=ANULADO] [data-testid=retiro-auditoria]").click();
  await T(a, "insumos-dialogo-auditoria").waitFor();
  await a.locator("[data-testid=evento-retiro]").nth(1).waitFor({ timeout: 15_000 }).catch(() => undefined);
  check("auditoría: eventos CREADO y ANULADO con motivo", (await a.locator("[data-testid=evento-retiro]").count()) === 2 && /Carga duplicada de prueba/.test(await T(a, "insumos-dialogo-auditoria").innerText()));
  await a.keyboard.press("Escape");

  // Catálogo editable.
  await T(a, "insumos-tab-catalogo").click();
  await T(a, "catalogo-insumo-nuevo").fill("BOLSAS E2E");
  await T(a, "catalogo-insumo-agregar").click();
  await T(a, "catalogo-insumo-bolsas-e2e").waitFor({ timeout: 30_000 });
  check("catálogo: alta de un insumo desde la pantalla", true);
  await T(a, "catalogo-insumo-bolsas-e2e").locator("[data-testid=catalogo-insumo-baja]").click();
  await a.waitForFunction(() => /de baja/.test(document.querySelector("[data-testid=catalogo-insumo-bolsas-e2e]")?.textContent ?? ""), null, { timeout: 30_000 });
  check("catálogo: baja lógica", true);
  await a.screenshot({ path: `${OUT}/admin-catalogo.png`, fullPage: true });
  await adm.ctx.close();
} catch (e) {
  check("ejecución sin errores", false, String(e?.stack ?? e).slice(0, 900));
  for (const [i, pg] of debugPages.entries()) {
    await pg.screenshot({ path: `${OUT}/debug-${i}.png`, fullPage: true }).catch(() => undefined);
    console.log(`[debug ${i}] ${pg.url()} :: ${(await pg.locator("body").innerText().catch(() => "")).slice(0, 600).replace(/\n+/g, " | ")}`);
  }
} finally {
  await q("delete from insumo_items where id = 'bolsas-e2e'").catch(() => undefined);
  await cleanup();
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} chequeos OK`);
process.exit(failed.length ? 1 : 0);
