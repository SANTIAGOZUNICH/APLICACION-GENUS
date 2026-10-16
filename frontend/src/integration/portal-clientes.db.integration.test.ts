/**
 * Portal de Clientes contra un Postgres de PRUEBA real (mismas consultas que Neon): acceso (código + correo + código temporal),
 * vencimientos, suspensión, intentos repetidos, aislamiento entre clientes, etapas desde datos reales, entregas parciales,
 * pedidos con varios productos, confirmación de recepción (sin tocar stock/estados/entregas), avisos sin duplicados y
 * administración. NO envía correos reales: el transporte se reemplaza. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-portal-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = randomUUID().slice(0, 6).toUpperCase();
const NAME_A = `IT PORTAL A ${RUN}`;
const NAME_B = `IT PORTAL B ${RUN}`;
const EMAIL_A = `compras-a-${RUN.toLowerCase()}@cliente-a.test`;
const EMAIL_B = `compras-b-${RUN.toLowerCase()}@cliente-b.test`;
const hdr = (ip = "203.0.113.7") => new Headers({ "x-forwarded-for": ip, "user-agent": "vitest" });
const HOURS = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe.skipIf(Boolean(PROBLEM))(`Portal de Clientes en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const ids: Record<string, string> = {};
  let A = { id: "", code: "" };
  let B = { id: "", code: "" };

  const auth = () => import("@/lib/portal/auth-service");
  const data = () => import("@/lib/portal/data-service");
  const admin = () => import("@/lib/portal/admin-service");
  const notify = () => import("@/lib/portal/notify-service");

  async function mkWork(client: string, product: string, sector: string, over: { status?: string; qty?: string; pedido?: string | null; completedAt?: string | null } = {}) {
    const it = await planning.createItem(weekId, { plannedDate: "2039-02-08", client, product, plannedQuantity: over.qty ?? "5000", unit: "un", sector, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : sector === "CODIFICADO" ? {} : { line: "Línea 1" }) } as never, prod as never);
    await q("update work_items set operational_status = $2, production_pedido_id = $3::uuid, completed_at = $4::timestamptz where id = $1", [it.id, over.status ?? "pendiente", over.pedido ?? null, over.completedAt ?? null]);
    return it.id;
  }
  async function mkPedido(op: string, producto: string, cliente: string) {
    const [r] = await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1, $2, $3, 'EN_PROCESO', 'IT', 'PRODUCCION') returning id::text as id", [op, producto, cliente]);
    return String(r!.id);
  }
  async function event(workId: string, type: string, at: string) {
    await q("insert into operational_events (work_item_id, type, actor_email, actor_sector, created_at) values ($1, $2, 'it', 'PRODUCCION', $3)", [workId, type, at]);
  }
  async function deliver(workId: string, product: string, client: string, qty: number, at: string, final = true) {
    const [wd] = await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
       values ($1, $2, $3, 'ENVASADO_MASIVO', $4, 'un', $5, 'IT', 'ENVASADO_MASIVO', 'ENTREGADO') returning id::text as id`,
      [workId, product, client, String(qty), at]
    );
    const [l] = await q(
      `insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after)
       values ($1, $2, $3, 1, $4, 'un', $5, 'ACTIVA', 'ENVASADO_MASIVO', 'IT', 'ENVASADO_MASIVO', $6, $4) returning id::text as id`,
      [workId, wd!.id, `it-${randomUUID()}`, qty, final ? "FINAL" : "PARCIAL", at]
    );
    return String(l!.id);
  }
  /** Login completo (pide código, lo lee del correo capturado, verifica) → sesión. */
  async function login(code: string, email: string, ip = "203.0.113.7") {
    const { requestLoginCode, verifyLoginCode } = await auth();
    sent.length = 0;
    const r = await requestLoginCode({ code, email, headers: hdr(ip) });
    expect(r.status).toBe("accepted");
    if (r.status === "accepted") await r.deliver();
    const mail = sent.find((m) => m.to === email);
    const otp = mail?.text.match(/es: (\d{6})/)?.[1];
    return { mail, otp, verify: (o: string) => verifyLoginCode({ code, email, otp: o, headers: hdr(ip) }) };
  }
  const fingerprint = async () =>
    JSON.stringify(await Promise.all([
      q("select id, status, quantity, actual_delivered_at, deleted_at from work_item_deliveries order by id"),
      q("select id, status, quantity, actual_delivered_at from work_item_delivery_lines order by id"),
      q("select id, operational_status, completed_at, planned_quantity, finished_qty from work_items order by id"),
      q("select count(*)::int n, coalesce(sum(quantity), 0)::float s from mp_stock_movements"),
      q("select codigo, stock_actual from mp_stock_balances order by codigo"),
    ]));

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
    const weekStart = "2039-02-07";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT portal" }, prod as never));
    weekId = week.id;
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(async (m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { status: "ENVIADO", provider: "test", providerMessageId: "it" };
    });
    const adm = await admin();
    A = { id: "", code: "" };
    const a = await adm.createClient(prod, { displayName: `Cliente A ${RUN}`, aliases: [NAME_A], emails: [EMAIL_A] });
    const b = await adm.createClient(prod, { displayName: `Cliente B ${RUN}`, aliases: [NAME_B], emails: [EMAIL_B] });
    A = { id: a.id, code: a.publicCode };
    B = { id: b.id, code: b.publicCode };

    // Cliente A: pedido con DOS productos (cada uno con su estado) + uno cancelado que no debe aparecer.
    const pedA1 = await mkPedido(`OP-A1-${RUN}`, "SHAMPOO A1", NAME_A);
    const pedA2 = await mkPedido(`OP-A2-${RUN}`, "CREMA A2", NAME_A);
    ids.a1elab = await mkWork(NAME_A, "SHAMPOO A1", "ELABORACION", { status: "en_curso", pedido: pedA1, qty: "300" });
    await event(ids.a1elab, "ITEM_ASSIGNED", "2026-10-05T13:00:00Z");
    ids.a2env = await mkWork(NAME_A, "CREMA A2", "ENVASADO_MASIVO", { status: "revision", pedido: pedA2, qty: "5000", completedAt: HOURS(5) });
    ids.cancelado = await mkWork(NAME_A, "PRODUCTO CANCELADO A", "ENVASADO_MASIVO", { status: "pendiente" });
    await q("update work_items set operational_status = 'cancelado', operational_cancelled_at = now() where id = $1", [ids.cancelado]);
    // Cliente B: un producto con una entrega final y datos internos que NO deben filtrarse.
    const pedB = await mkPedido(`OP-B-${RUN}`, "GEL B SECRETO", NAME_B);
    ids.benv = await mkWork(NAME_B, "GEL B SECRETO", "ENVASADO_MASIVO", { status: "entregado", pedido: pedB, qty: "1000" });
    ids.bdelivery = await deliver(ids.benv, "GEL B SECRETO", NAME_B, 1000, "2026-10-14T15:00:00Z");
  }, 180_000);

  afterAll(async () => {
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(null);
    await pool?.end();
  });

  // ───────────────────────── Acceso ─────────────────────────
  it("login correcto: código de cliente + correo autorizado + código temporal → sesión; el código llega solo por correo", async () => {
    const { resolvePortalSession } = await auth();
    const l = await login(A.code, EMAIL_A, "198.51.100.1");
    expect(l.mail?.subject).toBe("Tu código de acceso | Laboratorio Genus");
    expect(l.otp).toMatch(/^\d{6}$/);
    const v = await l.verify(l.otp!);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect((await resolvePortalSession(v.token))?.clientId).toBe(A.id);
    // El código de cliente solo NO da acceso, y el código temporal no se reutiliza.
    expect((await l.verify(l.otp!)).ok).toBe(false);
    // En la base solo hay hashes: ni el código temporal ni el token.
    const dump = JSON.stringify([await q("select * from portal_login_challenges"), await q("select * from portal_sessions")]);
    expect(dump).not.toContain(l.otp!);
    expect(dump).not.toContain(v.token);
    // Fuera del modo de pruebas locales («capture») el correo guardado en el registro NO lleva el código.
    process.env.PORTAL_EMAIL_MODE = "live";
    try {
      await q("update portal_rate_limits set hits = 0");
      await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
      const live = await login(A.code, EMAIL_A, "198.51.100.9");
      expect(live.otp).toMatch(/^\d{6}$/);
      const [row] = await q("select body_text, body_html from portal_email_outbox where kind = 'LOGIN' and to_email = $1 order by created_at desc limit 1", [EMAIL_A]);
      expect(JSON.stringify(row)).not.toContain(live.otp!);
      expect(JSON.stringify(row)).not.toContain("acceso?t=");
    } finally {
      process.env.PORTAL_EMAIL_MODE = "capture";
    }
  });

  it("código de cliente incorrecto o correo no autorizado: no se envía nada y la respuesta es igual (sin enumeración)", async () => {
    const { requestLoginCode } = await auth();
    sent.length = 0;
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '5 minutes' where client_id = $1::uuid", [A.id]);
    const real = await requestLoginCode({ code: A.code, email: EMAIL_A, headers: hdr("198.51.100.2") });
    const wrongCode = await requestLoginCode({ code: "GEN-ZZZZZZ", email: EMAIL_A, headers: hdr("198.51.100.3") });
    const wrongEmail = await requestLoginCode({ code: A.code, email: "intruso@otro.test", headers: hdr("198.51.100.4") });
    const crossEmail = await requestLoginCode({ code: A.code, email: EMAIL_B, headers: hdr("198.51.100.5") });
    for (const r of [real, wrongCode, wrongEmail, crossEmail]) {
      expect(r.status).toBe("accepted");
      if (r.status === "accepted") await r.deliver();
    }
    expect(sent.map((m) => m.to)).toEqual([EMAIL_A]); // solo el correo realmente autorizado para ESE código
  });

  it("código temporal vencido, intentos agotados y enlace de un solo uso", async () => {
    const { resolvePortalSession, verifyLoginLink } = await auth();
    // vencido
    let l = await login(A.code, EMAIL_A, "198.51.100.10");
    await q("update portal_login_challenges set expires_at = now() - interval '1 minute' where client_id = $1::uuid and consumed_at is null", [A.id]);
    expect((await l.verify(l.otp!)).ok).toBe(false);
    // 5 intentos erróneos agotan el código: ni el correcto sirve después
    await q("update portal_rate_limits set hits = 0");
    l = await login(A.code, EMAIL_A, "198.51.100.11");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
    for (let i = 0; i < 5; i++) expect((await l.verify(l.otp === "111111" ? "222222" : "111111")).ok).toBe(false);
    expect((await l.verify(l.otp!)).ok).toBe(false);
    // enlace seguro: sirve una vez
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
    const l2 = await login(A.code, EMAIL_A, "198.51.100.12");
    const token = l2.mail!.text.match(/acceso\?t=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const first = await verifyLoginLink({ token, headers: hdr("198.51.100.12") });
    expect(first.ok).toBe(true);
    if (first.ok) expect((await resolvePortalSession(first.token))?.clientId).toBe(A.id);
    expect((await verifyLoginLink({ token, headers: hdr("198.51.100.12") })).ok).toBe(false);
  });

  it("sesión vencida o cerrada no sirve; límite de intentos repetidos por IP/correo", async () => {
    const { resolvePortalSession, logoutPortalSession, requestLoginCode } = await auth();
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
    const l = await login(A.code, EMAIL_A, "198.51.100.20");
    const v = await l.verify(l.otp!);
    if (!v.ok) throw new Error("login");
    await q("update portal_sessions set expires_at = now() - interval '1 second' where token_hash is not null and client_id = $1::uuid and revoked_at is null", [A.id]);
    expect(await resolvePortalSession(v.token)).toBeNull();
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
    const l2 = await login(A.code, EMAIL_A, "198.51.100.21");
    const v2 = await l2.verify(l2.otp!);
    if (!v2.ok) throw new Error("login2");
    await logoutPortalSession(v2.token);
    expect(await resolvePortalSession(v2.token)).toBeNull();
    // intentos repetidos: tras superar el límite por correo, se rechaza aunque los datos sean correctos
    await q("update portal_rate_limits set hits = 0");
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await requestLoginCode({ code: A.code, email: EMAIL_A, headers: hdr(`192.0.2.${i + 1}`) });
      if (r.status === "rate_limited") limited = true;
    }
    expect(limited).toBe(true);
    const audit = await q("select 1 from portal_audit_events where event_type = 'LOGIN_REQUEST_RATE_LIMITED' limit 1");
    expect(audit.length).toBe(1);
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
  });

  it("cliente suspendido: sesiones cerradas al instante, no puede pedir código; al reactivar vuelve a entrar", async () => {
    const { resolvePortalSession } = await auth();
    const { setClientStatus } = await admin();
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [B.id]);
    const l = await login(B.code, EMAIL_B, "198.51.100.30");
    const v = await l.verify(l.otp!);
    if (!v.ok) throw new Error("login B");
    await setClientStatus(prod, B.id, "SUSPENDIDO", "Prueba de suspensión");
    expect(await resolvePortalSession(v.token)).toBeNull();
    const again = await login(B.code, EMAIL_B, "198.51.100.31");
    expect(again.mail).toBeUndefined();
    await setClientStatus(prod, B.id, "ACTIVO", null);
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [B.id]);
    const back = await login(B.code, EMAIL_B, "198.51.100.32");
    expect((await back.verify(back.otp!)).ok).toBe(true);
  });

  // ───────────────────────── Datos, etapas y aislamiento ─────────────────────────
  it("aislamiento: cada cliente ve SOLO lo suyo y nada interno (ids, trabajos cancelados, otros clientes)", async () => {
    const { loadPortalOverview } = await data();
    const { toClientPayload } = await import("@/lib/portal/overview");
    const a = toClientPayload((await loadPortalOverview(A.id)).overview);
    const b = toClientPayload((await loadPortalOverview(B.id)).overview);
    expect(a.products.map((p) => p.product).sort()).toEqual(["CREMA A2", "SHAMPOO A1"]);
    expect(b.products.map((p) => p.product)).toEqual(["GEL B SECRETO"]);
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    expect(ja).not.toContain("GEL B");
    expect(jb).not.toContain("SHAMPOO A1");
    expect(ja).not.toContain("CANCELADO");
    for (const id of Object.values(ids)) {
      expect(ja).not.toContain(id);
      expect(jb).not.toContain(id);
    }
    for (const forbidden of ["formula", "fórmula", "costo", "margen", "observ", "materia_prima", "created_by", "it-portal-prod"]) {
      expect(ja.toLowerCase()).not.toContain(forbidden);
    }
    // El id opaco de un producto de B no existe para A.
    expect(a.products.some((p) => b.products.some((x) => x.id === p.id))).toBe(false);
  });

  it("etapas reales: Elaboración con su fecha de asignación; Envasado terminado hace horas = Listo; pedido con varios productos", async () => {
    const { loadPortalOverview } = await data();
    const { overview } = await loadPortalOverview(A.id, new Date());
    const shampoo = overview.products.find((p) => p.product === "SHAMPOO A1")!;
    const crema = overview.products.find((p) => p.product === "CREMA A2")!;
    expect(shampoo.stage).toBe("ELABORACION");
    expect(shampoo.orderRef).toBe(`OP-A1-${RUN}`);
    expect(shampoo.countdown).toMatchObject({ totalDays: 10, startedDate: "2026-10-05" });
    expect(shampoo.countdown!.remainingDays).toBeGreaterThanOrEqual(0);
    expect(crema.stage).toBe("LISTO");
    expect(crema.quantities).toMatchObject({ requested: 5000, delivered: 0, available: 5000 });
    expect(overview.summary).toMatchObject({ elaboracion: 1, listos: 1, inProcess: 2 });
    expect(overview.ready).toHaveLength(1);
  });

  it("pasos: Elaboración→Envasado→Codificado (sigue en finalización, NO entregado)→Listo", async () => {
    const { loadPortalOverview } = await data();
    const ped = await mkPedido(`OP-FLOW-${RUN}`, "LOCION FLUJO", NAME_A);
    const elab = await mkWork(NAME_A, "LOCION FLUJO", "ELABORACION", { status: "completo", pedido: ped, qty: "800" });
    await event(elab, "ITEM_ASSIGNED", "2026-10-01T12:00:00Z");
    const now = new Date(Date.now() + 5_000);
    const stageOf = async () => (await loadPortalOverview(A.id, now)).overview.products.find((p) => p.product === "LOCION FLUJO")!;
    expect((await stageOf()).stage).toBe("ELABORACION"); // terminada en traspaso: todavía no pasó a Envasado
    const env = await mkWork(NAME_A, "LOCION FLUJO", "ENVASADO_PREMIUM", { status: "pendiente", pedido: ped, qty: "800" });
    await event(env, "RECEIVED_FROM_ELABORACION", "2026-10-09T10:00:00Z");
    const s1 = await stageOf();
    expect(s1.stage).toBe("ENVASADO");
    expect(s1.countdown).toMatchObject({ totalDays: 5, startedDate: "2026-10-09" });
    // Envasado envía a Codificado: MISMO trabajo, sector CODIFICADO (sin línea), en curso → sigue «en finalización», nunca entregado.
    await q("update work_items set sector = 'CODIFICADO', line = null, via_codificado = true, sent_to_codificado_at = now(), operational_status = 'en_curso' where id = $1", [env]);
    const s2 = await stageOf();
    expect(s2.stage).toBe("ENVASADO");
    expect(s2.substage).toBe("FINALIZACION");
    expect(s2.quantities.delivered).toBe(0);
    // Codificado termina: solo falta entregar → Listo para entregar.
    await q("update work_items set operational_status = 'revision', completed_at = $2::timestamptz where id = $1", [env, HOURS(0.05)]);
    expect((await stageOf()).stage).toBe("LISTO");
    ids.flowEnv = env;
  });

  it("entrega parcial: 5.000 solicitadas, 2.000 entregadas, 3.000 pendientes — no se marca entregado antes de tiempo", async () => {
    const { loadPortalOverview } = await data();
    const ped = await mkPedido(`OP-PARC-${RUN}`, "SERUM PARCIAL", NAME_A);
    const w = await mkWork(NAME_A, "SERUM PARCIAL", "ENVASADO_MASIVO", { status: "en_curso", pedido: ped, qty: "5000" });
    await deliver(w, "SERUM PARCIAL", NAME_A, 2000, "2026-10-15T14:00:00Z", false);
    const p = (await loadPortalOverview(A.id)).overview.products.find((x) => x.product === "SERUM PARCIAL")!;
    expect(p.stage).not.toBe("ENTREGADO");
    expect(p.partialDelivery).toBe(true);
    expect(p.quantities).toMatchObject({ requested: 5000, delivered: 2000, pending: 3000 });
    expect(p.deliveries).toHaveLength(1);
  });

  it("una transferencia interna (traspaso entre sectores) NO es una entrega al cliente", async () => {
    const { loadPortalOverview } = await data();
    const before = (await loadPortalOverview(A.id)).overview.deliveries.length;
    await q("insert into operational_events (work_item_id, type, actor_email, actor_sector) values ($1, 'DELIVERED_TO_ENVASADO', 'it', 'ELABORACION')", [ids.a1elab]);
    await q("update work_items set operational_status = 'entregado' where id = $1", [ids.a1elab]);
    const o = (await loadPortalOverview(A.id)).overview;
    expect(o.deliveries.length).toBe(before);
    expect(o.products.find((p) => p.product === "SHAMPOO A1")!.stage).not.toBe("ENTREGADO");
    await q("update work_items set operational_status = 'en_curso' where id = $1", [ids.a1elab]);
  });

  // ───────────────────────── Confirmación de recepción ─────────────────────────
  it("confirmar recepción: constancia con fecha/hora y usuario, auditada, aviso a Producción, sin tocar operación; no duplica y persiste", async () => {
    const { loadPortalOverview, confirmReceipt, getReceiptPreview } = await data();
    const { resolvePortalSession } = await auth();
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [B.id]);
    const l = await login(B.code, EMAIL_B, "198.51.100.40");
    const v = await l.verify(l.otp!);
    if (!v.ok) throw new Error("login B");
    const session = (await resolvePortalSession(v.token))!;
    const o = (await loadPortalOverview(B.id)).overview;
    const d = o.deliveries[0]!;
    expect(d.canConfirm).toBe(true);
    expect(await getReceiptPreview(session, d.id)).toMatchObject({ product: "GEL B SECRETO", quantity: 1000 });
    const before = await fingerprint();
    const r = await confirmReceipt(session, d.id, "iphash");
    expect(r.ok).toBe(true);
    expect(await fingerprint()).toBe(before); // stock, movimientos, consumos, lotes, cantidades y estados intactos
    const dup = await confirmReceipt(session, d.id, "iphash");
    expect(dup).toEqual({ ok: false, reason: "already_confirmed" });
    expect(await q("select 1 from portal_receipt_confirmations where client_id = $1::uuid", [B.id])).toHaveLength(1);
    const [row] = await q("select confirmed_by_email, quantity, delivered_at from portal_receipt_confirmations where client_id = $1::uuid", [B.id]);
    expect(row).toMatchObject({ confirmed_by_email: EMAIL_B, quantity: "1000" });
    expect((await q("select 1 from portal_audit_events where client_id = $1::uuid and event_type = 'RECEPCION_CONFIRMADA'", [B.id])).length).toBe(1);
    expect((await q("select sectors from os_notifications where kind = 'PORTAL_RECEPCION'")).length).toBeGreaterThanOrEqual(1);
    const after = (await loadPortalOverview(B.id)).overview.deliveries[0]!;
    expect(after.canConfirm).toBe(false);
    expect(after.confirmation?.by).toBe(EMAIL_B);
    // Un cliente no puede confirmar la entrega de otro (id opaco ajeno → no existe).
    const sessionA = { ...session, clientId: A.id };
    expect(await confirmReceipt(sessionA, d.id, null)).toEqual({ ok: false, reason: "not_found" });
  });

  it("solo hay «Confirmar recepción» donde GENUS OS registró una entrega final física", async () => {
    const { loadPortalOverview } = await data();
    const o = (await loadPortalOverview(A.id)).overview;
    const crema = o.products.find((p) => p.product === "CREMA A2")!; // lista, sin entrega registrada
    expect(crema.deliveries).toHaveLength(0);
    expect(o.deliveries.every((d) => d.canConfirm || d.confirmation)).toBe(true);
  });

  // ───────────────────────── Avisos ─────────────────────────
  it("aviso «producto listo»: una sola vez por producto y destinatario, asunto correcto, sin duplicar al repetir el escaneo", async () => {
    const { scanPortalNotifications } = await notify();
    sent.length = 0;
    await q("delete from portal_notifications where client_id = $1::uuid", [A.id]);
    const first = await scanPortalNotifications(new Date());
    const ready = sent.filter((m) => m.subject === "Tu producto está listo | Laboratorio Genus" && m.to === EMAIL_A);
    expect(ready.length).toBeGreaterThanOrEqual(1);
    expect(ready.some((m) => m.text.includes("CREMA A2") && m.text.includes("5.000"))).toBe(true);
    const countBefore = sent.length;
    const second = await scanPortalNotifications(new Date());
    expect(sent.length).toBe(countBefore);
    expect(second.readyNotified).toBe(0);
    expect(first.readyNotified).toBeGreaterThanOrEqual(1);
    expect((await q("select dedupe_key from portal_notifications where client_id = $1::uuid and kind = 'LISTO_PARA_ENTREGAR'", [A.id])).length).toBe(first.readyNotified + first.readySilenced);
    // Aislamiento de avisos: B no recibió nada de A.
    expect(sent.some((m) => m.to === EMAIL_B && m.text.includes("CREMA A2"))).toBe(false);
  });

  it("producto que ya estaba listo hace días (más de 48 h): queda registrado en silencio, sin correo", async () => {
    const { scanPortalNotifications } = await notify();
    await q("update work_items set completed_at = now() - interval '10 days' where id = $1", [ids.a2env]);
    await q("delete from portal_notifications where client_id = $1::uuid", [A.id]);
    await q("delete from portal_email_outbox where client_id = $1::uuid and kind = 'LISTO_PARA_ENTREGAR'", [A.id]);
    sent.length = 0;
    const s = await scanPortalNotifications(new Date());
    expect(s.readySilenced).toBeGreaterThanOrEqual(1);
    expect(sent.filter((m) => m.text.includes("CREMA A2"))).toHaveLength(0);
  });

  // ───────────────────────── Administración ─────────────────────────
  it("administración: solo Producción/Dirección; un nombre pertenece a un solo cliente; el código es único y estable", async () => {
    const adm = await admin();
    await expect(adm.listClients({ email: "x@y.z", sector: "ENVASADO_MASIVO" })).rejects.toMatchObject({ status: 403 });
    await expect(adm.addClientAlias(prod, A.id, NAME_B)).rejects.toMatchObject({ status: 409, code: "ALIAS_TAKEN" });
    const clients = await adm.listClients(prod);
    const codes = clients.map((c) => c.publicCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(clients.find((c) => c.id === A.id)!.publicCode).toBe(A.code);
    const problems = await adm.linkingProblems(prod);
    expect(Array.isArray(problems.unmappedClients)).toBe(true);
    const prev = await adm.previewClient(prod, A.id);
    expect(prev.products.length).toBeGreaterThan(0);
    await expect(adm.setClientStatus(prod, A.id, "SUSPENDIDO", "")).rejects.toMatchObject({ status: 400 });
  });

  it("dar de baja un correo cierra sus sesiones al instante", async () => {
    const { resolvePortalSession } = await auth();
    const adm = await admin();
    await q("update portal_rate_limits set hits = 0");
    await q("update portal_login_challenges set created_at = created_at - interval '1 minute' where client_id = $1::uuid", [A.id]);
    const l = await login(A.code, EMAIL_A, "198.51.100.50");
    const v = await l.verify(l.otp!);
    if (!v.ok) throw new Error("login");
    await adm.removeClientEmail(prod, A.id, EMAIL_A);
    expect(await resolvePortalSession(v.token)).toBeNull();
    await adm.addClientEmail(prod, A.id, EMAIL_A);
  });
});
