// E2E VISUAL en Chromium real: la tarjeta flotante de la Vista mensual debe ser una tarjeta REAL (fondo opaco, borde, sombra, por encima
// del calendario, legible, dentro de la pantalla) en escritorio, tablet horizontal y celular. Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/vista-mensual-tarjeta";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "AQUALO COSMETICOS ARGENTINA S.A.";
const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const nm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const dim = new Date(Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth() + 1, 0)).getUTCDate();
const dow = (n) => (new Date(Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth(), n)).getUTCDay() + 6) % 7; // 0 = lunes … 6 = domingo
const days = Array.from({ length: dim }, (_, i) => i + 1);
const firstOf = (d) => days.find((n) => dow(n) === d);
const lastOf = (d) => [...days].reverse().find((n) => dow(n) === d);
const day = (n) => iso(new Date(Date.UTC(nm.getUTCFullYear(), nm.getUTCMonth(), n)));
const nmLabelWord = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(nm);
// Trabajos en los bordes: arriba-izquierda, arriba-derecha (domingo), abajo-derecha (último domingo), abajo-izquierda (último lunes) y centro.
const PLACES = [
  { key: "arriba-izquierda", n: firstOf(0), product: "SERUM CAPILAR HIDRATANTE INTENSIVO CON ACIDO HIALURONICO Y VITAMINA E 30 ML EDICION LIMITADA", qty: "2000", lote: "L-26099-A" },
  { key: "arriba-derecha", n: firstOf(6), product: "SHAMPOO RESTAURADOR", qty: "5000", lote: null },
  { key: "abajo-derecha", n: lastOf(6), product: "CREMA FACIAL NOCTURNA", qty: "1250", lote: null },
  { key: "abajo-izquierda", n: lastOf(0), product: "TONICO EQUILIBRANTE", qty: "300", lote: "L-27001" },
  { key: "centro", n: firstOf(2) + 14, product: "GEL LIMPIADOR SUAVE", qty: "800", lote: null },
];
const ids = {};

const cleanup = async () => {
  const wi = (await q("select id from work_items where client = $1", [CLI]).catch(() => [])).map((r) => String(r.id));
  if (!wi.length) return;
  await q("delete from operational_events where work_item_id = any($1::uuid[])", [wi]).catch(() => undefined);
  for (const id of wi) await q("delete from operational_orders where linked_work_item_id = $1", [id]).catch(() => undefined);
  await q("delete from work_items where id = any($1::uuid[])", [wi]).catch(() => undefined);
};
async function login(user, viewport) {
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
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [la, lb] = [lum(a), lum(b)].sort((x, y) => y - x); return (la + 0.05) / (lb + 0.05); };
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);

