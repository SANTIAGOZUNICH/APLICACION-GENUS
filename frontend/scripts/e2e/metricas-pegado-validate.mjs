// E2E en Chromium real: Métricas — pegado desde Excel/Sheets, duplicados, edición por celda, concurrencia y permisos.
// Base DESCARTABLE (marca verificada) y login real; nunca Google, Neon ni Production. Ver run-metricas-pegado-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/metricas-pegado";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const metric = async (resp) => (await q("select *, to_char(metric_date, 'YYYY-MM-DD') as d from packaging_metrics where responsible_display = $1 and deleted_at is null order by metric_date, product", [resp]));
const byProduct = async (p) => (await q("select * from packaging_metrics where product = $1 and deleted_at is null", [p]))[0];
const audit = async (action) => (await q("select * from feature_audit_events where domain = 'metricas' and action = $1 order by created_at", [action]));
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

async function cleanup() {
  await q("delete from packaging_metrics where responsible_display like 'E2E %'");
  await q("delete from feature_audit_events where domain = 'metricas'");
}

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const openMetricas = async (page) => {
  await page.goto("/mi-trabajo");
  // En celular el menú lateral está oculto detrás del botón «Abrir menú».
  const burger = page.getByRole("button", { name: "Abrir menú" });
  if (await burger.isVisible().catch(() => false)) await burger.click();
  await nav(page, "Métricas");
  await page.locator("[data-testid=metricas-pegar-excel]").waitFor({ timeout: 120_000 });
};
async function cell(page, rowValue, title) {
  const pos = await page.evaluate(([v, title]) => {
    const rows = [...document.querySelectorAll(".dsg-row")];
    const header = rows.find((r) => r.classList.contains("dsg-row-header"));
    const col = [...header.querySelectorAll(".dsg-cell")].findIndex((c) => c.textContent.trim() === title);
    const ri = rows.findIndex((r) => [...r.querySelectorAll("input")].some((i) => i.value === v));
    return { col, ri };
  }, [rowValue, title]);
  if (pos.col < 0 || pos.ri < 0) throw new Error(`celda no encontrada: ${rowValue} / ${title} ${JSON.stringify(pos)}`);
  return page.locator(".dsg-row").nth(pos.ri).locator(".dsg-cell").nth(pos.col);
}
const waitRow = (page, value) => page.waitForFunction((v) => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value === v), value, { timeout: 60_000 });
const pasteDialog = async (page, text, sector) => {
  await page.locator("[data-testid=metricas-pegar-excel]").click();
  if (sector) await page.locator("[data-testid=metricas-paste-sector]").selectOption(sector);
  await page.locator("[data-testid=metricas-paste-textarea]").fill(text);
};
const summary = (page) => page.locator("[data-testid=metricas-paste-summary]").innerText();
const confirmBtn = (page) => page.locator("[data-testid=metricas-paste-confirm]");

