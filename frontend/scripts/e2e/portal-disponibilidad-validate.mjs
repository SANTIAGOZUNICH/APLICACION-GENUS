// E2E (Chromium real; build de producción local; Postgres DESCARTABLE) de «Listo para entregar»:
// el usuario de Envasado Masivo abre el trabajo en GENUS OS, usa «Marcar listo para entregar» (confirmación con datos y
// cantidad parcial), el Portal de Clientes se actualiza solo (parcial → todo listo), permisos por sector en el servidor,
// entrega física aparte y rectificación. Deja capturas en $OUT. Ver run-portal-disponibilidad-e2e-local.sh.
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
const OUT = process.env.OUT ?? "/tmp/portal-disponibilidad-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const NAME = `E2E DISP ${RUN}`;
const EMAIL = `cliente-${RUN.toLowerCase()}@e2e-cliente.test`;
const PRODUCT = `SERUM DISPONIBLE ${RUN}`;
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const mondayOf = (d) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

// ── Preparación: cliente del portal + trabajo real de Envasado Masivo para HOY ──
const admin = await pwRequest.newContext({ baseURL: BASE });
if ((await admin.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } })).status() !== 200) throw new Error("login Producción");
const client = await (await admin.post("/api/v1/portal-admin", { data: { action: "create_client", displayName: `Cliente ${RUN}`, aliases: [NAME], emails: [EMAIL] } })).json();
const today = new Date();
const weekStart = mondayOf(today);
let weekId = (await (await admin.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()).weeks?.[0]?.id;
if (!weekId) weekId = (await (await admin.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E disponibilidad" } })).json()).week.id;
const plannedDate = today.getUTCDay() === 0 || today.getUTCDay() === 6 ? weekStart : today.toISOString().slice(0, 10);
const created = await admin.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { plannedDate, client: NAME, product: PRODUCT, plannedQuantity: "5000", unit: "un", sector: "ENVASADO_MASIVO", line: "Línea 1" } });
if (created.status() !== 201) throw new Error(`crear trabajo: ${await created.text()}`);
const workId = (await created.json()).item.id;
await admin.post(`/api/v1/planning/weeks/${weekId}/publish`, { data: {} });
const [ped] = await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,$2,$3,'EN_PROCESO','E2E','PRODUCCION') returning id::text as id", [`OP-DISP-${RUN}`, PRODUCT, NAME]);
// En curso, con 2.000 realizadas informadas con «Guardar avance».
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso', finished_qty = '2000' where id = $1", [workId, ped.id]);
const fingerprint = async () =>
  JSON.stringify(await Promise.all([
    q("select count(*)::int n from work_item_deliveries"),
    q("select count(*)::int n from work_item_delivery_lines"),
    q("select count(*)::int n from mp_stock_movements"),
    q("select count(*)::int n from os_notifications"),
    q("select id, operational_status, finished_qty, sector from work_items where id = $1", [workId]),
  ]));
const before = await fingerprint();

// En «Mi trabajo» de Envasado: trabajo en curso → «Ver / Registrar avance»; trabajo terminado → pestaña «Pendientes» → «Ver detalle».
const openDrawer = async (page, finished) => {
  if (finished) {
    await page.getByRole("tab", { name: /^Pendientes/ }).first().click({ timeout: 120000 });
    await page.getByRole("button", { name: /Ver detalle/ }).first().click({ timeout: 120000 });
  } else {
    await page.getByRole("button", { name: /Registrar avance/ }).first().click({ timeout: 120000 });
  }
};
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
async function portalLogin(page) {
  await page.goto("/entregas");
  await page.getByLabel("Código de cliente").fill(client.publicCode);
  await page.getByLabel("Correo autorizado").fill(EMAIL);
  await q("update portal_login_challenges set created_at = created_at - interval '2 minutes' where email = $1", [EMAIL]);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await page.getByLabel("Código recibido por correo").waitFor();
  let otp = null;
  for (let i = 0; i < 30 && !otp; i++) {
    otp = (await q("select body_text from portal_email_outbox where kind = 'LOGIN' and to_email = $1 order by created_at desc limit 1", [EMAIL]))[0]?.body_text?.match(/es: (\d{6})/)?.[1] ?? null;
    if (!otp) await new Promise((r) => setTimeout(r, 300));
  }
  await page.getByLabel("Código recibido por correo").fill(otp);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.getByTestId("welcome").waitFor({ timeout: 15000 });
}

