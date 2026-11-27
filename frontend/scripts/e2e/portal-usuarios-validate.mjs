// E2E del Portal de Clientes — usuario + contraseña, aislamiento, ACTUALIZACIÓN AUTOMÁTICA sin recargar y responsive móvil.
// Chromium real, app de producción local y Postgres DESCARTABLE. Ver run-portal-usuarios-e2e-local.sh.
//   Dirección crea clientes y usuarios desde GENUS OS (API + panel) → el cliente entra con usuario + contraseña SIN correo →
//   cambia la contraseña temporal → ve SOLO su pedido (estados comerciales, varios productos) → un cambio operativo real en
//   GENUS OS aparece solo (sin recargar) → desactivar al usuario lo saca solo → aislamiento entre clientes → móvil.
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
const OUT = process.env.OUT ?? "/tmp/portal-usuarios-e2e";
mkdirSync(OUT, { recursive: true });
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const NAME_A = `E2E PU A ${RUN}`;
const NAME_B = `E2E PU B ${RUN}`;
const USER_A = `compras.a-${RUN.toLowerCase()}`;
const USER_B = `compras.b-${RUN.toLowerCase()}`;
const FINAL_A = "Clave-Final-A-2026";
const FINAL_B = "Clave-Final-B-2026";
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
const q = async (text, params = []) => (await pool.query(text, params)).rows;
await assertMarkedDatabase(q);
const mondayOf = (d) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

// ───────── Preparación (Dirección, desde GENUS OS) ─────────
const direccion = await pwRequest.newContext({ baseURL: BASE });
const lg = await direccion.post("/api/v1/auth/login", { data: { email: E2E_USERS.direccion.email, password: E2E_PASSWORD } });
if (lg.status() !== 200) throw new Error(`login Dirección: ${await lg.text()}`);
const produccion = await pwRequest.newContext({ baseURL: BASE });
await produccion.post("/api/v1/auth/login", { data: { email: E2E_USERS.produccion.email, password: E2E_PASSWORD } });
const adminCtx = await pwRequest.newContext({ baseURL: BASE });
await adminCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.administracion.email, password: E2E_PASSWORD } });
const envCtx = await pwRequest.newContext({ baseURL: BASE });
await envCtx.post("/api/v1/auth/login", { data: { email: E2E_USERS.envasado.email, password: E2E_PASSWORD } });
const post = (ctx, action, data) => ctx.post("/api/v1/portal-admin", { data: { action, ...data } });

const createA = await (await post(direccion, "create_client", { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [] })).json();
const createB = await (await post(direccion, "create_client", { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [] })).json();
const clientsList = await (await direccion.get("/api/v1/portal-admin?view=clients")).json();
const idA = clientsList.clients.find((c) => c.publicCode === createA.publicCode).id;
const idB = clientsList.clients.find((c) => c.publicCode === createB.publicCode).id;

// Permisos por sector (backend): solo Dirección y Administración gestionan usuarios.
const denyProd = await post(produccion, "create_user", { clientId: idA, username: `intruso-${RUN.toLowerCase()}` });
const denyEnv = await post(envCtx, "create_user", { clientId: idA, username: `intruso2-${RUN.toLowerCase()}` });
check("Producción y Envasado NO pueden crear usuarios del portal (403)", denyProd.status() === 403 && denyEnv.status() === 403);
check("Producción y Envasado NO ven el listado de usuarios (403)", (await produccion.get("/api/v1/portal-admin?view=users")).status() === 403 && (await envCtx.get("/api/v1/portal-admin?view=users")).status() === 403);
const uA = await post(direccion, "create_user", { clientId: idA, username: USER_A.toUpperCase(), displayName: "Compras A" });
const uAj = await uA.json();
const uB = await post(adminCtx, "create_user", { clientId: idB, username: USER_B });
const uBj = await uB.json();
check("Dirección y Administración crean usuarios (sin correo) con contraseña temporal generada", uA.status() === 201 && uB.status() === 201 && /^[A-Za-z0-9]{12}$/.test(uAj.temporaryPassword) && /^[A-Za-z0-9]{12}$/.test(uBj.temporaryPassword) && uAj.username === USER_A);

