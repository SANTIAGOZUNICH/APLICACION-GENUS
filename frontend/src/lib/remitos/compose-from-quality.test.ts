import { describe, expect, it } from "vitest";
import {
  buildComposeLinesFromQuality,
  producedUnitsFromQuality,
  producedVsBoxedWarning,
  remitoComposeSummary,
  withComposeAutoTotal,
  type RemitoComposeLine,
} from "./compose-from-quality";
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";

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

describe("producedUnitsFromQuality — devuelve el BRUTO, muestras ya no evita el aviso de mismatch (regla definitiva)", () => {
  it("Caso C del pedido — 1002 producido, 2 muestras, 1000 embalado: producedUnitsFromQuality=1002 (bruto), remito=1000 (embalado), Y SÍ hay advertencia", () => {
    const item = {
      id: "qc:w3",
      kind: "salida",
      status: "aprobado",
      product: "CREMA",
      client: "TEST_CLIENTE",
      relatedWorkItemId: "w3",
      deliveryDate: "2026-07-30",
      lote: null,
      oe: null,
      oa: null,
      line: null,
      quantity: "1002",
      dayLabel: "Hoy",
    } as QualityItem;
    const wi = {
      id: "w3",
      packagingTotalUnits: 1002,
      sampleUnits: 2,
      deliverableUnits: 1000,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 25 },
        { cajas: 15, unidadesPorCaja: 50 },
      ],
    } as WorkItem;

    // producedUnitsFromQuality = bruto real (packagingTotalUnits, ya que
    // finishedQty no está seteado en este fixture) — NUNCA un valor
    // neteado de muestras.
    expect(producedUnitsFromQuality(item, [wi])).toBe(1002);

    const built = buildComposeLinesFromQuality(item, [item], [wi]);
    expect(built.lines).toHaveLength(1);
    // El remito (totalUnits) sigue mostrando lo EMBALADO real: 1000.
    expect(built.lines[0]!.totalUnits).toBe(1000);
    expect(built.lines[0]!.producedUnits).toBe(1002);
    // Regla definitiva: producido (1002) ≠ embalado (1000) SÍ genera
    // advertencia — las 2 muestras ya no la explican ni la ocultan.
    expect(producedVsBoxedWarning(built.lines)).toBe(
      "Advertencia: el total producido es 1002, pero el detalle de cajas suma 1000 unidades."
    );
    expect(remitoComposeSummary(built.lines).totalUnidades).toBe(1000);
  });

  it("cuando producido = embalado exactamente, no hay advertencia (aunque haya muestras registradas)", () => {
    const item = {
      id: "qc:w4",
      kind: "salida",
      status: "aprobado",
      product: "CREMA",
      client: "TEST_CLIENTE",
      relatedWorkItemId: "w4",
      deliveryDate: "2026-07-30",
      lote: null,
      oe: null,
      oa: null,
      line: null,
      quantity: "2883",
      dayLabel: "Hoy",
    } as QualityItem;
    const wi = {
      id: "w4",
      packagingTotalUnits: 2883,
      sampleUnits: 3,
      deliverableUnits: 2883,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 2883 }],
    } as WorkItem;

    expect(producedUnitsFromQuality(item, [wi])).toBe(2883);
    const built = buildComposeLinesFromQuality(item, [item], [wi]);
    expect(built.lines[0]!.totalUnits).toBe(2883);
    expect(producedVsBoxedWarning(built.lines)).toBeNull();
  });
});
