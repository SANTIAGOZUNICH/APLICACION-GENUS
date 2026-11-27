/**
 * PASO 0 — AUDITORÍA reproducible del circuito de notificaciones/estado del Portal de Clientes (Postgres de PRUEBA, SIN mocks de la
 * lógica): ejecuta las acciones REALES de cada sector (servicios que usan las pantallas) con la configuración de PRODUCCIÓN por
 * defecto (interruptor global de envío APAGADO, cliente en piloto) y registra qué ve el portal y qué hace el outbox en cada paso.
 * Este archivo solo OBSERVA (no afirma el comportamiento deseado): ver docs/portal-notificaciones-auditoria.md.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const direccion = { email: "it-au-direccion@laboratoriogenus.com.ar", sector: "DIRECCION", displayName: "IT Dirección" };
const produccion = { email: "it-au-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const elab = { email: "it-au-elab@laboratoriogenus.com.ar", sector: "ELABORACION", displayName: "IT Elaboración" };
const envasado = { email: "it-au-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 4).toUpperCase();

describe.skipIf(Boolean(PROBLEM))(`AUDITORÍA portal${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const log: string[] = [];
  const say = (s: string) => log.push(s);

  async function client(name: string) {
    const adm = await import("@/lib/portal/admin-service");
    const c = await adm.createClient(direccion, { displayName: name, aliases: [name], emails: [] });
    const { createPortalUser } = await import("@/lib/portal/user-admin-service");
    await createPortalUser(direccion, { clientId: c.id, username: `au-${name.replace(/\W/g, "").toLowerCase().slice(-8)}`, password: "Clave-Segura-IT-2026" });
    const s = await import("@/lib/portal/push/push-service");
    await s.setClientPilot(direccion, c.id, true);
    await q("insert into portal_push_subscriptions (id, client_id, owner_key, endpoint, p256dh, auth) values (gen_random_uuid(), $1::uuid, 'e:x', $2, $3, $4)", [c.id, `https://localhost:9/push/${randomUUID()}`, "B".repeat(87), "a".repeat(22)]);
    return c.id;
  }
  async function snap(label: string, clientId: string, op: string) {
    const { loadPortalOverview } = await import("@/lib/portal/data-service");
    const { overview } = await loadPortalOverview(clientId);
    const o = overview.orders.find((x) => x.orderRef === op);
    const prods = overview.products.filter((p) => p.orderRef === op).map((p) => `${p.product}:${p.commercial.label}`).join(" | ");
    const s = await import("@/lib/portal/push/push-service");
    await s.runPushWorker({ onlyClientId: clientId });
    const ob = await q("select event_type, status, mode from portal_push_outbox where client_id = $1::uuid and order_ref = $2 order by created_at", [clientId, op]);
    say(`  [${label}] portal=${o ? o.status.label : "(NO SE MUESTRA)"} · productos=${prods || "(ninguno)"} · outbox=${ob.map((r) => `${r.event_type}/${r.status}`).join(",") || "(vacío)"}`);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.VITEST = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.PORTAL_EMAIL_MODE = "capture";
    process.env.PORTAL_AUTH_SECRET = "it-portal-secret-".padEnd(40, "x");
    process.env.GENUS_PORTAL_PUSH_INLINE = "off";
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
  }, 180_000);
  afterAll(async () => {
    console.log(`\n===== AUDITORÍA (config de producción: envío global APAGADO, cliente en piloto) =====\n${log.join("\n")}\n=====`);
    await pool?.end();
  });

  it("recorrido operativo real", async () => {
    const svc = (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const { completeWorkDurable, deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const { markReadyForDelivery } = await import("@/lib/portal/availability-service");

    // ── A: circuito completo (Producción → Elaboración → Envasado → Finalizar → «Marcar listo» → entrega parcial → total)
    const NAME = `AUD A ${RUN}`;
    const cid = await client(NAME);
    const OP = `OP-AU-${RUN}-A`;
    say(`A) circuito completo por los servicios reales`);
    const ped = await svc.create(produccion as never, { op: OP, cliente: NAME, producto: "SHAMPOO AU", q: 500, portalClientId: cid } as never);
    await snap("Producción carga el pedido", cid, OP);
    const r = await assignWorkItemDurable({ sector: "ELABORACION", client: NAME, product: "SHAMPOO AU", plannedQuantity: "500", unit: "un", branchOwner: "Cristian", productionPedidoId: ped.id, plannedDate: "2039-05-02", idempotencyKey: `au-a-${RUN}-1` } as never, produccion as never, randomUUID());
    await snap("Producción asigna a Elaboración", cid, OP);
    await sendElaboracionToEnvasadoDurable({ workItemId: r.item.id, destination: "ENVASADO_MASIVO", producedQuantity: "500", idempotencyKey: `au-a-${RUN}-env1` } as never, elab as never);
    await snap("Elaboración envía a Envasado", cid, OP);
    const destId = String((await q("select id::text as id from work_items where production_pedido_id = $1::uuid and sector = 'ENVASADO_MASIVO'", [ped.id]))[0]!.id);
    await completeWorkDurable(destId, { finishedQty: "500", observation: "ok", completedBy: envasado.email }, "ENVASADO_MASIVO");
    await snap("Envasado finaliza el trabajo (sin marcar listo)", cid, OP);
    await markReadyForDelivery(envasado as never, { workItemId: destId, idempotencyKey: `au-a-${RUN}-mark` });
    await snap("Envasado «Marcar listo para entregar»", cid, OP);
    const deliver = (qty: number | null, k: string) => deliverWorkDurable({ workItemId: destId, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, partial: qty != null, deliverQuantity: qty, idempotencyKey: k } as never, envasado as never);
    await deliver(200, `au-a-${RUN}-d1`);
    await snap("Entrega PARCIAL (200 de 500)", cid, OP);
    await deliver(null, `au-a-${RUN}-d2`);
    await snap("Entrega TOTAL (saldo)", cid, OP);
    say(`     pedido.estado en la base = ${(await q("select estado from production_pedidos where id = $1::uuid", [ped.id]))[0]!.estado}; work.operational_status = ${(await q("select operational_status from work_items where id = $1::uuid", [destId]))[0]!.operational_status}`);

    // ── B: Producción cambia el ESTADO del pedido a mano (lo que hace la pantalla de Pedidos) con trabajos en Envasado
    const NB = `AUD B ${RUN}`;
    const cb = await client(NB);
    const OPB = `OP-AU-${RUN}-B`;
    say(`B) Producción edita el estado del pedido a mano (pedido CON trabajo en Envasado)`);
    const pb = await svc.create(produccion as never, { op: OPB, cliente: NB, producto: "GEL AU", q: 100, portalClientId: cb } as never);
    const rb = await assignWorkItemDurable({ sector: "ELABORACION", client: NB, product: "GEL AU", plannedQuantity: "100", unit: "un", branchOwner: "Cristian", productionPedidoId: pb.id, plannedDate: "2039-05-03", idempotencyKey: `au-b-${RUN}-1` } as never, produccion as never, randomUUID());
    await sendElaboracionToEnvasadoDurable({ workItemId: rb.item.id, destination: "ENVASADO_MASIVO", producedQuantity: "100", idempotencyKey: `au-b-${RUN}-env1` } as never, elab as never);
    await snap("trabajo en Envasado", cb, OPB);
    await svc.update(produccion as never, pb.id, { op: OPB, cliente: NB, producto: "GEL AU", q: 100, estado: "LISTO PARA ENTREGAR" } as never);
    await snap("Producción pone estado «LISTO PARA ENTREGAR»", cb, OPB);
    await svc.update(produccion as never, pb.id, { op: OPB, cliente: NB, producto: "GEL AU", q: 100, estado: "ENTREGADO" } as never);
    await snap("Producción pone estado «ENTREGADO»", cb, OPB);

    // ── C: pedido SIN trabajos con estado manual
    const NC = `AUD C ${RUN}`;
    const cc = await client(NC);
    const OPC = `OP-AU-${RUN}-C`;
    say(`C) pedido SIN trabajos, estado manual`);
    const pc = await svc.create(produccion as never, { op: OPC, cliente: NC, producto: "TONICO AU", q: 10, portalClientId: cc } as never);
    await snap("recién cargado", cc, OPC);
    await svc.update(produccion as never, pc.id, { op: OPC, cliente: NC, producto: "TONICO AU", q: 10, estado: "LISTO PARA ENTREGAR" } as never);
    await snap("estado «LISTO PARA ENTREGAR»", cc, OPC);
    await svc.update(produccion as never, pc.id, { op: OPC, cliente: NC, producto: "TONICO AU", q: 10, estado: "ENTREGADO" } as never);
    await snap("estado «ENTREGADO»", cc, OPC);

    // ── D: entregado y luego BORRADO del trabajo / archivado de la entrega (el trabajo sale de las consultas «vivas»)
    const ND = `AUD D ${RUN}`;
    const cd = await client(ND);
    const OPD = `OP-AU-${RUN}-D`;
    say(`D) pedido entregado y luego archivado en «Entregados» / trabajo borrado (sale de las consultas vivas)`);
    const pd = await svc.create(produccion as never, { op: OPD, cliente: ND, producto: "CREMA AU", q: 50, portalClientId: cd } as never);
    const rd = await assignWorkItemDurable({ sector: "ELABORACION", client: ND, product: "CREMA AU", plannedQuantity: "50", unit: "un", branchOwner: "Cristian", productionPedidoId: pd.id, plannedDate: "2039-05-04", idempotencyKey: `au-d-${RUN}-1` } as never, produccion as never, randomUUID());
    await sendElaboracionToEnvasadoDurable({ workItemId: rd.item.id, destination: "ENVASADO_MASIVO", producedQuantity: "50", idempotencyKey: `au-d-${RUN}-env1` } as never, elab as never);
    const did = String((await q("select id::text as id from work_items where production_pedido_id = $1::uuid and sector = 'ENVASADO_MASIVO'", [pd.id]))[0]!.id);
    await completeWorkDurable(did, { finishedQty: "50", observation: "ok", completedBy: envasado.email }, "ENVASADO_MASIVO");
    await deliverWorkDurable({ workItemId: did, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, deliverQuantity: null, idempotencyKey: `au-d-${RUN}-d1` } as never, envasado as never);
    await snap("Envasado ENTREGA directo (sin «marcar listo»)", cd, OPD);
    await q("update work_item_deliveries set archived = true where work_item_id = $1::uuid", [did]);
    await snap("la entrega se ARCHIVA en Entregados", cd, OPD);
  }, 120_000);
});
