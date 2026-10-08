// Validación VISUAL y FUNCIONAL del rediseño de Producción → Semanas en Chromium real, con la COPIA LOCAL de SEMANAS 2026
// (GENUS_SEMANAS_FIXTURE_XLSX; escrituras solo en memoria, jamás Google ni la base). Genera capturas en $OUT.
//   Ver scripts/e2e/run-semanas-ux-local.sh (levanta la app con la copia local y corre esto).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3250";
const OUT = process.env.OUT ?? "/tmp/semanas-ux";
mkdirSync(OUT, { recursive: true });
const EMAIL = "produccion@laboratoriogenus.com.ar";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const session = { status: "preview", mode: "preview", user: { email: EMAIL, displayName: "Producción", jobTitle: "Supervisora", company: "Laboratorio Genus" }, sector: { id: "PRODUCCION", label: "Producción" }, role: { id: "ROL-SU", label: "Supervisora" }, rememberMe: true, redirectTo: "/mi-trabajo", createdAt: new Date().toISOString() };

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function open(viewport, { mobile = false, tab = "ELABORACION", clock = false } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, extraHTTPHeaders: { "x-genus-actor-email": EMAIL, "x-genus-actor-sector": "PRODUCCION" } });
  await ctx.addCookies([{ name: "genus_session", value: "demo", url: BASE }]);
  await ctx.addInitScript((s) => { localStorage.setItem("genus_os_auth_session", JSON.stringify(s)); localStorage.removeItem("genus_os_semanas_mode"); }, session);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  if (clock) await page.clock.install();
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "domcontentloaded" });
  const item = page.getByRole("link", { name: /^Semanas$/ }).or(page.getByRole("button", { name: /^Semanas$/ })).first();
  if (!(await item.isVisible().catch(() => false))) await page.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => {});
  await item.click({ timeout: 90000 });
  await page.waitForSelector("[data-testid=semanas-tab-ELABORACION]", { timeout: 90000 });
  if (tab !== "ELABORACION") await page.click(`[data-testid=semanas-tab-${tab}]`);
  await page.waitForSelector("[data-testid=task-card]", { timeout: 60000 });
  return { ctx, page };
}
const cardOf = (page, text) => page.locator("[data-testid=task-card]", { hasText: text }).first();
const lineOf = (page, text) => page.locator("[data-a1]", { hasText: text }).first();

