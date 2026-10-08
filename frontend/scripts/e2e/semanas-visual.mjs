// Validación visual/funcional de Producción → Semanas en navegador real (Chromium), SOLO con la copia local del libro
// (GENUS_SEMANAS_FIXTURE_XLSX): jamás toca Google ni datos productivos. Genera capturas en $OUT.
//
//   GENUS_AUTH_ALLOW_TEST_HEADERS=1 GENUS_SEMANAS_FIXTURE_XLSX="../SEMANAS 2026.xlsx" SEMANAS_TODAY_OVERRIDE=2026-02-25 \
//   SEMANAS_WRITEBACK=1 SEMANAS_WRITEBACK_SPREADSHEET_IDS=fixture-semanas-2026 npx next dev -p 3210
//   BASE=http://localhost:3210 OUT=/tmp/semanas node scripts/e2e/semanas-visual.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = process.env.OUT ?? "/tmp/semanas-visual";
mkdirSync(OUT, { recursive: true });
const EMAIL = "produccion@laboratoriogenus.com.ar";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const session = {
  status: "preview", mode: "preview",
  user: { email: EMAIL, displayName: "Producción", jobTitle: "Supervisora", company: "Laboratorio Genus" },
  sector: { id: "PRODUCCION", label: "Producción" }, role: { id: "ROL-SU", label: "Supervisora" },
  rememberMe: true, redirectTo: "/mi-trabajo", createdAt: new Date().toISOString(),
};

async function open(browser, viewport, isMobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, extraHTTPHeaders: { "x-genus-actor-email": EMAIL, "x-genus-actor-sector": "PRODUCCION" } });
  await ctx.addCookies([{ name: "genus_session", value: "demo", url: BASE }]);
  await ctx.addInitScript((s) => {
    localStorage.setItem("genus_os_auth_session", JSON.stringify(s));
    localStorage.setItem("genus_os_semanas_mode", "calendar");
  }, session);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

