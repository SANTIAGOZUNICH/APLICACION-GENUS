// E2E en Chromium real: Depósito → «ME de Envasado»: los botones Sin info / ✅ / ❌ se ven y funcionan con la cuenta de Depósito (rol de operario,
// no administradora), en computadora (1366) y tablet; persisten; los demás sectores ven el estado y no pueden modificarlo. Base DESCARTABLE.
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
const OUT = process.env.OUT ?? "/tmp/me-botones";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const TAG = "E2E-MEB";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

async function login(user, viewport) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const apiAs = async (user) => { const a = await pwRequest.newContext({ baseURL: BASE }); if ((await a.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error(`login ${user.email}`); return a; };
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const wk = mondayOf(TODAY);
const P = { a: "SERUM CAPILAR HIDRATANTE INTENSIVO 200 ML", b: "CREMA FACIAL PREMIUM NOCHE 50 ML", c: "GEL ACTIVADOR SIN ENJUAGUE 500 ML" };
const ids = {};

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [wk]);
  const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${wk}`)).json();
  const weekId = list.weeks?.[0]?.id ?? (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart: wk, label: "E2E ME botones" } })).json()).week.id;
  const mk = async (sector, product, qty, date) => {
    const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: `${TAG} obs`, plannedDate: date, client: "LABORATORIOS CLIENTE NOMBRE LARGO SOCIEDAD ANONIMA", plannedQuantity: qty, unit: "un.", product, sector, line: "Línea 1" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.a = await mk("ENVASADO_MASIVO", P.a, "12000", wk);
  ids.b = await mk("ENVASADO_PREMIUM", P.b, "3500", addDays(wk, 1));
  ids.c = await mk("ENVASADO_MASIVO", P.c, "8000", addDays(wk, 2));
  const pub = await prodApi.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  const meOf = async (id) => (await q("select me_status, me_observation from work_items where id = $1", [id]))[0];

  for (const [label, vp] of [["computadora 1366×768", { width: 1366, height: 768 }], ["tablet 820×1180", { width: 820, height: 1180 }]]) {
    const dep = await login(E2E_USERS.deposito, vp);
    const p = dep.page;
    await nav(p, "ME de Envasado");
    await p.locator("[data-testid=deposito-me-envasado]").waitFor({ timeout: 120_000 });
    const rowOf = (t) => p.locator("[data-testid=me-row]", { hasText: t }).first();
    await rowOf(P.a).waitFor({ timeout: 60_000 });
    check(`${label}: el servidor reconoce a Depósito y habilita la edición`, (await p.locator("[data-testid=deposito-me-envasado]").getAttribute("data-can-edit")) === "1" && (await p.locator("[data-testid=deposito-me-envasado]").getAttribute("data-actor-sector")) === "DEPOSITO");
    check(`${label}: los trabajos existentes de Envasado Masivo y Premium aparecen`, [P.a, P.b, P.c].every(async () => true) && (await p.locator("[data-testid=me-row]").count()) >= 3);
    // Los tres botones están SIEMPRE visibles, dentro de la pantalla, sin desplazarse horizontalmente
    let allVisible = true; let detail = "";
    for (const pr of [P.a, P.b, P.c]) {
      const r = rowOf(pr);
      await r.scrollIntoViewIfNeeded();
      for (const st of ["SIN_INFO", "OK", "NO_OK"]) {
        const b = r.locator(`[data-testid=me-set-${st}]`);
        const box = await b.boundingBox();
        const vw = await p.evaluate(() => window.innerWidth);
        if (!(await b.isVisible()) || !box || box.x < 0 || box.x + box.width > vw - 1) { allVisible = false; detail += ` ${pr.slice(0, 12)}/${st}:${JSON.stringify(box)}`; }
      }
    }
    check(`${label}: cada fila muestra Sin info · ✅ · ❌ visibles dentro de la pantalla`, allVisible, detail);
    const scrolls = await p.evaluate(() => { const w = document.querySelector("[data-testid=me-envasado-table]"); return { inner: w ? w.scrollWidth - w.clientWidth : -1, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    if (label.startsWith("computadora")) check(`${label}: la lista no necesita desplazamiento horizontal`, scrolls.inner <= 1 && scrolls.page <= 1, JSON.stringify(scrolls));
    else check(`${label}: ni la página ni la tabla necesitan desplazamiento horizontal`, scrolls.page <= 1 && scrolls.inner <= 1, JSON.stringify(scrolls));
    await p.screenshot({ path: `${OUT}/${label.startsWith("comp") ? "1-pc" : "2-tablet"}.png` });

    if (label.startsWith("computadora")) {
      const t0 = Date.now();
      await rowOf(P.a).locator("[data-testid=me-set-OK]").click();
      check("✅: el indicador de la fila cambia al instante y se guarda", (await rowOf(P.a).getAttribute("data-me-status")) === "OK" && (Date.now() - t0) < 2500 && (await waitDb(async () => (await meOf(ids.a)).me_status === "OK")));
      await rowOf(P.b).locator("[data-testid=me-observation-input]").fill("Faltan 300 pomos de 200 ml");
      await rowOf(P.b).locator("[data-testid=me-set-NO_OK]").click();
      check("❌ con observación: se guarda", await waitDb(async () => { const m = await meOf(ids.b); return m.me_status === "NO_OK" && m.me_observation === "Faltan 300 pomos de 200 ml"; }));
      await rowOf(P.a).locator("[data-testid=me-set-SIN_INFO]").click();
      check("Sin info: restablece el estado sin verificar", await waitDb(async () => (await meOf(ids.a)).me_status === null) && (await rowOf(P.a).getAttribute("data-me-status")) === "SIN_INFO");
      await rowOf(P.a).locator("[data-testid=me-set-OK]").click();
      await waitDb(async () => (await meOf(ids.a)).me_status === "OK");
      await p.reload();
      await nav(p, "ME de Envasado");
      await rowOf(P.a).waitFor({ timeout: 60_000 });
      check("los cambios persisten después de recargar", (await rowOf(P.a).getAttribute("data-me-status")) === "OK" && (await rowOf(P.b).getAttribute("data-me-status")) === "NO_OK" && /Faltan 300 pomos/.test(await rowOf(P.b).innerText() + await rowOf(P.b).locator("[data-testid=me-observation-input]").inputValue()));
      const hist = await q("select to_status, actor_sector from work_item_me_history where work_item_id = $1 order by created_at", [ids.a]);
      check("auditoría: usuario, sector y estado anterior de cada cambio", JSON.stringify(hist.map((h) => h.to_status)) === JSON.stringify(["OK", null, "OK"]) && hist.every((h) => h.actor_sector === "DEPOSITO"));
    } else {
      await rowOf(P.c).locator("[data-testid=me-set-NO_OK]").click();
      check("tablet: ❌ se guarda", await waitDb(async () => (await meOf(ids.c)).me_status === "NO_OK"));
    }
    await dep.ctx.close();
  }

  // Un rechazo del servidor se muestra con claridad y la fila vuelve al estado anterior
  const dep2 = await login(E2E_USERS.deposito, { width: 1366, height: 768 });
  await nav(dep2.page, "ME de Envasado");
  await dep2.page.locator("[data-testid=me-row]").first().waitFor({ timeout: 60_000 });
  await dep2.page.route("**/api/v1/work-items/*/me", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Solo Depósito puede cambiar el estado del Material de Envase (ME)." }) }));
  const rowC = dep2.page.locator("[data-testid=me-row]", { hasText: P.c }).first();
  const before = await rowC.getAttribute("data-me-status");
  await rowC.locator("[data-testid=me-set-OK]").click();
  await dep2.page.locator("[data-testid=me-error]").waitFor({ timeout: 10_000 });
  check("si el servidor rechaza: mensaje claro y la fila vuelve al estado anterior", /Solo Depósito/.test(await dep2.page.locator("[data-testid=me-error]").innerText()) && (await rowC.getAttribute("data-me-status")) === before);
  await dep2.ctx.close();

  // Los demás sectores: ven el estado, no pueden modificarlo
  const codes = {}; const canEdit = {};
  for (const [label, user] of [["Producción", E2E_USERS.produccion], ["Envasado", E2E_USERS.envasado], ["Elaboración", E2E_USERS.elaboracion], ["Materias Primas", E2E_USERS.materiaPrima], ["Codificado", E2E_USERS.codificado], ["Calidad", E2E_USERS.calidad]]) {
    const a = await apiAs(user);
    codes[label] = (await a.post(`/api/v1/work-items/${ids.a}/me`, { data: { status: "NO_OK", observation: "x" } })).status();
    const wp = await a.get(`/api/v1/weekly-plans?weekStart=${wk}`);
    canEdit[label] = wp.status() === 200 ? (await wp.json()).canEditMe : wp.status();
  }
  check("los demás sectores reciben 403 al modificar y el servidor informa canEditMe=false", Object.values(codes).every((c) => c === 403) && Object.values(canEdit).every((v) => v === false), JSON.stringify({ codes, canEdit }));
  const dirApi = await apiAs(E2E_USERS.direccion);
  check("Dirección puede modificar (200) y el servidor informa canEditMe=true", (await dirApi.post(`/api/v1/work-items/${ids.c}/me`, { data: { status: "OK" } })).status() === 200 && (await (await dirApi.get(`/api/v1/weekly-plans?weekStart=${wk}`)).json()).canEditMe === true);
  const mpApi = await apiAs(E2E_USERS.materiaPrima);
  const seen = (await (await mpApi.get(`/api/v1/weekly-plans?weekStart=${wk}&planSector=ENVASADO_MASIVO`)).json()).items.find((i) => i.workItemId === ids.a);
  check("los demás sectores ven el estado actualizado (MP: ME ✅)", seen?.me?.status === "OK");
  const pr = await login(E2E_USERS.produccion, { width: 1366, height: 768 });
  await pr.page.getByRole("button", { name: "Vista mensual" }).or(pr.page.getByRole("link", { name: "Vista mensual" })).first().click({ timeout: 120_000 });
  await pr.page.locator("[data-testid=vm-tab-ENVASADO_MASIVO]").click();
  const chip = pr.page.locator("[data-testid=month-chip]", { hasText: P.a.slice(0, 20) }).first();
  await chip.waitFor({ timeout: 60_000 });
  check("Producción lo ve en la Vista mensual (ME: ✅)", /ME: ✅/.test(await chip.innerText()));
  await pr.ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]).catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
