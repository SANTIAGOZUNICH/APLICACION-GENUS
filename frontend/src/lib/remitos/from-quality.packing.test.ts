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

describe("from-quality — remito usa packedUnits real (SUM cajas×unidades), nunca producido ni producido-menos-muestras", () => {
  const baseItem = {
    id: "qc:w2",
    kind: "salida",
    status: "aprobado",
    product: "CREMA",
    client: "TEST_CLIENTE",
    relatedWorkItemId: "w2",
    deliveryDate: "2026-07-30",
    lote: null,
    oe: null,
    oa: null,
    line: null,
    quantity: "1002",
    dayLabel: "Hoy",
  } as QualityItem;

  it("Caso C del pedido — 1002 producido, 2 muestras, 1000 embalado → remito = 1000 (el embalado real, no 1002 ni un neto)", () => {
    const wi = {
      id: "w2",
      packagingLote: "ABC123",
      packagingVto: "10/2028",
      packagingTotalUnits: 1002,
      sampleUnits: 2,
      deliverableUnits: 1000,
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 25 },
        { cajas: 15, unidadesPorCaja: 50 },
      ],
    } as WorkItem;
    const input = resolveRemitoInputFromQuality(baseItem, [wi]);
    expect(input?.totalUnits).toBe(1000);
  });

  it("sin packingGroups (trabajo histórico sin cierre físico), cae a deliverableUnits/packagingTotalUnits — compat histórica, nunca inventa un dato", () => {
    const wi = {
      id: "w2",
      packagingLote: "ABC123",
      packagingVto: "10/2028",
      packagingTotalUnits: 1002,
      sampleUnits: null,
      deliverableUnits: null,
      packingGroups: null,
    } as WorkItem;
    const input = resolveRemitoInputFromQuality(baseItem, [wi]);
    expect(input?.totalUnits).toBe(1002);
  });
});
