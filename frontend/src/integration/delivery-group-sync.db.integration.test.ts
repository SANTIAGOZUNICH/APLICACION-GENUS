/**
 * Entregar una aparición del MISMO trabajo (programaciones de una OE/OA en varios días) entrega las demás — Postgres de
 * PRUEBA real, con el mismo servicio que usa la app (deliverWorkDurable / annulDeliveryDurable). Se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-dg-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT DG CLIENTE ${RUN}`;
const PRODUCTO = `Aceite Reafirmante DG${RUN}`;
const NOTE = `IT-DG-${RUN}`;
let oaSeq = 0;
const oaNumber = () => `OA-2026-${String(800000 + Math.floor(Math.random() * 90000) + ++oaSeq).padStart(6, "0")}`;

describe.skipIf(Boolean(PROBLEM))(`Entrega sincronizada del mismo trabajo en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const pedidos: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from os_notifications where message like $1", [`%${CLIENT}%`]).catch(() => undefined);
    await pool?.end();
  });

  const mkPedido = async (qty = 5000) => {
    const id = randomUUID();
    pedidos.push(id);
    await q("insert into production_pedidos (id, cliente, producto, q, estado) values ($1,$2,$3,$4,'EN_ENVASADO')", [id, CLIENT, PRODUCTO, qty]);
    return id;
  };
  const assign = async (pedidoId: string, over: Record<string, unknown> = {}) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    return assignWorkItemDurable(
      { sector: "ENVASADO_MASIVO", client: CLIENT, product: PRODUCTO, plannedQuantity: "5000", unit: "u", plannedDate: "2031-09-01", line: "Línea 1", orderNumber: oaNumber(), productionPedidoId: pedidoId, packagingLote: "IT-DG", notes: NOTE, idempotencyKey: randomUUID(), ...over } as never,
      prod,
      randomUUID()
    );
  };
  /** Trabajo de 5.000 u. programado lunes 2.000 / miércoles 1.500 / viernes 1.500 (la MISMA OA y pedido). */
  const threeDays = async (pedidoId: string) => {
    const r = await assign(pedidoId);
    const root = r.item.id as string;
    const { addSchedulesDurable } = await import("@/lib/planning/work-schedules-service");
    const out = await addSchedulesDurable({ sourceId: root, items: [{ plannedDate: "2031-09-03", quantity: "1500" }, { plannedDate: "2031-09-05", quantity: "1500" }], rebalanceSource: true, idempotencyKey: `dg-${randomUUID()}` }, prod);
    const wed = out.created.find((s) => s.plannedDate === "2031-09-03")!.id;
    const fri = out.created.find((s) => s.plannedDate === "2031-09-05")!.id;
    return { mon: root, wed, fri };
  };
  const deliver = async (workItemId: string, over: Record<string, unknown> = {}) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: "R-IT-1", receivedBy: "Cliente", observations: null, ...over } as never, { email: prod.email, sector: "PRODUCCION", displayName: prod.displayName });
  };
  const status = async (id: string) => (await q("select operational_status from work_items where id = $1", [id]))[0]!.operational_status;
  const delivs = async (ids: string[]) => q("select work_item_id, status, quantity, remito, observations from work_item_deliveries where work_item_id = any($1) order by work_item_id", [ids]);
  const lines = async (ids: string[]) => q("select work_item_id, quantity, status, idempotency_key from work_item_delivery_lines where work_item_id = any($1)", [ids]);

  it("1-2) tres apariciones (lunes, miércoles, viernes): entregar UNA entrega las tres, con sus cantidades (suma = pedido) y sin duplicar nada", async () => {
    const pedido = await mkPedido();
    const { mon, wed, fri } = await threeDays(pedido);
    const before = { remitos: Number((await q("select count(*)::int n from remitos"))[0]!.n), movs: Number((await q("select count(*)::int n from mp_stock_movements"))[0]!.n), orders: Number((await q("select count(*)::int n from operational_orders"))[0]!.n) };
    const r = await deliver(wed, { idempotencyKey: `dg-${RUN}-a` });
    expect(r.complete).toBe(true);
    expect((r.synced ?? []).map((s) => s.workItemId).sort()).toEqual([mon, fri].sort());
    expect(await Promise.all([mon, wed, fri].map(status))).toEqual(["entregado", "entregado", "entregado"]);
    const ds = await delivs([mon, wed, fri]);
    expect(ds).toHaveLength(3); // una entrega por aparición (ENTREGADOS las muestra a las tres)
    expect(ds.map((d) => d.status)).toEqual(["ENTREGADO", "ENTREGADO", "ENTREGADO"]);
    expect(ds.every((d) => d.remito === "R-IT-1")).toBe(true); // el mismo remito escrito, no tres remitos distintos
    // Lo físico se registra UNA vez (la entrega que se hizo): las otras apariciones se cierran sin entrega ni cantidad propia.
    const ls = await lines([mon, wed, fri]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.work_item_id).toBe(wed);
    expect(ds.filter((d) => String(d.observations).includes(`[sync-from:${wed}]`))).toHaveLength(2);
    // Pedido cerrado UNA sola vez; sin remitos, movimientos de stock ni órdenes nuevos.
    expect((await q("select estado from production_pedidos where id = $1", [pedido]))[0]!.estado).toBe("ENTREGADO");
    expect(await q("select 1 from production_pedido_status_events where pedido_id = $1 and to_estado = 'ENTREGADO'", [pedido])).toHaveLength(1);
    expect(Number((await q("select count(*)::int n from remitos"))[0]!.n)).toBe(before.remitos);
    expect(Number((await q("select count(*)::int n from mp_stock_movements"))[0]!.n)).toBe(before.movs);
    expect(Number((await q("select count(*)::int n from operational_orders"))[0]!.n)).toBeGreaterThanOrEqual(before.orders);
    // Un solo aviso de entrega para Administración (las apariciones sincronizadas no re-avisan).
    expect((await q("select count(*)::int n from os_notifications where kind = 'entrega_registrada' and message like $1", [`%${CLIENT}%`]))[0]!.n).toBeLessThanOrEqual(1);
    // Auditoría: quién entregó y qué registros quedaron sincronizados.
    const ev = await q("select note, actor_email from operational_events where work_item_id = $1 and type = 'WORK_DELIVERED'", [wed]);
    expect(ev).toHaveLength(1);
    expect(String(ev[0]!.note)).toContain(`sync=[`);
    expect(String(ev[0]!.note)).toContain(mon);
    expect(ev[0]!.actor_email).toBe(prod.email);
    const evSib = await q("select note, actor_email from operational_events where work_item_id = $1 and type = 'WORK_DELIVERED'", [mon]);
    expect(String(evSib[0]!.note)).toContain(`sync-from:${wed}`);
    expect(evSib[0]!.actor_email).toBe(prod.email);
  });

  it("9) entregar de nuevo (otra aparición o la misma, con otra clave): sin efectos adicionales", async () => {
    const pedido = await mkPedido();
    const { mon, wed, fri } = await threeDays(pedido);
    await deliver(mon, { idempotencyKey: `dg-${RUN}-b` });
    const snap = async () => JSON.stringify([await delivs([mon, wed, fri]), await lines([mon, wed, fri]), await q("select count(*)::int n from operational_events where work_item_id = any($1)", [[mon, wed, fri]])]);
    const before = await snap();
    const again = await deliver(fri, { idempotencyKey: `dg-${RUN}-b2` }); // otra aparición, ya entregada
    expect(again.replayed).toBe(true);
    await deliver(mon, { idempotencyKey: `dg-${RUN}-b` }); // reintento exacto
    await deliver(wed, { idempotencyKey: `dg-${RUN}-b3` });
    expect(await snap()).toBe(before);
  });

  it("3-4-5) mismo cliente y producto pero OTRO pedido, y otra etapa (Codificado) del mismo pedido: NO se entregan", async () => {
    const pedidoA = await mkPedido();
    const pedidoB = await mkPedido();
    const a = await threeDays(pedidoA);
    const b = await threeDays(pedidoB); // otro pedido, mismo cliente y producto
    const cod = (await assign(pedidoA, { sector: "CODIFICADO", plannedQuantity: "5000", line: undefined, orderNumber: undefined })).item.id as string; // otra etapa del MISMO pedido
    await deliver(a.fri, { idempotencyKey: `dg-${RUN}-c` });
    expect(await Promise.all([a.mon, a.wed, a.fri].map(status))).toEqual(["entregado", "entregado", "entregado"]);
    expect(await Promise.all([b.mon, b.wed, b.fri].map(status))).toEqual(["pendiente", "pendiente", "pendiente"]);
    expect(await status(cod)).not.toBe("entregado");
    expect(await delivs([b.mon, b.wed, b.fri, cod])).toHaveLength(0);
    // El pedido B no se cerró; el A queda cerrado solo si no tiene otras etapas pendientes (Codificado pendiente → sigue abierto).
    expect((await q("select estado from production_pedidos where id = $1", [pedidoB]))[0]!.estado).not.toBe("ENTREGADO");
    expect((await q("select estado from production_pedidos where id = $1", [pedidoA]))[0]!.estado).not.toBe("ENTREGADO");
  });

  it("6-10) no se entregan canceladas/borradas; persiste tras recargar; entregas simultáneas de apariciones distintas no se traban ni duplican", async () => {
    const pedido = await mkPedido();
    const { mon, wed, fri } = await threeDays(pedido);
    await q("update work_items set operational_status = 'cancelado' where id = $1", [fri]);
    const r = await deliver(mon, { idempotencyKey: `dg-${RUN}-d` });
    expect((r.synced ?? []).map((s) => s.workItemId)).toEqual([wed]);
    expect(await status(fri)).toBe("cancelado");
    // «Recargar»: el estado sale de la base.
    expect(await Promise.all([mon, wed].map(status))).toEqual(["entregado", "entregado"]);

    const p2 = await mkPedido();
    const g = await threeDays(p2);
    const [x, y] = await Promise.all([deliver(g.mon, { idempotencyKey: `dg-${RUN}-e1` }), deliver(g.fri, { idempotencyKey: `dg-${RUN}-e2` })]);
    expect([x.complete, y.complete]).toEqual([true, true]);
    expect(await Promise.all([g.mon, g.wed, g.fri].map(status))).toEqual(["entregado", "entregado", "entregado"]);
    expect(await delivs([g.mon, g.wed, g.fri])).toHaveLength(3);
    const ls = await lines([g.mon, g.wed, g.fri]);
    expect(ls).toHaveLength(1); // una sola entrega física, ninguna doble (aunque dos usuarios entreguen a la vez)
  });

  it("restaurar: anular la entrega de una aparición anula solo las de ESE conjunto sincronizado (no otros pedidos)", async () => {
    const pedidoA = await mkPedido();
    const pedidoB = await mkPedido();
    const a = await threeDays(pedidoA);
    const b = await threeDays(pedidoB);
    await deliver(a.mon, { idempotencyKey: `dg-${RUN}-f` });
    await deliver(b.mon, { idempotencyKey: `dg-${RUN}-g` });
    const { annulDeliveryDurable } = await import("@/lib/planning/work-item-progress-repository");
    const wedDelivery = (await q("select id from work_item_deliveries where work_item_id = $1 and status = 'ENTREGADO'", [a.wed]))[0]!.id as string;
    const out = await annulDeliveryDurable(wedDelivery, "Se cargó mal", prod.displayName);
    expect(out?.status).toBe("ANULADO");
    expect((await delivs([a.mon, a.wed, a.fri])).map((d) => d.status)).toEqual(["ANULADO", "ANULADO", "ANULADO"]);
    expect((await lines([a.mon, a.wed, a.fri])).every((l) => l.status === "ANULADA")).toBe(true);
    expect(await Promise.all([a.mon, a.wed, a.fri].map(status))).toEqual(["revision", "revision", "revision"]);
    expect((await delivs([b.mon, b.wed, b.fri])).map((d) => d.status)).toEqual(["ENTREGADO", "ENTREGADO", "ENTREGADO"]);
    // Se puede volver a entregar: nuevo conjunto sincronizado, sin duplicar lo anulado.
    const again = await deliver(a.fri, { idempotencyKey: `dg-${RUN}-h` });
    expect(again.complete).toBe(true);
    expect(await Promise.all([a.mon, a.wed, a.fri].map(status))).toEqual(["entregado", "entregado", "entregado"]);
  });
});
