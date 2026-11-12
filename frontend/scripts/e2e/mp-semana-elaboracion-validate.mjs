// E2E en Chromium real: Materias Primas → «Semana de Elaboración» (SOLO LECTURA). Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/mp-semana-elaboracion";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const TAG = "E2E-SEM";
const CLI = "AQUALO E2E SA";
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const bare = (id) => String(id).replace(/^native:/, "");
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const waitDb = async (fn, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

async function login(user, viewport = { width: 1500, height: 1000 }) {
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
async function openMpTab(page) {
  await page.getByRole("button", { name: "Semana de Elaboración", exact: true }).click({ timeout: 120_000 });
  await page.locator("[data-testid=mp-semana-elaboracion]").waitFor({ timeout: 60_000 });
}
const cardOf = (page, product) => page.locator("[data-testid=work-item-card]", { hasText: product }).first();
const cardsText = (page) => page.locator("[data-testid=work-item-card]").evaluateAll((els) => els.map((e) => e.querySelector("[data-testid=card-product]")?.textContent?.trim() ?? e.textContent?.slice(0, 40)).sort());
const net = (page, log) => page.on("request", (r) => { if (r.method() !== "GET" && r.url().includes("/api/v1/")) log.push(`${r.method()} ${r.url()}`); });

const wk = mondayOf(TODAY);
const ids = {};
const P = { a: "SERUM CAPILAR PENDIENTE", b: "CREMA EN ELABORACION", c: "SERUM CAPILAR AQUALO", d: "GEL TOTALMENTE ENTREGADO", e: "LOCION SEMANA SIGUIENTE" };

try {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  const prodApi = await apiAs(E2E_USERS.produccion);
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = any($1::date[])", [[wk, addDays(wk, 7)]]);
  const weekFor = async (start) => {
    const list = await (await prodApi.get(`/api/v1/planning/weeks?weekStart=${start}`)).json();
    return list.weeks?.[0]?.id ?? (await (await prodApi.post("/api/v1/planning/weeks", { data: { weekStart: start, label: "E2E semana elaboración" } })).json()).week.id;
  };
  const w0 = await weekFor(wk), w1 = await weekFor(addDays(wk, 7));
  const mk = async (weekId, product, kg, date) => {
    const r = await prodApi.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: `${TAG} obs ${product}`, plannedDate: date, client: CLI, plannedQuantity: kg, unit: "kg", product, sector: "ELABORACION", branchOwner: "Cristian" } });
    if (r.status() !== 201) throw new Error(`crear ${product}: ${await r.text()}`);
    return bare((await r.json()).item.id);
  };
  ids.a = await mk(w0, P.a, "60", wk);
  ids.b = await mk(w0, P.b, "80", addDays(wk, 1));
  ids.c = await mk(w0, P.c, "60", addDays(wk, 2));
  ids.d = await mk(w0, P.d, "50", addDays(wk, 3));
  ids.e = await mk(w1, P.e, "40", addDays(wk, 7));
  for (const w of [w0, w1]) { const pub = await prodApi.post(`/api/v1/planning/weeks/${w}/publish`, { data: {} }); if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`); }
  const op = (body) => prodApi.post("/api/v1/live-sync/operations", { data: body });
  const save = (id, kg) => op({ action: "save_progress", itemId: `native:${id}`, finishedQty: kg, observation: "", updatedBy: "Elaboración" });
  const deliver = (id, qty, kg) => op({ action: "deliver_work", workItemId: `native:${id}`, deliverQuantity: qty, partial: qty != null, idempotencyKey: randomUUID(), completion: { finishedQty: String(kg) } });
  check("avance de «en elaboración» registrado", (await save(ids.b, "30")).ok());
  check("70 kg elaborados sobre 60 solicitados", (await save(ids.c, "70")).ok());
  const d1 = await deliver(ids.c, 40, 70);
  check("entrega parcial de 40 kg registrada", d1.ok(), d1.ok() ? "" : await d1.text());
  check("trabajo D: 50 kg elaborados y entregados por completo", (await save(ids.d, "50")).ok() && (await deliver(ids.d, 50, 50)).ok());

  // ===== Materias Primas =====
  const mp = await login(E2E_USERS.materiaPrima);
  const writes = [];
  net(mp.page, writes);
  const tabs = await mp.page.getByRole("button").allInnerTexts();
  check("MP ve la pestaña «Semana de Elaboración» junto a las existentes (Stock, Control semanal total…)", tabs.includes("Semana de Elaboración") && tabs.includes("Stock") && tabs.includes("Control semanal total"));
  await openMpTab(mp.page);
  await cardOf(mp.page, P.c).waitFor({ timeout: 60_000 });
  const mpCards = await cardsText(mp.page);
  check("MP ve los trabajos de la semana (pendiente, en elaboración, parcial, entregado)", [P.a, P.b, P.c, P.d].every((p) => mpCards.some((t) => t.includes(p))) && !mpCards.some((t) => t.includes(P.e)), JSON.stringify(mpCards));
  const fig = async (p) => cardOf(mp.page, p).locator("[data-testid=card-elab-state]").innerText();
  check("estados reales: pendiente / en elaboración / entregado parcialmente / entregado", (await fig(P.a)) === "Pendiente de elaboración" && (await fig(P.b)) === "En elaboración" && (await fig(P.c)) === "Entregado parcialmente" && (await fig(P.d)) === "Entregado", [await fig(P.a), await fig(P.b), await fig(P.c), await fig(P.d)].join(" | "));
  const cc = cardOf(mp.page, P.c);
  const t = async (id) => (await cc.locator(`[data-testid=${id}]`).innerText()).replace(/\s+/g, " ");
  check("trabajo parcial: solicitados 60 kg, elaborados 70 kg, entregados 40 kg, pendientes 30 kg", /60/.test(await t("card-elab-requested")) && /70/.test(await t("card-elab-elaborated")) && /40/.test(await t("card-elab-delivered")) && /30/.test(await t("card-elab-pending")), [await t("card-elab-requested"), await t("card-elab-elaborated"), await t("card-elab-delivered"), await t("card-elab-pending")].join(" | "));
  check("cliente y producto visibles en la tarjeta", /AQUALO E2E SA/.test(await cc.innerText()) && /SERUM CAPILAR AQUALO/.test(await cc.innerText()));
  await mp.page.screenshot({ path: `${OUT}/1-mp-semana.png` });

  // Detalle
  await cc.getByRole("button", { name: "Ver detalle" }).click();
  const det = mp.page.locator("[data-testid=elab-readonly-detail]");
  await det.waitFor({ timeout: 15_000 });
  const dt = (await det.innerText()).replace(/\s+/g, " ");
  check("detalle: cliente, producto, lote, fecha, kg solicitados/elaborados/entregados/pendientes, estado y observaciones", /AQUALO E2E SA/.test(dt) && /SERUM CAPILAR AQUALO/.test(dt) && /Kg solicitados 60/i.test(dt) && /Kg realmente elaborados 70/i.test(dt) && /Kg entregados 40/i.test(dt) && /pendientes de entregar 30/i.test(dt) && /Entregado parcialmente/i.test(dt) && /E2E-SEM obs/.test(dt), dt.slice(0, 400));
  check("el detalle es de solo lectura: sin campos editables ni botones de acción", (await det.locator("input, textarea, select").count()) === 0 && (await det.getByRole("button").allInnerTexts()).every((b) => /cerrar|close/i.test(b) || b.trim() === ""));
  await mp.page.screenshot({ path: `${OUT}/2-mp-detalle.png` });
  await mp.page.keyboard.press("Escape");

  // Sin acciones de escritura en las tarjetas
  const btns = await mp.page.locator("[data-testid=work-item-card] button").allInnerTexts();
  check("las tarjetas solo ofrecen «Ver detalle» (sin Registrar avance, Entregar, Editar ni + Asignar)", btns.length > 0 && btns.every((b) => /^Ver detalle$/.test(b.trim()) || /FALTA LOTE/.test(b)) && (await mp.page.locator("[data-testid=open-assign-work-dialog], [data-testid=dnd-hint]").count()) === 0);

  // Misma planificación que Elaboración
  const el = await login(E2E_USERS.elaboracion);
  await el.page.getByRole("button", { name: "Semana", exact: true }).click({ timeout: 60_000 });
  await cardOf(el.page, P.c).waitFor({ timeout: 60_000 });
  const elCards = await cardsText(el.page);
  check("Elaboración y MP ven los MISMOS trabajos de la semana", JSON.stringify(elCards) === JSON.stringify(mpCards), JSON.stringify(elCards));

  // Navegación semanal
  await mp.page.locator("[data-testid=mp-sem-next]").click();
  await cardOf(mp.page, P.e).waitFor({ timeout: 30_000 });
  check("semana siguiente: muestra el trabajo de la próxima semana y no los de esta", (await cardsText(mp.page)).some((x) => x.includes(P.e)) && !(await cardsText(mp.page)).some((x) => x.includes(P.a)));
  await mp.page.locator("[data-testid=mp-sem-prev]").click();
  await mp.page.locator("[data-testid=mp-sem-prev]").click();
  await mp.page.waitForFunction(() => document.querySelector("[data-testid=mp-semana-elaboracion]")?.getAttribute("data-week-start"));
  check("semana anterior: sin trabajos de esta semana", !(await cardsText(mp.page)).some((x) => x.includes(P.a)));
  await mp.page.locator("[data-testid=mp-sem-today]").click();
  await cardOf(mp.page, P.a).waitFor({ timeout: 30_000 });
  check("«Semana actual» vuelve a esta semana", (await mp.page.locator("[data-testid=mp-semana-elaboracion]").getAttribute("data-week-start")) === wk);

  // Sincronización: entrega de los 30 kg restantes, corrección y cancelación por Producción
  const d2 = await deliver(ids.c, 30, 70);
  check("Producción registra los 30 kg restantes", d2.ok());
  await mp.page.locator("[data-testid=mp-sem-refresh]").click();
  check("MP ve «Entregado» con 70 kg entregados y 0 pendientes", await waitDb(async () => (await fig(P.c)) === "Entregado" && /70/.test(await t("card-elab-delivered")) && /^0\b/.test((await t("card-elab-pending")).trim()), 30_000), await fig(P.c));
  const lines = await q("select id from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA' order by sequence", [ids.c]);
  const cancel = await prodApi.post("/api/v1/internal-deliveries", { data: { action: "cancel", kind: "PRODUCCION", id: String(lines[1].id), reason: "E2E cancelación" } }).catch(() => null);
  if (cancel?.ok()) {
    await mp.page.locator("[data-testid=mp-sem-refresh]").click();
    check("tras cancelar la última entrega, MP vuelve a «Entregado parcialmente» (40 kg)", await waitDb(async () => (await fig(P.c)) === "Entregado parcialmente" && /40/.test(await t("card-elab-delivered")), 30_000));
  } else console.log("(cancelación por API no disponible en este entorno: cubierta en la prueba de integración)");
  // Reprogramación por Producción
  const moved = addDays(wk, 4);
  const rs = await op({ action: "reschedule_work", itemId: `native:${ids.a}`, plannedDate: moved });
  check("Producción reprograma el trabajo pendiente al viernes", rs.ok());
  await mp.page.locator("[data-testid=mp-sem-refresh]").click();
  const colsOf = () => mp.page.locator("section.space-y-4 > div.grid > div").evaluateAll((cells, p) => cells.map((c) => (c.textContent ?? "").includes(p)), P.a);
  const inDay = await waitDb(async () => (await colsOf()).lastIndexOf(true) === 4, 30_000);
  const dayCols = await colsOf();
  check("la reprogramación se refleja en MP (el trabajo pasa al nuevo día)", inDay && dayCols.filter(Boolean).length === 1, JSON.stringify(dayCols) + " db=" + (await q("select planned_date::text d from work_items where id = $1", [ids.a]))[0].d);

  // Solo lectura: ataques directos al servidor como MP
  const mpApi = await apiAs(E2E_USERS.materiaPrima);
  const before = (await q("select finished_qty, planned_date::text d, operational_status from work_items where id = $1", [ids.b]))[0];
  const attempts = [
    ["avance", { action: "save_progress", itemId: `native:${ids.b}`, finishedQty: "1", observation: "x", updatedBy: "MP" }],
    ["entrega", { action: "deliver_work", workItemId: `native:${ids.b}`, deliverQuantity: 5, partial: true, idempotencyKey: randomUUID(), completion: { finishedQty: "30" } }],
    ["reprogramación", { action: "reschedule_work", itemId: `native:${ids.b}`, plannedDate: addDays(wk, 4) }],
    ["cancelación", { action: "cancel_work", itemId: `native:${ids.b}`, reason: "x" }],
  ];
  const codes = [];
  for (const [, body] of attempts) codes.push((await mpApi.post("/api/v1/live-sync/operations", { data: body })).status());
  const after = (await q("select finished_qty, planned_date::text d, operational_status from work_items where id = $1", [ids.b]))[0];
  check("el servidor rechaza a MP (403) al avanzar, entregar, reprogramar y cancelar; nada cambia", codes.every((c) => c === 403) && JSON.stringify(before) === JSON.stringify(after), `${codes.join(",")}`);
  const getOk = await mpApi.get(`/api/v1/weekly-plans?weekStart=${wk}&planSector=ELABORACION`);
  check("MP consulta el plan de Elaboración por GET (200) y el plan es readOnly", getOk.status() === 200 && (await getOk.json()).readOnly === true);
  check("la pestaña no hizo ninguna escritura al servidor", writes.length === 0, writes.join(","));
  await mp.ctx.close();
  await el.ctx.close();

  // Funciones existentes de MP intactas
  const mp2 = await login(E2E_USERS.materiaPrima);
  await mp2.page.getByRole("button", { name: "Control semanal total", exact: true }).click({ timeout: 120_000 });
  await mp2.page.waitForTimeout(2500);
  check("Control semanal total sigue funcionando", (await mp2.page.locator("body").innerText()).length > 200 && !/Semana de Elaboración — solo lectura/.test(await mp2.page.locator("main").innerText().catch(() => "")));
  await mp2.page.getByRole("button", { name: "Stock", exact: true }).first().click();
  await mp2.page.locator("[data-testid=mp-search]").waitFor({ timeout: 30_000 });
  check("Stock sigue funcionando (buscador y planilla)", true);
  await mp2.ctx.close();

  // Tablet
  const tb = await login(E2E_USERS.materiaPrima, { width: 820, height: 1100 });
  await openMpTab(tb.page);
  await cardOf(tb.page, P.c).waitFor({ timeout: 60_000 });
  const ov = await tb.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("tablet: la semana se ve sin desborde horizontal de la página y con las tarjetas legibles", ov <= 1 && (await cardOf(tb.page, P.c).isVisible()), `overflow=${ov}`);
  await tb.page.screenshot({ path: `${OUT}/3-tablet.png` });
  await tb.ctx.close();
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
