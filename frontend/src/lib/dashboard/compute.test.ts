import { describe, expect, it } from "vitest";
import { computeDashboard, daysBetween, normKey, parseQty, toArDate, type DashboardComputeContext } from "./compute";
import { evaluateLight, validateTargetInput } from "./semaforo";
import {
  isNotAvailable,
  type DashboardDeliveryRow,
  type DashboardFilters,
  type DashboardIndicatorRow,
  type DashboardKpi,
  type DashboardPedidoRow,
  type DashboardRows,
  type DashboardTarget,
  type DashboardWorkRow,
} from "./types";

const NOW = "2026-10-14T15:00:00.000Z";
const ctx = (over: Partial<DashboardComputeContext> = {}): DashboardComputeContext => ({
  level: "full",
  sector: "PRODUCCION",
  targets: [],
  generatedAt: NOW,
  lastDataChangeAt: null,
  targetsSchemaPending: false,
  dataSource: "memory",
  ...over,
});
const F = (over: Partial<DashboardFilters> = {}): DashboardFilters => ({ year: 2026, month: null, sector: "ALL", client: null, ...over });

let seq = 0;
const ped = (o: Partial<DashboardPedidoRow> = {}): DashboardPedidoRow => ({
  id: `p${++seq}`,
  fecha: "2026-03-10",
  cliente: "E2E Cliente A",
  producto: "Crema",
  estado: "INGRESO",
  q: 1000,
  ...o,
});
const work = (o: Partial<DashboardWorkRow> = {}): DashboardWorkRow => ({
  id: `w${++seq}`,
  productionSector: "ENVASADO_MASIVO",
  operationalStatus: "completo",
  cancelled: false,
  finishedQty: "900",
  packagingTotalUnits: null,
  client: "E2E Cliente A",
  product: "Crema",
  productionPedidoId: null,
  completedAt: "2026-04-15T12:00:00.000Z",
  ...o,
});
const del = (o: Partial<DashboardDeliveryRow> = {}): DashboardDeliveryRow => ({
  id: `d${++seq}`,
  workItemId: `w${seq}`,
  sourceSector: "ENVASADO_MASIVO",
  client: "E2E Cliente A",
  pedidoId: null,
  actualDeliveredAt: "2026-04-20T12:00:00.000Z",
  status: "ENTREGADO",
  ...o,
});
const rows = (o: Partial<DashboardRows> = {}): DashboardRows => ({ pedidos: [], works: [], deliveries: [], ...o });
const kpi = (v: unknown) => v as DashboardKpi;

describe("utilidades", () => {
  it("normKey ignora tildes, mayúsculas y espacios", () => {
    expect(normKey("  Bekim  Ñandú ")).toBe("bekim nandu");
    expect(normKey("   ")).toBeNull();
    expect(normKey(null)).toBeNull();
  });
  it("parseQty entiende miles y decimales", () => {
    expect(parseQty("1.200")).toBe(1200);
    expect(parseQty("1.200,5")).toBe(1200.5);
    expect(parseQty("12,5")).toBe(12.5);
    expect(parseQty("900")).toBe(900);
    expect(parseQty("")).toBeNull();
    expect(parseQty("abc")).toBeNull();
    expect(parseQty(null)).toBeNull();
  });
  it("toArDate usa la fecha de Argentina (UTC-3)", () => {
    expect(toArDate("2026-03-01T02:00:00.000Z")).toBe("2026-02-28");
    expect(toArDate("2026-03-01T03:00:00.000Z")).toBe("2026-03-01");
    expect(toArDate(null)).toBeNull();
    expect(toArDate("basura")).toBeNull();
  });
  it("daysBetween cuenta días calendario", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2026-03-10", "2026-03-10")).toBe(0);
  });
});

