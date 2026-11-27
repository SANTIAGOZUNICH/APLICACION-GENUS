/**
 * Portal de Clientes — ingreso por USUARIO + CONTRASEÑA, administración de usuarios, aislamiento entre clientes,
 * revocación de sesiones, bloqueo por intentos, permisos por sector, estados comerciales y firma (ETag) del seguimiento en
 * tiempo real, contra un Postgres de PRUEBA real. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const direccion = { email: "it-pu-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const administracion = { email: "it-pu-admin@laboratoriogenus.com.ar", sector: "ADMINISTRACION", displayName: "IT Administración" };
const produccion = { email: "it-pu-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const envasado = { email: "it-pu-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 6).toUpperCase();
const NAME_A = `IT PU A ${RUN}`;
const NAME_B = `IT PU B ${RUN}`;
const hdr = (ip = "203.0.113.50") => new Headers({ "x-forwarded-for": ip, "user-agent": "vitest" });
const HOURS = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const PASS_A = "Clave-Segura-A-2026";
const PASS_B = "Clave-Segura-B-2026";

describe.skipIf(Boolean(PROBLEM))(`Portal: usuario y contraseña en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  let A = { id: "", code: "" };
  let B = { id: "", code: "" };
  const ids: Record<string, string> = {};

  const auth = () => import("@/lib/portal/auth-service");
  const uauth = () => import("@/lib/portal/user-auth-service");
  const uadmin = () => import("@/lib/portal/user-admin-service");
  const admin = () => import("@/lib/portal/admin-service");
  const data = () => import("@/lib/portal/data-service");

  async function mkPedido(op: string, producto: string, cliente: string, estado = "EN_PROCESO") {
    const [r] = await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1, $2, $3, $4, 'IT', 'PRODUCCION') returning id::text as id", [op, producto, cliente, estado]);
    return String(r!.id);
  }
  async function mkWork(client: string, product: string, sector: string, over: { status?: string; qty?: string; pedido?: string | null; completedAt?: string | null } = {}) {
    const it = await planning.createItem(weekId, { plannedDate: "2039-03-07", client, product, plannedQuantity: over.qty ?? "5000", unit: "un", sector, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }) } as never, produccion as never);
    await q("update work_items set operational_status = $2, production_pedido_id = $3::uuid, completed_at = $4::timestamptz where id = $1", [it.id, over.status ?? "pendiente", over.pedido ?? null, over.completedAt ?? null]);
    return it.id;
  }
  async function login(username: string, password: string, ip = "203.0.113.50") {
    return (await uauth()).passwordLogin({ username, password, headers: hdr(ip) });
  }
  const cookieOf = (token: string) => `genus_portal_session=${token}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-secret-".padEnd(40, "x");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    planning = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2039-03-07";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT portal usuarios" }, produccion as never));
    weekId = week.id;
    const adm = await admin();
    const a = await adm.createClient(produccion, { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [] });
    const b = await adm.createClient(produccion, { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [] });
    A = { id: a.id, code: a.publicCode };
    B = { id: b.id, code: b.publicCode };

    // Cliente A: pedido de DOS productos (uno listo por confirmación explícita, otro en envasado) + un renglón recién recibido.
    const pA1 = await mkPedido(`OP-A-${RUN}`, "SHAMPOO A", NAME_A);
    const pA2 = await mkPedido(`OP-A-${RUN}`, "ACONDICIONADOR A", NAME_A);
    ids.a1 = await mkWork(NAME_A, "SHAMPOO A", "ENVASADO_MASIVO", { status: "revision", pedido: pA1, qty: "5000", completedAt: HOURS(5) });
    ids.a2 = await mkWork(NAME_A, "ACONDICIONADOR A", "ENVASADO_MASIVO", { status: "en_curso", pedido: pA2, qty: "3000" });
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await markReadyForDelivery(envasado as never, { workItemId: ids.a1, idempotencyKey: `it-pu-${RUN}-a1` });
    await mkPedido(`OP-A-REC-${RUN}`, "JABON RECIBIDO A", NAME_A, "INGRESO");
    // Cliente B: producto con datos propios que A jamás debe ver.
    const pB = await mkPedido(`OP-B-${RUN}`, "GEL SECRETO B", NAME_B);
    ids.b1 = await mkWork(NAME_B, "GEL SECRETO B", "ENVASADO_MASIVO", { status: "en_curso", pedido: pB, qty: "900" });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  // ───────────────────────── Permisos ─────────────────────────
  it("Dirección y Administración crean usuarios; Producción, Envasado y demás sectores NO", async () => {
    const { createPortalUser, listPortalUsers } = await uadmin();
    for (const staff of [produccion, envasado]) {
      await expect(createPortalUser(staff, { clientId: A.id, username: `intruso-${RUN.toLowerCase()}` })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
      await expect(listPortalUsers(staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const ua = await createPortalUser(direccion, { clientId: A.id, username: `Compras.A-${RUN}`, password: "Inicial-Temporal-A1" });
    expect(ua.username).toBe(`compras.a-${RUN}`.toLowerCase());
    expect(ua.temporaryPassword).toBeNull(); // la contraseña la eligió el personal: no se devuelve de nuevo
    const ub = await createPortalUser(administracion, { clientId: B.id, username: `compras.b-${RUN}`, password: "Inicial-Temporal-B1", email: "" });
    // Alta con contraseña inicial: el primer ingreso EXIGE elegir una propia (el personal la conoce).
    const { changeOwnPassword } = await uauth();
    const { resolvePortalSession } = await auth();
    for (const [uname, initial, final] of [[ua.username, "Inicial-Temporal-A1", PASS_A], [ub.username, "Inicial-Temporal-B1", PASS_B]] as const) {
      const first = await login(uname, initial, "198.51.100.9");
      expect(first.ok && first.mustChangePassword).toBe(true);
      if (!first.ok) throw new Error("login inicial");
      await changeOwnPassword((await resolvePortalSession(first.token))!, { current: initial, next: final, headers: hdr() });
    }
    ids.userA = ua.id;
    ids.userB = ub.id;
    const listed = await listPortalUsers(administracion);
    expect(listed.users.map((u) => u.username)).toEqual(expect.arrayContaining([ua.username, ub.username]));
    expect(listed.users.find((u) => u.username === ub.username)!.email).toBeNull(); // correo opcional
  });

  it("nombre de usuario único (sin distinguir mayúsculas), validado y con política de contraseña", async () => {
    const { createPortalUser } = await uadmin();
    await expect(createPortalUser(direccion, { clientId: B.id, username: `COMPRAS.A-${RUN}`, password: PASS_B })).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    await expect(createPortalUser(direccion, { clientId: A.id, username: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createPortalUser(direccion, { clientId: A.id, username: `debil-${RUN}`, password: "corta1" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(createPortalUser(direccion, { clientId: A.id, username: `mail-${RUN}`, email: "no-es-correo" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createPortalUser(direccion, { clientId: randomUUID(), username: `huerfano-${RUN}` })).rejects.toMatchObject({ status: 404 });
  });

  it("la contraseña se guarda con bcrypt: nunca en texto plano ni en la auditoría", async () => {
    const [row] = await q("select password_hash from portal_users where id = $1", [ids.userA]);
    expect(String(row!.password_hash)).toMatch(/^\$2[aby]\$12\$/);
    expect(String(row!.password_hash)).not.toContain(PASS_A);
    const audit = JSON.stringify(await q("select * from portal_audit_events where client_id = $1", [A.id]));
    expect(audit).not.toContain(PASS_A);
    const all = JSON.stringify(await q("select * from portal_users"));
    expect(all).not.toContain(PASS_A);
    expect(all).not.toContain(PASS_B);
  });

  // ───────────────────────── Ingreso ─────────────────────────
  it("login por usuario + contraseña SIN correo → sesión con el cliente correcto; usuario insensible a mayúsculas", async () => {
    const { resolvePortalSession } = await auth();
    const r = await login(`  COMPRAS.A-${RUN}  `, PASS_A, "198.51.100.10");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mustChangePassword).toBe(false);
    const s = await resolvePortalSession(r.token);
    expect(s).toMatchObject({ clientId: A.id, email: null, userId: ids.userA, username: `compras.a-${RUN}`.toLowerCase(), actor: `usuario:compras.a-${RUN}`.toLowerCase() });
    const [u] = await q("select last_login_at, failed_attempts from portal_users where id = $1", [ids.userA]);
    expect(u!.last_login_at).not.toBeNull();
    // la sesión guarda solo el hash del token
    const [sess] = await q("select token_hash from portal_sessions where id = $1", [s!.id]);
    expect(String(sess!.token_hash)).not.toBe(r.token);
  });

  it("mismo mensaje y resultado para usuario inexistente, contraseña mala o usuario desactivado (sin enumeración)", async () => {
    const bad = await login(`compras.a-${RUN}`, "otra-clave-cualquiera-1", "198.51.100.11");
    const unknown = await login(`no-existe-${RUN}`, "otra-clave-cualquiera-1", "198.51.100.11");
    const malformed = await login("!!", "x", "198.51.100.11");
    expect(bad).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual({ ok: false, reason: "invalid" });
    expect(malformed).toEqual({ ok: false, reason: "invalid" });
  });

  it("compatibilidad: el ingreso por correo + código temporal sigue funcionando (sesión sin usuario)", async () => {
    const adm = await admin();
    const email = `compat-${RUN.toLowerCase()}@cliente-a.test`;
    await adm.addClientEmail(produccion, A.id, email);
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    const sent: string[] = [];
    setEmailTransportForTests(async (m) => {
      sent.push(m.text);
      return { status: "ENVIADO", provider: "test", providerMessageId: "it" };
    });
    const { requestLoginCode, verifyLoginCode, resolvePortalSession } = await auth();
    const req = await requestLoginCode({ code: A.code, email, headers: hdr("198.51.100.12") });
    if (req.status === "accepted") await req.deliver();
    const otp = sent.at(-1)?.match(/es: (\d{6})/)?.[1];
    expect(otp).toBeTruthy();
    const v = await verifyLoginCode({ code: A.code, email, otp, headers: hdr("198.51.100.12") });
    expect(v.ok).toBe(true);
    if (v.ok) expect(await resolvePortalSession(v.token)).toMatchObject({ clientId: A.id, email, userId: null, username: null, actor: email });
    setEmailTransportForTests(null);
  });

  // ───────────────────────── Aislamiento ─────────────────────────
  it("aislamiento: cada usuario ve SOLO los productos y pedidos de su cliente (backend)", async () => {
    const { resolvePortalSession } = await auth();
    const { toClientPayload } = await import("@/lib/portal/overview");
    const ra = await login(`compras.a-${RUN}`, PASS_A, "198.51.100.13");
    const rb = await login(`compras.b-${RUN}`, PASS_B, "198.51.100.14");
    if (!ra.ok || !rb.ok) throw new Error("login");
    const sa = (await resolvePortalSession(ra.token))!;
    const sb = (await resolvePortalSession(rb.token))!;
    const { overview: oa } = await (await data()).loadPortalOverview(sa.clientId);
    const { overview: ob } = await (await data()).loadPortalOverview(sb.clientId);
    const ja = JSON.stringify(toClientPayload(oa));
    const jb = JSON.stringify(toClientPayload(ob));
    expect(oa.products.map((p) => p.product).sort()).toEqual(["ACONDICIONADOR A", "JABON RECIBIDO A", "SHAMPOO A"]);
    expect(ob.products.map((p) => p.product)).toEqual(["GEL SECRETO B"]);
    expect(ja).not.toContain("GEL SECRETO B");
    expect(ja).not.toContain(`OP-B-${RUN}`);
    expect(jb).not.toContain("SHAMPOO A");
    expect(jb).not.toContain(`OP-A-${RUN}`);
    // ids opacos por cliente y sin ningún id interno
    for (const internal of [ids.a1, ids.a2, ids.b1]) { expect(ja).not.toContain(internal); expect(jb).not.toContain(internal); }
    // un id de producto/entrega de A no existe para B
    await expect((await data()).getReceiptPreview(sb, oa.products[0]!.id)).resolves.toBeNull();
    // el cliente de la ruta siempre sale de la sesión (la ruta ignora cualquier parámetro)
    const { GET } = await import("@/app/entregas/api/overview/route");
    const res = await GET(new Request(`http://localhost/entregas/api/overview?clientId=${B.id}`, { headers: { cookie: cookieOf(ra.token) } }));
    const body = (await res.json()) as { client: { name: string }; products: Array<{ product: string }> };
    expect(body.client.name).toBe(`Cliente A ${RUN}`);
    expect(JSON.stringify(body)).not.toContain("GEL SECRETO B");
  });

  // ───────────────────────── Estados comerciales (datos reales) ─────────────────────────
  it("estados comerciales desde datos reales: pedido con varios productos NO es «Listo para entregar» si falta uno; renglón nuevo = «Pedido recibido»", async () => {
    const { loadPortalOverview } = await data();
    const { overview } = await loadPortalOverview(A.id);
    const by = Object.fromEntries(overview.products.map((p) => [p.product, p.commercial.id]));
    expect(by).toEqual({ "SHAMPOO A": 5, "ACONDICIONADOR A": 4, "JABON RECIBIDO A": 1 });
    const order = overview.orders.find((o) => o.orderRef === `OP-A-${RUN}`)!;
    expect(order).toMatchObject({ status: { id: 4, label: "En envasado" }, todoListo: false, partial: true });
    expect(order.progress).toMatchObject({ total: 2, listos: 1, enProceso: 1 });
    expect(overview.orders.find((o) => o.orderRef === `OP-A-REC-${RUN}`)!.status.id).toBe(1);
  });

  it("al confirmar el segundo producto el pedido pasa a «Listo para entregar»; con un trabajo cancelado no se bloquea", async () => {
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    const { loadPortalOverview } = await data();
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [ids.a2]);
    await markReadyForDelivery(envasado as never, { workItemId: ids.a2, idempotencyKey: `it-pu-${RUN}-a2` });
    const { overview } = await loadPortalOverview(A.id);
    const order = overview.orders.find((o) => o.orderRef === `OP-A-${RUN}`)!;
    expect(order).toMatchObject({ status: { id: 5 }, todoListo: true, partial: false });
    // cancelación posterior de un producto del pedido: se informa «Cancelado» y el resto sigue
    await q("update work_items set operational_status = 'cancelado', operational_cancelled_at = now() where id = $1", [ids.a2]);
    const after = (await loadPortalOverview(A.id)).overview;
    expect(after.orders.find((o) => o.orderRef === `OP-A-${RUN}`)).toMatchObject({ status: { id: 5 }, todoListo: true });
    expect(after.products.find((p) => p.product === "ACONDICIONADOR A")!.commercial).toMatchObject({ id: 0, key: "CANCELADO" });
  });

  // ───────────────────────── Tiempo real (firma ETag) ─────────────────────────
  it("seguimiento en tiempo real: misma firma → 304 sin cuerpo; un cambio operativo → 200 con firma nueva", async () => {
    const { GET } = await import("@/app/entregas/api/overview/route");
    const rb = await login(`compras.b-${RUN}`, PASS_B, "198.51.100.15");
    if (!rb.ok) throw new Error("login");
    const get = (etag?: string) => GET(new Request("http://localhost/entregas/api/overview", { headers: { cookie: cookieOf(rb.token), ...(etag ? { "if-none-match": etag } : {}) } }));
    const first = await get();
    expect(first.status).toBe(200);
    const tag = first.headers.get("etag")!;
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(first.headers.get("cache-control")).toContain("no-store");
    const same = await get(tag);
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");
    // cambio real en GENUS OS: el envasado de B termina y se confirma como listo
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [ids.b1]);
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await markReadyForDelivery(envasado as never, { workItemId: ids.b1, idempotencyKey: `it-pu-${RUN}-b1` });
    const changed = await get(tag);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(tag);
    expect(((await changed.json()) as { products: Array<{ commercial: { id: number } }> }).products[0]!.commercial.id).toBe(5);
    // sin sesión: 401
    expect((await GET(new Request("http://localhost/entregas/api/overview"))).status).toBe(401);
  });

  // ───────────────────────── Contraseña temporal, cambio y revocación ─────────────────────────
  it("restablecer contraseña: genera una temporal, REVOCA las sesiones vivas, obliga a cambiarla y bloquea el resto hasta hacerlo", async () => {
    const { resolvePortalSession } = await auth();
    const { resetPortalUserPassword } = await uadmin();
    const { changeOwnPassword } = await uauth();
    const { GET } = await import("@/app/entregas/api/overview/route");
    const live = await login(`compras.b-${RUN}`, PASS_B, "198.51.100.16");
    if (!live.ok) throw new Error("login");
    expect(await resolvePortalSession(live.token)).not.toBeNull();
    await expect(resetPortalUserPassword(produccion, ids.userB)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reset = await resetPortalUserPassword(administracion, ids.userB);
    expect(reset.revoked).toBeGreaterThanOrEqual(1);
    expect(reset.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(await resolvePortalSession(live.token)).toBeNull(); // sesión revocada en el acto
    expect((await login(`compras.b-${RUN}`, PASS_B, "198.51.100.16")).ok).toBe(false); // la anterior ya no sirve
    const tmp = await login(`compras.b-${RUN}`, reset.temporaryPassword, "198.51.100.16");
    expect(tmp.ok && tmp.mustChangePassword).toBe(true);
    if (!tmp.ok) return;
    // con la temporal no se ve nada del portal hasta cambiarla
    const blocked = await GET(new Request("http://localhost/entregas/api/overview", { headers: { cookie: cookieOf(tmp.token) } }));
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { code: string }).code).toBe("PASSWORD_CHANGE_REQUIRED");
    const session = (await resolvePortalSession(tmp.token))!;
    await expect(changeOwnPassword(session, { current: "mal-mal-mal-123", next: "Nueva-Clave-9876", headers: hdr() })).rejects.toMatchObject({ code: "BAD_CURRENT_PASSWORD" });
    await expect(changeOwnPassword(session, { current: reset.temporaryPassword, next: "corta1", headers: hdr() })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await changeOwnPassword(session, { current: reset.temporaryPassword, next: "Nueva-Clave-9876", headers: hdr() });
    const ok = await GET(new Request("http://localhost/entregas/api/overview", { headers: { cookie: cookieOf(tmp.token) } }));
    expect(ok.status).toBe(200);
    expect((await login(`compras.b-${RUN}`, reset.temporaryPassword, "198.51.100.16")).ok).toBe(false);
    expect((await login(`compras.b-${RUN}`, "Nueva-Clave-9876", "198.51.100.16")).ok).toBe(true);
    // la auditoría registra el restablecimiento sin la contraseña
    const events = JSON.stringify(await q("select event_type, detail from portal_audit_events where client_id = $1", [B.id]));
    expect(events).toContain("USUARIO_CONTRASENA_RESTABLECIDA");
    expect(events).not.toContain(reset.temporaryPassword);
    expect(events).not.toContain("Nueva-Clave-9876");
  });

  it("desactivar el usuario revoca sus sesiones y no puede volver a ingresar hasta activarlo", async () => {
    const { resolvePortalSession } = await auth();
    const { setPortalUserStatus } = await uadmin();
    const live = await login(`compras.a-${RUN}`, PASS_A, "198.51.100.17");
    if (!live.ok) throw new Error("login");
    await expect(setPortalUserStatus(envasado, ids.userA, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await setPortalUserStatus(direccion, ids.userA, false);
    expect(r.revoked).toBeGreaterThanOrEqual(1);
    expect(await resolvePortalSession(live.token)).toBeNull();
    expect(await login(`compras.a-${RUN}`, PASS_A, "198.51.100.17")).toEqual({ ok: false, reason: "invalid" });
    await setPortalUserStatus(administracion, ids.userA, true);
    expect((await login(`compras.a-${RUN}`, PASS_A, "198.51.100.17")).ok).toBe(true);
  });

  it("suspender al cliente cierra las sesiones de sus usuarios y bloquea el ingreso", async () => {
    const { resolvePortalSession } = await auth();
    const adm = await admin();
    const live = await login(`compras.a-${RUN}`, PASS_A, "198.51.100.18");
    if (!live.ok) throw new Error("login");
    await adm.setClientStatus(produccion, A.id, "SUSPENDIDO", "prueba de integración");
    expect(await resolvePortalSession(live.token)).toBeNull();
    expect(await login(`compras.a-${RUN}`, PASS_A, "198.51.100.18")).toEqual({ ok: false, reason: "invalid" });
    await adm.setClientStatus(produccion, A.id, "ACTIVO", null);
    expect((await login(`compras.a-${RUN}`, PASS_A, "198.51.100.18")).ok).toBe(true);
  });

  // ───────────────────────── Fuerza bruta ─────────────────────────
  it("bloqueo persistente por usuario tras 5 fallos: ni la contraseña correcta entra hasta que venza o se restablezca", async () => {
    const { createPortalUser, resetPortalUserPassword } = await uadmin();
    const u = await createPortalUser(direccion, { clientId: A.id, username: `lock-${RUN.toLowerCase()}`, password: "Lock-Test-Pass-77" });
    for (let i = 0; i < 5; i++) expect(await login(u.username, "incorrecta-clave-99", `192.0.2.${10 + i}`)).toEqual({ ok: false, reason: "invalid" });
    const [row] = await q("select failed_attempts, locked_until from portal_users where id = $1", [u.id]);
    expect(Number(row!.failed_attempts)).toBe(5);
    expect(new Date(String(row!.locked_until)).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    // desde OTRA IP y con la clave correcta sigue bloqueado (el bloqueo es del usuario, no solo de la IP)
    const locked = await login(u.username, "Lock-Test-Pass-77", "192.0.2.99");
    expect(locked).toMatchObject({ ok: false, reason: "locked" });
    // el administrador lo desbloquea restableciendo
    const reset = await resetPortalUserPassword(administracion, u.id);
    const [after] = await q("select failed_attempts, locked_until from portal_users where id = $1", [u.id]);
    expect(Number(after!.failed_attempts)).toBe(0);
    expect(after!.locked_until).toBeNull();
    expect((await login(u.username, reset.temporaryPassword, "192.0.2.98")).ok).toBe(true);
    // un vencimiento simulado del bloqueo también permite ingresar
    for (let i = 0; i < 5; i++) await login(u.username, "incorrecta-clave-99", `192.0.2.${30 + i}`);
    await q("update portal_users set locked_until = now() - interval '1 second' where id = $1", [u.id]);
    expect((await login(u.username, reset.temporaryPassword, "192.0.2.97")).ok).toBe(true);
    const events = (await q("select event_type from portal_audit_events where client_id = $1 and event_type in ('PWD_USER_LOCKED','PWD_LOGIN_LOCKED')", [A.id])).map((r) => r.event_type);
    expect(events).toEqual(expect.arrayContaining(["PWD_USER_LOCKED", "PWD_LOGIN_LOCKED"]));
  }, 90_000);

  it("límite persistente por IP: demasiados intentos desde la misma IP se frenan aunque cambie el usuario", async () => {
    const ip = "203.0.113.200";
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await login(`ip-limit-${RUN.toLowerCase()}-${i}`, "x-clave-cualquiera-1", ip);
      if (!r.ok && r.reason === "rate_limited") limited = true;
    }
    expect(limited).toBe(true);
  }, 90_000);

  // ───────────────────────── Recepción con usuario sin correo ─────────────────────────
  it("la recepción confirmada por un usuario sin correo queda a nombre de «usuario:<nombre>»", async () => {
    const { resolvePortalSession } = await auth();
    const d = await data();
    const [wd] = await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
       values ($1, 'GEL SECRETO B', $2, 'ENVASADO_MASIVO', '900', 'un', now(), 'IT', 'ENVASADO_MASIVO', 'ENTREGADO') returning id::text as id`,
      [ids.b1, NAME_B]
    );
    await q(
      `insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after)
       values ($1, $2, $3, 1, 900, 'un', 'FINAL', 'ACTIVA', 'ENVASADO_MASIVO', 'IT', 'ENVASADO_MASIVO', now(), 900)`,
      [ids.b1, wd!.id, `it-pu-${randomUUID()}`]
    );
    const rb = await login(`compras.b-${RUN}`, "Nueva-Clave-9876", "198.51.100.19");
    if (!rb.ok) throw new Error("login");
    const s = (await resolvePortalSession(rb.token))!;
    const { overview } = await d.loadPortalOverview(s.clientId);
    const delivery = overview.deliveries[0]!;
    const res = await d.confirmReceipt(s, delivery.id, "iphash");
    expect(res.ok).toBe(true);
    const [c] = await q("select confirmed_by_email from portal_receipt_confirmations where client_id = $1", [B.id]);
    expect(c!.confirmed_by_email).toBe(s.actor);
    expect(s.actor).toMatch(/^usuario:compras\.b-/);
  });
});
