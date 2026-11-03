/**
 * Remitos por ENTREGA PARCIAL + auditoría del circuito de entregas — Postgres de PRUEBA real (servicio de remitos respaldado por la base).
 * Datos ficticios «IT RP»; se SALTA sin base marcada. Bajo vitest el servicio de remitos usa memoria por defecto: acá se lo fuerza a la base.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT RP CLIENTE ${RUN}`;
const prod = { email: "it-rp-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const prod2 = { email: "it-rp-prod2@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción 2" };
const masivo = { email: "it-rp-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-rp-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-rp-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-rp-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;
const asRemitoActor = (a: { email: string; sector: string }) => ({ email: a.email, sector: a.sector }) as never;

describe.skipIf(Boolean(PROBLEM))(`Remitos por entrega parcial y auditoría del circuito${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const rem = () => import("@/lib/remitos/delivery-remittance");
  const ids = () => import("@/lib/planning/internal-deliveries-service");
  const trans = () => import("@/lib/planning/codificado-transfer-service");
  const remitoSvc = async () => (await import("@/lib/remitos/remito-service")).getRemitoService();

  beforeAll(async () => {
    // El servicio de remitos usa memoria bajo vitest: se fuerza a la base para probar el comportamiento real de producción.
    process.env.VITEST = "false";
    process.env.NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
  });

  const newWork = async (sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM", qty: string, finished: string | null = null, pedidoId: string | null = null) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable({ sector, client: CLIENT, product: `Serum IT ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(500000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-RP", idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const id = r.item.id as string;
    if (finished) await q("update work_items set finished_qty = $1 where id = $2", [finished, id]);
    if (pedidoId) await q("update work_items set production_pedido_id = $1 where id = $2", [pedidoId, id]);
    return id;
  };
  const deliver = async (actor: typeof masivo | typeof premium | typeof codif, workItemId: string, qty: number, boxes: Boxes | null = null, observations: string | null = null) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable(
      { workItemId, deliverQuantity: qty, partial: true, observations, deliveryPackingGroups: boxes, idempotencyKey: randomUUID(), codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null } as never,
      { email: actor.email, sector: actor.sector, displayName: actor.displayName }
    );
  };
  const lines = (workItemId: string) => q("select id, sequence, quantity, status, packing_groups from work_item_delivery_lines where work_item_id = $1 order by sequence", [workItemId]);
  const stockCounts = async () => JSON.stringify([(await q("select count(*)::int n from inv_me_ingresos"))[0], (await q("select count(*)::int n from inv_me_salidas"))[0], (await q("select count(*)::int n from inv_ajustes"))[0]]);
  const remitoRows = (lineId: string) => q("select r.id::text, r.status, rl.total_units::float8 as units, rl.cajas1, rl.unidades1, rl.cajas2, rl.unidades2 from remito_lines rl join remitos r on r.id = rl.remito_id where rl.work_item_id like $1 order by rl.work_item_id", [`dl:${lineId}%`]);
  /** Un remito emitido (GENERADO) sin generar archivos: se marca el estado como lo haría la emisión. */
  const markEmitted = async (remitoId: string) => { await q("update remitos set status = 'GENERADO', remito_number = $2 where id = $1", [remitoId, `IT-RP-${remitoId.slice(0, 6)}`]); };

  it("1) tres entregas parciales con cajas distintas se ven una por una; total recibido 1.850 u. en 19 cajas", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "1850");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }], "primera");
    await deliver(masivo, id, 600, [{ cajas: 6, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], "con caja incompleta");
    const { deliveries, totals } = await (await rem()).listDeliveriesOfWork(id);
    expect(deliveries.map((d) => [d.sequence, d.delivered, d.cajas, d.sourceSector, d.client, d.lote])).toEqual([[1, 800, 8, "ENVASADO_MASIVO", CLIENT, "L-IT-RP"], [2, 600, 6, "ENVASADO_MASIVO", CLIENT, "L-IT-RP"], [3, 450, 5, "ENVASADO_MASIVO", CLIENT, "L-IT-RP"]]);
    expect(deliveries[2]!.boxesText).toMatch(/4 cajas de 100 u\. \+ 1 caja de 50 u\. = 5 cajas \/ 450 u\./);
    expect(deliveries.map((d) => d.observations)).toEqual(["primera", null, "con caja incompleta"]);
    expect(totals).toEqual({ received: 1850, remitted: 0, available: 1850, cajas: 19 });
  });

  it("2-4, 12) un remito por entrega; remito por parte de una entrega; no se remiten dos veces las mismas unidades; dos usuarios a la vez", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "1850");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 600, [{ cajas: 6, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const r = await rem();
    const [d1, d2, d3] = (await r.listDeliveriesOfWork(id)).deliveries;
    // un remito por entrega, con sus cajas, sin volver a cargar nada
    const a = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d1!.deliveryLineId });
    const b = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d2!.deliveryLineId });
    expect(a.remito.id).not.toBe(b.remito.id); // individuales, aunque sean del mismo cliente y fecha
    expect(a.remito.lines[0]).toMatchObject({ totalUnits: 800, cajas1: 8, unidades1: 100 });
    expect(b.remito.lines[0]).toMatchObject({ totalUnits: 600, cajas1: 6, unidades1: 100 });
    expect(a.remito.lines[0]!.trace).toMatchObject({ deliveryLineId: d1!.deliveryLineId, deliverySequence: 1, deliveredQuantity: 800 });
    let t = (await r.listDeliveriesOfWork(id)).totals;
    expect(t).toEqual({ received: 1850, remitted: 1400, available: 450, cajas: 19 });
    // la 1.ª ya remitida por completo NO vuelve a ofrecerse ni a remitirse
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d1!.deliveryLineId })).rejects.toThrow(/ya figura completa en remitos vigentes/);
    expect((await r.listAvailableDeliveries({ lineIds: [d1!.deliveryLineId] }))).toHaveLength(0);
    // remito por PARTE de la 3.ª: 300 de 450, con cajas informadas por Producción; nunca más de lo que queda
    const part = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d3!.deliveryLineId, quantity: 300, packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }] });
    expect(part.remito.lines[0]).toMatchObject({ totalUnits: 300, cajas1: 3, unidades1: 100 });
    expect(part.available).toBe(150);
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d3!.deliveryLineId, quantity: 200 })).rejects.toThrow(/Solo quedan 150 u\./);
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d3!.deliveryLineId, quantity: 150, packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }] })).rejects.toThrow(/Las cajas suman 100 u\./); // cajas inconsistentes
    // sin cajas informadas en un remito parcial: no se inventan (el borrador queda para completar)
    const rest = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d3!.deliveryLineId, quantity: 150 });
    expect(rest.remito.lines[0]).toMatchObject({ totalUnits: 150, cajas1: 0 });
    expect(rest.available).toBe(0);
    t = (await r.listDeliveriesOfWork(id)).totals;
    expect(t).toMatchObject({ remitted: 1850, available: 0 });
    // ejemplo del pedido: entrega de 800, remito de 500 → saldo 300 → segundo remito 300 sí, 400 nunca; doble envío = mismo remito
    const id2 = await newWork("ENVASADO_PREMIUM", "2000", "800");
    await deliver(premium, id2, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    const [e] = (await r.listDeliveriesOfWork(id2)).deliveries;
    const first = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: e!.deliveryLineId, quantity: 500, packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }], requestId: "req-A" });
    const again = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: e!.deliveryLineId, quantity: 500, packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }], requestId: "req-A" });
    expect(again.replayed).toBe(true);
    expect(again.remito.id).toBe(first.remito.id);
    expect(first.available).toBe(300);
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: e!.deliveryLineId, quantity: 400 })).rejects.toThrow(/Solo quedan 300 u\./);
    // 12) dos usuarios a la vez por las mismas unidades: solo uno
    const [x, y] = await Promise.allSettled([
      r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: e!.deliveryLineId, quantity: 300, packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }], requestId: "u1" }),
      r.prepareRemitoFromDelivery(asRemitoActor(prod2), { deliveryLineId: e!.deliveryLineId, quantity: 300, packingGroups: [{ cajas: 3, unidadesPorCaja: 100 }], requestId: "u2" }),
    ]);
    expect([x, y].filter((p) => p.status === "fulfilled")).toHaveLength(1);
    expect(((([x, y].find((p) => p.status === "rejected")) as PromiseRejectedResult).reason as Error).message).toMatch(/ya figura completa|Solo quedan/);
    const total = (await remitoRows(e!.deliveryLineId)).reduce((s, rr) => s + Number(rr.units), 0);
    expect(total).toBe(800); // jamás más de lo recibido
  });

  it("2) el flujo masivo «Hacer remito» tampoco duplica: dos usuarios con la misma entrega → una sola gana", async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000", "1000");
    await deliver(masivo, id, 1000, [{ cajas: 10, unidadesPorCaja: 100 }]);
    const [d] = (await (await rem()).listDeliveriesOfWork(id)).deliveries;
    const { createRemitoDraftsFromDeliveries } = await import("@/lib/remitos/from-deliveries");
    const results = await Promise.allSettled([createRemitoDraftsFromDeliveries(asRemitoActor(prod), [d!.deliveryLineId]), createRemitoDraftsFromDeliveries(asRemitoActor(prod2), [d!.deliveryLineId])]);
    const ok = results.filter((p) => p.status === "fulfilled") as Array<PromiseFulfilledResult<{ remitos: unknown[]; skipped: string[] }>>;
    // el segundo no puede crear otro remito por las mismas unidades (error o entrega «skipped»)
    expect(ok.filter((p) => p.value.remitos.length > 0)).toHaveLength(1);
    expect((await remitoRows(d!.deliveryLineId)).reduce((s, rr) => s + Number(rr.units), 0)).toBe(1000);
  });

  it("5) anular un remito emitido libera sus unidades UNA vez, sin tocar la entrega ni el inventario", async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000", "800");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    const r = await rem();
    const [d] = (await r.listDeliveriesOfWork(id)).deliveries;
    const made = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d!.deliveryLineId });
    await markEmitted(made.remito.id);
    const stock0 = await stockCounts();
    const linesBefore = JSON.stringify(await lines(id));
    expect((await r.listDeliveriesOfWork(id)).totals).toMatchObject({ remitted: 800, available: 0 });
    await (await remitoSvc()).annul(asRemitoActor(prod), made.remito.id, "error de carga");
    expect((await r.listDeliveriesOfWork(id)).totals).toMatchObject({ received: 800, remitted: 0, available: 800 }); // disponible UNA vez, no 1.600
    expect(await stockCounts()).toBe(stock0); // sin movimientos de inventario por anular un documento
    expect(JSON.stringify(await lines(id))).toBe(linesBefore); // la entrega no cambia
    // se puede volver a remitir esas 800 (y solo esas)
    await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d!.deliveryLineId });
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d!.deliveryLineId, quantity: 1 })).rejects.toThrow(/ya figura completa/);
  });

  it("6-7) entrega no remitida se corrige; con remito vigente se bloquea lo incompatible (800 → 600, cancelar, cambiar cajas) y se habilita al anular el remito", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "1400");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await deliver(masivo, id, 600, [{ cajas: 6, unidadesPorCaja: 100 }]);
    const r = await rem();
    const svc = await ids();
    const [d1, d2] = (await r.listDeliveriesOfWork(id)).deliveries;
    // la 2.ª todavía no está remitida: se corrige sin problemas
    expect((await svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, quantity: 500, packingGroups: [{ cajas: 5, unidadesPorCaja: 100 }] })).delivery).toMatchObject({ quantity: 500, available: 500 });
    // remito emitido por la 1.ª
    const made = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d1!.deliveryLineId });
    await markEmitted(made.remito.id);
    const L1 = d1!.deliveryLineId;
    await expect(svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: L1, quantity: 600, packingGroups: [{ cajas: 6, unidadesPorCaja: 100 }] })).rejects.toThrow(/No se puede bajar la entrega a 600 u\.: 800 u\. ya figuran/);
    await expect(svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: L1, packingGroups: [{ cajas: 4, unidadesPorCaja: 200 }] })).rejects.toThrow(/No se pueden cambiar las cajas/);
    await expect(svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: L1, reason: "x" })).rejects.toThrow(/No se puede cancelar/);
    await expect(svc.editDeliveredWork(prod as never, { workItemId: id, edits: [{ id: L1, quantity: 600, packingGroups: [{ cajas: 6, unidadesPorCaja: 100 }] }] })).rejects.toThrow(/ya figuran/);
    const { annulDeliveryDurable } = await import("@/lib/planning/work-item-progress-repository");
    const aggId = String((await q("select delivery_id from work_item_delivery_lines where id = $1", [L1]))[0]!.delivery_id);
    await expect(annulDeliveryDurable(aggId, "x", "IT")).rejects.toThrow(/No se puede anular la entrega/); // la anulación del registro de entrega tampoco se salta el remito
    expect(Number((await lines(id))[0]!.quantity)).toBe(800); // intacta: no queda un remito de 800 sobre una entrega de 600
    // lo compatible sí: observaciones, y subir la cantidad
    expect((await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: L1, observations: "contada dos veces" })).delivery.observations).toBe("contada dos veces");
    // al anular el remito, la corrección queda habilitada
    await (await remitoSvc()).annul(asRemitoActor(prod), made.remito.id, "reemplazo");
    expect((await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: L1, quantity: 600, packingGroups: [{ cajas: 6, unidadesPorCaja: 100 }] })).delivery).toMatchObject({ quantity: 600, available: 600 });
  });

  it("4, 7) un borrador editado no puede remitir más unidades que las recibidas; el remito anulado/emitido sigue vinculado a lo que remitió", async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000", "800");
    await deliver(masivo, id, 800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    const r = await rem();
    const [d] = (await r.listDeliveriesOfWork(id)).deliveries;
    const made = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d!.deliveryLineId });
    const lineId = made.remito.lines[0]!.id;
    await expect((await remitoSvc()).updateDraft(asRemitoActor(prod), made.remito.id, { lines: [{ id: lineId, cajas1: 9, unidades1: 100 }] })).rejects.toThrow(/remita 900 u\. pero la entrega solo tiene 800/);
    const ok = await (await remitoSvc()).updateDraft(asRemitoActor(prod), made.remito.id, { lines: [{ id: lineId, cajas1: 7, unidades1: 100, cajas2: 1, unidades2: 100 }] });
    expect(ok.lines[0]!.totalUnits).toBe(800); // reacomodar cajas sin cambiar el total es válido
  });

  it("8, 9) Envasado → Codificado → Producción: sin doble conteo; las cajas de Envasado llegan al remito; muestras intactas", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000", "2050");
    await q("update work_items set sample_units = 3 where id = $1", [id]);
    const tr = async (qty: number, boxes: Boxes) => (await trans()).transferToCodificadoDurable({ workItemId: id, quantity: qty, finishedQty: 2050, packingGroups: boxes, idempotencyKey: randomUUID() }, masivo as never);
    await tr(800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await tr(800, [{ cajas: 8, unidadesPorCaja: 100 }]);
    await tr(450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    const childId = String((await q("select id from work_items where parent_work_item_id = $1", [id]))[0]!.id);
    const r = await rem();
    // las entregas internas no son entregas a Producción: nada para remitir todavía
    expect((await r.listDeliveriesOfWork(id)).deliveries).toHaveLength(0);
    expect((await r.listDeliveriesOfWork(childId)).deliveries).toHaveLength(0);
    const { deliverFromCodificadoDurable } = await import("@/lib/planning/codificado-handoff-service");
    await deliverFromCodificadoDurable({ workItemId: childId, deliverQuantity: 1600, idempotencyKey: `${randomUUID()}-cod1` } as never, codif as never);
    const w = await r.listDeliveriesOfWork(childId);
    expect(w.deliveries).toHaveLength(1);
    // Codificado entregó sin informar cajas: no se inventan ni se reparten las de Envasado (regla «no asumir embalaje»).
    expect(w.totals).toMatchObject({ received: 1600, remitted: 0, available: 1600, cajas: 0 });
    expect(w.deliveries[0]).toMatchObject({ sourceSector: "CODIFICADO" });
    // Producción completa las cajas antes de emitir; deben sumar las unidades del remito.
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: w.deliveries[0]!.deliveryLineId, packingGroups: [{ cajas: 15, unidadesPorCaja: 100 }] })).rejects.toThrow();
    const made = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: w.deliveries[0]!.deliveryLineId, packingGroups: [{ cajas: 16, unidadesPorCaja: 100 }] });
    expect(made.remito.lines[0]).toMatchObject({ totalUnits: 1600 });
    // entregar el resto: la entrega 2 de Codificado no repite las unidades ya entregadas
    await deliverFromCodificadoDurable({ workItemId: childId, deliverQuantity: 450, idempotencyKey: `${randomUUID()}-cod2` } as never, codif as never);
    const w2 = await r.listDeliveriesOfWork(childId);
    expect(w2.totals.received).toBe(2050);
    expect((await q("select sample_units from work_items where id = $1", [id]))[0]!.sample_units).toBe(3); // las muestras son metadata: no se descuentan ni se duplican
    expect(Number((await q("select coalesce(sum(quantity),0)::float8 s from work_item_codificado_transfers where work_item_id = $1 and status = 'ACTIVA'", [id]))[0]!.s)).toBe(2050);
  });

  it("11 + F) cancelar una entrega: deja de sumar y de ofrecerse; el trabajo y el pedido dejan de figurar ENTREGADO", async () => {
    const [pedido] = await q("insert into production_pedidos (op, cliente, producto, estado) values ($1, $2, 'x', 'EN_ENVASADO') returning id", [`IT-RP-${RUN}`, CLIENT]);
    const pid = String(pedido!.id);
    const id = await newWork("ENVASADO_MASIVO", "1000", "1000", pid);
    await deliver(masivo, id, 1000, [{ cajas: 10, unidadesPorCaja: 100 }]);
    expect((await q("select estado from production_pedidos where id = $1", [pid]))[0]!.estado).toBe("ENTREGADO");
    const r = await rem();
    const svc = await ids();
    const [d] = (await r.listDeliveriesOfWork(id)).deliveries;
    await svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: d!.deliveryLineId, reason: "no salió" });
    expect((await r.listDeliveriesOfWork(id)).totals).toEqual({ received: 0, remitted: 0, available: 0, cajas: 0 });
    expect(await r.listAvailableDeliveries({ lineIds: [d!.deliveryLineId] })).toHaveLength(0);
    expect((await q("select operational_status from work_items where id = $1", [id]))[0]!.operational_status).not.toBe("entregado");
    // hallazgo real: el pedido seguía ENTREGADO aunque su trabajo ya no lo estuviera
    expect((await q("select estado from production_pedidos where id = $1", [pid]))[0]!.estado).toBe("EN_ENVASADO");
    expect((await q("select event from production_pedido_status_events where pedido_id = $1 order by created_at", [pid])).map((e) => e.event)).toEqual(["ALL_WORK_DELIVERED", "DELIVERY_REVERTED"]);
    // una cancelación no deja cantidades fantasma: la entrega cancelada se conserva pero no suma
    expect((await lines(id))[0]).toMatchObject({ status: "ANULADA" });
  });

  it("14, I) permisos y datos históricos: Depósito/Envasado no preparan remitos ni editan trabajos; una entrega histórica sin renglones no se ofrece ni se duplica", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    // entrega histórica: registro de entrega SIN renglones (anterior al seguimiento parcial) → no hay nada que remitir por este módulo
    await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
       values ($1, 'hist', $2, 'ENVASADO_MASIVO', '2000', 'un.', now(), 'hist', 'ENVASADO_MASIVO', 'ENTREGADO')`, [id, CLIENT]);
    const r = await rem();
    expect((await r.listDeliveriesOfWork(id)).deliveries).toHaveLength(0);
    expect((await r.listAvailableDeliveries()).some((d) => d.workItemId === id)).toBe(false);
    // remito histórico con la clave vieja `dl:<id>` (sin sufijo): sigue contando como remitido por el total de su renglón
    const wid = await newWork("ENVASADO_MASIVO", "300", "300");
    await deliver(masivo, wid, 300, [{ cajas: 3, unidadesPorCaja: 100 }]);
    const [d] = (await r.listDeliveriesOfWork(wid)).deliveries;
    const [rm] = await q("insert into remitos (remito_number, client_id_normalized, client_display, delivery_date, status) values ($1,'it-rp','IT RP', current_date, 'GENERADO') returning id", [`IT-RP-OLD-${RUN}`]);
    await q("insert into remito_lines (remito_id, work_item_id, product, total_units) values ($1, $2, 'x', 300)", [rm!.id, `dl:${d!.deliveryLineId}`]);
    expect((await r.listDeliveriesOfWork(wid)).totals).toMatchObject({ remitted: 300, available: 0 });
    // permisos del servidor (ver también la API en el E2E)
    const svc = await ids();
    await expect(svc.editDeliveredWork(deposito as never, { workItemId: wid, edits: [{ id: d!.deliveryLineId, observations: "x" }] })).rejects.toThrow(/Solo Producción/);
    await expect(svc.editInternalDelivery(premium as never, { kind: "PRODUCCION", id: d!.deliveryLineId, observations: "x" })).rejects.toThrow(/tu propio sector/);
  });
});
