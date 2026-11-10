// E2E en Chromium real: FERIADOS de la planta (PBA) en la Vista mensual compartida, en varios sectores, tablet y celular. Base DESCARTABLE.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { assertE2eEnvironment } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/vista-mensual-feriados";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

async function login(user, viewport = { width: 1400, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const openMonthly = async (page) => {
  const menuBtn = page.getByRole("button", { name: "Abrir menú" });
  if (await menuBtn.isVisible().catch(() => false)) { // celular: el menú es un panel
    await menuBtn.click();
    await page.getByRole("dialog", { name: "Menú" }).getByRole("button", { name: /^Vista mensual$/ }).click({ timeout: 120_000 });
  } else await nav(page, "Vista mensual"); await page.locator("[data-testid=vista-mensual]").waitFor({ timeout: 120_000 }); };
const month = (page) => page.locator("[data-testid=vista-mensual]").getAttribute("data-month");
async function goTo(page, target) {
  for (let i = 0; i < 40; i++) {
    const cur = await month(page);
    if (cur === target) return;
    await page.locator(cur < target ? "[data-testid=vm-next]" : "[data-testid=vm-prev]").click();
    await page.waitForFunction((c) => document.querySelector("[data-testid=vista-mensual]")?.getAttribute("data-month") !== c, cur);
  }
  throw new Error(`no se llegó a ${target}`);
}
/** { "2026-11-09": "nacional", ... } de los días visibles que están marcados. */
const marks = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-testid=month-day][data-holiday]")].map((d) => [d.getAttribute("data-day"), d.getAttribute("data-holiday")])));
const dayLoc = (page, d) => page.locator(`[data-testid=month-day][data-day="${d}"]`).first();

try {
  const pr = await login(E2E_USERS.produccion);
  await openMonthly(pr.page);
  await goTo(pr.page, "2026-11-01");
  const nov = await marks(pr.page);
  check("noviembre 2026: 09/11 nacional, 11/11 provincial, 23/11 nacional", nov["2026-11-09"] === "nacional" && nov["2026-11-11"] === "provincial" && nov["2026-11-23"] === "nacional", JSON.stringify(nov));
  check("10/11/2026 (CABA/Córdoba) no se marca", !("2026-11-10" in nov));
  const lab = dayLoc(pr.page, "2026-11-11").getByTestId("month-holiday-label");
  check("el día feriado muestra la etiqueta «FERIADO»", /feriado/i.test(await lab.innerText()) && (await lab.evaluate((e) => getComputedStyle(e).textTransform)) === "uppercase");
  await lab.click();
  const det = await dayLoc(pr.page, "2026-11-11").getByTestId("month-holiday-detail").innerText();
  check("al tocar la etiqueta se ve el nombre y el tipo (provincial)", /Papa León XIV/.test(det) && /Feriado provincial/.test(det), det.replace(/\s+/g, " "));
  await dayLoc(pr.page, "2026-11-23").click({ position: { x: 6, y: 70 } });
  check("al tocar el día se ve el feriado nacional", /Feriado nacional/.test(await dayLoc(pr.page, "2026-11-23").innerText()));
  await pr.page.screenshot({ path: `${OUT}/1-noviembre.png` });

  await pr.page.locator("[data-testid=vm-next]").click();
  await pr.page.waitForFunction(() => document.querySelector("[data-testid=vista-mensual]")?.getAttribute("data-month") === "2026-12-01");
  const dic = await marks(pr.page);
  check("diciembre 2026: 08/12 y 25/12 feriados; 07/12 NO se marca", dic["2026-12-08"] === "nacional" && dic["2026-12-25"] === "nacional" && !("2026-12-07" in dic), JSON.stringify(dic));
  check("el día no laborable (07/12) se ve como un día normal", !(await dayLoc(pr.page, "2026-12-07").innerText()).match(/feriado/i));
  await goTo(pr.page, "2027-01-01");
  check("cambiar de año actualiza: 01/01/2027 feriado y sin marcas de diciembre", (await marks(pr.page))["2027-01-01"] === "nacional" && !("2026-12-08" in (await marks(pr.page))));
  await goTo(pr.page, "2026-11-01");
  check("volver a noviembre repone los mismos feriados", JSON.stringify(await marks(pr.page)) === JSON.stringify(nov));
  await pr.ctx.close();

  // Otros sectores ven exactamente los mismos feriados
  for (const [label, user] of [["Depósito", E2E_USERS.deposito], ["Materias Primas", E2E_USERS.materiaPrima], ["Elaboración", E2E_USERS.elaboracion], ["Envasado Premium", E2E_USERS.envasadoPremium], ["Codificado", E2E_USERS.codificado], ["Dirección", E2E_USERS.direccion]]) {
    const s = await login(user);
    await openMonthly(s.page);
    await goTo(s.page, "2026-11-01");
    check(`${label}: ve los mismos feriados de noviembre`, JSON.stringify(await marks(s.page)) === JSON.stringify(nov));
    await s.ctx.close();
  }

  // Tablet y celular: legible, sin desborde horizontal de la página
  for (const [label, vp] of [["tablet", { width: 820, height: 1100 }], ["celular", { width: 390, height: 844 }]]) {
    const s = await login(E2E_USERS.produccion, vp);
    await openMonthly(s.page);
    await goTo(s.page, "2026-11-01");
    const l = dayLoc(s.page, "2026-11-09").getByTestId("month-holiday-label");
    await l.scrollIntoViewIfNeeded();
    await l.click();
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: el feriado se ve y se abre su detalle sin desbordar la página`, (await l.isVisible()) && (await dayLoc(s.page, "2026-11-09").getByTestId("month-holiday-detail").isVisible()) && overflow <= 1, `overflow=${overflow}`);
    await s.page.screenshot({ path: `${OUT}/2-${label}.png` });
    await s.ctx.close();
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
