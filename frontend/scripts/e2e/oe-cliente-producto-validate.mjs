// E2E (Chromium real, build de producción, base DESCARTABLE): Cliente y Producto del trabajo asignado se mantienen en
// la OE. Caso real: FIRMEA · ACEITE REAFIRMANTE · 2.500 kg, sin fórmula y sin lote de fabricación. Antes, con el
// catálogo de clientes de Drive cargado, entrar al campo «Cliente» de la OE y salir sin cambiar nada borraba el
// Producto y lo guardaba (Producto: —). Verifica también que cambiar de cliente de verdad sigue limpiando el producto y
// que una OE ya afectada se repara con «Actualizar desde fórmula» (vuelve a tomar Cliente y Producto del trabajo).
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
const OUT = process.env.OUT ?? "/tmp/oe-cliente-producto";
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

const CLIENT = "FIRMEA";
const PRODUCT = "ACEITE REAFIRMANTE";
const OE = "OE-2026-990301";

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // Catálogo de clientes como el de Drive en Production: FIRMEA figura (con otra grafía) y hay otro cliente.
  await page.route(/\/api\/v1\/formulas\/options\?.*scope=clients/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ source: "DRIVE", clients: [{ client: process.env.CAT_LABEL ?? "Firmea", source: "DRIVE" }, { client: "OTRO CLIENTE E2E", source: "DRIVE" }] }),
    })
  );
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const oeRow = async () => (await q("select * from operational_orders where order_number = $1", [OE]))[0];
const header = async () => {
  const r = await oeRow();
  return { client: r.form_data.header.client, product: r.form_data.header.productName, colClient: r.client, colProduct: r.product, version: r.version };
};

async function openOe(page) {
  await page.goto("/");
  await nav(page, "Órdenes de Elaboración");
  await page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(OE);
  await page.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
  const lista = page.getByText("Ver como lista");
  if (await lista.isVisible().catch(() => false)) await lista.click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Abrir$/ }).first().click({ force: true });
  await page.locator("[data-testid=oe-autoprep-panel]").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500); // búsqueda automática de fórmula al abrir
}
/** Entra al campo Cliente y elige en la lista el MISMO cliente que ya tiene la OE (lo que hace cualquiera al revisar). */
async function reselectSameClient(page) {
  await page.locator("[data-testid=oe-client-combobox-input]").click();
  await page.getByRole("option", { name: new RegExp(`^${process.env.CAT_LABEL ?? "Firmea"}`, "i") }).first().click({ timeout: 15_000 });
  await page.waitForTimeout(3000);
}
/** Entra al campo Cliente y sale sin cambiar nada. */
async function focusAndLeaveClient(page) {
  await page.locator("[data-testid=oe-client-combobox-input]").click();
  await page.waitForTimeout(1200);
  await page.mouse.click(700, 140);
  await page.waitForTimeout(3000);
}