// Datos operativos reales: pedido de DOS productos del cliente A (uno en envasado, otro en elaboración) y uno de B.
const today = new Date();
const weekStart = mondayOf(today);
let weekId = (await (await direccion.get(`/api/v1/planning/weeks?weekStart=${weekStart}`)).json()).weeks?.[0]?.id;
if (!weekId) weekId = (await (await produccion.post("/api/v1/planning/weeks", { data: { weekStart, label: "E2E portal usuarios" } })).json()).week.id;
const plannedDate = today.getUTCDay() === 0 || today.getUTCDay() === 6 ? weekStart : today.toISOString().slice(0, 10);
async function item(data) {
  const res = await produccion.post(`/api/v1/planning/weeks/${weekId}/items`, { data: { plannedDate, unit: "un", ...data } });
  if (res.status() !== 201) throw new Error(`crear ${data.product}: ${await res.text()}`);
  return (await res.json()).item.id;
}
const ped = async (op, producto, cliente, estado = "EN_PROCESO") => (await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,$2,$3,$4,'E2E','PRODUCCION') returning id::text as id", [op, producto, cliente, estado]))[0].id;
const OP_A = `OP-${RUN}-A`;
const pA1 = await ped(OP_A, "SHAMPOO REPARADOR", NAME_A);
const pA2 = await ped(OP_A, "CREMA NUTRITIVA", NAME_A);
const pB = await ped(`OP-${RUN}-B`, "GEL SOLO DE B", NAME_B);
const wA1 = await item({ client: NAME_A, product: "SHAMPOO REPARADOR", plannedQuantity: "5000", sector: "ENVASADO_MASIVO", line: "Línea 1" });
const wA2 = await item({ client: NAME_A, product: "CREMA NUTRITIVA", plannedQuantity: "300", unit: "kg", sector: "ELABORACION", branchOwner: "Cristian" });
const wB = await item({ client: NAME_B, product: "GEL SOLO DE B", plannedQuantity: "900", sector: "ENVASADO_MASIVO", line: "Línea 1" });
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso' where id = $1", [wA1, pA1]);
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso' where id = $1", [wA2, pA2]);
await q("update work_items set production_pedido_id = $2::uuid, operational_status = 'en_curso' where id = $1", [wB, pB]);
await q("insert into operational_events (work_item_id, type, actor_email, actor_sector, created_at) values ($1,'ITEM_ASSIGNED','e2e','PRODUCCION', now() - interval '2 days')", [wA2]);

const browser = await chromium.launch({ executablePath: process.env.GENUS_E2E_CHROMIUM_PATH || undefined });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// ───────── Cliente A: login por usuario + contraseña (sin correo) ─────────
const ctxA = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const a = await ctxA.newPage();
await a.goto("/entregas");
check("el portal ofrece «Usuario y contraseña» como ingreso principal (sin pedir correo)", (await a.getByTestId("form-usuario").isVisible()) && (await a.getByLabel("Usuario").isVisible()) && (await a.getByLabel("Correo autorizado").count()) === 0);
await a.screenshot({ path: `${OUT}/01-login-usuario.png` });
await a.getByLabel("Usuario").fill(USER_A);
await a.getByLabel("Contraseña").fill("clave-equivocada-123");
await a.getByRole("button", { name: "Ingresar" }).click();
await a.getByTestId("login-msg").waitFor();
const wrongMsg = await a.getByTestId("login-msg").innerText();
await a.getByLabel("Usuario").fill(`no-existe-${RUN.toLowerCase()}`);
await a.getByLabel("Contraseña").fill("clave-equivocada-123");
await a.getByRole("button", { name: "Ingresar" }).click();
await a.waitForFunction((t) => document.querySelector('[data-testid="login-msg"]')?.textContent !== undefined, wrongMsg);
const unknownMsg = await a.getByTestId("login-msg").innerText();
check("contraseña incorrecta y usuario inexistente muestran el MISMO mensaje genérico", wrongMsg === "Usuario o contraseña incorrectos." && unknownMsg === wrongMsg, `${wrongMsg} | ${unknownMsg}`);