async function goSemanas(page, tab = "ELABORACION") {
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "domcontentloaded" });
  // Navegación interna de la app (twin-app): ítem «Semanas» del menú lateral (en móvil, dentro del menú).
  const item = page.getByRole("link", { name: /^Semanas$/ }).or(page.getByRole("button", { name: /^Semanas$/ })).first();
  if (!(await item.isVisible().catch(() => false))) await page.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => {});
  await item.click({ timeout: 60000 });
  await page.waitForSelector("[data-testid=semanas-tab-ELABORACION]", { timeout: 60000 });
  if (tab !== "ELABORACION") await page.click(`[data-testid=semanas-tab-${tab}]`);
  await page.waitForSelector("[data-testid=semanas-calendar], [data-testid=semanas-grid]", { timeout: 60000 });
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
try {
  // ---------- ESCRITORIO ----------
  const { ctx, page } = await open(browser, { width: 1500, height: 950 });
  await goSemanas(page);
  await page.waitForSelector("td[data-a1]");
  check("calendario visible (no grilla plana)", (await page.locator("[data-testid=semanas-calendar]").count()) === 1);
  const band = await page.locator("td[colspan='5']").first().evaluate((e) => ({ w: e.getBoundingClientRect().width, t: e.textContent }));
  const day = await page.locator("td[data-d='1']:not([colspan='5'])").first().evaluate((e) => e.getBoundingClientRect().width);
  check("banda del responsable abarca los 5 días (colSpan=5)", band.w > day * 4, `${Math.round(band.w)}px vs día ${Math.round(day)}px · ${band.t}`);
  check("hay celdas combinadas verticales (rowSpan=2)", (await page.locator("td[rowspan='2']").count()) > 0);
  const colored = await page.locator("td[style*='background']").count();
  check("colores de la Sheet aplicados", colored > 10, `${colored} celdas con fondo`);
  check("semanas plegadas en la Sheet ocultas por defecto", (await page.locator("[data-testid=semanas-show-folded]").count()) === 1);
  await page.screenshot({ path: `${OUT}/desktop-elaboracion.png` });

  // celdas de la primera semana visible: se descubren en runtime (no dependen de números de fila)
  const pick = await page.evaluate(() => {
    const t = document.querySelector("[data-testid=semanas-cal-table]");
    const cells = [...t.querySelectorAll("td[data-a1]")].filter((c) => Number(c.dataset.r) >= 4 && !c.dataset.protected && c.textContent.trim() && c.dataset.span === "1" && c.dataset.rowspan === "1");
    const a = cells.find((c) => c.dataset.d === "0");
    const b = cells.find((c) => c.dataset.d === "2" && Number(c.dataset.r) > Number(a.dataset.r));
    const edit = cells.find((c) => c.dataset.d === "3");
    return { a: a.dataset.a1, b: b.dataset.a1, edit: edit.dataset.a1, editText: edit.textContent };
  });
  const sa = await page.locator(`td[data-a1='${pick.a}']`).first().boundingBox();
  await page.mouse.move(sa.x + 5, sa.y + 5);
  await page.mouse.down();
  const sb = await page.locator(`td[data-a1='${pick.b}']`).first().boundingBox();
  await page.mouse.move(sb.x + 5, sb.y + 5, { steps: 6 });
  await page.mouse.up();
  const selected = await page.locator("td[aria-selected=true]").count();
  check("selección de rango arrastrando", selected >= 2, `${selected} celdas`);
  await page.screenshot({ path: `${OUT}/desktop-seleccion.png` });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.keyboard.press("Control+C");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check("Ctrl+C copia TSV del rango", typeof clip === "string" && clip.includes("\t") && clip.includes("\n"), JSON.stringify(clip)?.slice(0, 90));

  // edición de celda autorizada
  await page.click(`td[data-a1='${pick.edit}']`);
  await page.keyboard.press("Enter");
  const input = page.locator("[data-testid=semanas-cal-input]");
  const editable = (await input.count()) === 1;
  check("celda autorizada entra en edición (Enter)", editable);
  if (editable) {
    await input.fill("PRODUCTO VISUAL TEST");
    await input.press("Enter");
    const reason = page.locator("[data-testid=semanas-cal-reason]");
    if (await reason.count()) {
      await reason.fill("Prueba visual sobre copia local");
      await page.click("[data-testid=semanas-cal-confirm]");
    }
    await page.waitForFunction((a1) => document.querySelector(`td[data-a1='${a1}']`)?.textContent?.includes("PRODUCTO VISUAL TEST"), pick.edit, { timeout: 15000 }).catch(() => {});
    const after = await page.locator(`td[data-a1='${pick.edit}']`).first().textContent();
    check("la edición persiste (releída de la Sheet de prueba) y la vecina quedó intacta", after?.includes("PRODUCTO VISUAL TEST") && (await page.locator(`td[data-a1='${pick.a}']`).first().textContent()) !== "PRODUCTO VISUAL TEST", `antes="${pick.editText}" después="${after}"`);
  }
  // protegidas: encabezado
  await page.dblclick("th[scope=row]").catch(() => {});
  await page.dblclick("td[data-r='0']");
  check("encabezado de día es solo lectura", (await input.count()) === 0);
  // semana con varios productos: screenshot de una semana más abajo
  await page.evaluate(() => document.querySelector("[data-testid=semanas-cal-scroll]").scrollBy(0, 1400));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/desktop-scroll.png` });
  // rendimiento: nº de tablas montadas con muchas semanas
  await page.check("[data-testid=semanas-show-folded]").catch(() => {});
  await page.waitForTimeout(600);
  const total = await page.locator("[data-testid^='semanas-week-']").count();
  const mounted = await page.locator("[data-testid=semanas-cal-table]").count();
  check("virtualización: solo se monta una parte de las semanas", total > mounted && mounted <= 8, `${mounted} montadas de ${total}`);
  const t0 = Date.now();
  for (let i = 0; i < 20; i += 1) await page.evaluate((y) => document.querySelector("[data-testid=semanas-cal-scroll]").scrollTo(0, y), i * 900);
  await page.waitForTimeout(300);
  check("desplazamiento vertical fluido", Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
  // scroll horizontal
  const sc = await page.locator("[data-testid=semanas-cal-scroll]").evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  console.log("   scroll", sc);
  await ctx.close();

  // ---------- PESTAÑAS ----------
  for (const tab of ["ACONDICIONAMIENTO", "CDIA", "ENTREGAS"]) {
    const c = await open(browser, { width: 1500, height: 950 });
    await goSemanas(c.page, tab);
    await c.page.waitForTimeout(800);
    await c.page.screenshot({ path: `${OUT}/desktop-${tab}.png` });
    check(`pestaña ${tab} renderiza`, (await c.page.locator("td[data-a1], [data-testid=semanas-grid]").count()) > 0);
    await c.ctx.close();
  }

  // ---------- LISTA ----------
  {
    const c = await open(browser, { width: 1500, height: 950 });
    await goSemanas(c.page);
    await c.page.click("[data-testid=semanas-mode-list]");
    await c.page.waitForSelector("[data-testid=semanas-grid]");
    check("«Ver como lista» conserva la grilla GenusGrid", true);
    await c.page.screenshot({ path: `${OUT}/desktop-lista.png` });
    await c.ctx.close();
  }

  // ---------- MÓVIL ----------
  {
    const c = await open(browser, { width: 390, height: 800 }, true);
    await goSemanas(c.page);
    await c.page.waitForSelector("td[data-a1]");
    const sc = await c.page.locator("[data-testid=semanas-cal-scroll]").evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    check("móvil: scroll horizontal interno (el calendario no rompe el layout)", sc.sw > sc.cw && (await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), JSON.stringify(sc));
    await c.page.screenshot({ path: `${OUT}/mobile-elaboracion.png` });
    const target = await c.page.evaluate(() => [...document.querySelectorAll("td[data-a1]")].find((x) => Number(x.dataset.r) >= 4 && x.dataset.d === "0" && x.textContent.trim())?.dataset.a1);
    await c.page.tap(`td[data-a1='${target}']`);
    check("móvil: tocar una celda la selecciona y la barra de valor la muestra", (await c.page.locator("[data-testid=semanas-cal-a1]").textContent()) === target && (await c.page.locator("[data-testid=semanas-cal-bar]").inputValue()).length > 0, target);
    await c.page.screenshot({ path: `${OUT}/mobile-seleccion.png` });
    await c.ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK; capturas en ${OUT}`);
process.exit(failed.length ? 1 : 0);
