// E2E en Chromium real: Producción edita la planificación de los trabajos de cada sector DESDE LAS TARJETAS.
// Base DESCARTABLE (marca verificada), login real, planificación nativa, copia local de SEMANAS 2026.
// Ver run-produccion-edicion-local.sh. Deja capturas en $OUT.
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
const OUT = process.env.OUT ?? "/tmp/produccion-edicion";
mkdirSync(OUT, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);
const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const PRIORITY_DAY = "2026-05-06"; // semana con tareas en la copia local de SEMANAS 2026
const TAG = "E2E-PE";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const iso = (v) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);
const bare = (id) => String(id).replace(/^native:/, "");
const row = async (id) => (await q("select * from work_items where id = $1", [bare(id)]))[0];

async function seed() {
  await q("update work_items set deleted_at = now() where notes like $1 and deleted_at is null", [`${TAG}%`]);
  await q("update semanas_task_links set unlinked_at = now() where unlinked_at is null");
  await q("delete from semanas_task_priorities");
  await q("delete from asignacion_lotes_cell_audit where lote like 'E2E-L-%'");
  await q("delete from asignacion_lotes where lote like 'E2E-L-%'");
  const api = await pwRequest.newContext({ baseURL: BASE });
  const login = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (login.status() !== 200) throw new Error(`login: ${await login.text()}`);
  const ids = {};
  for (const weekStart of [mondayOf(TODAY), mondayOf(PRIORITY_DAY)]) {
    await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", [weekStart]);
    const list = await (await api.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json();
    let weekId = list.weeks?.[0]?.id;
    if (!weekId) weekId = (await (await api.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E edición" } })).json()).week.id;
    const create = async (key, data) => {
      const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { notes: TAG, ...data } });
      if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
      ids[key] = `native:${(await res.json()).item.id}`;
    };
    if (weekStart === mondayOf(TODAY)) {
      await create("env", { plannedDate: TODAY, client: "CLIENTE ORIGINAL", product: "SHAMPOO E2E", plannedQuantity: "2000", unit: "un", sector: "ENVASADO_MASIVO", line: "Línea 1" });
      await create("aprobado", { plannedDate: TODAY, client: "CLIENTE ORIGINAL", product: "ACONDICIONADOR APROBADO E2E", plannedQuantity: "800", unit: "un", sector: "ENVASADO_MASIVO", line: "Línea 1" });
      await create("elab", { plannedDate: TODAY, client: "CLIENTE ORIGINAL", product: "CREMA E2E", plannedQuantity: "500", unit: "kg", sector: "ELABORACION", branchOwner: "Cristian" });
      await create("cod", { plannedDate: TODAY, client: "CLIENTE ORIGINAL", product: "ETIQUETADO E2E", plannedQuantity: "300", unit: "un", sector: "CODIFICADO" });
    } else {
      await create("keratin", { plannedDate: PRIORITY_DAY, client: "BL COSMETICS", product: "ALISADO KERATIN", plannedQuantity: "1100", unit: "kg", sector: "ELABORACION", branchOwner: "Cristian" });
    }
    const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
    if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  }
  await q("update work_items set packaging_lote = 'E2E-L-APROB', quality_status = 'aprobado' where id = $1", [bare(ids.aprobado)]);
  // un lote en Asignación de lotes (alta manual por la API, como Producción)
  const lot = await api.post("/api/v1/asignacion-lotes", { data: { action: "upsert", actorSectorId: "PRODUCCION", record: { lote: "E2E-L-0500", fecha: TODAY, producto: "SHAMPOO E2E", codigo: "E2E-01", marca: "E2E", cantidades: 1000, vto: "2028-12-31", updatedBy: "E2E Producción" } } });
  if (![200, 201].includes(lot.status())) throw new Error(`lote: ${await lot.text()}`);
  ids.lot = (await lot.json()).item.id;
  await api.dispose();
  return ids;
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1440, height: 950 }, fixedDay = null) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  debugPages.push(page);
  if (fixedDay) await page.clock.setFixedTime(new Date(`${fixedDay}T12:00:00`));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const card = (scope, product) => scope.locator("[data-testid=work-item-card]", { hasText: product }).first();