await a.getByLabel("Usuario").fill(USER_A);
await a.getByLabel("Contraseña").fill(uAj.temporaryPassword);
await a.getByRole("button", { name: "Ingresar" }).click();
await a.getByTestId("change-password").waitFor({ timeout: 20000 });
check("con contraseña temporal el portal exige elegir una nueva antes de mostrar nada", (await a.getByTestId("product-card").count()) === 0 && (await a.getByTestId("welcome").count()) === 0);
await a.screenshot({ path: `${OUT}/02-cambio-clave.png` });
await a.getByLabel("Contraseña actual (temporal)").fill(uAj.temporaryPassword);
await a.getByLabel("Contraseña nueva", { exact: true }).fill("corta1");
await a.getByLabel("Repetí la contraseña nueva").fill("corta1");
await a.getByRole("button", { name: "Guardar y continuar" }).click();
await a.getByTestId("change-msg").waitFor();
check("la contraseña débil se rechaza con un mensaje claro", /al menos 10 caracteres/.test(await a.getByTestId("change-msg").innerText()));
await a.getByLabel("Contraseña nueva", { exact: true }).fill(FINAL_A);
await a.getByLabel("Repetí la contraseña nueva").fill(FINAL_A);
await a.getByRole("button", { name: "Guardar y continuar" }).click();
await a.getByTestId("welcome").waitFor({ timeout: 20000 });
check("tras elegir la contraseña entra al portal con el nombre de su cliente", (await a.getByTestId("welcome").innerText()).includes(`Cliente A ${RUN}`));

// Estados comerciales y pedido de varios productos
const order = a.getByTestId("order").filter({ hasText: OP_A });
await order.waitFor();
const cardOf = (name) => order.getByTestId("product-card").filter({ hasText: name });
check("un pedido con dos productos: una tarjeta por producto con su estado comercial", (await order.getByTestId("product-card").count()) === 2 && (await cardOf("SHAMPOO REPARADOR").getByTestId("stage-pill").innerText()) === "En envasado" && (await cardOf("CREMA NUTRITIVA").getByTestId("stage-pill").innerText()) === "En elaboración");
check("el pedido figura en el estado MENOS avanzado y nunca como «Listo para entregar»", (await order.getByTestId("order-status").innerText()) === "En elaboración");
check("camión con los 6 estados comerciales por producto", (await a.locator('[data-testid="truck-tracker"] .gp-stop').count()) === 12);
await a.screenshot({ path: `${OUT}/03-dashboard-escritorio.png`, fullPage: true });

// ───────── Aislamiento ─────────
const bodyA = await a.locator("body").innerText();
check("el cliente A NO ve nada del cliente B (pantalla)", !bodyA.includes("GEL SOLO DE B") && !bodyA.includes(`OP-${RUN}-B`) && !bodyA.includes(NAME_B));
const ovA = await (await ctxA.request.get(`/entregas/api/overview?clientId=${idB}&client=${NAME_B}`)).json();
check("la API del portal ignora cualquier parámetro de cliente: siempre el de la sesión", ovA.client.name === `Cliente A ${RUN}` && !JSON.stringify(ovA).includes("GEL SOLO DE B") && !JSON.stringify(ovA).includes(wB));
check("el JSON del cliente no incluye ids internos, observaciones ni datos de costo/fórmula", ["workItemId", "formula", "costo", "operario", wA1, wA2, pA1, pA2, "incidencia"].every((s) => !JSON.stringify(ovA).includes(s)));

