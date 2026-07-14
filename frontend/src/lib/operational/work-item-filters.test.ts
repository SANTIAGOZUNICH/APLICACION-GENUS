import { describe, expect, it } from "vitest";
import { filterWorkItemsForSector } from "@/lib/operational/work-item-filters";
import type { WorkItem } from "@/types/operational/work-item";

function item(sector: WorkItem["sector"], id: string): WorkItem {
  return {
    id,
    sector,
    ownerSector: sector,
    ownerPerson: null,
    source: "semanas_2026",
    sourceFileId: "test",
    sourceSheet: null,
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: "ELABORACION",
    date: null,
    plannedDate: null,
    dayLabel: null,
    dayOfWeek: null,
    weekLabel: null,
    weekStart: null,
    weekId: null,
    client: "Cliente",
    product: "Producto",
    quantity: null,
    unit: null,
    line: null,
    deliveryDate: null,
    status: "pendiente",
    priority: null,
    pedidoRef: null,
    oeRef: null,
    oaRef: null,
    loteRef: null,
    notes: null,
    actionLabel: "Abrir trabajo",
    href: null,
    confidence: "low",
    createdFrom: "test",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
  };
}

describe("filterWorkItemsForSector PRODUCCION", () => {
  it("agrega Masivo, Premium, Elaboración y Calidad", () => {
    const items = [
      item("ENVASADO_MASIVO", "m1"),
      item("ENVASADO_PREMIUM", "p1"),
      item("ELABORACION", "e1"),
      item("CALIDAD", "c1"),
      item("COMERCIAL", "x1"),
      item("PRODUCCION", "prod"),
    ];

    const filtered = filterWorkItemsForSector(items, "PRODUCCION");
    expect(filtered.map((i) => i.sector).sort()).toEqual([
      "CALIDAD",
      "ELABORACION",
      "ENVASADO_MASIVO",
      "ENVASADO_PREMIUM",
    ]);
  });
});
