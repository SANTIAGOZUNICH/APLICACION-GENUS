/**
 * Portal de Clientes — CASO «GENUS TEST» con el flujo operativo REAL (Postgres de PRUEBA, SIN mocks de vínculo ni de cola):
 * cliente y acceso → pedido asignado desde Producción → visible en el portal → asignado/enviado a Elaboración con el servicio real
 * (assignWorkItemDurable) → Envasado con el servicio real (sendElaboracionToEnvasadoDurable) → «Listo para entregar» con la marca
 * explícita real → entregado con el registro real de entregas.
 *
 * El eslabón de envío usa un «push service» LOCAL (servidor HTTPS) y el web-push REAL firmando con VAPID de prueba: el receptor valida la
 * firma VAPID y DESCIFRA el payload (RFC 8291) con las claves del «dispositivo». Esto NO prueba la recepción física en un celular
 * (service worker, permiso del sistema, APNs/FCM): eso se valida a mano con el checklist del reporte.
 * Se SALTA sin base local marcada.
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
const direccion = { email: "it-rf-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const produccion = { email: "it-rf-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const elab = { email: "it-rf-elab@laboratoriogenus.com.ar", sector: "ELABORACION", displayName: "IT Elaboración" };
const envasado = { email: "it-rf-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 4).toUpperCase();
const NAME = `GENUS TEST ${RUN}`;
const b64u = (b: Buffer) => b.toString("base64url");

type Received = { path: string; status: number; vapidOk: boolean; vapidAud: string; vapidSub: string; message: { title: string; body: string; url: string; tag: string } | null };

/** «Push service» local: HTTPS real, verifica VAPID y descifra aes128gcm con las claves del dispositivo suscripto. */
function startPushService(vapidPublic: string, devices: Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>) {
  const received: Received[] = [];
  const failNext = { path: "", status: 0 };
  const server = https.createServer({ key: readFileSync(path.join(CERT_DIR, "key.pem")), cert: readFileSync(path.join(CERT_DIR, "cert.pem")) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const reqPath = req.url ?? "";
      if (failNext.path && reqPath.includes(failNext.path)) {
        const code = failNext.status;
        failNext.path = "";
        received.push({ path: reqPath, status: code, vapidOk: false, vapidAud: "", vapidSub: "", message: null });
        res.writeHead(code).end("simulated failure");
        return;
      }
      const entry: Received = { path: reqPath, status: 201, vapidOk: false, vapidAud: "", vapidSub: "", message: null };
      try {
        // VAPID: Authorization: vapid t=<jwt>, k=<pub>
        const auth = String(req.headers.authorization ?? "");
        const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
        if (m) {
          const [h, p, sig] = m[1]!.split(".");
          const pub = Buffer.from(m[2]!, "base64url");
          const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
          const claims = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as { aud: string; sub: string };
          entry.vapidOk = m[2] === vapidPublic && verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"));
          entry.vapidAud = claims.aud;
          entry.vapidSub = claims.sub;
        }
        // Payload cifrado (RFC 8291 / aes128gcm)
        const dev = devices.get(reqPath.split("/").pop()!);
        const body = Buffer.concat(chunks);
        if (dev && body.length > 86) {
          const salt = body.subarray(0, 16);
          const idlen = body[20]!;
          const asPub = body.subarray(21, 21 + idlen);
          const cipher = body.subarray(21 + idlen);
          const secret = dev.ecdh.computeSecret(asPub);
          const uaPub = dev.ecdh.getPublicKey();
          const prk = Buffer.from(hkdfSync("sha256", secret, dev.auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
          const cek = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
          const nonce = Buffer.from(hkdfSync("sha256", prk, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
          const d = createDecipheriv("aes-128-gcm", cek, nonce);
          d.setAuthTag(cipher.subarray(cipher.length - 16));
          const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
          let end = plain.length - 1;
          while (end >= 0 && plain[end] === 0) end--; // relleno
          entry.message = JSON.parse(plain.subarray(0, end).toString("utf8"));
        }
      } catch {
        /* queda sin descifrar: el test lo detecta */
      }
      received.push(entry);
      res.writeHead(201).end();
    });
  });
  return new Promise<{ url: string; received: Received[]; failNext: typeof failNext; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `https://localhost:${(server.address() as AddressInfo).port}`, received, failNext, close: () => new Promise((r) => server.close(() => r())) })),
  );
}

