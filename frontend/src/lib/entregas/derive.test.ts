import { describe, expect, it } from "vitest";
import { buildDerivedDeliveries, computeRecoveryStats, type WorkFacts } from "./derive";
import { groupDeliveriesByClient } from "./rules";
import type { RealDelivery } from "./types";

const ev = (o: Partial<RealDelivery> = {}): RealDelivery => ({
  id: "r1", date: "2026-09-20", quantity: "1000", unit: "un.", remito: "R-1", receivedBy: "Ana", lote: null, vto: null, observations: null, ...o,
});
const work = (o: Partial<WorkFacts> = {}): WorkFacts => ({
  workItemId: "w1", client: "FIRMEA", product: "CREMA", sector: "ENVASADO_MASIVO", line: "Línea 1", responsible: "Línea 1",
  plannedDate: "2026-10-01", plannedDateTo: null, plannedQuantity: "1000", unit: "un.", deliveryDate: null, packagingLote: "L-1", packagingVto: "10/2028",
  operationalStatus: "completo", finishedQty: "1000", deliverableUnits: null, orderNumber: "OA-1", notes: null, completedAt: "2026-09-18",
  realDeliveries: [], cancelled: false, linked: false, containerDate: null, containerCancelled: false, ...o,
});
const RANGE = { from: "2026-09-01", to: "2026-10-31" };

describe("buildDerivedDeliveries — histórico", () => {
  it("un trabajo entregado se ubica en su FECHA REAL de entrega, no en la de fin de producción", () => {
    const [d] = buildDerivedDeliveries([work({ completedAt: "2026-09-18", realDeliveries: [ev({ date: "2026-09-25" })] })], RANGE);
    expect(d!.deliveryDate).toBe("2026-09-25");
    expect(d!.origin).toBe("entrega_registrada");
    expect(d!.items[0]!.works[0]!.completedAt).toBe("2026-09-18");
    expect(d!.items[0]!.works[0]!.deliveredAt).toBe("2026-09-25");
    expect(d!.items[0]!.status).toBe("entregada");
    expect(d!.status).toBe("entregada");
  });

  it("entregado sin entrega real registrada (solo con fecha de fin de producción): NO se ubica, no se inventa fecha", () => {
    const out = buildDerivedDeliveries([work({ operationalStatus: "entregado", completedAt: "2026-09-18", realDeliveries: [], deliveryDate: null })], RANGE);
    expect(out).toEqual([]);
  });

  it("entrega parcial: se muestra la entrega real como parcial y el saldo sigue pendiente en su fecha de entrega", () => {
    const w = work({ plannedQuantity: "1000", finishedQty: null, deliveryDate: "2026-10-20", operationalStatus: "completo", realDeliveries: [ev({ quantity: "400", date: "2026-10-05" })] });
    const out = buildDerivedDeliveries([w], RANGE);
    expect(out.map((d) => [d.origin, d.deliveryDate, d.status])).toEqual([
      ["entrega_registrada", "2026-10-05", "entrega_parcial"],
      ["desde_trabajo", "2026-10-20", "entrega_parcial"],
    ]);
  });

  it("entrega completa: deja de aparecer como pendiente en su fecha programada", () => {
    const w = work({ deliveryDate: "2026-10-20", realDeliveries: [ev({ date: "2026-10-05", quantity: "1000" })] });
    expect(buildDerivedDeliveries([w], RANGE).map((d) => d.origin)).toEqual(["entrega_registrada"]);
  });

  it("un trabajo cancelado/eliminado conserva su entrega real histórica pero no aparece como entrega futura", () => {
    const w = work({ cancelled: true, deliveryDate: "2026-10-20", realDeliveries: [ev({ date: "2026-10-05", quantity: "400" })], plannedQuantity: "1000", finishedQty: null });
    expect(buildDerivedDeliveries([w], RANGE).map((d) => d.origin)).toEqual(["entrega_registrada"]);
    expect(buildDerivedDeliveries([work({ cancelled: true, deliveryDate: "2026-10-20" })], RANGE)).toEqual([]);
  });

  it("las fechas fuera del rango pedido no aparecen", () => {
    const w = work({ realDeliveries: [ev({ date: "2025-01-10" })] });
    expect(buildDerivedDeliveries([w], RANGE)).toEqual([]);
    expect(buildDerivedDeliveries([w], { from: "2025-01-01", to: "2025-01-31" })).toHaveLength(1);
  });
});

