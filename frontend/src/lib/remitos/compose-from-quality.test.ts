import { describe, expect, it } from "vitest";
import {
  remitoComposeSummary,
  producedVsBoxedWarning,
  withComposeAutoTotal,
  type RemitoComposeLine,
} from "./compose-from-quality";

function line(partial: Partial<RemitoComposeLine> & Pick<RemitoComposeLine, "product">): RemitoComposeLine {
  return {
    id: partial.id ?? "l1",
    remitoId: "",
    workItemId: partial.workItemId ?? "w1",
    product: partial.product,
    lote: partial.lote ?? "L",
    vto: partial.vto ?? "1/1",
    totalUnits: partial.totalUnits ?? 0,
    cajas1: partial.cajas1 ?? 0,
    unidades1: partial.unidades1 ?? 0,
    cajas2: partial.cajas2 ?? 0,
    unidades2: partial.unidades2 ?? 0,
    cajas3: partial.cajas3 ?? 0,
    unidades3: partial.unidades3 ?? 0,
    extraCajas: partial.extraCajas ?? [],
    sortOrder: partial.sortOrder ?? 0,
    producedUnits: partial.producedUnits ?? 0,
  };
}

describe("compose remito summary", () => {
  it("suma totales CREMA+SHAMPOO", () => {
    const lines = [
      withComposeAutoTotal(
        line({ product: "CREMA", cajas1: 100, unidades1: 10, producedUnits: 1000 })
      ),
      withComposeAutoTotal(
        line({
          id: "l2",
          product: "SHAMPOO",
          cajas1: 60,
          unidades1: 20,
          producedUnits: 1200,
        })
      ),
    ];
    const s = remitoComposeSummary(lines);
    expect(s.totalProductos).toBe(2);
    expect(s.totalBultos).toBe(160);
    expect(s.totalUnidades).toBe(2200);
    expect(producedVsBoxedWarning(lines)).toBeNull();
  });

  it("advierte si producido ≠ embalado", () => {
    const lines = [
      withComposeAutoTotal(
        line({ product: "CREMA", cajas1: 100, unidades1: 10, producedUnits: 1000 })
      ),
      withComposeAutoTotal(
        line({
          id: "l2",
          product: "SHAMPOO",
          cajas1: 59,
          unidades1: 20,
          producedUnits: 1200,
        })
      ),
    ];
    expect(producedVsBoxedWarning(lines)).toBe(
      "Advertencia: el total producido es 2200, pero el detalle de cajas suma 2180 unidades."
    );
  });
});
