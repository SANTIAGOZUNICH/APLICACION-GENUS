// E2E (Chromium, TABLET): Avisos dirigidos a usuarios / responsables / sectores con tarjeta flotante. Base DESCARTABLE; login real.
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
const OUT = process.env.OUT ?? "/tmp/avisos-usuarios";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const tablet = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 };
const U = E2E_USERS;

async function login(user) {
  const ctx = await browser.newContext({ baseURL: BASE, ...tablet });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.locator("[data-testid=notif-toaster]").waitFor({ state: "attached", timeout: 60_000 });
  return { ctx, page };
}
const toastOf = (page, text) => page.locator("[data-testid=notif-toast]", { hasText: text });
const sees = async (page, text, ms = 25_000) => toastOf(page, text).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
const send = (page, data) => page.request.post("/api/v1/avisos", { data: { priority: "IMPORTANTE", confirm: true, ...data } });

async function cleanup() {
  await q("delete from os_internal_messages where title like 'E2E-AV%'").catch(() => undefined);
  await q("delete from os_notifications where title like '%E2E-AV%'").catch(() => undefined);
}
try {
  await cleanup();
  const prod = await login(U.produccion);

  // a) Un usuario específico
  const r1 = await send(prod.page, { title: "E2E-AV uno", body: "Priorizar el pedido de Pilar para mañana", toSectors: [], toUsers: [U.envasado.email] });
  check("enviar a UN usuario (201)", r1.status() === 201, String(r1.status()));
  // El destinatario entra DESPUÉS de enviado (estaba desconectado): ve su aviso pendiente.
  const env = await login(U.envasado);
  check("el usuario que entra después ve su tarjeta pendiente (no se pierde)", await sees(env.page, "E2E-AV uno"));
  const t = toastOf(env.page, "E2E-AV uno").first();
  const txt = await t.innerText();
  check("la tarjeta muestra NUEVO AVISO, remitente (sector y nombre) y el mensaje completo", /NUEVO AVISO/.test(txt) && /De: Producción — E2E Producción/.test(txt) && /Priorizar el pedido de Pilar para mañana/.test(txt));
  await env.page.screenshot({ path: `${OUT}/tablet-tarjeta-aviso.png` });
  // Otra persona del MISMO sector y otra de otro sector: no lo reciben.
  const resp = await login(U.envasadoResp);
  const ela = await login(U.elaboracion);
  await resp.page.waitForTimeout(4000);
  check("otra persona del mismo sector NO lo recibe (ni tarjeta ni bandeja)", !(await sees(resp.page, "E2E-AV uno", 3000)) && !JSON.stringify(await (await resp.page.request.get("/api/v1/avisos?tab=recibidos")).json()).includes("E2E-AV uno"));
  check("una persona de otro sector NO lo recibe", !(await sees(ela.page, "E2E-AV uno", 3000)) && !JSON.stringify(await (await ela.page.request.get("/api/v1/avisos?tab=recibidos")).json()).includes("E2E-AV uno"));

  // Lectura individual
  const list = await (await env.page.request.get("/api/v1/avisos?tab=recibidos")).json();
  const msg = list.messages.find((m) => m.title === "E2E-AV uno");
  check("para el destinatario figura como no leído", msg && msg.mine && msg.mine.readAt === null);
  const read = await env.page.request.patch(`/api/v1/avisos/${msg.id}`, { data: { action: "read" } });
  check("marcar leído guarda la lectura de ESA persona", read.ok() && (await q("select read_at from os_internal_message_users where message_id = $1 and user_email = $2", [msg.id, U.envasado.email]))[0].read_at != null);

  // b) Varios usuarios desde la pantalla (selector de personas en la tablet)
  await prod.page.goto("/mi-trabajo");
  await prod.page.getByRole("button", { name: /^Avisos$/ }).or(prod.page.getByRole("link", { name: /^Avisos$/ })).first().click({ timeout: 120_000 });
  await prod.page.locator("[data-testid=avisos-compose]").tap();
  await prod.page.locator("[data-testid=aviso-title]").fill("E2E-AV varios");
  await prod.page.locator("[data-testid=aviso-body]").fill("Reunión de líneas a las 14");
  await prod.page.locator("[data-testid=aviso-user-search]").fill("E2E");
  const boxes = prod.page.locator("[data-testid=aviso-user-check]");
  await boxes.first().waitFor({ timeout: 30_000 });
  for (const label of ["E2E Elaboración", "E2E Responsable Envasado"]) await prod.page.locator("li", { hasText: label }).locator("[data-testid=aviso-user-check]").first().tap();
  await prod.page.screenshot({ path: `${OUT}/tablet-redactar.png` });
  await prod.page.locator("[data-testid=aviso-send]").tap();
  await prod.page.getByRole("button", { name: "Enviar", exact: true }).last().tap();
  check("varios usuarios: ambos reciben su tarjeta", (await sees(ela.page, "E2E-AV varios")) && (await sees(resp.page, "E2E-AV varios")));
  check("…y quien no fue elegido (otra persona del sector) no la recibe", !(await sees(env.page, "E2E-AV varios", 3000)));
  const urow = await q("select user_email, read_at from os_internal_message_users where message_id = (select id from os_internal_messages where title = 'E2E-AV varios') order by user_email");
  check("cada destinatario tiene su propia fila de lectura (sin leer)", urow.length === 2 && urow.every((r) => r.read_at === null));

  // c) Responsables de un sector
  const r3 = await send(prod.page, { title: "E2E-AV resp", body: "Solo para responsables", toSectors: ["ENVASADO_MASIVO"], onlyResponsables: true });
  check("responsables del sector (201)", r3.status() === 201, String(r3.status()));
  check("lo recibe el responsable", await sees(resp.page, "E2E-AV resp"));
  check("NO lo recibe quien no es responsable del mismo sector", !(await sees(env.page, "E2E-AV resp", 3000)));
  // d) Sector completo (comportamiento anterior)
  const r4 = await send(prod.page, { title: "E2E-AV sector", body: "Para todo el sector", toSectors: ["ENVASADO_MASIVO"] });
  check("sector completo: lo reciben todos sus integrantes", r4.status() === 201 && (await sees(env.page, "E2E-AV sector")) && (await sees(resp.page, "E2E-AV sector")));
  check("…y otro sector no", !(await sees(ela.page, "E2E-AV sector", 3000)));
  // e) Permisos y validaciones
  const bad = await send(prod.page, { title: "E2E-AV malo", body: "x", toSectors: [], toUsers: ["inexistente@genus.test"] });
  check("usuario inexistente: rechazado con mensaje claro", bad.status() >= 400 && /No existe un usuario activo/.test(await bad.text()));
  const dir = await send(prod.page, { title: "E2E-AV sin", body: "x", toSectors: [] });
  check("sin destinatarios: rechazado", dir.status() >= 400);
  const dctx = await login(U.direccion);
  check("un sector que no participa de Avisos no puede enviar (403)", (await send(dctx.page, { title: "E2E-AV dir", body: "x", toSectors: ["PRODUCCION"] })).status() >= 400);
  check("la lista de personas no se entrega a quien no participa de Avisos", (await dctx.page.request.get("/api/v1/avisos/directory")).status() >= 400);
  await dctx.ctx.close();
  // f) Historial persistente tras recargar
  await env.page.reload();
  await env.page.waitForTimeout(3000);
  check("tras recargar no se repite la tarjeta ya mostrada (sin duplicados)", (await toastOf(env.page, "E2E-AV uno").count()) === 0);
  check("el aviso sigue en la campana/historial persistente", (await q("select count(*)::int n from os_notifications where title like '%E2E-AV uno%' and target_emails ? $1", [U.envasado.email]))[0].n === 1);
  for (const c of [prod, env, resp, ela]) await c.ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await cleanup().catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