describe("sin datos: nada inventado", () => {
  it("sin ninguna fila, todo indicador es «Sin datos suficientes» con motivo y qué registrar", () => {
    const p = computeDashboard(rows(), F(), ctx());
    const main = p.main;
    for (const k of [main.unidades, kpi(main.nivelServicio), kpi(main.leadTime), kpi(main.sinReclamos)]) {
      expect(k.value).toBeNull();
      expect(k.accuracy).toBe("sin_datos");
      expect(k.reason).toBeTruthy();
      expect(k.toRecord).toBeTruthy();
    }
    expect(p.pedidos.activos.value).toBeNull();
    expect(p.pedidos.entregados.value).toBeNull();
    expect(p.pedidos.enDespacho.value).toBeNull();
    expect(p.pedidos.productosDistintos.value).toBeNull();
    expect(p.produccion.total).toBe(0);
    expect(p.produccion.masivoShare).toBeNull();
    expect(p.produccion.premiumShare).toBeNull();
    expect(p.summary).toEqual([]);
    if (p.clients.available) {
      expect(p.clients.ranking).toEqual([]);
      expect(p.clients.activeClients.value).toBeNull();
    }
    const ind = p.indicators as DashboardIndicatorRow[];
    expect(ind.map((r) => r.light)).toEqual(["sin_datos", "sin_datos", "sin_datos", "sin_datos"]);
  });

  it("«% de pedidos sin reclamos» es siempre Sin datos (GENUS OS no registra reclamos)", () => {
    const p = computeDashboard(rows({ pedidos: [ped()], works: [work()] }), F(), ctx());
    const r = kpi(p.main.sinReclamos);
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/no registra reclamos/i);
    expect(r.toRecord).toMatch(/reclamo/i);
  });

  it("el año sin actividad también es sin datos (aunque otro año tenga)", () => {
    const p = computeDashboard(rows({ pedidos: [ped()], works: [work()] }), F({ year: 2025 }), ctx());
    expect(p.main.unidades.value).toBeNull();
    expect(p.pedidos.activos.value).toBeNull();
    expect(p.filterOptions.years).toContain(2026);
    expect(p.filterOptions.years).toContain(2025);
  });
});

describe("producción Masivo vs Premium", () => {
  it("suma unidades por sector, participación y total", () => {
    const p = computeDashboard(
      rows({
        works: [
          work({ finishedQty: "600" }),
          work({ finishedQty: "400", productionSector: "ENVASADO_PREMIUM", completedAt: "2026-05-02T12:00:00.000Z" }),
        ],
      }),
      F(),
      ctx()
    );
    expect(p.produccion.masivo).toBe(600);
    expect(p.produccion.premium).toBe(400);
    expect(p.produccion.total).toBe(1000);
    expect(p.produccion.masivoShare).toBe(60);
    expect(p.produccion.premiumShare).toBe(40);
    expect(p.main.unidades.value).toBe(1000);
    expect(p.main.unidades.sampleSize).toBe(2);
  });

  it("evolución mensual: meses sin producción quedan en 0 y se ubican por fecha de cierre", () => {
    const p = computeDashboard(
      rows({
        works: [
          work({ finishedQty: "100", completedAt: "2026-01-10T12:00:00.000Z" }),
          work({ finishedQty: "50", productionSector: "ENVASADO_PREMIUM", completedAt: "2026-01-20T12:00:00.000Z" }),
          work({ finishedQty: "70", completedAt: "2026-03-05T12:00:00.000Z" }),
        ],
      }),
      F(),
      ctx()
    );
    expect(p.produccion.monthly).toHaveLength(12);
    expect(p.produccion.monthly[0]).toEqual({ month: 1, masivo: 100, premium: 50 });
    expect(p.produccion.monthly[1]).toEqual({ month: 2, masivo: 0, premium: 0 });
    expect(p.produccion.monthly[2]).toEqual({ month: 3, masivo: 70, premium: 0 });
  });

  it("filtro de mes acota los totales pero el gráfico sigue siendo del año completo", () => {
    const w = [
      work({ finishedQty: "100", completedAt: "2026-01-10T12:00:00.000Z" }),
      work({ finishedQty: "70", completedAt: "2026-03-05T12:00:00.000Z" }),
    ];
    const p = computeDashboard(rows({ works: w }), F({ month: 3 }), ctx());
    expect(p.produccion.masivo).toBe(70);
    expect(p.main.unidades.value).toBe(70);
    expect(p.produccion.monthly[0].masivo).toBe(100);
    expect(p.header.periodLabel).toBe("Marzo 2026");
  });

  it("filtro de año: no mezcla años", () => {
    const w = [work({ finishedQty: "100", completedAt: "2025-12-31T12:00:00.000Z" }), work({ finishedQty: "70" })];
    expect(computeDashboard(rows({ works: w }), F({ year: 2025 }), ctx()).main.unidades.value).toBe(100);
    expect(computeDashboard(rows({ works: w }), F({ year: 2026 }), ctx()).main.unidades.value).toBe(70);
  });

  it("filtro de sector afecta unidades y productos distintos, no los pedidos", () => {
    const w = [
      work({ finishedQty: "100", product: "A" }),
      work({ finishedQty: "50", productionSector: "ENVASADO_PREMIUM", product: "B" }),
    ];
    const p = computeDashboard(rows({ works: w, pedidos: [ped()] }), F({ sector: "ENVASADO_PREMIUM" }), ctx());
    expect(p.main.unidades.value).toBe(50);
    expect(p.pedidos.productosDistintos.value).toBe(1);
    expect(p.pedidos.activos.value).toBe(1);
    expect(p.pedidos.activos.notes.join(" ")).toMatch(/no aplica a pedidos/);
    // el bloque Masivo vs Premium sigue mostrando ambos
    expect(p.produccion.masivo).toBe(100);
  });

  it("excluye trabajos cancelados, eliminados, sin terminar, de otros sectores y sin cantidad", () => {
    const w = [
      work({ finishedQty: "100" }),
      work({ finishedQty: "999", cancelled: true }),
      work({ finishedQty: "999", operationalStatus: "cancelado" }),
      work({ finishedQty: "999", deletedAt: "2026-05-01T00:00:00.000Z" }),
      work({ finishedQty: "999", operationalStatus: "en_curso", completedAt: null }),
      work({ finishedQty: "999", productionSector: "CODIFICADO" }),
      work({ finishedQty: "999", productionSector: null }),
      work({ finishedQty: null, packagingTotalUnits: null }),
      work({ finishedQty: "50", completedAt: null }),
    ];
    const p = computeDashboard(rows({ works: w }), F(), ctx());
    expect(p.main.unidades.value).toBe(100);
    expect(p.produccion.excludedWithoutQty).toBe(1);
    expect(p.produccion.excludedWithoutDate).toBe(1);
    expect(p.produccion.notes.join(" ")).toMatch(/sin fecha de cierre/);
  });

  it("usa las unidades embaladas cuando no hay cantidad final, y acepta miles con punto", () => {
    const w = [work({ finishedQty: null, packagingTotalUnits: 250 }), work({ finishedQty: "1.200" })];
    expect(computeDashboard(rows({ works: w }), F(), ctx()).main.unidades.value).toBe(1450);
  });

  it("productos distintos ignora mayúsculas/tildes y no cuenta repetidos", () => {
    const w = [work({ product: "Crema Facial" }), work({ product: "  crema   facial " }), work({ product: "Shampoo" }), work({ product: "Crémá facial" })];
    const p = computeDashboard(rows({ works: w }), F(), ctx());
    expect(p.pedidos.productosDistintos.value).toBe(2);
  });

  it("participación con total 0 no divide por cero", () => {
    const p = computeDashboard(rows({ works: [] }), F(), ctx());
    expect(p.produccion.masivoShare).toBeNull();
  });
});