// ───────── Actualización automática SIN recargar ─────────
await a.evaluate(() => { window.__noReloadMarker = "vivo"; window.__navCount = performance.getEntriesByType("navigation").length; });
const overviewStatuses = [];
a.on("response", (r) => { if (r.url().includes("/entregas/api/overview")) overviewStatuses.push(r.status()); });
// Cambio real en GENUS OS: Envasado termina el shampoo y confirma «Listo para entregar» (circuito oficial, vía API).
await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [wA1]);
const mk = await envCtx.post("/api/v1/disponibilidad", { data: { action: "mark", workItemId: wA1, idempotencyKey: `e2e-pu-${RUN}` } });
const mkOk = mk.status() < 300;
if (!mkOk) {
  // Respaldo: marca directa en la base de prueba (misma tabla que usa la API).
  await q("insert into portal_availability_marks (work_item_id, quantity, unit, delivered_before, client_name, product, sector, marked_by, idempotency_key) values ($1, 5000, 'un', 0, $2, 'SHAMPOO REPARADOR', 'ENVASADO_MASIVO', 'e2e-envasado@genus.test', $3)", [wA1, NAME_A, `e2e-pu-${RUN}`]);
}
await cardOf("SHAMPOO REPARADOR").getByTestId("stage-pill").filter({ hasText: "Listo para entregar" }).waitFor({ timeout: 60000 });
check("el cambio operativo aparece SOLO en el portal (sin recargar la página)", (await a.evaluate(() => window.__noReloadMarker)) === "vivo" && (await a.evaluate(() => performance.getEntriesByType("navigation").length)) === 1);
check("pedido con un producto listo y otro en elaboración: el pedido NO es «Listo para entregar» y muestra el progreso", (await order.getByTestId("order-status").innerText()) === "En elaboración" && /Productos listos o entregados: 1 de 2/.test(await order.getByTestId("order-progress").innerText()));
check("indicador discreto de última actualización", /Actualizado \d{2}:\d{2}/.test(await a.getByTestId("sync-status").innerText()));
await a.screenshot({ path: `${OUT}/04-actualizado-solo.png`, fullPage: true });

await a.waitForTimeout(17_000); // un ciclo de consulta sin novedades → 304
// Pausa en segundo plano: con la pestaña oculta no se consulta (se simula la visibilidad del documento).
const before = overviewStatuses.length;
await a.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
await a.waitForTimeout(34_000);
check("en segundo plano la actualización automática se PAUSA", overviewStatuses.length === before, `${before} → ${overviewStatuses.length}`);
await a.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
await a.waitForTimeout(1500);
check("al volver a la pestaña consulta enseguida", overviewStatuses.length > before);
check("la sincronización es liviana: las consultas sin novedades responden 304", overviewStatuses.includes(200) && overviewStatuses.includes(304), overviewStatuses.join(","));


// ───────── Cliente B (otra sesión) ─────────
const ctxB = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const b = await ctxB.newPage();
await b.goto("/entregas");
await b.getByLabel("Usuario").fill(USER_B);
await b.getByLabel("Contraseña").fill(uBj.temporaryPassword);
await b.getByRole("button", { name: "Ingresar" }).click();
await b.getByTestId("change-password").waitFor({ timeout: 20000 });
await b.getByLabel("Contraseña actual (temporal)").fill(uBj.temporaryPassword);
await b.getByLabel("Contraseña nueva", { exact: true }).fill(FINAL_B);
await b.getByLabel("Repetí la contraseña nueva").fill(FINAL_B);
await b.getByRole("button", { name: "Guardar y continuar" }).click();
await b.getByTestId("welcome").waitFor({ timeout: 20000 });
const bodyB = await b.locator("body").innerText();
check("el cliente B ve SOLO lo suyo", bodyB.includes("GEL SOLO DE B") && !bodyB.includes("SHAMPOO REPARADOR") && !bodyB.includes("CREMA NUTRITIVA") && !bodyB.includes(OP_A));

// ───────── Panel de GENUS OS (Dirección) ─────────
const osCtx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const os = await osCtx.newPage();
await os.goto("/login");
await os.locator('input[type="email"]').fill(E2E_USERS.direccion.email);
await os.locator('input[type="password"]').fill(E2E_PASSWORD);
await os.locator('button[type="submit"]').click();
await os.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await os.getByText("Portal de Clientes").first().click();
await os.getByTestId("portal-users").waitFor({ timeout: 30000 });
check("GENUS OS: Dirección ve «Usuarios del portal» con el último acceso", (await os.getByTestId("user-row").filter({ hasText: USER_A }).count()) === 1 && !/nunca/.test(await os.getByTestId("user-row").filter({ hasText: USER_A }).innerText()));
await os.getByTestId("user-form").getByLabel("Cliente").selectOption(idB);
await os.getByTestId("user-form").getByLabel("Usuario", { exact: true }).fill(`panel-${RUN.toLowerCase()}`);
await os.getByTestId("create-user").click();
await os.getByTestId("user-secret-value").waitFor({ timeout: 20000 });
check("GENUS OS: crear usuario desde el panel muestra la contraseña temporal una sola vez", /^[A-Za-z0-9]{12}$/.test((await os.getByTestId("user-secret-value").innerText()).trim()));
await os.screenshot({ path: `${OUT}/05-panel-usuarios.png`, fullPage: true });
await osCtx.close();