/** Edita un dato de la tarjeta como lo haría una persona: clic en el dato → editor → (motivo si lo pide) → Guardar. */
async function editField(page, scope, testId, value, { reason = "Corrección de planificación E2E", select = false } = {}) {
  await scope.locator(`[data-testid=${testId}]`).first().click();
  const editor = page.locator("[data-testid=card-field-editor]").first();
  await editor.waitFor({ timeout: 10_000 });
  const input = editor.locator("[data-testid=card-field-input]");
  if (select) await input.selectOption(value);
  else await input.fill(value);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = editor.locator("[data-testid=card-field-reason]");
    if (await r.isVisible().catch(() => false)) await r.fill(reason);
    await editor.locator("[data-testid=card-field-save]").click();
    const done = await editor.waitFor({ state: "detached", timeout: 15_000 }).then(() => true).catch(() => false);
    if (done) return true;
  }
  console.log("   editor:", await editor.innerText().catch(() => ""));
  return false;
}

try {
  const ids = await seed();
  check("datos de prueba: trabajos de Envasado, Elaboración, Codificado y un lote", Boolean(ids.env && ids.elab && ids.cod && ids.keratin && ids.lot));

  // ================= PRODUCCIÓN en «Envasado Masivo» (tarjetas) =================
  const prod = await openAs(E2E_USERS.produccion);
  const pp = prod.page;
  await nav(pp, "Envasado Masivo");
  await pp.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const env = card(pp, "SHAMPOO E2E");
  const editable = await env.locator("[data-editable]").count();
  check("las tarjetas muestran los datos editables con lápiz (sin cambiar a Planilla)", editable >= 9, `${editable} campos`);
  await pp.screenshot({ path: `${OUT}/1-produccion-envasado-tarjetas.png` });

  // abrir un editor para la captura (guardar / cancelar visibles), y cancelar sin cambios
  await env.locator("[data-testid=card-client]").click();
  await pp.locator("[data-testid=card-field-editor]").waitFor();
  check("el editor muestra «Guardar» y «Cancelar»", (await pp.locator("[data-testid=card-field-save]").isVisible()) && (await pp.locator("[data-testid=card-field-cancel]").isVisible()));
  await env.screenshot({ path: `${OUT}/2-editor-en-tarjeta.png` });
  await pp.locator("[data-testid=card-field-cancel]").click();

  const okProduct = await editField(pp, env, "card-product", "SHAMPOO E2E CORREGIDO");
  const envC = card(pp, "SHAMPOO E2E CORREGIDO");
  const okClient = await editField(pp, envC, "card-client", "CLIENTE NUEVO SA");
  const okQty = await editField(pp, envC, "card-quantity", "2400");
  const okUnit = await editField(pp, envC, "card-unit", "u");
  const okDelivery = await editField(pp, envC, "card-delivery", "2030-12-15");
  const okNotes = await editField(pp, envC, "card-notes", "Usar envase nuevo");
  const okLote = await editField(pp, envC, "card-lote", "E2E-L-0500", { reason: "Asignación del lote correcto" });
  const okVto = await editField(pp, envC, "card-vto", "2028-12-31", { reason: "Vencimiento del lote asignado" });
  const okFinished = await editField(pp, envC, "card-finished", "150", { reason: "Corrección de conteo físico" });
  check("producto, cliente, cantidad, unidad, entrega y observación se guardan desde la tarjeta", okProduct && okClient && okQty && okUnit && okDelivery && okNotes);
  check("lote y vencimiento se asignan con motivo desde la tarjeta", okLote && okVto);
  check("cantidad realizada se corrige con motivo (corrección autorizada)", okFinished);
  check("confirmación visible «Guardado»", (await pp.locator("[data-testid=card-field-saved]").count()) >= 1);

  // recargar y confirmar persistencia real (UI + base)
  await pp.reload();
  await nav(pp, "Envasado Masivo");
  await pp.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const after = card(pp, "SHAMPOO E2E CORREGIDO");
  const text = await after.innerText();
  check("tras recargar, la tarjeta muestra lo guardado", /CLIENTE NUEVO SA/.test(text) && /2400/.test(text) && /Usar envase nuevo/.test(text) && /E2E-L-0500/.test(text) && /150/.test(text), text.replace(/\s+/g, " ").slice(0, 160));
  const r1 = await row(ids.env);
  check("en la base: producto, cliente, cantidad, unidad, entrega, observación, lote, VTO y realizadas", r1.product === "SHAMPOO E2E CORREGIDO" && r1.client === "CLIENTE NUEVO SA" && r1.planned_quantity === "2400" && r1.unit === "u" && iso(r1.delivery_date) === "2030-12-15" && r1.notes === "Usar envase nuevo" && r1.packaging_lote === "E2E-L-0500" && iso(r1.packaging_vto) === "2028-12-31" && r1.finished_qty === "150", JSON.stringify({ p: r1.product, c: r1.client, q: r1.planned_quantity, u: r1.unit, d: r1.delivery_date, n: r1.notes, l: r1.packaging_lote, v: r1.packaging_vto, f: r1.finished_qty }));
  const ev = await q("select type, note, actor_sector from operational_events where work_item_id = $1 order by created_at", [bare(ids.env)]);
  const types = ev.map((e) => e.type);
  check("auditoría: cambios de planificación, lote/VTO (con motivo) y corrección de realizadas (con motivo)", types.filter((t) => t === "PLANNING_FIELDS_CORRECTED").length >= 6 && ev.some((e) => e.type === "LOTE_VTO_CORRECTED" && e.note === "Asignación del lote correcto") && ev.some((e) => e.type === "FINISHED_QTY_CORRECTED" && e.note === "Corrección de conteo físico") && ev.every((e) => e.actor_sector === "PRODUCCION"), types.join(","));

  // trabajo con decisión de Calidad: bloqueado, y la tarjeta dice por qué y qué hacer
  const aprob = card(pp, "ACONDICIONADOR APROBADO E2E");
  const lockText = await aprob.locator("[data-testid=card-lock-reason]").innerText().catch(() => "");
  check("trabajo aprobado por Calidad: bloqueo visible con el procedimiento (no editable)", /anulá la decisión de Calidad/.test(lockText) && (await aprob.locator("[data-editable]").count()) === 0, lockText);
  await aprob.screenshot({ path: `${OUT}/3-bloqueo-visible.png` });

  // responsable / línea con lista (al final: la tarjeta pasa a la pestaña Línea 2)
  const okLine = await editField(pp, card(pp, "SHAMPOO E2E CORREGIDO"), "card-assignee", "Línea 2", { select: true });
  check("línea elegida de una lista (Línea 2) y guardada", okLine && (await row(ids.env)).line === "Línea 2");

  // tablero semanal: botón «Editar» en la tarjeta → detalle con la planificación editable
  await pp.getByRole("button", { name: /^Semana$/ }).first().click();
  await pp.waitForSelector("[data-testid=week-board-edit]", { timeout: 60_000 });
  check("tablero semanal: cada tarjeta tiene «Editar» para Producción", (await pp.locator("[data-testid=week-board-edit]").count()) >= 2);
  await pp.screenshot({ path: `${OUT}/4-tablero-semanal-editar.png` });
  await pp.locator("li", { hasText: "SHAMPOO E2E CORREGIDO" }).locator("[data-testid=week-board-edit]").first().click();
  const editor = pp.locator("[data-testid=work-item-plan-editor]");
  await editor.waitFor({ timeout: 30_000 });
  await editor.locator("[data-testid=card-quantity][data-editable]").waitFor({ timeout: 30_000 });
  const okDrawer = await editField(pp, editor, "card-quantity", "2500");
  await pp.screenshot({ path: `${OUT}/5-detalle-editor-planificacion.png` });
  check("desde el detalle (tablero semanal) se edita y persiste", okDrawer && (await row(ids.env)).planned_quantity === "2500");
  await pp.keyboard.press("Escape");

  // ================= Elaboración: responsable y fecha =================
  await nav(pp, "Elaboración");
  await pp.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const elab = card(pp, "CREMA E2E");
  const okOwner = await editField(pp, elab, "card-assignee", "Nicolás", { select: true });
  check("Elaboración: responsable Cristian → Nicolás desde la tarjeta", okOwner && (await row(ids.elab)).branch_owner === "Nicolás");
  const newDate = new Date(Date.parse(`${TODAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const sameWeek = mondayOf(newDate) === mondayOf(TODAY);
  if (sameWeek) {
    const okDate = await editField(pp, card(pp, "CREMA E2E"), "card-date", newDate);
    check("Elaboración: fecha de producción cambiada desde la tarjeta", okDate && iso((await row(ids.elab)).planned_date) === newDate);
  } else {
    check("Elaboración: fecha de producción (omitido: mañana cae en otra semana)", true);
  }

  // ================= Codificado: «Abrir / Editar» =================
  await nav(pp, "Codificado");
  await pp.getByRole("button", { name: "Abrir / Editar" }).first().waitFor({ timeout: 120_000 });
  await pp.getByRole("button", { name: "Abrir / Editar" }).first().click();
  const codEditor = pp.locator("[data-testid=work-item-plan-editor]");
  await codEditor.locator("[data-testid=card-notes][data-editable]").waitFor({ timeout: 30_000 });
  const okCod = await editField(pp, codEditor, "card-notes", "Codificar con fecha nueva");
  await pp.screenshot({ path: `${OUT}/6-codificado-editar.png` });
  check("Codificado: Producción edita desde «Abrir / Editar»", okCod && (await row(ids.cod)).notes === "Codificar con fecha nueva");
  await pp.keyboard.press("Escape");

  // ================= Asignación de lotes: corrección con historial =================
  await nav(pp, "Asignación de lotes");
  await pp.getByRole("button", { name: "Editar E2E-L-0500" }).first().waitFor({ timeout: 120_000 });
  await pp.getByRole("button", { name: "Editar E2E-L-0500" }).first().click();
  const form = pp.getByRole("dialog");
  await form.getByLabel(/Cantidades/).first().fill("1200");
  await form.locator('button[type="submit"]').click();
  await pp.waitForFunction(() => /Asignación actualizada/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
  const lotDb = (await q("select cantidades from asignacion_lotes where id = $1", [ids.lot]))[0];
  check("Asignación de lotes: cantidad corregida desde el formulario", Number(lotDb?.cantidades) === 1200, JSON.stringify(lotDb));
  await pp.getByRole("button", { name: "Historial de E2E-L-0500" }).first().click();
  await pp.locator("[data-testid=lote-history-entry]").first().waitFor({ timeout: 30_000 });
  const histText = await pp.locator("[data-testid=lote-history-dialog]").innerText();
  check("historial del lote: cantidad 1000 → 1200, usuario y fecha; alta", /Cantidades/.test(histText) && /1000/.test(histText) && /1200/.test(histText) && /Alta del lote/.test(histText), histText.replace(/\s+/g, " ").slice(0, 160));
  await pp.screenshot({ path: `${OUT}/7-lotes-historial.png` });
  await pp.keyboard.press("Escape");

  // ================= Prioridad de un trabajo SIN vínculo (elige la tarea de Semanas) =================
  const pk = await openAs(E2E_USERS.produccion, { width: 1440, height: 950 }, PRIORITY_DAY);
  await nav(pk.page, "Elaboración");
  await pk.page.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const ker = card(pk.page, "ALISADO KERATIN");
  await ker.locator("[data-testid=card-priority-assign]").click();
  await pk.page.locator("[data-testid=card-priority-task]").first().waitFor({ timeout: 60_000 });
  const firstTask = await pk.page.locator("[data-testid=card-priority-task]").first().innerText();
  check("«Asignar prioridad»: lista las tareas de Semanas del sector, la más parecida primero (Producción elige)", /ALISADO KERATIN/i.test(firstTask), firstTask.replace(/\s+/g, " "));
  await pk.page.screenshot({ path: `${OUT}/8-asignar-prioridad.png` });
  await pk.page.locator("[data-testid=card-priority-task]").first().click();
  await ker.locator("[data-testid=priority-chip]").waitFor({ timeout: 30_000 });
  await ker.locator("[data-testid=priority-chip]").click();
  await pk.page.click("[data-testid=priority-option-URGENTE]");
  await pk.page.waitForFunction(() => document.querySelector("[data-testid=work-item-card][data-semanas-priority=URGENTE]"), null, { timeout: 30_000 }).catch(() => {});
  check("tras elegir la tarea, la prioridad se edita desde la tarjeta (→ URGENTE)", (await ker.getAttribute("data-semanas-priority")) === "URGENTE");
  const link = await q("select count(*)::int as n from semanas_task_links where work_item_id = $1 and unlinked_at is null", [bare(ids.keratin)]);
  check("en la base: vínculo explícito creado por la elección de Producción", link[0]?.n === 1);
  await pk.page.screenshot({ path: `${OUT}/9-prioridad-editada.png` });
  await pk.ctx.close();

  // ================= OPERARIO: solo sus permisos operativos =================
  const op = await openAs(E2E_USERS.envasado, { width: 1180, height: 820 });
  await op.page.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 }).catch(() => {});
  const opCards = await op.page.locator("[data-testid=work-item-card]").count();
  check("operario de Envasado: ve sus tarjetas sin lápices ni edición de planificación", opCards >= 1 && (await op.page.locator("[data-testid=work-item-card] [data-editable]").count()) === 0 && (await op.page.locator("[data-testid=card-priority-assign]").count()) === 0, `${opCards} tarjetas`);
  check("operario: conserva «Ver / Registrar avance»", (await op.page.getByRole("button", { name: /Registrar avance/ }).count()) >= 1);
  await op.page.screenshot({ path: `${OUT}/10-operario-envasado-tablet.png` });
  const v = Number((await row(ids.env)).version);
  const denyCells = await op.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: ids.env, field: "product", value: "HACKEO", expectedVersion: v }] } });
  const denyFinished = await op.page.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: ids.env, field: "finishedQty", value: "9999", expectedVersion: v, expectedValue: "150", reason: "Intento del operario" }] } });
  const denyLot = await op.page.request.post("/api/v1/asignacion-lotes", { data: { action: "upsert", actorSectorId: "ENVASADO_MASIVO", record: { id: ids.lot, lote: "E2E-L-0500", fecha: TODAY, producto: "X", codigo: "E2E-01", cantidades: 1, updatedBy: "op" } } });
  check("servidor: el operario no puede editar planificación ni corregir realizadas (403)", denyCells.status() === 403 && denyFinished.status() === 403, `${denyCells.status()}/${denyFinished.status()}`);
  check("servidor: el operario no puede modificar Asignación de lotes (403)", denyLot.status() === 403, String(denyLot.status()));
  const r2 = await row(ids.env);
  check("nada cambió por los intentos del operario", r2.product === "SHAMPOO E2E CORREGIDO" && r2.finished_qty === "150");
  await op.ctx.close();
  await prod.ctx.close();
} catch (err) {
  console.error(err);
  results.push({ name: "excepción", ok: false });
  for (const [i, p] of debugPages.entries()) await p.screenshot({ path: `${OUT}/debug-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
