/**
 * Portal de Clientes — notificaciones Web Push + modalidad piloto contra un Postgres de PRUEBA real (migración 0097 incluida).
 * Cubre: permisos (solo Dirección), baseline sin retroactivos, outbox idempotente (repetido y concurrente), interruptor apagado = 0
 * envíos reales, aislamiento entre clientes, bajas 404/410, pedido con varios productos sin «Listo» prematuro, historial
 * leído/no leído y que un fallo del envío no toca operaciones. El sender de web-push es SIEMPRE un mock: nunca se envía nada real.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const direccion = { email: "it-pp-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const administracion = { email: "it-pp-admin@laboratoriogenus.com.ar", sector: "ADMINISTRACION", displayName: "IT Administración" };
const produccion = { email: "it-pp-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const envasado = { email: "it-pp-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 6).toUpperCase();
const NAME_A = `IT PP A ${RUN}`;
const NAME_B = `IT PP B ${RUN}`;
const HOURS = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ENDPOINT = (tag: string) => `https://push.example.test/send/${tag}-${RUN}-${"x".repeat(24)}`;
const SUB = (tag: string) => ({ endpoint: ENDPOINT(tag), keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });

describe.skipIf(Boolean(PROBLEM))(`Portal: notificaciones push en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  let A = { id: "", code: "" };
  let B = { id: "", code: "" };
  let sessA = {} as import("@/lib/portal/auth-service").PortalSession;
  let sessA2 = {} as import("@/lib/portal/auth-service").PortalSession;
  let sessB = {} as import("@/lib/portal/auth-service").PortalSession;
  const ids: Record<string, string> = {};

  const svc = () => import("@/lib/portal/push/push-service");
  const admin = () => import("@/lib/portal/admin-service");

  async function mkPedido(op: string, producto: string, cliente: string, estado = "EN_PROCESO") {
    const [r] = await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1, $2, $3, $4, 'IT', 'PRODUCCION') returning id::text as id", [op, producto, cliente, estado]);
    return String(r!.id);
  }
  async function mkWork(client: string, product: string, sector: string, over: { status?: string; qty?: string; pedido?: string | null; completedAt?: string | null } = {}) {
    const it = await planning.createItem(weekId, { plannedDate: "2039-04-04", client, product, plannedQuantity: over.qty ?? "5000", unit: "un", sector, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }) } as never, produccion as never);
    await q("update work_items set operational_status = $2, production_pedido_id = $3::uuid, completed_at = $4::timestamptz where id = $1", [it.id, over.status ?? "pendiente", over.pedido ?? null, over.completedAt ?? null]);
    return it.id;
  }
  /** Mueve trabajos entre Elaboración y Envasado respetando la restricción de sector/asignación. */
  const moveTo = (sector: "ELABORACION" | "ENVASADO_MASIVO", workIds: string[]) =>
    q(
      sector === "ENVASADO_MASIVO"
        ? "update work_items set sector = 'ENVASADO_MASIVO', branch_owner = null, line = 'Línea 1' where id = any($1::uuid[])"
        : "update work_items set sector = 'ELABORACION', branch_owner = 'Cristian', line = null where id = any($1::uuid[])",
      [workIds]
    );
  const outboxOf = async (clientId: string, orderRef?: string) =>
    q("select event_type, status, mode, order_ref, title, body, url, attempts from portal_push_outbox where client_id = $1::uuid" + (orderRef ? " and order_ref = $2" : "") + " order by created_at", orderRef ? [clientId, orderRef] : [clientId]);
  const sender = () => vi.fn(async () => undefined);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-secret-".padEnd(40, "x");
    const webpush = (await import("web-push")).default;
    const keys = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:it@laboratoriogenus.com.ar";
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    planning = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2039-04-04";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT portal push" }, produccion as never));
    weekId = week.id;
    const adm = await admin();
    const a = await adm.createClient(produccion, { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [] });
    const b = await adm.createClient(produccion, { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [] });
    A = { id: a.id, code: a.publicCode };
    B = { id: b.id, code: b.publicCode };
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    const mkSession = async (client: { id: string; code: string }, name: string, uname: string) => {
      const u = await createPortalUser(direccion, { clientId: client.id, username: `${uname}-${RUN}`, password: "Clave-Segura-IT-2026" });
      return { id: randomUUID(), clientId: client.id, email: null, clientName: name, publicCode: client.code, userId: u.id, username: u.username, mustChangePassword: false, actor: `usuario:${u.username}` } as import("@/lib/portal/auth-service").PortalSession;
    };
    sessA = await mkSession(A, NAME_A, "pa1");
    sessA2 = await mkSession(A, NAME_A, "pa2");
    sessB = await mkSession(B, NAME_B, "pb1");

    // Estado previo al piloto (NO debe generar avisos retroactivos).
    ids.pA1 = await mkPedido(`OP-A1-${RUN}`, "SHAMPOO A", NAME_A);
    ids.wA1 = await mkWork(NAME_A, "SHAMPOO A", "ELABORACION", { status: "en_curso", pedido: ids.pA1 }); // → Elaboración
    ids.pB1 = await mkPedido(`OP-B1-${RUN}`, "GEL B", NAME_B);
    ids.wB1 = await mkWork(NAME_B, "GEL B", "ELABORACION", { status: "en_curso", pedido: ids.pB1 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  // ───────────────────────── Permisos ─────────────────────────
  it("solo Dirección administra el piloto, los plazos y el interruptor (Producción, Administración y Envasado → 403)", async () => {
    const s = await svc();
    for (const staff of [produccion, administracion, envasado]) {
      await expect(s.pushAdminOverview(staff)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
      await expect(s.updatePushSettings(staff, { globalSendEnabled: true })).rejects.toMatchObject({ status: 403 });
      await expect(s.setClientPilot(staff, A.id, true)).rejects.toMatchObject({ status: 403 });
    }
    const ov = await s.pushAdminOverview(direccion);
    expect(ov.settings).toMatchObject({ globalSendEnabled: false, elaboracionDays: 8, envasadoDays: 3 }); // por defecto APAGADO
    expect(ov.vapidConfigured).toBe(true);
    await expect(s.updatePushSettings(direccion, { elaboracionDays: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(s.updatePushSettings(direccion, { envasadoDays: "abc" })).rejects.toMatchObject({ code: "VALIDATION" });
    const saved = await s.updatePushSettings(direccion, { elaboracionDays: 9, envasadoDays: 2 });
    expect(saved).toMatchObject({ elaboracionDays: 9, envasadoDays: 2, updatedBy: direccion.email, globalSendEnabled: false });
    await s.updatePushSettings(direccion, { elaboracionDays: 8, envasadoDays: 3 });
  });

  it("sin piloto el cliente SÍ puede registrar su dispositivo (el piloto solo decide el envío) y el worker no registra nada para él", async () => {
    const s = await svc();
    expect(await s.pushClientConfig(sessA, null)).toMatchObject({ available: true, reason: "ok", pilotEnabled: false });
    expect(await s.savePushSubscription(sessA, SUB("pre"), "vitest")).toEqual({ registered: true, devices: 1 });
    expect(await s.pushClientConfig(sessA, ENDPOINT("pre"))).toMatchObject({ thisDevice: true, devices: 1 });
    expect(await s.removePushSubscription(sessA, ENDPOINT("pre"))).toBe(1);
    const send = sender();
    const sum = await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum.clients).toBe(0);
    expect(await outboxOf(A.id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  // ───────────────────────── Baseline ─────────────────────────
  it("al habilitar el piloto se hace el baseline: el estado actual queda notificado y NO se envía ni encola nada", async () => {
    const s = await svc();
    const r = await s.setClientPilot(direccion, A.id, true);
    expect(r).toMatchObject({ enabled: true, baselineOrders: 1 });
    const st = await q("select order_ref, last_rank, baseline from portal_push_order_state where client_id = $1::uuid", [A.id]);
    expect(st).toEqual([{ order_ref: `OP-A1-${RUN}`, last_rank: 3, baseline: true }]);
    const send = sender();
    for (let i = 0; i < 3; i++) await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(await outboxOf(A.id)).toEqual([]); // sin retroactivos
    expect(send).not.toHaveBeenCalled();
    // B no está en el piloto: sin estado y sin eventos.
    expect(await q("select 1 from portal_push_order_state where client_id = $1::uuid", [B.id])).toEqual([]);
  });

  // ───────────────────────── Interruptor apagado = simulado ─────────────────────────
  it("con el envío REAL apagado el evento queda «SIMULADA», no llama a web-push y el cliente no lo ve", async () => {
    const s = await svc();
    ids.pA2 = await mkPedido(`OP-A2-${RUN}`, "CREMA A", NAME_A, "INGRESO"); // pedido nuevo recién recibido
    const send = sender();
    const sum = await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum).toMatchObject({ detected: 1, enqueued: 1, simuladas: 1, enviadas: 0, globalSendEnabled: false });
    expect(send).not.toHaveBeenCalled(); // 0 envíos reales
    const rows = await outboxOf(A.id, `OP-A2-${RUN}`);
    expect(rows).toEqual([expect.objectContaining({ event_type: "RECIBIDO", status: "SIMULADA", mode: "SIMULADO", title: "¡Recibimos tu pedido!" })]);
    expect(String(rows[0]!.body)).toContain("Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance.");
    expect(String(rows[0]!.body)).toBe("Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance.");
    expect(String(rows[0]!.url)).toMatch(/^\/entregas#pedido-/);
    expect((await s.listPushHistory(sessA)).items).toEqual([]);
    const ind = await s.queueIndicators();
    expect(ind.simuladas).toBeGreaterThanOrEqual(1);
  });

  // ───────────────────────── Idempotencia ─────────────────────────
  it("outbox idempotente: ejecuciones repetidas Y concurrentes no duplican eventos", async () => {
    const s = await svc();
    ids.pA3 = await mkPedido(`OP-A3-${RUN}`, "TONICO A", NAME_A, "INGRESO");
    const send = sender();
    const deps = { sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } };
    await Promise.all([s.runPushWorker(deps), s.runPushWorker(deps), s.runPushWorker(deps), s.runPushWorker(deps)]);
    await s.runPushWorker(deps);
    const rows = await outboxOf(A.id, `OP-A3-${RUN}`);
    expect(rows).toHaveLength(1);
    const dup = await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d");
    expect(dup[0]!.n).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  // ───────────────────────── Envío real, aislamiento, bajas ─────────────────────────
  it("con el envío real ENCENDIDO: avisa solo a los dispositivos del cliente dueño, da de baja 404/410 y registra historial", async () => {
    const s = await svc();
    await s.setClientPilot(direccion, B.id, true); // baseline de B (OP-B1 en elaboración)
    await s.savePushSubscription(sessA, SUB("a-phone"), "Mozilla iPhone");
    await s.savePushSubscription(sessA2, SUB("a-pc"), "Mozilla Chrome");
    await s.savePushSubscription(sessA, SUB("a-dead"), "Mozilla viejo");
    await s.savePushSubscription(sessB, SUB("b-phone"), "Mozilla B");
    expect(await s.pushClientConfig(sessA, ENDPOINT("a-phone"))).toMatchObject({ available: true, thisDevice: true, devices: 2 });
    expect(await s.pushClientConfig(sessA2, ENDPOINT("a-phone"))).toMatchObject({ thisDevice: false, devices: 1 }); // por usuario
    await s.updatePushSettings(direccion, { globalSendEnabled: true });

    // Avance real: A1 pasa a Envasado (cambia de sector) y B1 a Envasado también.
    await moveTo("ENVASADO_MASIVO", [ids.wA1!, ids.wB1!]);
    const seen: Array<{ endpoint: string; body: Record<string, string> }> = [];
    const send = vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint === ENDPOINT("a-dead")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      seen.push({ endpoint: sub.endpoint, body: JSON.parse(payload) });
    });
    const sum = await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum.globalSendEnabled).toBe(true);
    expect(sum.dispositivosBaja).toBe(1); // a-dead (410) se elimina en el primer envío
    // Aislamiento: ningún envío de A contiene datos de B y viceversa.
    const toA = seen.filter((x) => x.endpoint.includes("a-phone") || x.endpoint.includes("a-pc"));
    const toB = seen.filter((x) => x.endpoint.includes("b-phone"));
    expect(toA.length).toBeGreaterThan(0);
    expect(toB.length).toBeGreaterThan(0);
    expect(JSON.stringify(toA)).not.toContain(`OP-B1-${RUN}`);
    expect(JSON.stringify(toB)).not.toContain(`OP-A`);
    expect(toB.length).toBeGreaterThan(0);
    expect(toA.some((x) => x.body.title === "¡Tu pedido está en envasado!")).toBe(true);
    // Suscripción inválida eliminada; las demás intactas.
    expect(await q("select 1 from portal_push_subscriptions where endpoint = $1", [ENDPOINT("a-dead")])).toEqual([]);
    expect(await q("select 1 from portal_push_subscriptions where endpoint = $1", [ENDPOINT("a-phone")])).toHaveLength(1);
    // Historial del cliente: solo los avisos REALES; B no ve los de A.
    const hA = await s.listPushHistory(sessA);
    const hB = await s.listPushHistory(sessB);
    expect(hA.items.length).toBeGreaterThan(0);
    expect(hA.items.some((i) => i.title === "¡Tu pedido está en envasado!")).toBe(true);
    expect(JSON.stringify(hA)).not.toContain(`OP-B1-${RUN}`);
    expect(JSON.stringify(hB)).not.toContain(`OP-A`);
    // Re-ejecutar no reenvía (idempotencia persistente).
    const calls = send.mock.calls.length;
    await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(send.mock.calls.length).toBe(calls);
  });

  it("no retrocede: un reproceso (vuelve a Elaboración) no reenvía ni baja lo notificado; al volver a avanzar tampoco repite", async () => {
    const s = await svc();
    const before = (await outboxOf(A.id, `OP-A1-${RUN}`)).length;
    await moveTo("ELABORACION", [ids.wA1!]);
    const send = sender();
    const deps = { sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } };
    await s.runPushWorker(deps);
    expect((await q("select last_rank from portal_push_order_state where client_id = $1::uuid and order_ref = $2", [A.id, `OP-A1-${RUN}`]))[0]!.last_rank).toBe(4);
    await moveTo("ENVASADO_MASIVO", [ids.wA1!]);
    await s.runPushWorker(deps);
    expect(send).not.toHaveBeenCalled();
    expect((await outboxOf(A.id, `OP-A1-${RUN}`)).length).toBe(before);
  });

  // ───────────────────────── Pedido con varios productos ─────────────────────────
  it("pedido con varios productos: «Listo» solo cuando TODOS están listos (nunca prematuro con parciales)", async () => {
    const s = await svc();
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    const p1 = await mkPedido(`OP-A4-${RUN}`, "PROD UNO", NAME_A);
    const p2 = await mkPedido(`OP-A4-${RUN}`, "PROD DOS", NAME_A);
    const w1 = await mkWork(NAME_A, "PROD UNO", "ENVASADO_MASIVO", { status: "en_curso", pedido: p1 });
    const w2 = await mkWork(NAME_A, "PROD DOS", "ENVASADO_MASIVO", { status: "en_curso", pedido: p2 });
    const send = sender();
    const deps = { sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } };
    await s.runPushWorker(deps); // detecta el pedido nuevo (ya en envasado)
    const types = async () => (await outboxOf(A.id, `OP-A4-${RUN}`)).map((r) => r.event_type);
    expect(await types()).toEqual(["ENVASADO"]);
    // Primer producto listo, segundo pendiente.
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [w1]);
    await markReadyForDelivery(envasado as never, { workItemId: w1, idempotencyKey: `it-pp-${RUN}-w1` });
    await s.runPushWorker(deps);
    expect(await types()).toEqual(["ENVASADO"]); // sin «Listo» prematuro
    await q("update work_items set operational_status = 'revision', completed_at = now() where id = $1", [w2]);
    await markReadyForDelivery(envasado as never, { workItemId: w2, idempotencyKey: `it-pp-${RUN}-w2` });
    await s.runPushWorker(deps);
    await s.runPushWorker(deps);
    expect(await types()).toEqual(["ENVASADO", "LISTO"]);
    const listo = (await outboxOf(A.id, `OP-A4-${RUN}`)).find((r) => r.event_type === "LISTO")!;
    expect(listo.title).toBe("¡TU PEDIDO ESTÁ LISTO! 🎉");
  });

  // ───────────────────────── Fallos de envío ─────────────────────────
  it("un fallo del envío NO afecta operaciones: reintenta con backoff y deja intactos los trabajos", async () => {
    const s = await svc();
    ids.pA5 = await mkPedido(`OP-A5-${RUN}`, "FALLA A", NAME_A, "INGRESO");
    const workBefore = JSON.stringify(await q("select id, operational_status, sector, completed_at, updated_at from work_items order by id"));
    const stateBefore = JSON.stringify(await q("select id, estado from production_pedidos order by id"));
    const boom = vi.fn(async () => { throw Object.assign(new Error("push service down"), { statusCode: 503 }); });
    const sum = await s.runPushWorker({ sender: boom, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum.reintentos).toBe(1);
    const [row] = await outboxOf(A.id, `OP-A5-${RUN}`);
    expect(row).toMatchObject({ status: "PENDIENTE", attempts: 1 });
    const [nx] = await q("select next_attempt_at > now() as later, last_error from portal_push_outbox where order_ref = $1", [`OP-A5-${RUN}`]);
    expect(nx!.later).toBe(true);
    expect(String(nx!.last_error)).toContain("503");
    // Un error inesperado en el sender (no HTTP) tampoco rompe el worker.
    await q("update portal_push_outbox set next_attempt_at = now() where order_ref = $1", [`OP-A5-${RUN}`]);
    const sum2 = await s.runPushWorker({ sender: vi.fn(async () => { throw new Error("ECONNRESET"); }), vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum2.reintentos).toBe(1);
    expect(JSON.stringify(await q("select id, operational_status, sector, completed_at, updated_at from work_items order by id"))).toBe(workBefore);
    expect(JSON.stringify(await q("select id, estado from production_pedidos order by id"))).toBe(stateBefore);
    // Al agotar los intentos pasa a FALLIDA; la cola informa el indicador.
    await q("update portal_push_outbox set attempts = 5, next_attempt_at = now() where order_ref = $1", [`OP-A5-${RUN}`]);
    const sum3 = await s.runPushWorker({ sender: boom, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect(sum3.fallidas).toBe(1);
    expect((await outboxOf(A.id, `OP-A5-${RUN}`))[0]!.status).toBe("FALLIDA");
    expect((await s.queueIndicators()).fallidas).toBeGreaterThanOrEqual(1);
  });

  it("sin VAPID con el envío real encendido: el evento espera (sin consumir intentos) y el worker no falla", async () => {
    const s = await svc();
    await mkPedido(`OP-A6-${RUN}`, "SIN VAPID", NAME_A, "INGRESO");
    const sum = await s.runPushWorker({ sender: null, vapid: null });
    expect(sum).toMatchObject({ vapid: false, esperandoVapid: 1, enviadas: 0 });
    expect((await outboxOf(A.id, `OP-A6-${RUN}`))[0]).toMatchObject({ status: "PENDIENTE", attempts: 0 });
  });

  it("un aviso vencido (>24 h) no se envía tarde: queda EXPIRADA", async () => {
    const s = await svc();
    await q("update portal_push_outbox set created_at = $2::timestamptz, next_attempt_at = now() where order_ref = $1", [`OP-A6-${RUN}`, HOURS(30)]);
    const send = sender();
    await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect((await outboxOf(A.id, `OP-A6-${RUN}`))[0]!.status).toBe("EXPIRADA");
    expect(send).not.toHaveBeenCalled();
  });

  // ───────────────────────── Historial leído / no leído ─────────────────────────
  it("historial: leído/no leído por usuario, marcar leídas y aislamiento entre clientes", async () => {
    const s = await svc();
    const h1 = await s.listPushHistory(sessA);
    const h2 = await s.listPushHistory(sessA2);
    expect(h1.unread).toBe(h1.items.length);
    expect(h2.unread).toBe(h2.items.length);
    const first = h1.items[0]!;
    expect(await s.markPushRead(sessA, [first.id])).toBe(1);
    expect(await s.markPushRead(sessA, [first.id])).toBe(0); // idempotente
    const after = await s.listPushHistory(sessA);
    expect(after.unread).toBe(h1.unread - 1);
    expect(after.items.find((i) => i.id === first.id)!.read).toBe(true);
    expect((await s.listPushHistory(sessA2)).unread).toBe(h2.unread); // la lectura es por usuario
    // B no puede marcar avisos de A (ids ajenos no cuentan).
    expect(await s.markPushRead(sessB, h1.items.map((i) => i.id))).toBe(0);
    expect(await s.markPushRead(sessA, null)).toBe(after.unread);
    expect((await s.listPushHistory(sessA)).unread).toBe(0);
  });

  // ───────────────────────── Suscripciones ─────────────────────────
  it("suscripciones: endpoint único (se reasigna al último usuario), baja voluntaria y por cliente", async () => {
    const s = await svc();
    await s.savePushSubscription(sessB, SUB("shared"), "equipo compartido");
    await s.savePushSubscription(sessA, SUB("shared"), "equipo compartido"); // otro usuario en el mismo equipo
    const rows = await q("select client_id::text as c, owner_key from portal_push_subscriptions where endpoint = $1", [ENDPOINT("shared")]);
    expect(rows).toEqual([{ c: A.id, owner_key: `u:${sessA.userId}` }]);
    expect(await s.removePushSubscription(sessB, ENDPOINT("shared"))).toBe(0); // B ya no es dueño
    expect(await s.removePushSubscription(sessA, ENDPOINT("shared"))).toBe(1);
    await expect(s.savePushSubscription(sessA, { endpoint: "http://insegura.test/x", keys: {} }, null)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deshabilitar el piloto frena los eventos nuevos; rehabilitar hace un baseline nuevo (sin retroactivos)", async () => {
    const s = await svc();
    await s.setClientPilot(direccion, B.id, false);
    await mkPedido(`OP-B2-${RUN}`, "NUEVO B", NAME_B, "INGRESO");
    await s.runPushWorker({ sender: sender(), vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect((await outboxOf(B.id)).some((r) => r.order_ref === `OP-B2-${RUN}`)).toBe(false);
    const r = await s.setClientPilot(direccion, B.id, true);
    expect(r.baselineOrders).toBeGreaterThanOrEqual(2);
    const send = sender();
    await s.runPushWorker({ sender: send, vapid: { publicKey: "k", privateKey: "k", subject: "mailto:x@y.z" } });
    expect((await outboxOf(B.id)).some((x) => x.order_ref === `OP-B2-${RUN}`)).toBe(false); // el pedido ya existía al rehabilitar
    await s.updatePushSettings(direccion, { globalSendEnabled: false });
  });

  // ───────────────────────── Notificación de prueba (manual, solo Dirección) ─────────────────────────
  it("notificación de prueba: solo al cliente elegido, con el interruptor global APAGADO, sin tocar pedidos/estado/outbox de pedidos", async () => {
    const s = await svc();
    const adm = await admin();
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    const mk = async (label: string) => {
      const c = await adm.createClient(produccion, { displayName: `Cliente ${label} ${RUN}`, aliases: [`IT PP ${label} ${RUN}`], emails: [] });
      const u = await createPortalUser(direccion, { clientId: c.id, username: `pt${label.toLowerCase()}-${RUN}`, password: "Clave-Segura-IT-2026" });
      const sess = { id: randomUUID(), clientId: c.id, email: null, clientName: `IT PP ${label} ${RUN}`, publicCode: c.publicCode, userId: u.id, username: u.username, mustChangePassword: false, actor: `usuario:${u.username}` } as import("@/lib/portal/auth-service").PortalSession;
      return { id: c.id, sess };
    };
    const C = await mk("C");
    const D = await mk("D");
    const E = await mk("E");
    const send = vi.fn(async (_sub: { endpoint: string }, _payload: string) => undefined);

    // Rechazos: no habilitado en el piloto / sin dispositivos.
    await expect(s.sendTestPush(direccion, C.id, { sender: send })).rejects.toMatchObject({ status: 409, code: "PUSH_NOT_ENABLED" });
    await s.setClientPilot(direccion, C.id, true);
    await s.setClientPilot(direccion, D.id, true);
    await expect(s.sendTestPush(direccion, C.id, { sender: send })).rejects.toMatchObject({ status: 409, code: "PUSH_NO_DEVICES" });
    expect(send).not.toHaveBeenCalled();
    await expect(s.sendTestPush(direccion, C.id, { sender: null })).rejects.toMatchObject({ status: 503, code: "PUSH_UNAVAILABLE" });

    // 403 para todo sector que no sea Dirección.
    for (const staff of [produccion, administracion, envasado]) await expect(s.sendTestPush(staff, C.id, { sender: send })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    await s.savePushSubscription(C.sess, SUB("c-phone"), "Mozilla C1");
    await s.savePushSubscription(C.sess, SUB("c-dead"), "Mozilla C2");
    await s.savePushSubscription(D.sess, SUB("d-phone"), "Mozilla D");

    // Foto de lo que NO debe cambiar.
    expect((await s.getPushSettings()).globalSendEnabled).toBe(false);
    const snapshot = async () => ({
      work: await q("select md5(string_agg(t::text, '|' order by id)) as h, count(*)::int as n from work_items t"),
      state: await q("select md5(coalesce(string_agg(t::text, '|' order by client_id, order_key), '')) as h, count(*)::int as n from portal_push_order_state t"),
      outbox: await q("select md5(coalesce(string_agg(t::text, '|' order by id), '')) as h, count(*)::int as n from portal_push_outbox t where event_type <> 'prueba'"),
      settings: await q("select global_send_enabled from portal_push_settings where id = 1"),
    });
    const before = await snapshot();

    const deadSend = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint === ENDPOINT("c-dead")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    const res = await s.sendTestPush(direccion, C.id, { sender: deadSend });
    expect(res).toMatchObject({ sent: 1, failed: 0, removed: 1, devices: 2 });
    // Solo los dispositivos de C (nunca los de D) y con el texto exacto.
    expect(deadSend.mock.calls.map((c) => c[0].endpoint).sort()).toEqual([ENDPOINT("c-dead"), ENDPOINT("c-phone")].sort());
    const payload = JSON.parse(String((deadSend.mock.calls[0] as unknown[])[1]));
    expect(payload).toMatchObject({ title: "¡Bienvenido a Laboratorio Genus! 🎉", body: "Las notificaciones de tu portal funcionan correctamente. A partir de ahora podrás recibir novedades sobre tus pedidos.", url: "/entregas" });
    // Baja automática del 410; D intacto.
    expect(await q("select 1 from portal_push_subscriptions where endpoint = $1", [ENDPOINT("c-dead")])).toEqual([]);
    expect(await q("select 1 from portal_push_subscriptions where client_id = $1::uuid", [D.id])).toHaveLength(1);
    // Sin cambios en work_items / estado / outbox de pedidos / interruptor global.
    expect(await snapshot()).toEqual(before);
    // Historial de C: tipo «prueba», no leída, abre /entregas; D no lo ve; se puede marcar como leída.
    const hC = await s.listPushHistory(C.sess);
    expect(hC.items).toHaveLength(1);
    expect(hC.items[0]).toMatchObject({ type: "prueba", url: "/entregas", read: false, title: "¡Bienvenido a Laboratorio Genus! 🎉" });
    expect(hC.unread).toBe(1);
    expect((await s.listPushHistory(D.sess)).items).toEqual([]);
    expect(await s.markPushRead(C.sess, [hC.items[0]!.id])).toBe(1);
    expect((await s.listPushHistory(C.sess)).unread).toBe(0);
    // El indicador de cola de pedidos no cuenta pruebas.
    const qi = await s.queueIndicators();
    expect(await q("select count(*)::int as n from portal_push_outbox where status = 'ENVIADA' and event_type <> 'prueba'")).toEqual([{ n: qi.enviadas }]);
    // Auditoría con el usuario de Dirección.
    const au = await q("select actor, actor_kind, detail from portal_audit_events where client_id = $1::uuid and event_type = 'PUSH_PRUEBA_ENVIADA'", [C.id]);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor: direccion.email, actor_kind: "STAFF", detail: { devices: 2, sent: 1, removed: 1 } });

    // Doble clic: dentro de la ventana de 30 s no se reenvía.
    const calls = deadSend.mock.calls.length;
    await expect(s.sendTestPush(direccion, C.id, { sender: deadSend })).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(deadSend.mock.calls.length).toBe(calls);
    expect(await q("select 1 from portal_push_outbox where client_id = $1::uuid and event_type = 'prueba'", [C.id])).toHaveLength(1);

    // Aislamiento: la prueba a D (ventana propia) solo llega a D.
    const sendD = vi.fn(async () => undefined);
    expect(await s.sendTestPush(direccion, D.id, { sender: sendD })).toMatchObject({ sent: 1, failed: 0 });
    expect(sendD.mock.calls.map((c) => (c as unknown as [{ endpoint: string }])[0].endpoint)).toEqual([ENDPOINT("d-phone")]);

    // Con el interruptor global ENCENDIDO el envío de prueba tampoco lo modifica.
    await s.updatePushSettings(direccion, { globalSendEnabled: true });
    await s.setClientPilot(direccion, E.id, true);
    await s.savePushSubscription(E.sess, SUB("e-phone"), "Mozilla E");
    const sendE = vi.fn(async () => undefined);
    await s.sendTestPush(direccion, E.id, { sender: sendE });
    expect((await s.getPushSettings()).globalSendEnabled).toBe(true);
    await s.updatePushSettings(direccion, { globalSendEnabled: false });
  });

  it("la ruta admin push_test devuelve 403 a quien no es Dirección (el servicio lo valida de nuevo)", async () => {
    const s = await svc();
    await expect(s.sendTestPush(produccion, A.id, { sender: vi.fn() })).rejects.toMatchObject({ status: 403 });
    await expect(s.sendTestPush(direccion, "no-es-uuid", { sender: vi.fn() })).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
  });

  it("la API HTTP exige sesión del portal y mismo origen", async () => {
    const { POST, GET } = await import("@/app/entregas/api/push/[action]/route");
    const ctx = (action: string) => ({ params: Promise.resolve({ action }) });
    expect((await GET(new Request("http://localhost/entregas/api/push/history"), ctx("history"))).status).toBe(401);
    const post = await POST(new Request("http://localhost/entregas/api/push/subscribe", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: "{}" }), ctx("subscribe"));
    expect(post.status).toBe(403);
  });
});
