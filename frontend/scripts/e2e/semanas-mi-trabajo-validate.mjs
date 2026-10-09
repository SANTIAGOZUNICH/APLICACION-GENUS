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
  // Producto REPETIDO: mismo cliente, producto y día que KERATIN (otra cantidad). Nunca debe heredar su prioridad.
  await create("repetido", { client: "BL COSMETICS", product: "ALISADO KERATIN", plannedQuantity: "500", sector: "ELABORACION", branchOwner: "Cristian" });
  await create("sanitizante", { client: "TYL", product: "SANITIZANTE UVA", plannedQuantity: "40", unit: "lt", sector: "ELABORACION", branchOwner: "Nicolás" });
  await create("envasado", { client: "TYL", product: "ALC EN GEL CHICLE", plannedQuantity: "2000", unit: "u", sector: "ENVASADO_MASIVO", line: "Línea 1" });
  const pub = await api.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
  if (![200, 201, 409].includes(pub.status())) throw new Error(`publicar: ${await pub.text()}`);
  await api.dispose();
  return ids;
}

const debugPages = [];
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function openAs(user, viewport = { width: 1500, height: 950 }, day = DAY) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  const page = await ctx.newPage();
  debugPages.push(page);
  await page.clock.setFixedTime(new Date(`${day}T12:00:00`));
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
  check("datos de prueba: 6 trabajos nativos publicados (5 Elaboración, 1 Envasado)", Object.keys(ids).length === 6);

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
  check("sugerencias de la semana y del sector (sin Envasado); los dos KERATIN repetidos primero, Producción elige", cands.length === 5 && cands[0].includes("ALISADO KERATIN") && cands[1].includes("ALISADO KERATIN") && !cands.join(" ").includes("ALC EN GEL"), cands.map((c) => c.split("\n").slice(0, 2).join(" ")).join(" | "));
  check("la sugerencia indica en qué coincide (no vincula sola)", /coincide producto/i.test(cands[0]) && (await keratin.locator("[data-testid=list-link-cell]").getAttribute("data-linked")) === "0");
  // vínculo EQUIVOCADO a propósito (JALEA en la tarea KERATIN) para probar la corrección
  await panel.locator("[data-testid=link-candidate]", { hasText: "JALEA TERMAL" }).locator("[data-testid=link-confirm]").click();
  await pp.waitForFunction(() => document.querySelector("[data-testid=list-link-cell][data-linked='1']"), null, { timeout: 20_000 });
  await panel.locator("[data-testid=link-candidate]", { hasText: "ALISADO KERATIN" }).filter({ hasText: "1100 kg" }).locator("[data-testid=link-confirm]").click();
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
  await keratin.locator("[data-testid=list-history]").click();
  // tercera prioridad: JALEA → IMPORTANTE; y SANITIZANTE (Nicolás) vinculado con NORMAL
  await jalea.locator("[data-testid=priority-chip]").click();
  await pp.click("[data-testid=priority-option-IMPORTANTE]");
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("JALEA TERMAL 110KG") && r.getAttribute("data-priority") === "IMPORTANTE"), null, { timeout: 20_000 });
  const sani = rowOf(pp, "SANITIZANTE UVA 40LT");
  await sani.locator("[data-testid=list-link-cell]").click();
  const panel3 = pp.locator("[data-testid=list-link-row]");
  await panel3.locator("[data-testid=link-candidate]", { hasText: "SANITIZANTE UVA" }).locator("[data-testid=link-confirm]").click({ timeout: 30_000 });
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("SANITIZANTE UVA 40LT") && r.querySelector("[data-testid=list-link-cell][data-linked='1']")), null, { timeout: 20_000 });
  await sani.locator("[data-testid=list-link-cell]").click();
  check("tres tareas vinculadas con las tres prioridades (URGENTE, IMPORTANTE, NORMAL)", (await keratin.getAttribute("data-priority")) === "URGENTE" && (await jalea.getAttribute("data-priority")) === "IMPORTANTE" && (await sani.getAttribute("data-priority")) === "NORMAL");

  // ================= ELABORACIÓN: «Mi trabajo» =================
  const elab = await openAs(E2E_USERS.elaboracion);
  const ep = elab.page;
  // Vista por defecto: TARJETAS (mismo lenguaje que Semanas), con prioridad y borde lateral.
  await ep.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  await ep.waitForFunction(() => document.querySelectorAll("[data-testid=work-item-card][data-semanas-priority=IMPORTANTE]").length > 0, null, { timeout: 60_000 });
  const cardPrio = async (product, qty) => ep.locator("[data-testid=work-item-card]", { hasText: product }).filter({ hasText: qty ?? product }).first().getAttribute("data-semanas-priority");
  check(
    "Mi trabajo (tarjetas, vista por defecto): URGENTE · IMPORTANTE · NORMAL · neutral (sin vínculo y repetido)",
    (await cardPrio("ALISADO KERATIN", "1100")) === "URGENTE" && (await cardPrio("JALEA TERMAL")) === "IMPORTANTE" && (await cardPrio("SANITIZANTE UVA")) === "NORMAL" &&
      (await cardPrio("PRODUCTO SIN TAREA")) === "NONE" && (await cardPrio("ALISADO KERATIN", "500")) === "NONE"
  );
  check("tarjetas del sector: sin campos editables de planificación", (await ep.locator("[data-testid=work-item-card] [data-editable]").count()) === 0);
  check("tarjetas del sector: acción operativa intacta en cada tarjeta", (await ep.locator("[data-testid=work-item-card]", { hasText: "Ver / Registrar avance" }).count()) === 5);
  await ep.screenshot({ path: `${OUT}/10a-elaboracion-mi-trabajo-tarjetas.png` });
  await ep.locator("[data-testid=work-items-view-planilla]").first().click();
  // La columna Prioridad de la planilla es de solo lectura.
  const gridRows = () => ep.evaluate(() => [...document.querySelectorAll(".dsg-row")].map((r) => [...r.querySelectorAll("input")].map((i) => i.value).join(" | ")));
  await ep.waitForFunction(() => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value.includes("ALISADO KERATIN") ) && [...document.querySelectorAll(".dsg-row input")].some((i) => i.value.includes("URGENTE")), null, { timeout: 120_000 });
  await ep.waitForFunction(() => [...document.querySelectorAll(".dsg-row input")].some((i) => i.value.includes("IMPORTANTE")), null, { timeout: 60_000 });
  const rowsTxt = await gridRows();
  const gridRow = (...t) => rowsTxt.find((r) => t.every((x) => r.includes(x))) ?? "";
  const NEUTRAL = "⚪ Sin prioridad";
  check(
    "Mi trabajo (planilla): KERATIN 1100 URGENTE · JALEA IMPORTANTE · SANITIZANTE NORMAL · sin vínculo y REPETIDO = neutral",
    gridRow("ALISADO KERATIN", "1100").includes("URGENTE") && gridRow("JALEA TERMAL").includes("IMPORTANTE") && gridRow("SANITIZANTE UVA").includes("NORMAL") &&
      gridRow("PRODUCTO SIN TAREA").includes(NEUTRAL) && gridRow("ALISADO KERATIN", "500").includes(NEUTRAL),
    rowsTxt.filter(Boolean).map((r) => r.split(" | ").slice(0, 6).join(" ")).join(" // ")
  );
  const edges = await ep.evaluate(() => ["URGENTE", "IMPORTANTE", "NORMAL", "NONE"].map((p) => document.querySelectorAll(`.genus-row-prio-${p}`).length));
  check("planilla: borde lateral por prioridad (1 rojo, 1 amarillo, 1 verde) y sin borde los neutrales", edges.join() === "1,1,1,2", edges.join());
  await ep.screenshot({ path: `${OUT}/10-elaboracion-mi-trabajo-planilla.png` });
  // cada tabla (Cristian, Nicolás) tiene su propio selector de vista
  for (let i = 0; i < 4; i += 1) {
    const toList = ep.locator("[data-testid=os-table-mode-toggle]", { hasText: "Ver como lista" });
    if ((await toList.count()) === 0) break;
    await toList.first().click();
  }
  await ep.waitForSelector("[data-testid=work-item-priority]", { timeout: 30_000 });
  const rowWith = (text, extra) => (extra ? ep.locator("tr", { hasText: text }).filter({ hasText: extra }) : ep.locator("tr", { hasText: text })).first();
  const badgeOf = async (text, extra) => ((await rowWith(text, extra).locator("[data-testid=work-item-priority]").count()) ? rowWith(text, extra).locator("[data-testid=work-item-priority]").getAttribute("data-priority") : null);
  const edgeOf = (text, extra) => rowWith(text, extra).evaluate((el) => getComputedStyle(el).boxShadow);
  check("Mi trabajo (lista): URGENTE / IMPORTANTE / NORMAL en los tres vinculados", (await badgeOf("ALISADO KERATIN", "1100")) === "URGENTE" && (await badgeOf("JALEA TERMAL")) === "IMPORTANTE" && (await badgeOf("SANITIZANTE UVA")) === "NORMAL");
  check("Mi trabajo: sin vínculo → indicación NEUTRAL (no se inventa prioridad)", (await badgeOf("PRODUCTO SIN TAREA")) === "NONE");
  check("Mi trabajo: el producto REPETIDO (mismo cliente/producto/día) NO hereda URGENTE", (await badgeOf("ALISADO KERATIN", "500")) === "NONE");
  const e1 = await edgeOf("ALISADO KERATIN", "1100");
  const e2 = await edgeOf("JALEA TERMAL");
  const e3 = await edgeOf("SANITIZANTE UVA");
  const e0 = await edgeOf("PRODUCTO SIN TAREA");
  check("lista: borde lateral rojo / amarillo / verde y ninguno en el neutral", e1.includes("239, 68, 68") && e2.includes("245, 158, 11") && e3.includes("34, 197, 94") && !/239, 68, 68|245, 158, 11|34, 197, 94/.test(e0), [e1, e2, e3, e0].join(" ; "));
  check("Mi trabajo: sin controles para cambiar prioridad ni vincular", (await ep.locator("[data-testid=priority-chip], [data-testid=list-link-cell]").count()) === 0);
  await ep.screenshot({ path: `${OUT}/10b-elaboracion-mi-trabajo-lista.png` });
  await rowWith("ALISADO KERATIN", "1100").click();
  await ep.getByRole("button", { name: "Guardar avance" }).waitFor({ timeout: 20_000 });
  check("detalle: prioridad visible y acciones operativas intactas (Guardar avance / Finalizar)", (await ep.locator("[role=dialog] [data-testid=work-item-priority]").getAttribute("data-priority")) === "URGENTE" && (await ep.getByRole("button", { name: "Finalizar y enviar a Calidad" }).isEnabled()));
  await ep.screenshot({ path: `${OUT}/11-elaboracion-detalle-trabajo.png` });
  await ep.keyboard.press("Escape");
  // tablero semanal de «Mi trabajo»
  await ep.getByRole("button", { name: /^Semana$/ }).first().click();
  await ep.waitForSelector("li[data-semanas-priority]", { timeout: 30_000 }).catch(() => {});
  const weekEdges = await ep.evaluate(() => [...document.querySelectorAll("li[data-semanas-priority]")].map((l) => l.getAttribute("data-semanas-priority")).sort());
  check("tablero semanal: tarjetas con borde de prioridad (URGENTE, IMPORTANTE, NORMAL)", ["IMPORTANTE", "NORMAL", "URGENTE"].every((p) => weekEdges.includes(p)), weekEdges.join(","));
  await ep.screenshot({ path: `${OUT}/12-elaboracion-mi-trabajo-semana.png` });
  await ep.getByRole("button", { name: /^Día$/ }).first().click();

  // ================= cambio de prioridad → se refleja =================
  await keratin.locator("[data-testid=priority-chip]").click();
  await pp.click("[data-testid=priority-option-IMPORTANTE]");
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("ALISADO KERATIN 1100KG") && r.getAttribute("data-priority") === "IMPORTANTE"), null, { timeout: 20_000 });
  await ep.reload();
  await ep.waitForFunction(() => [...document.querySelectorAll("tr")].some((r) => r.textContent.includes("ALISADO KERATIN") && r.textContent.includes("1100") && r.querySelector("[data-testid=work-item-priority][data-priority=IMPORTANTE]")), null, { timeout: 90_000 }).catch(() => {});
  check("Producción cambia a IMPORTANTE → Mi trabajo lo muestra tras recargar", (await badgeOf("ALISADO KERATIN", "1100")) === "IMPORTANTE");
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
  check("Elaboración recibe solo sus 3 trabajos vinculados (ni el repetido ni el libre)", Object.keys(elabOwn.byWorkItem).map(bare).sort().join() === [ids.keratin, ids.jalea, ids.sanitizante].map(bare).sort().join(), Object.keys(elabOwn.byWorkItem).join(", "));
  // auditoría en la base
  const ev = await q("select action, reason from semanas_task_link_events order by created_at");
  check("auditoría en la base: LINK, LINK, UNLINK(con motivo), LINK, LINK", ev.map((e) => e.action).join(",") === "LINK,LINK,UNLINK,LINK,LINK" && ev[2].reason === "Estaba vinculado a la tarea equivocada");
  const wi = await q("select priority, operational_status from work_items where id = $1", [String(ids.keratin).replace(/^native:/, "")]);
  check("work_items no se modificó (su campo priority heredado sigue NORMAL)", wi[0]?.priority === "NORMAL");

  // ================= INTEGRACIÓN: Producción planifica desde «Mi trabajo» =================
  const pm = await openAs(E2E_USERS.produccion);
  const mp = pm.page;
  await nav(mp, "Elaboración");
  await mp.waitForSelector("[data-testid=work-item-card]", { timeout: 120_000 });
  const pcard = (product, qty) => mp.locator("[data-testid=work-item-card]", { hasText: product }).filter({ hasText: qty ?? product }).first();
  check("Producción en «Mi trabajo» de Elaboración: campos de planificación editables", (await pcard("ALISADO KERATIN", "1100").locator("[data-editable]").count()) >= 5);
  // prioridad desde la tarjeta (misma tabla y API que Semanas): IMPORTANTE → URGENTE
  await pcard("ALISADO KERATIN", "1100").locator("[data-testid=priority-chip]").click();
  await mp.click("[data-testid=priority-option-URGENTE]");
  await mp.waitForFunction(() => [...document.querySelectorAll("[data-testid=work-item-card]")].some((c) => c.textContent.includes("1100") && c.textContent.includes("ALISADO KERATIN") && c.getAttribute("data-semanas-priority") === "URGENTE"), null, { timeout: 30_000 }).catch(() => {});
  check("Producción cambia la prioridad desde «Mi trabajo» (→ URGENTE)", (await pcard("ALISADO KERATIN", "1100").getAttribute("data-semanas-priority")) === "URGENTE");
  await pp.reload();
  await nav(pp, "Semanas");
  await pp.waitForSelector("[data-testid=list-row]", { timeout: 120_000 });
  check("…y se refleja en Semanas (Lista de Producción)", (await rowOf(pp, "ALISADO KERATIN 1100KG").getAttribute("data-priority")) === "URGENTE");
  check("Lista de Producción agrupada por día (encabezados de día)", (await pp.locator("[data-testid=list-day-header]").count()) >= 3);
  await pp.screenshot({ path: `${OUT}/13-produccion-lista-por-dia.png` });

  // cantidad: 1100 → 1200 (motivo si el servidor lo exige) y aviso de diferencia con Semanas
  const editField = async (card, testId, value, reason = "Ajuste de planificación E2E") => {
    await card.locator(`[data-testid=${testId}]`).click();
    const input = mp.locator("[data-testid=card-field-input]");
    // responsable / línea se elige de una lista; el resto se escribe
    if ((await input.evaluate((el) => el.tagName)) === "SELECT") await input.selectOption({ label: value });
    else await input.fill(value);
    await input.press("Enter");
    const r = mp.locator("[data-testid=card-field-reason]");
    if (await r.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) {
      await r.fill(reason);
      await mp.locator("[data-testid=card-field-save]").click();
    }
    await mp.waitForSelector("[data-testid=card-field-input]", { state: "detached", timeout: 20_000 }).catch(() => {});
  };
  await editField(pcard("ALISADO KERATIN", "1100"), "card-quantity", "1200");
  await mp.waitForFunction(() => [...document.querySelectorAll("[data-testid=work-item-card]")].some((c) => c.textContent.includes("1200")), null, { timeout: 20_000 }).catch(() => {});
  const k = pcard("ALISADO KERATIN", "1200");
  const [wiK] = await q("select planned_quantity, version from work_items where id = $1", [String(ids.keratin).replace(/^native:/, "")]);
  check("Producción edita la cantidad desde la tarjeta → persiste en la base con nueva versión", wiK?.planned_quantity === "1200" && Number(wiK?.version) > 1, JSON.stringify(wiK));
  check("diferencia con Semanas visible (no se sincroniza sola): «Cantidad en Semanas: …1100KG»", /Cantidad en Semanas/.test(await k.locator("[data-testid=card-semanas-diff]").innerText().catch(() => "")) );
  // responsable: JALEA Cristian → Nicolás (versión + auditoría)
  await editField(pcard("JALEA TERMAL"), "card-assignee", "Nicolás");
  await mp.waitForFunction(() => [...document.querySelectorAll("[data-testid=work-item-card]")].some((c) => c.textContent.includes("JALEA TERMAL") && c.textContent.includes("Nicolás")), null, { timeout: 20_000 }).catch(() => {});
  const [wiJ] = await q("select branch_owner from work_items where id = $1", [String(ids.jalea).replace(/^native:/, "")]);
  const evJ = await q("select type, from_status, to_status, actor_sector from operational_events where work_item_id = $1 and type = 'PLANNING_FIELDS_CORRECTED' order by created_at desc limit 1", [String(ids.jalea).replace(/^native:/, "")]);
  check("Producción cambia el responsable (Cristian → Nicolás): base + evento de auditoría con antes/después", wiJ?.branch_owner === "Nicolás" && /Cristian/.test(String(evJ[0]?.from_status)) && /Nicol/.test(String(evJ[0]?.to_status)) && evJ[0]?.actor_sector === "PRODUCCION", JSON.stringify(evJ[0] ?? {}));
  await mp.screenshot({ path: `${OUT}/14-produccion-mi-trabajo-elaboracion.png` });
  // concurrencia y permisos en el servidor
  const stale = await mp.request.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${String(ids.keratin).replace(/^native:/, "")}`, field: "notes", value: "x", expectedVersion: 1, reason: "Prueba de versión vieja" }] } });
  check("versión vieja → 409 (no pisa cambios)", stale.status() === 409, String(stale.status()));
  const asSector = await er.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${String(ids.keratin).replace(/^native:/, "")}`, field: "product", value: "HACKEO", expectedVersion: 99 }] } });
  check("sector intenta editar planificación → 403", asSector.status() === 403, String(asSector.status()));
  const asSectorAssignee = await er.patch("/api/v1/work-items/cells", { data: { changes: [{ id: `native:${String(ids.keratin).replace(/^native:/, "")}`, field: "assignee", value: "Nicolás", expectedVersion: 99 }] } });
  check("sector intenta cambiar el responsable → 403", asSectorAssignee.status() === 403);

  // ================= Crear trabajo DESDE una tarea de Semanas (vínculo por procedencia) =================
  const jojoba = rowOf(pp, "SERUM JOJOBA 50KG");
  await jojoba.locator("[data-testid=list-link-cell]").click();
  await pp.locator("[data-testid=link-create-from-task]").click();
  await pp.waitForSelector("[data-testid=assign-from-semanas]", { timeout: 20_000 });
  const prod0 = await pp.locator("#af-product").inputValue();
  const client0 = await pp.locator("#af-client").inputValue();
  check("«Crear trabajo» abre la asignación prellenada desde la tarea (producto y cliente)", prod0 === "SERUM JOJOBA 50KG" && client0 === "BL COSMETIC", `${prod0} / ${client0}`);
  await pp.screenshot({ path: `${OUT}/15-produccion-crear-desde-semanas.png` });
  if (!(await pp.locator("#af-qty").inputValue())) await pp.locator("#af-qty").fill("50");
  await pp.locator("[data-testid=assign-submit]").click();
  await pp.waitForFunction(() => /Vinculado a la tarea de Semanas|NO quedó vinculado/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
  check("el trabajo nace VINCULADO a su tarea (sin buscarlo ni confirmarlo aparte)", /Vinculado a la tarea de Semanas/.test(await pp.locator("body").innerText()));
  await pp.waitForFunction(() => [...document.querySelectorAll("[data-testid=list-row]")].some((r) => r.textContent.includes("SERUM JOJOBA 50KG") && r.querySelector("[data-testid=list-link-cell][data-linked='1']")), null, { timeout: 30_000 }).catch(() => {});
  check("la Lista muestra el trabajo vinculado a esa tarea", (await jojoba.locator("[data-testid=list-link-cell]").getAttribute("data-linked")) === "1");
  const [newLink] = await q("select l.task_key, w.product, w.branch_owner from semanas_task_links l join work_items w on w.id = l.work_item_id where l.unlinked_at is null and w.product = 'SERUM JOJOBA 50KG'");
  check("en la base: vínculo activo con la tarea elegida (procedencia), responsable tomado de la banda", Boolean(newLink) && /serum jojoba 50kg/.test(String(newLink.task_key)) && newLink.branch_owner === "Cristian", JSON.stringify(newLink ?? {}));
  const elabNow = await (await er.get("/api/v1/semanas/work-item-priorities")).json();
  check("el sector ya ve la prioridad del trabajo nuevo en «Mi trabajo» (NORMAL de su tarea)", Object.values(elabNow.byWorkItem).some((v) => /SERUM JOJOBA/.test(v.taskProducts.join(" ")) && v.priority === "NORMAL"));

  // Envasado Masivo: crear desde una tarea de Acondicionamiento, prioridad URGENTE y verla en su «Mi trabajo»
  await pp.click("[data-testid=semanas-tab-ACONDICIONAMIENTO]");
  await pp.waitForSelector("[data-testid=list-row]", { timeout: 60_000 });
  const masivoRow = pp.locator("[data-testid=list-row]").filter({ hasText: "Envasado Masivo" }).first();
  const masivoDate = await masivoRow.locator("[data-testid=list-date]").innerText();
  await masivoRow.locator("[data-testid=priority-chip]").click();
  await pp.click("[data-testid=priority-option-URGENTE]");
  await pp.waitForTimeout(800);
  await masivoRow.locator("[data-testid=list-link-cell]").click();
  await pp.locator("[data-testid=link-create-from-task]").click();
  await pp.waitForSelector("[data-testid=assign-from-semanas]", { timeout: 20_000 });
  if (!(await pp.locator("#af-qty").inputValue())) await pp.locator("#af-qty").fill("1000");
  await pp.locator("[data-testid=assign-submit]").click();
  await pp.waitForFunction(() => /Vinculado a la tarea de Semanas|NO quedó vinculado/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
  check("Envasado Masivo: trabajo creado desde Semanas y vinculado", /Vinculado a la tarea de Semanas/.test(await pp.locator("body").innerText()), masivoDate);
  const [mRow] = await q("select w.planned_date from semanas_task_links l join work_items w on w.id = l.work_item_id where l.unlinked_at is null and w.sector = 'ENVASADO_MASIVO' order by l.created_at desc limit 1");
  const masivoDay = mRow ? String(mRow.planned_date instanceof Date ? mRow.planned_date.toISOString().slice(0, 10) : mRow.planned_date).slice(0, 10) : DAY;
  const env2 = await openAs(E2E_USERS.envasado, { width: 1366, height: 900 }, masivoDay);
  await env2.page.waitForSelector("[data-testid=work-item-card][data-semanas-priority=URGENTE]", { timeout: 120_000 }).catch(() => {});
  check("Envasado Masivo ve el trabajo URGENTE en «Mi trabajo» (tarjetas, sin edición de planificación)", (await env2.page.locator("[data-testid=work-item-card][data-semanas-priority=URGENTE]").count()) >= 1 && (await env2.page.locator("[data-testid=work-item-card] [data-editable]").count()) === 0);
  await env2.page.screenshot({ path: `${OUT}/16-envasado-masivo-mi-trabajo.png` });
  await env2.ctx.close();
  await pm.ctx.close();
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
