// E2E (Chromium real, base DESCARTABLE): Dashboard Operativo.
//  1. Sin datos reales: todo «Sin datos suficientes» (nada de relleno).
//  2. Se siembran datos de PRUEBA (clientes «E2E Dash …») solo en la base descartable y se compara lo que muestra la
//     pantalla contra (a) valores calculados a mano y (b) un cálculo INDEPENDIENTE por SQL.
//  3. Filtros (año, mes, sector, cliente), semáforo y objetivos (solo Producción/Dirección, auditados, persistentes).
//  4. Permisos por sector: el payload de los sectores sin acceso NO contiene nombres de clientes.
//  5. Solo lectura: ninguna tabla de origen cambia por mirar/filtrar el Dashboard.
//  6. Capturas en escritorio 1440, tablet 820 y celular 390 sin scroll horizontal de página.
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");

assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/dashboard-e2e";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });

const YEAR = 2026;
const ALFA = "E2E Dash Alfa";
const BETA = "E2E Dash Beta";
const GAMMA = "E2E Dash Gamma";
const CLIENT_NAMES = [ALFA, BETA, GAMMA];
const TZ = "America/Argentina/Buenos_Aires";

// ---------------------------------------------------------------------------------------------------------------
// Utilidades de navegador
// ---------------------------------------------------------------------------------------------------------------
async function openAs(user, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page, user };
}

async function openDashboard(page, { mobile = false } = {}) {
  await page.goto("/");
  if (mobile) await page.getByRole("button", { name: "Abrir menú" }).click({ timeout: 120_000 });
  const item = mobile
    ? page.getByRole("dialog", { name: "Menú" }).getByRole("button", { name: /^Dashboard$/ })
    : page.getByRole("button", { name: /^Dashboard$/ }).first();
  await item.click({ timeout: 120_000 });
  await page.getByTestId("dashboard-root").waitFor({ timeout: 120_000 });
  await settle(page);
}

async function settle(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-testid=dashboard-root]");
    return root && root.getAttribute("aria-busy") !== "true";
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(250);
}

async function setFilter(page, testId, value) {
  const wait = page.waitForResponse((r) => r.url().includes("/api/v1/dashboard?") && r.status() < 500, { timeout: 60_000 });
  await page.getByTestId(testId).selectOption(value);
  await wait;
  await settle(page);
}

async function resetFilters(page) {
  await setFilter(page, "filter-year", String(YEAR));
  const dirty = await page.getByTestId("filter-reset").isEnabled();
  if (dirty) {
    const wait = page.waitForResponse((r) => r.url().includes("/api/v1/dashboard?"), { timeout: 60_000 });
    await page.getByTestId("filter-reset").click();
    await wait;
    await settle(page);
  }
}

const text = async (page, testId) => ((await page.getByTestId(testId).first().textContent()) ?? "").replace(/\s+/g, " ").trim();
/** «5.450» → 5450, «19,5 días» → 19.5, «95,0 %» → 95 */
const num = (t) => {
  const m = /-?[\d.]+(?:,\d+)?/.exec(t);
  if (!m) return null;
  return Number(m[0].replace(/\./g, "").replace(",", "."));
};
const kpiValue = async (page, key) => {
  const card = page.getByTestId(`kpi-${key}`);
  if ((await card.getAttribute("data-has-value")) === "0") return null;
  return num(await text(page, `kpi-${key}-value`));
};
const kpiSample = async (page, key) => {
  const t = await text(page, `kpi-${key}`);
  const m = /n = ([\d.]+)/.exec(t);
  return m ? num(m[1]) : null;
};
const near = (a, b, eps = 0.051) => a != null && b != null && Math.abs(a - b) <= eps;

async function hscroll(page, label) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector("main");
    const vw = window.innerWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) offenders.push(`${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? el.className?.toString().slice(0, 40)}] ${Math.round(r.left)}→${Math.round(r.right)}`);
    }
    return { doc: de.scrollWidth, docClient: de.clientWidth, main: main ? main.scrollWidth : 0, mainClient: main ? main.clientWidth : 0, vw, offenders: offenders.slice(0, 6) };
  });
  const ok = m.doc <= m.docClient && m.main <= m.mainClient + 1 && m.offenders.length === 0;
  check(`sin scroll horizontal — ${label}`, ok, `doc ${m.doc}/${m.docClient}, main ${m.main}/${m.mainClient}${m.offenders.length ? ", fuera de pantalla: " + m.offenders.join("; ") : ""}`);
}

async function shot(page, name, { height } = {}) {
  const vp = page.viewportSize();
  if (height) await page.setViewportSize({ width: vp.width, height });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (height) await page.setViewportSize(vp);
}

// ---------------------------------------------------------------------------------------------------------------
// Datos de prueba (solo en la base descartable)
// ---------------------------------------------------------------------------------------------------------------
async function cleanup() {
  await q("delete from work_item_deliveries where client like 'E2E Dash%' or product like 'E2E Dash%'");
  await q("delete from work_items where client like 'E2E Dash%'");
  await q("delete from production_pedidos where cliente like 'E2E Dash%'");
  await q("delete from planning_weeks where label = 'E2E Dash semana'");
  await q("delete from feature_audit_events where domain = 'dashboard'");
  await q("delete from dashboard_kpi_targets");
}

