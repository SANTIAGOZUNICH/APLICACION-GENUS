import type { WorkItem } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";

/** Factory mínima para tests de motores headless. */
export function createTestWorkItem(
  overrides: Partial<WorkItem> & Pick<WorkItem, "id" | "sector">
): WorkItem {
  return {
    ownerSector: overrides.sector,
    ownerPerson: null,
    source: "semanas_2026",
    sourceFileId: "test-file",
    sourceSheet: "SEMANAS",
    sourceRange: "1:1",
    originStage: "ELABORACION",
    date: null,
    dayLabel: null,
    weekLabel: null,
    client: "Cliente Test",
    product: "Producto Test",
    quantity: "100",
    unit: null,
    line: null,
    deliveryDate: null,
    status: "pendiente",
    priority: "NORMAL",
    pedidoRef: null,
    oeRef: null,
    oaRef: null,
    loteRef: null,
    notes: null,
    actionLabel: "Abrir trabajo",
    href: null,
    confidence: "high",
    createdFrom: "test",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    ...overrides,
  };
}

export function createSectorWorkItem(sector: SectorId, id: string, extra?: Partial<WorkItem>): WorkItem {
  const originStage =
    sector === "ELABORACION"
      ? "ELABORACION"
      : sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM"
        ? "ACONDICIONAMIENTO"
        : "PLANIFICACION";

  return createTestWorkItem({
    id,
    sector,
    originStage,
    ...extra,
  });
}