try {
  const prev = await q("select id from operational_orders where order_number = $1", [OE]);
  for (const r of prev) {
    await q("delete from order_audit_events where order_id = $1", [r.id]);
    await q("delete from order_versions where order_id = $1", [r.id]);
  }
  await q("delete from operational_orders where order_number = $1", [OE]);
  await q("delete from work_items where client = $1 and product = $2", [CLIENT, PRODUCT]);

  // ===== Producción asigna el trabajo a Elaboración (pantalla real), sin lote =====
  const pr = await openAs(E2E_USERS.produccion);
  await nav(pr.page, "Elaboración");
  await pr.page.locator("[data-testid=open-assign-work-dialog]").click({ timeout: 60_000 });
  await pr.page.locator("#af-client").fill(CLIENT);
  await pr.page.locator("#af-product").fill(PRODUCT);
  await pr.page.locator("#af-qty").fill("2500");
  await pr.page.locator("[data-testid=assign-oa-number]").fill(OE);
  await pr.page.locator("[data-testid=assign-submit]").click();
  await pr.page.waitForFunction(() => /OE preparada|OE lista/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});

  const row = await oeRow();
  const ap = row?.form_data?.autoPrep;
  check("Transferencia trabajo → OE: Cliente FIRMEA y Producto ACEITE REAFIRMANTE en encabezado y columnas", row?.form_data?.header?.client === CLIENT && row?.form_data?.header?.productName === PRODUCT && row?.client === CLIENT && row?.product === PRODUCT);
  check("Cantidad 2.500 kg y lote de fabricación pendiente", row?.form_data?.header?.quantityKg === 2500 && ap?.lotFabricacion?.status === "pendiente");
  check("La búsqueda de fórmula usó FIRMEA y ACEITE REAFIRMANTE", /«ACEITE REAFIRMANTE» \(FIRMEA\)/.test(ap?.formula?.message ?? ""), ap?.formula?.message);

  // ===== Producción abre la OE y pasa por el campo Cliente sin cambiarlo =====
  await openOe(pr.page);
  const v0 = (await header()).version;
  await focusAndLeaveClient(pr.page);
  const h0 = await header();
  check("Entrar y salir de «Cliente» sin cambiarlo NO borra el Producto", h0.product === PRODUCT && h0.client === CLIENT, JSON.stringify(h0));
  await reselectSameClient(pr.page);
  const h1 = await header();
  check("Elegir en la lista el MISMO cliente (FIRMEA, aunque el catálogo lo escriba distinto) NO borra el Producto", h1.product === PRODUCT && h1.colProduct === PRODUCT && h1.client === CLIENT, JSON.stringify(h1));
  check("…ni guarda una versión nueva", h1.version === v0, `${v0} → ${h1.version}`);
  const panel1 = await pr.page.locator("[data-testid=oe-autoprep-product]").innerText();
  check("Arriba se sigue viendo Producto: ACEITE REAFIRMANTE", panel1 === PRODUCT, panel1);
  await pr.page.screenshot({ path: `${OUT}/01-produccion-cliente-sin-cambios.png`, fullPage: true });

  // ===== Elaboración abre la misma OE =====
  const el = await openAs(E2E_USERS.elaboracion);
  await openOe(el.page);
  await focusAndLeaveClient(el.page);
  const h2 = await header();
  check("Elaboración abre la OE: Cliente y Producto intactos", h2.product === PRODUCT && h2.client === CLIENT, JSON.stringify(h2));
  await el.page.screenshot({ path: `${OUT}/02-elaboracion-oe.png`, fullPage: true });

  // ===== Cambiar de cliente de verdad sigue limpiando el producto (comportamiento esperado) =====
  await pr.page.locator("[data-testid=oe-client-combobox-input]").click();
  await pr.page.locator("[data-testid=oe-client-combobox-input]").fill("OTRO CLIENTE E2E");
  await pr.page.getByRole("option", { name: /OTRO CLIENTE E2E/ }).first().click();
  await pr.page.waitForTimeout(3000);
  const h3 = await header();
  check("Elegir OTRO cliente sí limpia el producto (no queda un producto de otro cliente)", h3.client === "OTRO CLIENTE E2E" && h3.product === "", JSON.stringify(h3));

  // ===== Reparación: «Actualizar desde fórmula» vuelve a tomar Cliente y Producto del trabajo =====
  await pr.page.locator("[data-testid=oe-autoprep-refresh]").click();
  await pr.page.locator("[data-testid=oe-autoprep-preview]").waitFor({ timeout: 30_000 });
  await pr.page.screenshot({ path: `${OUT}/03-produccion-vista-previa-reparacion.png`, fullPage: true });
  await pr.page.locator("[data-testid=oe-autoprep-confirm]").click();
  const end = Date.now() + 20_000;
  let h4 = await header();
  while (Date.now() < end && h4.product !== PRODUCT) {
    await new Promise((r) => setTimeout(r, 300));
    h4 = await header();
  }
  check("«Actualizar desde fórmula» repara la OE: Cliente FIRMEA y Producto ACEITE REAFIRMANTE desde el trabajo", h4.client === CLIENT && h4.product === PRODUCT && h4.colClient === CLIENT && h4.colProduct === PRODUCT, JSON.stringify(h4));
  const [work] = await q("select client, product, planned_quantity from work_items where order_id = $1", [row.id]);
  check("El trabajo no se modificó", work.client === CLIENT && work.product === PRODUCT && work.planned_quantity === "2500");
  await pr.page.waitForTimeout(1500);
  await pr.page.screenshot({ path: `${OUT}/04-produccion-reparada.png`, fullPage: true });

  await el.ctx.close();
  await pr.ctx.close();
} catch (err) {
  console.error(err);
  check("ejecución sin excepciones", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
