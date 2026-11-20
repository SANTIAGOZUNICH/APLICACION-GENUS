import { describe, expect, it } from "vitest";
import { itemText, packingBreakdown, unitsAndCajasText } from "./packing-breakdown";

describe("desglose de cajas", () => {
  it("cajas mixtas: 10 × 5 + 1 × 3 = 53 unidades — 11 cajas", () => {
    const b = packingBreakdown([{ cajas: 10, unidadesPorCaja: 5 }, { cajas: 1, unidadesPorCaja: 3 }])!;
    expect(b.totalUnits).toBe(53);
    expect(b.totalCajas).toBe(11);
    expect(b.short).toBe("10 × 5 + 1 × 3");
    expect(unitsAndCajasText(b)).toBe("53 unidades — 11 cajas");
    expect(b.items.map(itemText)).toEqual(["10 cajas × 5 unidades = 50 unidades", "1 caja × 3 unidades = 3 unidades"]);
  });
  it("una sola configuración: 45 × 10 = 450", () => {
    const b = packingBreakdown([{ cajas: 45, unidadesPorCaja: 10 }])!;
    expect(unitsAndCajasText(b)).toBe("450 unidades — 45 cajas");
    expect(b.short).toBe("45 × 10");
  });
  it("junta solo configuraciones idénticas dentro de la misma entrega (no suma otras)", () => {
    const b = packingBreakdown([{ cajas: 3, unidadesPorCaja: 5 }, { cajas: 2, unidadesPorCaja: 5 }, { cajas: 1, unidadesPorCaja: 4 }])!;
    expect(b.short).toBe("5 × 5 + 1 × 4");
    expect(b.totalUnits).toBe(29);
  });
  it("sin datos o inválidos → null (nunca inventa)", () => {
    expect(packingBreakdown(null)).toBeNull();
    expect(packingBreakdown([])).toBeNull();
    expect(packingBreakdown([{ cajas: 0, unidadesPorCaja: 5 }, { cajas: 2, unidadesPorCaja: 0 }])).toBeNull();
  });
  it("singular: 1 unidad — 1 caja", () => {
    expect(unitsAndCajasText(packingBreakdown([{ cajas: 1, unidadesPorCaja: 1 }])!)).toBe("1 unidad — 1 caja");
  });
});

import { deliveryPackingEntries } from "./packing-breakdown";

describe("cajas por entrega (sin mezclar entregas)", () => {
  const lines = [
    { id: "l1", deliveryId: "d1", sequence: 1, status: "ACTIVA", quantity: 53, packingGroups: [{ cajas: 10, unidadesPorCaja: 5 }, { cajas: 1, unidadesPorCaja: 3 }] },
    { id: "l2", deliveryId: "d1", sequence: 2, status: "ACTIVA", quantity: 20, packingGroups: [{ cajas: 2, unidadesPorCaja: 10 }] },
    { id: "l3", deliveryId: "d1", sequence: 3, status: "ANULADA", quantity: 9, packingGroups: [{ cajas: 9, unidadesPorCaja: 1 }] },
    { id: "l4", deliveryId: "d2", sequence: 1, status: "ACTIVA", quantity: 7, packingGroups: null },
  ];
  it("parciales de una misma entrega: una entrada por renglón activo, sin sumar entre sí ni con otras entregas", () => {
    const e = deliveryPackingEntries({ id: "d1" }, lines);
    expect(e.map((x) => [x.label, x.breakdown?.short])).toEqual([["Entrega #1", "10 × 5 + 1 × 3"], ["Entrega #2", "2 × 10"]]);
  });
  it("renglón sin cajas → breakdown null (Sin detalle de cajas registrado)", () => {
    expect(deliveryPackingEntries({ id: "d2" }, lines)[0]!.breakdown).toBeNull();
  });
  it("registro histórico sin renglones: usa el desglose guardado en el registro", () => {
    expect(deliveryPackingEntries({ id: "dx", packingGroups: [{ cajas: 45, unidadesPorCaja: 10 }] }, lines)[0]!.breakdown?.totalUnits).toBe(450);
  });
});

import { expandDeliveryRows } from "./packing-breakdown";
describe("expandDeliveryRows — una fila por entrega", () => {
  const rec = (id: string) => ({ id, packingGroups: null });
  const line = (id: string, deliveryId: string, sequence: number, quantity: number, groups: Array<{ cajas: number; unidadesPorCaja: number }> | null, status = "ACTIVA") => ({ id, deliveryId, sequence, status, quantity, packingGroups: groups });
  it("un trabajo con 4 entregas se abre en 4 filas con SUS cajas y totales (2.020 u. · 21 cajas)", () => {
    const lines = [
      line("a", "d1", 1, 500, [{ cajas: 5, unidadesPorCaja: 100 }]),
      line("b", "d1", 2, 600, [{ cajas: 6, unidadesPorCaja: 100 }]),
      line("c", "d1", 3, 450, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]),
      line("d", "d1", 4, 470, [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 70 }]),
    ];
    const rows = expandDeliveryRows([rec("d1")], lines);
    expect(rows.map((r) => [r.line?.sequence, r.index, r.count])).toEqual([[1, 0, 4], [2, 1, 4], [3, 2, 4], [4, 3, 4]]);
    expect(rows[0]).toMatchObject({ totalUnits: 2020, totalCajas: 21, withoutBoxes: 0 });
    expect(new Set(rows.map((r) => r.key)).size).toBe(4);
  });
  it("una sola entrega, sin renglones (histórico) o anuladas: una fila; una entrega sin cajas se cuenta como faltante", () => {
    expect(expandDeliveryRows([rec("d1")], [line("a", "d1", 1, 10, null)])).toHaveLength(1);
    expect(expandDeliveryRows([rec("d2")], [])).toHaveLength(1);
    expect(expandDeliveryRows([rec("d3")], [line("a", "d3", 1, 10, null), line("b", "d3", 2, 10, [{ cajas: 1, unidadesPorCaja: 10 }]), line("c", "d3", 3, 10, null, "ANULADA")])).toHaveLength(2);
    const r = expandDeliveryRows([rec("d4")], [line("a", "d4", 1, 10, null), line("b", "d4", 2, 10, [{ cajas: 1, unidadesPorCaja: 10 }])]);
    expect(r[0]!.withoutBoxes).toBe(1);
  });
});