describe("gestión de pedidos (fecha de pedido)", () => {
  it("mapea estados reales: activos / en despacho / entregados, y respeta el período", () => {
    const p = computeDashboard(
      rows({
        pedidos: [
          ped({ estado: "INGRESO" }),
          ped({ estado: "EN_ELABORACION" }),
          ped({ estado: "EN_ENVASADO" }),
          ped({ estado: "EN_CODIFICADO" }),
          ped({ estado: "LISTO_PARA_ENTREGAR" }),
          ped({ estado: "ENTREGADO" }),
          ped({ estado: "ENTREGADO" }),
          ped({ estado: "ENTREGADO", fecha: "2025-11-01" }),
          ped({ estado: null }),
          ped({ estado: "ENTREGADO", deletedAt: "2026-04-01T00:00:00Z" }),
          ped({ estado: "INGRESO", fecha: null }),
        ],
      }),
      F(),
      ctx()
    );
    expect(p.pedidos.activos.value).toBe(4);
    expect(p.pedidos.enDespacho.value).toBe(1);
    expect(p.pedidos.entregados.value).toBe(2);
    expect(p.pedidos.sinEstado).toBe(1);
    expect(p.pedidos.total).toBe(8);
    expect(p.pedidos.activos.notes.join(" ")).toMatch(/sin fecha de pedido/);
    expect(p.pedidos.activos.dateBasis).toBe("pedido");
  });

  it("acepta alias de estado (EN PROCESO, TERMINADO)", () => {
    const p = computeDashboard(rows({ pedidos: [ped({ estado: "EN PROCESO" }), ped({ estado: "TERMINADO" })] }), F(), ctx());
    expect(p.pedidos.activos.value).toBe(1);
    expect(p.pedidos.enDespacho.value).toBe(1);
  });
});