async function seed() {
  const [week] = await q("insert into planning_weeks (week_start, label, created_by) values ('2026-01-05', 'E2E Dash semana', 'e2e') returning id");
  const ped = async (op, fecha, cliente, producto, qty, estado, deleted = false) =>
    (await q(
      `insert into production_pedidos (op, fecha, cliente, producto, s, q, ml, kg, estado, created_by, created_by_sector, deleted_at)
       values ($1, $2, $3, $4, 'M', $5, 100, $6, $7, 'e2e', 'PRODUCCION', ${deleted ? "now()" : "null"}) returning id`,
      [op, fecha, cliente, producto, qty, (qty * 100) / 1000, estado]
    ))[0].id;
  const P1 = await ped("E2E-1", "2026-02-02", ALFA, "E2E Crema A", 1000, "ENTREGADO");
  const P2 = await ped("E2E-2", "2026-02-10", ALFA, "E2E Crema B", 2000, "ENTREGADO");
  const P3 = await ped("E2E-3", "2026-03-03", BETA, "E2E Serum", 500, "LISTO_PARA_ENTREGAR");
  const P4 = await ped("E2E-4", "2026-03-15", BETA, "E2E Gel", 800, "EN_ENVASADO");
  await ped("E2E-5", "2026-04-01", GAMMA, "E2E Crema A", 300, "INGRESO");
  await ped("E2E-6", "2026-04-05", ALFA, "E2E Crema A", 400, "EN_ELABORACION");
  const P7 = await ped("E2E-7", "2025-12-20", ALFA, "E2E Crema A", 100, "ENTREGADO");
  await ped("E2E-8", "2026-02-02", BETA, "E2E Eliminado", 999, "ENTREGADO", true); // eliminado: no cuenta

  const work = async ({ sector, line, branch = null, client, product, pedido = null, status = "completo", finished = null, completed = null, cancelledAt = null, deleted = false, origin = null }) =>
    (await q(
      `insert into work_items (planning_week_id, planned_date, client, product, planned_quantity, sector, line, branch_owner, created_by,
         operational_status, finished_qty, production_pedido_id, completed_at, operational_cancelled_at, deleted_at, codificado_origin_sector)
       values ($1, '2026-01-06', $2, $3, '100', $4, $5, $6, 'e2e', $7, $8, $9, $10, $11, ${deleted ? "now()" : "null"}, $12) returning id`,
      [week.id, client, product, sector, line, branch, status, finished, pedido, completed, cancelledAt, origin]
    ))[0].id;
  const M = (o) => work({ sector: "ENVASADO_MASIVO", line: "Línea 1", ...o });
  const PR = (o) => work({ sector: "ENVASADO_PREMIUM", line: "Línea 1", ...o });
  const W1 = await M({ client: ALFA, product: "E2E Crema A", pedido: P1, finished: "900", completed: "2026-02-20T15:00:00Z" });
  const W2 = await M({ client: ALFA, product: "E2E Crema B", pedido: P2, finished: "2000", completed: "2026-03-05T15:00:00Z" });
  const W3 = await PR({ client: BETA, product: "E2E Serum", pedido: P3, finished: "450", completed: "2026-03-25T15:00:00Z" });
  await M({ client: BETA, product: "E2E Gel", pedido: P4, status: "en_curso" }); // sin terminar: no cuenta
  const W5 = await M({ client: ALFA, product: "E2E Crema A", pedido: P7, finished: "100", completed: "2026-01-08T15:00:00Z" });
  const W6 = await PR({ client: GAMMA, product: "E2E Serum", finished: "300", completed: "2026-06-10T15:00:00Z" });
  await M({ client: ALFA, product: "E2E Cancelado", status: "cancelado", finished: "999", completed: "2026-03-01T15:00:00Z", cancelledAt: "2026-03-02T15:00:00Z" });
  await M({ client: ALFA, product: "E2E Eliminado", finished: "888", completed: "2026-03-01T15:00:00Z", deleted: true });
  const W9 = await work({ sector: "ELABORACION", line: null, branch: "Cristian", client: ALFA, product: "E2E Granel", finished: "5000", completed: "2026-03-01T15:00:00Z" }); // kg: no cuenta
  await work({ sector: "CODIFICADO", line: null, client: ALFA, product: "E2E Serum", finished: "200", completed: "2026-07-01T15:00:00Z", origin: "ENVASADO_PREMIUM" }); // pasó por Codificado: cuenta Premium
  await M({ client: BETA, product: "E2E Gel", finished: "1.500", completed: "2026-09-12T15:00:00Z" }); // «1.500» = mil quinientas

  const del = async ({ work: w, sector, client, pedido, at, status = "ENTREGADO", deleted = false }) =>
    q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, production_pedido_id, actual_delivered_at, status, delivered_by, delivered_by_sector, deleted_at, archived)
       values ($1, 'E2E Dash producto', $2, $3, $4, $5, $6, 'e2e', 'PRODUCCION', ${deleted ? "now()" : "null"}, ${deleted ? "true" : "false"})`,
      [w, client, sector, pedido, at, status]
    );
  await del({ work: W1, sector: "ENVASADO_MASIVO", client: ALFA, pedido: P1, at: "2026-02-12T15:00:00Z" }); // P1: 10 días
  await del({ work: W2, sector: "ENVASADO_MASIVO", client: ALFA, pedido: P2, at: "2026-03-05T15:00:00Z" }); // P2: 23 días
  await del({ work: W3, sector: "ENVASADO_PREMIUM", client: BETA, pedido: P3, at: "2026-03-27T15:00:00Z" }); // P3: 24 días
  await del({ work: W5, sector: "ENVASADO_MASIVO", client: ALFA, pedido: P7, at: "2026-01-10T15:00:00Z" }); // P7: 21 días (pedido 2025, entrega 2026)
  // Registros que NO deben contar:
  await del({ work: W1, sector: "ENVASADO_MASIVO", client: ALFA, pedido: P1, at: "2026-12-01T15:00:00Z", status: "ANULADO" });
  await del({ work: W2, sector: "ENVASADO_MASIVO", client: ALFA, pedido: P2, at: "2026-12-02T15:00:00Z", status: "REGISTRO_ELIMINADO" });
  await del({ work: W3, sector: "ENVASADO_PREMIUM", client: BETA, pedido: P3, at: "2026-12-03T15:00:00Z", deleted: true });
  await del({ work: W9, sector: "ELABORACION", client: ALFA, pedido: P1, at: "2026-12-04T15:00:00Z" }); // granel de Elaboración: no cuenta
  await del({ work: W6, sector: "ENVASADO_PREMIUM", client: GAMMA, pedido: null, at: "2026-06-15T15:00:00Z" }); // sin pedido: no entra al lead time
}

// ---------------------------------------------------------------------------------------------------------------
// Cálculo independiente por SQL (no reutiliza nada del código de la app)
// ---------------------------------------------------------------------------------------------------------------
const QTY = "replace(replace(coalesce(nullif(trim(w.finished_qty), ''), w.packaging_total_units::text), '.', ''), ',', '.')::numeric";
const DONE = "(w.completed_at is not null or w.operational_status in ('completo','entregado','revision','codificado_completo','en_codificado'))";
const PROD_WORK = `w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado'
  and (w.sector::text like 'ENVASADO_%' or w.codificado_origin_sector like 'ENVASADO_%')`;
const secExpr = "case when w.sector::text like 'ENVASADO_%' then w.sector::text else w.codificado_origin_sector end";
const arDate = (col) => `(${col} at time zone '${TZ}')::date`;

async function sqlExpected({ year, month = null, sector = null, client = null }) {
  const mon = (col) => (month ? `and extract(month from ${col}) = ${Number(month)}` : "");
  const yr = (col) => `extract(year from ${col}) = ${Number(year)}`;
  const cl = (col) => (client ? `and ${col} = '${client.replace(/'/g, "''")}'` : "");
  const units = await q(
    `select ${secExpr} as sec, sum(${QTY}) as units, count(*)::int as n
       from work_items w where ${PROD_WORK} and w.completed_at is not null and ${yr(arDate("w.completed_at"))} ${mon(arDate("w.completed_at"))} ${cl("w.client")}
       group by 1`
  );
  const u = Object.fromEntries(units.map((r) => [r.sec, Number(r.units)]));
  const distinct = await q(
    `select count(distinct lower(trim(w.product)))::int as n from work_items w
      where ${PROD_WORK} and ${DONE} and w.completed_at is not null and ${yr(arDate("w.completed_at"))} ${mon(arDate("w.completed_at"))} ${cl("w.client")}
        ${sector ? `and ${secExpr} = '${sector}'` : ""}`
  );
  const unitsSector = sector ? (u[sector] ?? 0) : (u.ENVASADO_MASIVO ?? 0) + (u.ENVASADO_PREMIUM ?? 0);
  const peds = await q(
    `select estado, count(*)::int as n from production_pedidos p
      where p.deleted_at is null and ${yr("p.fecha")} ${mon("p.fecha")} ${cl("p.cliente")} group by estado`
  );
  const pe = Object.fromEntries(peds.map((r) => [r.estado, r.n]));
  const lead = await q(
    `with last_d as (
        select coalesce(d.production_pedido_id, w.production_pedido_id) as pid, max(${arDate("d.actual_delivered_at")}) as dd
          from work_item_deliveries d join work_items w on w.id = d.work_item_id
         where d.status = 'ENTREGADO' and d.deleted_at is null and w.deleted_at is null
           and d.source_sector in ('ENVASADO_MASIVO','ENVASADO_PREMIUM','CODIFICADO') group by 1)
      select avg(l.dd - p.fecha)::float as v, count(*)::int as n
        from last_d l join production_pedidos p on p.id = l.pid
       where p.deleted_at is null and p.fecha is not null and (l.dd - p.fecha) > 0 and (l.dd - p.fecha) < 100
         and ${yr("l.dd")} ${mon("l.dd")} ${cl("p.cliente")}`
  );
  const service = await q(
    `select avg(ratio)::float as v, count(*)::int as n from (
        select p.id, sum(${QTY}) / p.q * 100 as ratio, max(${arDate("w.completed_at")}) as cd
          from production_pedidos p join work_items w on w.production_pedido_id = p.id
         where p.deleted_at is null and p.q > 0 and ${PROD_WORK} ${cl("p.cliente")}
         group by p.id, p.q
        having bool_and(${DONE}) and bool_and(w.completed_at is not null) and bool_and(coalesce(nullif(trim(w.finished_qty), ''), w.packaging_total_units::text) is not null)
      ) t where ${yr("t.cd")} ${mon("t.cd")}`
  );
  const clients = await q(
    `select count(distinct lower(trim(cliente)))::int as n from production_pedidos p
      where p.deleted_at is null and ${yr("p.fecha")} ${mon("p.fecha")} ${cl("p.cliente")} and nullif(trim(cliente), '') is not null`
  );
  return {
    unitsMasivo: u.ENVASADO_MASIVO ?? 0,
    unitsPremium: u.ENVASADO_PREMIUM ?? 0,
    unitsSector,
    distinct: distinct[0].n,
    activos: (pe.INGRESO ?? 0) + (pe.EN_ELABORACION ?? 0) + (pe.EN_ENVASADO ?? 0) + (pe.EN_CODIFICADO ?? 0),
    despacho: pe.LISTO_PARA_ENTREGAR ?? 0,
    entregados: pe.ENTREGADO ?? 0,
    totalPedidos: Object.values(pe).reduce((s, n) => s + n, 0),
    leadTime: lead[0].v,
    leadN: lead[0].n,
    service: service[0].v,
    serviceN: service[0].n,
    clients: clients[0].n,
  };
}

