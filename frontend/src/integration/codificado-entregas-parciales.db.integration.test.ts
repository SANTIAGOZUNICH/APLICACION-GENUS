/**
 * Entregas parciales de CODIFICADO → Producción (con cajas), edición/cancelación, remitos por entrega y no duplicación de las cajas de Envasado.
 * Postgres de PRUEBA real; datos ficticios «IT CP». Se SALTA sin base marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT CP CLIENTE ${RUN}`;
const prod = { email: "it-cp-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-cp-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-cp-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-cp-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const deposito = { email: "it-cp-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "IT Depósito" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;
const asRemitoActor = (a: { email: string; sector: string }) => ({ email: a.email, sector: a.sector }) as never;
const B100 = (n: number): Boxes => [{ cajas: n, unidadesPorCaja: 100 }];

describe.skipIf(Boolean(PROBLEM))(`Codificado: entregas parciales con cajas${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, { timeout: 60_000 }, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const rem = () => import("@/lib/remitos/delivery-remittance");
  const ids = () => import("@/lib/planning/internal-deliveries-service");
  const trans = () => import("@/lib/planning/codificado-transfer-service");
  const handoff = () => import("@/lib/planning/codificado-handoff-service");

  beforeAll(async () => {
    process.env.VITEST = "false";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
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

  /** Trabajo de Envasado + sus entregas a Codificado (con las cajas de Envasado) → trabajo hijo de Codificado. */
  const received = async (planned: string, transfers: Array<[number, Boxes]>, pedidoId: string | null = null) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable({ sector: "ENVASADO_MASIVO", client: CLIENT, product: `Serum CP ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: planned, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(600000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-CP", idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const parent = r.item.id as string;
    const total = transfers.reduce((s, t) => s + t[0], 0);
    await q("update work_items set finished_qty = $1 where id = $2", [String(total), parent]);
    if (pedidoId) await q("update work_items set production_pedido_id = $1 where id = $2", [pedidoId, parent]);
    for (const [qty, boxes] of transfers) await (await trans()).transferToCodificadoDurable({ workItemId: parent, quantity: qty, finishedQty: total, packingGroups: boxes, idempotencyKey: randomUUID() }, masivo as never);
    const child = String((await q("select id from work_items where parent_work_item_id = $1", [parent]))[0]!.id);
    return { parent, child };
  };
  const deliver = async (actor: { email: string; sector: string; displayName: string }, workItemId: string, qty: number | null, boxes: Boxes | null = null, observation: string | null = null, key = `${randomUUID()}-cp`) =>
    (await handoff()).deliverFromCodificadoDurable({ workItemId, deliverQuantity: qty, deliveryPackingGroups: boxes, observation, idempotencyKey: key } as never, actor as never);
  const lines = (workItemId: string) => q("select id, sequence, quantity::float8 as quantity, status, packing_groups, source_sector, observations from work_item_delivery_lines where work_item_id = $1 order by sequence", [workItemId]);
  const status = async (id: string) => (await q("select operational_status from work_items where id = $1", [id]))[0]!.operational_status as string;

  const ENVASADO_BOXES: Array<[number, Boxes]> = [[800, B100(8)], [800, B100(8)], [450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]]];

  it("1-5) Codificado entrega 800 + 600 + 650 con cajas: cada entrega por separado en Producción; total 2.050 u. en 21 cajas; el trabajo se cierra recién en la última", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    const r1 = await deliver(codif, child, 800, B100(8), "primera tanda");
    expect(r1).toMatchObject({ complete: false, delivered: 800, pending: 1250 });
    expect(await status(child)).not.toBe("entregado");
    const r2 = await deliver(codif, child, 600, B100(6));
    expect(r2).toMatchObject({ complete: false, delivered: 1400 });
    const r3 = await deliver(codif, child, 650, [{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    expect(r3).toMatchObject({ complete: true, delivered: 2050, pending: 0 });
    expect(await status(child)).toBe("entregado");

    const ls = await lines(child);
    expect(ls.map((l) => [l.sequence, l.quantity, l.source_sector, l.status])).toEqual([[1, 800, "CODIFICADO", "ACTIVA"], [2, 600, "CODIFICADO", "ACTIVA"], [3, 650, "CODIFICADO", "ACTIVA"]]);
    const { deliveries, totals } = await (await rem()).listDeliveriesOfWork(child);
    expect(deliveries.map((d) => [d.sequence, d.delivered, d.cajas, d.sourceSector, d.client, d.lote])).toEqual([[1, 800, 8, "CODIFICADO", CLIENT, "L-IT-CP"], [2, 600, 6, "CODIFICADO", CLIENT, "L-IT-CP"], [3, 650, 7, "CODIFICADO", CLIENT, "L-IT-CP"]]);
    expect(deliveries[2]!.boxesText).toMatch(/6 cajas de 100 u\. \+ 1 caja de 50 u\. = 7 cajas \/ 650 u\./);
    expect(deliveries[0]!.observations).toBe("primera tanda");
    expect(totals).toEqual({ received: 2050, remitted: 0, available: 2050, cajas: 21 });
    // las propias cajas de Codificado, no las de Envasado: 21 (8+6+7), no 21 + 21
    expect(deliveries.every((d) => d.packingSource === "ENTREGA")).toBe(true);
  });

  it("6, 7) cajas inválidas se rechazan sin registrar nada; entregar sin cajas es válido (no se inventa embalaje)", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    await expect(deliver(codif, child, 100, [{ cajas: 0, unidadesPorCaja: 100 }])).rejects.toThrow();
    expect(await lines(child)).toHaveLength(0);
    const sinCajas = await deliver(codif, child, 500, null);
    expect(sinCajas).toMatchObject({ delivered: 500 });
    const [l] = await lines(child);
    expect(l!.packing_groups).toBeNull();
    const { deliveries } = await (await rem()).listDeliveriesOfWork(child);
    // las cajas de Envasado (800+800+450) NO se asignan a una entrega parcial distinta (500)
    expect(deliveries[0]).toMatchObject({ delivered: 500, cajas: 0 });
    // 8 × 100 + 1 × 50 = 850 (cajas incompletas)
    const inc = await deliver(codif, child, 850, [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    expect(inc).toMatchObject({ delivered: 1350 });
    expect((await (await rem()).listDeliveriesOfWork(child)).deliveries[1]).toMatchObject({ delivered: 850, cajas: 9 });
  });

  it("cajas que no suman las unidades declaradas NO bloquean: se registra la cantidad real y las cajas informadas quedan aparte (diferencia por conciliar)", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    const r = await deliver(codif, child, 850, B100(8)); // declara 850, cajas = 800
    expect(r).toMatchObject({ delivered: 850 });
    const [l] = await lines(child);
    expect(l).toMatchObject({ quantity: 850 });
    expect(l!.packing_groups).toEqual([{ cajas: 8, unidadesPorCaja: 100 }]);
  });

  it("12, 13) cajas de Envasado: Codificado informa las suyas (no se suman a las de Envasado); sin cajas propias solo se heredan cuando la entrega completa coincide", async () => {
    // Codificado cambia la distribución: 800 u. en 4 × 200 (Envasado había informado 8 × 100)
    const a = await received("2000", ENVASADO_BOXES);
    await deliver(codif, a.child, 800, [{ cajas: 4, unidadesPorCaja: 200 }]);
    // el resto SIN cajas: no se le asignan las consolidadas de Envasado (2.050 u. ≠ 1.250 u.)
    await deliver(codif, a.child, 1250, null);
    const w = await (await rem()).listDeliveriesOfWork(a.child);
    expect(w.deliveries.map((d) => [d.delivered, d.cajas])).toEqual([[800, 4], [1250, 0]]);
    expect(w.totals).toMatchObject({ received: 2050, cajas: 4 });
    // entrega COMPLETA (2.050 de una vez) sin cajas propias: se reutilizan las de Envasado una sola vez (correspondencia verificable)
    const b = await received("2000", ENVASADO_BOXES);
    await deliver(codif, b.child, null, null);
    const wb = await (await rem()).listDeliveriesOfWork(b.child);
    expect(wb.deliveries).toHaveLength(1);
    expect(wb.deliveries[0]).toMatchObject({ delivered: 2050, cajas: 21, packingSource: "TRABAJO" });
    expect(wb.totals).toMatchObject({ received: 2050, cajas: 21 });
    // total de unidades: ni Envasado ni Codificado duplican
    expect(Number((await q("select coalesce(sum(quantity),0)::float8 s from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [b.child]))[0]!.s)).toBe(2050);
  });

  it("14) más de lo solicitado: 2.000 pedidas, 2.050 recibidas y procesadas → se pueden entregar 2.050; el límite es lo recibido, no lo pedido", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    await expect(deliver(codif, child, 2100, null)).rejects.toThrow(/Solo hay 2050 unidades recibidas sin entregar/);
    const r = await deliver(codif, child, 2050, null, "50 unidades de más");
    expect(r).toMatchObject({ complete: true, delivered: 2050, pending: 0 });
    expect(await status(child)).toBe("entregado");
    // recibidas < pedidas: entregar todo lo recibido NO cierra el trabajo (quedan unidades por recibir)
    const p = await received("2000", [[800, B100(8)], [800, B100(8)]]);
    const part = await deliver(codif, p.child, 1600, null);
    expect(part.complete).toBe(false);
    expect(await status(p.child)).not.toBe("entregado");
    await expect(deliver(codif, p.child, 1, null)).rejects.toThrow(/no tiene unidades recibidas pendientes/);
  });

  it("8, 9, 16) Codificado edita y cancela SUS entregas; Envasado/Depósito no; Producción corrige; la cancelación deja de sumar y queda auditada", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    await deliver(codif, child, 800, B100(8));
    await deliver(codif, child, 600, B100(6));
    const svc = await ids();
    const [d1, d2] = (await (await rem()).listDeliveriesOfWork(child)).deliveries;
    // Codificado edita unidades, cajas y observación de su entrega
    const edited = await svc.editInternalDelivery(codif as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, quantity: 850, packingGroups: [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], observations: "se contó una caja más" });
    expect(edited.delivery).toMatchObject({ quantity: 850, cajas: 9, observations: "se contó una caja más" });
    expect((await (await rem()).listDeliveriesOfWork(child)).totals).toMatchObject({ received: 1450, cajas: 15 });
    // no puede entregarse más de lo recibido por vía de edición (2.050 recibidas)
    await expect(svc.editInternalDelivery(codif as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, quantity: 2100, packingGroups: B100(21) })).rejects.toThrow();
    // permisos: otros sectores no tocan entregas de Codificado
    await expect(svc.editInternalDelivery(masivo as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, observations: "x" })).rejects.toThrow(/Solo podés modificar las entregas/);
    await expect(svc.editInternalDelivery(premium as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, observations: "x" })).rejects.toThrow();
    await expect(svc.cancelInternalDelivery(deposito as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, reason: "x" })).rejects.toThrow();
    // Producción también corrige
    expect((await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, observations: "revisada por Producción" })).delivery.observations).toBe("revisada por Producción");
    // cancelar: sus unidades y cajas dejan de sumar; el historial se conserva
    const cancelled = await svc.cancelInternalDelivery(codif as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, reason: "entrega duplicada" });
    expect(cancelled.delivery.status).toBe("CANCELADA");
    const after = await (await rem()).listDeliveriesOfWork(child);
    expect(after.deliveries.map((d) => d.delivered)).toEqual([850]);
    expect(after.totals).toMatchObject({ received: 850, cajas: 9 });
    const history = await svc.getInternalDeliveryHistory(prod as never, "PRODUCCION", d2!.deliveryLineId);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["EDITAR", "CANCELAR"]));
    // lo cancelado vuelve a estar disponible para entregar (de lo recibido), sin negativos
    const again = await deliver(codif, child, 1200, null);
    expect(again.delivered).toBe(2050);
  });

  it("10, 11) Preparar remito de cada entrega parcial de Codificado: dos remitos distintos, sin mezclar ni duplicar; con remito vigente no se modifica en silencio", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    await deliver(codif, child, 800, B100(8));
    await deliver(codif, child, 600, B100(6));
    const r = await rem();
    const [d1, d2] = (await r.listDeliveriesOfWork(child)).deliveries;
    const a = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d1!.deliveryLineId });
    const b = await r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d2!.deliveryLineId });
    expect(a.remito.id).not.toBe(b.remito.id);
    expect(a.remito.lines[0]).toMatchObject({ totalUnits: 800, cajas1: 8, unidades1: 100, lote: "L-IT-CP" });
    expect(b.remito.lines[0]).toMatchObject({ totalUnits: 600, cajas1: 6, unidades1: 100 });
    await expect(r.prepareRemitoFromDelivery(asRemitoActor(prod), { deliveryLineId: d1!.deliveryLineId })).rejects.toThrow(/ya figura completa en remitos vigentes/);
    expect((await r.listDeliveriesOfWork(child)).totals).toEqual({ received: 1400, remitted: 1400, available: 0, cajas: 14 });
    const svc = await ids();
    await expect(svc.cancelInternalDelivery(codif as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, reason: "x" })).rejects.toThrow(/No se puede cancelar/);
    await expect(svc.editInternalDelivery(codif as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, quantity: 700, packingGroups: B100(7) })).rejects.toThrow(/No se puede bajar/);
  });

  it("15) doble clic = misma entrega; dos entregas simultáneas no pueden superar lo recibido", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    const key = `${randomUUID()}-dc`;
    const [x, y] = await Promise.all([deliver(codif, child, 500, B100(5), null, key), deliver(codif, child, 500, B100(5), null, key)]);
    expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
    expect(await lines(child)).toHaveLength(1);
    // 2.050 recibidas, 500 entregadas → quedan 1.550: dos entregas simultáneas de 1.000 NO pueden pasar las dos
    const res = await Promise.allSettled([deliver(codif, child, 1000, null), deliver(codif, child, 1000, null)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const total = Number((await q("select coalesce(sum(quantity),0)::float8 s from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [child]))[0]!.s);
    expect(total).toBe(1500);
  });

  it("16) permisos: solo Codificado, Producción y Dirección entregan desde Codificado", async () => {
    const { child } = await received("2000", ENVASADO_BOXES);
    await expect(deliver(masivo, child, 100, null)).rejects.toThrow(/Solo Codificado puede entregar/);
    await expect(deliver(deposito, child, 100, null)).rejects.toThrow();
    expect(await lines(child)).toHaveLength(0);
    expect(await deliver(prod, child, 100, null)).toMatchObject({ delivered: 100 });
  });

  it("11, 17) cancelar la última entrega vuelve el trabajo y el pedido a «no entregado»; persisten tras releer", async () => {
    const [pedido] = await q("insert into production_pedidos (op, cliente, producto, estado) values ($1, $2, 'x', 'EN_ENVASADO') returning id", [`IT-CP-${RUN}`, CLIENT]);
    const { child } = await received("2000", ENVASADO_BOXES, String(pedido!.id));
    await deliver(codif, child, 2050, null);
    expect(await status(child)).toBe("entregado");
    const [d] = (await (await rem()).listDeliveriesOfWork(child)).deliveries;
    await (await ids()).cancelInternalDelivery(codif as never, { kind: "PRODUCCION", id: d!.deliveryLineId, reason: "error de carga" });
    expect(await status(child)).not.toBe("entregado");
    expect((await (await rem()).listDeliveriesOfWork(child)).totals).toEqual({ received: 0, remitted: 0, available: 0, cajas: 0 });
    expect(await lines(child)).toHaveLength(1); // la entrega cancelada se conserva en el historial
  });
});
