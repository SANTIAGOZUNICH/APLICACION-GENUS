import { describe, expect, it } from "vitest";
import { resolveRemitoInputFromQuality } from "./from-quality";
import type { QualityItem } from "@/features/os/operational/types";
import type { WorkItem } from "@/types/operational/work-item";

describe("from-quality packingGroups", () => {
  it("mapea packingGroups a cajas1/2/3 + extras", () => {
    const item = {
      id: "qc:w1",
      kind: "salida",
      status: "aprobado",
      product: "CREMA",
      client: "TEST_CLIENTE",
      relatedWorkItemId: "w1",
      deliveryDate: "2026-07-30",
      lote: null,
      oe: null,
      oa: null,
      line: null,
      quantity: "952",
      dayLabel: "Hoy",
    } as QualityItem;
    const wi = {
      id: "w1",
      packagingLote: "L-CREMA",
      packagingVto: "30/07/2028",
      packagingTotalUnits: 952,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 20 },
        { cajas: 20, unidadesPorCaja: 20 },
        { cajas: 11, unidadesPorCaja: 32 },
      ],
    } as WorkItem;
    const input = resolveRemitoInputFromQuality(item, [wi]);
    expect(input?.cajas1).toBe(10);
    expect(input?.unidades1).toBe(20);
    expect(input?.cajas2).toBe(20);
    expect(input?.unidades2).toBe(20);
    expect(input?.cajas3).toBe(11);
    expect(input?.unidades3).toBe(32);
    expect(input?.lote).toBe("L-CREMA");
    expect(input?.vto).toBe("30/07/2028");
  });
});
