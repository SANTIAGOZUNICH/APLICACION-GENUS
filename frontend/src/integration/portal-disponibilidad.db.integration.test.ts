/**
 * «Listo para entregar» (disponibilidad EXPLÍCITA) contra un Postgres de PRUEBA real: quién puede marcar (último sector),
 * cantidades y entregas parciales, idempotencia y concurrencia, rectificación, actualización del Portal de Clientes,
 * avisos sin duplicados y que nada del circuito operativo (entregas, stock, movimientos) cambie. NO envía correos.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = randomUUID().slice(0, 6).toUpperCase();
const CLIENT = `IT DISP ${RUN}`;
const EMAIL = `disp-${RUN.toLowerCase()}@cliente.test`;
const actor = (sector: string, who = sector.toLowerCase()) => ({ email: `${who}-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector, displayName: `IT ${sector}` });
const masivo = actor("ENVASADO_MASIVO");
const premium = actor("ENVASADO_PREMIUM");
const codificado = actor("CODIFICADO");
const elaboracion = actor("ELABORACION");
const produccion = actor("PRODUCCION");
const direccion = actor("DIRECCION");
const deposito = actor("DEPOSITO");
const key = () => `it-${randomUUID()}`;

describe.skipIf(Boolean(PROBLEM))(`Listo para entregar (disponibilidad explícita) en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let planning: import("@/lib/planning/planning-service").PlanningService;
  let weekId = "";
  let clientId = "";
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const svc = () => import("@/lib/portal/availability-service");
  const data = () => import("@/lib/portal/data-service");
  const notify = () => import("@/lib/portal/notify-service");

  async function mkWork(product: string, sector: string, over: { status?: string; qty?: string; finished?: string | null; completedAt?: string | null; pedido?: boolean } = {}) {
    const it = await planning.createItem(weekId, { plannedDate: "2039-02-08", client: CLIENT, product, plannedQuantity: over.qty ?? "5000", unit: "un", sector, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : sector === "CODIFICADO" ? {} : { line: "Línea 1" }) } as never, produccion as never);
    let pedidoId: string | null = null;
    if (over.pedido !== false) {
      const [p] = await q("insert into production_pedidos (op, producto, cliente, estado, created_by, created_by_sector) values ($1,$2,$3,'EN_PROCESO','IT','PRODUCCION') returning id::text as id", [`OP-${product.slice(0, 6).toUpperCase().replace(/\W/g, "")}-${RUN}`, product, CLIENT]);
      pedidoId = String(p!.id);
    }
    await q("update work_items set operational_status = $2, finished_qty = $3, completed_at = $4::timestamptz, production_pedido_id = $5::uuid where id = $1", [it.id, over.status ?? "en_curso", over.finished ?? null, over.completedAt ?? null, pedidoId]);
    return it.id;
  }
  /** Entrega REAL por el circuito existente (registro de entrega parcial/total). */
  async function deliverReal(workItemId: string, quantity: number | null) {
    const { getDb } = await import("@/lib/db/client");
    const { recordDeliveryInTx } = await import("@/lib/planning/circuit/delivery-core");
    return getDb().transaction((tx) => recordDeliveryInTx(tx, { workItemId, actor: produccion, quantity, idempotencyKey: key() }));
  }
  const product = async (name: string) => (await (await data()).loadPortalOverview(clientId)).overview.products.find((p) => p.product === name)!;
  const fingerprint = async () =>
    JSON.stringify(await Promise.all([
      q("select id, operational_status, completed_at, planned_quantity, finished_qty, sector from work_items order by id"),
      q("select id, status, quantity from work_item_deliveries order by id"),
      q("select id, status, quantity from work_item_delivery_lines order by id"),
      q("select count(*)::int n, coalesce(sum(quantity),0)::float s from mp_stock_movements"),
      q("select codigo, stock_actual from mp_stock_balances order by codigo"),
      q("select count(*)::int n from os_notifications"),
    ]));
  const rejects = async (p: Promise<unknown>, status: number, code?: string) => {
    await expect(p).rejects.toMatchObject({ status, ...(code ? { code } : {}) });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-disp-secret-".padEnd(40, "x");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    planning = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2039-02-07";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT disponibilidad" }, produccion as never));
    weekId = week.id;
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(async (m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { status: "ENVIADO", provider: "test", providerMessageId: "it" };
    });
    const adm = await import("@/lib/portal/admin-service");
    const c = await adm.createClient({ email: produccion.email, sector: "PRODUCCION" }, { displayName: CLIENT, aliases: [CLIENT], emails: [EMAIL] });
    clientId = c.id;
  }, 120_000);

  afterAll(async () => {
    const { setEmailTransportForTests } = await import("@/lib/portal/email");
    setEmailTransportForTests(null);
    await pool?.end();
  });

  // ───────────────────────── Quién puede marcar ─────────────────────────
  it("1 · Envasado Masivo como último sector: marca, el portal pasa a «Listo para entregar» con el mensaje oficial", async () => {
    const w = await mkWork("MASIVO LISTO", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    expect((await s.getAvailabilityState(masivo, w)).canMark).toBe(true);
    // Antes de confirmar NO es «Listo»: terminado no alcanza.
    expect(await product("MASIVO LISTO")).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" });
    const r = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    expect(r).toMatchObject({ replayed: false, quantity: 5000 });
    const p = await product("MASIVO LISTO");
    expect(p).toMatchObject({ stage: "LISTO", stageLabel: "Listo para entregar", message: "¡Tu producto está listo! Podés coordinar la entrega con nuestro equipo." });
    expect(p.quantities).toMatchObject({ requested: 5000, available: 5000, delivered: 0, pending: 0 });
    expect(p.availableSince).toBeTruthy();
    expect(p.timeline.find((t) => t.stage === "LISTO")?.date).toBe(p.availableSince);
  });

  it("2 · Envasado Premium como último sector", async () => {
    const w = await mkWork("PREMIUM LISTO", "ENVASADO_PREMIUM", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 403, "FORBIDDEN_SECTOR"); // otro Envasado
    await s.markReadyForDelivery(premium, { workItemId: w, idempotencyKey: key() });
    expect((await product("PREMIUM LISTO")).stage).toBe("LISTO");
  });

  it("3 · Envasado envía a Codificado: Envasado YA NO puede marcarlo; el portal sigue «en finalización»", async () => {
    const w = await mkWork("A CODIFICADO", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    expect((await s.getAvailabilityState(masivo, w)).canMark).toBe(true); // todavía es de Envasado
    // Envío a Codificado: MISMO trabajo, sector CODIFICADO, en curso (sin línea).
    await q("update work_items set sector = 'CODIFICADO', line = null, via_codificado = true, sent_to_codificado_at = now(), operational_status = 'en_curso', completed_at = null where id = $1", [w]);
    const st = await s.getAvailabilityState(masivo, w);
    expect(st.canMark).toBe(false);
    expect(st.code).toBe("FORBIDDEN_SECTOR");
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 403, "FORBIDDEN_SECTOR");
    await rejects(s.markReadyForDelivery(premium, { workItemId: w, idempotencyKey: key() }), 403, "FORBIDDEN_SECTOR");
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1", [w])).toHaveLength(0);
    expect(await product("A CODIFICADO")).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" });
  });

  it("4 · Codificado como último sector: cuando termina, Codificado marca y el portal pasa a «Listo»", async () => {
    const w = await mkWork("COD FINAL", "CODIFICADO", { status: "en_curso" });
    const s = await svc();
    await rejects(s.markReadyForDelivery(codificado, { workItemId: w, idempotencyKey: key() }), 409, "SIN_CANTIDAD_TERMINADA"); // todavía incompleto
    await q("update work_items set via_codificado = true, sent_to_codificado_at = now(), operational_status = 'revision', completed_at = now() where id = $1", [w]);
    expect(await product("COD FINAL")).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" }); // terminado, sin confirmar
    await s.markReadyForDelivery(codificado, { workItemId: w, idempotencyKey: key() });
    expect((await product("COD FINAL")).stage).toBe("LISTO");
  });

  it("5 · sector no autorizado, ids manipulados y trabajos inexistentes: rechazados en el servidor", async () => {
    const w = await mkWork("AJENO", "ENVASADO_PREMIUM", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    for (const a of [elaboracion, produccion, direccion, deposito, actor("CALIDAD"), actor("MATERIA_PRIMA"), masivo, codificado]) {
      await rejects(s.markReadyForDelivery(a, { workItemId: w, idempotencyKey: key() }), 403, "FORBIDDEN_SECTOR");
    }
    await rejects(s.markReadyForDelivery(premium, { workItemId: "no-es-un-uuid", idempotencyKey: key() }), 400, "BAD_WORK");
    await rejects(s.markReadyForDelivery(premium, { workItemId: randomUUID(), idempotencyKey: key() }), 404, "NOT_FOUND");
    await rejects(s.markReadyForDelivery(premium, { workItemId: w }), 400, "NO_KEY");
    await rejects(s.retractAvailability(masivo, { markId: randomUUID(), reason: "x x x" }), 404);
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1", [w])).toHaveLength(0);
    // Elaboración nunca es el último sector
    const e = await mkWork("ELAB NO", "ELABORACION", { status: "revision" });
    await rejects(s.markReadyForDelivery(elaboracion, { workItemId: e, idempotencyKey: key() }), 403, "FORBIDDEN_SECTOR");
  });

  it("6 · trabajo todavía incompleto o sin cantidad verificable: no se puede marcar", async () => {
    const s = await svc();
    const pend = await mkWork("INCOMPLETO", "ENVASADO_MASIVO", { status: "pendiente" });
    const curso = await mkWork("EN CURSO SIN AVANCE", "ENVASADO_MASIVO", { status: "en_curso" });
    const cero = await mkWork("EN CURSO CERO", "ENVASADO_MASIVO", { status: "en_curso", finished: "0" });
    for (const w of [pend, curso, cero]) {
      const st = await s.getAvailabilityState(masivo, w);
      expect(st).toMatchObject({ canMark: false, code: "SIN_CANTIDAD_TERMINADA", maxQuantity: 0 });
      await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 409, "SIN_CANTIDAD_TERMINADA");
    }
    const cancel = await mkWork("CANCELADO", "ENVASADO_MASIVO", { status: "revision" });
    await q("update work_items set operational_status = 'cancelado', operational_cancelled_at = now() where id = $1", [cancel]);
    await rejects(s.markReadyForDelivery(masivo, { workItemId: cancel, idempotencyKey: key() }), 409, "CANCELADO");
  });

  it("7 · confirmación válida: marca con usuario, sector, cantidad y auditoría con valores anteriores y nuevos", async () => {
    const w = await mkWork("AUDITADO", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const r = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    const [m] = await q("select quantity, sector, marked_by, client_name, product, order_ref from portal_availability_marks where id = $1::uuid", [r.markId]);
    expect(m).toMatchObject({ quantity: 5000, sector: "ENVASADO_MASIVO", marked_by: masivo.email, client_name: CLIENT, product: "AUDITADO" });
    expect(String(m!.order_ref)).toMatch(/^OP-/);
    const [a] = await q("select action, actor, actor_sector, quantity, before_state, after_state from portal_availability_audit where mark_id = $1::uuid", [r.markId]);
    expect(a).toMatchObject({ action: "MARCAR", actor: masivo.email, actor_sector: "ENVASADO_MASIVO", quantity: 5000 });
    expect(a!.before_state).toMatchObject({ marked: 0, available: 0 });
    expect(a!.after_state).toMatchObject({ marked: 5000, available: 5000 });
  });

  it("8 · confirmación duplicada (doble clic) no duplica; otra clave sin nada pendiente se rechaza", async () => {
    const w = await mkWork("DOBLE CLIC", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const k = key();
    const first = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: k });
    const again = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: k });
    expect(again).toMatchObject({ replayed: true, markId: first.markId });
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1", [w])).toHaveLength(1);
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 409, "NADA_PENDIENTE_DE_MARCAR");
    expect((await product("DOBLE CLIC")).quantities.available).toBe(5000);
    // la clave de otra operación no se reutiliza en otro trabajo
    const other = await mkWork("OTRA CLAVE", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    await rejects(s.markReadyForDelivery(masivo, { workItemId: other, idempotencyKey: k }), 409, "KEY_REUSED");
  });

  // ───────────────────────── Cantidades parciales ─────────────────────────
  it("9 · disponibilidad parcial: 2.000 de 5.000 → el pedido NO figura como listo; se ve disponible y pendiente; no se supera lo terminado", async () => {
    const w = await mkWork("PARCIAL", "ENVASADO_MASIVO", { status: "en_curso", finished: "2000" });
    const s = await svc();
    expect(await s.getAvailabilityState(masivo, w)).toMatchObject({ canMark: true, maxQuantity: 2000, produced: 2000 });
    for (const bad of [2001, 0, -1, 1.5, "x", NaN]) await rejects(s.markReadyForDelivery(masivo, { workItemId: w, quantity: bad, idempotencyKey: key() }), bad === 2001 ? 409 : 400);
    await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 2000, idempotencyKey: key() });
    const p = await product("PARCIAL");
    expect(p.stage).toBe("ENVASADO");
    expect(p.quantities).toMatchObject({ requested: 5000, available: 2000, delivered: 0, pending: 3000 });
    expect(p.message).toBe("Una parte de tu pedido ya está lista para entregar; el resto sigue en proceso.");
    expect((await (await data()).loadPortalOverview(clientId)).overview.summary.listos).toBeGreaterThanOrEqual(0);
    // sin avance nuevo no se puede marcar de nuevo (no duplica las 2.000)
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 409, "NADA_PENDIENTE_DE_MARCAR");
    expect((await s.getAvailabilityState(masivo, w)).canMark).toBe(false);
  });

  it("10 · nueva disponibilidad sobre el mismo pedido: se marcan las 3.000 nuevas sin duplicar las primeras 2.000", async () => {
    const w = await mkWork("NUEVA DISP", "ENVASADO_MASIVO", { status: "en_curso", finished: "2000" });
    const s = await svc();
    await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 2000, idempotencyKey: key() });
    // el sector termina el resto
    await q("update work_items set finished_qty = '5000', operational_status = 'revision', completed_at = now() where id = $1", [w]);
    const st = await s.getAvailabilityState(masivo, w);
    expect(st).toMatchObject({ canMark: true, maxQuantity: 3000, marked: 2000, available: 2000 });
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, quantity: 3001, idempotencyKey: key() }), 409, "EXCEEDS");
    await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    const p = await product("NUEVA DISP");
    expect(p.stage).toBe("LISTO");
    expect(p.quantities).toMatchObject({ available: 5000, pending: 0 });
    expect(await q("select quantity from portal_availability_marks where work_item_id = $1 order by marked_at", [w])).toEqual([{ quantity: 2000 }, { quantity: 3000 }]);
  });

  it("11 · entrega parcial posterior (circuito real): la disponibilidad restante es coherente y no se duplica", async () => {
    const w = await mkWork("ENTREGA PARCIAL", "ENVASADO_MASIVO", { status: "revision", finished: "5000", completedAt: new Date().toISOString() });
    const s = await svc();
    await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    const r = await deliverReal(w, 2000);
    expect(r.complete).toBe(false);
    const p = await product("ENTREGA PARCIAL");
    expect(p.stage).toBe("LISTO");
    expect(p.quantities).toMatchObject({ requested: 5000, delivered: 2000, available: 3000, pending: 0 });
    expect(p.partialDelivery).toBe(true);
    expect(await s.getAvailabilityState(masivo, w)).toMatchObject({ marked: 5000, delivered: 2000, available: 3000, canMark: false });
  });

  it("11b · entregas ANTERIORES a la confirmación (histórico) no restan disponibilidad", async () => {
    const w = await mkWork("HISTORICO", "ENVASADO_MASIVO", { status: "revision", finished: "5000", completedAt: new Date().toISOString() });
    await deliverReal(w, 2000); // entrega previa, sin confirmación de disponibilidad
    const s = await svc();
    expect(await s.getAvailabilityState(masivo, w)).toMatchObject({ maxQuantity: 3000, available: 0 });
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, quantity: 3001, idempotencyKey: key() }), 409, "EXCEEDS");
    await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    const p = await product("HISTORICO");
    expect(p.quantities).toMatchObject({ requested: 5000, delivered: 2000, available: 3000, pending: 0 });
    expect(p.stage).toBe("LISTO");
  });

  it("12 · entrega total posterior: pasa a Entregado y ya no se puede marcar; las marcas quedan como historia", async () => {
    const w = await mkWork("ENTREGA TOTAL", "ENVASADO_MASIVO", { status: "revision", finished: "5000", completedAt: new Date().toISOString() });
    const s = await svc();
    await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    await deliverReal(w, 2000);
    const done = await deliverReal(w, null); // el saldo
    expect(done.complete).toBe(true);
    expect((await product("ENTREGA TOTAL")).stage).toBe("ENTREGADO");
    await rejects(s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }), 409, "ENTREGADO");
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1 and retracted_at is null", [w])).toHaveLength(1);
  });

  // ───────────────────────── Rectificación ─────────────────────────
  it("13 · rectificación antes de la entrega: retira la disponibilidad, queda auditada y el portal vuelve a «finalización»", async () => {
    const w = await mkWork("RECTIFICA", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const m = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    expect((await product("RECTIFICA")).stage).toBe("LISTO");
    await rejects(s.retractAvailability(masivo, { markId: m.markId }), 400, "NO_REASON");
    await rejects(s.retractAvailability(deposito, { markId: m.markId, reason: "me equivoqué" }), 403);
    const r = await s.retractAvailability(masivo, { markId: m.markId, reason: "Se marcó el pedido equivocado" });
    expect(r.clientNotified).toBe(false);
    expect(await product("RECTIFICA")).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION" });
    const [row] = await q("select retracted_at, retracted_by, retracted_by_sector, retract_reason, quantity from portal_availability_marks where id = $1::uuid", [m.markId]);
    expect(row).toMatchObject({ retracted_by: masivo.email, retracted_by_sector: "ENVASADO_MASIVO", retract_reason: "Se marcó el pedido equivocado", quantity: 5000 });
    expect(row!.retracted_at).toBeTruthy();
    const audit = await q("select action, before_state, after_state, note from portal_availability_audit where mark_id = $1::uuid order by created_at", [m.markId]);
    expect(audit.map((x) => x.action)).toEqual(["MARCAR", "RETIRAR"]);
    expect(audit[1]!.before_state).toMatchObject({ marked: 5000, available: 5000 });
    expect(audit[1]!.after_state).toMatchObject({ marked: 0, available: 0 });
    await rejects(s.retractAvailability(masivo, { markId: m.markId, reason: "otra vez" }), 409, "ALREADY_RETRACTED");
    // Producción también puede rectificar (supervisión); se puede volver a marcar después
    const m2 = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    await s.retractAvailability(produccion, { markId: m2.markId, reason: "Revisión de Producción" });
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1", [w])).toHaveLength(2); // nada se borra
  });

  it("13b · si el cliente ya fue avisado, la rectificación no es silenciosa: corrección visible + incidencia, sin correo nuevo", async () => {
    const w = await mkWork("AVISADO", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const n = await notify();
    const m = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    sent.length = 0;
    await n.scanPortalNotifications();
    expect(sent.filter((x) => x.to === EMAIL && x.text.includes("AVISADO"))).toHaveLength(1);
    const before = sent.length;
    const r = await s.retractAvailability(masivo, { markId: m.markId, reason: "Faltan cajas por contar" });
    expect(r.clientNotified).toBe(true);
    const notes = await (await data()).listNotifications(clientId, 50);
    expect(notes.some((x) => x.kind === "DISPONIBILIDAD_CORREGIDA" && x.body.includes("AVISADO"))).toBe(true);
    expect(await q("select 1 from portal_audit_events where client_id = $1::uuid and event_type = 'DISPONIBILIDAD_RETIRADA_CLIENTE_AVISADO'", [clientId])).not.toHaveLength(0);
    await n.scanPortalNotifications();
    expect(sent.length).toBe(before); // ni la corrección ni el reescaneo mandan correos
  });

  it("14 · no se puede rectificar disponibilidad ya entregada, ni se altera la entrega registrada", async () => {
    const w = await mkWork("YA ENTREGADO", "ENVASADO_MASIVO", { status: "revision", finished: "5000", completedAt: new Date().toISOString() });
    const s = await svc();
    const m = await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 2000, idempotencyKey: key() });
    await deliverReal(w, 2000);
    const before = JSON.stringify(await q("select id, status, quantity, actual_delivered_at from work_item_delivery_lines where work_item_id = $1 order by id", [w]));
    await rejects(s.retractAvailability(masivo, { markId: m.markId, reason: "me arrepentí" }), 409, "DELIVERED");
    await rejects(s.retractAvailability(produccion, { markId: m.markId, reason: "intento de Producción" }), 409, "DELIVERED");
    expect(JSON.stringify(await q("select id, status, quantity, actual_delivered_at from work_item_delivery_lines where work_item_id = $1 order by id", [w]))).toBe(before);
    const st = await s.getAvailabilityState(masivo, w);
    expect(st.marks[0]).toMatchObject({ canRetract: false });
    expect(st.marks[0]!.retractBlockedReason).toMatch(/entregas registradas/);
    expect(await q("select 1 from portal_availability_marks where id = $1::uuid and retracted_at is null", [m.markId])).toHaveLength(1);
  });

  it("14b · con dos marcas y una entrega parcial: la marca entregada NO se retira, la nueva SÍ (lo entregado consume primero la más antigua)", async () => {
    const w = await mkWork("DOS MARCAS", "ENVASADO_MASIVO", { status: "en_curso", finished: "2000" });
    const s = await svc();
    const m1 = await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 2000, idempotencyKey: key() });
    await q("update work_items set finished_qty = '5000', operational_status = 'revision', completed_at = now() where id = $1", [w]);
    const m2 = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    await deliverReal(w, 2000);
    await rejects(s.retractAvailability(masivo, { markId: m1.markId, reason: "intento sobre lo entregado" }), 409, "DELIVERED");
    const r = await s.retractAvailability(masivo, { markId: m2.markId, reason: "Las 3.000 no estaban terminadas" });
    expect(r.state).toMatchObject({ marked: 2000, delivered: 2000, available: 0 });
    expect(await product("DOS MARCAS")).toMatchObject({ stage: "ENVASADO" });
  });

  // ───────────────────────── Concurrencia ─────────────────────────
  it("15 · dos usuarios confirmando a la vez: una sola confirmación gana, sin superar lo terminado", async () => {
    const w = await mkWork("CONCURRENTE", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const other = actor("ENVASADO_MASIVO", "otro-usuario");
    const results = await Promise.allSettled([
      s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }),
      s.markReadyForDelivery(other, { workItemId: w, idempotencyKey: key() }),
      s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && (r.reason as { status?: number }).status === 409)).toHaveLength(2);
    const rows = await q("select quantity from portal_availability_marks where work_item_id = $1", [w]);
    expect(rows).toEqual([{ quantity: 5000 }]);
    // misma clave en paralelo: una sola marca
    const w2 = await mkWork("CONCURRENTE MISMA CLAVE", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const k = key();
    const same = await Promise.all([s.markReadyForDelivery(masivo, { workItemId: w2, idempotencyKey: k }), s.markReadyForDelivery(masivo, { workItemId: w2, idempotencyKey: k })]);
    expect(same.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await q("select 1 from portal_availability_marks where work_item_id = $1", [w2])).toHaveLength(1);
    // dos parciales simultáneos que juntos superan lo terminado: el total nunca pasa de 2.000
    const w3 = await mkWork("CONCURRENTE PARCIALES", "ENVASADO_MASIVO", { status: "en_curso", finished: "2000" });
    const par = await Promise.allSettled([
      s.markReadyForDelivery(masivo, { workItemId: w3, quantity: 1500, idempotencyKey: key() }),
      s.markReadyForDelivery(other, { workItemId: w3, quantity: 1500, idempotencyKey: key() }),
    ]);
    expect(par.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = (await q("select coalesce(sum(quantity),0)::float as t from portal_availability_marks where work_item_id = $1", [w3]))[0]!.t as number;
    expect(total).toBeLessThanOrEqual(2000);
  });

  // ───────────────────────── Avisos ─────────────────────────
  it("16/17 · el aviso «listo» sale SOLO por la confirmación explícita, una vez por marca; lo terminado sin confirmar no avisa", async () => {
    const n = await notify();
    const s = await svc();
    await q("delete from portal_notifications where client_id = $1::uuid", [clientId]);
    await q("delete from portal_email_outbox where client_id = $1::uuid", [clientId]);
    sent.length = 0;
    // trabajos TERMINADOS históricos sin confirmar: no generan avisos
    const hist = await mkWork("HISTORICO SIN MARCA", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date(Date.now() - 86_400_000).toISOString() });
    const first = await n.scanPortalNotifications();
    expect(sent.some((m) => m.text.includes("HISTORICO SIN MARCA"))).toBe(false);
    expect(await q("select 1 from portal_notifications where client_id = $1::uuid and payload::text like '%HISTORICO%'", [clientId])).toHaveLength(0);
    expect(first.readyNotified).toBeGreaterThanOrEqual(0);
    // confirmación explícita → un aviso con producto y cantidad realmente disponible
    const w = await mkWork("AVISO UNICO", "ENVASADO_MASIVO", { status: "en_curso", finished: "2000" });
    await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 1200, idempotencyKey: key() });
    sent.length = 0;
    await n.scanPortalNotifications();
    await n.scanPortalNotifications();
    const mine = sent.filter((m) => m.to === EMAIL && m.text.includes("AVISO UNICO"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe("Tu producto está listo | Laboratorio Genus");
    expect(mine[0]!.text).toMatch(/1\.200/);
    // nueva disponibilidad → aviso NUEVO solo por esa cantidad
    await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 800, idempotencyKey: key() });
    sent.length = 0;
    await n.scanPortalNotifications();
    await n.scanPortalNotifications();
    const more = sent.filter((m) => m.to === EMAIL && m.text.includes("AVISO UNICO"));
    expect(more).toHaveLength(1);
    expect(more[0]!.text).toMatch(/Cantidad disponible: 800/);
    expect(more[0]!.text).not.toMatch(/1\.200/);
    // el cierre del trabajo (sin tocar la confirmación) tampoco avisa
    await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = '5000' where id = $1", [w]);
    sent.length = 0;
    await n.scanPortalNotifications();
    expect(sent.filter((m) => m.text.includes("AVISO UNICO"))).toHaveLength(0);
    void hist;
  });

  it("marca vieja (más de 48 h): queda registrada en silencio, sin correo", async () => {
    const n = await notify();
    const s = await svc();
    const w = await mkWork("MARCA VIEJA", "ENVASADO_MASIVO", { status: "revision", completedAt: new Date().toISOString() });
    const m = await s.markReadyForDelivery(masivo, { workItemId: w, idempotencyKey: key() });
    await q("update portal_availability_marks set marked_at = now() - interval '10 days' where id = $1::uuid", [m.markId]);
    sent.length = 0;
    const r = await n.scanPortalNotifications();
    expect(r.readySilenced).toBeGreaterThanOrEqual(1);
    expect(sent.filter((x) => x.text.includes("MARCA VIEJA"))).toHaveLength(0);
  });

  // ───────────────────────── Integridad ─────────────────────────
  it("18 · marcar, rectificar y leer NO cambian entregas, líneas, stock, movimientos, consumos ni estados", async () => {
    const w = await mkWork("INTEGRIDAD", "ENVASADO_MASIVO", { status: "revision", finished: "5000", completedAt: new Date().toISOString() });
    const s = await svc();
    const before = await fingerprint();
    const m = await s.markReadyForDelivery(masivo, { workItemId: w, quantity: 3000, idempotencyKey: key() });
    await s.getAvailabilityState(masivo, w);
    await (await data()).loadPortalOverview(clientId);
    await s.retractAvailability(masivo, { markId: m.markId, reason: "prueba de integridad" });
    expect(await fingerprint()).toBe(before);
  });

  it("el estado devuelto al usuario no expone datos ajenos y respeta el sector del usuario", async () => {
    const w = await mkWork("ESTADO", "ENVASADO_PREMIUM", { status: "revision", completedAt: new Date().toISOString() });
    const s = await svc();
    const asOther = await s.getAvailabilityState(masivo, w);
    expect(asOther).toMatchObject({ canMark: false, code: "FORBIDDEN_SECTOR", maxQuantity: 0 });
    const asOwner = await s.getAvailabilityState(premium, w);
    expect(asOwner).toMatchObject({ canMark: true, maxQuantity: 5000, client: CLIENT, product: "ESTADO" });
    expect(asOwner.orderRef).toMatch(/^OP-/);
  });
});
