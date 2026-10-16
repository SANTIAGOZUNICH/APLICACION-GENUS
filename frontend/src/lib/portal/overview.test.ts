import { describe, expect, it } from "vitest";
import { buildOverview, toClientPayload, type RawDeliveryRow, type RawEventRow, type RawMarkRow, type RawWorkRow } from "./overview";

const NOW = new Date("2026-10-19T15:00:00Z"); // lunes, Buenos Aires
const CLIENT = "00000000-0000-4000-8000-0000000000c1";

function row(over: Partial<RawWorkRow> = {}): RawWorkRow {
  return {
    id: "SECRET-WORK-ID-1",
    client: "ACME S.A.",
    product: "SHAMPOO PLUS",
    sector: "ELABORACION",
    operationalStatus: "en_curso",
    source: "native",
    createdAt: "2026-10-05T13:00:00Z",
    completedAt: null,
    progressUpdatedAt: null,
    sentToCodificadoAt: null,
    viaCodificado: false,
    plannedQuantity: "5000",
    unit: "un.",
    finishedQty: null,
    deliverableUnits: null,
    packagingTotalUnits: null,
    productionPedidoId: "PEDIDO-UUID-A",
    pedidoOp: "OP-4521",
    pedidoProducto: "Shampoo Plus 500 ml",
    ...over,
  };
}
const assigned = (id: string, at = "2026-10-05T13:00:00Z"): RawEventRow => ({ workItemId: id, type: "ITEM_ASSIGNED", at });
const build = (works: RawWorkRow[], extra: { deliveries?: RawDeliveryRow[]; events?: RawEventRow[]; marks?: RawMarkRow[]; confirmations?: Map<string, { at: string; by: string }> } = {}) =>
  buildOverview({ clientId: CLIENT, works, deliveries: extra.deliveries ?? [], events: extra.events ?? [], marks: extra.marks ?? [], confirmations: extra.confirmations ?? new Map(), now: NOW });