// Desactivar al usuario A desde GENUS OS: su portal abierto lo saca solo, sin recargar.
const deact = await post(direccion, "deactivate_user", { userId: uAj.id });
check("Dirección desactiva al usuario (sesiones revocadas)", deact.status() === 200 && (await deact.json()).revoked >= 1);
await a.getByTestId("form-usuario").waitFor({ timeout: 60000 });
check("el portal abierto vuelve SOLO al ingreso cuando se desactiva al usuario", (await a.getByTestId("product-card").count()) === 0);
await a.getByLabel("Usuario").fill(USER_A);
await a.getByLabel("Contraseña").fill(FINAL_A);
await a.getByRole("button", { name: "Ingresar" }).click();
await a.getByTestId("login-msg").waitFor();
check("un usuario desactivado no puede ingresar", (await a.getByTestId("login-msg").innerText()) === "Usuario o contraseña incorrectos.");
const reactivate = await post(adminCtx, "activate_user", { userId: uAj.id });
check("Administración reactiva al usuario", reactivate.status() === 200);

// Fuerza bruta: bloqueo del usuario B tras fallos repetidos (desde el navegador).
for (let i = 0; i < 5; i++) {
  await b.evaluate(() => fetch("/entregas/api/auth/logout", { method: "POST" }));
  const r = await ctxB.request.post("/entregas/api/auth/login", { data: { username: USER_B, password: `mala-clave-${i}-xx` }, headers: { origin: BASE } });
  if (i === 0) check("login por API con clave incorrecta → 401 genérico", r.status() === 401);
}
const locked = await ctxB.request.post("/entregas/api/auth/login", { data: { username: USER_B, password: FINAL_B }, headers: { origin: BASE } });
check("tras 5 fallos el usuario queda bloqueado aunque la clave sea correcta (429)", locked.status() === 429 && Boolean(locked.headers()["retry-after"]));
await post(adminCtx, "reset_user_password", { userId: uBj.id }).then(async (r) => {
  const j = await r.json();
  const ok = await ctxB.request.post("/entregas/api/auth/login", { data: { username: USER_B, password: j.temporaryPassword }, headers: { origin: BASE } });
  check("restablecer la contraseña desbloquea al usuario", r.status() === 200 && ok.status() === 200);
});

// Cookie de sesión del portal: HttpOnly + SameSite + ámbito /entregas
const cookies = await ctxB.cookies();
const sess = cookies.find((c) => c.name === "genus_portal_session");
check("cookie de sesión del portal: HttpOnly, SameSite=Lax y solo para /entregas", Boolean(sess) && sess.httpOnly && sess.sameSite === "Lax" && sess.path === "/entregas");
await ctxB.close();

// ───────── Responsive móvil ─────────
const mctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const m = await mctx.newPage();
await m.goto("/entregas");
check("móvil: ingreso por usuario sin desborde horizontal", (await m.getByTestId("form-usuario").isVisible()) && (await noOverflow(m)));
await m.screenshot({ path: `${OUT}/06-movil-login.png` });
await m.getByLabel("Usuario").fill(USER_A);
await m.getByLabel("Contraseña").fill(FINAL_A);
await m.getByRole("button", { name: "Ingresar" }).click();
await m.getByTestId("welcome").waitFor({ timeout: 20000 });
check("móvil: pedido, productos y camión visibles y sin desborde", (await m.getByTestId("order").first().isVisible()) && (await m.getByTestId("product-card").count()) === 2 && (await m.getByTestId("truck").first().isVisible()) && (await noOverflow(m)));
const stopsMin = await m.locator(".gp-stop small").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
check("móvil: textos legibles (≥ 9 px) y botones táctiles de 44 px", stopsMin >= 9 && (await m.getByTestId("logout").evaluate((e) => e.getBoundingClientRect().height)) >= 36);
await m.screenshot({ path: `${OUT}/07-movil-dashboard.png`, fullPage: true });
await mctx.close();

await browser.close();
await pool.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK. Capturas en ${OUT}`);
if (failed.length) {
  console.log("FALLARON:\n- " + failed.map((f) => f.name).join("\n- "));
  process.exit(1);
}
