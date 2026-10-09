// E2E en Chromium real: prioridad de Semanas en «Mi trabajo» mediante vínculo EXPLÍCITO tarea ↔ work item (0042).
// Base DESCARTABLE (marca verificada), login real, planificación nativa y COPIA LOCAL de SEMANAS 2026 (hoy = 06/05/2026).
// Ver run-semanas-mi-trabajo-db-local.sh. Deja capturas en $OUT.
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
const OUT = process.env.OUT ?? "/tmp/semanas-mi-trabajo";
mkdirSync(OUT, { recursive: true });
const DAY = "2026-05-06";
const TAG = "E2E-MT";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);

/** Datos frescos en la base DE PRUEBA: trabajos nativos de la semana 04/05/2026 creados por la API (como Producción). */
async function seed() {
  await q("update work_items set deleted_at = now() where notes = $1 and deleted_at is null", [TAG]);
  await q("update semanas_task_links set unlinked_at = now() where unlinked_at is null");
  await q("delete from semanas_task_priorities");
  await q("update planning_weeks set status = 'DRAFT', published_at = null, version = version + 1 where week_start = $1::date", ["2026-05-04"]);
  const api = await pwRequest.newContext({ baseURL: BASE });
  const login = await api.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
  if (login.status() !== 200) throw new Error(`login: ${await login.text()}`);
  const list = await (await api.get("/api/v1/planning/weeks?weekStart=2026-05-04")).json();
  let weekId = list.weeks?.[0]?.id;
  if (!weekId) {
    const res = await api.post("/api/v1/planning/weeks", { data: { weekStart: "2026-05-04", label: "E2E" } });
    weekId = (await res.json()).week.id;
  }
  const ids = {};
  const create = async (key, data) => {
    const res = await api.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { plannedDate: DAY, unit: "kg", notes: TAG, ...data } });
    if (res.status() !== 201) throw new Error(`crear ${key}: ${await res.text()}`);
    ids[key] = (await res.json()).item.id;
  };
  await create("keratin", { client: "BL COSMETICS", product: "ALISADO KERATIN", plannedQuantity: "1100", sector: "ELABORACION", branchOwner: "Cristian" });
  await create("jalea", { client: "TIERRAS DEL VOLCAN", product: "JALEA TERMAL", plannedQuantity: "110", sector: "ELABORACION", branchOwner: "Cristian" });
  await create("libre", { client: "OTRO CLIENTE", product: "PRODUCTO SIN TAREA", plannedQuantity: "10", sector: "ELABORACION", branchOwner: "Cristian" });
  await create("envasado", { client: "TYL", product: "ALC EN GEL CHICLE", plannedQuantity: "2000", unit: "u", sector: "ENVASADO_MASIVO", line: "Línea 1" });
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  return ids;
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1500, height: 950 }) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.clock.setFixedTime(new Date(`${DAY}T12:00:00`));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  return { ctx, page };
}
const nav = (page, label) => page.getByRole("button", { name: new RegExp(`^${label}$`) }).or(page.getByRole("link", { name: new RegExp(`^${label}$`) })).first().click({ timeout: 120_000 });
const rowOf = (page, text) => page.locator("[data-testid=list-row]", { hasText: text }).first();