describe("buildDerivedDeliveries — futuro", () => {
  it("trabajo vigente con fecha de entrega aparece sin haberse cargado: «Desde trabajo», en esa fecha", () => {
    const [d] = buildDerivedDeliveries([work({ operationalStatus: "en_curso", finishedQty: null, deliveryDate: "2026-10-22" })], RANGE);
    expect(d!.origin).toBe("desde_trabajo");
    expect(d!.deliveryDate).toBe("2026-10-22");
    expect(d!.items[0]!.status).toBe("produccion_en_proceso");
    expect(d!.state).toBe("programada");
  });

  it("si cambia la fecha en el trabajo, la aparición se mueve (se recalcula en cada lectura)", () => {
    const before = buildDerivedDeliveries([work({ deliveryDate: "2026-10-22" })], RANGE);
    const after = buildDerivedDeliveries([work({ deliveryDate: "2026-10-28" })], RANGE);
    expect([before[0]!.deliveryDate, after[0]!.deliveryDate]).toEqual(["2026-10-22", "2026-10-28"]);
  });

  it("sin fecha de entrega ni entrega real: no se ubica (no se inventa)", () => {
    expect(buildDerivedDeliveries([work({ deliveryDate: null })], RANGE)).toEqual([]);
  });

  it("NO duplica: un trabajo vinculado a una entrega programada usa esa entrega como contenedor", () => {
    const linked = work({ linked: true, containerDate: "2026-10-22", deliveryDate: "2026-10-22", realDeliveries: [ev({ date: "2026-10-05" })] });
    expect(buildDerivedDeliveries([linked], RANGE)).toEqual([]);
  });

  it("terminado y sin entregar: «Lista para entregar» (sin depender de Calidad)", () => {
    const [d] = buildDerivedDeliveries([work({ operationalStatus: "completo", deliveryDate: "2026-10-22" })], RANGE);
    expect(d!.items[0]!.status).toBe("lista_para_entregar");
  });

  it("campos opcionales faltantes NO descartan el trabajo", () => {
    const w = work({ client: null, product: null, plannedQuantity: null, unit: null, packagingLote: null, packagingVto: null, orderNumber: null, responsible: null, line: null, plannedDate: null, finishedQty: null, notes: null, deliveryDate: "2026-10-22" });
    const [d] = buildDerivedDeliveries([w], RANGE);
    expect(d!.client).toBe("Sin cliente");
    expect(d!.items[0]).toMatchObject({ product: "Sin producto", quantity: null, lot: null, vto: null, plannedProductionDate: null });
  });
});

