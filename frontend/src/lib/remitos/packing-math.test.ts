import { describe, expect, it } from "vitest";
import {
  packingGroupsToRemitoSlots,
  packingProducedMismatchWarning,
  remitoSlotsToPackingGroups,
  summarizePackingGroups,
} from "./packing-math";

describe("packing-math multi-caja", () => {
  it("resume 10×20 + 20×20 + 11×32 = 41 cajas / 952 u", () => {
    const groups = [
      { cajas: 10, unidadesPorCaja: 20 },
      { cajas: 20, unidadesPorCaja: 20 },
      { cajas: 11, unidadesPorCaja: 32 },
    ];
    expect(summarizePackingGroups(groups)).toEqual({
      totalCajas: 41,
      totalEmbalado: 952,
      groups,
    });
  });

  it("mapea a slots remito D/F H/J L/N + extras", () => {
    const slots = packingGroupsToRemitoSlots([
      { cajas: 10, unidadesPorCaja: 20 },
      { cajas: 20, unidadesPorCaja: 20 },
      { cajas: 11, unidadesPorCaja: 32 },
      { cajas: 5, unidadesPorCaja: 20 },
    ]);
    expect(slots).toEqual({
      cajas1: 10,
      unidades1: 20,
      cajas2: 20,
      unidades2: 20,
      cajas3: 11,
      unidades3: 32,
      extraCajas: [{ cajas: 5, unidades: 20 }],
    });
    expect(remitoSlotsToPackingGroups(slots)).toEqual([
      { cajas: 10, unidadesPorCaja: 20 },
      { cajas: 20, unidadesPorCaja: 20 },
      { cajas: 11, unidadesPorCaja: 32 },
      { cajas: 5, unidadesPorCaja: 20 },
    ]);
  });

  it("advierte mismatch sin corregir", () => {
    const w = packingProducedMismatchWarning(1000, [
      { cajas: 10, unidadesPorCaja: 20 },
      { cajas: 20, unidadesPorCaja: 20 },
      { cajas: 11, unidadesPorCaja: 32 },
    ]);
    expect(w.ok).toBe(false);
    expect(w.calculated).toBe(952);
    expect(w.message).toMatch(/no coincide/);
  });
});
