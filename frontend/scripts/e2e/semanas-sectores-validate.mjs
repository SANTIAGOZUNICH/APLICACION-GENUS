// Validación en Chromium real de: Producción → Semanas (solo Lista, edición inline, prioridades), Semanas / Día a día de
// los sectores (solo lectura, mismas prioridades) y Modo TV de un sector en 1280×720, 1366×768 y 1920×1080.
// Corre contra la COPIA LOCAL del libro (escrituras solo en memoria: nunca Google, nunca la base). Ver run-semanas-sectores-local.sh.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3270";
const OUT = process.env.OUT ?? "/tmp/semanas-sectores";
mkdirSync(OUT, { recursive: true });
const results = [];
const TOKEN = `E2E${Date.now() % 100000}`;
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const USERS = {
  PRODUCCION: { email: "produccion@laboratoriogenus.com.ar", label: "Producción" },
  ELABORACION: { email: "elaboracion@laboratoriogenus.com.ar", label: "Elaboración" },
  ENVASADO_MASIVO: { email: "emasivo@laboratoriogenus.com.ar", label: "Envasado Masivo" },
  CODIFICADO: { email: "codificado@laboratoriogenus.com.ar", label: "Codificado" },
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

async function open(sector, viewport) {
  const u = USERS[sector];
  const session = { status: "preview", mode: "preview", user: { email: u.email, displayName: u.label, jobTitle: "", company: "Laboratorio Genus" }, sector: { id: sector, label: u.label }, role: { id: "ROL-OP", label: "Operador" }, rememberMe: true, redirectTo: "/mi-trabajo", createdAt: new Date().toISOString() };
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { "x-genus-actor-email": u.email } });
  await ctx.addCookies([{ name: "genus_session", value: "demo", url: BASE }]);
  await ctx.addInitScript((s) => {
    localStorage.setItem("genus_os_auth_session", JSON.stringify(s));
    localStorage.removeItem("genus_os_semanas_sector_mode");
  }, session);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}
async function goSemanas(page) {
  const item = page.getByRole("button", { name: /^Semanas$/ }).or(page.getByRole("link", { name: /^Semanas$/ })).first();
  await item.click({ timeout: 120000 });
}

