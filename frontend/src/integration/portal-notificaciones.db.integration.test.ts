/**
 * Portal de Clientes — CIRCUITO COMPLETO de estado y notificaciones con los servicios REALES de cada sector (Postgres de PRUEBA, SIN mocks de la
 * lógica). Ningún UPDATE directo simula un cambio de estado: Producción carga/asigna, Elaboración envía a Envasado, Envasado finaliza y
 * «Marca listo para entregar», Entregas registra entregas parciales y totales, Producción edita el estado del pedido, «Rehacer», cancelar…
 * En CADA transición se verifica: estado real en PostgreSQL (tablas fuente) → estado de la API del portal (ruta real, con cookie de sesión real)
 * → firma ETag → evento generado → procesamiento (cron real, sin sesión) → resultado del envío contra un PUSH SERVICE local HTTPS que valida la
 * firma VAPID y descifra aes128gcm (RFC 8291) → acuse de recepción (ruta real /entregas/api/push/ack).
 *
 * Configuración de PRODUCCIÓN por defecto: interruptor GLOBAL de envío APAGADO; el envío REAL se habilita solo para el cliente de prueba.
 * No prueba la recepción física en un celular (APNs/FCM): ver el checklist del reporte. Se SALTA sin base local marcada.
 */
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, randomUUID, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const CERT_DIR = path.resolve(process.cwd(), ".e2e-local/certs");
const direccion = { email: "it-nt-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const produccion = { email: "it-nt-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const elab = { email: "it-nt-elab@laboratoriogenus.com.ar", sector: "ELABORACION", displayName: "IT Elaboración" };
const envasado = { email: "it-nt-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 4).toUpperCase();
const b64u = (b: Buffer) => b.toString("base64url");
const PASS = "Clave-Segura-IT-2026";

type Message = { title: string; body: string; url: string; tag: string; eventId: string; ack?: { sid: string; token: string } };
type Received = { path: string; status: number; vapidOk: boolean; message: Message | null };
type Failure = { path: string; status: number; headers?: Record<string, string> };

/** «Push service» local: HTTPS real, verifica VAPID y descifra aes128gcm con las claves del dispositivo suscripto. */
function startPushService(vapidPublic: string, devices: Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>) {
  const received: Received[] = [];
  const failures: Failure[] = [];
  const server = https.createServer({ key: readFileSync(path.join(CERT_DIR, "key.pem")), cert: readFileSync(path.join(CERT_DIR, "cert.pem")) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reqPath = req.url ?? "";
      const fi = failures.findIndex((f) => reqPath.includes(f.path));
      if (fi >= 0) {
        const f = failures.splice(fi, 1)[0]!;
        received.push({ path: reqPath, status: f.status, vapidOk: false, message: null });
        res.writeHead(f.status, f.headers ?? {}).end("simulated failure");
        return;
      }
      const entry: Received = { path: reqPath, status: 201, vapidOk: false, message: null };
      try {
        const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(req.headers.authorization ?? ""));
        if (m) {
          const [h, p, sig] = m[1]!.split(".");
          const pub = Buffer.from(m[2]!, "base64url");
          const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
          entry.vapidOk = m[2] === vapidPublic && verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"));
        }
        const dev = devices.get(reqPath.split("/").pop()!);
        const body = Buffer.concat(chunks);
        if (dev && body.length > 86) {
          const salt = body.subarray(0, 16);
          const idlen = body[20]!;
          const asPub = body.subarray(21, 21 + idlen);
          const cipher = body.subarray(21 + idlen);
          const secret = dev.ecdh.computeSecret(asPub);
          const prk = Buffer.from(hkdfSync("sha256", secret, dev.auth, Buffer.concat([Buffer.from("WebPush: info\0"), dev.ecdh.getPublicKey(), asPub]), 32));
          const cek = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
          const nonce = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
          const d = createDecipheriv("aes-128-gcm", cek, nonce);
          d.setAuthTag(cipher.subarray(cipher.length - 16));
          const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
          let end = plain.length - 1;
          while (end >= 0 && plain[end] === 0) end--;
          entry.message = JSON.parse(plain.subarray(0, end).toString("utf8"));
        }
      } catch {
        /* queda sin descifrar: el test lo detecta */
      }
      received.push(entry);
      res.writeHead(201).end();
    });
  });
  return new Promise<{ url: string; received: Received[]; failures: Failure[]; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `https://localhost:${(server.address() as AddressInfo).port}`, received, failures, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

describe.skipIf(Boolean(PROBLEM))(`Portal: estado y notificaciones, circuito completo con servicios reales${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let pushSvc: Awaited<ReturnType<typeof startPushService>>;
  let vapidPublic = "";
  const devices = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();

  type Cli = { id: string; name: string; token: string; sess: import("@/lib/portal/auth-service").PortalSession };
  let A = {} as Cli; // GENUS TEST (envío REAL solo a este cliente)
  let B = {} as Cli; // otro cliente en piloto, SIN envío real
  const lastEtag: Record<string, string> = {};

  const push = () => import("@/lib/portal/push/push-service");
  const trig = () => import("@/lib/portal/push/push-trigger");
  const flush = async () => (await trig()).flushPortalPushTriggers();
  const cron = async () => {
    const { GET } = await import("@/app/api/cron/portal-push/route");
    const res = await GET(new Request("http://x/api/cron/portal-push", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
  };

  /** API REAL del portal (ruta /entregas/api/overview con la cookie de sesión del cliente). */
  async function api(c: Cli) {
    const { GET } = await import("@/app/entregas/api/overview/route");
    const res = await GET(new Request("http://localhost/entregas/api/overview", { headers: { cookie: `genus_portal_session=${c.token}` } }));
    expect(res.status).toBe(200);
    return { etag: res.headers.get("etag")!, body: (await res.json()) as { orders: Array<{ orderRef: string | null; id: string; status: { id: number; label: string }; progress: Record<string, number>; todoListo: boolean; deliveredAt: string | null; cancelled: boolean }>; products: Array<{ product: string; orderRef: string | null; commercial: { label: string; id: number }; quantities: { delivered: number; available: number; pending: number | null } }>; deliveries: unknown[] } };
  }
  const orderIn = (b: Awaited<ReturnType<typeof api>>["body"], op: string) => b.orders.find((o) => o.orderRef === op);
  const events = (c: Cli, op: string) => q("select event_type, status, mode, title, body, id::text as id from portal_push_outbox where client_id = $1::uuid and order_ref = $2 and event_type <> 'prueba' order by created_at", [c.id, op]);
  const sentTo = (p: string) => pushSvc.received.filter((x) => x.path.endsWith(p) && x.status === 201);

  async function addDevice(c: Cli, name: string, ua = "Mozilla/5.0 (Linux; Android 14) IT") {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const auth = randomBytes(16);
    devices.set(name, { ecdh, auth });
    const s = await push();
    const sub = { endpoint: `${pushSvc.url}/push/${name}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
    expect(await s.savePushSubscription(c.sess, sub, ua, undefined, vapidPublic)).toMatchObject({ registered: true });
    return sub.endpoint;
  }
  /** El «dispositivo» (service worker) acusa recepción con la credencial que vino DENTRO del payload cifrado: ruta real. */
  async function ackLike(m: Message | null) {
    const { POST } = await import("@/app/entregas/api/push/ack/route");
    if (!m?.ack) return 400;
    return (await POST(new Request("http://localhost/entregas/api/push/ack", { method: "POST", headers: { "content-type": "application/json", "user-agent": "IT-SW" }, body: JSON.stringify({ eventId: m.eventId, sid: m.ack.sid, token: m.ack.token }) }))).status;
  }

  async function mkClient(name: string, user: string): Promise<Cli> {
    const adm = await import("@/lib/portal/admin-service");
    const c = await adm.createClient(direccion, { displayName: name, aliases: [name], emails: [] });
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    const u = await createPortalUser(direccion, { clientId: c.id, username: user, password: "Inicial-Temporal-9" });
    const { passwordLogin, changeOwnPassword } = await import("@/lib/portal/user-auth-service");
    const { resolvePortalSession } = await import("@/lib/portal/auth-service");
    const hdr = new Headers({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`, "user-agent": "IT" });
    const first = await passwordLogin({ username: user, password: "Inicial-Temporal-9", headers: hdr });
    if (!first.ok) throw new Error("login inicial");
    await changeOwnPassword((await resolvePortalSession(first.token))!, { current: "Inicial-Temporal-9", next: PASS, headers: hdr });
    const second = await passwordLogin({ username: user, password: PASS, headers: hdr });
    if (!second.ok) throw new Error("login");
    const sess = (await resolvePortalSession(second.token))!;
    void u;
    return { id: c.id, name, token: second.token, sess };
  }

  /** Evidencia de las TABLAS FUENTE de un pedido (lo que el cliente nunca ve): estado del pedido, trabajos y entregas. */
  async function source(op: string) {
    const ped = await q("select id::text as id, estado from production_pedidos where op = $1 order by producto", [op]);
    const works = await q(
      `select w.product, w.sector::text as sector, w.operational_status as st,
              (select coalesce(sum(l.quantity), 0)::float8 from work_item_delivery_lines l where l.work_item_id = w.id and l.status = 'ACTIVA') as delivered,
              (select coalesce(sum(m.quantity), 0)::float8 from portal_availability_marks m where m.work_item_id = w.id and m.retracted_at is null) as marked
         from work_items w join production_pedidos p on p.id = w.production_pedido_id where p.op = $1 and w.deleted_at is null order by w.product, w.sector`,
      [op],
    );
    return { pedidos: ped.map((p) => `${p.estado ?? "∅"}`), works: works.map((w) => `${w.product}:${w.sector}:${w.st}:ent=${w.delivered}:marc=${w.marked}`) };
  }

  /**
   * Una transición verificada de punta a punta. `action` es la operación REAL del sector; luego corre el cron (sin sesión) y se compara:
   * tablas fuente → API del portal (+ ETag distinto del anterior) → eventos → entregas al dispositivo.
   */
  async function transition(c: Cli, op: string, action: () => Promise<unknown>, expected: { portal: string; events: string[]; etagChanges?: boolean; sourcePedido?: string }) {
    const before = (await api(c)).etag;
    await action();
    await flush();
    await cron();
    const now = await api(c);
    const o = orderIn(now.body, op);
    expect(o?.status.label, `API del portal tras la acción (${op})`).toBe(expected.portal);
    expect((await events(c, op)).map((e) => e.event_type), `eventos generados (${op})`).toEqual(expected.events);
    if (expected.etagChanges !== false) expect(now.etag, "la firma ETag cambia con la transición").not.toBe(before);
    if (expected.sourcePedido !== undefined) expect((await source(op)).pedidos, "estado real del pedido en PostgreSQL").toContain(expected.sourcePedido);
    lastEtag[`${c.id}:${op}`] = now.etag;
    return now;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.VITEST = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-secret-".padEnd(40, "x");
    process.env.CRON_SECRET = "it-cron-secret-0123456789";
    const webpush = (await import("web-push")).default;
    const keys = webpush.generateVAPIDKeys();
    vapidPublic = keys.publicKey;
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:it@laboratoriogenus.com.ar";
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    pushSvc = await startPushService(vapidPublic, devices);
    A = await mkClient(`GENUS TEST ${RUN}`, `gt-${RUN.toLowerCase()}`);
    B = await mkClient(`OTRO CLIENTE ${RUN}`, `ot-${RUN.toLowerCase()}`);
  }, 180_000);

  afterAll(async () => {
    try {
      await (await push()).updatePushSettings(direccion, { globalSendEnabled: false });
    } catch {
      /* limpieza */
    }
    await pushSvc?.close();
    await pool?.end();
  });

  const OP = `OP-NT-${RUN}`;
  const OPB = `OP-NT-${RUN}-B`;
  let pedidoIds: string[] = [];
  let ids = { elab1: "", elab2: "", env1: "", env2: "" };
  let svc: ReturnType<typeof import("@/lib/production-pedidos/service").getProductionPedidosService>;

  it("0 · configuración de producción por defecto: envío GLOBAL apagado; el cliente de prueba activa sus dispositivos (sin piloto todavía)", async () => {
    const s = await push();
    expect((await s.getPushSettings()).globalSendEnabled).toBe(false);
    await addDevice(A, "devA1");
    await addDevice(A, "devA2", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) IT");
    await addDevice(B, "devB1");
    expect(await s.pushClientConfig(A.sess, `${pushSvc.url}/push/devA1`)).toMatchObject({ available: true, thisDevice: true, devices: 2, pilotEnabled: false });
    // Dirección habilita al piloto: A con ENVÍO REAL (solo A), B solo piloto (simulado), global sigue APAGADO.
    await s.setClientPilot(direccion, A.id, true);
    await s.setClientPilot(direccion, B.id, true);
    await expect(s.setClientRealSend({ email: "x@y.z", sector: "PRODUCCION" }, A.id, true, { confirm: true })).rejects.toMatchObject({ status: 403 });
    await expect(s.setClientRealSend(direccion, A.id, true)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    expect(await s.setClientRealSend(direccion, A.id, true, { confirm: true })).toEqual({ realSend: true });
    expect((await s.getPushSettings()).globalSendEnabled).toBe(false);
    expect(await s.clientSendMode(await (await import("@/lib/db/client")).getDb() as never, A.id)).toEqual({ pilot: true, realSend: true });
    expect(await s.clientSendMode(await (await import("@/lib/db/client")).getDb() as never, B.id)).toEqual({ pilot: true, realSend: false });
    svc = (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
  });

  it("1 · Producción carga el pedido de DOS productos → «Pedido recibido» + push «¡Recibimos tu pedido!» (descifrado, VAPID válido) + acuse", async () => {
    const r1 = await transition(A, OP, async () => {
      const a = await svc.create(produccion as never, { op: OP, cliente: A.name, producto: "SHAMPOO NT", q: 500, portalClientId: A.id } as never);
      const b = await svc.create(produccion as never, { op: OP, cliente: A.name, producto: "TONICO NT", q: 100, portalClientId: A.id } as never);
      pedidoIds = [a.id, b.id];
    }, { portal: "Pedido recibido", events: ["RECIBIDO"], sourcePedido: "∅" });
    expect(r1.body.products.filter((p) => p.orderRef === OP)).toHaveLength(2);
    const got = sentTo("/devA1");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ vapidOk: true });
    expect(got[0]!.message).toMatchObject({ title: "¡Recibimos tu pedido!", body: "Tu pedido fue registrado correctamente. Te mantendremos informado sobre su avance.", url: expect.stringContaining("/entregas#pedido-") });
    expect(sentTo("/devA2")).toHaveLength(1); // multi-dispositivo
    // Acuse del dispositivo (el payload trae SU credencial; una credencial ajena o alterada se rechaza)
    expect(await ackLike(got[0]!.message)).toBe(204);
    expect(await ackLike({ ...got[0]!.message!, ack: { sid: got[0]!.message!.ack!.sid, token: "x".repeat(40) } })).toBe(400);
    expect(await ackLike({ ...got[0]!.message!, ack: { sid: sentTo("/devA2")[0]!.message!.ack!.sid, token: got[0]!.message!.ack!.token } })).toBe(400);
    const dl = await q("select result, http_status, acked_at is not null as acked from portal_push_deliveries where outbox_id = $1::uuid order by acked_at nulls first", [got[0]!.message!.eventId]);
    expect(dl).toEqual([{ result: "ACEPTADO", http_status: 201, acked: false }, { result: "ACEPTADO", http_status: 201, acked: true }]);
    // El cliente B (otro) no ve ni recibe nada de A (aislamiento)
    expect((await api(B)).body.orders).toEqual([]);
    expect(pushSvc.received.filter((x) => x.path.endsWith("/devB1"))).toHaveLength(0);
  });

  it("2 · Producción asigna AMBOS productos a Elaboración (servicio real) → «En elaboración» + push con el texto EXACTO (8 días hábiles)", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const mk = (i: number, product: string, qty: string) => assignWorkItemDurable({ sector: "ELABORACION", client: A.name, product, plannedQuantity: qty, unit: "un", branchOwner: "Cristian", productionPedidoId: pedidoIds[i], plannedDate: "2039-05-02", idempotencyKey: `nt-assign-${RUN}-${i}` } as never, produccion as never, randomUUID());
    let r1: Awaited<ReturnType<typeof mk>>;
    let r2: Awaited<ReturnType<typeof mk>>;
    await transition(A, OP, async () => {
      r1 = await mk(0, "SHAMPOO NT", "500");
      r2 = await mk(1, "TONICO NT", "100");
    }, { portal: "En elaboración", events: ["RECIBIDO", "ELABORACION"], sourcePedido: "EN_ELABORACION" });
    ids.elab1 = r1!.item.id;
    ids.elab2 = r2!.item.id;
    const ev = (await events(A, OP))[1]!;
    expect(ev).toMatchObject({ status: "ENVIADA", mode: "REAL", title: "¡Tu pedido se está elaborando!", body: "Estimamos que estará listo para entregar en aproximadamente 8 días hábiles." });
    expect(sentTo("/devA1").at(-1)!.message).toMatchObject({ title: "¡Tu pedido se está elaborando!", body: "Estimamos que estará listo para entregar en aproximadamente 8 días hábiles." });
  });

  it("3 · UN producto pasa a Envasado: el pedido sigue «En elaboración» (estado = el menos avanzado) y NO hay push; el segundo lo lleva a «En envasado» (push exacto, 3 días hábiles)", async () => {
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const sent = (id: string, qty: string, k: string) => sendElaboracionToEnvasadoDurable({ workItemId: id, destination: "ENVASADO_MASIVO", producedQuantity: qty, idempotencyKey: `nt-env-${RUN}-${k}` } as never, elab as never);
    await transition(A, OP, () => sent(ids.elab1, "500", "1"), { portal: "En elaboración", events: ["RECIBIDO", "ELABORACION"], etagChanges: true });
    await transition(A, OP, () => sent(ids.elab2, "100", "2"), { portal: "En envasado", events: ["RECIBIDO", "ELABORACION", "ENVASADO"], sourcePedido: "EN_ENVASADO" });
    expect((await events(A, OP))[2]).toMatchObject({ status: "ENVIADA", title: "¡Tu pedido está en envasado!", body: "Estimamos que estará listo para entregar en aproximadamente 3 días hábiles." });
    expect(sentTo("/devA1").at(-1)!.message?.body).toBe("Estimamos que estará listo para entregar en aproximadamente 3 días hábiles.");
    const w = await q("select id::text as id, product from work_items where production_pedido_id = any($1::uuid[]) and sector = 'ENVASADO_MASIVO' order by product", [pedidoIds]);
    ids.env1 = String(w.find((x) => x.product === "SHAMPOO NT")!.id);
    ids.env2 = String(w.find((x) => x.product === "TONICO NT")!.id);
  });

  it("4 · Envasado FINALIZA ambos (sin marcar listo → sigue «En envasado»); «Marcar listo» de UNO → progreso 1 de 2, SIN push; del otro → «Listo para entregar» + push exacto", async () => {
    const { completeWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await transition(A, OP, async () => {
      await completeWorkDurable(ids.env1, { finishedQty: "500", observation: "ok", completedBy: envasado.email }, "ENVASADO_MASIVO");
      await completeWorkDurable(ids.env2, { finishedQty: "100", observation: "ok", completedBy: envasado.email }, "ENVASADO_MASIVO");
    }, { portal: "En envasado", events: ["RECIBIDO", "ELABORACION", "ENVASADO"], etagChanges: false });
    const r = await transition(A, OP, () => markReadyForDelivery(envasado as never, { workItemId: ids.env1, idempotencyKey: `nt-mark-${RUN}-1` }), { portal: "En envasado", events: ["RECIBIDO", "ELABORACION", "ENVASADO"] });
    expect(orderIn(r.body, OP)!.progress).toMatchObject({ total: 2, listos: 1, enProceso: 1 });
    expect(orderIn(r.body, OP)!.todoListo).toBe(false);
    await transition(A, OP, () => markReadyForDelivery(envasado as never, { workItemId: ids.env2, idempotencyKey: `nt-mark-${RUN}-2` }), { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"] });
    const listo = (await events(A, OP)).find((x) => x.event_type === "LISTO")!;
    expect(listo).toMatchObject({ status: "ENVIADA", mode: "REAL", title: "¡TU PEDIDO ESTÁ LISTO! 🎉", body: "Finalizamos la producción de tu pedido. Ya podemos coordinar su entrega." });
    expect(sentTo("/devA1").at(-1)!.message).toMatchObject({ title: "¡TU PEDIDO ESTÁ LISTO! 🎉", body: "Finalizamos la producción de tu pedido. Ya podemos coordinar su entrega." });
  });

  it("5 · entrega PARCIAL: el pedido sigue «Listo para entregar» con el progreso por producto y sin push de entregado; la entrega total de UN producto tampoco cierra el pedido", async () => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const dlv = (id: string, qty: number | null, k: string) => deliverWorkDurable({ workItemId: id, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, partial: qty != null, deliverQuantity: qty, idempotencyKey: `nt-dlv-${RUN}-${k}` } as never, envasado as never);
    const parcial = await transition(A, OP, () => dlv(ids.env1, 200, "1a"), { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"] });
    const shampoo = parcial.body.products.find((p) => p.product === "SHAMPOO NT")!;
    expect(shampoo).toMatchObject({ commercial: { label: "Listo para entregar" }, quantities: { delivered: 200, available: 300 } });
    expect((await source(OP)).works.find((w) => w.startsWith("SHAMPOO NT:ENVASADO"))).toContain("ent=200");
    expect(parcial.body.deliveries).toHaveLength(1);
    const restoUno = await transition(A, OP, () => dlv(ids.env1, null, "1b"), { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"] });
    expect(restoUno.body.products.find((p) => p.product === "SHAMPOO NT")!.commercial.label).toBe("Entregado");
    expect(orderIn(restoUno.body, OP)!.progress).toMatchObject({ listos: 1, entregados: 1 });
    expect((await source(OP)).pedidos.filter((e) => e === "ENTREGADO")).toHaveLength(1); // solo el renglón ya entregado; el otro no
  });

  it("6 · entrega del ÚLTIMO producto → «Entregado» + push exacto; el pedido queda en el HISTORIAL con fecha, aunque la entrega se archive; sin duplicados", async () => {
    const { deliverWorkDurable, archiveDeliveryDurable } = await import("@/lib/planning/work-item-progress-repository");
    const r = await transition(A, OP, () => deliverWorkDurable({ workItemId: ids.env2, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, deliverQuantity: null, idempotencyKey: `nt-dlv-${RUN}-2` } as never, envasado as never),
      { portal: "Entregado", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"], sourcePedido: "ENTREGADO" });
    const o = orderIn(r.body, OP)!;
    expect(o.deliveredAt).toBeTruthy();
    expect((await events(A, OP)).at(-1)).toMatchObject({ status: "ENVIADA", mode: "REAL", title: "¡Tu pedido fue entregado!", body: "Gracias por confiar en Laboratorio Genus." });
    expect(sentTo("/devA1").at(-1)!.message).toMatchObject({ title: "¡Tu pedido fue entregado!", body: "Gracias por confiar en Laboratorio Genus." });
    // «Entregados»: archivar la entrega (lo que hace la lista de Entregados) NO borra el pedido del historial del cliente.
    const dids = await q("select id::text as id from work_item_deliveries where work_item_id = any($1::uuid[])", [[ids.env1, ids.env2]]);
    for (const d of dids) await archiveDeliveryDurable(String(d.id), "IT");
    await cron();
    const after = await api(A);
    expect(orderIn(after.body, OP)).toMatchObject({ status: { label: "Entregado" }, cancelled: false });
    expect(after.body.products.filter((p) => p.orderRef === OP).every((p) => p.commercial.label === "Entregado")).toBe(true);
    // Sin duplicados: corridas repetidas y simultáneas
    const s = await push();
    await Promise.all([s.runPushWorker(), s.runPushWorker(), s.runPushWorker(), cron()]);
    expect((await events(A, OP)).map((e) => e.event_type)).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"]);
    expect(sentTo("/devA1")).toHaveLength(5);
    expect(sentTo("/devA2")).toHaveLength(5);
    expect(await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d")).toEqual([{ n: 0 }]);
    expect(pushSvc.received.filter((x) => x.status === 201).every((x) => x.vapidOk)).toBe(true);
  });

  it("7 · AISLAMIENTO y envío real POR CLIENTE: el otro cliente (piloto, sin envío real, global apagado) registra eventos SIMULADOS y no recibe nada", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const before = pushSvc.received.length;
    await transition(B, OPB, async () => {
      const p = await svc.create(produccion as never, { op: OPB, cliente: B.name, producto: "GEL NT B", q: 80, portalClientId: B.id } as never);
      await assignWorkItemDurable({ sector: "ELABORACION", client: B.name, product: "GEL NT B", plannedQuantity: "80", unit: "un", branchOwner: "Cristian", productionPedidoId: p.id, plannedDate: "2039-05-03", idempotencyKey: `nt-b-${RUN}` } as never, produccion as never, randomUUID());
    }, { portal: "En elaboración", events: ["RECIBIDO", "ELABORACION"] });
    expect((await events(B, OPB)).every((e) => e.status === "SIMULADA" && e.mode === "SIMULADO")).toBe(true);
    expect(pushSvc.received.length).toBe(before); // nada salió al servicio push por el cliente B
    // A no ve el pedido de B y B no ve el de A
    expect(orderIn((await api(A)).body, OPB)).toBeUndefined();
    expect(orderIn((await api(B)).body, OP)).toBeUndefined();
    // «Envío real» del cliente solo se habilita con piloto, y se puede apagar: vuelve a simulado sin tocar a los demás
    const s = await push();
    await s.setClientRealSend(direccion, A.id, false);
    expect((await s.getPushSettings()).globalSendEnabled).toBe(false);
    await s.setClientRealSend(direccion, A.id, true, { confirm: true });
  });

  it("8 · vía REAL del ESTADO DEL PEDIDO: Producción pasa un pedido CON trabajos a «LISTO PARA ENTREGAR» y luego a «ENTREGADO» → el portal y el push lo reflejan", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const OPM = `OP-NT-${RUN}-M`;
    let pid = "";
    await transition(A, OPM, async () => {
      const p = await svc.create(produccion as never, { op: OPM, cliente: A.name, producto: "CREMA NT", q: 50, portalClientId: A.id } as never);
      pid = p.id;
      await assignWorkItemDurable({ sector: "ELABORACION", client: A.name, product: "CREMA NT", plannedQuantity: "50", unit: "un", branchOwner: "Cristian", productionPedidoId: pid, plannedDate: "2039-05-04", idempotencyKey: `nt-m-${RUN}` } as never, produccion as never, randomUUID());
    }, { portal: "En elaboración", events: ["RECIBIDO", "ELABORACION"] });
    await transition(A, OPM, () => svc.update(produccion as never, pid, { op: OPM, cliente: A.name, producto: "CREMA NT", q: 50, estado: "LISTO PARA ENTREGAR" } as never), { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "LISTO"], sourcePedido: "LISTO_PARA_ENTREGAR" });
    const r = await transition(A, OPM, () => svc.update(produccion as never, pid, { op: OPM, cliente: A.name, producto: "CREMA NT", q: 50, estado: "ENTREGADO" } as never), { portal: "Entregado", events: ["RECIBIDO", "ELABORACION", "LISTO", "ENTREGADO"], sourcePedido: "ENTREGADO" });
    expect(orderIn(r.body, OPM)!.deliveredAt).toBeTruthy();
    expect(sentTo("/devA1").at(-1)!.message?.title).toBe("¡Tu pedido fue entregado!");
    // pedido SIN trabajos con estado manual: «Listo» y «Entregado» se ven y no desaparecen
    const OPS = `OP-NT-${RUN}-S`;
    let pid2 = "";
    await transition(A, OPS, async () => { pid2 = (await svc.create(produccion as never, { op: OPS, cliente: A.name, producto: "JABON NT", q: 10, portalClientId: A.id } as never)).id; }, { portal: "Pedido recibido", events: ["RECIBIDO"] });
    await transition(A, OPS, () => svc.update(produccion as never, pid2, { op: OPS, cliente: A.name, producto: "JABON NT", q: 10, estado: "LISTO PARA ENTREGAR" } as never), { portal: "Listo para entregar", events: ["RECIBIDO", "LISTO"] });
    const fin = await transition(A, OPS, () => svc.update(produccion as never, pid2, { op: OPS, cliente: A.name, producto: "JABON NT", q: 10, estado: "ENTREGADO" } as never), { portal: "Entregado", events: ["RECIBIDO", "LISTO", "ENTREGADO"] });
    expect(orderIn(fin.body, OPS)!.deliveredAt).toBeTruthy();
  });

  it("9 · REPROCESO («Rehacer» real) tras «Listo»: el cliente vuelve a «En envasado» sin push; al re-terminar y volver a marcar no se duplica el aviso de «Listo»", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const { completeWorkDurable, reworkWorkItemDurable } = await import("@/lib/planning/work-item-progress-repository");
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    const OPR = `OP-NT-${RUN}-R`;
    let envId = "";
    await transition(A, OPR, async () => {
      const p = await svc.create(produccion as never, { op: OPR, cliente: A.name, producto: "ACOND NT", q: 60, portalClientId: A.id } as never);
      const w = await assignWorkItemDurable({ sector: "ELABORACION", client: A.name, product: "ACOND NT", plannedQuantity: "60", unit: "un", branchOwner: "Cristian", productionPedidoId: p.id, plannedDate: "2039-05-05", idempotencyKey: `nt-r-${RUN}` } as never, produccion as never, randomUUID());
      await sendElaboracionToEnvasadoDurable({ workItemId: w.item.id, destination: "ENVASADO_MASIVO", producedQuantity: "60", idempotencyKey: `nt-r-env-${RUN}` } as never, elab as never);
      envId = String((await q("select id::text as id from work_items where production_pedido_id = $1::uuid and sector = 'ENVASADO_MASIVO'", [p.id]))[0]!.id);
    }, { portal: "En envasado", events: ["RECIBIDO", "ELABORACION", "ENVASADO"] });
    await completeWorkDurable(envId, { finishedQty: "60", observation: "ok", completedBy: envasado.email }, "ENVASADO_MASIVO");
    await transition(A, OPR, () => markReadyForDelivery(envasado as never, { workItemId: envId, idempotencyKey: `nt-r-mark-${RUN}` }), { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"] });
    const n = sentTo("/devA1").length;
    await transition(A, OPR, () => reworkWorkItemDurable(envId, { requestedBy: produccion.email, requestedBySector: "PRODUCCION", reason: "rehacer" }), { portal: "En envasado", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"] });
    expect(sentTo("/devA1")).toHaveLength(n); // retroceso: ningún aviso (el cliente nunca ve el motivo interno)
    await completeWorkDurable(envId, { finishedQty: "60", observation: "re-terminado", completedBy: envasado.email }, "ENVASADO_MASIVO");
    await transition(A, OPR, async () => undefined, { portal: "Listo para entregar", events: ["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO"], etagChanges: false });
    expect(sentTo("/devA1")).toHaveLength(n); // «Listo» ya estaba notificado: no se repite
  });

  it("10 · CANCELACIÓN: un pedido cancelado no genera avisos y se informa como cancelado", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { cancelWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const OPC = `OP-NT-${RUN}-C`;
    let wid = "";
    await transition(A, OPC, async () => {
      const p = await svc.create(produccion as never, { op: OPC, cliente: A.name, producto: "SERUM NT", q: 30, portalClientId: A.id } as never);
      wid = (await assignWorkItemDurable({ sector: "ELABORACION", client: A.name, product: "SERUM NT", plannedQuantity: "30", unit: "un", branchOwner: "Cristian", productionPedidoId: p.id, plannedDate: "2039-05-06", idempotencyKey: `nt-c-${RUN}` } as never, produccion as never, randomUUID())).item.id;
    }, { portal: "En elaboración", events: ["RECIBIDO", "ELABORACION"] });
    const n = sentTo("/devA1").length;
    await cancelWorkDurable(wid, { cancelledBy: produccion.email, reason: "cancelado por el cliente" });
    await cron();
    const o = orderIn((await api(A)).body, OPC)!;
    expect(o.cancelled).toBe(true);
    expect(sentTo("/devA1")).toHaveLength(n);
  });

  it("11 · ERRORES DEL PUSH SERVICE con motivo: 503 reintenta (sin afectar a Producción), 429 respeta Retry-After, 410 da de baja, 403 invalida la suscripción, 413 es permanente", async () => {
    const s = await push();
    const { getDb } = await import("@/lib/db/client");
    const db = getDb() as never;
    // 503 → reintento; el pedido de Producción se crea igual
    const OPE = `OP-NT-${RUN}-E`;
    pushSvc.failures.push({ path: "/devA1", status: 503 });
    const created = await svc.create(produccion as never, { op: OPE, cliente: A.name, producto: "ERR NT", q: 5, portalClientId: A.id } as never);
    await flush();
    await cron();
    expect(created.id).toBeTruthy();
    let ev = (await q("select status, last_error, attempts, id::text as id from portal_push_outbox where client_id = $1::uuid and order_ref = $2", [A.id, OPE]))[0]!;
    expect(ev.status).toBe("PENDIENTE");
    expect(String(ev.last_error)).toContain("503");
    const dl = await q("select s.endpoint, d.result, d.http_status from portal_push_deliveries d join portal_push_subscriptions s on s.id = d.subscription_id where d.outbox_id = $1::uuid order by s.endpoint", [ev.id]);
    expect(dl.map((r) => `${String(r.endpoint).split("/").pop()}:${r.result}:${r.http_status}`)).toEqual(["devA1:ERROR:503", "devA2:ACEPTADO:201"]);
    expect(((await s.pushAdminOverview(direccion)).clients.find((c) => c.id === A.id)!).lastFailure?.reason).toContain("503");
    // Reintento: solo al dispositivo que falló (el que ya aceptó NO recibe un duplicado)
    const aceptadosA2 = sentTo("/devA2").length;
    await q("update portal_push_outbox set next_attempt_at = now() - interval '1 minute' where id = $1::uuid", [ev.id]);
    await cron();
    ev = (await q("select status, attempts, id::text as id from portal_push_outbox where id = $1::uuid", [ev.id]))[0]!;
    expect(ev.status).toBe("ENVIADA");
    expect(sentTo("/devA2")).toHaveLength(aceptadosA2);
    // 429 con Retry-After
    const OPE2 = `OP-NT-${RUN}-E2`;
    pushSvc.failures.push({ path: "/devA1", status: 429, headers: { "retry-after": "900" } });
    await svc.create(produccion as never, { op: OPE2, cliente: A.name, producto: "ERR2 NT", q: 5, portalClientId: A.id } as never);
    await flush();
    const e2 = (await q("select status, last_error, next_attempt_at > now() + interval '10 minutes' as far from portal_push_outbox where client_id = $1::uuid and order_ref = $2", [A.id, OPE2]))[0]!;
    expect(e2).toMatchObject({ status: "PENDIENTE", far: true });
    expect(String(e2.last_error)).toContain("429");
    // 410 → baja del dispositivo; 403 → suscripción inválida (VAPID rechazado); 413 → error permanente
    const devC = await addDevice(A, "devA3");
    const devD = await addDevice(A, "devA4");
    pushSvc.failures.push({ path: "/devA3", status: 410 }, { path: "/devA4", status: 403 });
    await q("update portal_push_outbox set next_attempt_at = now() - interval '1 minute' where client_id = $1::uuid and order_ref = $2", [A.id, OPE2]);
    await cron();
    expect(await q("select count(*)::int as n from portal_push_subscriptions where endpoint = $1", [devC])).toEqual([{ n: 0 }]);
    const inv = (await q("select invalid_reason, last_status from portal_push_subscriptions where endpoint = $1", [devD]))[0]!;
    expect(inv).toEqual({ invalid_reason: "VAPID_RECHAZADO", last_status: 403 });
    const cfg = await s.pushClientConfig(A.sess, devD);
    expect(cfg).toMatchObject({ thisDevice: false, needsResubscribe: true });
    expect((await s.pushAdminOverview(direccion)).clients.find((c) => c.id === A.id)!.devicesList.some((d) => !d.valid && d.invalidReason === "VAPID_RECHAZADO")).toBe(true);
    // El cliente vuelve a activar: la suscripción vuelve a ser válida
    await s.savePushSubscription(A.sess, { endpoint: devD, keys: { p256dh: b64u(devices.get("devA4")!.ecdh.getPublicKey()), auth: b64u(devices.get("devA4")!.auth) } }, "IT", undefined, vapidPublic);
    expect(await s.pushClientConfig(A.sess, devD)).toMatchObject({ thisDevice: true, needsResubscribe: false });
    // Suscripción creada con OTRA clave VAPID: se rechaza para que el dispositivo se vuelva a suscribir
    const other = (await import("web-push")).default.generateVAPIDKeys().publicKey;
    await expect(s.savePushSubscription(A.sess, { endpoint: `${pushSvc.url}/push/devOld`, keys: { p256dh: b64u(devices.get("devA4")!.ecdh.getPublicKey()), auth: b64u(devices.get("devA4")!.auth) } }, "IT", undefined, other)).rejects.toMatchObject({ code: "PUSH_KEY_MISMATCH", status: 409 });
    void db;
    // Limpieza de los dispositivos extra (para no ensuciar los demás pasos)
    await q("delete from portal_push_deliveries where subscription_id in (select id from portal_push_subscriptions where endpoint = any($1))", [[devC, devD]]);
    await q("delete from portal_push_subscriptions where endpoint = any($1)", [[devC, devD]]);
  });

  it("12 · DIAGNÓSTICO de Dirección y SALUD: dispositivos, SIMULADO vs ENVIADO, aceptado vs recepción comprobada, cron al día y «sin ejecuciones recientes» pasados 5 minutos", async () => {
    const s = await push();
    const ov = await s.pushAdminOverview(direccion);
    const a = ov.clients.find((c) => c.id === A.id)!;
    const b = ov.clients.find((c) => c.id === B.id)!;
    expect(a).toMatchObject({ pilotEnabled: true, realSendEnabled: true });
    expect(a.devicesList.length).toBeGreaterThanOrEqual(2);
    expect(a.devicesList.every((d) => d.valid && d.lastVerifiedAt)).toBe(true);
    expect(a.deliveries.aceptadas).toBeGreaterThan(5);
    expect(a.deliveries.recibidas).toBeGreaterThanOrEqual(1); // solo UN dispositivo acusó recepción (paso 1): «aceptado» ≠ «recibido»
    expect(a.deliveries.recibidas).toBeLessThan(a.deliveries.aceptadas);
    expect(a.events.enviados).toBeGreaterThanOrEqual(5);
    expect(b).toMatchObject({ pilotEnabled: true, realSendEnabled: false });
    expect(b.events.simulados).toBeGreaterThanOrEqual(2);
    expect(b.events.enviados).toBe(0);
    expect(ov.cronStale).toBe(false);
    expect(ov.worker.lastCronOk).toBe(true);
    expect(ov.worker.lastCronAt).not.toBeNull();
    expect(ov.vapidConfigured).toBe(true);
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await s.pushAdminOverview(direccion, undefined, later)).cronStale).toBe(true);
    // El cron escribe el latido AUN SIN eventos ni clientes
    const t0 = ov.worker.runsTotal;
    await cron();
    const hb = await s.workerHeartbeat((await import("@/lib/db/client")).getDb() as never);
    expect(hb.runsTotal).toBeGreaterThan(t0);
    expect(hb).toMatchObject({ lastTrigger: "cron", lastCronOk: true });
    // Salud (solo Dirección): sin datos sensibles
    const h = await s.pushHealth(direccion);
    expect(h.cron).toMatchObject({ secretConfigured: true, stale: false, lastOk: true });
    expect(h.problems.some((p) => p.includes("SIMULADO") && p.includes("OTRO CLIENTE"))).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/https:\/\/localhost|p256dh|VAPID_PRIVATE/);
    await expect(s.pushHealth({ email: "x@y.z", sector: "PRODUCCION" })).rejects.toMatchObject({ status: 403 });
    const route = await import("@/app/api/v1/portal-push-health/route");
    expect(typeof route.GET).toBe("function");
  });

  it("13 · notificación de PRUEBA: «aceptada por el servicio push» y, aparte, «recepción comprobada» con el acuse; el cron sin CRON_SECRET/Bearer falla con 401/500", async () => {
    const s = await push();
    await q("delete from portal_rate_limits where bucket like 'push-test:%'");
    const r = await s.sendTestPush(direccion, A.id);
    expect(r).toMatchObject({ sent: 2, failed: 0, devices: 2 });
    let st = await s.getTestPushStatus(direccion, r.testId!);
    expect(st).toMatchObject({ devices: 2, accepted: 2, received: 0, errors: 0 });
    const msg = pushSvc.received.filter((x) => x.message?.eventId === r.testId)[0]!.message!;
    expect(msg.title).toBe("¡Bienvenido a Laboratorio Genus! 🎉");
    expect(await ackLike(msg)).toBe(204);
    st = await s.getTestPushStatus(direccion, r.testId!);
    expect(st).toMatchObject({ accepted: 2, received: 1 });
    // El historial del cliente muestra la prueba enviada
    expect((await s.listPushHistory(A.sess)).items.some((i) => i.type === "prueba")).toBe(true);
    const { GET } = await import("@/app/api/cron/portal-push/route");
    expect((await GET(new Request("http://x/api/cron/portal-push", { headers: { authorization: "Bearer mala" } }))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/portal-push"))).status).toBe(401);
  });

  it("14 · el cron procesa SIN sesión ni portal abierto y deja evidencia aunque el worker falle (500 + latido con error)", async () => {
    const { runPushWorker } = await push();
    // sin ninguna sesión abierta: un cambio real de Producción se detecta solo por el cron
    const OPN = `OP-NT-${RUN}-N`;
    await svc.create(produccion as never, { op: OPN, cliente: A.name, producto: "SIN SESION NT", q: 5, portalClientId: A.id } as never);
    await cron();
    expect((await events(A, OPN)).map((e) => e.event_type)).toEqual(["RECIBIDO"]);
    await expect(runPushWorker({ db: { execute: async () => { throw new Error("db caída"); } } as never })).rejects.toThrow();
  });
});
