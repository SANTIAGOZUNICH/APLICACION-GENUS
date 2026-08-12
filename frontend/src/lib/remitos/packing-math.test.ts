import { describe, expect, it } from "vitest";
import {
  computePackagingClose,
  packingGroupsToRemitoSlots,
  packingProducedMismatchWarning,
  remitoSlotsToPackingGroups,
  resolveWorkItemDeliverableUnits,
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

describe("computePackagingClose — caso del enunciado (1002 = 1000 en cajas + 2 muestras)", () => {
  const groups = [
    { cajas: 10, unidadesPorCaja: 25 },
    { cajas: 15, unidadesPorCaja: 50 },
  ];

  it("10×25 + 15×50 = 1000 en cajas; + 2 muestras = 1002; diferencia 0", () => {
    const close = computePackagingClose({ finishedQty: 1002, sampleUnits: 2, groups });
    expect(close.totalCajas).toBe(25);
    expect(close.enCajas).toBe(1000);
    expect(close.muestras).toBe(2);
    expect(close.totalAcondicionado).toBe(1002);
    expect(close.diferencia).toBe(0);
    expect(close.isValid).toBe(true);
  });

  it("faltan 25 unidades por distribuir si en cajas hay solo 975", () => {
    const close = computePackagingClose({
      finishedQty: 1002,
      sampleUnits: 2,
      groups: [{ cajas: 39, unidadesPorCaja: 25 }], // 975
    });
    expect(close.enCajas).toBe(975);
    expect(close.totalAcondicionado).toBe(977);
    expect(close.diferencia).toBe(25);
    expect(close.isValid).toBe(false);
  });

  it("muestras = 0 explícito no colapsa a null — sigue siendo válido y distinto de 'no informado'", () => {
    const close = computePackagingClose({
      finishedQty: 1000,
      sampleUnits: 0,
      groups,
    });
    expect(close.muestras).toBe(0);
    expect(close.enCajas).toBe(1000);
    expect(close.diferencia).toBe(0);
    expect(close.isValid).toBe(true);
  });

  it("sampleUnits null (no informado) se trata como 0 para el cálculo pero no fuerza validación falsa", () => {
    const close = computePackagingClose({ finishedQty: 1000, sampleUnits: null, groups });
    expect(close.muestras).toBe(0);
    expect(close.isValid).toBe(true);
  });

  it("sin finishedQty no se puede validar (canValidate=false), no se fuerza a inválido con diferencia falsa", () => {
    const close = computePackagingClose({ finishedQty: null, sampleUnits: 2, groups });
    expect(close.canValidate).toBe(false);
    expect(close.isValid).toBe(false);
    expect(close.diferencia).toBe(0);
  });

  it("sin distribución cargada, enCajas=0 y diferencia = finishedQty - muestras", () => {
    const close = computePackagingClose({ finishedQty: 100, sampleUnits: 5, groups: [] });
    expect(close.enCajas).toBe(0);
    expect(close.totalAcondicionado).toBe(5);
    expect(close.diferencia).toBe(95);
    expect(close.isValid).toBe(false);
  });
});

describe("resolveWorkItemDeliverableUnits — fuente única de la cantidad entregable", () => {
  it("prefiere deliverableUnits (excluye muestras) sobre packagingTotalUnits", () => {
    expect(
      resolveWorkItemDeliverableUnits({ deliverableUnits: 1000, packagingTotalUnits: 1002 })
    ).toBe(1000);
  });

  it("cae a packagingTotalUnits si no hay cierre físico (deliverableUnits null) — compat histórica", () => {
    expect(
      resolveWorkItemDeliverableUnits({ deliverableUnits: null, packagingTotalUnits: 1002 })
    ).toBe(1002);
  });

  it("null si no hay ningún dato de cierre", () => {
    expect(resolveWorkItemDeliverableUnits({ deliverableUnits: null, packagingTotalUnits: null })).toBeNull();
    expect(resolveWorkItemDeliverableUnits(null)).toBeNull();
    expect(resolveWorkItemDeliverableUnits(undefined)).toBeNull();
  });

  it("ignora valores no finitos y nunca devuelve negativo", () => {
    expect(resolveWorkItemDeliverableUnits({ deliverableUnits: Number.NaN, packagingTotalUnits: 500 })).toBe(500);
    expect(resolveWorkItemDeliverableUnits({ deliverableUnits: -10, packagingTotalUnits: null })).toBe(0);
  });
});