describe("nivel de servicio (unidades producidas ÷ pedidas por pedido)", () => {
  it("promedia por pedido y muestra la muestra", () => {
    const a = ped({ q: 1000 });
    const b = ped({ q: 500 });
    const p = computeDashboard(
      rows({
        pedidos: [a, b],
        works: [
          work({ productionPedidoId: a.id, finishedQty: "900" }),
          work({ productionPedidoId: b.id, finishedQty: "500" }),
        ],
      }),
      F(),
      ctx()
    );
    const nv = kpi(p.main.nivelServicio);
    expect(nv.value).toBe(95); // (90 + 100) / 2
    expect(nv.sampleSize).toBe(2);
    expect(nv.dateBasis).toBe("produccion");
    expect(nv.accuracy).toBe("adaptado");
  });

  it("suma varios trabajos del mismo pedido", () => {
    const a = ped({ q: 1000 });
    const p = computeDashboard(
      rows({ pedidos: [a], works: [work({ productionPedidoId: a.id, finishedQty: "400" }), work({ productionPedidoId: a.id, finishedQty: "500", productionSector: "ENVASADO_PREMIUM" })] }),
      F(),
      ctx()
    );
    expect(kpi(p.main.nivelServicio).value).toBe(90);
  });

  it("deja afuera pedidos con trabajos sin terminar, sin Q, sin cantidad o sin trabajos", () => {
    const sinTerminar = ped();
    const sinQ = ped({ q: null });
    const sinCant = ped();
    const sinTrabajos = ped();
    const ok = ped({ q: 100 });
    const p = computeDashboard(
      rows({
        pedidos: [sinTerminar, sinQ, sinCant, sinTrabajos, ok],
        works: [
          work({ productionPedidoId: sinTerminar.id, operationalStatus: "en_curso", completedAt: null }),
          work({ productionPedidoId: sinQ.id }),
          work({ productionPedidoId: sinCant.id, finishedQty: null }),
          work({ productionPedidoId: ok.id, finishedQty: "80" }),
        ],
      }),
      F(),
      ctx()
    );
    const nv = kpi(p.main.nivelServicio);
    expect(nv.value).toBe(80);
    expect(nv.sampleSize).toBe(1);
    expect(nv.notes.join(" ")).toMatch(/sin terminar/);
    expect(nv.notes.join(" ")).toMatch(/sin cantidad pedida/);
    expect(nv.notes.join(" ")).toMatch(/sin fecha de cierre o sin cantidad final/);
  });

  it("no limita a 100 % y lo avisa; trabajos cancelados/eliminados no cuentan", () => {
    const a = ped({ q: 100 });
    const p = computeDashboard(
      rows({
        pedidos: [a],
        works: [work({ productionPedidoId: a.id, finishedQty: "120" }), work({ productionPedidoId: a.id, finishedQty: "500", cancelled: true }), work({ productionPedidoId: a.id, finishedQty: "500", deletedAt: "2026-01-01T00:00:00Z" })],
      }),
      F(),
      ctx()
    );
    const nv = kpi(p.main.nivelServicio);
    expect(nv.value).toBe(120);
    expect(nv.notes.join(" ")).toMatch(/mayor a lo pedido/);
  });

  it("el período es el de la fecha de producción (último cierre del pedido)", () => {
    const a = ped({ q: 100 });
    const w = [work({ productionPedidoId: a.id, finishedQty: "100", completedAt: "2026-04-15T12:00:00Z" })];
    expect(kpi(computeDashboard(rows({ pedidos: [a], works: w }), F({ month: 4 }), ctx()).main.nivelServicio).value).toBe(100);
    expect(kpi(computeDashboard(rows({ pedidos: [a], works: w }), F({ month: 5 }), ctx()).main.nivelServicio).value).toBeNull();
  });
});

