import { describe, expect, it } from "vitest";
import { mergePackingGroups, packingTotals, resolveBoxesEntry, samePacking } from "./delivery-boxes-input";

describe("resolveBoxesEntry", () => {
  it("opción A: 8 cajas × 100 calcula el total (800) sin pedir cantidad", () => {
    expect(resolveBoxesEntry({ quantity: null, groups: [{ cajas: 8, unidadesPorCaja: 100 }] })).toMatchObject({ ok: true, quantity: 800, cajas: 8, derivedQuantity: true });
  });
  it("cajas incompletas: 8 × 100 + 1 × 50 = 850 unidades en 9 cajas", () => {
    expect(resolveBoxesEntry({ quantity: null, groups: [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }] })).toMatchObject({ ok: true, quantity: 850, cajas: 9 });
  });
  it("opción B: total informado y cajas que no suman → se registra igual con la diferencia exacta por conciliar (sin redondear ni bloquear)", () => {
    const r = resolveBoxesEntry({ quantity: 850, groups: [{ cajas: 8, unidadesPorCaja: 100 }] });
    expect(r).toMatchObject({ ok: true, quantity: 850, derivedQuantity: false, diff: 50, cajas: 8 });
    expect(resolveBoxesEntry({ quantity: 850, groups: [{ cajas: 8, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }] })).toMatchObject({ ok: true, quantity: 850, derivedQuantity: false });
  });
  it("sin información de cajas es válido (no se obliga a cargar el embalaje); filas vacías del editor se ignoran", () => {
    expect(resolveBoxesEntry({ quantity: 700, groups: [] })).toMatchObject({ ok: true, quantity: 700, groups: [], cajas: 0 });
    expect(resolveBoxesEntry({ quantity: 700, groups: [{ cajas: 0, unidadesPorCaja: 0 }, { cajas: 0, unidadesPorCaja: 0 }] })).toMatchObject({ ok: true, groups: [] });
    expect(resolveBoxesEntry({ quantity: null, groups: null })).toMatchObject({ ok: true, quantity: null });
  });
  it("rechaza cajas inválidas (decimales, negativos, mitad cargado)", () => {
    for (const g of [[{ cajas: 2.5, unidadesPorCaja: 10 }], [{ cajas: -1, unidadesPorCaja: 10 }], [{ cajas: 3, unidadesPorCaja: 0 }]]) expect(resolveBoxesEntry({ quantity: null, groups: g }).ok).toBe(false);
  });
});

describe("consolidación de cajas", () => {
  const e1 = [{ cajas: 8, unidadesPorCaja: 100 }];
  const e2 = [{ cajas: 8, unidadesPorCaja: 100 }];
  const e3 = [{ cajas: 4, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }];
  it("800 + 800 + 450 = 2.050 unidades en 21 cajas, sin mezclar tipos de caja", () => {
    const merged = mergePackingGroups([e1, e2, e3]);
    expect(merged).toEqual([{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }]);
    expect(packingTotals(merged)).toEqual({ cajas: 21, unidades: 2050 });
  });
  it("samePacking ignora el orden", () => {
    expect(samePacking([{ cajas: 1, unidadesPorCaja: 50 }, { cajas: 20, unidadesPorCaja: 100 }], [{ cajas: 20, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }])).toBe(true);
    expect(samePacking(e1, e3)).toBe(false);
  });

  it("validateDeliveryPacking lenient: las cajas que no suman se guardan tal cual con la diferencia; sin lenient sigue siendo error", async () => {
    const { validateDeliveryPacking } = await import("./delivery-packing");
    expect(validateDeliveryPacking([{ cajas: 3, unidadesPorCaja: 100 }], 305, { lenient: true })).toMatchObject({ ok: true, unidades: 300, diff: 5 });
    expect(validateDeliveryPacking([{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }], 305, { lenient: true })).toMatchObject({ ok: true, unidades: 305 });
    expect((validateDeliveryPacking([{ cajas: 3, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 5 }], 305, { lenient: true }) as { diff?: number }).diff).toBeUndefined();
    expect(validateDeliveryPacking([{ cajas: 3, unidadesPorCaja: 100 }], 305).ok).toBe(false);
    expect(validateDeliveryPacking([{ cajas: 0.5, unidadesPorCaja: 100 }], 305, { lenient: true }).ok).toBe(false); // datos inválidos siguen rechazándose
  });
});