describe("agrupación por cliente + fecha", () => {
  it("3 productos del mismo cliente el mismo día → UNA sola aparición con 3 productos", () => {
    const ws = ["CREMA", "SERUM", "GEL"].map((p, i) => work({ workItemId: `w${i}`, product: p, deliveryDate: "2026-10-15" }));
    const out = buildDerivedDeliveries(ws, RANGE);
    expect(out).toHaveLength(1);
    expect(out[0]!.items.map((i) => i.product)).toEqual(["CREMA", "GEL", "SERUM"]);
    expect(groupDeliveriesByClient(out)).toHaveLength(1);
  });

  it("normaliza tildes, mayúsculas y espacios: «Café  Martínez» y «cafe martinez» son el mismo cliente", () => {
    const ws = [work({ workItemId: "a", client: "Café  Martínez", deliveryDate: "2026-10-15" }), work({ workItemId: "b", client: "cafe martinez", deliveryDate: "2026-10-15" })];
    const out = buildDerivedDeliveries(ws, RANGE);
    expect(out).toHaveLength(1);
    expect(out[0]!.items).toHaveLength(2);
  });

  it("NO une clientes distintos (sin fuzzy): FIRMEA ≠ FIRMEA SA ≠ FIRMA", () => {
    const ws = ["FIRMEA", "FIRMEA SA", "FIRMA"].map((c, i) => work({ workItemId: `w${i}`, client: c, deliveryDate: "2026-10-15" }));
    const out = buildDerivedDeliveries(ws, RANGE);
    expect(out).toHaveLength(3);
    expect(groupDeliveriesByClient(out)).toHaveLength(3);
  });

  it("mismo cliente en días distintos: apariciones distintas", () => {
    const ws = [work({ workItemId: "a", deliveryDate: "2026-10-15" }), work({ workItemId: "b", deliveryDate: "2026-10-16" })];
    expect(buildDerivedDeliveries(ws, RANGE).map((d) => d.deliveryDate)).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it("entrega registrada y futura del mismo cliente el mismo día: un solo cliente en el calendario, con origen distinto en la tarjeta", () => {
    const ws = [work({ workItemId: "a", deliveryDate: "2026-10-15" }), work({ workItemId: "b", realDeliveries: [ev({ date: "2026-10-15" })] })];
    const out = buildDerivedDeliveries(ws, RANGE);
    expect(out.map((d) => d.origin).sort()).toEqual(["desde_trabajo", "entrega_registrada"]);
    expect(groupDeliveriesByClient(out)).toHaveLength(1);
  });

  it("la agrupación junta una entrega programada a mano con las recuperadas del mismo cliente y día", () => {
    const [derived] = buildDerivedDeliveries([work({ deliveryDate: "2026-10-15" })], RANGE);
    const manual = { ...derived!, id: "m1", origin: "programada_manual" as const, client: "firmea" };
    expect(groupDeliveriesByClient([manual, derived!])).toHaveLength(1);
  });
});

describe("computeRecoveryStats (diagnóstico)", () => {
  const TODAY = "2026-10-14";
  it("cuenta históricas, futuras, vencidas y lo que queda fuera con su motivo", () => {
    const works: WorkFacts[] = [
      work({ workItemId: "h1", realDeliveries: [ev()] }), // histórica suelta
      work({ workItemId: "h2", linked: true, containerDate: "2026-09-20", realDeliveries: [ev({ id: "r2" })] }), // histórica en entrega programada
      work({ workItemId: "f1", deliveryDate: "2026-10-20" }), // futura suelta
      work({ workItemId: "f2", deliveryDate: "2026-10-14" }), // hoy = futura
      work({ workItemId: "f3", linked: true, containerDate: "2026-10-25", deliveryDate: "2026-10-01" }), // futura en programada
      work({ workItemId: "v1", deliveryDate: "2026-10-01" }), // vencida
      work({ workItemId: "x1", operationalStatus: "entregado", realDeliveries: [] }), // entregado sin fecha real
      work({ workItemId: "c1", cancelled: true, deliveryDate: "2026-10-20" }), // cancelado con fecha
      work({ workItemId: "p1", plannedQuantity: "1000", finishedQty: null, deliveryDate: "2026-10-30", realDeliveries: [ev({ quantity: "300", id: "r9" })] }), // parcial: histórica y futura
    ];
    const s = computeRecoveryStats(works, TODAY, 7);
    expect(s.historicas).toEqual({ total: 3, sueltas: 2, enEntregaProgramada: 1 });
    expect(s.futuras).toEqual({ total: 4, sueltas: 3, enEntregaProgramada: 1 });
    expect(s.vencidasSinEntregar).toBe(1);
    expect(s.fuera).toEqual({ entregadoSinFechaReal: 1, sinFechaDeEntrega: 7, canceladosOEliminados: 1 });
  });

  it("entrega programada cancelada: sus trabajos vinculados no cuentan como futuras", () => {
    const s = computeRecoveryStats([work({ linked: true, containerDate: "2026-10-25", containerCancelled: true })], TODAY, 0);
    expect(s.futuras.total).toBe(0);
  });

  it("sin datos: todo en cero", () => {
    expect(computeRecoveryStats([], TODAY, 0)).toEqual({
      historicas: { total: 0, sueltas: 0, enEntregaProgramada: 0 },
      futuras: { total: 0, sueltas: 0, enEntregaProgramada: 0 },
      vencidasSinEntregar: 0,
      fuera: { entregadoSinFechaReal: 0, sinFechaDeEntrega: 0, canceladosOEliminados: 0 },
    });
  });
});