describe("lead time (pedido → última entrega real)", () => {
  const base = () => {
    const a = ped({ fecha: "2026-03-10" });
    return a;
  };

  it("promedia días entre la fecha de pedido y la última entrega", () => {
    const a = base();
    const b = ped({ fecha: "2026-03-20" });
    const p = computeDashboard(
      rows({
        pedidos: [a, b],
        deliveries: [
          del({ pedidoId: a.id, actualDeliveredAt: "2026-03-20T12:00:00Z" }), // 10
          del({ pedidoId: a.id, actualDeliveredAt: "2026-03-30T12:00:00Z" }), // última: 20
          del({ pedidoId: b.id, actualDeliveredAt: "2026-04-09T12:00:00Z" }), // 20
        ],
      }),
      F(),
      ctx()
    );
    const lt = kpi(p.main.leadTime);
    expect(lt.value).toBe(20);
    expect(lt.sampleSize).toBe(2);
    expect(lt.dateBasis).toBe("entrega");
  });

  it("excluye entregas ANULADO, REGISTRO_ELIMINADO, eliminadas y del granel de Elaboración", () => {
    const a = base();
    const p = computeDashboard(
      rows({
        pedidos: [a],
        deliveries: [
          del({ pedidoId: a.id, status: "ANULADO", actualDeliveredAt: "2026-06-10T12:00:00Z" }),
          del({ pedidoId: a.id, status: "REGISTRO_ELIMINADO", actualDeliveredAt: "2026-06-11T12:00:00Z" }),
          del({ pedidoId: a.id, deletedAt: "2026-06-12T00:00:00Z", actualDeliveredAt: "2026-06-12T12:00:00Z" }),
          del({ pedidoId: a.id, sourceSector: "ELABORACION", actualDeliveredAt: "2026-06-13T12:00:00Z" }),
          del({ pedidoId: a.id, actualDeliveredAt: "2026-03-30T12:00:00Z" }), // la única válida: 20 días
        ],
      }),
      F(),
      ctx()
    );
    expect(kpi(p.main.leadTime).value).toBe(20);
    expect(kpi(p.main.leadTime).sampleSize).toBe(1);
  });

  it("deja afuera plazos ≤ 0 o ≥ 100 días, pedidos sin fecha y entregas sin pedido, y lo informa", () => {
    const sameDay = ped({ fecha: "2026-03-10" });
    const tooLong = ped({ fecha: "2026-01-01" });
    const noFecha = ped({ fecha: null });
    const negative = ped({ fecha: "2026-05-01" });
    const ok = ped({ fecha: "2026-03-10" });
    const p = computeDashboard(
      rows({
        pedidos: [sameDay, tooLong, noFecha, negative, ok],
        deliveries: [
          del({ pedidoId: sameDay.id, actualDeliveredAt: "2026-03-10T12:00:00Z" }),
          del({ pedidoId: tooLong.id, actualDeliveredAt: "2026-06-01T12:00:00Z" }),
          del({ pedidoId: noFecha.id, actualDeliveredAt: "2026-06-01T12:00:00Z" }),
          del({ pedidoId: negative.id, actualDeliveredAt: "2026-04-01T12:00:00Z" }),
          del({ pedidoId: null, actualDeliveredAt: "2026-04-01T12:00:00Z" }),
          del({ pedidoId: ok.id, actualDeliveredAt: "2026-03-25T12:00:00Z" }),
        ],
      }),
      F(),
      ctx()
    );
    const lt = kpi(p.main.leadTime);
    expect(lt.value).toBe(15);
    expect(lt.sampleSize).toBe(1);
    const notes = lt.notes.join(" ");
    expect(notes).toMatch(/3 pedido\(s\) con plazo/);
    expect(notes).toMatch(/sin fecha de pedido/);
    expect(notes).toMatch(/no están vinculadas a un pedido/);
  });

  it("0 entregas válidas = Sin datos suficientes (muestra insuficiente)", () => {
    const a = base();
    const p = computeDashboard(rows({ pedidos: [a], deliveries: [del({ pedidoId: a.id, status: "ANULADO" })] }), F(), ctx());
    expect(kpi(p.main.leadTime).value).toBeNull();
    expect(kpi(p.main.leadTime).reason).toBeTruthy();
  });

  it("el período es el de la fecha de entrega, no el del pedido", () => {
    const a = ped({ fecha: "2025-12-20" });
    const d = [del({ pedidoId: a.id, actualDeliveredAt: "2026-01-05T12:00:00Z" })];
    expect(kpi(computeDashboard(rows({ pedidos: [a], deliveries: d }), F({ year: 2026 }), ctx()).main.leadTime).value).toBe(16);
    expect(kpi(computeDashboard(rows({ pedidos: [a], deliveries: d }), F({ year: 2025 }), ctx()).main.leadTime).value).toBeNull();
  });

  it("pedido eliminado no aporta lead time", () => {
    const a = ped({ fecha: "2026-03-10", deletedAt: "2026-04-01T00:00:00Z" });
    const p = computeDashboard(rows({ pedidos: [a], deliveries: [del({ pedidoId: a.id, actualDeliveredAt: "2026-03-30T12:00:00Z" })] }), F(), ctx());
    expect(kpi(p.main.leadTime).value).toBeNull();
  });
});