try {
  await cleanup();
  const api = await pwRequest.newContext({ baseURL: BASE });
  if ((await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error("login producción");
  for (const p of PLACES) {
    const r = await api.post("/api/v1/work-assignments", { data: { unit: "un.", plannedDate: day(p.n), plannedDateTo: day(p.n), sector: "ENVASADO_PREMIUM", line: "Línea 1", client: CLI, product: p.product, plannedQuantity: p.qty, idempotencyKey: randomUUID() } });
    if (!r.ok()) throw new Error(`asignación ${p.key}: ${r.status()} ${await r.text()}`);
    ids[p.key] = String((await q("select id from work_items where client = $1 and product = $2 and deleted_at is null", [CLI, p.product]))[0].id);
    if (p.lote) await q("update work_items set packaging_lote = $1 where id = $2", [p.lote, ids[p.key]]);
  }
  await api.dispose();

  const VIEWPORTS = [
    { name: "escritorio", w: 1400, h: 900, min: 296, max: 344 },
    { name: "tablet-horizontal-1180", w: 1180, h: 820, min: 296, max: 344 },
    { name: "tablet-horizontal-1024", w: 1024, h: 768, min: 296, max: 344 },
    { name: "celular", w: 390, h: 800, min: 280, max: 366 },
  ];
  for (const vp of VIEWPORTS) {
    const s = await login(E2E_USERS.deposito, { width: vp.w, height: vp.h });
    const pg = s.page;
    await nav(pg, "Vista mensual").catch(async () => { await pg.getByRole("button", { name: /menú|menu/i }).first().click().catch(() => undefined); await nav(pg, "Vista mensual"); });
    await pg.locator("[data-testid=vista-mensual]").waitFor({ timeout: 120_000 });
    await pg.locator("[data-testid=vm-next]").click();
    await pg.waitForFunction((w) => new RegExp(w, "i").test(document.querySelector("[data-testid=vm-title]")?.textContent ?? ""), nmLabelWord);
    await pg.waitForFunction((n) => (document.querySelector("[data-testid=vm-count]")?.textContent ?? "").startsWith(String(n)), PLACES.length, { timeout: 90_000 });
    for (const p of PLACES) {
      const chip = pg.locator("[data-testid=month-chip]").filter({ hasText: p.product.slice(0, 18) }).first();
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      const card = pg.locator("[data-testid=month-job-card]");
      await card.waitFor({ timeout: 15_000 });
      await pg.waitForTimeout(250);
      const info = await pg.evaluate(() => {
        const el = document.querySelector("[data-testid=month-job-card]");
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        let minOp = 1;
        for (let c = el; c; c = c.parentElement) minOp = Math.min(minOp, Number(getComputedStyle(c).opacity));
        const pts = [[0.08, 0.08], [0.5, 0.5], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92], [0.5, 0.2], [0.5, 0.8]].map(([fx, fy]) => { const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy); return Boolean(t && el.contains(t)); });
        const title = el.querySelector("[data-testid=job-card-product]");
        const labels = [...el.querySelectorAll("dt")];
        const overflow = [title, ...el.querySelectorAll("dd")].filter(Boolean).some((n) => n.scrollWidth > n.clientWidth + 1);
        const fonts = [title, ...el.querySelectorAll("dd, dt")].map((n) => parseFloat(getComputedStyle(n).fontSize));
        return {
          bg: cs.backgroundColor, bf: cs.backdropFilter, op: cs.opacity, minOp, z: cs.zIndex, inRoot: Boolean(el.closest(".design-preview-root")),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight, pts, overflow, hscroll: el.scrollWidth > el.clientWidth + 1,
          titleColor: getComputedStyle(title).color, labelColor: getComputedStyle(labels[0]).color, shadow: cs.boxShadow, border: cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius, pad: cs.paddingLeft, minFont: Math.min(...fonts),
          text: el.innerText.replace(/\s+/g, " "),
        };
      });
      const bg = rgb(info.bg);
      const chipBox = await chip.boundingBox();
      const r = info.rect;
      const margin = 4;
      const inside = r.x >= margin - 0.5 && r.y >= margin - 0.5 && r.x + r.w <= info.vw - margin + 0.5 && r.y + r.h <= info.vh - margin + 0.5;
      const overlapsChip = chipBox && !(r.x + r.w <= chipBox.x || r.x >= chipBox.x + chipBox.width || r.y + r.h <= chipBox.y || r.y >= chipBox.y + chipBox.height);
      const tag = `${vp.name} · ${p.key}`;
      check(`${tag}: fondo 100% opaco, sin transparencia ni blur (bg ${info.bg}, opacity ${info.minOp}, backdrop ${info.bf})`, (bg.length === 3 || bg[3] === 1) && info.minOp === 1 && (info.bf === "none" || info.bf === "") && bg[0] < 40 && bg[2] < 70);
      check(`${tag}: renderizada dentro del tema y POR ENCIMA del calendario (z ${info.z}; los 7 puntos de la tarjeta son lo más alto)`, info.inRoot && Number(info.z) > 100 && info.pts.every(Boolean));
      check(`${tag}: borde visible, sombra marcada, esquinas redondeadas y padding 16–20 px`, parseFloat(info.border) >= 1 && info.shadow !== "none" && parseFloat(info.radius) >= 10 && parseFloat(info.pad) >= 16 && parseFloat(info.pad) <= 20, `${info.border} · ${info.radius} · pad ${info.pad}`);
      check(`${tag}: ancho ${Math.round(r.w)} px dentro de ${vp.min}–${vp.max}`, r.w >= vp.min && r.w <= vp.max);
      check(`${tag}: entera dentro de la pantalla (x ${Math.round(r.x)}, y ${Math.round(r.y)}, ${Math.round(r.w)}×${Math.round(r.h)} en ${info.vw}×${info.vh})`, inside);
      check(`${tag}: no tapa el trabajo seleccionado (queda separada)`, !overlapsChip);
      check(`${tag}: texto con contraste alto (título ${contrast(rgb(info.titleColor), bg).toFixed(1)}:1, etiquetas ${contrast(rgb(info.labelColor), bg).toFixed(1)}:1), sin cortes ni desbordes`, contrast(rgb(info.titleColor), bg) >= 7 && contrast(rgb(info.labelColor), bg) >= 4.5 && !info.overflow && !info.hscroll && info.minFont >= 13);
      check(`${tag}: muestra producto, cliente y cantidad${p.lote ? " y lote" : " (sin lote)"} sin campos vacíos`, info.text.includes(p.product) && info.text.includes(CLI) && new RegExp(`${Number(p.qty).toLocaleString("es-AR")} unidades`).test(info.text) && (p.lote ? info.text.includes(p.lote) : !/Lote/.test(info.text)) && /Cliente:/.test(info.text) && /Cantidad:/.test(info.text) && /Sector/.test(info.text) && /Estado/.test(info.text) && /Fecha/.test(info.text), info.text.slice(0, 200));
      await pg.screenshot({ path: `${OUT}/${vp.name}-${p.key}.png` });
      // Cerrar con la X y abrir otro trabajo
      await pg.locator("[data-testid=month-job-card-close]").click();
      await card.waitFor({ state: "detached", timeout: 10_000 });
    }
    // Tocar otro trabajo reemplaza la tarjeta
    await pg.locator("[data-testid=month-chip]").filter({ hasText: PLACES[1].product }).first().click();
    await pg.locator("[data-testid=month-job-card]").waitFor({ timeout: 10_000 });
    await pg.locator("[data-testid=month-chip]").filter({ hasText: PLACES[2].product }).first().click();
    await pg.waitForFunction((n) => new RegExp(n).test(document.querySelector("[data-testid=month-job-card]")?.textContent ?? ""), PLACES[2].product, { timeout: 10_000 });
    check(`${vp.name}: al tocar otro trabajo la tarjeta muestra el nuevo (una sola)`, (await pg.locator("[data-testid=month-job-card]").count()) === 1);
    await pg.keyboard.press("Escape");
    await pg.locator("[data-testid=month-job-card]").waitFor({ state: "detached", timeout: 10_000 });
    check(`${vp.name}: los trabajos del calendario siguen visibles y se puede seguir navegando (mes siguiente)`, (await pg.locator("[data-testid=month-chip]").count()) >= PLACES.length);
    await s.ctx.close();
  }
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