describe("vista del cliente", () => {
  it("un pedido con varios productos: una tarjeta por producto, cada una con su propia etapa", () => {
    const a = row({ id: "w-a", productionPedidoId: "P-A", pedidoProducto: "Shampoo", pedidoOp: "OP-9", operationalStatus: "en_curso" });
    const b = row({ id: "w-b", productionPedidoId: "P-B", pedidoProducto: "Acondicionador", pedidoOp: "OP-9", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso" });
    const o = build([a, b], { events: [assigned("w-a"), assigned("w-b", "2026-10-14T10:00:00Z")] });
    expect(o.products.map((p) => [p.product, p.stage, p.orderRef])).toEqual([
      ["Acondicionador", "ENVASADO", "OP-9"],
      ["Shampoo", "ELABORACION", "OP-9"],
    ]);
    expect(o.summary).toEqual({ inProcess: 2, elaboracion: 1, envasado: 1, listos: 0, entregados: 0 });
  });

  it("cadena Elaboración → Envasado del mismo pedido: UNA tarjeta, en Envasado, con la cuenta regresiva desde el ingreso real", () => {
    const e = row({ id: "w-e", operationalStatus: "completo", unit: "kg", plannedQuantity: "300" });
    const v = row({ id: "w-v", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso" });
    const o = build([e, v], { events: [assigned("w-e"), { workItemId: "w-v", type: "RECEIVED_FROM_ELABORACION", at: "2026-10-14T13:00:00Z" }] });
    expect(o.products).toHaveLength(1);
    const p = o.products[0]!;
    expect(p).toMatchObject({ stage: "ENVASADO", stageLabel: "Envasado", orderRef: "OP-4521", product: "Shampoo Plus 500 ml" });
    // ingreso miércoles 14/10 → jueves 15, viernes 16 y lunes 19 = 3 hábiles transcurridos de 5 → quedan 2
    expect(p.countdown).toMatchObject({ totalDays: 5, elapsedDays: 3, remainingDays: 2, startedDate: "2026-10-14" });
    expect(p.message).toBe("Tu producto finalizó la elaboración y se encuentra en proceso de envasado.");
  });

  it("Elaboración: 10 días hábiles desde la asignación (el 12/10 es feriado)", () => {
    const o = build([row()], { events: [assigned("SECRET-WORK-ID-1", "2026-10-05T13:00:00Z")] });
    expect(o.products[0]!.countdown).toMatchObject({ totalDays: 10, elapsedDays: 9, remainingDays: 1, estimatedDate: "2026-10-20" });
  });

  it("sin inicio verificable (trabajo importado) no hay cuenta regresiva", () => {
    const o = build([row({ source: "import_sheets" })]);
    expect(o.products[0]!.countdown).toBeNull();
  });

  it("plazo superado: 0 días, nunca negativos", () => {
    const o = build([row()], { events: [assigned("SECRET-WORK-ID-1", "2026-08-03T13:00:00Z")] });
    expect(o.products[0]!.countdown).toMatchObject({ remainingDays: 0, overdue: true });
  });

  it("en Codificado sigue «en proceso de finalización»", () => {
    const v = row({ id: "w-c", sector: "CODIFICADO", operationalStatus: "en_curso", viaCodificado: true });
    const p = build([v], { events: [assigned("w-c")] }).products[0]!;
    expect(p).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION", message: "Tu producto está en proceso de finalización." });
  });

  it("entrega parcial: solicitado 5.000, entregado 2.000, pendiente 3.000; confirmable solo la entrega registrada", () => {
    const v = row({ id: "w-v", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso" });
    const del: RawDeliveryRow = { key: "line:L1", workItemId: "w-v", at: "2026-10-19T12:00:00Z", quantity: 2000, unit: "un." };
    const o = build([v], { deliveries: [del], events: [assigned("w-v")] });
    const p = o.products[0]!;
    expect(p.partialDelivery).toBe(true);
    expect(p.quantities).toMatchObject({ requested: 5000, delivered: 2000, pending: 3000 });
    expect(p.stage).not.toBe("ENTREGADO");
    expect(o.deliveries).toHaveLength(1);
    expect(o.deliveries[0]).toMatchObject({ quantity: 2000, canConfirm: true, confirmation: null });
  });

  it("recepción ya confirmada: no se puede confirmar de nuevo", () => {
    const v = row({ id: "w-v", sector: "ENVASADO_MASIVO", operationalStatus: "entregado" });
    const del: RawDeliveryRow = { key: "line:L1", workItemId: "w-v", at: "2026-10-19T12:00:00Z", quantity: 5000, unit: "un." };
    const o = build([v], { deliveries: [del], confirmations: new Map([["line:L1", { at: "2026-10-19T14:00:00Z", by: "ana@acme.com" }]]) });
    expect(o.products[0]!.stage).toBe("ENTREGADO");
    expect(o.deliveries[0]).toMatchObject({ canConfirm: false, confirmation: { by: "ana@acme.com" } });
  });

  it("los identificadores son opacos, distintos por cliente y estables", () => {
    const w = [row()];
    const a = build(w);
    const b = buildOverview({ clientId: "00000000-0000-4000-8000-0000000000c2", works: w, deliveries: [], events: [], confirmations: new Map(), now: NOW });
    expect(a.products[0]!.id).toHaveLength(24);
    expect(a.products[0]!.id).toBe(build(w).products[0]!.id);
    expect(a.products[0]!.id).not.toBe(b.products[0]!.id);
  });

  it("NUNCA expone ids internos ni datos confidenciales hacia el navegador", () => {
    const v = row({ id: "SECRET-WORK-ID-9", sector: "ENVASADO_PREMIUM", operationalStatus: "revision", completedAt: "2026-10-18T09:00:00Z" });
    const o = build([v], { deliveries: [{ key: "line:SECRET-LINE", workItemId: "SECRET-WORK-ID-9", at: "2026-10-19T12:00:00Z", quantity: 100, unit: "un." }] });
    const json = JSON.stringify(toClientPayload(o));
    for (const secret of ["SECRET-WORK-ID", "SECRET-LINE", "PEDIDO-UUID", "ready", "workItemId", "branch_owner", "observ", "formula", "lote", "costo"]) {
      expect(json.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(Object.keys(toClientPayload(o)).sort()).toEqual(["deliveries", "disclaimer", "products", "summary"]);
  });

  it("una confirmación explícita de disponibilidad genera el insumo del aviso con la cantidad confirmada", () => {
    const v = row({ id: "w-v", sector: "CODIFICADO", operationalStatus: "revision", viaCodificado: true, completedAt: "2026-10-18T09:00:00Z" });
    const o = build([v], { marks: [{ id: "mark-1", workItemId: "w-v", quantity: 5000, at: "2026-10-19T14:00:00Z" }] });
    expect(o.products[0]!.stage).toBe("LISTO");
    expect(o.products[0]!.availableSince).toBe("2026-10-19T14:00:00Z");
    expect(o.ready).toEqual([expect.objectContaining({ workItemId: "w-v", markId: "mark-1", available: 5000, product: "Shampoo Plus 500 ml", readySince: "2026-10-19T14:00:00Z" })]);
    expect(o.summary.listos).toBe(1);
  });

  it("trabajo terminado SIN confirmación: no es «Listo», no hay insumo de aviso y se ve «en proceso de finalización»", () => {
    for (const sector of ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"] as const) {
      const v = row({ id: "w-v", sector, operationalStatus: "revision", completedAt: "2026-10-17T09:00:00Z" });
      const o = build([v]);
      expect(o.products[0]).toMatchObject({ stage: "ENVASADO", substage: "FINALIZACION", message: "Tu producto está en proceso de finalización.", availableSince: null });
      expect(o.ready).toEqual([]);
      expect(o.summary.listos).toBe(0);
    }
  });

  it("disponibilidad parcial: 5.000 pedidas, 2.000 entregadas, 1.500 disponibles y 1.500 pendientes — no figura como pedido listo", () => {
    const v = row({ id: "w-v", sector: "ENVASADO_MASIVO", operationalStatus: "en_curso", finishedQty: "3500" });
    const o = build([v], {
      marks: [{ id: "mk", workItemId: "w-v", quantity: 1500, at: "2026-10-19T14:00:00Z", deliveredBefore: 2000 }],
      deliveries: [{ key: "line:1", workItemId: "w-v", at: "2026-10-16T12:00:00Z", quantity: 2000, unit: "un." }],
    });
    const p = o.products[0]!;
    expect(p.stage).toBe("ENVASADO");
    expect(p.quantities).toMatchObject({ requested: 5000, delivered: 2000, available: 1500, pending: 1500 });
    expect(p.message).toBe("Una parte de tu pedido ya está lista para entregar; el resto sigue en proceso.");
    expect(o.summary.listos).toBe(0);
  });

  it("sin número de pedido no se inventa uno ni se muestra el de la OE interna", () => {
    const o = build([row({ productionPedidoId: null, pedidoOp: null, pedidoProducto: null })]);
    expect(o.products[0]!.orderRef).toBeNull();
    expect(o.products[0]!.product).toBe("SHAMPOO PLUS");
  });
});