describe("clientes (solo Producción/Dirección)", () => {
  it("ranking por pedidos, clientes activos y comparación; un solo cliente funciona", () => {
    const a1 = ped({ cliente: "E2E Alfa", fecha: "2026-03-10", estado: "ENTREGADO" });
    const a2 = ped({ cliente: "e2e  alfa", fecha: "2026-03-11" });
    const b1 = ped({ cliente: "E2E Beta", fecha: "2026-03-12" });
    const p = computeDashboard(
      rows({
        pedidos: [a1, a2, b1],
        works: [work({ client: "E2E Alfa", finishedQty: "300" })],
        deliveries: [del({ pedidoId: a1.id, actualDeliveredAt: "2026-03-20T12:00:00Z" })],
      }),
      F(),
      ctx()
    );
    expect(p.clients.available).toBe(true);
    if (!p.clients.available) return;
    expect(p.clients.ranking.map((r) => [r.client, r.pedidos])).toEqual([
      ["E2E Alfa", 2],
      ["E2E Beta", 1],
    ]);
    expect(p.clients.ranking[0].entregados).toBe(1);
    expect(p.clients.ranking[0].leadTimeDays).toBe(10);
    expect(p.clients.ranking[0].unidades).toBe(300);
    expect(p.clients.ranking[1].leadTimeDays).toBeNull();
    expect(p.clients.activeClients.value).toBe(2);
    expect(p.clients.bestLeadTime.map((r) => r.client)).toEqual(["E2E Alfa"]);

    const one = computeDashboard(rows({ pedidos: [b1] }), F(), ctx());
    if (one.clients.available) {
      expect(one.clients.ranking).toHaveLength(1);
      expect(one.clients.activeClients.value).toBe(1);
      expect(one.clients.bestLeadTime).toEqual([]);
    }
  });

  it("menor lead time: ordena ascendente", () => {
    const a = ped({ cliente: "E2E Lento", fecha: "2026-03-01" });
    const b = ped({ cliente: "E2E Rápido", fecha: "2026-03-01" });
    const p = computeDashboard(
      rows({
        pedidos: [a, b],
        deliveries: [del({ pedidoId: a.id, actualDeliveredAt: "2026-03-31T12:00:00Z" }), del({ pedidoId: b.id, actualDeliveredAt: "2026-03-08T12:00:00Z" })],
      }),
      F(),
      ctx()
    );
    if (!p.clients.available) throw new Error("debería estar disponible");
    expect(p.clients.bestLeadTime.map((r) => r.client)).toEqual(["E2E Rápido", "E2E Lento"]);
  });

  it("filtro por cliente restringe pedidos, unidades y lead time", () => {
    const a = ped({ cliente: "E2E Alfa" });
    const b = ped({ cliente: "E2E Beta" });
    const p = computeDashboard(
      rows({
        pedidos: [a, b],
        works: [work({ client: "E2E Alfa", finishedQty: "100" }), work({ client: "E2E Beta", finishedQty: "40" })],
      }),
      F({ client: "e2e alfa" }),
      ctx()
    );
    expect(p.pedidos.total).toBe(1);
    expect(p.main.unidades.value).toBe(100);
    expect(p.header.client).toBe("e2e alfa");
    expect(p.filterOptions.clients).toEqual(["E2E Alfa", "E2E Beta"]);
  });

  it("pedidos sin cliente no inventan un cliente", () => {
    const p = computeDashboard(rows({ pedidos: [ped({ cliente: null }), ped({ cliente: "  " })] }), F(), ctx());
    if (!p.clients.available) throw new Error("debería estar disponible");
    expect(p.clients.ranking).toEqual([]);
    expect(p.clients.activeClients.value).toBeNull();
  });
});

