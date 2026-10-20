import { describe, expect, it } from "vitest";
import { itemText, packingBreakdown, unitsAndCajasText } from "./packing-breakdown";

describe("desglose de cajas", () => {
  it("cajas mixtas: 10 × 5 + 1 × 3 = 53 unidades · 11 cajas", () => {
    const b = packingBreakdown([{ cajas: 10, unidadesPorCaja: 5 }, { cajas: 1, unidadesPorCaja: 3 }])!;
    expect(b.totalUnits).toBe(53);
    expect(b.totalCajas).toBe(11);
    expect(b.short).toBe("10 × 5 + 1 × 3");
    expect(unitsAndCajasText(b)).toBe("53 unidades · 11 cajas");
    expect(b.items.map(itemText)).toEqual(["10 cajas × 5 unidades = 50 unidades", "1 caja × 3 unidades = 3 unidades"]);
  });
  it("una sola configuración: 45 × 10 = 450", () => {
    const b = packingBreakdown([{ cajas: 45, unidadesPorCaja: 10 }])!;
    expect(unitsAndCajasText(b)).toBe("450 unidades · 45 cajas");
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
  it("singular: 1 unidad · 1 caja", () => {
    expect(unitsAndCajasText(packingBreakdown([{ cajas: 1, unidadesPorCaja: 1 }])!)).toBe("1 unidad · 1 caja");
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
