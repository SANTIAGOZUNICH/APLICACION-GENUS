// E2E (Chromium real, build de producción, base DESCARTABLE) del panel «Conexión con Google Drive» y de la causa
// que muestra la OE cuando no encuentra su fórmula.
//  - El entorno de prueba NO tiene credenciales de Google: el panel debe decirlo tal cual (sin inventar).
//  - Para ver el panel con una carpeta real armada, la respuesta de la API se reemplaza por DATOS SIMULADOS (marcados así
//    en las capturas). Ninguna prueba toca Google Drive.
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/drive-conexion";
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

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });

const SIMULATED = {
  status: "OK",
  message: "La cuenta de servicio puede leer la carpeta de fórmulas.",
  serviceAccountEmail: "genus-os@laboratorio-ejemplo.iam.gserviceaccount.com",
  folder: { envKey: "GOOGLE_DRIVE_FORMULAS_FOLDER_ID", id: "1AbCdEjemplo", name: "FÓRMULAS MAESTRAS (ejemplo)", url: "https://drive.google.com/drive/folders/1AbCdEjemplo", driveLabel: "Unidad compartida «Laboratorio»", sharedDriveId: "0AEjemplo" },
  index: { builtAt: "2026-10-13T14:05:00.000Z", entryCount: 412, clientCount: 37, ttlMinutes: 10, note: "El índice vive en la memoria del servidor y se rehace cada 10 minutos o con «Actualizar índice». Cada instancia del servidor tiene el suyo." },
  checkedAt: "2026-10-13T14:10:00.000Z",
  scan: {
    clients: [{ name: "ACME COSMÉTICA", indexedFiles: 18 }, { name: "BELLEZA NATURAL", indexedFiles: 9 }, { name: "DERMA LAB", indexedFiles: 0 }],
    indexedCount: 412,
    omitted: [
      { name: "CREMA CORPORAL ALOE.xlsx", path: "ACME COSMÉTICA / 2024", reason: "NESTED", reasonText: "Está dentro de una subcarpeta de la carpeta del cliente: el índice no busca en subcarpetas.", url: "https://drive.google.com/open?id=ejemplo1" },
      { name: "SERUM VIT C.xlsm", path: "BELLEZA NATURAL", reason: "UNSUPPORTED_TYPE", reasonText: "Formato no reconocido por el índice (solo Google Sheets, .xlsx y .xls).", url: "https://drive.google.com/open?id=ejemplo2" },
      { name: "Acceso directo a DERMA LAB", path: "(raíz)", reason: "SHORTCUT", reasonText: "Es un acceso directo: el índice no sigue accesos directos.", detail: "Acceso directo a una carpeta", url: "https://drive.google.com/open?id=ejemplo3" },
    ],
    omittedCounts: { NESTED: 23, UNSUPPORTED_TYPE: 4, SHORTCUT: 1 },
    otherFiles: 58,
    foldersVisited: 64,
    truncated: false,
    folderErrors: [],
  },
  outside: { sharedDrives: [{ name: "Laboratorio", containsRoot: true }, { name: "Calidad", containsRoot: false }], sheetsOutsideRoot: [{ name: "FORMULA SHAMPOO NUEVO.xlsx", url: "https://drive.google.com/open?id=ejemplo4" }], sheetsOutsideRootCount: 6, truncated: false, error: null },
  bank: { counts: { EN_AMBOS: 380, SOLO_DRIVE: 29, SOLO_BANCO: 12, CONFLICTO_BANCO: 2, AMBIGUA_BANCO: 1, REVISION_BANCO: 0 }, rows: [{ client: "ACME COSMÉTICA", product: "GEL FRESH", status: "SOLO_DRIVE" }], truncated: false, error: null },
  limits: [
    "Solo se puede ver lo que está compartido con la cuenta de servicio. Un archivo o carpeta no compartido con ella no aparece ni se puede contar desde GENUS OS.",
    "La búsqueda fuera de la carpeta solo encuentra planillas visibles para la cuenta (compartidas con ella o en unidades compartidas de las que es miembro).",
  ],
};

async function openFormulasAdmin(page) {
  await nav(page, "Mi trabajo").catch(() => {});
  const toggle = page.getByRole("button", { name: /Administración de fórmulas/ });
  await toggle.waitFor({ timeout: 60_000 });
  await toggle.scrollIntoViewIfNeeded();
  if (!(await page.locator("[data-testid=drive-connection-panel]").isVisible().catch(() => false))) await toggle.click();
  await page.locator("[data-testid=drive-connection-panel]").waitFor({ timeout: 30_000 });
}

