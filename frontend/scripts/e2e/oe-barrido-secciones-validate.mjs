// E2E (Chromium real, base DESCARTABLE): barrido de secciones por sector y dispositivo.
// Falla ante CUALQUIER excepción no controlada de React/JS, pantalla de error de Next («This page couldn't load» /
// «Application error»), respuesta 5xx de la API o error de consola «Error». Incluye Órdenes de Elaboración con una OE
// real: listado, apertura del editor y de una OE entregada/archivada.
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
const OUT = process.env.OUT ?? "/tmp/oe-barrido";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

const SAMSUNG_TAB_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEVICES = {
  escritorio: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true, userAgent: SAMSUNG_TAB_UA },
  tabletVertical: { viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, userAgent: SAMSUNG_TAB_UA },
  celular: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

const BAD_TEXT = /This page couldn.t load|Application error|client-side exception|Something went wrong/i;
const IGNORED_CONSOLE = [/Download the React DevTools/i, /favicon/i, /\[Fast Refresh\]/i, /Failed to load resource.*(401|403|404)/i];

async function openAs(user, device) {
  const ctx = await browser.newContext({ baseURL: BASE, ...device });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!IGNORED_CONSOLE.some((re) => re.test(t))) problems.push(`console: ${t.slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`);
    else if (r.status() === 400) problems.push(`HTTP 400 ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page, problems };
}

const settle = (page) => page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
async function bodyBad(page) {
  const txt = (await page.locator("body").innerText().catch(() => "")) ?? "";
  return BAD_TEXT.test(txt) ? txt.slice(0, 200) : "";
}

/** Etiquetas de navegación visibles (barra lateral o inferior). */
async function navLabels(page) {
  return page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll("nav a, nav button, aside a, aside button")) {
      const t = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (t && t.length < 40 && !/^(salir|cerrar sesi)/i.test(t)) out.add(t);
    }
    return [...out];
  });
}

// --- OE de prueba (Producción) -------------------------------------------------------------------------------------
const PRODUCT = "BARRIDO E2E NUEVA";
const PRODUCT_LEGACY = "BARRIDO E2E LEGACY";
const prod = await openAs(E2E_USERS.produccion, DEVICES.escritorio);
await q("delete from operational_orders where product = any($1)", [[PRODUCT, PRODUCT_LEGACY]]);
const today = new Date().toISOString().slice(0, 10);
for (const [lot, kg, prodName] of [["BAR-1", 25, PRODUCT], ["BAR-2", 40, PRODUCT_LEGACY]]) {
  const res = await prod.page.request.post("/api/v1/orders", { data: { type: "OE", fromScratch: true, product: prodName, code: "PT-BAR", client: "CLIENTE BARRIDO", lot, assignedSector: "ELABORACION" } });
  if (!res.ok()) throw new Error(`crear OE: ${res.status()} ${await res.text()}`);
  const o = (await res.json()).order;
  const fd = o.formData;
  fd.header = { ...fd.header, productName: prodName, code: "PT-BAR", date: today, quantityKg: kg, lot, client: "CLIENTE BARRIDO" };
  fd.materials = [{ id: "m1", codigoMp: "", kgReal: null, ajuste: null, ajusteMotivo: "", ajusteAt: null, ajusteBy: null, lote: "", parentRowId: null, kgAPesar: null, name: "AGUA", percent: 100, pct: 100 }];
  const put = await prod.page.request.patch(`/api/v1/orders/${o.id}`, { data: { formData: fd, expectedVersion: o.version } });
  if (!put.ok()) console.log(`WARN patch OE ${lot}: ${put.status()} ${(await put.text()).slice(0, 200)}`);
}
// OE «legada»: guardada ANTES de #125 (sin codigoMp / kgReal / parentRowId / ajuste*), como las que hay en Production.
await q(
  `update operational_orders set form_data = jsonb_set(form_data, '{materials}', (select coalesce(jsonb_agg(m - 'codigoMp' - 'kgReal' - 'parentRowId' - 'ajusteMotivo' - 'ajusteAt' - 'ajusteBy' - 'lote'), '[]'::jsonb) from jsonb_array_elements(form_data->'materials') m)) where product = $1`,
  [PRODUCT_LEGACY]
);
await prod.ctx.close();

// --- Barrido -------------------------------------------------------------------------------------------------------
const only = (env) => (process.env[env] ? process.env[env].split(",") : null);
const onlyDevices = only("BARRIDO_DEVICES");
const onlyUsers = only("BARRIDO_USERS");
for (const [deviceName, device] of Object.entries(DEVICES)) {
  if (onlyDevices && !onlyDevices.includes(deviceName)) continue;
  for (const [userKey, user] of Object.entries(E2E_USERS)) {
    if (onlyUsers && !onlyUsers.includes(userKey)) continue;
    const { ctx, page, problems } = await openAs(user, device);
    await settle(page);
    const tag = `${deviceName}/${userKey}`;
    check(`${tag}: pantalla inicial sin error`, !(await bodyBad(page)) && problems.length === 0, problems.join(" | ") || (await bodyBad(page)));
    const labels = await navLabels(page);
    for (const label of labels) {
      const before = problems.length;
      const target = page.locator("nav, aside").getByText(label, { exact: true }).first();
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.click({ timeout: 10_000 }).catch(() => {});
      await settle(page);
      await page.waitForTimeout(500);
      const bad = await bodyBad(page);
      const newProblems = problems.slice(before);
      check(`${tag}: «${label}» carga sin error`, !bad && newProblems.length === 0, [bad, ...newProblems].filter(Boolean).join(" | "));
      if (/[oó]rden/i.test(label)) {
        // OE: abrir el editor de una OE nueva y de una OE legada (guardada antes de #125).
        for (const prodName of [PRODUCT, PRODUCT_LEGACY]) {
          await page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(prodName).catch(() => {});
          await page.waitForTimeout(1200);
          const lista = page.getByText("Ver como lista");
          if (await lista.isVisible().catch(() => false)) {
            await lista.click();
            await page.waitForTimeout(600);
          }
          const row = page.getByText(prodName).first();
          const visible = await row.isVisible().catch(() => false);
          check(`${tag}: OE ${prodName} visible en el listado`, visible || userKey !== "produccion", "no aparece en el listado");
          if (!visible) {
            await page.screenshot({ path: `${OUT}/${deviceName}-${userKey}-oe-listado.png` });
            continue;
          }
          const b2 = problems.length;
          await page.getByRole("button", { name: "Abrir" }).first().click().catch(() => row.click().catch(() => {}));
          await settle(page);
          await page.waitForTimeout(2500);
          const bad2 = await bodyBad(page);
          const tabla = await page.locator("[data-testid=oe-materials-table]").count();
          check(`${tag}: editor de OE ${prodName} abre sin error`, !bad2 && problems.slice(b2).length === 0, [bad2, ...problems.slice(b2)].filter(Boolean).join(" | "));
          check(`${tag}: editor de OE ${prodName} muestra la tabla de materias primas`, tabla > 0, "sin tabla de MP");
          await page.screenshot({ path: `${OUT}/${deviceName}-${userKey}-oe-${prodName.includes("LEGACY") ? "legada" : "nueva"}.png` });
          await page.goto("/").catch(() => {});
          await settle(page);
          await page.locator("nav, aside").getByText(label, { exact: true }).first().click({ timeout: 10_000 }).catch(() => {});
          await settle(page);
        }
      }
    }
    await ctx.close();
  }
}

await q("delete from operational_orders where product = any($1)", [[PRODUCT, PRODUCT_LEGACY]]);
await pool.end();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
