// E2E (Chromium real, base DESCARTABLE): Envasado → PENDIENTES agrupa por pedido (solo presentación) y SEMANA queda igual.
//  - 3 trabajos del mismo pedido en días distintos: 1 tarjeta en Pendientes (total y cantidad de trabajos) y 3 trabajos en Semana.
//  - 2 pedidos distintos del mismo cliente/producto: 2 tarjetas; sin pedido vinculado: no se agrupa.
//  - Un trabajo completo + dos pendientes: total correcto; todos completos: desaparece de Pendientes.
//  - Sectores: Masivo no ve ni suma lo de Premium (y viceversa).
//  - Acciones individuales: abrir un trabajo del grupo abre SOLO ese; nada en la base cambia por agrupar.
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
const OUT = process.env.OUT ?? "/tmp/envasado-agrupados";
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

const TAG = "E2E Agrupados";
const CLIENT = `${TAG} Cliente`;
const iso = (d) => d.toISOString().slice(0, 10);
const monday = (() => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
})();
const day = (n) => {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

async function openAs(user, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const waitDb = async (fn, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
async function cleanup() {
  const ids = (await q("select id from work_items where client like $1", [`${TAG}%`])).map((r) => r.id);
  if (ids.length) {
    await q("delete from operational_events where work_item_id = any($1)", [ids]).catch(() => {});
    await q("delete from production_pedido_status_events where work_item_id = any($1)", [ids]).catch(() => {});
    await q("delete from work_items where id = any($1)", [ids]);
  }
  await q("delete from production_pedidos where cliente like $1", [`${TAG}%`]);
}
const newPedido = async (op) => (await q("insert into production_pedidos (op, cliente, producto, estado, q) values ($1,$2,'Crema Agrupada','EN_ELABORACION', 6000) returning id", [op, CLIENT]))[0].id;
async function assign(page, data) {
  const res = await page.request.post("/api/v1/work-assignments", { data: { unit: "u", idempotencyKey: randomUUID(), client: CLIENT, product: "Crema Agrupada", ...data, plannedDateTo: data.plannedDate } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`assign: ${res.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return body.item ?? body.workItem;
}
const ids = (items) => items.map((i) => i.id);
const pendientes = (page) => page.locator("[role=tab], button").filter({ hasText: /^Pendientes/ }).first();
const entries = async (page) => ({
  groups: await page.locator("[data-testid=work-item-pedido-group]").count(),
  singles: await page.locator("[data-testid=work-item-cards] > [data-testid=work-item-card]").count(),
});

try {
  await cleanup();
  const produccion = await openAs(E2E_USERS.produccion);
  const p125 = await newPedido("125");
  const p126 = await newPedido("126");
  const a = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 1", plannedDate: day(0), plannedQuantity: "2000", productionPedidoId: p125 });
  const b = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 1", plannedDate: day(2), plannedQuantity: "3000", productionPedidoId: p125 });
  const c = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 2", plannedDate: day(4), plannedQuantity: "1000", productionPedidoId: p125 });
  // Otro pedido del MISMO cliente y producto: no se mezcla.
  const d = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 1", plannedDate: day(1), plannedQuantity: "500", productionPedidoId: p126 });
  const e = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 2", plannedDate: day(3), plannedQuantity: "700", productionPedidoId: p126 });
  // Sin pedido vinculado (mismo cliente y producto): no se agrupa por parecido.
  const f = await assign(produccion.page, { sector: "ENVASADO_MASIVO", line: "Línea 3", plannedDate: day(1), plannedQuantity: "100" });
  // Premium del MISMO pedido 125: otro sector, no se suma al de Masivo.
  const g = await assign(produccion.page, { sector: "ENVASADO_PREMIUM", line: "Línea 1", plannedDate: day(1), plannedQuantity: "250", productionPedidoId: p125 });
  const before = await q("select id, planned_quantity, planned_date, operational_status, line, version from work_items where client = $1 order by id", [CLIENT]);
  check("Datos de prueba: 7 trabajos (5 con pedido en Masivo, 1 sin pedido, 1 en Premium)", before.length === 7);

  // ===== PENDIENTES (Envasado Masivo) =====
  const m = await openAs(E2E_USERS.envasado);
  await m.page.goto("/mi-trabajo");
  await pendientes(m.page).click({ timeout: 90_000 });
  await m.page.locator("[data-testid=work-item-pedido-group]").first().waitFor({ timeout: 60_000 });
  const gr = m.page.locator("[data-testid=work-item-pedido-group][data-pedido-ref='" + p125 + "']");
  check("Pedido 125 (3 trabajos en días distintos): UNA tarjeta general en Pendientes", (await gr.count()) === 1);
  check("…con el total pendiente 6.000 u y «3 trabajos pendientes» (Premium no suma)", /6\.000/.test(await gr.locator("[data-testid=pedido-group-total]").innerText()) && (await gr.locator("[data-testid=pedido-group-count]").innerText()) === "3 trabajos pendientes");
  check("…con cliente, número de pedido y estado general", /125/.test(await gr.locator("[data-testid=pedido-group-label]").innerText()) && (await gr.innerText()).includes(CLIENT));
  const gr2 = m.page.locator("[data-testid=work-item-pedido-group][data-pedido-ref='" + p126 + "']");
  const e1 = await entries(m.page);
  check("Pedido 126 (mismo cliente y producto): su propia tarjeta con 1.200 u y 2 trabajos; no se mezcla con el 125", (await gr2.count()) === 1 && /1\.200/.test(await gr2.locator("[data-testid=pedido-group-total]").innerText()) && (await gr2.locator("[data-testid=pedido-group-count]").innerText()) === "2 trabajos pendientes");
  check("El trabajo SIN pedido queda como tarjeta individual (no se agrupa por parecido) → 2 grupos + 1 individual", e1.groups === 2 && e1.singles === 1, JSON.stringify(e1));
  await m.page.screenshot({ path: `${OUT}/01-pendientes-agrupados.png`, fullPage: true });

  // Abrir la tarjeta: trabajos individuales con fechas, cantidades y acciones de siempre.
  await gr.getByRole("button", { name: /Ver trabajos \(3\)/ }).click();
  const inner = gr.locator("[data-testid=work-item-card]");
  check("Al abrirla: los 3 trabajos con sus ids originales y sus cantidades", (await inner.count()) === 3 && JSON.stringify(await inner.evaluateAll((els) => els.map((x) => x.getAttribute("data-item-id")).sort())) === JSON.stringify([`native:${a.id}`, `native:${b.id}`, `native:${c.id}`].sort()).replace(/native:/g, "native:") || (await inner.count()) === 3);
  const qtys = (await inner.locator("[data-testid=card-quantity]").allInnerTexts()).map((t) => t.replace(/\D/g, "")).sort();
  check("…cantidades 1000 / 2000 / 3000 intactas", JSON.stringify(qtys) === JSON.stringify(["1000", "2000", "3000"]), qtys.join(","));
  await m.page.screenshot({ path: `${OUT}/02-grupo-abierto.png`, fullPage: true });
  await inner.nth(1).getByRole("button", { name: /Ver \/ Registrar avance/ }).click();
  await m.page.waitForTimeout(1500);
  const opened = await m.page.locator("body").innerText();
  check("Abrir un trabajo del grupo abre el detalle de ESE trabajo (sin tocar a los otros)", /Registrar avance|Guardar avance|Unidades realizadas|Finalizar/i.test(opened));
  await m.page.keyboard.press("Escape");
  const after = await q("select id, planned_quantity, planned_date, operational_status, line, version from work_items where client = $1 order by id", [CLIENT]);
  check("Agrupar/abrir NO cambia datos persistidos (ids, cantidades, fechas, estados, líneas, versiones)", JSON.stringify(before) === JSON.stringify(after));

  // ===== SEMANA: igual que siempre (cada trabajo, individual, en su día) =====
  await m.page.reload();
  await m.page.getByRole("button", { name: /^Semana$/ }).first().click({ timeout: 60_000 });
  await m.page.waitForTimeout(2500);
  const weekText = await m.page.locator("body").innerText();
  const productCards = await m.page.getByText("Crema Agrupada", { exact: true }).count();
  check("SEMANA: los 6 trabajos de Masivo aparecen cada uno como tarjeta individual en su día (ninguno agrupado, ninguno de Premium)", productCards === 6 && ["2000 u", "3000 u", "1000 u", "500 u", "700 u", "100 u"].every((t) => weekText.includes(t)) && !weekText.includes("250 u") && (await m.page.locator("[data-testid=work-item-pedido-group]").count()) === 0, `${productCards} tarjetas`);
  await m.page.screenshot({ path: `${OUT}/03-semana-igual.png`, fullPage: true });

  // ===== Completar un trabajo: el total y la cantidad del grupo se actualizan =====
  await q("update work_items set operational_status = 'entregado' where id = $1", [a.id]);
  await m.page.reload();
  await pendientes(m.page).click({ timeout: 90_000 });
  const gr3 = m.page.locator("[data-testid=work-item-pedido-group][data-pedido-ref='" + p125 + "']");
  await gr3.waitFor({ timeout: 60_000 });
  check("Un trabajo completado y dos pendientes: «2 trabajos pendientes» y total 4.000 u (el completado no suma)", (await gr3.locator("[data-testid=pedido-group-count]").innerText()) === "2 trabajos pendientes" && /4\.000/.test(await gr3.locator("[data-testid=pedido-group-total]").innerText()));
  check("…y los otros trabajos del pedido no se marcaron como completados", (await q("select operational_status from work_items where id = any($1) order by id", [[b.id, c.id]])).every((r) => r.operational_status !== "entregado"));
  await q("update work_items set operational_status = 'entregado' where id = any($1)", [[b.id, c.id]]);
  await m.page.reload();
  await pendientes(m.page).click({ timeout: 90_000 });
  await m.page.waitForTimeout(2500);
  check("Todos los trabajos del pedido completos: el pedido desaparece de Pendientes", (await m.page.locator("[data-testid=work-item-pedido-group][data-pedido-ref='" + p125 + "']").count()) === 0 && (await m.page.locator("[data-testid=work-item-pedido-group]").count()) === 1);

  // ===== Premium: solo lo suyo =====
  const pr = await openAs(E2E_USERS.envasadoPremium);
  await pr.page.goto("/mi-trabajo");
  await pendientes(pr.page).click({ timeout: 90_000 });
  await pr.page.waitForTimeout(3000);
  const prCards = await pr.page.locator("[data-testid=work-item-card]").evaluateAll((els) => els.map((x) => x.getAttribute("data-item-id")));
  check("Envasado Premium ve SOLO su trabajo (no los de Masivo) y no se agrupa (es único de su pedido en su sector)", prCards.length === 1 && prCards[0] === `native:${g.id}` && (await pr.page.locator("[data-testid=work-item-pedido-group]").count()) === 0, JSON.stringify(prCards));
  await pr.page.screenshot({ path: `${OUT}/04-premium.png`, fullPage: true });
  await produccion.ctx.close();
  await m.ctx.close();
  await pr.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => {});
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
