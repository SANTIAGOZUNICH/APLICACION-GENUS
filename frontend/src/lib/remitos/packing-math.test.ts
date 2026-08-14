import { describe, expect, it } from "vitest";
import {
  computePackagingClose,
  packingGroupsToRemitoSlots,
  packingProducedMismatchWarning,
  remitoSlotsToPackingGroups,
  resolveDirectCompletePackedUnits,
  resolveWorkItemDeliverableUnits,
  resolveWorkItemPackedUnits,
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

/**
 * REGLA DEFINITIVA (auditoría de integridad operativa — corrección sobre
 * PR #76): las muestras (sampleUnits) son METADATA INTERNA únicamente.
 * NO suman, NO restan, NO participan de difference/isBalanced/packedUnits.
 *
 *   packedUnits = SUM(cajas × unidadesPorCaja)
 *   difference  = finishedUnits - packedUnits   (bruto, SIN restar muestras)
 *   isBalanced  = difference === 0
 *
 * Estos son los 3 casos obligatorios del pedido (A/B/C), más el caso D
 * (verificado en otros archivos — el remito nunca renderiza "Muestras").
 */
describe("computePackagingClose — regla definitiva (muestras = metadata, nunca resta)", () => {
  it("Caso A — 2883 producidas, 3 muestras, 2880 embalado → difference 3 (las muestras NO la compensan)", () => {
    const close = computePackagingClose({
      finishedQty: 2883,
      sampleUnits: 3,
      groups: [
        { cajas: 28, unidadesPorCaja: 102 }, // 2856
        { cajas: 1, unidadesPorCaja: 24 }, // 24 -> 2880
      ],
    });
    expect(close.finishedUnits).toBe(2883);
    expect(close.sampleUnits).toBe(3); // conservado como metadata
    expect(close.packedUnits).toBe(2880);
    expect(close.difference).toBe(3);
    expect(close.isBalanced).toBe(false);
    // deliverableUnits quedó deprecado — ya no resta muestras, vale packedUnits.
    expect(close.deliverableUnits).toBe(2880);
  });

  it("Caso B — 2883 producidas, 3 muestras, 2883 embalado → difference 0", () => {
    const close = computePackagingClose({
      finishedQty: 2883,
      sampleUnits: 3,
      groups: [{ cajas: 1, unidadesPorCaja: 2883 }],
    });
    expect(close.packedUnits).toBe(2883);
    expect(close.difference).toBe(0);
    expect(close.isBalanced).toBe(true);
    expect(close.sampleUnits).toBe(3); // muestras se sigue registrando internamente
  });

  it("Caso C — 1002 producidas, 2 muestras, 1000 embalado → difference 2, NUNCA 0", () => {
    const close = computePackagingClose({
      finishedQty: 1002,
      sampleUnits: 2,
      groups: [
        { cajas: 10, unidadesPorCaja: 25 }, // 250
        { cajas: 15, unidadesPorCaja: 50 }, // 750 -> 1000
      ],
    });
    expect(close.packedUnits).toBe(1000);
    expect(close.difference).toBe(2);
    expect(close.isBalanced).toBe(false);
    expect(close.difference).not.toBe(0);
  });

  it("muestras = 0 explícito se conserva como 0, no como null/NaN", () => {
    const close = computePackagingClose({
      finishedQty: 1000,
      sampleUnits: 0,
      groups: [{ cajas: 10, unidadesPorCaja: 100 }],
    });
    expect(close.sampleUnits).toBe(0);
    expect(Number.isNaN(close.sampleUnits)).toBe(false);
    expect(close.difference).toBe(0);
    expect(close.isBalanced).toBe(true);
  });

  it("sampleUnits null (no informado) se trata como 0 para el metadata, pero sigue sin afectar difference", () => {
    const close = computePackagingClose({
      finishedQty: 1000,
      sampleUnits: null,
      groups: [{ cajas: 10, unidadesPorCaja: 100 }],
    });
    expect(close.sampleUnits).toBe(0);
    expect(close.isBalanced).toBe(true);
  });

  it("sin finishedQty no se puede validar (canValidate=false), no se fuerza a inválido con diferencia falsa", () => {
    const close = computePackagingClose({
      finishedQty: null,
      sampleUnits: 2,
      groups: [{ cajas: 10, unidadesPorCaja: 25 }],
    });
    expect(close.canValidate).toBe(false);
    expect(close.isValid).toBe(false);
    expect(close.diferencia).toBe(0);
  });

  it("sin distribución cargada, packedUnits=0 y difference = finishedQty completo (muestras no descuentan)", () => {
    const close = computePackagingClose({ finishedQty: 100, sampleUnits: 5, groups: [] });
    expect(close.packedUnits).toBe(0);
    expect(close.difference).toBe(100);
    expect(close.isValid).toBe(false);
  });

  it("aumentar muestras NO reduce la diferencia (antes sí lo hacía — bug corregido)", () => {
    const groups = [{ cajas: 10, unidadesPorCaja: 100 }]; // 1000 embalado
    const conPocasMuestras = computePackagingClose({ finishedQty: 1005, sampleUnits: 1, groups });
    const conMuchasMuestras = computePackagingClose({ finishedQty: 1005, sampleUnits: 50, groups });
    expect(conPocasMuestras.difference).toBe(5);
    expect(conMuchasMuestras.difference).toBe(5);
    expect(conPocasMuestras.difference).toBe(conMuchasMuestras.difference);
  });
});

describe("packingProducedMismatchWarning — bruto vs embalado, muestras nunca explica la diferencia", () => {
  const packed1000 = [
    { cajas: 10, unidadesPorCaja: 25 },
    { cajas: 15, unidadesPorCaja: 50 },
  ];

  it("1002 producido y 1000 embalado, CON 2 muestras informadas → sigue marcando mismatch (regla definitiva)", () => {
    const w = packingProducedMismatchWarning(1002, packed1000, 2);
    expect(w.ok).toBe(false);
    expect(w.calculated).toBe(1000);
    expect(w.message).toMatch(/no coincide/);
  });

  it("mismo resultado sin informar muestras — el parámetro ya no cambia ok/message", () => {
    const conMuestras = packingProducedMismatchWarning(1002, packed1000, 2);
    const sinMuestras = packingProducedMismatchWarning(1002, packed1000, 0);
    expect(conMuestras.ok).toBe(sinMuestras.ok);
    expect(conMuestras.calculated).toBe(sinMuestras.calculated);
  });

  it("1000 producido y 1000 embalado → sin mismatch", () => {
    const w = packingProducedMismatchWarning(1000, packed1000, 0);
    expect(w.ok).toBe(true);
    expect(w.message).toBeNull();
  });
});

describe("resolveWorkItemDeliverableUnits — lee la columna persistida (deprecated pero compatible)", () => {
  it("lee deliverableUnits persistido (que ahora contiene packedUnits, no un neto)", () => {
    expect(
      resolveWorkItemDeliverableUnits({ deliverableUnits: 2880, packagingTotalUnits: 2883 })
    ).toBe(2880);
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

describe("resolveWorkItemPackedUnits — fuente primaria para remito/Entregados (packedUnits real, nunca resta muestras)", () => {
  it("Caso A: calcula fresco desde packingGroups — 2880, no 2883 y no 2880-derivado-de-muestras", () => {
    const result = resolveWorkItemPackedUnits({
      packingGroups: [
        { cajas: 28, unidadesPorCaja: 102 },
        { cajas: 1, unidadesPorCaja: 24 },
      ],
      deliverableUnits: null,
      packagingTotalUnits: 2883,
    });
    expect(result).toBe(2880);
  });

  it("Caso B: packingGroups suma exactamente lo producido → 2883", () => {
    const result = resolveWorkItemPackedUnits({
      packingGroups: [{ cajas: 1, unidadesPorCaja: 2883 }],
      deliverableUnits: null,
      packagingTotalUnits: 2883,
    });
    expect(result).toBe(2883);
  });

  it("Caso C: 1002 producido, 1000 embalado → devuelve 1000 (el real embalado), no 1002 ni un neto de muestras", () => {
    const result = resolveWorkItemPackedUnits({
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 25 },
        { cajas: 15, unidadesPorCaja: 50 },
      ],
      deliverableUnits: null,
      packagingTotalUnits: 1002,
    });
    expect(result).toBe(1000);
  });

  it("sin packingGroups: cae al fallback seguro existente (deliverableUnits persistido → packagingTotalUnits bruto), nunca inventa un dato", () => {
    expect(
      resolveWorkItemPackedUnits({ packingGroups: null, deliverableUnits: 850, packagingTotalUnits: 900 })
    ).toBe(850);
    expect(
      resolveWorkItemPackedUnits({ packingGroups: [], deliverableUnits: null, packagingTotalUnits: 900 })
    ).toBe(900);
    expect(
      resolveWorkItemPackedUnits({ packingGroups: null, deliverableUnits: null, packagingTotalUnits: null })
    ).toBeNull();
  });
});

describe("resolveDirectCompletePackedUnits — cierre al 'Completar trabajo' directo (sin Codificado)", () => {
  it("caso 2883/3/2880: devuelve packedUnits=2880 (NUNCA finishedUnits-sampleUnits)", () => {
    // Bug real encontrado en la auditoría: un trabajo de Envasado que se
    // completa DIRECTO a Calidad (sin pasar por Codificado) pero que ya
    // tiene packingGroups/sampleUnits cargados (vía PackagingQuantitiesBlock
    // en el drawer) nunca calculaba este valor — entregas/remito caían al
    // bruto (packagingTotalUnits) para estos trabajos.
    const result = resolveDirectCompletePackedUnits({
      packingGroups: [
        { cajas: 28, unidadesPorCaja: 102 },
        { cajas: 1, unidadesPorCaja: 24 },
      ],
      sampleUnits: 3,
      finishedQty: 2883,
    });
    // 2880 acá es packedUnits real (28×102+1×24) — coincide numéricamente
    // con 2883-3 en este caso puntual, pero NO es un cálculo de resta (ver
    // el siguiente test, que varía sampleUnits y prueba que el resultado
    // no cambia).
    expect(result).toBe(2880);
    expect(result).not.toBe(2880 + 3); // no suma muestras
  });

  it("confirma que NO es un cálculo finishedUnits - sampleUnits: con muestras distintas, el resultado no cambia", () => {
    const base = {
      packingGroups: [
        { cajas: 28, unidadesPorCaja: 102 },
        { cajas: 1, unidadesPorCaja: 24 },
      ],
      finishedQty: 2883,
    };
    const conTresMuestras = resolveDirectCompletePackedUnits({ ...base, sampleUnits: 3 });
    const conCeroMuestras = resolveDirectCompletePackedUnits({ ...base, sampleUnits: 0 });
    const conCienMuestras = resolveDirectCompletePackedUnits({ ...base, sampleUnits: 100 });
    expect(conTresMuestras).toBe(2880);
    expect(conCeroMuestras).toBe(2880);
    expect(conCienMuestras).toBe(2880);
  });

  it("sin packingGroups (ej. Elaboración): no infiere un cierre — devuelve null", () => {
    expect(
      resolveDirectCompletePackedUnits({
        packingGroups: null,
        sampleUnits: null,
        finishedQty: 500,
      })
    ).toBeNull();
    expect(
      resolveDirectCompletePackedUnits({
        packingGroups: [],
        sampleUnits: null,
        finishedQty: 500,
      })
    ).toBeNull();
  });

  it("sin finishedQty válido: no puede validar, devuelve null aunque haya packingGroups", () => {
    expect(
      resolveDirectCompletePackedUnits({
        packingGroups: [{ cajas: 10, unidadesPorCaja: 25 }],
        sampleUnits: 0,
        finishedQty: null,
      })
    ).toBeNull();
  });
});
