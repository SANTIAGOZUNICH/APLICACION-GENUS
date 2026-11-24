// E2E en Chromium real — CAJAS GENUS. Base DESCARTABLE; login real; sin tocar nada fuera del entorno de prueba.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/cajas-genus";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const { defaultBrowserType: _i, ...PHONE } = devices["Pixel 7"];
void _i;

async function openAs(user, opts = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, ...(opts.phone ? { ...PHONE, viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } }), ...(opts.reducedMotion ? { reducedMotion: "reduce" } : {}) });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
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
const stockOf = async (api) => (await (await api.get("/api/v1/cajas-genus?view=summary")).json()).summary?.stock;
const tabAlert = (page) => page.locator("[data-testid=billing-tab-cajas]").getAttribute("data-alert");

try {
  // Estado limpio (base descartable)
  await q("delete from cajas_genus_audit");
  await q("delete from cajas_genus_line_review");
  await q("delete from cajas_genus_movements");
  await q("delete from os_notifications where kind = 'cajas_genus_critico'");
  await q("update cajas_genus_config set alert_state = 'NORMAL', alert_episode = 0, alert_since = null");

  // ===== Depósito (celular): INGRESO DE CAJAS GENUS =====
  const dep = await openAs(E2E_USERS.deposito, { phone: true });
  const dp = dep.page;
  await nav(dp, "Ingreso de Cajas Genus");
  await dp.locator("[data-testid=cajas-ingreso-planilla]").waitFor({ timeout: 120_000 });
  const fecha = await dp.locator("[data-testid=cajas-ingreso-fecha]").first().inputValue();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  check("Ingreso: FECHA con la fecha actual por defecto e INSUMO fijo «CAJAS GENUS»", fecha === today && (await dp.locator("input[aria-label=Insumo]").first().inputValue()) === "CAJAS GENUS");
  check("Ingreso: sin datos no se puede confirmar", await dp.locator("[data-testid=cajas-ingreso-confirmar]").isDisabled());
  await dp.locator("[data-testid=cajas-ingreso-bultos]").first().fill("10");
  await dp.locator("[data-testid=cajas-ingreso-cantidad]").first().fill("50");
  check("Ingreso: TOTAL = BULTOS × CANTIDAD (10 × 50 = 500) calculado al instante", (await dp.locator("[data-testid=cajas-ingreso-total]").first().innerText()).replace(/\D/g, "") === "500");
  const m = await dp.evaluate(() => ({ h: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll("[data-testid=cajas-ingreso-planilla] input:not([readonly])")].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16 || e.getBoundingClientRect().height < 43.5).length }));
  check("Ingreso (celular 390 px): sin desplazamiento horizontal y campos de 16 px / ≥44 px", m.h <= 1 && m.small === 0, JSON.stringify(m));
  await dp.screenshot({ path: `${OUT}/01-deposito-ingreso-mobile.png`, fullPage: true });
  await dp.locator("[data-testid=cajas-ingreso-confirmar]").evaluate((b) => { b.click(); b.click(); }); // doble toque
  await dp.locator("[data-testid=cajas-ingreso-ok]").waitFor({ timeout: 30_000 });
  check("Ingreso confirmado: mensaje «+500 cajas» y el formulario se reinicia", /\+500/.test(await dp.locator("[data-testid=cajas-ingreso-ok]").innerText()) && (await dp.locator("[data-testid=cajas-ingreso-bultos]").first().inputValue()) === "");
  check("Ingreso: el doble toque NO duplica (un solo movimiento de +500)", Number((await q("select count(*)::int n from cajas_genus_movements where kind = 'INGRESO' and delta = 500"))[0].n) === 1);
  check("Ingreso: queda en el historial de Depósito", (await dp.locator("[data-testid=cajas-ingreso-hist]").count()) === 1);
  const ra = dep.page.request;
  check("Permisos (backend): Depósito no ve reportes ni establece stock inicial", (await ra.get("/api/v1/cajas-genus?view=report")).status() === 403 && (await ra.post("/api/v1/cajas-genus", { data: { action: "set_initial", quantity: 5, key: "x" } })).status() === 403);
  const env = await openAs(E2E_USERS.envasado);
  check("Permisos (backend): Envasado no accede a las cajas Genus ni registra ingresos", (await env.page.request.get("/api/v1/cajas-genus?view=summary")).status() === 403 && (await env.page.request.post("/api/v1/cajas-genus", { data: { action: "register_ingresos", rows: [{ bultos: 1, cantidad: 1, key: "k" }] } })).status() === 403);
  await env.ctx.close();

  // ===== Administración: pestaña CAJAS GENUS =====
  const adm = await openAs(E2E_USERS.administracion);
  const ap = adm.page;
  await ap.locator("[data-testid=billing-tab-cajas]").waitFor({ timeout: 120_000 });
  check("Administración: pestañas INSUMOS y CAJAS GENUS junto a Facturación (sin módulo paralelo)", (await ap.locator("[data-testid=billing-tab-insumos]").count()) === 1 && (await ap.locator("[data-testid=billing-tab-control]").count()) === 1);
  await ap.locator("[data-testid=billing-tab-cajas]").click();
  await ap.locator("[data-testid=cajas-admin]").waitFor();
  await ap.locator("[data-testid=cajas-sin-inicial]").waitFor({ timeout: 30_000 }).catch(() => undefined);
  check("Sin stock inicial configurado: aviso, sin stock calculado y SIN alerta", (await ap.locator("[data-testid=cajas-sin-inicial]").count()) === 1 && (await tabAlert(ap)) == null && (await ap.locator("[data-testid=cajas-alerta]").count()) === 0);
  check("Total de ingresos visible (500) aunque no haya stock inicial", (await ap.locator("[data-testid=cajas-total-ingresos]").innerText()).replace(/\D/g, "") === "500");
  await ap.locator("[data-testid=cajas-inicial-cantidad]").fill("1000");
  await ap.locator("[data-testid=cajas-inicial-guardar]").click();
  await ap.locator("[data-testid=cajas-inicial-confirmar]").click();
  await ap.locator("[data-testid=cajas-stock-actual] >> text=1.000").waitFor({ timeout: 30_000 });
  check("Stock inicial 1.000: el stock actual sale del backend (los ingresos previos al conteo no se suman de nuevo) y no hay alerta", (await stockOf(ap.request)) === 1000 && (await tabAlert(ap)) == null);

  // Ingreso desde Depósito → Administración lo ve SIN recargar (polling)
  await dp.locator("[data-testid=cajas-ingreso-bultos]").first().fill("2");
  await dp.locator("[data-testid=cajas-ingreso-cantidad]").first().fill("50");
  await dp.locator("[data-testid=cajas-ingreso-confirmar]").click();
  await dp.locator("[data-testid=cajas-ingreso-ok]").waitFor({ timeout: 30_000 });
  await ap.locator("[data-testid=cajas-stock-actual] >> text=1.100").waitFor({ timeout: 45_000 });
  check("Actualización automática: el ingreso de Depósito (+100) aparece en Administración sin recargar", true);

  // Bajar a 300 → alerta roja, titila, visible desde otras pestañas
  await ap.locator("[data-testid=cajas-ajuste] button", { hasText: "Restar" }).click();
  await ap.locator("[data-testid=cajas-ajuste-cantidad]").fill("800");
  await ap.locator("[data-testid=cajas-ajuste-motivo]").fill("prueba E2E");
  await ap.locator("[data-testid=cajas-ajuste-guardar]").click();
  await ap.locator("[data-testid=cajas-alerta]").waitFor({ timeout: 30_000 });
  check("Stock 300 (≤300): alerta crítica con la cantidad y el aviso de reposición", /300/.test(await ap.locator("[data-testid=cajas-alerta]").innerText()) && /reposición/.test(await ap.locator("[data-testid=cajas-alerta]").innerText()));
  const tab = ap.locator("[data-testid=billing-tab-cajas]");
  const st = await tab.evaluate((el) => { const c = getComputedStyle(el); return { alert: el.getAttribute("data-alert"), bg: c.backgroundColor, anim: c.animationName, icon: Boolean(el.querySelector("svg")), txt: el.innerText }; });
  check("La pestaña CAJAS GENUS se pone roja, con ícono de advertencia, cantidad y animación suave", st.alert === "true" && /rgb\((220|185), (38|28), (38|28)/.test(st.bg) && st.icon && /300/.test(st.txt) && st.anim.includes("cajas-tab-blink"), JSON.stringify(st));
  await ap.locator("[data-testid=billing-tab-control]").click();
  await ap.locator("[data-testid=billing-tab-insumos]").click();
  check("La alerta sigue visible aunque se esté en Facturación / Insumos", (await tabAlert(ap)) === "true");
  await ap.screenshot({ path: `${OUT}/02-admin-alerta.png` });
  const n1 = await q("select message, sectors, href from os_notifications where kind = 'cajas_genus_critico'");
  check("Notificación interna única: texto exacto, para Administración, abre CAJAS GENUS", n1.length === 1 && n1[0].message === "STOCK CRÍTICO DE CAJAS GENUS. Quedan solamente 300 cajas disponibles. Es necesario realizar una reposición" && JSON.stringify(n1[0].sectors) === '["ADMINISTRACION"]' && n1[0].href === "/cajas-genus", JSON.stringify(n1.map((r) => r.message)));

  // Movimiento reducido: sigue roja, sin animación
  const rm = await openAs(E2E_USERS.administracion, { reducedMotion: true });
  await rm.page.locator("[data-testid=billing-tab-cajas]").waitFor({ timeout: 120_000 });
  await rm.page.locator("[data-testid=cajas-tab-stock]").waitFor({ timeout: 30_000 });
  const st2 = await rm.page.locator("[data-testid=billing-tab-cajas]").evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, anim: c.animationName }; });
  check("Movimiento reducido: la pestaña sigue roja pero SIN animación", st2.bg === "rgb(220, 38, 38)" && st2.anim === "none", JSON.stringify(st2));
  // Notificación: al tocarla abre CAJAS GENUS
  await rm.page.locator('button[aria-label^="Notificaciones"]').first().click();
  await rm.page.locator("[data-testid=bell-open-work]", { hasText: "CAJAS GENUS" }).first().click();
  await rm.page.locator("[data-testid=cajas-admin]").waitFor({ timeout: 30_000 });
  check("Al tocar la notificación se abre directamente la pestaña CAJAS GENUS", true);
  await rm.ctx.close();

  // Sin duplicados mientras siga crítico; reposición desactiva; vuelve a bajar → nueva notificación
  await ap.locator("[data-testid=billing-tab-cajas]").click();
  await ap.locator("[data-testid=cajas-ajuste] button", { hasText: "Restar" }).click();
  await ap.locator("[data-testid=cajas-ajuste-cantidad]").fill("1");
  await ap.locator("[data-testid=cajas-ajuste-motivo]").fill("otro");
  await ap.locator("[data-testid=cajas-ajuste-guardar]").click();
  await ap.locator("[data-testid=cajas-stock-actual] >> text=299").waitFor({ timeout: 30_000 });
  check("Sigue crítico (299): no se genera otra notificación", Number((await q("select count(*)::int n from os_notifications where kind = 'cajas_genus_critico'"))[0].n) === 1);
  await dp.locator("[data-testid=cajas-ingreso-bultos]").first().fill("10");
  await dp.locator("[data-testid=cajas-ingreso-cantidad]").first().fill("50");
  await dp.locator("[data-testid=cajas-ingreso-confirmar]").click();
  await dp.locator("[data-testid=cajas-ingreso-ok]").waitFor({ timeout: 30_000 });
  await ap.locator("[data-testid=cajas-stock-actual] >> text=799").waitFor({ timeout: 45_000 });
  await ap.waitForFunction(() => document.querySelector("[data-testid=billing-tab-cajas]")?.getAttribute("data-alert") == null, null, { timeout: 30_000 });
  check("La reposición de Depósito (> 300) desactiva la alerta sin recargar y restaura el diseño normal", (await ap.locator("[data-testid=cajas-alerta]").count()) === 0);
  await ap.locator("[data-testid=cajas-ajuste] button", { hasText: "Restar" }).click();
  await ap.locator("[data-testid=cajas-ajuste-cantidad]").fill("500");
  await ap.locator("[data-testid=cajas-ajuste-motivo]").fill("de nuevo");
  await ap.locator("[data-testid=cajas-ajuste-guardar]").click();
  await ap.locator("[data-testid=cajas-alerta]").waitFor({ timeout: 30_000 });
  check("Al volver a ≤300 se genera una NUEVA alerta/notificación", Number((await q("select count(*)::int n from os_notifications where kind = 'cajas_genus_critico'"))[0].n) === 2);

  // Historial, filtros y Excel
  const rows = await ap.locator("[data-testid=cajas-mov]").count();
  check("Historial con ingresos, ajustes y saldo acumulado", rows >= 5 && (await ap.locator("[data-testid=cajas-mov][data-kind=INGRESO]").count()) >= 3);
  await ap.locator("[data-testid=cajas-tipo-AJUSTES]").click();
  check("Filtro por tipo de movimiento (ajustes)", (await ap.locator("[data-testid=cajas-mov][data-kind=INGRESO]").count()) === 0 && (await ap.locator("[data-testid=cajas-mov]").count()) >= 3);
  await ap.locator("[data-testid=cajas-tipo-TODOS]").click();
  const [dl] = await Promise.all([ap.waitForEvent("download", { timeout: 30_000 }), ap.locator("[data-testid=cajas-excel]").click()]);
  check("Exportar a Excel respetando los filtros", /^cajas-genus-\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const cli = await ap.locator("[data-testid=cajas-cliente]").allInnerTexts();
  check("Clientes con cajas propias: los seis iniciales en SI", ["BIOESENCIA", "ORIGINAL BLACK", "TRC", "JACTANS", "BL COSMETICS", "BAHIA EVANS"].every((n) => cli.some((t) => t.includes(n) && /SI/.test(t))), cli.join(" | ").slice(0, 200));
  await ap.screenshot({ path: `${OUT}/03-admin-cajas.png`, fullPage: true });
  const mob = await openAs(E2E_USERS.administracion, { phone: true });
  await mob.page.locator("[data-testid=billing-tab-cajas]").click({ timeout: 120_000 });
  await mob.page.locator("[data-testid=cajas-admin]").waitFor();
  const hs = await mob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Administración en celular: sin desplazamiento horizontal de la página", hs <= 1, `${hs}px`);
  await mob.page.screenshot({ path: `${OUT}/04-admin-mobile.png` });
  await mob.ctx.close();
  await adm.ctx.close();
  await dep.ctx.close();
} catch (e) {
  console.error(e);
  check("Ejecución sin errores", false, String(e.message ?? e).split("\n")[0]);
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
  if (failed.length) console.log("FALLARON:\n" + failed.map((f) => "- " + f.name).join("\n"));
  await browser.close();
  await pool.end();
  process.exitCode = failed.length ? 1 : 0;
}
