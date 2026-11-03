// E2E en Chromium real: observaciones y comentarios del equipo en la tarjeta flotante de la Vista mensual. Base DESCARTABLE; logins reales.
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
const OUT = process.env.OUT ?? "/tmp/vista-mensual-comentarios";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "E2E COMENTARIOS AQUALO";
const now = new Date();
const ymd = (n) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
const PRODUCT = "SERUM CAPILAR E2E";
const OBS = "Entregar con etiqueta nueva.\nRevisar el lote antes de envasar. " + "Detalle largo. ".repeat(30) + "FIN-OBS";
const ids = {};

const cleanup = async () => {
  const wi = (await q("select id from work_items where client = $1", [CLI]).catch(() => [])).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => undefined);
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => undefined);
  await q("delete from work_items where id = any($1::uuid[])", [wi]).catch(() => undefined); // los comentarios caen por CASCADE
};
async function login(user, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport, hasTouch: viewport.width < 900 });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
async function openMonthly(page, tab) {
  await nav(page, "Vista mensual").catch(async () => { await page.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => undefined); await nav(page, "Vista mensual"); });
  await page.locator("[data-testid=vista-mensual]").waitFor({ timeout: 120_000 });
  await page.locator(`[data-testid=vm-tab-${tab}]`).click();
  await page.waitForFunction(() => /^\d+ trabajo/.test(document.querySelector("[data-testid=vm-count]")?.textContent ?? ""), null, { timeout: 90_000 });
}
/** Abre la tarjeta del trabajo N-ésimo (por orden de aparición) del producto. */
async function openCard(page, nth) {
  const chip = page.locator("[data-testid=month-chip]").filter({ hasText: PRODUCT.slice(0, 14) }).nth(nth);
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.locator("[data-testid=month-job-card]").waitFor({ timeout: 15_000 });
  await page.locator("[data-testid=job-comments]").waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => !/Cargando/.test(document.querySelector("[data-testid=job-comments]")?.textContent ?? ""), null, { timeout: 15_000 });
}
const closeCard = async (page) => { await page.keyboard.press("Escape"); await page.locator("[data-testid=month-job-card]").waitFor({ state: "detached", timeout: 10_000 }); };
const comments = (page) => page.locator("[data-testid=job-comment]");
const dbCount = async (id) => Number((await q("select count(*)::int n from work_item_comments where work_item_id = $1", [id]))[0].n);
const snapshot = async (id) => JSON.stringify((await q("select * from work_items where id = $1", [id]))[0]);