async function readScreen(page) {
  return {
    unitsTotal: await kpiValue(page, "unidades_producidas"),
    unitsMasivo: num(await text(page, "prod-masivo-units").catch(() => "")),
    unitsPremium: num(await text(page, "prod-premium-units").catch(() => "")),
    distinct: await kpiValue(page, "productos_distintos"),
    activos: await kpiValue(page, "pedidos_activos"),
    despacho: await kpiValue(page, "pedidos_en_despacho"),
    entregados: await kpiValue(page, "pedidos_entregados"),
    leadTime: await kpiValue(page, "lead_time"),
    leadN: await kpiSample(page, "lead_time"),
    service: await kpiValue(page, "nivel_servicio"),
    serviceN: await kpiSample(page, "nivel_servicio"),
    clients: await kpiValue(page, "clientes_activos"),
  };
}

function compare(label, screen, exp, { checkClients = true } = {}) {
  check(`${label}: unidades (pantalla ${screen.unitsTotal} = SQL ${exp.unitsSector || null})`, (screen.unitsTotal ?? null) === (exp.unitsSector || null));
  check(`${label}: productos distintos (${screen.distinct} = SQL ${exp.distinct || null})`, (screen.distinct ?? null) === (exp.distinct || null));
  check(`${label}: pedidos activos/despacho/entregados (${screen.activos}/${screen.despacho}/${screen.entregados} = SQL ${exp.activos}/${exp.despacho}/${exp.entregados})`,
    exp.totalPedidos === 0 ? screen.activos == null && screen.despacho == null && screen.entregados == null : screen.activos === exp.activos && screen.despacho === exp.despacho && screen.entregados === exp.entregados);
  check(`${label}: lead time (${screen.leadTime} = SQL ${exp.leadTime == null ? null : Math.round(exp.leadTime * 10) / 10}, n ${screen.leadN}/${exp.leadN})`,
    exp.leadTime == null ? screen.leadTime == null : near(screen.leadTime, Math.round(exp.leadTime * 10) / 10) && screen.leadN === exp.leadN);
  check(`${label}: nivel de servicio (${screen.service} = SQL ${exp.service == null ? null : Math.round(exp.service * 10) / 10}, n ${screen.serviceN}/${exp.serviceN})`,
    exp.service == null ? screen.service == null : near(screen.service, Math.round(exp.service * 10) / 10) && screen.serviceN === exp.serviceN);
  if (checkClients) check(`${label}: clientes activos (${screen.clients} = SQL ${exp.clients || null})`, (screen.clients ?? null) === (exp.clients || null));
}