describe.skipIf(Boolean(PROBLEM))(`Portal: GENUS TEST con el flujo operativo real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  let C = { id: "", code: "" };
  let sess = {} as import("@/lib/portal/auth-service").PortalSession;
  let pushSvc: Awaited<ReturnType<typeof startPushService>>;
  let vapidPublic = "";
  const devices = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: Buffer }>();
  let pedidoId = "";
  let workId = "";
  const OP = `OP-RF-${RUN}`;

  const push = () => import("@/lib/portal/push/push-service");
  const trig = () => import("@/lib/portal/push/push-trigger");
  const payload = async () => {
    const { loadPortalOverview } = await import("@/lib/portal/data-service");
    const { toClientPayload } = await import("@/lib/portal/overview");
    return toClientPayload((await loadPortalOverview(C.id)).overview);
  };
  const etag = async () => (await import("@/lib/portal/security")).sha256(JSON.stringify({ ok: true, ...(await payload()) }));
  const statusOf = async () => (await payload()).orders.find((o) => o.orderRef === OP)?.status.label ?? null;
  const outbox = () => q("select event_type, status, mode, title, body from portal_push_outbox where client_id = $1::uuid and order_ref = $2 order by created_at", [C.id, OP]);
  const flush = async () => (await trig()).flushPortalPushTriggers();

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.VITEST = "false"; // camino REAL (Postgres), con disparo inmediato activo
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
    const adm = await import("@/lib/portal/admin-service");
    const c = await adm.createClient(direccion, { displayName: NAME, aliases: [NAME], emails: [] });
    C = { id: c.id, code: c.publicCode };
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    const u = await createPortalUser(direccion, { clientId: C.id, username: `gt-${RUN.toLowerCase()}`, password: "Clave-Segura-IT-2026" });
    sess = { id: randomUUID(), clientId: C.id, email: null, clientName: NAME, publicCode: C.code, userId: u.id, username: u.username, mustChangePassword: false, actor: `usuario:${u.username}` } as import("@/lib/portal/auth-service").PortalSession;
  }, 180_000);

  afterAll(async () => {
    try {
      const s = await push();
      await s.updatePushSettings(direccion, { globalSendEnabled: false });
    } catch {
      /* limpieza */
    }
    await pushSvc?.close();
    await pool?.end();
  });

  it("1 · activación: el dispositivo se registra en PostgreSQL ANTES de poder mostrarse «activadas» (sin piloto todavía)", async () => {
    const s = await push();
    expect(await s.pushClientConfig(sess, null)).toMatchObject({ available: true, publicKey: vapidPublic, pilotEnabled: false, thisDevice: false });
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const auth = randomBytes(16);
    devices.set("dev1", { ecdh, auth });
    const sub = { endpoint: `${pushSvc.url}/push/dev1`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
    expect(await s.savePushSubscription(sess, sub, "Mozilla/5.0 (iPhone) IT")).toEqual({ registered: true, devices: 1 });
    expect(await s.pushClientConfig(sess, sub.endpoint)).toMatchObject({ thisDevice: true, devices: 1 });
    expect(await q("select count(*)::int as n from portal_push_subscriptions where client_id = $1::uuid", [C.id])).toEqual([{ n: 1 }]);
  });

  it("2 · Dirección habilita el piloto y el envío real (SOLO en esta base descartable)", async () => {
    const s = await push();
    await s.setClientPilot(direccion, C.id, true);
    await s.updatePushSettings(direccion, { globalSendEnabled: true });
    expect((await s.pushClientConfig(sess, null)).pilotEnabled).toBe(true);
  });

  it("3 · pedido asignado desde Producción: visible en el portal y «¡Recibimos tu pedido!» llega al instante (descifrado)", async () => {
    const svc = (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
    const e0 = await etag();
    const ped = await svc.create(produccion as never, { op: OP, cliente: NAME, producto: "SHAMPOO RF", q: 500, portalClientId: C.id } as never);
    pedidoId = ped.id;
    await flush();
    expect(await etag()).not.toBe(e0);
    expect(await statusOf()).toBe("Pedido recibido");
    expect((await outbox()).map((r) => r.event_type)).toEqual(["RECIBIDO"]);
    const got = pushSvc.received.filter((r) => r.path.endsWith("/dev1"));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ vapidOk: true, vapidSub: "mailto:it@laboratoriogenus.com.ar", status: 201 });
    expect(got[0]!.vapidAud).toBe(pushSvc.url);
    expect(got[0]!.message).toMatchObject({ title: "¡Recibimos tu pedido!", url: expect.stringContaining("/entregas#pedido-") });
  });

  it("4 · REPRODUCCIÓN + CORRECCIÓN: asignar a Elaboración (flujo real) → «En elaboración» (antes quedaba «Pedido programado») y push ELABORACION", async () => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const e1 = await etag();
    const r = await assignWorkItemDurable({ sector: "ELABORACION", client: NAME, product: "SHAMPOO RF", plannedQuantity: "500", unit: "un", branchOwner: "Cristian", productionPedidoId: pedidoId, plannedDate: "2039-05-02", idempotencyKey: `rf-assign-${RUN}-1` } as never, produccion as never, randomUUID());
    workId = r.item.id;
    const w = (await q("select operational_status, progress_updated_at from work_items where id = $1::uuid", [workId]))[0]!;
    expect(w.operational_status).toBe("pendiente"); // Producción NO registró avance: antes el portal mostraba «Pedido programado»
    expect((await q("select estado from production_pedidos where id = $1::uuid", [pedidoId]))[0]).toEqual({ estado: "EN_ELABORACION" });
    await flush();
    expect(await etag()).not.toBe(e1);
    expect(await statusOf()).toBe("En elaboración");
    const rows = await outbox();
    expect(rows.map((x) => x.event_type)).toEqual(["RECIBIDO", "ELABORACION"]);
    expect(rows[1]).toMatchObject({ status: "ENVIADA", mode: "REAL", title: "¡Tu pedido se está elaborando!", body: expect.stringContaining("aproximadamente 8 días hábiles") });
    const last = pushSvc.received.filter((x) => x.path.endsWith("/dev1")).at(-1)!;
    expect(last.message).toMatchObject({ title: "¡Tu pedido se está elaborando!", body: expect.stringContaining("Comenzamos la elaboración de tus productos.") });
  });

  it("5 · Elaboración → Envasado (flujo real): «En envasado» y push ENVASADO", async () => {
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const e2 = await etag();
    await sendElaboracionToEnvasadoDurable({ workItemId: workId, destination: "ENVASADO_MASIVO", producedQuantity: "500", idempotencyKey: `rf-env-${RUN}-0001` } as never, elab as never);
    await flush();
    expect(await etag()).not.toBe(e2);
    expect(await statusOf()).toBe("En envasado");
    const rows = await outbox();
    expect(rows.map((x) => x.event_type)).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO"]);
    expect(rows[2]).toMatchObject({ status: "ENVIADA", title: "¡Tu pedido está en envasado!", body: expect.stringContaining("aproximadamente 3 días hábiles") });
    expect(pushSvc.received.filter((x) => x.path.endsWith("/dev1")).at(-1)!.message?.title).toBe("¡Tu pedido está en envasado!");
  });

  it("6 · Listo para entregar (marca explícita real): título nuevo; Entregado por el registro real de entregas (cron)", async () => {
    const destId = String((await q("select id::text as id from work_items where production_pedido_id = $1::uuid and sector = 'ENVASADO_MASIVO'", [pedidoId]))[0]!.id);
    await q("update work_items set operational_status = 'revision', completed_at = now(), finished_qty = '500' where id = $1::uuid", [destId]);
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");
    await markReadyForDelivery(envasado as never, { workItemId: destId, idempotencyKey: `it-rf-${RUN}-mark` });
    await flush();
    expect(await statusOf()).toBe("Listo para entregar");
    const listo = (await outbox()).find((x) => x.event_type === "LISTO")!;
    expect(listo).toMatchObject({ status: "ENVIADA", title: "¡TU PEDIDO ESTÁ LISTO PARA ENTREGAR! 🎉", body: expect.stringContaining("Finalizamos la producción de tu pedido.") });
    expect(pushSvc.received.filter((x) => x.path.endsWith("/dev1")).at(-1)!.message?.title).toBe("¡TU PEDIDO ESTÁ LISTO PARA ENTREGAR! 🎉");
    // Entrega real: la detecta el cron (sin sesión ni portal abierto).
    const { getDb } = await import("@/lib/db/client");
    const { recordDeliveryInTx } = await import("@/lib/planning/circuit/delivery-core");
    await getDb().transaction((tx) => recordDeliveryInTx(tx, { workItemId: destId, actor: produccion as never, quantity: null, idempotencyKey: `it-rf-${RUN}-del` } as never));
    const { GET } = await import("@/app/api/cron/portal-push/route");
    expect((await GET(new Request("http://x/api/cron/portal-push", { headers: { authorization: "Bearer mala" } }))).status).toBe(401);
    const res = await GET(new Request("http://x/api/cron/portal-push", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(res.status).toBe(200);
    expect(await statusOf()).toBe("Entregado");
    expect((await outbox()).map((x) => x.event_type)).toEqual(["RECIBIDO", "ELABORACION", "ENVASADO", "LISTO", "ENTREGADO"]);
  });

  it("7 · sin duplicados: corridas repetidas y simultáneas no reenvían; 5 eventos = 5 entregas al dispositivo", async () => {
    const s = await push();
    await Promise.all([s.runPushWorker(), s.runPushWorker(), s.runPushWorker()]);
    expect((await outbox()).every((x) => x.status === "ENVIADA")).toBe(true);
    expect(pushSvc.received.filter((x) => x.path.endsWith("/dev1") && x.status === 201)).toHaveLength(5);
    expect(await q("select count(*)::int as n from (select 1 from portal_push_outbox group by client_id, order_key, event_type, product_key having count(*) > 1) d")).toEqual([{ n: 0 }]);
    expect(pushSvc.received.every((x) => x.vapidOk)).toBe(true);
  });

  it("8 · diagnóstico de Dirección: dispositivos, última suscripción, eventos, último fallo y latido del worker", async () => {
    const s = await push();
    const ov = await s.pushAdminOverview(direccion);
    const row = ov.clients.find((c) => c.id === C.id)!;
    expect(row).toMatchObject({ devices: 1, pilotEnabled: true, events: { enviados: 5, pendientes: 0, fallidos: 0 } });
    expect(row.lastSubscriptionAt).not.toBeNull();
    expect(row.lastSentAt).not.toBeNull();
    expect(ov.worker).toMatchObject({ lastOk: true, lastTrigger: "cron" });
    expect(ov.worker.lastCronAt).not.toBeNull();
    expect(ov.worker.runsTotal).toBeGreaterThan(3);
  });

  it("9 · un fallo del push service NUNCA afecta a Producción: el evento queda con motivo y se reintenta", async () => {
    const svc = (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
    pushSvc.failNext.path = "/dev1";
    pushSvc.failNext.status = 503;
    const ped2 = await svc.create(produccion as never, { op: `${OP}-2`, cliente: NAME, producto: "TONICO RF", q: 50, portalClientId: C.id } as never);
    await flush();
    expect(ped2.id).toBeTruthy(); // la operación de Producción terminó bien
    const ev = (await q("select status, last_error, attempts from portal_push_outbox where client_id = $1::uuid and order_ref = $2", [C.id, `${OP}-2`]))[0]!;
    expect(ev.status).toBe("PENDIENTE");
    expect(String(ev.last_error)).toContain("503");
    const ov = await (await push()).pushAdminOverview(direccion);
    expect(ov.clients.find((c) => c.id === C.id)!.lastFailure?.reason).toContain("503");
    // Producción sigue sin tocarse: el pedido está intacto.
    expect((await q("select estado from production_pedidos where id = $1::uuid", [ped2.id]))[0]).toEqual({ estado: null });
  });
});