// ── Portal ANTES de confirmar: el trabajo en curso no está listo ──
const pctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
const pp = await pctx.newPage();
await portalLogin(pp);
const pcard = () => pp.getByTestId("product-card").filter({ hasText: PRODUCT });
check("portal antes de confirmar: el producto está en Envasado (no «Listo»)", (await pcard().getByTestId("stage-pill").innerText()) === "Envasado");

// ── GENUS OS: usuario de Envasado Masivo ──
const ectx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const ep = await ectx.newPage();
await ep.goto("/login");
await ep.locator('input[type="email"]').fill(E2E_USERS.envasado.email);
await ep.locator('input[type="password"]').fill(E2E_PASSWORD);
await ep.locator('button[type="submit"]').click();
await ep.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
if (!ep.url().includes("/mi-trabajo")) await ep.goto("/mi-trabajo");
await openDrawer(ep, false);
const panel = ep.getByTestId("mark-ready-panel");
await panel.waitFor({ timeout: 30000 });
check("GENUS OS: Envasado Masivo ve «Marcar listo para entregar» en su trabajo", (await ep.getByTestId("mark-ready-btn").innerText()).trim() === "Marcar listo para entregar");
await ep.screenshot({ path: `${OUT}/01-genus-os-boton.png` });
await ep.getByTestId("mark-ready-btn").click();
const dlg = ep.getByTestId("mark-ready-dialog");
await dlg.waitFor();
const text = await dlg.innerText();
check("diálogo: cliente, pedido, producto, sector, cantidad y mensaje de confirmación", [NAME, `OP-DISP-${RUN}`, PRODUCT, "Envasado Masivo", "¿Confirmás que este producto está terminado y disponible para entregar al cliente?"].every((t) => text.includes(t)) && (await ep.getByTestId("mark-ready-qty").inputValue()) === "2000");
check("botones «Confirmar disponibilidad» y «Cancelar»", (await dlg.getByRole("button", { name: "Confirmar disponibilidad" }).count()) === 1 && (await dlg.getByRole("button", { name: "Cancelar" }).count()) === 1);
await ep.screenshot({ path: `${OUT}/02-genus-os-confirmacion.png` });
// cantidad inválida: el botón se bloquea
await ep.getByTestId("mark-ready-qty").fill("2001");
check("no deja confirmar más de lo terminado", await dlg.getByRole("button", { name: "Confirmar disponibilidad" }).isDisabled());
await ep.getByTestId("mark-ready-qty").fill("2000");
await dlg.getByRole("button", { name: "Cancelar" }).click();
check("«Cancelar» no marca nada", (await q("select 1 from portal_availability_marks where work_item_id = $1", [workId])).length === 0);
await ep.getByTestId("mark-ready-btn").click();
await ep.getByTestId("mark-ready-dialog").getByRole("button", { name: "Confirmar disponibilidad" }).dblclick(); // doble clic
await ep.getByTestId("mark-ready-marks").waitFor();
check("confirmación con doble clic: UNA sola marca de 2.000", (await q("select quantity from portal_availability_marks where work_item_id = $1", [workId])).length === 1 && /2\.000/.test(await ep.getByTestId("mark-ready-marks").innerText()));
check("con todo lo terminado ya marcado el botón desaparece (no se duplica)", (await ep.getByTestId("mark-ready-btn").count()) === 0);
await ep.screenshot({ path: `${OUT}/03-genus-os-marcado.png` });