/** Huella de las tablas de ORIGEN: el Dashboard nunca debe modificarlas. */
async function sourceFingerprint() {
  const tables = ["production_pedidos", "work_items", "work_item_deliveries", "remitos", "remito_lines", "mp_stock_movements", "mp_stock_balances", "operational_orders"];
  const h = createHash("sha256");
  for (const t of tables) {
    const rows = await q(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as m, count(*)::int as n from ${t} x`);
    h.update(`${t}:${rows[0].n}:${rows[0].m};`);
  }
  return h.digest("hex");
}

async function apiGet(ctx, qs) {
  const res = await ctx.request.get(`/api/v1/dashboard${qs ? `?${qs}` : ""}`);
  return { status: res.status(), text: await res.text() };
}

// ---------------------------------------------------------------------------------------------------------------
try {
  await cleanup();
  const pr = await openAs(E2E_USERS.produccion);
  const page = pr.page;

  // ===== 1. Sin datos reales ===========================================================================================
  console.log("\n== 1. Sin datos reales ==");
  await openDashboard(page);
  await setFilter(page, "filter-year", String(YEAR));
  await page.getByTestId("dashboard-year").filter({ hasText: `Año ${YEAR}` }).waitFor({ timeout: 30_000 }).catch(() => {});
  check("título «Dashboard Operativo» y año seleccionado", (await text(page, "dashboard-title")) === "Dashboard Operativo" && (await text(page, "dashboard-year")) === "Año completo");
  check("fecha de última actualización visible", /Última actualización de datos/.test(await text(page, "dashboard-updated")));
  const allKeys = ["nivel_servicio", "sin_reclamos", "lead_time", "unidades_producidas", "pedidos_activos", "pedidos_entregados", "pedidos_en_despacho", "productos_distintos", "clientes_activos"];
  let allEmpty = true;
  for (const k of allKeys) {
    const has = await page.getByTestId(`kpi-${k}`).getAttribute("data-has-value");
    if (has !== "0") allEmpty = false;
  }
  check("sin datos: los 9 indicadores dicen «Sin datos suficientes» (ningún número de relleno)", allEmpty);
  check("sin datos: el semáforo no inventa colores", (await page.locator("[data-testid=dashboard-indicators] [data-light]").evaluateAll((els) => els.map((e) => e.getAttribute("data-light")))).every((l) => l === "sin_datos"));
  check("sin datos: resumen gerencial vacío con aviso", /Sin datos suficientes para generar el resumen/.test(await text(page, "dashboard-summary")));
  check("sin datos: gráfico mensual dice «Sin datos suficientes»", await page.getByTestId("chart-sin-datos").isVisible());
  check("sin reclamos: explica que GENUS OS no registra reclamos y qué registrar", /no registra reclamos/i.test(await text(page, "kpi-sin_reclamos")) && /Para calcularlo/.test(await text(page, "kpi-sin_reclamos")));
  await shot(page, "01-produccion-sin-datos-1440");

  // ===== 2. Datos de prueba ===========================================================================================
  console.log("\n== 2. Datos de prueba (solo base descartable) ==");
  await seed();
  const fpBefore = await sourceFingerprint();
  await page.reload();
  await openDashboard(page);
  await setFilter(page, "filter-year", String(YEAR));

  const exp = await sqlExpected({ year: YEAR });
  // Valores calculados a mano (ver comentarios del seed).
  check("a mano: Masivo 4.500 / Premium 950 / total 5.450", exp.unitsMasivo === 4500 && exp.unitsPremium === 950 && exp.unitsSector === 5450, JSON.stringify([exp.unitsMasivo, exp.unitsPremium]));
  check("a mano: lead time 19,5 días (n=4) y nivel de servicio 95,0 % (n=4)", near(exp.leadTime, 19.5) && exp.leadN === 4 && near(exp.service, 95) && exp.serviceN === 4);
  let screen = await readScreen(page);
  compare("año 2026", screen, exp);
  check("Masivo en pantalla = SQL", screen.unitsMasivo === exp.unitsMasivo, `${screen.unitsMasivo}`);
  check("Premium en pantalla = SQL", screen.unitsPremium === exp.unitsPremium, `${screen.unitsPremium}`);
  check("participación Masivo 82,6 % / Premium 17,4 %", (await text(page, "prod-masivo-share")) === "82,6 %" && (await text(page, "prod-premium-share")) === "17,4 %");
  check("total anual 5.450", num(await text(page, "prod-total")) === 5450);
  check("reclamos siguen «Sin datos suficientes» aun con datos", (await page.getByTestId("kpi-sin_reclamos").getAttribute("data-has-value")) === "0");
  check("cada KPI muestra su tipo de fecha (pedido / producción / entrega)",
    (await text(page, "kpi-pedidos_activos")).includes("Fecha de pedido") && (await text(page, "kpi-lead_time")).includes("Fecha de entrega") && (await text(page, "kpi-unidades_producidas")).includes("Fecha de producción"));
  check("gráfico mensual: etiquetas de valor y tabla accesible", (await page.getByTestId("dashboard-bar-chart").locator("svg").first().getAttribute("role")) === "img" && /2\.000/.test(await text(page, "dashboard-bar-chart")) && /1\.500/.test(await text(page, "dashboard-bar-chart")));
  const rank = await text(page, "clients-ranking");
  check("ranking de clientes por pedidos: Alfa(3) > Beta(2) > Gamma(1)", rank.indexOf(ALFA) < rank.indexOf(BETA) && rank.indexOf(BETA) < rank.indexOf(GAMMA) && /3 pedidos/.test(rank) && /2 pedidos/.test(rank));
  const best = await text(page, "clients-best-lead-time");
  check("menor lead time por cliente: Alfa 18,0 días (n=3) antes que Beta 24,0 (n=1); Gamma sin entregas no aparece", best.indexOf(ALFA) < best.indexOf(BETA) && /18,0 días \(n=3\)/.test(best) && /24,0 días \(n=1\)/.test(best) && !best.includes(GAMMA), best);
  const cmp = await text(page, "clients-comparison");
  check("comparación entre clientes: lead time y servicio por cliente", /96,7 %/.test(cmp) && /90,0 %/.test(cmp) && /Sin datos/.test(cmp), cmp.slice(0, 200));
  check("resumen gerencial determinístico con los números", /5\.450 unidades/.test(await text(page, "dashboard-summary")) && /lead time promedio es 19,5 días/.test(await text(page, "dashboard-summary")));
  await shot(page, "02-produccion-con-datos-1440", { height: 2300 });

  // ===== 3. Filtros ==================================================================================================
  console.log("\n== 3. Filtros ==");
  await setFilter(page, "filter-month", "3");
  let e = await sqlExpected({ year: YEAR, month: 3 });
  screen = await readScreen(page);
  compare("marzo 2026", screen, e);
  check("marzo: período visible en cabecera y en cada KPI", (await text(page, "dashboard-period")) === "Marzo 2026" && (await text(page, "kpi-lead_time")).includes("Marzo 2026"));
  check("marzo: a mano 2.450 unidades, lead 23,5 (n=2), servicio 95,0 (n=2)", screen.unitsTotal === 2450 && near(screen.leadTime, 23.5) && screen.leadN === 2 && near(screen.service, 95) && screen.serviceN === 2);
  check("marzo: el gráfico sigue mostrando el año completo", /1\.500/.test(await text(page, "dashboard-bar-chart")));
  await setFilter(page, "filter-month", "");
  await setFilter(page, "filter-sector", "ENVASADO_MASIVO");
  e = await sqlExpected({ year: YEAR, sector: "ENVASADO_MASIVO" });
  screen = await readScreen(page);
  compare("sector Masivo", screen, e);
  check("sector Masivo: unidades 4.500 y productos distintos 3", screen.unitsTotal === 4500 && screen.distinct === 3);
  check("sector Masivo: aclara que no aplica a pedidos/lead time", /no aplica/i.test(await text(page, "kpi-lead_time")));
  await setFilter(page, "filter-sector", "ALL");
  await setFilter(page, "filter-client", BETA);
  e = await sqlExpected({ year: YEAR, client: BETA });
  screen = await readScreen(page);
  compare("cliente Beta", screen, e, { checkClients: false });
  check("cliente Beta: pedidos 2, unidades 1.950, lead 24,0 (n=1)", screen.activos + screen.despacho + screen.entregados === 2 && screen.unitsTotal === 1950 && near(screen.leadTime, 24) && screen.leadN === 1, JSON.stringify(screen));
  await resetFilters(page);
  await setFilter(page, "filter-year", "2025");
  e = await sqlExpected({ year: 2025 });
  screen = await readScreen(page);
  compare("año 2025", screen, e);
  check("año 2025: sin producción → unidades y lead time «Sin datos suficientes»; 1 pedido entregado", screen.unitsTotal == null && screen.leadTime == null && screen.entregados === 1);
  await resetFilters(page);
  check("limpiar filtros vuelve al año completo", (await text(page, "dashboard-period")) === "Año completo");

  // ===== 4. Semáforo y objetivos ======================================================================================
  console.log("\n== 4. Semáforo y objetivos ==");
  check("sin objetivos guardados: «Sin objetivo definido» (gris)", (await page.getByTestId("indicator-nivel_servicio").getAttribute("data-light")) === "sin_objetivo" && (await page.getByTestId("indicator-lead_time").getAttribute("data-light")) === "sin_objetivo");
  const setTarget = async (key, value, direction) => {
    await page.getByTestId(`target-edit-${key}`).click();
    await page.getByTestId(`target-input-${key}`).fill(value);
    await page.getByTestId(`target-direction-${key}`).selectOption(direction);
    const wait = page.waitForResponse((r) => r.url().includes("/api/v1/dashboard/targets") && r.request().method() === "PUT");
    await page.getByTestId(`target-save-${key}`).click();
    const res = await wait;
    await settle(page);
    return res.status();
  };
  check("Producción define objetivo de nivel de servicio (≥ 97 → 95,0 queda en amarillo)", (await setTarget("nivel_servicio", "97", "min")) === 200);
  check("lead time ≤ 25 (19,5 → verde)", (await setTarget("lead_time", "25", "max")) === 200);
  check("unidades ≥ 10000 anual (5.450 → rojo)", (await setTarget("unidades_producidas", "10000", "min")) === 200);
  check("semáforo calculado con la regla: amarillo / verde / rojo / sin datos",
    (await page.getByTestId("indicator-nivel_servicio").getAttribute("data-light")) === "amarillo" &&
      (await page.getByTestId("indicator-lead_time").getAttribute("data-light")) === "verde" &&
      (await page.getByTestId("indicator-unidades_producidas").getAttribute("data-light")) === "rojo" &&
      (await page.getByTestId("indicator-sin_reclamos").getAttribute("data-light")) === "sin_datos");
  check("objetivo visible junto al resultado (≥ 97,0 % / ≤ 25,0 días)", /≥ 97,0 %/.test(await text(page, "indicator-nivel_servicio-target")) && /≤ 25,0 días/.test(await text(page, "indicator-lead_time-target")));
  check("resumen gerencial menciona el objetivo y marca el rojo", /objetivo ≥ 97,0 %/.test(await text(page, "dashboard-summary")) && /en rojo/.test(await text(page, "dashboard-summary")));
  await page.reload();
  await openDashboard(page);
  check("los objetivos persisten tras recargar", (await page.getByTestId("indicator-nivel_servicio").getAttribute("data-light")) === "amarillo");
  const trows = await q("select key, target_value, direction, unit, updated_by from dashboard_kpi_targets order by key");
  check("tabla dashboard_kpi_targets con 3 objetivos, usuario y unidad", trows.length === 3 && trows.every((r) => r.updated_by === E2E_USERS.produccion.email) && trows.find((r) => r.key === "lead_time")?.direction === "max" && trows.find((r) => r.key === "nivel_servicio")?.unit === "percent");
  const audit = await q("select action, actor_email, actor_sector, entity_id, payload from feature_audit_events where domain = 'dashboard' order by created_at");
  check("auditoría en feature_audit_events (dominio dashboard): 3 target_set con actor y valor", audit.length === 3 && audit.every((a) => a.action === "target_set" && a.actor_sector === "PRODUCCION") && audit.some((a) => a.entity_id === "nivel_servicio" && a.payload?.next?.targetValue === 97));
  // Objetivo inválido desde la UI
  await page.getByTestId("target-edit-lead_time").click();
  await page.getByTestId("target-input-lead_time").fill("abc");
  await page.getByTestId("target-save-lead_time").click();
  check("objetivo no numérico: se rechaza en pantalla sin guardar", /Ingresá un número/.test(await page.getByTestId("target-editor-lead_time").innerText()));
  await page.getByTestId("target-editor-lead_time").getByRole("button", { name: "Cancelar" }).click();
  // Quitar objetivo
  await page.getByTestId("target-edit-lead_time").click();
  const waitDel = page.waitForResponse((r) => r.url().includes("/api/v1/dashboard/targets") && r.request().method() === "DELETE");
  await page.getByTestId("target-clear-lead_time").click();
  await waitDel;
  await settle(page);
  check("quitar objetivo vuelve a «Sin objetivo definido» y queda auditado", (await page.getByTestId("indicator-lead_time").getAttribute("data-light")) === "sin_objetivo" && (await q("select count(*)::int as n from feature_audit_events where domain = 'dashboard' and action = 'target_cleared'"))[0].n === 1);
  await setTarget("lead_time", "25", "max");
  check("objetivo anual de unidades no aplica a un mes (no_aplica)", (await (async () => { await setFilter(page, "filter-month", "3"); return page.getByTestId("indicator-unidades_producidas").getAttribute("data-light"); })()) === "no_aplica");
  await resetFilters(page);

  // ===== 5. Solo lectura ==============================================================================================
  console.log("\n== 5. Solo lectura ==");
  const fpAfter = await sourceFingerprint();
  check("pedidos, trabajos, entregas, remitos, stock y OE no cambiaron por usar el Dashboard", fpBefore === fpAfter);

  // ===== 6. Permisos por sector =======================================================================================
  console.log("\n== 6. Permisos por sector ==");
  const prApi = await apiGet(pr.ctx, `year=${YEAR}`);
  check("Producción: el payload incluye los clientes", CLIENT_NAMES.every((c) => prApi.text.includes(c)));
  const dir = await openAs(E2E_USERS.direccion);
  await openDashboard(dir.page);
  await setFilter(dir.page, "filter-year", String(YEAR));
  check("Dirección ve todo: clientes, ranking y filtro por cliente", (await dir.page.getByTestId("clients-block").isVisible()) && (await dir.page.getByTestId("filter-client").isVisible()) && (await text(dir.page, "clients-ranking")).includes(ALFA));
  check("Dirección puede editar objetivos", await dir.page.getByTestId("target-edit-nivel_servicio").isVisible());
  await dir.ctx.close();

  const aggregate = [
    ["Envasado Masivo", E2E_USERS.envasado],
    ["Envasado Premium", E2E_USERS.envasadoPremium],
    ["Elaboración", E2E_USERS.elaboracion],
    ["Codificado", E2E_USERS.codificado],
    ["Calidad", E2E_USERS.calidad],
    ["Materia Prima", E2E_USERS.materiaPrima],
    ["Depósito", E2E_USERS.deposito],
  ];
  let envasadoSession = null;
  for (const [label, user] of aggregate) {
    const s = await openAs(user);
    await openDashboard(s.page);
    await setFilter(s.page, "filter-year", String(YEAR));
    const html = await s.page.content();
    check(`${label}: «Dashboard» en el menú y la vista abre`, await s.page.getByTestId("dashboard-title").isVisible());
    check(`${label}: clientes «No disponible para tu sector» y sin filtro de cliente`, /No disponible para tu sector/.test(await text(s.page, "clients-not-available")) && (await s.page.getByTestId("filter-client").count()) === 0);
    check(`${label}: nivel de servicio, lead time y reclamos «No disponible para tu sector»`, (await s.page.getByTestId("kpi-not-available").count()) === 3);
    check(`${label}: el DOM no contiene nombres de clientes`, !CLIENT_NAMES.some((c) => html.includes(c)));
    const api = await apiGet(s.ctx, `year=${YEAR}`);
    check(`${label}: el payload del servidor no contiene nombres de clientes (recortado en servidor)`, api.status === 200 && !CLIENT_NAMES.some((c) => api.text.includes(c)) && !/"ranking":\[\{/.test(api.text));
    const apiClient = await apiGet(s.ctx, `year=${YEAR}&client=${encodeURIComponent(BETA)}`);
    check(`${label}: filtro por cliente por API → 403`, apiClient.status === 403 && !apiClient.text.includes(ALFA));
    const put = await s.ctx.request.put("/api/v1/dashboard/targets", { data: { key: "lead_time", value: 1, direction: "max" } });
    check(`${label}: no puede definir objetivos (403)`, put.status() === 403);
    check(`${label}: ve los agregados autorizados (unidades, pedidos, evolución mensual)`, (await kpiValue(s.page, "unidades_producidas")) === 5450 && (await kpiValue(s.page, "pedidos_entregados")) === 2 && (await s.page.getByTestId("dashboard-bar-chart").count()) === 1);
    check(`${label}: ve el objetivo de unidades en solo lectura (sin botón de edición)`, (await s.page.getByTestId("target-edit-unidades_producidas").count()) === 0 && (await s.page.getByTestId("indicator-unidades_producidas").getAttribute("data-light")) === "rojo");
    if (label === "Envasado Masivo") envasadoSession = s;
    else await s.ctx.close();
  }
  check("Envasado Masivo: destaca «Tu sector»", /Tu sector/.test(await text(envasadoSession.page, "prod-masivo")));
  const objetivosAfter = await q("select count(*)::int as n from dashboard_kpi_targets");
  check("ningún sector sin permiso modificó los objetivos", objetivosAfter[0].n === 3);

  // ===== 7. Capturas y scroll horizontal ==============================================================================
  console.log("\n== 7. Capturas (escritorio 1440 / tablet 820 / celular 390) ==");
  await envasadoSession.page.setViewportSize({ width: 1440, height: 900 });
  await shot(envasadoSession.page, "03-envasado-masivo-1440", { height: 2200 });
  await hscroll(envasadoSession.page, "Envasado Masivo 1440");
  await envasadoSession.ctx.close();

  for (const [name, vp, tall] of [
    ["1440", { width: 1440, height: 900 }, 2300],
    ["820", { width: 820, height: 1180 }, 3300],
    ["390", { width: 390, height: 844 }, 4600],
  ]) {
    const s = await openAs(E2E_USERS.produccion, vp);
    const mobile = vp.width < 768;
    await openDashboard(s.page, { mobile });
    await setFilter(s.page, "filter-year", String(YEAR));
    await shot(s.page, `04-produccion-${name}-pantalla`);
    await shot(s.page, `04-produccion-${name}-completo`, { height: tall });
    await hscroll(s.page, `Producción ${name}`);
    if (mobile) {
      check("celular: el menú lateral está detrás de «Abrir menú»", (await s.page.getByRole("button", { name: "Abrir menú" }).isVisible()) && (await s.page.getByRole("navigation", { name: "Menú" }).count()) === 0);
      const filtersBox = await s.page.getByTestId("dashboard-filters").boundingBox();
      check("celular: filtros apilados dentro del ancho", filtersBox != null && filtersBox.width <= vp.width);
    }
    await s.ctx.close();
    // Envasado en celular/tablet
    const e2 = await openAs(E2E_USERS.envasado, vp);
    await openDashboard(e2.page, { mobile });
    await setFilter(e2.page, "filter-year", String(YEAR));
    await shot(e2.page, `05-envasado-${name}-completo`, { height: tall });
    await hscroll(e2.page, `Envasado ${name}`);
    await e2.ctx.close();
  }

  // Dashboard sin scroll horizontal tras abrir un criterio y el editor de objetivos (1440)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir menú" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.getByRole("button", { name: /Ver criterio de Lead time/ }).click().catch(() => {});
  await page.getByTestId("target-edit-nivel_servicio").click().catch(() => {});
  await hscroll(page, "Producción 390 con criterio y editor de objetivos abiertos");
  await shot(page, "06-produccion-390-editor-objetivo", { height: 2600 });
  await pr.ctx.close();
} catch (err) {
  check("ejecución sin excepciones", false, err instanceof Error ? err.stack ?? err.message : String(err));
} finally {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n - " + failed.map((f) => f.name).join("\n - "));
  process.exit(1);
}