try {
  await cleanup();
  const prodApi = await pwRequest.newContext({ baseURL: BASE });
  if ((await prodApi.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error("login producción");
  // Dos trabajos del MISMO producto, mismo día, mismo sector: A (con observaciones) y B (sin).
  for (const key of ["A", "B"]) {
    const r = await prodApi.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: ymd(10), plannedDateTo: ymd(10), sector: "ENVASADO_PREMIUM", line: "Línea 1", client: CLI, product: PRODUCT, plannedQuantity: key === "A" ? "2000" : "500", idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignación ${key}: ${r.status()} ${await r.text()}`);
  }
  for (const row of await q("select id, planned_quantity from work_items where client = $1 and deleted_at is null", [CLI])) ids[String(row.planned_quantity) === "2000" ? "A" : "B"] = String(row.id);
  await q("update work_items set notes = $1 where id = $2", [OBS, ids.A]);

  // ===== Depósito: observaciones y comentario =====
  const dep = await login(E2E_USERS.deposito);
  const dp = dep.page;
  await openMonthly(dp, "ENVASADO_PREMIUM");
  const chipsText = await dp.locator("[data-testid=month-chip]").filter({ hasText: PRODUCT.slice(0, 14) }).allInnerTexts();
  check("hay dos trabajos del mismo producto en el calendario", chipsText.length === 2, String(chipsText.length));
  // Identificar cuál chip es A (2.000) abriendo la tarjeta y mirando la cantidad.
  let idxA = -1;
  for (const n of [0, 1]) {
    await openCard(dp, n);
    if (/2\.000 unidades/.test(await dp.locator("[data-testid=job-card-quantity]").innerText())) idxA = n;
    await closeCard(dp);
  }
  const idxB = 1 - idxA;
  check("se distinguen los trabajos A (2.000) y B (500)", idxA >= 0);

  await openCard(dp, idxA);
  const obsText = await dp.locator("[data-testid=job-card-observations-text]").innerText();
  check("1-2) la tarjeta muestra las observaciones existentes COMPLETAS (sin truncar, con saltos de línea)", obsText.includes("Entregar con etiqueta nueva.") && obsText.endsWith("FIN-OBS") && obsText.length >= OBS.length - 2, `${obsText.length} caracteres`);
  check("observaciones separadas de los comentarios (secciones distintas)", (await dp.locator("[data-testid=job-card-observations] [data-testid=job-comments]").count()) === 0 && (await dp.locator("[data-testid=job-comments]").count()) === 1);
  check("sin comentarios todavía: «Todavía no hay comentarios»", (await dp.locator("[data-testid=job-comments-empty]").count()) === 1);
  const orden = await dp.evaluate(() => { const c = document.querySelector("[data-testid=month-job-card]"); const t = ["job-card-product", "job-card-client", "job-card-quantity", "job-card-date", "job-card-observations", "job-comments", "job-comment-form"].map((id) => c.querySelector(`[data-testid=${id}]`)); return t.every(Boolean) && t.every((el, i) => i === 0 || (t[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0); });
  check("orden visual: producto, cliente, cantidad, fecha/sector/estado, observaciones, comentarios, formulario", orden);

  // 10) vacío
  await dp.locator("[data-testid=job-comment-submit]").click();
  check("10) no se publican comentarios vacíos (mensaje, sin fila)", (await dp.locator("[data-testid=job-comment-form-error]").count()) === 1 && (await dbCount(ids.A)) === 0);

  // 3-4) publicar, con doble clic; el texto con HTML se muestra literal
  const TEXT1 = "Los envases restantes ingresan mañana <b>urgente</b>";
  await dp.locator("[data-testid=job-comment-input]").fill(TEXT1);
  const submit = dp.locator("[data-testid=job-comment-submit]");
  await submit.evaluate((b) => { b.click(); b.click(); });
  await dp.locator("[data-testid=job-comment-notice]").waitFor({ timeout: 15_000 });
  check("confirmación visual «Comentario publicado» y actualización inmediata de la lista", (await comments(dp).count()) === 1 && (await dp.locator("[data-testid=job-comment-notice]").innerText()) === "Comentario publicado");
  check("11) doble clic: una sola publicación en la base", (await dbCount(ids.A)) === 1, String(await dbCount(ids.A)));
  check("4) nombre y sector reales de la sesión (E2E Depósito · Depósito) y fecha/hora", (await dp.locator("[data-testid=job-comment-author]").innerText()) === E2E_USERS.deposito.displayName && (await dp.locator("[data-testid=job-comment-sector]").innerText()) === "Depósito" && /^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/.test(await dp.locator("[data-testid=job-comment-when]").innerText()));
  check("el HTML se muestra como texto (no se ejecuta ni se interpreta)", (await dp.locator("[data-testid=job-comment-body]").innerText()) === TEXT1 && (await dp.locator("[data-testid=job-comment-body] b").count()) === 0);
  await dp.screenshot({ path: `${OUT}/1-deposito-publica.png` });

  // 7) recargar
  await dp.reload();
  await openMonthly(dp, "ENVASADO_PREMIUM");
  await openCard(dp, idxA);
  check("7) tras recargar el comentario sigue en el mismo trabajo", (await comments(dp).count()) === 1 && /ingresan mañana/.test(await comments(dp).first().innerText()));
  await closeCard(dp);
  // 9) el otro trabajo del mismo producto no comparte comentarios y muestra «Sin observaciones»
  await openCard(dp, idxB);
  check("9) el otro trabajo del mismo producto NO ve ese comentario y dice «Sin observaciones»", (await comments(dp).count()) === 0 && (await dp.locator("[data-testid=job-card-observations-empty]").innerText()) === "Sin observaciones");
  await closeCard(dp);

  // ===== 5-6) Producción lee; Envasado Premium responde; Depósito (tarjeta abierta) lo ve sin recargar =====
  await openCard(dp, idxA);
  const pr = await login(E2E_USERS.produccion);
  await openMonthly(pr.page, "ENVASADO_PREMIUM");
  await openCard(pr.page, idxA);
  check("5) Producción puede leer el comentario de Depósito (con su nombre y sector)", (await comments(pr.page).count()) === 1 && /E2E Depósito/.test(await comments(pr.page).first().innerText()) && /Depósito/.test(await comments(pr.page).first().innerText()));
  const env = await login(E2E_USERS.envasadoPremium);
  await openMonthly(env.page, "ENVASADO_PREMIUM");
  await openCard(env.page, idxA);
  await env.page.locator("[data-testid=job-comment-input]").fill("Tenemos 1.200 unidades terminadas");
  await env.page.locator("[data-testid=job-comment-submit]").click();
  await env.page.locator("[data-testid=job-comment-notice]").waitFor({ timeout: 15_000 });
  check("6) Envasado responde: su comentario queda DESPUÉS del de Depósito, con su nombre y sector", (await comments(env.page).count()) === 2 && /E2E Envasado Premium/.test(await comments(env.page).nth(1).innerText()) && /Envasado Premium/.test(await comments(env.page).nth(1).innerText()));
  const t0 = Date.now();
  await dp.waitForFunction(() => document.querySelectorAll("[data-testid=job-comment]").length === 2, null, { timeout: 40_000 }).then(() => check(`actualización entre sectores sin recargar (la tarjeta abierta de Depósito lo mostró en ${Math.round((Date.now() - t0) / 1000)} s)`, true), () => check("actualización entre sectores sin recargar", false));
  check("orden cronológico: el más reciente al final", /ingresan mañana/.test(await comments(dp).nth(0).innerText()) && /1\.200 unidades terminadas/.test(await comments(dp).nth(1).innerText()));
  await env.ctx.close(); await pr.ctx.close();
  await closeCard(dp);

  // 8) reprogramar
  await q("update work_items set planned_date = $1, planned_date_to = $1 where id = $2", [ymd(18), ids.A]);
  await dp.reload();
  await openMonthly(dp, "ENVASADO_PREMIUM");
  const moved = dp.locator("[data-testid=month-chip]").filter({ hasText: PRODUCT.slice(0, 14) });
  let found = false;
  for (let n = 0; n < (await moved.count()); n++) { await openCard(dp, n); if ((await comments(dp).count()) === 2) found = true; await closeCard(dp); }
  check("8) al reprogramar el trabajo (otro día) conserva sus 2 comentarios", found && (await dbCount(ids.A)) === 2);

  // 12) permisos en el backend
  const before = await snapshot(ids.A);
  const depApi = await pwRequest.newContext({ baseURL: BASE });
  await depApi.post("/api/v1/auth/login", { data: { email: E2E_USERS.deposito.email, password: E2E_PASSWORD } });
  const forged = await depApi.post("/api/v1/work-item-comments", { data: { workItemId: ids.A, body: "Intento de suplantar", clientRequestId: randomUUID(), authorName: "Dirección", authorSector: "DIRECCION", authorEmail: "x@y.z", plannedQuantity: "1", status: "CANCELADO", plannedDate: "2030-01-01" } });
  const forgedRow = (await q("select author_name, author_sector, author_email from work_item_comments where body = 'Intento de suplantar'"))[0];
  check("autor y sector se toman SIEMPRE de la sesión (los campos enviados se ignoran)", forged.status() === 201 && forgedRow.author_sector === "DEPOSITO" && forgedRow.author_name === E2E_USERS.deposito.displayName && forgedRow.author_email === E2E_USERS.deposito.email);
  check("12) publicar no modifica el trabajo (cantidad, fecha, estado, asignación, observaciones intactos)", (await snapshot(ids.A)) === before);
  const edit = await depApi.fetch("/api/v1/work-item-comments", { method: "PATCH", data: { workItemId: ids.A, plannedQuantity: "1" } });
  const del = await depApi.fetch("/api/v1/work-item-comments", { method: "DELETE", data: { workItemId: ids.A } });
  check("los comentarios no se pueden editar ni eliminar desde estas rutas (405)", edit.status() === 405 && del.status() === 405 && (await dbCount(ids.A)) === 3);
  const adm = await pwRequest.newContext({ baseURL: BASE });
  await adm.post("/api/v1/auth/login", { data: { email: E2E_USERS.administracion.email, password: E2E_PASSWORD } });
  const admGet = await adm.get(`/api/v1/work-item-comments?workItemId=${ids.A}`);
  const admPost = await adm.post("/api/v1/work-item-comments", { data: { workItemId: ids.A, body: "no", clientRequestId: randomUUID() } });
  check("un sector sin acceso a la Vista mensual recibe 403 (leer y publicar)", admGet.status() === 403 && admPost.status() === 403);
  const anon = await pwRequest.newContext({ baseURL: BASE });
  check("sin sesión: 401", [401, 403].includes((await anon.get(`/api/v1/work-item-comments?workItemId=${ids.A}`)).status()) && (await anon.post("/api/v1/work-item-comments", { data: { workItemId: ids.A, body: "x", clientRequestId: "z" } })).status() === 401);
  const emptyApi = await depApi.post("/api/v1/work-item-comments", { data: { workItemId: ids.A, body: "  ", clientRequestId: randomUUID() } });
  check("la API también rechaza comentarios vacíos (400)", emptyApi.status() === 400);
  await dep.ctx.close();

  // 13) tablet y celular: tarjeta usable, formulario accesible
  for (const vp of [{ name: "tablet-horizontal", w: 1024, h: 768 }, { name: "celular", w: 390, h: 760 }]) {
    const s = await login(E2E_USERS.envasadoPremium, { width: vp.w, height: vp.h });
    await openMonthly(s.page, "ENVASADO_PREMIUM");
    await openCard(s.page, 0);
    const m = await s.page.evaluate(() => {
      const c = document.querySelector("[data-testid=month-job-card]"); const r = c.getBoundingClientRect();
      const f = document.querySelector("[data-testid=job-comment-form]").getBoundingClientRect();
      const i = document.querySelector("[data-testid=job-comment-input]").getBoundingClientRect();
      const b = document.querySelector("[data-testid=job-comment-submit]").getBoundingClientRect();
      const cs = getComputedStyle(c);
      return { vw: innerWidth, vh: innerHeight, r: { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }, f: { t: f.top, b: f.bottom }, i: { t: i.top, b: i.bottom }, btn: { t: b.top, b: b.bottom, h: b.height }, scrolls: c.scrollHeight > c.clientHeight + 1, overflowY: cs.overflowY, bg: cs.backgroundColor, hscroll: c.scrollWidth > c.clientWidth + 1 };
    });
    check(`13) ${vp.name}: la tarjeta entra en pantalla (${Math.round(m.r.w)}×${Math.round(m.r.h)} en ${m.vw}×${m.vh}) con scroll interno si hace falta`, m.r.x >= 0 && m.r.y >= 0 && m.r.x + m.r.w <= m.vw && m.r.b <= m.vh + 1 && m.overflowY === "auto" && !m.hscroll);
    check(`13) ${vp.name}: el campo y el botón «Publicar» quedan visibles y accesibles (sin salir de la tarjeta)`, m.f.b <= m.r.b + 1 && m.f.t >= m.r.y && m.btn.h >= 36 && m.btn.b <= m.vh + 1 && /rgb\(15, 38, 52\)/.test(m.bg));
    await s.page.locator("[data-testid=job-comment-input]").fill(`Comentario desde ${vp.name}`);
    await s.page.locator("[data-testid=job-comment-submit]").click();
    await s.page.locator("[data-testid=job-comment-notice]").waitFor({ timeout: 15_000 });
    check(`13) ${vp.name}: se puede escribir y publicar tocando (queda al final de la lista)`, /Comentario desde/.test(await comments(s.page).last().innerText()));
    await s.page.screenshot({ path: `${OUT}/2-${vp.name}.png` });
    await s.ctx.close();
  }
  await prodApi.dispose(); await depApi.dispose(); await adm.dispose(); await anon.dispose();
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
