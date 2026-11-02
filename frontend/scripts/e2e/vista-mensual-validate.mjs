// E2E en Chromium real: VISTA MENSUAL compartida (Premium | Masivo | Elaboración) para todos los sectores. Base DESCARTABLE; logins reales.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, request as pwRequest } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/vista-mensual";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "CLIENTE VM SA";
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const TODAY = iso(now);
const nm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const nmDay = (n) => iso(new Date(Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth(), n)));
const NM_START = nmDay(1);
const nmLabel = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(nm);
const J = { prem: { product: "VM PREMIUM SERUM", day: nmDay(4), qty: "300" }, mas: { product: "VM MASIVO SHAMPOO", day: nmDay(6), to: nmDay(8), qty: "5000" }, elab: { product: "VM ELAB CREMA", day: nmDay(10), qty: "200" }, cur: { product: "VM PREMIUM ACTUAL", day: TODAY, qty: "120" } };
const ids = {};

const cleanup = async () => {
  const wi = (await q("select id from work_items where client = $1", [CLI]).catch(() => [])).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => undefined);
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => undefined);
  await q("delete from work_items where id = any($1::uuid[])", [wi]).catch(() => undefined);
};
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
const dayText = (page, day) => page.locator(`[data-testid=month-day][data-day="${day}"]`).first().innerText().then((t) => t.replace(/\s+/g, " "));
const openMonthly = async (page) => { await nav(page, "Vista mensual"); await page.locator("[data-testid=vista-mensual]").waitFor({ timeout: 120_000 }); };
const pickTab = async (page, sector) => { await page.locator(`[data-testid=vm-tab-${sector}]`).click(); await page.waitForFunction((s) => document.querySelector("[data-testid=vista-mensual]")?.getAttribute("data-tab") === s, sector); };
const waitCount = (page, re, timeout = 60_000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-testid=vm-count]")?.textContent ?? ""), re.source, { timeout });
const waitDay = (page, day, re, timeout = 90_000) => page.waitForFunction(([d, src]) => new RegExp(src).test(document.querySelector(`[data-testid=month-day][data-day="${d}"]`)?.textContent ?? ""), [day, re.source], { timeout });