try {
  // ================= PRODUCCIÓN → LISTA =================
  {
    const { ctx, page } = await open("PRODUCCION", { width: 1500, height: 950 });
    await goSemanas(page);
    await page.waitForSelector("[data-testid=list-row]", { timeout: 120000 });
    const rows = await page.locator("[data-testid=list-row]").count();
    check("Producción: Semanas muestra la LISTA (una fila por tarea)", rows >= 10, `${rows} filas`);
    check("Producción: sin Calendario / Planilla / selector de vistas", (await page.locator("[data-testid^=semanas-mode-]").count()) === 0 && (await page.locator("[data-testid=semanas-cards]").count()) === 0 && (await page.locator("[data-testid=semanas-calendar]").count()) === 0);
    const headers = (await page.locator("[data-testid=semanas-list-grid] thead th").allInnerTexts()).join("|").toUpperCase();
    check("Lista: columnas prioridad, fecha, responsable/sector, cliente, producto, cantidad", ["PRIORIDAD", "FECHA", "RESPONSABLE", "CLIENTE", "PRODUCTO", "CANTIDAD"].every((h) => headers.includes(h)), headers);

    // edición inline con un clic (sin tarjetas flotantes)
    const productLine = page.locator("[data-testid=list-row] td[data-col=product] [data-field-line]:not([data-protected])").first();
    const before = (await productLine.innerText()).trim();
    const a1 = await productLine.getAttribute("data-a1");
    await productLine.click();
    const input = page.locator("[data-testid=semanas-cal-input]");
    check("un clic en el campo lo edita en el lugar (sin ventana)", (await input.count()) === 1 && (await page.locator("[role=dialog]").count()) === 0, a1 ?? "");
    await input.fill(`${before} X`);
    await page.keyboard.press("Escape");
    check("Escape cancela", (await page.locator(`[data-a1="${a1}"]`).innerText()).trim() === before);
    await page.locator(`[data-a1="${a1}"]`).click();
    await input.fill(`${before} ${TOKEN}`);
    await page.keyboard.press("Enter");
    // fecha anterior a hoy → el motor exige motivo (queda auditado) antes de escribir
    const preview = page.locator("[data-testid=semanas-cal-preview]");
    if (await preview.isVisible({ timeout: 2000 }).catch(() => false)) {
      check("fecha pasada: se exige motivo antes de guardar", await page.locator("[data-testid=semanas-cal-confirm]").isDisabled());
      await page.fill("[data-testid=semanas-cal-reason]", "Corrección de prueba E2E");
      await page.click("[data-testid=semanas-cal-confirm]");
    }
    await page.waitForSelector(`[data-testid=list-row][data-task-key*="${TOKEN.toLowerCase()}"]`, { timeout: 20000 }).catch(() => {});
    check("Enter guarda (releído de la planilla de prueba)", (await page.locator(`[data-a1="${a1}"]`).innerText()).includes(TOKEN));

    // prioridad: menú mínimo y atajo de teclado
    // la fila se vuelve a leer de la planilla: su clave ya incluye el texto nuevo
    const row = page.locator(`[data-testid=list-row][data-task-key*="${TOKEN.toLowerCase()}"]`);
    const taskKey = await row.getAttribute("data-task-key");
    await row.locator("[data-testid=priority-chip]").click();
    await page.click("[data-testid=priority-option-URGENTE]");
    await page.waitForFunction((k) => document.querySelector(`[data-testid=list-row][data-task-key="${CSS.escape(k)}"]`)?.getAttribute("data-priority") === "URGENTE", taskKey, { timeout: 20000 }).catch(() => {});
    check("Producción cambia la prioridad (URGENTE)", (await page.locator(`[data-testid=list-row][data-task-key="${taskKey}"]`).getAttribute("data-priority")) === "URGENTE");
    const second = page.locator("[data-testid=list-row]").nth(3);
    const secondKey = await second.getAttribute("data-task-key");
    await second.locator("td").first().click({ position: { x: 140, y: 10 } });
    await page.keyboard.press("2");
    await page.waitForFunction((k) => document.querySelector(`[data-testid=list-row][data-task-key="${CSS.escape(k)}"]`)?.getAttribute("data-priority") === "IMPORTANTE", secondKey, { timeout: 20000 }).catch(() => {});
    check("atajo de teclado 2 = IMPORTANTE", (await page.locator(`[data-testid=list-row][data-task-key="${secondKey}"]`).getAttribute("data-priority")) === "IMPORTANTE");
    await row.locator("[data-testid=list-history]").click();
    await page.waitForSelector("[data-testid=list-history-row]");
    await page.waitForFunction(() => /URGENTE/.test(document.querySelector("[data-testid=list-history-row]")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
    check("historial de prioridad (auditoría) visible", /NORMAL → URGENTE/.test(await page.locator("[data-testid=list-history-row]").innerText()));
    await page.screenshot({ path: `${OUT}/1-produccion-lista.png` });
    await page.reload();
    await goSemanas(page);
    await page.waitForSelector("[data-testid=list-row]", { timeout: 120000 });
    check("la prioridad persiste después de recargar", (await page.locator(`[data-testid=list-row][data-task-key="${taskKey}"]`).getAttribute("data-priority")) === "URGENTE");
    globalThis.__urgentKey = taskKey;
    globalThis.__importantKey = secondKey;
    // Acondicionamiento también en lista
    await page.click("[data-testid=semanas-tab-ACONDICIONAMIENTO]");
    await page.waitForSelector("[data-testid=list-row]", { timeout: 60000 });
    await page.screenshot({ path: `${OUT}/1b-produccion-lista-acondicionamiento.png` });
    await ctx.close();
  }

  // ================= ELABORACIÓN → SEMANAS / DÍA A DÍA =================
  {
    const { ctx, page } = await open("ELABORACION", { width: 1500, height: 950 });
    await goSemanas(page);
    await page.waitForSelector("[data-testid=semanas-week-board] [data-testid=plan-card]", { timeout: 120000 });
    const card = page.locator(`[data-testid=plan-card][data-task-key="${globalThis.__urgentKey}"]`);
    check("Elaboración ve la MISMA tarea como URGENTE (prioridad compartida)", (await card.count()) === 1 && (await card.getAttribute("data-priority")) === "URGENTE");
    check("la tarjeta muestra el texto editado por Producción (mismos datos)", (await card.innerText()).includes(TOKEN));
    check("Elaboración: sin controles de edición (ni prioridad ni celdas)", (await page.locator("[data-testid=priority-chip], [data-testid=semanas-cal-input], [data-field-line], [data-testid=list-row]").count()) === 0);
    const labels = (await page.locator("[data-testid=semanas-week-board]").innerText()).toUpperCase();
    check("etiquetas explícitas PRODUCTO / RESPONSABLE / CLIENTE y fecha por día", ["PRODUCTO", "RESPONSABLE", "CLIENTE", "LUN", "MAR"].every((l) => labels.includes(l)));
    check("solo tareas de Elaboración (responsables CRISTIAN / NICOLAS)", (await page.locator("[data-testid=plan-assignee]").allInnerTexts()).every((t) => /CRISTIAN|NICOLAS/.test(t)));
    await page.screenshot({ path: `${OUT}/2-elaboracion-semanas.png` });
    await page.click("[data-testid=semanas-sector-mode-dia]");
    await page.waitForSelector("[data-testid=semanas-day-board]");
    const dayCards = await page.locator("[data-testid=semanas-day-board] [data-testid=plan-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-priority")));
    const rank = { URGENTE: 0, IMPORTANTE: 1, NORMAL: 2 };
    check("Día a día: tareas ordenadas por prioridad", dayCards.every((p, i) => i === 0 || rank[dayCards[i - 1]] <= rank[p]), dayCards.join(","));
    check("Día a día muestra la jornada de hoy (06/05)", (await page.locator("[data-testid=semanas-day-board]").getAttribute("data-date")) === "2026-05-06");
    await page.screenshot({ path: `${OUT}/3-elaboracion-dia-a-dia.png` });
    // consistencia: cada tarjeta del día está también en Semanas con la misma prioridad
    const dayKeys = await page.locator("[data-testid=semanas-day-board] [data-testid=plan-card]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-task-key"), e.getAttribute("data-priority")]));
    await page.click("[data-testid=semanas-sector-mode-semana]");
    await page.waitForSelector("[data-testid=semanas-week-board]");
    let consistent = true;
    for (const [k, p] of dayKeys) {
      const el = page.locator(`[data-testid=semanas-week-board] [data-testid=plan-card][data-task-key="${k}"]`);
      if ((await el.count()) !== 1 || (await el.getAttribute("data-priority")) !== p) consistent = false;
    }
    check("Semanas y Día a día: mismas tareas, una vez cada una, misma prioridad", consistent, `${dayKeys.length} tareas del día`);
    // trabajo operativo intacto: «Mi trabajo» sigue disponible
    await page.getByRole("button", { name: /^Mi trabajo$/ }).first().click();
    await page.waitForTimeout(1500);
    check("Elaboración conserva «Mi trabajo» (registro de avances)", (await page.locator("[data-testid=semanas-sector]").count()) === 0);
    await ctx.close();
  }

  // ================= ENVASADO MASIVO → SEMANAS =================
  {
    const { ctx, page } = await open("ENVASADO_MASIVO", { width: 1500, height: 950 });
    await goSemanas(page);
    await page.waitForSelector("[data-testid=semanas-week-board] [data-testid=plan-card]", { timeout: 120000 });
    check("Envasado Masivo: no ve tareas de Elaboración", (await page.locator(`[data-testid=plan-card][data-task-key="${globalThis.__urgentKey}"]`).count()) === 0 && (await page.locator("[data-testid=plan-card][data-task-key^=ELABORACION]").count()) === 0);
    await page.screenshot({ path: `${OUT}/4-envasado-masivo-semanas.png` });
    await ctx.close();
  }

  // ================= MODO TV (sector) =================
  for (const [sector, w, h] of [["ELABORACION", 1280, 720], ["ELABORACION", 1366, 768], ["ELABORACION", 1920, 1080], ["ENVASADO_MASIVO", 1280, 720], ["ENVASADO_MASIVO", 1920, 1080]]) {
    const { ctx, page } = await open(sector, { width: w, height: h });
    await goSemanas(page);
    await page.waitForSelector("[data-testid=semanas-tv-open]", { timeout: 120000 });
    await page.click("[data-testid=semanas-tv-open]");
    await page.waitForSelector("[data-testid=semanas-tv] [data-testid=plan-card]", { timeout: 60000 });
    await page.waitForTimeout(600);
    const cards = await page.locator("[data-testid=semanas-tv] [data-testid=plan-card]").count();
    const cols = await page.locator("[data-testid=semanas-tv]").getAttribute("data-columns");
    const visible = await page.locator("[data-testid=semanas-tv] [data-testid=plan-card]").evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; }).length);
    const fontPx = await page.locator("[data-testid=semanas-tv] [data-testid=plan-product]").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    check(`TV ${sector} ${w}×${h}: ${cols} columnas, ${visible} tarjetas visibles a la vez, producto ${fontPx}px`, cards > 0 && visible >= 4 && fontPx >= 16);
    check(`TV ${w}×${h}: sin sidebar ni otros sectores; solo lectura`, (await page.locator("[data-testid=semanas-tv] [data-testid=priority-chip], [data-testid=semanas-tv] input").count()) === 0 && (await page.locator("[data-testid=semanas-tv] [data-testid^=tv-tab-]").count()) === 0);
    check(`TV ${w}×${h}: indicador de última actualización`, /Actualizado \d/.test(await page.locator("[data-testid=tv-updated]").innerText()));
    const urgent = page.locator(`[data-testid=semanas-tv] [data-testid=plan-card][data-task-key="${globalThis.__urgentKey}"]`);
    if (await urgent.count()) check(`TV ${w}×${h}: la prioridad de Producción se ve en la TV del sector`, (await urgent.first().getAttribute("data-priority")) === "URGENTE");
    await page.screenshot({ path: `${OUT}/5-tv-${sector.toLowerCase()}-${w}x${h}.png` });
    await ctx.close();
  }

  // ================= MODO TV: corte de conexión =================
  {
    const { ctx, page } = await open("ENVASADO_MASIVO", { width: 1366, height: 768 });
    await goSemanas(page);
    await page.click("[data-testid=semanas-tv-open]", { timeout: 120000 });
    await page.waitForSelector("[data-testid=semanas-tv] [data-testid=plan-card]", { timeout: 60000 });
    await page.route("**/api/v1/semanas/plan**", (r) => r.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.clock?.runFor?.(0);
    // forzar una recarga: cerrar y abrir el TV con la red caída
    await page.keyboard.press("Escape");
    await page.click("[data-testid=semanas-tv-open]");
    await page.waitForSelector("[data-testid=tv-stale]", { timeout: 20000 }).catch(() => {});
    check("TV: error de conexión visible y claro", (await page.locator("[data-testid=tv-stale]").count()) === 1);
    await page.screenshot({ path: `${OUT}/6-tv-sin-conexion.png` });
    await ctx.close();
  }
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