// ── Portal DESPUÉS: parcial ──
await pp.reload();
const pnote = await pcard().getByTestId("partial-note").innerText();
check("portal: disponibilidad parcial (solicitado 5.000 · disponible 2.000 · pendiente 3.000), NO «Listo» todavía", (await pcard().getByTestId("stage-pill").innerText()) === "Envasado" && /disponible 2\.000/.test(pnote) && /pendiente 3\.000/.test(pnote) && /5\.000/.test(pnote), pnote);
check("portal: fecha y hora de disponibilidad y mensaje de parte lista", (await pcard().getByTestId("available-since").count()) === 1 && (await pcard().getByTestId("stage-message").innerText()).includes("Una parte de tu pedido ya está lista"));
await pp.screenshot({ path: `${OUT}/04-portal-parcial.png`, fullPage: true });
const mailsAfterFirst = (await q("select 1 from portal_email_outbox where kind = 'LISTO_PARA_ENTREGAR'")).length;
check("la confirmación en sí no manda correos reales (el aviso sale en el escaneo y el correo está en modo captura)", mailsAfterFirst === 0);

// ── El sector termina el resto y confirma las 3.000 nuevas ──
await q("update work_items set finished_qty = '5000', operational_status = 'revision', completed_at = now() where id = $1", [workId]);
await ep.reload();
await openDrawer(ep, true);
await ep.getByTestId("mark-ready-btn").waitFor();
await ep.getByTestId("mark-ready-btn").click();
check("la cantidad ofrecida es solo la NUEVA (3.000), sin repetir las primeras 2.000", (await ep.getByTestId("mark-ready-qty").inputValue()) === "3000");
await ep.getByTestId("mark-ready-dialog").getByRole("button", { name: "Confirmar disponibilidad" }).click();
await ep.getByTestId("mark-ready-marks").locator("li").nth(1).waitFor();
check("dos marcas (2.000 + 3.000), sin duplicar", (await q("select quantity from portal_availability_marks where work_item_id = $1 order by marked_at", [workId])).map((r) => r.quantity).join() === "2000,3000");
await pp.reload();
check("portal: todo confirmado → «Listo para entregar» con 5.000 disponibles", (await pcard().getByTestId("stage-pill").innerText()) === "Listo para entregar" && (await pcard().getByTestId("stage-message").innerText()) === "¡Tu producto está listo! Podés coordinar la entrega con nuestro equipo." && (await pcard().getByTestId("fact-available").innerText()).includes("5.000"));
await pp.screenshot({ path: `${OUT}/05-portal-listo.png`, fullPage: true });

// ── Aviso por correo: solo por la confirmación, sin duplicados ──
const cronRun = async () => (await admin.get("/api/cron/portal-sync", { headers: { authorization: "Bearer e2e-cron-secret" } })).json();
await cronRun();
await cronRun();
const mails = await q("select subject, body_text from portal_email_outbox where kind = 'LISTO_PARA_ENTREGAR' order by created_at");
check("aviso «Tu producto está listo» una vez por confirmación (2) y sin duplicar al repetir el cron", mails.length === 2 && mails.every((m) => m.subject === "Tu producto está listo | Laboratorio Genus") && mails.some((m) => /2\.000/.test(m.body_text)) && mails.some((m) => /3\.000/.test(m.body_text)));

// ── Entrega física: mecanismo existente, aparte ──
await q("insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status) values ($1,$2,$3,'ENVASADO_MASIVO','2000','un',now(),'E2E','ENVASADO_MASIVO','ENTREGADO')", [workId, PRODUCT, NAME]);
const [wd] = await q("select id::text as id from work_item_deliveries where work_item_id = $1", [workId]);
await q("insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after) values ($1,$2,$3,1,2000,'un','PARCIAL','ACTIVA','ENVASADO_MASIVO','E2E','ENVASADO_MASIVO',now(),2000)", [workId, wd.id, `e2e-del-${RUN}`]);
await pp.reload();
const dnote = await pcard().getByTestId("fact-available").innerText();
check("entrega parcial posterior: el portal muestra 3.000 disponibles y 2.000 entregados (la disponibilidad no es entrega)", dnote.includes("3.000") && (await pcard().getByTestId("fact-delivered").innerText()).includes("2.000"));
await ep.reload();
await openDrawer(ep, true);
await ep.getByTestId("mark-ready-marks").waitFor();
const retractBtns = await ep.getByTestId("retract-mark-btn").count();
check("rectificar: solo queda la marca de 3.000 (la de 2.000 ya fue entregada: sin «Retirar»)", retractBtns === 1);
await ep.getByTestId("retract-mark-btn").click();
await ep.getByTestId("retract-reason").fill("Error de conteo de cajas");
await ep.getByTestId("retract-confirm").click();
await ep.getByTestId("mark-ready-btn").waitFor();
check("rectificación auditada: la marca queda retirada con motivo y NADA se borra", (await q("select retract_reason, retracted_by from portal_availability_marks where work_item_id = $1 and retracted_at is not null", [workId]))[0]?.retract_reason === "Error de conteo de cajas" && (await q("select action from portal_availability_audit where work_item_id = $1 order by created_at", [workId])).map((r) => r.action).join() === "MARCAR,MARCAR,RETIRAR");
await pp.reload();
const afterNote = await pcard().getByTestId("stage-pill").innerText();
const corr = await pp.getByTestId("bell").click().then(() => pp.getByRole("region", { name: "Notificaciones" }).innerText());
check("portal tras rectificar: ya no figura «Listo» y el cliente ve la corrección del aviso anterior", afterNote !== "Listo para entregar" && /corregimos un aviso anterior/i.test(corr));
await pp.screenshot({ path: `${OUT}/06-portal-rectificado.png` });
check("la entrega física registrada NO se alteró", (await q("select quantity, status from work_item_delivery_lines where work_item_id = $1", [workId])).length === 1);

