import { describe, expect, it } from "vitest";
import { describeDeliveryPacking, validateDeliveryPacking } from "./delivery-packing";

describe("cajas de una entrega", () => {
  it("12×100 + 1×50 = 13 cajas / 1.250 u. y coincide con lo entregado", () => {
    const r = validateDeliveryPacking([{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }, { cajas: 0, unidadesPorCaja: 0 }], 1250);
    expect(r).toEqual({ ok: true, groups: [{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], cajas: 13, unidades: 1250 });
    expect(describeDeliveryPacking((r as { groups: { cajas: number; unidadesPorCaja: number }[] }).groups)).toBe("12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.");
  });
  it("rechaza si el total no coincide con la entrega", () => {
    const r = validateDeliveryPacking([{ cajas: 10, unidadesPorCaja: 100 }], 1250);
    expect(r.ok).toBe(false);
  });
  it("rechaza grupos incompletos o no enteros; sin detalle es válido", () => {
    expect(validateDeliveryPacking([{ cajas: 3, unidadesPorCaja: 0 }], 300).ok).toBe(false);
    expect(validateDeliveryPacking([{ cajas: 1.5, unidadesPorCaja: 10 }], 15).ok).toBe(false);
    expect(validateDeliveryPacking(null, 100)).toEqual({ ok: true, groups: [], cajas: 0, unidades: 0 });
    expect(validateDeliveryPacking([], 100).ok).toBe(true);
  });
});
