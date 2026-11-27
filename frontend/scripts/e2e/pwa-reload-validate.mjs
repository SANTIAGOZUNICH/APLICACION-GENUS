// E2E: el SW interno de GENUS OS NO debe recargar la pestaña sola (perdía lo escrito en formularios, p. ej. «Crear acceso»).
// Chromium, build de producción, SW habilitado. Escenarios:
//   1) carga limpia con Dirección → panel «Usuarios del portal» → se escribe en el formulario → 15 s sin recargas.
//   2) SW de un build ANTERIOR ya instalado (app instalada tras un deploy), repetido N veces (la recarga dependía de una carrera).
import { chromium } from "playwright";
import { assertE2eEnvironment } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const RUNS = Number(process.env.GENUS_E2E_PWA_RUNS ?? 8);
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

async function newPage() {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const loads = [];
  page.on("load", () => loads.push("load"));
  return { ctx, page, loads };
}

// ───── 1) carga limpia + formulario ─────
{
  const { ctx, page, loads } = await newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.direccion.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.getByText("Portal de Clientes").first().click();
  await page.getByTestId("portal-users").waitFor({ timeout: 30000 });
  const form = page.getByTestId("user-form");
  const user = form.getByLabel("Usuario", { exact: true });
  await user.waitFor();
  await user.fill("escribiendo-algo");
  await page.evaluate(() => { window.__marker = "vivo"; });
  const baseline = loads.length;
  await page.waitForTimeout(15000);
  check("carga limpia: la página NO se recargó sola en 15 s", (await page.evaluate(() => window.__marker).catch(() => null)) === "vivo" && loads.length === baseline);
  check("carga limpia: el formulario conserva lo escrito", (await user.inputValue().catch(() => null)) === "escribiendo-algo");
  await ctx.close();
}

// ───── 2) SW viejo instalado → carga del build nuevo ─────
let reloads = 0;
for (let i = 0; i < RUNS; i += 1) {
  const { ctx, page } = await newPage();
  await page.goto("/login");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?build=OLDBUILD", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes("OLDBUILD"), null, { timeout: 15000 });
  await page.goto("/login"); // documento nuevo, controlado por el SW viejo; la app registra el SW del build actual
  await page.evaluate(() => { window.__marker0 = "vivo"; });
  await page.waitForTimeout(3500);
  const alive = await page.evaluate(() => window.__marker0).catch(() => null);
  if (alive !== "vivo") reloads += 1;
  await ctx.close();
}
check(`SW viejo ya instalado: 0 recargas automáticas en ${RUNS} intentos`, reloads === 0, `recargas=${reloads}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
if (failed.length) process.exit(1);