describe("nivel agregado: el payload no contiene datos que el sector no puede ver", () => {
  const data = () => {
    const a = ped({ cliente: "E2E Secreto SA", fecha: "2026-03-10", estado: "ENTREGADO" });
    return rows({
      pedidos: [a, ped({ cliente: "E2E Reservado", estado: "INGRESO" })],
      works: [work({ client: "E2E Secreto SA", finishedQty: "100", productionPedidoId: a.id })],
      deliveries: [del({ pedidoId: a.id, client: "E2E Secreto SA", actualDeliveredAt: "2026-03-20T12:00:00Z" })],
    });
  };

  it("sin nombres de clientes, sin ranking, sin servicio/lead time/reclamos", () => {
    const p = computeDashboard(data(), F(), ctx({ level: "aggregate", sector: "ENVASADO_MASIVO" }));
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/Secreto/);
    expect(json).not.toMatch(/Reservado/);
    expect(p.clients.available).toBe(false);
    expect(isNotAvailable(p.main.nivelServicio)).toBe(true);
    expect(isNotAvailable(p.main.leadTime)).toBe(true);
    expect(isNotAvailable(p.main.sinReclamos)).toBe(true);
    expect(p.filterOptions.clients).toEqual([]);
    expect(p.permissions).toEqual({ level: "aggregate", canEditTargets: false, canFilterClient: false, ownSector: "ENVASADO_MASIVO" });
    // sí ve los agregados
    expect(p.main.unidades.value).toBe(100);
    expect(p.pedidos.entregados.value).toBe(1);
    expect(p.pedidos.activos.value).toBe(1);
    expect(p.produccion.monthly).toHaveLength(12);
    expect(p.pedidos.productosDistintos.value).toBe(1);
    // solo el indicador de unidades con semáforo
    expect((p.indicators as DashboardIndicatorRow[]).map((i) => i.key)).toEqual(["unidades_producidas"]);
  });

  it("ignora un filtro de cliente aunque llegue a compute (el servicio responde 403 antes)", () => {
    const p = computeDashboard(data(), F({ client: "E2E Secreto SA" }), ctx({ level: "aggregate", sector: "CALIDAD" }));
    expect(p.header.client).toBeNull();
    expect(p.pedidos.total).toBe(2);
    expect(JSON.stringify(p)).not.toMatch(/Secreto/);
  });

  it("el resumen gerencial del nivel agregado no menciona clientes ni indicadores de servicio", () => {
    const p = computeDashboard(data(), F(), ctx({ level: "aggregate", sector: "DEPOSITO" }));
    expect(p.summary.length).toBeGreaterThan(0);
    expect(p.summary.join(" ")).not.toMatch(/cliente|lead time|servicio/i);
  });
});