try {
  // ===== Producción: estado REAL del entorno de prueba (sin credenciales de Google) =====
  const pr = await openAs(E2E_USERS.produccion);
  await openFormulasAdmin(pr.page);
  const panel = pr.page.locator("[data-testid=drive-connection-panel]");
  await pr.page.locator("[data-testid=drive-status]").waitFor({ timeout: 30_000 });
  const t1 = await panel.innerText();
  check("Producción ve el panel «Conexión con Google Drive»", /Conexión con Google Drive/.test(t1));
  check("Sin credenciales en el entorno: lo dice tal cual (no inventa una causa)", /Sin credenciales/.test(t1) && /No hay credenciales de la cuenta de servicio/.test(t1), t1.slice(0, 200));
  check("Botones «Verificar conexión» y «Actualizar índice»", (await pr.page.locator("[data-testid=drive-verify]").isVisible()) && (await pr.page.locator("[data-testid=drive-refresh-index]").isVisible()));
  const apiReal = await pr.page.request.get("/api/v1/formulas/drive-connection?mode=check");
  const apiText = await apiReal.text();
  check("La API no devuelve claves privadas", apiReal.ok() && !/PRIVATE KEY|private_key/i.test(apiText), String(apiReal.status()));
  await panel.screenshot({ path: `${OUT}/01-panel-entorno-prueba-sin-credenciales.png` });
  await pr.page.locator("[data-testid=drive-verify]").click();
  await pr.page.waitForTimeout(1500);
  check("Verificar sin conexión: no intenta explorar", /No se puede explorar la carpeta/.test(await panel.innerText()));

  // ===== Mismo panel con una carpeta armada (DATOS SIMULADOS, sin tocar Drive) =====
  await pr.page.route("**/api/v1/formulas/drive-connection**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().url().includes("mode=check") ? { check: SIMULATED } : { report: SIMULATED }) })
  );
  await pr.page.locator("[data-testid=drive-verify]").click();
  await pr.page.locator("[data-testid=drive-diagnostic]").waitFor({ timeout: 15_000 });
  const t2 = await panel.innerText();
  check("Muestra cuenta, carpeta con enlace, unidad, cantidad y última actualización", /genus-os@laboratorio-ejemplo/.test(t2) && /Abrir en Drive/.test(t2) && /Unidad compartida «Laboratorio»/.test(t2) && /412 en 37 clientes/.test(t2) && /13\/10\/2026/.test(t2));
  check("Diagnóstico de omitidos por motivo", /En subcarpetas de un cliente: 23/.test(t2) && /Formato no reconocido: 4/.test(t2) && /Accesos directos: 1/.test(t2));
  check("Fuera de la carpeta y comparación con el banco", /Planillas que la cuenta ve fuera de la carpeta raíz: 6/.test(t2) && /Solo en Drive: 29/.test(t2) && /Conflicto en el banco: 2/.test(t2));
  await pr.page.getByText("Ver archivos y motivo").click();
  await pr.page.waitForTimeout(300);
  await panel.screenshot({ path: `${OUT}/02-panel-datos-simulados.png` });
  await pr.page.unroute("**/api/v1/formulas/drive-connection**");

  // ===== Permisos =====
  const el = await openAs(E2E_USERS.elaboracion);
  const asElab = await el.page.request.get("/api/v1/formulas/drive-connection?mode=check");
  check("Elaboración no accede al diagnóstico (403)", asElab.status() === 403, String(asElab.status()));
  const refreshElab = await el.page.request.post("/api/v1/formulas/drive-connection", { data: { action: "refresh" } });
  check("Elaboración no puede actualizar el índice (403)", refreshElab.status() === 403);

  // ===== OE sin fórmula: la causa comprobada =====
  const product = `PRODUCTO SIN FORMULA DRIVE ${Date.now().toString().slice(-5)}`;
  const today = new Date().toISOString().slice(0, 10);
  const asg = await pr.page.request.post("/api/v1/work-assignments", {
    data: { sector: "ELABORACION", client: "CLIENTE DIAG E2E", product, plannedQuantity: "50", unit: "kg", plannedDate: today, branchOwner: "Cristian", orderNumber: `OE-2026-99${Date.now().toString().slice(-4)}`, packagingLote: "L-DIAG", idempotencyKey: randomUUID() },
  });
  const asgBody = await asg.json();
  const [oe] = await q("select order_number, form_data from operational_orders where id = $1", [asgBody.order?.id]);
  const f = oe?.form_data?.autoPrep?.formula;
  check(
    "OE sin fórmula: causa «no está en el banco y Drive no está configurado» (lo que realmente pasa en este entorno)",
    f?.cause === "DRIVE_SIN_CONFIGURAR" && /no está en el banco de fórmulas y Google Drive no está configurado/.test(f?.message ?? ""),
    JSON.stringify(f ?? {}).slice(0, 200)
  );
  await nav(el.page, "Órdenes de Elaboración");
  await el.page.getByPlaceholder("Número, producto, código, cliente, lote…").fill(oe.order_number);
  await el.page.getByText(/^1 resultado$/).waitFor({ timeout: 60_000 });
  await el.page.waitForTimeout(800);
  await el.page.getByRole("button", { name: /^Abrir$/ }).first().click();
  await el.page.locator("[data-testid=oe-autoprep-formula-cause]").waitFor({ timeout: 60_000 });
  const cause = await el.page.locator("[data-testid=oe-autoprep-formula-cause]").innerText();
  check("El elaborador ve la causa en la OE", /No está en el banco y Google Drive no está configurado/i.test(cause), cause);
  await el.page.locator("[data-testid=oe-autoprep-panel]").screenshot({ path: `${OUT}/03-oe-causa-sin-formula.png` });

  // ===== Nada se escribió en el banco de fórmulas =====
  const [bank] = await q("select count(*)::int n from formula_products where normalized_product like '%producto sin formula drive%'");
  check("El banco de fórmulas no se modificó", bank.n === 0);

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
