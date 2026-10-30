// E2E en Chromium real: Depósito → Pedidos (SOLO LECTURA). Base DESCARTABLE; login real con el usuario de Depósito.
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
const OUT = process.env.OUT ?? "/tmp/pedidos-deposito";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const CLI = "CLIENTE PDEP E2E";
const cleanup = async () => { await q("delete from production_pedidos where cliente like $1", [`${CLI}%`]).catch(() => undefined); };

async function openAs(user) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const rowsText = async (page) => (await page.locator("[data-testid=pedidos-dep-row]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

try {
  await cleanup();
  const pr = await openAs(E2E_USERS.produccion);
  const mk = async (data) => { const r = await pr.page.request.post("/api/v1/production-pedidos", { data }); if (r.status() !== 201) throw new Error(`pedido ${data.producto}: ${r.status()} ${await r.text()}`); return (await r.json()).item; };
  // Un pedido (OP) con TRES productos + otro pedido de otro cliente.
  const p1 = await mk({ op: "PDEP-1", cliente: CLI, producto: "CREMA HIDRATANTE PDEP", q: 1000, ml: 50, estado: "INGRESO", fecha: "2026-10-01" });
  await mk({ op: "PDEP-1", cliente: CLI, producto: "GEL LIMPIADOR PDEP", q: 250, ml: 30, estado: "EN_ENVASADO" });
  await mk({ op: "PDEP-1", cliente: CLI, producto: "SERUM FACIAL PDEP", q: 40, ml: 10, estado: "ENTREGADO" });
  await mk({ op: "PDEP-2", cliente: `${CLI} DOS`, producto: "SHAMPOO PDEP", q: 5000, ml: 250, estado: "INGRESO" });
  const before = JSON.stringify(await q("select id, estado, q, ml, producto, cliente, updated_at from production_pedidos where cliente like $1 order by id", [`${CLI}%`]));

  const dp = await openAs(E2E_USERS.deposito);
  const p = dp.page;
  await p.goto("/mi-trabajo");
  check("el menú de Depósito tiene la pestaña «Pedidos»", (await p.getByRole("button", { name: /^Pedidos$/ }).or(p.getByRole("link", { name: /^Pedidos$/ })).count()) >= 1);
  await nav(p, "Pedidos");
  await p.locator("[data-testid=pedidos-dep-table]").waitFor({ timeout: 120_000 });
  await p.locator("[data-testid=pedidos-dep-row]").first().waitFor({ timeout: 60_000 });
  const heads = (await p.locator("[data-testid=pedidos-dep-table] thead th").allInnerTexts()).map((t) => t.trim().toLowerCase());
  check("la tabla tiene EXACTAMENTE tres columnas: Producto | Cliente | Cantidad total", JSON.stringify(heads) === JSON.stringify(["producto", "cliente", "cantidad total"]), JSON.stringify(heads));
  const rows = await rowsText(p);
  const mine = rows.filter((r) => r.includes("PDEP"));
  check("un pedido con tres productos aparece en TRES filas, cada una con su cantidad pedida", mine.length === 4 && mine.some((r) => /CREMA HIDRATANTE PDEP.*1\.000$/.test(r)) && mine.some((r) => /GEL LIMPIADOR PDEP.*250$/.test(r)) && mine.some((r) => /SERUM FACIAL PDEP.*40$/.test(r)) && mine.some((r) => /SHAMPOO PDEP.*5\.000$/.test(r)), mine.join(" | "));
  check("no hay fechas, estados, OP ni responsables en la tabla", !/INGRESO|ENVASADO|ENTREGADO|PDEP-1|2026/.test((await p.locator("[data-testid=pedidos-dep-table]").innerText())));
  await p.screenshot({ path: `${OUT}/1-pedidos-deposito.png` });

  const body = await p.locator("main, body").first().innerText();
  check("sin botones «Nuevo pedido», «Asignar», «Editar» ni «Eliminar»", (await p.getByRole("button", { name: /nuevo pedido|asignar|editar|eliminar|importar|pegar/i }).count()) === 0 && !/Nuevo pedido/i.test(body));
  await p.locator("[data-testid=pedidos-dep-row]").filter({ hasText: "CREMA HIDRATANTE PDEP" }).click();
  await p.locator("[data-testid=pedidos-dep-row]").filter({ hasText: "CREMA HIDRATANTE PDEP" }).dblclick();
  check("hacer clic en una fila no abre formularios ni diálogos de asignación", (await p.getByRole("dialog").count()) === 0 && (await p.locator("input:not([data-testid=pedidos-dep-search]):not([type=hidden])").count()) === 0);
  check("las celdas no son editables (sin campos de edición)", (await p.locator("[data-testid=pedidos-dep-table] input, [data-testid=pedidos-dep-table] [contenteditable]").count()) === 0);

  // Búsqueda
  await p.locator("[data-testid=pedidos-dep-search]").fill("shampoo");
  check("buscar por producto filtra la tabla", (await rowsText(p)).filter((r) => r.includes("PDEP")).length === 1);
  await p.locator("[data-testid=pedidos-dep-search]").fill("cliente pdep e2e dos");
  check("buscar por cliente filtra la tabla", (await rowsText(p)).filter((r) => r.includes("PDEP")).length === 1 && /SHAMPOO/.test((await rowsText(p))[0] ?? ""));
  await p.locator("[data-testid=pedidos-dep-search]").fill("zzz-no-existe");
  check("sin coincidencias muestra el mensaje vacío", (await p.locator("[data-testid=pedidos-dep-empty]").count()) === 1);
  await p.locator("[data-testid=pedidos-dep-search]").fill("");

  // Actualización automática: Producción registra y modifica; Depósito NO recarga la página.
  await mk({ op: "PDEP-3", cliente: CLI, producto: "TONICO NUEVO PDEP", q: 77, ml: 100, estado: "INGRESO" });
  await p.locator("[data-testid=pedidos-dep-row]").filter({ hasText: "TONICO NUEVO PDEP" }).waitFor({ timeout: 60_000 });
  check("un pedido nuevo de Producción aparece SIN recargar la página", true);
  const up = await pr.page.request.patch(`/api/v1/production-pedidos/${p1.id}`, { data: { op: "PDEP-1", cliente: CLI, producto: "CREMA HIDRATANTE PDEP", q: 1200, ml: 50, estado: "INGRESO", fecha: "2026-10-01" } });
  await p.waitForFunction(() => [...document.querySelectorAll("[data-testid=pedidos-dep-row]")].some((r) => /CREMA HIDRATANTE PDEP/.test(r.textContent ?? "") && /1\.200/.test(r.textContent ?? "")), null, { timeout: 60_000 });
  check("una cantidad modificada por Producción se actualiza sola", up.ok());

  // Llamadas directas a la API como Depósito
  const api = dp.page.request;
  const g = await api.get("/api/v1/production-pedidos/deposito");
  const gj = await g.json();
  check("GET /production-pedidos/deposito (Depósito) → 200 con solo producto, cliente y cantidad", g.status() === 200 && gj.items.length >= 5 && gj.items.every((i) => JSON.stringify(Object.keys(i).sort()) === JSON.stringify(["cantidadTotal", "cliente", "id", "producto"])));
  const attempts = {
    "crear (POST)": await api.post("/api/v1/production-pedidos", { data: { cliente: `${CLI} HACK`, producto: "X", q: 1 } }),
    "editar (PATCH /[id])": await api.patch(`/api/v1/production-pedidos/${p1.id}`, { data: { q: 1 } }),
    "eliminar (DELETE /[id])": await api.delete(`/api/v1/production-pedidos/${p1.id}`, { data: { reason: "x" } }),
    "editar celdas (PATCH /cells)": await api.patch("/api/v1/production-pedidos/cells", { data: { changes: [{ id: p1.id, field: "q", value: "1", expectedVersion: "x" }] } }),
    "importar (POST /import)": await api.post("/api/v1/production-pedidos/import", { data: { confirm: true, rows: [{ cliente: `${CLI} HACK`, producto: "X", q: 1 }], idempotencyKey: "pdep-hack-123456" } }),
    "listado completo de Producción (GET)": await api.get("/api/v1/production-pedidos"),
    "asignar a un sector (POST /work-assignments)": await api.post("/api/v1/work-assignments", { data: { sector: "ENVASADO_MASIVO", client: CLI, product: "X", plannedQuantity: "10", unit: "un.", plannedDate: "2026-11-02", productionPedidoId: p1.id, idempotencyKey: "pdep-hack-assign-1" } }),
  };
  for (const [name, r] of Object.entries(attempts)) check(`API directa como Depósito: ${name} → rechazado`, r.status() === 403 || r.status() === 401 || r.status() === 405, String(r.status()));
  const post405 = await api.post("/api/v1/production-pedidos/deposito", { data: {} });
  check("la ruta de Depósito no admite escritura (POST → 405)", post405.status() === 405, String(post405.status()));
  const after = JSON.stringify(await q("select id, estado, q, ml, producto, cliente, updated_at from production_pedidos where cliente like $1 and producto not like 'TONICO%' order by id", [`${CLI}%`]));
  const hack = (await q("select count(*)::int n from production_pedidos where cliente like $1", [`${CLI} HACK%`]))[0].n;
  const sameExceptEdit = JSON.parse(after).every((r) => JSON.parse(before).some((b) => b.id === r.id && b.estado === r.estado && b.producto === r.producto && b.cliente === r.cliente)) ;
  check("los pedidos reales no cambiaron (estados y datos intactos; sin pedidos nuevos de Depósito)", hack === 0 && sameExceptEdit);
  check("ni siquiera quedaron trabajos creados desde un intento de asignación", (await q("select count(*)::int n from work_items where client = $1", [CLI]))[0].n === 0);

  // Otros sectores y Producción
  const env = await openAs(E2E_USERS.envasado);
  const e1 = await env.page.request.get("/api/v1/production-pedidos/deposito");
  check("un sector sin acceso (Envasado) no puede consultar la vista de Depósito (403)", e1.status() === 403, String(e1.status()));
  const prl = await pr.page.request.get("/api/v1/production-pedidos");
  check("Producción conserva su acceso completo a Pedidos (200, con estados y fechas)", prl.status() === 200 && (await prl.json()).items.some((i) => i.estado));
  await pr.page.goto("/mi-trabajo");
  await nav(pr.page, "Pedidos");
  check("Producción sigue viendo su módulo completo de Pedidos (con alta/edición)", (await pr.page.getByRole("button", { name: /nuevo|pegar|importar/i }).count()) >= 1 || (await pr.page.locator(".dsg-container").count()) >= 1);
  await env.ctx.close();
  await dp.ctx.close();
  await pr.ctx.close();
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