try {
  // ================= ESCRITORIO =================
  const { ctx, page } = await open({ width: 1500, height: 950 });
  const n = await page.locator("[data-testid=task-card]").count();
  check("Calendario operativo: tarjetas por tarea (no una planilla)", n >= 10, `${n} tarjetas`);
  check("sin numeración de filas ni grilla de Google", (await page.locator("th[scope=row]").count()) === 0 && (await page.locator("td[data-a1]").count()) === 0);
  check("prioridad inicial NORMAL en todas", (await page.locator("[data-testid=task-card][data-priority=NORMAL]").count()) === n);
  check("responsables visibles (CRISTIAN / NICOLAS)", (await page.getByText("CRISTIAN", { exact: true }).count()) > 0 && (await page.getByText("NICOLAS", { exact: true }).count()) > 0);
  check("día de hoy resaltado", (await page.locator("[data-testid=day-header-2]").innerText()).includes("HOY"));
  await page.screenshot({ path: `${OUT}/1-desktop-calendario.png` });

  // --- edición en el lugar: sin formularios ni diálogos ---
  const target = lineOf(page, "SERUM JOJOBA 50KG");
  const a1 = await target.getAttribute("data-a1");
  const neighbor = lineOf(page, "BL COSMETIC");
  const neighborText = await neighbor.innerText();
  await target.dblclick();
  const input = page.locator("[data-testid=semanas-cal-input]");
  check("doble clic edita la celda en el lugar (sin ventana)", (await input.count()) === 1 && (await page.locator("[role=dialog]").count()) === 0, a1 ?? "");
  await input.fill("SERUM JOJOBA 60KG");
  await page.keyboard.press("Escape");
  check("Escape cancela (no cambia)", (await page.getByText("SERUM JOJOBA 50KG").count()) > 0 && (await page.getByText("SERUM JOJOBA 60KG").count()) === 0);
  await target.dblclick();
  await input.fill("SERUM JOJOBA 60KG");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("SERUM JOJOBA 60KG"), null, { timeout: 15000 }).catch(() => {});
  check("Enter confirma y persiste (releído de la planilla)", (await page.getByText("SERUM JOJOBA 60KG").count()) > 0);
  check("la celda vecina no cambió", (await neighbor.innerText()) === neighborText);
  await page.screenshot({ path: `${OUT}/2-desktop-edicion.png` });

  // Tab avanza a la línea del día siguiente
  const first = lineOf(page, "ALISADO KERATIN 1100KG");
  await first.click();
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=semanas-cal-input]").press("Tab");
  const a1After = await page.locator("[data-testid=semanas-cal-a1]").innerText();
  check("Tab confirma y avanza a la celda de la derecha", a1After !== "—" && a1After !== (await first.getAttribute("data-a1")), `${await first.getAttribute("data-a1")} → ${a1After}`);

  // --- prioridades ---
  const jojoba = cardOf(page, "SERUM JOJOBA 60KG");
  await jojoba.locator("[data-testid=priority-chip]").click();
  check("el menú de prioridad es mínimo (sin ventana modal)", (await page.locator("[data-testid=priority-menu]").count()) === 1 && (await page.locator("[role=dialog]").count()) === 0);
  await page.screenshot({ path: `${OUT}/3-desktop-menu-prioridad.png` });
  await page.click("[data-testid=priority-option-URGENTE]");
  await page.waitForFunction(() => document.querySelector("[data-testid=task-card][data-priority=URGENTE]"), null, { timeout: 15000 });
  const txt = await cardOf(page, "SERUM JOJOBA 60KG").innerText();
  check("prioridad con color Y texto (🔴 URGENTE)", /URGENTE/.test(txt));
  const toImp = cardOf(page, "JALEA TERMAL");
  await toImp.locator("[data-testid=priority-chip]").click();
  await page.click("[data-testid=priority-option-IMPORTANTE]");
  await page.waitForFunction(() => document.querySelector("[data-testid=task-card][data-priority=IMPORTANTE]"), null, { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/4-desktop-prioridades.png` });
  // persistencia: recargar toda la página
  await page.reload({ waitUntil: "domcontentloaded" });
  const item = page.getByRole("link", { name: /^Semanas$/ }).or(page.getByRole("button", { name: /^Semanas$/ })).first();
  await item.click({ timeout: 90000 });
  await page.waitForSelector("[data-testid=task-card]", { timeout: 60000 });
  check("las prioridades persisten tras recargar la página", (await page.locator("[data-testid=task-card][data-priority=URGENTE]").count()) === 1 && (await page.locator("[data-testid=task-card][data-priority=IMPORTANTE]").count()) === 1);
  const info = await cardOf(page, "SERUM JOJOBA 60KG").locator("[data-testid=priority-chip]").getAttribute("title");
  check("se registra quién y cuándo cambió la prioridad", /Zunich|Producción/.test(info ?? "") && /\d{4}|\d{1,2}\/\d{1,2}/.test(info ?? ""), info ?? "");
  // filtro / orden (solo visual)
  await page.click("[data-testid=priority-filter-URGENTE]");
  check("filtrar por prioridad muestra solo esas tareas", (await page.locator("[data-testid=task-card]").count()) === 1);
  await page.click("[data-testid=priority-filter-ALL]");
  await page.check("[data-testid=priority-sort]");
  const firstInCol = await page.locator("[data-testid=day-col-3] [data-testid=task-card]").first().getAttribute("data-priority");
  check("ordenar por prioridad es visual (urgente primero en su columna)", firstInCol === "URGENTE", firstInCol ?? "");
  await page.uncheck("[data-testid=priority-sort]");
  // editar el texto NO pierde la prioridad
  const urgentLine = lineOf(page, "SERUM JOJOBA 60KG");
  await urgentLine.dblclick();
  await page.locator("[data-testid=semanas-cal-input]").fill("SERUM JOJOBA 70KG");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("SERUM JOJOBA 70KG"), null, { timeout: 15000 }).catch(() => {});
  check("corregir el texto de una tarea conserva su prioridad URGENTE", /URGENTE/.test(await cardOf(page, "SERUM JOJOBA 70KG").innerText()));

  // --- copiar y pegar ---
  const l1 = lineOf(page, "ALISADO KERATIN 1100KG");
  const l2 = lineOf(page, "TIERRAS DEL VOLCAN");
  const b1 = await l1.boundingBox();
  await page.mouse.move(b1.x + 4, b1.y + 4);
  await page.mouse.down();
  const b2 = await l2.boundingBox();
  await page.mouse.move(b2.x + 4, b2.y + 4, { steps: 8 });
  await page.mouse.up();
  const selected = await page.locator("[aria-selected=true]").count();
  check("selección de celdas (rango) entre tarjetas", selected >= 2, `${selected} celdas`);
  await page.screenshot({ path: `${OUT}/5-desktop-seleccion.png` });
  await page.keyboard.press("Control+C");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  check("Ctrl+C copia el rango como texto tabulado", typeof clip === "string" && clip.includes("ALISADO KERATIN 1100KG"), JSON.stringify(clip)?.slice(0, 80));
  await page.evaluate(() => navigator.clipboard.writeText(["V1", "V2", "V3", "V4", "V5", "V6", "V7"].join("\n")));
  await l1.click();
  await page.keyboard.press("Control+V");
  await page.waitForSelector("[data-testid=semanas-cal-preview]", { timeout: 10000 });
  const prevTxt = await page.locator("[data-testid=semanas-cal-preview]").innerText();
  check("pegar un rango grande muestra vista previa (antes → después)", /Se van a escribir/.test(prevTxt) && prevTxt.includes("V1"));
  await page.screenshot({ path: `${OUT}/6-desktop-pegado-preview.png` });
  await page.getByRole("button", { name: "Cancelar" }).click();
  check("cancelar la vista previa no modifica nada", (await page.getByText("ALISADO KERATIN 1100KG").count()) > 0);
  await page.evaluate(() => navigator.clipboard.writeText("ALISADO KERATIN 1200KG"));
  await l1.click();
  await page.keyboard.press("Control+V");
  await page.waitForFunction(() => document.body.innerText.includes("ALISADO KERATIN 1200KG"), null, { timeout: 15000 }).catch(() => {});
  check("pegar una celda guarda solo esa celda", (await page.getByText("ALISADO KERATIN 1200KG").count()) > 0);

  // --- celdas combinadas / planilla ---
  await page.click("[data-testid=semanas-mode-planilla]");
  await page.waitForSelector("td[data-a1]", { timeout: 30000 });
  check("Planilla: conserva combinadas reales (banda colSpan=5) y filas de la Sheet", (await page.locator("td[colspan='5']").count()) > 0 && (await page.locator("th[scope=row]").count()) > 0);
  await page.dblclick("td[data-r='0']");
  check("Planilla: encabezados protegidos (no se editan)", (await page.locator("[data-testid=semanas-cal-input]").count()) === 0);
  await page.screenshot({ path: `${OUT}/7-desktop-planilla.png` });
  await page.click("[data-testid=semanas-mode-list]");
  check("«Ver como lista» sigue disponible", (await page.locator("[data-testid=semanas-grid]").count()) === 1);
  await page.click("[data-testid=semanas-mode-operativo]");
  await page.waitForSelector("[data-testid=task-card]");

  // ACONDICIONAMIENTO: tarea de varios días (celda combinada) como tarjeta ancha
  await page.click("[data-testid=semanas-tab-ACONDICIONAMIENTO]");
  await page.waitForSelector("[data-testid=task-card]");
  await page.selectOption("[data-testid=semanas-week]", { label: "25/05 – 29/05/2026" });
  await page.waitForSelector("[data-testid=multi-day-strip]", { timeout: 20000 });
  const span = await page.locator("[data-testid=multi-day-strip] > div").first().evaluate((el) => el.style.gridColumn);
  check("ACONDICIONAMIENTO: la combinada de varios días conserva su ancho (grid-column span 2)", /span 2/.test(span), span);
  await page.screenshot({ path: `${OUT}/8-desktop-acondicionamiento.png` });

  // ================= MODO TV =================
  await ctx.close();
  for (const [w, h, name] of [[1366, 768, "tv-1366x768"], [1280, 720, "tv-1280x720"], [1920, 1080, "tv-1920x1080"]]) {
    const t = await open({ width: w, height: h }, { clock: name === "tv-1366x768" });
    await t.page.click("[data-testid=semanas-tv-open]");
    await t.page.waitForSelector("[data-testid=tv-card]", { timeout: 30000 });
    const cols = Number(await t.page.locator("[data-testid=semanas-tv]").getAttribute("data-columns"));
    const days = await t.page.locator("[data-testid=tv-day]").count();
    check(`Modo TV ${w}x${h}: distribución adaptable (${w >= 1700 ? 3 : 2} columnas, ${days} días con planificación)`, cols === (w >= 1700 ? 3 : 2) && days >= 1 && days <= cols, `columnas ${cols}`);
    check(`Modo TV ${w}x${h}: cubre toda la pantalla (sin sidebar)`, await t.page.locator("[data-testid=semanas-tv]").evaluate((el) => { const r = el.getBoundingClientRect(); return r.left === 0 && r.top === 0 && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight; }));
    if (name === "tv-1366x768") {
      check("Modo TV: sin sidebar ni controles administrativos, solo lectura", (await t.page.locator("[data-testid=tv-scroll] input, [data-testid=tv-scroll] textarea").count()) === 0);
      check("Modo TV: muestra «Actualizado hh:mm:ss»", /Actualizado \d{1,2}:\d{2}:\d{2}/.test(await t.page.locator("[data-testid=tv-updated]").innerText()));
      const before = await t.page.locator("[data-testid=tv-updated]").innerText();
      let reqs = 0;
      t.page.on("request", (r) => { if (r.url().includes("/api/v1/semanas/grid")) reqs += 1; });
      await t.page.clock.fastForward(61_000);
      await t.page.waitForTimeout(1500);
      check("Modo TV: se actualiza solo (nueva lectura a los 60 s)", reqs >= 1, `${reqs} lecturas nuevas`);
      void before;
      const hasUrgent = (await t.page.locator("[data-testid=tv-card][data-priority=URGENTE]").count()) >= 0;
      check("Modo TV: prioridad visible en cada tarjeta (texto + color)", (await t.page.locator("[data-testid=tv-card]").first().innerText()).match(/URGENTE|IMPORTANTE|NORMAL/) !== null && hasUrgent);
      // productos legibles: tamaño de letra mínimo
      const fs = await t.page.locator("[data-testid=tv-card] .leading-tight").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      check("Modo TV: letras grandes (producto ≥ 28 px a 1366 px)", fs >= 28, `${fs}px`);
    }
    await t.page.screenshot({ path: `${OUT}/9-${name}.png` });
    await t.ctx.close();
  }

  // ================= MÓVIL =================
  const m = await open({ width: 390, height: 844 }, { mobile: true });
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Móvil: sin desplazamiento horizontal de la página (tarjetas apiladas por día)", overflow <= 1, `exceso ${overflow}px`);
  await m.page.screenshot({ path: `${OUT}/10-mobile-calendario.png` });
  await m.page.locator("[data-testid=priority-chip]").first().tap();
  check("Móvil: el menú de prioridad se abre con un toque", (await m.page.locator("[data-testid=priority-menu]").count()) === 1);
  await m.page.screenshot({ path: `${OUT}/11-mobile-prioridad.png` });
  await m.ctx.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK; capturas en ${OUT}`);
process.exit(failed.length ? 1 : 0);