try {
  await cleanup();
  const api = await pwRequest.newContext({ baseURL: BASE });
  const lg = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (lg.status() !== 200) throw new Error("login producción");
  const assign = async (sector, j, extra = {}) => {
    const r = await api.post("/api/v1/work-assignments", { data: { unit: sector === "ELABORACION" ? "kg" : "un.", plannedDate: j.day, plannedDateTo: j.to ?? j.day, sector, client: CLI, product: j.product, plannedQuantity: j.qty, idempotencyKey: randomUUID(), ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), ...extra } });
    if (!r.ok()) throw new Error(`asignación ${j.product}: ${r.status()} ${await r.text()}`);
    return String((await q("select id from work_items where client = $1 and product = $2 and deleted_at is null", [CLI, j.product]))[0].id);
  };
  ids.prem = await assign("ENVASADO_PREMIUM", J.prem);
  ids.mas = await assign("ENVASADO_MASIVO", J.mas);
  ids.elab = await assign("ELABORACION", J.elab);
  ids.cur = await assign("ENVASADO_PREMIUM", J.cur);

  const SECTOR_OF = { prem: "ENVASADO_PREMIUM", mas: "ENVASADO_MASIVO", elab: "ELABORACION" };
  const expectTab = async (page, tag, tabSector, label) => {
    await pickTab(page, tabSector);
    await waitDay(page, J[tag].day, new RegExp(J[tag].product.slice(0, 9)));
    const others = Object.keys(SECTOR_OF).filter((k) => k !== tag);
    const body = await page.locator("[data-testid=month-board]").innerText();
    const ok = body.includes(J[tag].product) && others.every((k) => !body.includes(J[k].product));
    check(`${label}: pestaña ${tabSector} muestra SOLO sus trabajos en el día correcto`, ok && (await dayText(page, J[tag].day)).includes(J[tag].product));
  };

  // ============ Todos los sectores ============
  const sectors = [
    ["Depósito", E2E_USERS.deposito], ["Codificado", E2E_USERS.codificado], ["Materias Primas", E2E_USERS.materiaPrima], ["Calidad", E2E_USERS.calidad],
    ["Envasado Masivo", E2E_USERS.envasado], ["Envasado Premium", E2E_USERS.envasadoPremium], ["Elaboración", E2E_USERS.elaboracion], ["Producción", E2E_USERS.produccion], ["Dirección", E2E_USERS.direccion],
  ];
  let depositoPage = null;
  for (const [label, user] of sectors) {
    const s = await login(user);
    await openMonthly(s.page);
    const tabs = (await s.page.locator("[role=tab]").allInnerTexts()).map((t) => t.trim());
    check(`${label}: tiene «Vista mensual» con las tres pestañas`, JSON.stringify(tabs) === JSON.stringify(["Envasado Premium", "Envasado Masivo", "Elaboración"]), tabs.join("|"));
    await s.page.locator("[data-testid=vm-next]").click();
    await s.page.waitForFunction((t) => new RegExp(t, "i").test(document.querySelector("[data-testid=vm-title]")?.textContent ?? ""), nmLabel.split(" ")[0]);
    await expectTab(s.page, "prem", "ENVASADO_PREMIUM", label);
    await expectTab(s.page, "mas", "ENVASADO_MASIVO", label);
    await expectTab(s.page, "elab", "ELABORACION", label);
    if (label === "Depósito") depositoPage = s; else await s.ctx.close();
  }

  // ============ Detalle: Depósito ============
  const d = depositoPage.page;
  await pickTab(d, "ENVASADO_MASIVO");
  const multi = [nmDay(6), nmDay(7), nmDay(8)];
  const mtexts = await Promise.all(multi.map((x) => dayText(d, x)));
  check("un trabajo de varios días aparece en cada día del rango y no se duplica (1 trabajo)", mtexts.every((t) => t.includes(J.mas.product)) && /1 trabajo\b/.test(await d.locator("[data-testid=vm-count]").innerText()) && !(await dayText(d, nmDay(9))).includes(J.mas.product));
  check("la tarjeta muestra producto, cliente y cantidad programada", /VM MASIVO SHAMPOO — CLIENTE VM SA · 5000|5\.000/.test(mtexts[0]), mtexts[0]);
  check("los días sin trabajos se muestran vacíos", (await d.locator(`[data-testid=month-day][data-day="${nmDay(15)}"]`).getAttribute("data-count")) === "0");
  // mes y pestaña se conservan
  const monthBefore = await d.locator("[data-testid=vista-mensual]").getAttribute("data-month");
  await pickTab(d, "ELABORACION");
  check("al cambiar de pestaña se mantiene el mes seleccionado", (await d.locator("[data-testid=vista-mensual]").getAttribute("data-month")) === monthBefore && monthBefore === NM_START);
  await d.locator("[data-testid=vm-next]").click();
  await d.waitForFunction((m) => document.querySelector("[data-testid=vista-mensual]")?.getAttribute("data-month") !== m, monthBefore);
  check("al cambiar de mes se mantiene la pestaña seleccionada", (await d.locator("[data-testid=vista-mensual]").getAttribute("data-tab")) === "ELABORACION");
  await d.locator("[data-testid=vm-prev]").click();
  await d.locator("[data-testid=vm-today]").click();
  await d.waitForFunction((m) => document.querySelector("[data-testid=vista-mensual]")?.getAttribute("data-month") !== m, monthBefore);
  await pickTab(d, "ENVASADO_PREMIUM");
  await waitDay(d, TODAY, /VM PREMIUM ACTUAL/);
  check("«Mes actual» vuelve al mes de hoy y muestra el trabajo de hoy", (await dayText(d, TODAY)).includes("VM PREMIUM ACTUAL"));
  await d.screenshot({ path: `${OUT}/1-mes-actual.png` });
  await d.locator("[data-testid=vm-next]").click();
  await waitDay(d, J.prem.day, /VM PREMIUM SERUM/);

  // ============ Producción modifica → todos lo ven (sin recargar) ============
  const ver = async (id) => Number((await q("select version from work_items where id = $1", [id]))[0].version);
  const cells = (changes) => api.patch("/api/v1/work-items/cells", { data: { changes } });
  const newDay = nmDay(5);
  const mv = await cells([{ id: `native:${ids.prem}`, field: "plannedDate", value: newDay, expectedVersion: await ver(ids.prem) }]);
  check("Producción reprograma el trabajo de Premium", mv.ok(), String(mv.status()));
  await waitDay(d, newDay, /VM PREMIUM SERUM/, 90_000);
  check("la reprogramación se refleja sola en Depósito (día nuevo con el trabajo, día viejo vacío)", (await dayText(d, newDay)).includes(J.prem.product) && !(await dayText(d, J.prem.day)).includes(J.prem.product));
  const qc = await cells([{ id: `native:${ids.prem}`, field: "plannedQuantity", value: "450", expectedVersion: await ver(ids.prem) }]);
  await waitDay(d, newDay, /450/, 90_000);
  check("el cambio de cantidad (300 → 450) se refleja sola", qc.ok() && /450/.test(await dayText(d, newDay)));
  await pickTab(d, "ENVASADO_MASIVO");
  const del = await api.post("/api/v1/work-items/bulk-delete", { data: { ids: [`native:${ids.mas}`], reason: "E2E vista mensual", batchKey: randomUUID() } });
  await d.waitForFunction((day) => !(document.querySelector(`[data-testid=month-day][data-day="${day}"]`)?.textContent ?? "").includes("VM MASIVO"), nmDay(6), { timeout: 90_000 });
  check("el trabajo cancelado/eliminado por Producción desaparece de la vista", del.ok() && !(await dayText(d, nmDay(7))).includes("VM MASIVO"), String(del.status()));
  const asg2 = await assign("ENVASADO_MASIVO", { product: "VM MASIVO NUEVO", day: nmDay(12), qty: "800" });
  await waitDay(d, nmDay(12), /VM MASIVO NUEVO/, 90_000);
  check("un trabajo asignado después aparece en la vista (una sola vez)", Boolean(asg2) && (await d.locator("[data-testid=month-board]").innerText()).split("VM MASIVO NUEVO").length === 2);

  // ============ Permisos: ningún sector gana escritura ============
  const writeTargets = { cells: [{ id: `native:${ids.elab}`, field: "plannedQuantity", value: "1", expectedVersion: await ver(ids.elab) }] };
  let allDenied = true;
  const denyDetail = [];
  for (const [label, user] of sectors.filter(([l]) => l !== "Producción" && l !== "Dirección")) {
    const a = await pwRequest.newContext({ baseURL: BASE });
    await a.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } });
    const r1 = await a.patch("/api/v1/work-items/cells", { data: { changes: writeTargets.cells } });
    const r2 = await a.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: nmDay(20), plannedDateTo: nmDay(20), sector: "ENVASADO_MASIVO", line: "Línea 1", client: CLI, product: `VM HACK ${label}`, plannedQuantity: "10", idempotencyKey: randomUUID() } });
    const r3 = await a.post("/api/v1/work-items/bulk-delete", { data: { ids: [`native:${ids.cur}`], reason: "intento", batchKey: randomUUID() } });
    const ok = [r1, r2, r3].every((r) => r.status() === 403);
    if (!ok) { allDenied = false; denyDetail.push(`${label}: ${r1.status()}/${r2.status()}/${r3.status()}`); }
    await a.dispose();
  }
  check("ningún sector consultante puede editar, asignar ni eliminar trabajos por API (403 en todos)", allDenied, denyDetail.join(" · "));
  check("no se creó ningún trabajo por esos intentos y los datos siguen intactos", (await q("select count(*)::int n from work_items where client = $1 and product like 'VM HACK%'", [CLI]))[0].n === 0 && (await q("select deleted_at from work_items where id = $1", [ids.cur]))[0].deleted_at == null && String((await q("select planned_quantity from work_items where id = $1", [ids.elab]))[0].planned_quantity) === "200");
  const ad = await pwRequest.newContext({ baseURL: BASE });
  const adLogin = await ad.post("/api/v1/auth/login", { data: { email: E2E_USERS.administracion.email, password: E2E_PASSWORD } });
  if (adLogin.status() === 200) check("Administración (sin bandeja operativa) no consulta la planificación (403)", (await ad.get(`/api/v1/weekly-plans?weekStart=${TODAY}&monthStart=${NM_START}&planSector=ELABORACION`)).status() === 403);
  await ad.dispose();
  const planGet = await api.get(`/api/v1/weekly-plans?weekStart=${TODAY}&monthStart=${NM_START}&planSector=ELABORACION`);
  check("Producción conserva su acceso a la consulta (200) y sus permisos de edición (los cambios de arriba se aplicaron)", planGet.status() === 200);

  // ============ Móvil ============
  const mob = await login(E2E_USERS.deposito, { width: 390, height: 800 });
  await openMonthly(mob.page).catch(async () => { await mob.page.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => undefined); await openMonthly(mob.page); });
  await mob.page.locator("[data-testid=vm-next]").click();
  await mob.page.waitForFunction((t) => new RegExp(t, "i").test(document.querySelector("[data-testid=vm-title]")?.textContent ?? ""), nmLabel.split(" ")[0]);
  const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("en el celular la pantalla no se rompe (sin scroll horizontal de la página; el calendario se desplaza dentro de su contenedor)", overflow <= 2 && (await mob.page.locator("[data-testid=vm-tab-ELABORACION]").isVisible()), `overflow ${overflow}px`);
  await mob.page.screenshot({ path: `${OUT}/2-movil.png` });
  await mob.ctx.close();
  await depositoPage.ctx.close();
  await api.dispose();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
