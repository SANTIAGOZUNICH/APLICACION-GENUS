import { describe, expect, it } from "vitest";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import {
  getPrimaryWorkItemWarningLabel,
  getWorkItemWarningCodes,
  getWorkItemWarnings,
} from "./work-item-warnings";

/** Base "en curso" en Envasado — packing aplica, item ya arrancó. */
function envasadoItem(overrides: Parameters<typeof createTestWorkItem>[0] = { id: "wi", sector: "ENVASADO_MASIVO" }) {
  return createTestWorkItem({
    status: "en_curso",
    originStage: "ACONDICIONAMIENTO",
    ...overrides,
  });
}

describe("getWorkItemWarningCodes — sistema de advertencias no bloqueantes", () => {
  // Test 1
  it("sin lote y sin VTO -> FALTA_LOTE + FALTA_VTO, label combinado", () => {
    const item = envasadoItem({
      id: "wi-1",
      sector: "ENVASADO_MASIVO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const codes = getWorkItemWarningCodes(item);
    expect(codes).toContain("FALTA_LOTE");
    expect(codes).toContain("FALTA_VTO");
    expect(getPrimaryWorkItemWarningLabel(getWorkItemWarnings(item))).toBe("FALTA LOTE Y VTO");
  });

  // Test 2
  it("solo falta lote -> únicamente FALTA_LOTE", () => {
    const item = envasadoItem({
      id: "wi-2",
      sector: "ENVASADO_MASIVO",
      packagingLote: null,
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const codes = getWorkItemWarningCodes(item);
    expect(codes).toEqual(["FALTA_LOTE"]);
    expect(getPrimaryWorkItemWarningLabel(getWorkItemWarnings(item))).toBe("FALTA LOTE");
  });

  // Test 3
  it("solo falta VTO -> únicamente FALTA_VTO", () => {
    const item = envasadoItem({
      id: "wi-3",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L26099",
      packagingVto: null,
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    const codes = getWorkItemWarningCodes(item);
    expect(codes).toEqual(["FALTA_VTO"]);
    expect(getPrimaryWorkItemWarningLabel(getWorkItemWarnings(item))).toBe("FALTA VTO");
  });

  // Test 4
  it("sin packingGroups reales (Envasado/Codificado) -> FALTA_PACKING", () => {
    const item = envasadoItem({
      id: "wi-4",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [],
    });
    const codes = getWorkItemWarningCodes(item);
    expect(codes).toEqual(["FALTA_PACKING"]);

    // packingGroups con solo filas en cero (placeholders) tampoco cuenta como cargado.
    const zeroed = envasadoItem({
      id: "wi-4b",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 0, unidadesPorCaja: 0 }],
    });
    expect(getWorkItemWarningCodes(zeroed)).toEqual(["FALTA_PACKING"]);
  });

  // Test 5
  it("completar el dato faltante hace desaparecer la advertencia correspondiente", () => {
    const missingLote = envasadoItem({
      id: "wi-5",
      sector: "ENVASADO_MASIVO",
      packagingLote: null,
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    expect(getWorkItemWarningCodes(missingLote)).toEqual(["FALTA_LOTE"]);

    const completed = { ...missingLote, packagingLote: "L26099" };
    expect(getWorkItemWarningCodes(completed)).toEqual([]);
  });

  it("muestras (sampleUnits) nunca genera advertencia, sea null o 0", () => {
    const base = envasadoItem({
      id: "wi-6",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
      sampleUnits: null,
    });
    expect(getWorkItemWarningCodes(base)).toEqual([]);
    expect(getWorkItemWarningCodes({ ...base, sampleUnits: 0 })).toEqual([]);
  });

  it("cantidad final ausente -> FALTA_CANTIDAD_FINAL", () => {
    const item = envasadoItem({
      id: "wi-7",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: null,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    expect(getWorkItemWarningCodes(item)).toEqual(["FALTA_CANTIDAD_FINAL"]);
  });

  describe("sobrante — solo si hay un gap real y nada lo explica", () => {
    it("sin gap (finishedQty == quantity) -> nunca advierte, aunque sobrante esté vacío", () => {
      const item = envasadoItem({
        id: "wi-8",
        sector: "ENVASADO_MASIVO",
        quantity: "100",
        finishedQty: "100",
        packagingLote: "L1",
        packagingVto: "10/2028",
        packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
      });
      expect(getWorkItemWarningCodes(item)).toEqual([]);
    });

    it("gap real sin explicar -> FALTA_SOBRANTE", () => {
      const item = envasadoItem({
        id: "wi-9",
        sector: "ENVASADO_MASIVO",
        quantity: "2500",
        finishedQty: "2364",
        packagingLote: "L1",
        packagingVto: "10/2028",
        packingGroups: [{ cajas: 1, unidadesPorCaja: 2364 }],
        bulkRemainderKg: null,
        bulkRemainderObservation: null,
        packingMismatchObservation: null,
      });
      expect(getWorkItemWarningCodes(item)).toEqual(["FALTA_SOBRANTE"]);
    });

    it("gap real pero explicado con sobrante de granel cargado -> no advierte", () => {
      const item = envasadoItem({
        id: "wi-10",
        sector: "ENVASADO_MASIVO",
        quantity: "2500",
        finishedQty: "2364",
        packagingLote: "L1",
        packagingVto: "10/2028",
        packingGroups: [{ cajas: 1, unidadesPorCaja: 2364 }],
        bulkRemainderKg: 40,
      });
      expect(getWorkItemWarningCodes(item)).toEqual([]);
    });

    it("gap real pero explicado con una observación de mismatch -> no advierte", () => {
      const item = envasadoItem({
        id: "wi-11",
        sector: "ENVASADO_MASIVO",
        quantity: "2500",
        finishedQty: "2364",
        packagingLote: "L1",
        packagingVto: "10/2028",
        packingGroups: [{ cajas: 1, unidadesPorCaja: 2364 }],
        packingMismatchObservation: "Faltaron envases",
      });
      expect(getWorkItemWarningCodes(item)).toEqual([]);
    });
  });

  it("status pendiente -> nunca advierte, aunque falte todo (el trabajo ni arrancó)", () => {
    const item = createTestWorkItem({
      id: "wi-12",
      sector: "ENVASADO_MASIVO",
      originStage: "ACONDICIONAMIENTO",
      status: "pendiente",
      packagingLote: null,
      packagingVto: null,
      finishedQty: null,
      packingGroups: [],
    });
    expect(getWorkItemWarningCodes(item)).toEqual([]);
  });

  it("status cancelado -> nunca advierte", () => {
    const item = envasadoItem({
      id: "wi-13",
      sector: "ENVASADO_MASIVO",
      status: "cancelado",
      packagingLote: null,
      packagingVto: null,
    });
    expect(getWorkItemWarningCodes(item)).toEqual([]);
  });

  it("origen ELABORACION (granel puro) -> packing nunca se exige, aunque no tenga packingGroups", () => {
    const item = createTestWorkItem({
      id: "wi-14",
      sector: "ELABORACION",
      originStage: "ELABORACION",
      status: "completo",
      finishedQty: "480",
      quantity: "480",
      packingGroups: [],
    });
    // Lote/VTO siguen sin cargar en este ejemplo -> igual se advierte por esos,
    // pero jamás por packing.
    const codes = getWorkItemWarningCodes(item);
    expect(codes).not.toContain("FALTA_PACKING");
  });

  it("packagingLote ausente cae a loteRef legacy antes de advertir", () => {
    const item = envasadoItem({
      id: "wi-15",
      sector: "ENVASADO_MASIVO",
      packagingLote: null,
      loteRef: "L26055",
      packagingVto: "10/2028",
      finishedQty: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    expect(getWorkItemWarningCodes(item)).toEqual([]);
  });

  it("varias advertencias -> label principal + contador de extras", () => {
    const item = envasadoItem({
      id: "wi-16",
      sector: "ENVASADO_MASIVO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: null,
      packingGroups: [],
    });
    const warnings = getWorkItemWarnings(item);
    expect(warnings.map((w) => w.code)).toEqual([
      "FALTA_LOTE",
      "FALTA_VTO",
      "FALTA_CANTIDAD_FINAL",
      "FALTA_PACKING",
    ]);
    expect(getPrimaryWorkItemWarningLabel(warnings)).toBe("FALTA LOTE Y VTO (+2)");
  });

  it("sin advertencias -> arrays vacíos y label null", () => {
    const item = envasadoItem({
      id: "wi-17",
      sector: "ENVASADO_MASIVO",
      packagingLote: "L1",
      packagingVto: "10/2028",
      finishedQty: "100",
      quantity: "100",
      packingGroups: [{ cajas: 1, unidadesPorCaja: 100 }],
    });
    expect(getWorkItemWarningCodes(item)).toEqual([]);
    expect(getPrimaryWorkItemWarningLabel(getWorkItemWarnings(item))).toBeNull();
  });
});

describe("getWorkItemWarnings — mismo criterio para Calidad/Producción/Expedición", () => {
  // Tests 7, 8, 9: las tres pantallas consumen el mismo WorkItem canónico a
  // través del mismo helper -> por construcción ven la misma advertencia.
  // No hay una función distinta por sector: se prueba UNA vez acá.
  it("el mismo WorkItem produce exactamente el mismo resultado sin importar cuántas veces se consulte", () => {
    const item = envasadoItem({
      id: "wi-18",
      sector: "CODIFICADO",
      packagingLote: null,
      packagingVto: null,
      finishedQty: "1618",
      packingGroups: [{ cajas: 17, unidadesPorCaja: 90 }],
    });
    const forCalidad = getWorkItemWarningCodes(item);
    const forProduccion = getWorkItemWarningCodes(item);
    const forExpedicion = getWorkItemWarningCodes(item);
    expect(forCalidad).toEqual(forProduccion);
    expect(forProduccion).toEqual(forExpedicion);
    expect(forCalidad).toEqual(["FALTA_LOTE", "FALTA_VTO"]);
  });
});