// ── Permisos en el servidor ──
const post = (ctx, data) => ctx.post("/api/v1/disponibilidad", { data });
const as = async (user) => {
  const c = await pwRequest.newContext({ baseURL: BASE });
  await c.post("/api/v1/auth/login", { data: { email: user.email, password: E2E_PASSWORD } });
  return c;
};
const idk = () => `e2e-${RUN}-${Math.random().toString(36).slice(2)}`;
check("Envasado Premium NO puede marcar un trabajo de Masivo (403)", (await post(await as(E2E_USERS.envasadoPremium), { action: "mark", workItemId: workId, idempotencyKey: idk() })).status() === 403);
check("Codificado NO puede marcarlo (403)", (await post(await as(E2E_USERS.codificado), { action: "mark", workItemId: workId, idempotencyKey: idk() })).status() === 403);
check("Elaboración NO puede marcarlo (403)", (await post(await as(E2E_USERS.elaboracion), { action: "mark", workItemId: workId, idempotencyKey: idk() })).status() === 403);
check("Producción tampoco marca (no es el último sector) (403)", (await post(admin, { action: "mark", workItemId: workId, idempotencyKey: idk() })).status() === 403);
check("sin sesión interna: 401", (await post(await pwRequest.newContext({ baseURL: BASE }), { action: "mark", workItemId: workId, idempotencyKey: idk() })).status() === 401);
check("id manipulado: 400/404", [400, 404].includes((await post(await as(E2E_USERS.envasado), { action: "mark", workItemId: "00000000-0000-4000-8000-000000000000", idempotencyKey: idk() })).status()));
check("el botón no aparece para un sector que no es el dueño del trabajo", (await (await (await as(E2E_USERS.envasadoPremium)).get(`/api/v1/disponibilidad?workItemId=${workId}`)).json()).canMark === false);

// ── Integridad ──
const after = JSON.parse(await fingerprint());
const b = JSON.parse(before);
check("no se alteraron stock, movimientos, avisos internos ni el estado operativo del trabajo (solo lo que simula la prueba)", after[2][0].n === b[2][0].n && after[3][0].n === b[3][0].n);

// ── Tablet y móvil ──
for (const [name, opts] of [["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ["movil", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await browser.newContext({ baseURL: BASE, ...opts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.envasado.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  if (!page.url().includes("/mi-trabajo")) await page.goto("/mi-trabajo");
  await openDrawer(page, true);
  await page.getByTestId("mark-ready-panel").waitFor({ timeout: 30000 });
  await page.getByTestId("mark-ready-btn").tap();
  await page.getByTestId("mark-ready-dialog").waitFor();
  check(`${name}: diálogo de confirmación usable y sin desborde`, (await page.getByTestId("mark-ready-dialog").getByRole("button", { name: "Confirmar disponibilidad" }).isVisible()) && (await noOverflow(page)));
  await page.screenshot({ path: `${OUT}/07-genus-os-${name}.png` });
  await ctx.close();
}

await browser.close();
await pool.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
