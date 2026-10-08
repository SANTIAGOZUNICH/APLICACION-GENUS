// Comprueba en navegador real la fuente de PREVIEW (copia XLSX incluida, solo lectura) — mismo código que corre en Vercel Preview.
// Corre contra `next dev` con GENUS_SEMANAS_PREVIEW_SOURCE=1 (ver run-semanas-preview-local.sh). No toca Google ni la base.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3230";
const OUT = process.env.OUT ?? "/tmp/semanas-preview";
mkdirSync(OUT, { recursive: true });
const EMAIL = "produccion@laboratoriogenus.com.ar";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const session = { status: "preview", mode: "preview", user: { email: EMAIL, displayName: "Producción", jobTitle: "Supervisora", company: "Laboratorio Genus" }, sector: { id: "PRODUCCION", label: "Producción" }, role: { id: "ROL-SU", label: "Supervisora" }, rememberMe: true, redirectTo: "/mi-trabajo", createdAt: new Date().toISOString() };

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, extraHTTPHeaders: { "x-genus-actor-email": EMAIL, "x-genus-actor-sector": "PRODUCCION" } });
  await ctx.addCookies([{ name: "genus_session", value: "demo", url: BASE }]);
  await ctx.addInitScript((s) => { localStorage.setItem("genus_os_auth_session", JSON.stringify(s)); localStorage.setItem("genus_os_semanas_mode", "calendar"); }, session);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/mi-trabajo`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /^Semanas$/ }).or(page.getByRole("button", { name: /^Semanas$/ })).first().click({ timeout: 60000 });
  await page.waitForSelector("[data-testid=semanas-tab-ELABORACION]", { timeout: 60000 });
  await page.waitForSelector("[data-testid=task-card]", { timeout: 60000 });
  check("banner de Preview visible (copia XLSX, solo lectura)", (await page.locator("[data-testid=semanas-preview-banner]").count()) === 1);
  await page.waitForFunction(() => /ELABORACION/.test(document.querySelector("[data-testid=semanas-preview-banner]")?.textContent ?? ""), null, { timeout: 30000 });
  check("origen = copia incluida, 12 y 15 semanas", /copia incluida en el deploy/.test(await page.locator("[data-testid=semanas-preview-banner]").innerText()) && /12 semanas en ELABORACION, 15 en ACONDICIONAMIENTO/.test(await page.locator("[data-testid=semanas-preview-banner]").innerText()));
  const names = await page.locator("[data-testid=semanas-section]").allInnerTexts();
  check("responsables y tarjetas de producción visibles", names.some((t) => /CRISTIAN|NICOLAS/.test(t)) && (await page.locator("[data-testid=task-card]").count()) > 5, `${await page.locator("[data-testid=task-card]").count()} tarjetas`);
  const sel = await page.locator("[data-testid=semanas-week] option").allInnerTexts();
  console.log("   semanas ELABORACION:", sel.join(" · "));
  check("Preview muestra las 12 semanas de ELABORACION (incluidas las plegadas en la Sheet)", sel.length === 12, String(sel.length));
  await page.screenshot({ path: `${OUT}/preview-elaboracion.png` });
  await page.locator("[data-testid=task-card] [data-a1]").nth(2).dblclick();
  check("copia de Preview = solo lectura: la celda no entra en edición", (await page.locator("[data-testid=semanas-cal-input]").count()) === 0);
  await page.locator("[data-testid=priority-chip]").first().click();
  await page.click("[data-testid=priority-option-IMPORTANTE]");
  await page.waitForSelector("[data-testid=task-card][data-priority=IMPORTANTE]", { timeout: 15000 });
  check("las prioridades sí se pueden cambiar en Preview (dato de GENUS, no de la copia)", true);
  await page.click("[data-testid=semanas-mode-planilla]");
  await page.waitForSelector("td[colspan='5']", { timeout: 30000 });
  check("Planilla: celdas combinadas (banda de responsable colSpan=5)", (await page.locator("td[colspan='5']").count()) > 0);
  await page.click("[data-testid=semanas-mode-operativo]");
  await page.waitForSelector("[data-testid=task-card]");
  for (const [tab, sel2] of [["ACONDICIONAMIENTO", "[data-testid=task-card]"], ["CDIA", "[data-testid=semanas-grid]"], ["ENTREGAS", "[data-testid=semanas-grid]"]]) {
    await page.click(`[data-testid=semanas-tab-${tab}]`);
    await page.waitForSelector(sel2, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/preview-${tab}.png` });
    check(`pestaña ${tab} muestra datos`, (await page.locator(sel2).count()) > 0);
  }
  // carga: inválido
  await page.click("[data-testid=semanas-tab-ELABORACION]");
  await page.waitForSelector("[data-testid=task-card]");
  writeFileSync(`${OUT}/malo.xlsx`, "esto no es un excel");
  await page.setInputFiles("[data-testid=semanas-preview-upload]", `${OUT}/malo.xlsx`);
  await page.waitForSelector("[data-testid=semanas-preview-msg]");
  check("archivo inválido se rechaza con motivo", /no es un archivo \.xlsx/i.test(await page.locator("[data-testid=semanas-preview-msg]").innerText()), await page.locator("[data-testid=semanas-preview-msg]").innerText());
  // carga: válido
  await page.setInputFiles("[data-testid=semanas-preview-upload]", process.env.XLSX ?? "assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx");
  await page.waitForFunction(() => /Se cargó/.test(document.querySelector("[data-testid=semanas-preview-msg]")?.textContent ?? ""), null, { timeout: 30000 });
  check("archivo válido se carga y sigue mostrando datos", (await page.locator("[data-testid=task-card]").count()) > 0 && /archivo cargado/.test(await page.locator("[data-testid=semanas-preview-banner]").innerText()));
  await page.click("[data-testid=semanas-preview-reset]");
  await page.waitForFunction(() => /restauró/.test(document.querySelector("[data-testid=semanas-preview-msg]")?.textContent ?? ""), null, { timeout: 30000 });
  check("restaurar vuelve a la copia incluida", /copia incluida/.test(await page.locator("[data-testid=semanas-preview-banner]").innerText()));
  await ctx.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK; capturas en ${OUT}`);
process.exit(failed.length ? 1 : 0);
