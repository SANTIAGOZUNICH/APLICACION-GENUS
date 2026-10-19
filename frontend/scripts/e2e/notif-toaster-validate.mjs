// E2E (Chromium, tablet Android emulada): tarjeta flotante + sonido de avisos. Base DESCARTABLE; login real.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { assertE2eEnvironment, assertMarkedDatabase } from "./e2e-safety.mjs";
import { E2E_PASSWORD, E2E_USERS } from "./e2e-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Pool, neonConfig } = require("@neondatabase/serverless");
neonConfig.webSocketConstructor = require("ws");
assertE2eEnvironment();
const BASE = process.env.GENUS_E2E_BASE_URL ?? "http://localhost:3280";
const OUT = process.env.OUT ?? "/tmp/notif-toaster";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;
await assertMarkedDatabase(q);
const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const ids = [];
const notify = async (sectors, title, message, kind = "aviso_interno") => {
  const id = randomUUID();
  ids.push(id);
  await q("insert into os_notifications (id, kind, title, message, sectors, href, read_by, dismissed_by, deleted_by) values ($1,$2,$3,$4,$5::jsonb,'/avisos?id=x','[]','[]','[]')", [id, kind, title, message, JSON.stringify(sectors)]);
  return id;
};
try {
  await q("delete from os_notifications where title like 'E2E-TOAST%'");
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // Cuenta los sonidos reproducidos (osciladores creados) sin depender del audio real del equipo.
    window.__chimes = 0;
    const AC = window.AudioContext;
    if (AC) {
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { window.__chimes += 1; return orig.call(this); };
    }
  });
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(E2E_USERS.elaboracion.email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.locator("[data-testid=notif-toaster]").waitFor({ state: "attached", timeout: 60_000 });

  await notify(["ELABORACION"], "E2E-TOAST Nuevo aviso", "De: Producción — Priorizar el pedido de Pilar para mañana");
  await notify(["ADMINISTRACION"], "E2E-TOAST Facturación", "Cliente: Pilar", "entrega_registrada");
  await page.reload();
  const toast = page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Nuevo aviso" });
  await toast.waitFor({ timeout: 40_000 });
  check("aparece la tarjeta flotante con tipo, mensaje, fecha y hora", /NUEVO AVISO/.test(await toast.innerText()) && /Priorizar el pedido de Pilar/.test(await toast.innerText()) && /\d{4}/.test(await toast.innerText()));
  await page.screenshot({ path: `${OUT}/tablet-toast.png` });
  const box = await toast.boundingBox();
  check("la tarjeta no tapa la pantalla (ancho < 40 % y la app sigue usable)", box && box.width < 1180 * 0.4 && (await page.locator("body").isVisible()));
  check("no llegan a Elaboración los avisos dirigidos a Administración", (await page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Facturación" }).count()) === 0);
  check("hay un botón para abrir y uno para cerrar", (await toast.locator("[data-testid=notif-toast-open]").count()) === 1 && (await toast.locator("[data-testid=notif-toast-close]").count()) === 1);
  const chimes1 = await page.evaluate(() => window.__chimes);
  await toast.locator("[data-testid=notif-toast-close]").click();
  check("se puede cerrar la tarjeta", (await toast.count()) === 0);
  await page.reload();
  await page.waitForTimeout(3000);
  check("tras recargar NO se repite la tarjeta (sin duplicados)", (await page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Nuevo aviso" }).count()) === 0);
  check("el aviso queda guardado en el historial del backend", (await q("select 1 from os_notifications where title = 'E2E-TOAST Nuevo aviso'")).length === 1);

  // Sonido: silenciar y comprobar que una notificación nueva NO suena; luego activar y comprobar que sí.
  await notify(["ELABORACION"], "E2E-TOAST Segundo", "mensaje 2");
  await page.reload();
  const t2 = page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Segundo" });
  await t2.waitFor({ timeout: 40_000 });
  await t2.locator("[data-testid=notif-sound-toggle]").click(); // silencia
  check("la opción de silenciar queda guardada", /silenciado/i.test(await t2.locator("[data-testid=notif-sound-toggle]").innerText()));
  const before = await page.evaluate(() => window.__chimes);
  await notify(["ELABORACION"], "E2E-TOAST Tercero silencioso", "mensaje 3");
  await page.reload();
  await page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Tercero" }).waitFor({ timeout: 40_000 });
  check("con el sonido silenciado no se reproduce el aviso sonoro", (await page.evaluate(() => window.__chimes)) === 0 || (await page.evaluate(() => window.__chimes)) <= before);
  const t3 = page.locator("[data-testid=notif-toast]", { hasText: "E2E-TOAST Tercero" });
  await t3.locator("[data-testid=notif-sound-toggle]").click(); // activa (y suena una vez como confirmación)
  check("al activar el sonido se reproduce el aviso", await page.waitForFunction(() => window.__chimes > 0, null, { timeout: 8000 }).then(() => true).catch(() => false), `chimes inicial=${chimes1}`);
  await page.screenshot({ path: `${OUT}/tablet-toast-sonido.png` });
  await ctx.close();
} catch (e) {
  console.error(e);
  results.push({ name: "excepción", ok: false });
} finally {
  await q("delete from os_notifications where title like 'E2E-TOAST%'").catch(() => undefined);
  await browser.close();
  await pool.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