try {
  const ids = await seed();
  check("datos de prueba: 4 trabajos nativos publicados (3 Elaboración, 1 Envasado)", Object.keys(ids).length === 4);

  // ================= PRODUCCIÓN: prioridad + vínculo explícito =================
  const prod = await openAs(E2E_USERS.produccion);
  const pp = prod.page;
  await nav(pp, "Semanas");
  await pp.waitForSelector("[data-testid=list-row]", { timeout: 120_000 });
  const keratin = rowOf(pp, "ALISADO KERATIN 1100KG");
  await keratin.locator("[data-testid=priority-chip]").click();
  await pp.click("[data-testid=priority-option-URGENTE]");
  await pp.waitForFunction(() => document.querySelector("[data-testid=list-row][data-priority=URGENTE]"), null, { timeout: 20_000 });
  check("Producción: KERATIN → URGENTE", (await keratin.getAttribute("data-priority")) === "URGENTE");
  check("sin vínculo: la columna dice «Sin vincular»", (await keratin.locator("[data-testid=list-link-cell]").innerText()).includes("Sin vincular"));

  await keratin.locator("[data-testid=list-link-cell]").click();
  const panel = pp.locator("[data-testid=list-link-row]");
  await panel.locator("[data-testid=link-candidate]").first().waitFor({ timeout: 30_000 });
  const cands = await panel.locator("[data-testid=link-candidate]").allInnerTexts();
  check("sugerencias de la semana y del sector (sin Envasado), la correcta primero", cands.length === 3 && cands[0].includes("ALISADO KERATIN") && !cands.join(" ").includes("ALC EN GEL"), cands.map((c) => c.split("\n")[0]).join(" | "));
  check("la sugerencia indica en qué coincide (no vincula sola)", /coincide producto/i.test(cands[0]) && (await keratin.locator("[data-testid=list-link-cell]").getAttribute("data-linked")) === "0");
  // vínculo EQUIVOCADO a propósito (JALEA en la tarea KERATIN) para probar la corrección
  await panel.locator("[data-testid=link-candidate]", { hasText: "JALEA TERMAL" }).locator("[data-testid=link-confirm]").click();
  await pp.waitForFunction(() => document.querySelector("[data-testid=list-link-cell][data-linked='1']"), null, { timeout: 20_000 });
  await panel.locator("[data-testid=link-candidate]", { hasText: "ALISADO KERATIN" }).locator("[data-testid=link-confirm]").click();
  await pp.waitForFunction(() => document.querySelector("[data-testid=list-link-cell][data-linked='2']"), null, { timeout: 20_000 });
  check("Producción vincula (confirmando) dos trabajos a la tarea", (await keratin.locator("[data-testid=list-link-chip]").count()) === 2);
  await pp.screenshot({ path: `${OUT}/7-produccion-vincular-trabajo.png` });

  // corregir: JALEA pertenece a la tarea JALEA TERMAL → «Mover aquí» con motivo
  await keratin.locator("[data-testid=list-link-cell]").click(); // cierra el panel de KERATIN
  const jalea = rowOf(pp, "JALEA TERMAL 110KG");
  await jalea.locator("[data-testid=list-link-cell]").click();
  const panel2 = pp.locator("[data-testid=list-link-row]");
  await panel2.locator("[data-testid=link-elsewhere]").waitFor({ timeout: 30_000 });
  await panel2.locator("[data-testid=link-elsewhere] summary").click();
  await panel2.locator("[data-testid=link-move]").first().click();
  check("corregir exige motivo (botón deshabilitado sin motivo)", await panel2.locator("[data-testid=link-move-confirm]").isDisabled());
  await panel2.locator("[data-testid=link-move-reason]").fill("Estaba vinculado a la tarea equivocada");
  await panel2.locator("[data-testid=link-move-confirm]").click();
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("JALEA TERMAL 110KG") && r.querySelector("[data-testid=list-link-cell][data-linked='1']")), null, { timeout: 20_000 });
  await panel2.locator("[data-testid=link-candidate]").first().waitFor({ timeout: 30_000 });
  const elsewhere = (await panel2.locator("[data-testid=link-elsewhere]").count()) ? await panel2.locator("[data-testid=link-elsewhere]").innerText() : "";
  check("tras corregir, el panel no muestra datos viejos (JALEA ya no figura como «vinculada a otra tarea»)", !elsewhere.includes("JALEA TERMAL"));
  check("vínculo corregido: KERATIN 1 trabajo, JALEA 1 trabajo", (await keratin.locator("[data-testid=list-link-chip]").count()) === 1 && (await jalea.locator("[data-testid=list-link-chip]").count()) === 1);
  await pp.screenshot({ path: `${OUT}/8-produccion-corregir-vinculo.png` });
  await jalea.locator("[data-testid=list-link-cell]").click();
  await keratin.locator("[data-testid=list-history]").click();
  await pp.waitForSelector("[data-testid=list-history-links]", { timeout: 20_000 });
  const hist = await pp.locator("[data-testid=list-history-row]").innerText();
  check("historial: prioridad + vínculos (vinculó / quitó con motivo)", /NORMAL → URGENTE/.test(hist) && /vinculó/.test(hist) && /quitó/.test(hist) && /tarea equivocada/.test(hist));
  await pp.screenshot({ path: `${OUT}/9-produccion-historial.png` });

  // ================= ELABORACIÓN: «Mi trabajo» =================
  const elab = await openAs(E2E_USERS.elaboracion);
  const ep = elab.page;
  // Vista por defecto: planilla (celdas = inputs). La columna Prioridad es de solo lectura.
  const gridRows = () => ep.evaluate(() => [...document.querySelectorAll(".dsg-row")].map((r) => [...r.querySelectorAll("input")].map((i) => i.value).join(" | ")));
  await ep.waitForFunction(() => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value.includes("ALISADO KERATIN") ) && [...document.querySelectorAll(".dsg-row input")].some((i) => i.value.includes("URGENTE")), null, { timeout: 120_000 });
  const rowsTxt = await gridRows();
  const gridRow = (t) => rowsTxt.find((r) => r.includes(t)) ?? "";
  check("Mi trabajo (planilla): columna Prioridad — KERATIN URGENTE, JALEA NORMAL, sin vínculo vacío", gridRow("ALISADO KERATIN").includes("URGENTE") && gridRow("JALEA TERMAL").includes("NORMAL") && !/URGENTE|IMPORTANTE|NORMAL/.test(gridRow("PRODUCTO SIN TAREA")), rowsTxt.filter(Boolean).map((r) => r.split(" | ").slice(0, 5).join(" ")).join(" // "));
  await ep.screenshot({ path: `${OUT}/10-elaboracion-mi-trabajo-planilla.png` });
  await ep.locator("[data-testid=os-table-mode-toggle]").first().click();
  await ep.waitForSelector("[data-testid=work-item-priority]", { timeout: 30_000 });
  const rowWith = (text) => ep.locator("tr", { hasText: text }).first();
  const badgeOf = async (text) => (await rowWith(text).locator("[data-testid=work-item-priority]").count()) ? rowWith(text).locator("[data-testid=work-item-priority]").getAttribute("data-priority") : null;
  check("Mi trabajo (Elaboración): KERATIN muestra URGENTE", (await badgeOf("ALISADO KERATIN")) === "URGENTE");
  check("Mi trabajo: JALEA vinculada muestra su prioridad (NORMAL)", (await badgeOf("JALEA TERMAL")) === "NORMAL");
  check("Mi trabajo: un trabajo SIN vínculo no muestra prioridad (no se inventa)", (await badgeOf("PRODUCTO SIN TAREA")) === null);
  check("Mi trabajo: sin controles para cambiar prioridad ni vincular", (await ep.locator("[data-testid=priority-chip], [data-testid=list-link-cell]").count()) === 0);
  await ep.screenshot({ path: `${OUT}/10b-elaboracion-mi-trabajo-lista.png` });
  await rowWith("ALISADO KERATIN").click();
  await ep.getByRole("button", { name: "Guardar avance" }).waitFor({ timeout: 20_000 });
  check("detalle: prioridad visible y acciones operativas intactas (Guardar avance / Finalizar)", (await ep.locator("[role=dialog] [data-testid=work-item-priority]").getAttribute("data-priority")) === "URGENTE" && (await ep.getByRole("button", { name: "Finalizar y enviar a Calidad" }).isEnabled()));
  await ep.screenshot({ path: `${OUT}/11-elaboracion-detalle-trabajo.png` });
  await ep.keyboard.press("Escape");

  // ================= cambio de prioridad → se refleja =================
  await keratin.locator("[data-testid=priority-chip]").click();
  await pp.click("[data-testid=priority-option-IMPORTANTE]");
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("ALISADO KERATIN 1100KG") && r.getAttribute("data-priority") === "IMPORTANTE"), null, { timeout: 20_000 });
  await ep.reload();
  await ep.waitForFunction(() => [...document.querySelectorAll("tr")].some((r) => r.textContent.includes("ALISADO KERATIN") && r.querySelector("[data-testid=work-item-priority][data-priority=IMPORTANTE]")), null, { timeout: 90_000 }).catch(() => {});
  check("Producción cambia a IMPORTANTE → Mi trabajo lo muestra tras recargar", (await badgeOf("ALISADO KERATIN")) === "IMPORTANTE");
  // misma prioridad en Semanas del sector
  await nav(ep, "Semanas");
  await ep.waitForSelector("[data-testid=plan-card]", { timeout: 60_000 });
  const card = ep.locator("[data-testid=plan-card]", { hasText: "ALISADO KERATIN 1100KG" }).first();
  check("consistencia: Semanas del sector muestra la misma prioridad (IMPORTANTE)", (await card.getAttribute("data-priority")) === "IMPORTANTE");

  // ================= permisos en el servidor =================
  const er = ep.request;
  const status = async (p) => (await p).status();
  check("sector: POST vínculo → 403", (await status(er.post("/api/v1/semanas/links", { data: { tabKey: "ELABORACION", taskKey: "x", workItemId: ids.libre } }))) === 403);
  check("sector: DELETE vínculo → 403", (await status(er.delete("/api/v1/semanas/links", { data: { linkId: "x", expectedVersion: 1, reason: "intento de sector" } }))) === 403);
  check("sector: sugerencias → 403", (await status(er.get("/api/v1/semanas/links/candidates?tabKey=ELABORACION&taskKey=x"))) === 403);
  check("sector: cambiar prioridad → 403", (await status(er.patch("/api/v1/semanas/priorities", { data: { tabKey: "ELABORACION", taskKey: "x", priority: "URGENTE", expectedVersion: 0 } }))) === 403);
  const envasado = await openAs(E2E_USERS.envasado);
  const ownOnly = await (await envasado.page.request.get("/api/v1/semanas/work-item-priorities")).json();
  check("Envasado no recibe prioridades de trabajos de Elaboración", ownOnly.available === true && Object.keys(ownOnly.byWorkItem).length === 0);
  const elabOwn = await (await er.get("/api/v1/semanas/work-item-priorities")).json();
  const bare = (id) => String(id).replace(/^native:/, "");
  check("Elaboración recibe solo sus 2 trabajos vinculados", Object.keys(elabOwn.byWorkItem).map(bare).sort().join() === [ids.keratin, ids.jalea].map(bare).sort().join(), Object.keys(elabOwn.byWorkItem).join(", "));
  // auditoría en la base
  const ev = await q("select action, reason from semanas_task_link_events order by created_at");
  check("auditoría en la base: LINK, LINK, UNLINK(con motivo), LINK", ev.map((e) => e.action).join(",") === "LINK,LINK,UNLINK,LINK" && ev[2].reason === "Estaba vinculado a la tarea equivocada");
  const wi = await q("select priority, operational_status from work_items where id = $1", [String(ids.keratin).replace(/^native:/, "")]);
  check("work_items no se modificó (su campo priority heredado sigue NORMAL)", wi[0]?.priority === "NORMAL");
  await envasado.ctx.close();
  await elab.ctx.close();
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