describe("semáforo y objetivos", () => {
  const t = (direction: "min" | "max", targetValue: number): DashboardTarget => ({ key: "k", direction, targetValue, unit: "percent", updatedBy: "x", updatedAt: NOW });

  it("sin objetivo: gris; sin resultado: sin datos", () => {
    expect(evaluateLight(90, null)).toBe("sin_objetivo");
    expect(evaluateLight(null, t("min", 95))).toBe("sin_datos");
    expect(evaluateLight(null, null)).toBe("sin_datos");
  });
  it("min: verde ≥ objetivo, amarillo hasta 10 % por debajo, rojo peor", () => {
    expect(evaluateLight(97, t("min", 97))).toBe("verde");
    expect(evaluateLight(100, t("min", 97))).toBe("verde");
    expect(evaluateLight(90, t("min", 100))).toBe("amarillo");
    expect(evaluateLight(89.9, t("min", 100))).toBe("rojo");
  });
  it("max: verde ≤ objetivo, amarillo hasta 10 % por encima, rojo peor", () => {
    expect(evaluateLight(25, t("max", 25))).toBe("verde");
    expect(evaluateLight(27.5, t("max", 25))).toBe("amarillo");
    expect(evaluateLight(27.6, t("max", 25))).toBe("rojo");
    expect(evaluateLight(0, t("max", 0))).toBe("verde");
    expect(evaluateLight(1, t("max", 0))).toBe("rojo");
  });
  it("validación de objetivos", () => {
    expect(validateTargetInput({ value: 95, direction: "min", unit: "percent" })).toBeNull();
    expect(validateTargetInput({ value: 120, direction: "min", unit: "percent" })).toMatch(/100/);
    expect(validateTargetInput({ value: -1, direction: "min", unit: "days" })).toMatch(/negativo/);
    expect(validateTargetInput({ value: Number.NaN, direction: "min", unit: "days" })).toMatch(/número/);
    expect(validateTargetInput({ value: "9", direction: "min", unit: "days" })).toMatch(/número/);
    expect(validateTargetInput({ value: 9, direction: "arriba", unit: "days" })).toMatch(/dirección/);
  });

  it("el semáforo de la tabla usa el objetivo cargado y se calcula por resultado real", () => {
    const a = ped({ q: 100 });
    const targets: DashboardTarget[] = [
      { key: "nivel_servicio", targetValue: 95, direction: "min", unit: "percent", updatedBy: "u", updatedAt: NOW },
      { key: "lead_time", targetValue: 5, direction: "max", unit: "days", updatedBy: "u", updatedAt: NOW },
    ];
    const p = computeDashboard(
      rows({
        pedidos: [a],
        works: [work({ productionPedidoId: a.id, finishedQty: "80" })],
        deliveries: [del({ pedidoId: a.id, actualDeliveredAt: "2026-03-20T12:00:00Z" })],
      }),
      F(),
      ctx({ targets })
    );
    const ind = p.indicators as DashboardIndicatorRow[];
    const nv = ind.find((i) => i.key === "nivel_servicio") as DashboardIndicatorRow;
    const lt = ind.find((i) => i.key === "lead_time") as DashboardIndicatorRow;
    const sr = ind.find((i) => i.key === "sin_reclamos") as DashboardIndicatorRow;
    const un = ind.find((i) => i.key === "unidades_producidas") as DashboardIndicatorRow;
    expect(nv.light).toBe("rojo"); // 80 < 95 × 0,9
    expect(nv.statusLabel).toBe("Crítico");
    expect(lt.result).toBe(10);
    expect(lt.light).toBe("rojo"); // 10 > 5 × 1,1
    expect(sr.light).toBe("sin_datos");
    expect(un.light).toBe("sin_objetivo");
    expect(p.summary.join(" ")).toMatch(/en rojo/);
  });

  it("el objetivo de unidades solo aplica a año completo, sector Todos y sin cliente", () => {
    const targets: DashboardTarget[] = [{ key: "unidades_producidas", targetValue: 1000, direction: "min", unit: "units", updatedBy: "u", updatedAt: NOW }];
    const w = [work({ finishedQty: "1100" })];
    const year = computeDashboard(rows({ works: w }), F(), ctx({ targets }));
    expect((year.indicators as DashboardIndicatorRow[]).find((i) => i.key === "unidades_producidas")?.light).toBe("verde");
    const month = computeDashboard(rows({ works: w }), F({ month: 4 }), ctx({ targets }));
    const row = (month.indicators as DashboardIndicatorRow[]).find((i) => i.key === "unidades_producidas") as DashboardIndicatorRow;
    expect(row.light).toBe("no_aplica");
    expect(row.note).toMatch(/anual/);
    const sector = computeDashboard(rows({ works: w }), F({ sector: "ENVASADO_MASIVO" }), ctx({ targets }));
    expect((sector.indicators as DashboardIndicatorRow[]).find((i) => i.key === "unidades_producidas")?.light).toBe("no_aplica");
  });
});

describe("resumen gerencial y cabecera", () => {
  it("se arma solo con lo que tiene datos y menciona objetivos solo si existen", () => {
    const a = ped({ q: 100, estado: "ENTREGADO" });
    const p = computeDashboard(
      rows({
        pedidos: [a],
        works: [work({ productionPedidoId: a.id, finishedQty: "100" })],
        deliveries: [del({ pedidoId: a.id, actualDeliveredAt: "2026-04-01T12:00:00Z" })],
      }),
      F(),
      ctx()
    );
    const text = p.summary.join("\n");
    expect(text).toMatch(/se produjeron 100 unidades/);
    expect(text).toMatch(/mayor producción fue Abril/);
    expect(text).toMatch(/1 entregados sobre 1 pedidos/);
    expect(text).toMatch(/nivel de servicio promedio es 100,0 %/);
    expect(text).toMatch(/lead time promedio es 22,0 días/);
    expect(text).not.toMatch(/objetivo/);
    expect(text).not.toMatch(/reclamo/i);
  });

  it("cabecera: año, última actualización y fuente", () => {
    const p = computeDashboard(rows(), F({ year: 2026 }), ctx({ lastDataChangeAt: "2026-10-01T10:00:00.000Z", dataSource: "database" }));
    expect(p.header.title).toBe("Dashboard Operativo");
    expect(p.header.year).toBe(2026);
    expect(p.header.generatedAt).toBe(NOW);
    expect(p.header.lastDataChangeAt).toBe("2026-10-01T10:00:00.000Z");
    expect(p.dataSource).toBe("database");
  });
});