try {
  await cleanup();
  const prod = await openAs(E2E_USERS.produccion);
  const pp = prod.page;
  await openMetricas(pp);

  // ===== 1. Pegado de varias filas y columnas (tabuladores, coma decimal, fechas dd/mm/aaaa) =====
  const tsv1 = ["15/10/2026\tE2E SHAMPOO\t1.200\tE2E Ana", "16/10/2026\tE2E CREMA\t800,0\tE2E Ana", "17/10/2026\tE2E GEL\t350\tE2E Ana"].join("\r\n") + "\r\n";
  await pasteDialog(pp, tsv1, "ENVASADO_MASIVO");
  await pp.locator("[data-testid=metricas-paste-row]").nth(2).waitFor();
  check("pegado de 3 filas × 4 columnas: se interpretan todas, sin error", (await pp.locator("[data-testid=metricas-paste-row]").count()) === 3 && (await pp.locator("[data-error='1']").count()) === 0);
  await pp.waitForFunction(() => /3 nuevas/.test(document.querySelector("[data-testid=metricas-paste-summary]")?.textContent ?? ""), null, { timeout: 30_000 });
  check("la vista previa dice 3 nuevas (el servidor revisó duplicados)", /3 nuevas/.test(await summary(pp)), await summary(pp));
  check("nada se guarda antes de confirmar", (await metric("E2E Ana")).length === 0);
  await pp.screenshot({ path: `${OUT}/1-paste-preview-desktop.png` });
  await confirmBtn(pp).click();
  await pp.locator("[data-testid=metricas-paste-result]").waitFor();
  const rows1 = await metric("E2E Ana");
  check("confirmar crea 3 registros con unidades correctas (1.200→1200, 800,0→800)", rows1.length === 3 && rows1.map((r) => r.units).join() === "1200,800,350", rows1.map((r) => r.units).join());
  check("fechas dd/mm/aaaa guardadas como ISO (2026-10-15…)", rows1.map((r) => r.d).join() === "2026-10-15,2026-10-16,2026-10-17", rows1.map((r) => r.d).join());
  check("auditoría: 3 altas por pegado + el evento del lote", (await audit("create")).length === 3 && (await audit("import")).length === 1);
  await pp.locator("[data-testid=metricas-paste-close]").click();
  await waitRow(pp, "E2E SHAMPOO");
  check("la planilla muestra lo pegado tras cerrar", true);

  // ===== 2. Duplicados: pegar lo mismo no duplica =====
  await pasteDialog(pp, tsv1, "ENVASADO_MASIVO");
  await pp.waitForFunction(() => /3 ya existen iguales/.test(document.querySelector("[data-testid=metricas-paste-summary]")?.textContent ?? ""), null, { timeout: 30_000 });
  check("pegar lo mismo: las 3 figuran «ya existen iguales» y no hay nada para importar", (await confirmBtn(pp).isDisabled()));
  check("no se crean duplicados (siguen 3)", (await metric("E2E Ana")).length === 3);
  await pp.keyboard.press("Escape");

  // ===== 3. Existe con otras unidades: pide confirmación =====
  await pasteDialog(pp, "15/10/2026\tE2E SHAMPOO\t1500\tE2E Ana\n18/10/2026\tE2E SERUM\t90\tE2E Ana", "ENVASADO_MASIVO");
  await pp.waitForFunction(() => /1 nuevas.*1 existen con otras unidades/.test(document.querySelector("[data-testid=metricas-paste-summary]")?.textContent ?? ""), null, { timeout: 30_000 });
  await confirmBtn(pp).click(); // sin tildar «Pisar unidades»
  await pp.locator("[data-testid=metricas-paste-result]").waitFor();
  const rows3 = await metric("E2E Ana");
  check("sin confirmar: crea solo la nueva y NO pisa las unidades existentes (siguen 1200)", rows3.length === 4 && rows3.find((r) => r.product === "E2E SHAMPOO").units === 1200);
  await pp.locator("[data-testid=metricas-paste-close]").click();
  await pasteDialog(pp, "15/10/2026\tE2E SHAMPOO\t1500\tE2E Ana", "ENVASADO_MASIVO");
  await pp.waitForFunction(() => /1 existen con otras unidades/.test(document.querySelector("[data-testid=metricas-paste-summary]")?.textContent ?? ""), null, { timeout: 30_000 });
  check("con una fila en conflicto, importar sigue deshabilitado hasta confirmar", await confirmBtn(pp).isDisabled());
  await pp.locator("[data-testid=metricas-paste-overwrite]").check();
  await confirmBtn(pp).click();
  await pp.locator("[data-testid=metricas-paste-result]").waitFor();
  const up = (await audit("update")).at(-1);
  check("confirmando «Pisar unidades»: actualiza (1500) y audita antes/después", (await metric("E2E Ana")).find((r) => r.product === "E2E SHAMPOO").units === 1500 && up?.payload?.before?.units === 1200 && up?.payload?.after?.units === 1500 && up?.payload?.via === "paste");
  await pp.locator("[data-testid=metricas-paste-close]").click();

  // ===== 4. Errores de validación por celda =====
  await pasteDialog(pp, "31/02/2026\tE2E MALO\t12,5\t\n19/10/2026\tE2E OK\t10\tE2E Ana", "ENVASADO_MASIVO");
  await pp.locator("[data-testid=metricas-paste-row]").nth(1).waitFor();
  const errRow = pp.locator("[data-testid=metricas-paste-row]").first();
  check("errores en las celdas correctas: fecha, unidades y responsable", (await errRow.locator("[data-error='1']").count()) === 3 && (await errRow.locator("[data-testid=metricas-paste-cell-error]").allInnerTexts()).join(" ").match(/fecha real.*entero.*Responsable/s) !== null);
  await pp.screenshot({ path: `${OUT}/2-paste-errores.png` });
  await errRow.locator("[data-testid=metricas-paste-cell-metricDate]").fill("20/10/2026");
  await errRow.locator("[data-testid=metricas-paste-cell-units]").fill("12");
  await errRow.locator("[data-testid=metricas-paste-cell-responsibleDisplay]").fill("E2E Ana");
  await pp.waitForFunction(() => /2 nuevas/.test(document.querySelector("[data-testid=metricas-paste-summary]")?.textContent ?? ""), null, { timeout: 30_000 });
  await confirmBtn(pp).click();
  await pp.locator("[data-testid=metricas-paste-result]").waitFor();
  check("corregir la celda en la vista previa y confirmar guarda ambas filas", (await metric("E2E Ana")).length === 6);
  await pp.locator("[data-testid=metricas-paste-close]").click();

  // ===== 5. Edición por celda (persistente y auditada) =====
  await waitRow(pp, "E2E OK");
  const u = await cell(pp, "E2E OK", "Unidades");
  await u.dblclick();
  await pp.keyboard.press("ControlOrMeta+A");
  await pp.keyboard.type("2.500");
  await pp.keyboard.press("Enter");
  check("editar Unidades en la celda con punto de miles (2.500): se guarda 2500", await waitDb(async () => (await metric("E2E Ana")).find((r) => r.product === "E2E OK")?.units === 2500));
  const ge = (await audit("update")).at(-1);
  check("la edición por celda queda auditada (via=grid, antes 10, después 2500)", ge?.payload?.via === "grid" && ge?.payload?.before?.units === 10 && ge?.payload?.after?.units === 2500);
  await pp.reload();
  await nav(pp, "Métricas");
  await waitRow(pp, "E2E OK");
  check("tras recargar, el valor persiste", (await (await cell(pp, "E2E OK", "Unidades")).locator("input").inputValue()) === "2500");

  // Pegado de rango sobre celdas existentes (2 columnas × 2 filas) desde el portapapeles real del navegador
  await pp.evaluate(() => navigator.clipboard.writeText("1.111\tE2E Luis\n2.222\tE2E Luis"));
  const anchor = await cell(pp, "E2E OK", "Unidades");
  await anchor.click();
  await pp.keyboard.press("ControlOrMeta+V");
  const applyBtn = pp.locator("[data-testid=metricas-grid-preview-apply]");
  if (await applyBtn.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await applyBtn.click();
  check("Ctrl+V de un rango 2×2 desde Excel: actualiza unidades y responsable de filas contiguas", await waitDb(async () => (await q("select count(*)::int n from packaging_metrics where responsible_display = 'E2E Luis' and units in (1111, 2222)"))[0].n === 2));
  await pp.screenshot({ path: `${OUT}/3-grid-pegado-rango.png` });

  // Valor inválido en la celda: no se guarda y se explica
  const bad = await cell(pp, "E2E CREMA", "Unidades");
  await bad.dblclick();
  await pp.keyboard.press("ControlOrMeta+A");
  await pp.keyboard.type("12,5");
  await pp.keyboard.press("Enter");
  await pp.waitForTimeout(800);
  check("unidades con decimales en la celda: NO se guarda (queda 800)", (await byProduct("E2E CREMA")).units === 800);

  // ===== 6. Concurrencia: otra persona edita mientras se tiene la planilla abierta =====
  await q("update packaging_metrics set units = 777, updated_at = now() + interval '1 second' where responsible_display = 'E2E Ana' and product = 'E2E GEL'");
  const g = await cell(pp, "E2E GEL", "Unidades");
  await g.dblclick();
  await pp.keyboard.press("ControlOrMeta+A");
  await pp.keyboard.type("999");
  await pp.keyboard.press("Enter");
  await pp.waitForTimeout(1500);
  check("conflicto de versión: no se pisa el valor de la otra persona (sigue 777)", (await byProduct("E2E GEL")).units === 777);

  // ===== 7. Permisos =====
  const masivo = await openAs(E2E_USERS.envasado);
  const premium = await openAs(E2E_USERS.envasadoPremium);
  const calidad = await openAs(E2E_USERS.calidad);
  const elab = await openAs(E2E_USERS.elaboracion);
  const post = (page, data) => page.request.post("/api/v1/metricas", { data });
  const own = await post(masivo.page, { action: "import_commit", batchId: "e2e-perm-0001", rows: [{ metricDate: "2026-10-21", product: "E2E PROPIO", units: 5, responsibleDisplay: "E2E Masivo", sector: "ENVASADO_MASIVO" }] });
  check("Envasado Masivo carga en su sector", own.ok() && (await own.json()).created === 1);
  const other = await post(masivo.page, { action: "import_commit", batchId: "e2e-perm-0002", rows: [{ metricDate: "2026-10-21", product: "E2E AJENO", units: 5, responsibleDisplay: "E2E Masivo", sector: "ENVASADO_PREMIUM" }] });
  const otherJ = await other.json();
  check("Envasado Masivo NO puede cargar en Premium (fila rechazada, nada guardado)", otherJ.created === 0 && otherJ.results[0].outcome === "invalid" && (await metric("E2E Masivo")).every((r) => r.sector === "ENVASADO_MASIVO"));
  const premList = await (await premium.page.request.get("/api/v1/metricas")).json();
  check("Envasado Premium no ve las métricas de Masivo", (premList.metrics ?? []).every((m) => m.sector === "ENVASADO_PREMIUM"));
  check("Calidad no accede a Métricas (403) ni para pegar", (await calidad.page.request.get("/api/v1/metricas")).status() === 403 && (await post(calidad.page, { action: "import_preview", rows: [] })).status() === 403);
  check("Elaboración tampoco (403)", (await post(elab.page, { action: "import_commit", batchId: "e2e-perm-0003", rows: [{ metricDate: "2026-10-21", units: 1, responsibleDisplay: "E2E X", sector: "ENVASADO_MASIVO" }] })).status() === 403);
  const edit = await post(premium.page, { action: "update", id: (await metric("E2E Masivo"))[0].id, units: 1 });
  check("Premium no puede editar un registro de Masivo", !edit.ok() && (await metric("E2E Masivo"))[0].units === 5);
  const replay = await post(masivo.page, { action: "import_commit", batchId: "e2e-perm-0001", rows: [{ metricDate: "2026-10-21", product: "E2E PROPIO", units: 5, responsibleDisplay: "E2E Masivo", sector: "ENVASADO_MASIVO" }] });
  check("reintentar el mismo lote es idempotente (sin duplicados)", (await replay.json()).idempotentReplay === true && (await metric("E2E Masivo")).length === 1);
  const dupConc = await Promise.all([1, 2, 3].map(() => post(masivo.page, { action: "import_commit", batchId: "e2e-conc-0001", rows: [{ metricDate: "2026-10-22", product: "E2E CONC", units: 7, responsibleDisplay: "E2E Conc", sector: "ENVASADO_MASIVO" }] })));
  check("3 confirmaciones simultáneas del mismo lote: un solo registro", (await metric("E2E Conc")).length === 1, dupConc.map((r) => r.status()).join(","));

  // ===== 8. Responsive: tablet y celular (sin scroll horizontal de la página) =====
  for (const [name, vp] of [["tablet", { width: 820, height: 1100 }], ["mobile", { width: 390, height: 844 }]]) {
    const r = await openAs(E2E_USERS.produccion, vp);
    await openMetricas(r.page);
    await r.page.locator("[data-testid=metricas-pegar-excel]").click();
    await r.page.locator("[data-testid=metricas-paste-textarea]").fill("23/10/2026\tE2E RESP\t10\tE2E Resp");
    await r.page.locator("[data-testid=metricas-paste-row]").first().waitFor();
    const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const dlg = await r.page.locator("[data-testid=metricas-paste-dialog]").boundingBox();
    check(`${name}: el diálogo de pegado entra en pantalla y la página no hace scroll horizontal`, !overflow && dlg && dlg.width <= vp.width);
    await r.page.screenshot({ path: `${OUT}/4-paste-${name}.png` });
    await r.ctx.close();
  }
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
