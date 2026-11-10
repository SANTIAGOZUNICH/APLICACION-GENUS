/**
 * La cantidad SOLICITADA es una referencia de planificación, no un tope: Envasado / Codificado / Elaboración contra Postgres de PRUEBA.
 * Pedido 1.200 → realizadas 1.235 → parciales 605 + 630 (cada una con SUS cajas), «Entregar todo» con 1.235, 70 kg sobre una OE de 60 kg.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/cantidades-reales.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT CR CLIENTE ${RUN}`;
const prod = { email: "it-cr-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT CR Producción" };
const masivo = { email: "it-cr-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT CR Masivo" };
const elab = { email: "it-cr-elab@laboratoriogenus.com.ar", sector: "ELABORACION" as const, displayName: "IT CR Elaboración" };
const codif = { email: "it-cr-codif@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT CR Codificado" };
type Boxes = Array<{ cajas: number; unidadesPorCaja: number }>;
const B1: Boxes = [{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }]; // 605
const B2: Boxes = [{ cajas: 6, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 30 }]; // 630

describe.skipIf(Boolean(PROBLEM))(`Cantidades reales (sobreproducción) en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  beforeAll(async () => {
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

  const newWork = async (sector: string, qty: string, unit = "un.", extra: Record<string, unknown> = {}) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable(
      { sector, client: CLIENT, product: `Prod CR ${RUN}-${Math.random().toString(36).slice(2, 6)}`, plannedQuantity: qty, unit, plannedDate: "2031-06-10", ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), orderNumber: `${sector === "ELABORACION" ? "OE" : "OA"}-2026-${String(500000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "IT-CR", idempotencyKey: randomUUID(), ...extra } as never,
      prod,
      randomUUID()
    );
    return r.item.id as string;
  };
  const deliver = async (actor: { email: string; sector: string; displayName: string }, workItemId: string, over: Record<string, unknown>) => {
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    return deliverWorkDurable({ workItemId, codigo: null, sourceSector: actor.sector, plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, idempotencyKey: randomUUID(), ...over } as never, actor as never);
  };
  const partial = (id: string, qty: number, realizadas: number, boxes: Boxes | null) =>
    deliver(masivo, id, { partial: true, deliverQuantity: qty, deliveryPackingGroups: boxes, completion: { finishedQty: String(realizadas) } });
  const lines = (id: string) => q("select sequence, quantity::float8 q, kind, status, cumulative_after::float8 cum, pending_after::float8 pend, packing_groups from work_item_delivery_lines where work_item_id = $1 order by sequence", [id]);
  const item = async (id: string) => (await q("select operational_status, planned_quantity, finished_qty, completed_at from work_items where id = $1", [id]))[0]!;

  it("ENVASADO: pedido 1.200, realizadas 1.235 → parcial 605 (7 cajas) + 630 (7 cajas) = 1.235; completado, sin pendiente negativo", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    const r1 = await partial(id, 605, 1235, B1);
    expect(r1).toMatchObject({ delivered: 605, complete: false });
    expect((await item(id)).operational_status).not.toBe("entregado");
    const r2 = await partial(id, 630, 1235, B2);
    expect(r2).toMatchObject({ delivered: 1235, pending: 0, complete: true });
    expect((await item(id)).operational_status).toBe("entregado");
    expect(String((await item(id)).planned_quantity)).toBe("1200"); // lo solicitado no se toca
    const ls = await lines(id);
    expect(ls.map((l) => l.q)).toEqual([605, 630]);
    expect(ls.map((l) => l.pend).every((p) => p >= 0)).toBe(true);
    expect(ls.map((l) => l.cum)).toEqual([605, 1235]);
    expect(ls[0]!.packing_groups).toEqual(B1);
    expect(ls[1]!.packing_groups).toEqual(B2);
    const { listDeliveriesOfWork } = await import("@/lib/remitos/delivery-remittance");
    const w = await listDeliveriesOfWork(id);
    expect(w.deliveries.map((d) => [d.delivered, d.cajas])).toEqual([[605, 7], [630, 7]]);
    expect(w.totals).toMatchObject({ received: 1235, cajas: 14 });
  });

  it("ENVASADO: entregadas 1.200 de 1.235 realizadas → quedan 35 reales por entregar (no se ocultan) y al entregarlas queda todo entregado", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    const r1 = await partial(id, 1200, 1235, [{ cajas: 12, unidadesPorCaja: 100 }]);
    expect(r1).toMatchObject({ delivered: 1200, pending: 35, complete: false });
    expect((await item(id)).operational_status).not.toBe("entregado");
    const r2 = await partial(id, 35, 1235, [{ cajas: 1, unidadesPorCaja: 35 }]);
    expect(r2).toMatchObject({ delivered: 1235, pending: 0, complete: true });
    expect((await item(id)).operational_status).toBe("entregado");
    await partial(id, 1, 1235, null).catch(() => undefined); // ya entregado todo: un reintento con otra clave no entrega de más
    expect((await lines(id)).map((l) => l.q)).toEqual([1200, 35]);
  });

  it("ENVASADO: «Entregar todo» con 1.235 realizadas entrega las 1.235 (no recorta a 1.200); cajas = las de esas 1.235", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    const r = await deliver(masivo, id, { completion: { finishedQty: "1235", packingGroups: [{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 35 }], sampleUnits: 0 } });
    expect(r).toMatchObject({ delivered: 1235, complete: true });
    expect((await lines(id)).map((l) => l.q)).toEqual([1235]);
    expect((await item(id)).operational_status).toBe("entregado");
  });

  it("ENVASADO: parcial 605 y luego «Entregar todo» los 630 restantes con SUS cajas (no se exigen las cajas del trabajo completo)", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    await partial(id, 605, 1235, B1);
    const r = await deliver(masivo, id, { completion: { finishedQty: "1235" }, deliveryPackingGroups: B2 });
    expect(r).toMatchObject({ delivered: 1235, complete: true });
    expect((await lines(id)).map((l) => l.q)).toEqual([605, 630]);
  });

  it("ENVASADO sin sobreproducción sigue igual: 1.200 → 700 + 500", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    expect(await partial(id, 700, 1200, [{ cajas: 7, unidadesPorCaja: 100 }])).toMatchObject({ delivered: 700, pending: 500, complete: false });
    expect(await partial(id, 500, 1200, [{ cajas: 5, unidadesPorCaja: 100 }])).toMatchObject({ delivered: 1200, pending: 0, complete: true });
  });

  it("ENVASADO: editar una parcial recalcula cantidad, cajas, acumulado y pendientes; cancelar la descuenta y la deja en el historial", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    await partial(id, 605, 1235, B1);
    await partial(id, 630, 1235, B2);
    const svc = await import("@/lib/planning/internal-deliveries-service");
    const rem = await import("@/lib/remitos/delivery-remittance");
    const [d1, d2] = (await rem.listDeliveriesOfWork(id)).deliveries;
    const ed = await svc.editInternalDelivery(prod as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, quantity: 600, packingGroups: [{ cajas: 6, unidadesPorCaja: 100 }] });
    expect(ed.delivery).toMatchObject({ quantity: 600, cajas: 6 });
    let w = await rem.listDeliveriesOfWork(id);
    expect(w.totals).toMatchObject({ received: 1205, cajas: 13 });
    expect((await item(id)).operational_status).not.toBe("entregado"); // quedan 30 realizadas sin entregar
    const cancelled = await svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: d2!.deliveryLineId, reason: "se contó mal" });
    expect(cancelled.delivery.status).toBe("CANCELADA");
    w = await rem.listDeliveriesOfWork(id);
    expect(w.deliveries.map((d) => d.delivered)).toEqual([605]);
    expect(w.totals).toMatchObject({ received: 605, cajas: 7 });
    const history = await svc.getInternalDeliveryHistory(prod as never, "PRODUCCION", d2!.deliveryLineId);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["EDITAR", "CANCELAR"]));
    expect(d1).toBeTruthy();
  });

  it("REMITOS: cada parcial arma su propio remito con sus cajas; sin duplicar unidades; con remito vigente no se cancela en silencio", { timeout: 60_000 }, async () => {
    const id = await newWork("ENVASADO_MASIVO", "1200");
    await partial(id, 605, 1235, B1);
    await partial(id, 630, 1235, B2);
    const rem = await import("@/lib/remitos/delivery-remittance");
    const [d1, d2] = (await rem.listDeliveriesOfWork(id)).deliveries;
    const actor = { email: prod.email, sector: prod.sector, displayName: prod.displayName } as never;
    const a = await rem.prepareRemitoFromDelivery(actor, { deliveryLineId: d1!.deliveryLineId });
    const b = await rem.prepareRemitoFromDelivery(actor, { deliveryLineId: d2!.deliveryLineId });
    expect(a.remito.lines[0]).toMatchObject({ totalUnits: 605, cajas1: 6, unidades1: 100, cajas2: 1, unidades2: 5 });
    expect(b.remito.lines[0]).toMatchObject({ totalUnits: 630, cajas1: 6, unidades1: 100, cajas2: 1, unidades2: 30 });
    await expect(rem.prepareRemitoFromDelivery(actor, { deliveryLineId: d1!.deliveryLineId })).rejects.toThrow();
    expect((await rem.listDeliveriesOfWork(id)).totals).toEqual({ received: 1235, remitted: 1235, available: 0, cajas: 14 });
    const svc = await import("@/lib/planning/internal-deliveries-service");
    await expect(svc.cancelInternalDelivery(prod as never, { kind: "PRODUCCION", id: d1!.deliveryLineId, reason: "x" })).rejects.toThrow(/No se puede cancelar/);
  });

  it("CODIFICADO: recibe 1.235 de un pedido de 1.200 y entrega 605 + 630 a Producción con cajas propias; Producción recibe 1.235 sin duplicar", { timeout: 60_000 }, async () => {
    const parent = await newWork("ENVASADO_MASIVO", "1200");
    await q("update work_items set finished_qty = '1235' where id = $1", [parent]);
    const trans = await import("@/lib/planning/codificado-transfer-service");
    await trans.transferToCodificadoDurable({ workItemId: parent, quantity: 605, finishedQty: 1235, packingGroups: B1, idempotencyKey: randomUUID() } as never, masivo as never);
    await trans.transferToCodificadoDurable({ workItemId: parent, quantity: 630, finishedQty: 1235, packingGroups: B2, idempotencyKey: randomUUID() } as never, masivo as never);
    const child = String((await q("select id from work_items where parent_work_item_id = $1", [parent]))[0]!.id);
    const h = await import("@/lib/planning/codificado-handoff-service");
    const d = (qty: number, boxes: Boxes) => h.deliverFromCodificadoDurable({ workItemId: child, deliverQuantity: qty, deliveryPackingGroups: boxes, idempotencyKey: randomUUID() } as never, codif as never);
    expect(await d(605, B1)).toMatchObject({ delivered: 605, complete: false });
    expect(await d(630, B2)).toMatchObject({ delivered: 1235, pending: 0, complete: true });
    expect((await item(child)).operational_status).toBe("entregado");
    const rem = await import("@/lib/remitos/delivery-remittance");
    const w = await rem.listDeliveriesOfWork(child);
    expect(w.deliveries.map((x) => [x.delivered, x.cajas])).toEqual([[605, 7], [630, 7]]);
    expect(w.totals).toMatchObject({ received: 1235, cajas: 14 });
    expect(Number((await q("select coalesce(sum(quantity),0)::float8 s from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [parent]))[0]!.s)).toBe(0); // Envasado no entregó nada por su cuenta: sin duplicar
  });

  it("ELABORACIÓN: OE de 60 kg, 70 kg realmente elaborados → se envían 70 kg a Envasado; lo solicitado sigue en 60", { timeout: 60_000 }, async () => {
    const id = await newWork("ELABORACION", "60", "kg");
    const { sendElaboracionToEnvasadoDurable } = await import("@/lib/planning/circuit/elaboracion-handoff");
    const r = await sendElaboracionToEnvasadoDurable({ workItemId: id, destination: "ENVASADO_MASIVO", producedQuantity: "70", unitsToPackage: "1235", idempotencyKey: `cr-${RUN}-70kg` }, elab as never);
    expect(r.source.finishedQty).toBe("70");
    expect(String((await item(id)).planned_quantity)).toBe("60");
    expect((await item(id)).operational_status).toBe("completo");
    expect(r.destination.sector).toBe("ENVASADO_MASIVO");
    const ev = await q("select note from operational_events where work_item_id = $1 and type = 'SENT_TO_ENVASADO'", [id]);
    expect(String(ev[0]!.note)).toMatch(/kg=70/);
    expect(r.replayed).toBe(false);
  });
});
