/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { WorkItem } from "@/types/operational/work-item";

function testItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "native:wi-day-1",
    sector: "ENVASADO_MASIVO",
    ownerSector: "ENVASADO_MASIVO",
    ownerPerson: null,
    source: "semanas_2026",
    sourceFileId: "genus-os-native",
    sourceSheet: "native_planning",
    sourceRange: null,
    productSourceRange: null,
    quantitySourceRange: null,
    originStage: "ACONDICIONAMIENTO",
    date: "2026-09-18",
    plannedDate: "2026-09-18",
    plannedDateTo: "2026-09-18",
    dateHeaderSourceRange: null,
    dateResolutionMethod: null,
    dayLabel: "Viernes",
    dayOfWeek: "Viernes",
    weekLabel: "Semana 2026-09-14",
    weekStart: "2026-09-14",
    weekId: "week-1",
    client: "NIZA",
    product: "SERUM",
    quantity: "100",
    unit: "u",
    line: "Línea 1",
    lineExpectedInSheet: true,
    deliveryDate: null,
    status: "pendiente",
    priority: 0,
    pedidoRef: null,
    pedidoOp: null,
    oeRef: null,
    oaRef: null,
    loteRef: null,
    notes: "",
    version: 1,
    packagingLote: null,
    packagingVto: null,
    packagingTotalUnits: null,
    packagingCajas: null,
    packagingUnidadesPorCaja: null,
    packingGroups: null,
    packingMismatchObservation: null,
    sampleUnits: null,
    deliverableUnits: null,
    packagingClosedAt: null,
    packagingClosedBy: null,
    actionLabel: "Abrir trabajo",
    href: null,
    confidence: "high",
    createdFrom: "test",
    generatedEntities: [],
    dependsOn: null,
    blockedBy: null,
    unblocks: null,
    ...overrides,
  } as WorkItem;
}

vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ children }: { children: React.ReactNode }) => <div data-testid="twin-shell">{children}</div>,
}));

vi.mock("@/features/work/hooks/use-sector-work-items", () => ({
  useSectorWorkItems: () => ({
    data: { workItems: [testItem()], scannedAt: null },
    loading: false,
  }),
}));

let mockSectorId = "PRODUCCION";
vi.mock("@/features/os/session/preview-context", () => ({
  usePreviewContext: () => ({
    applyEffectiveStatus: (items: WorkItem[]) => items,
    openWorkItem: () => undefined,
  }),
  usePreviewSession: () => ({ sectorId: mockSectorId, email: "actor@genus.test" }),
}));

describe("WireframePlanSemanal — Editar/Eliminar en el detalle del día (hotfix sección 1)", () => {
  afterEach(() => {
    cleanup();
    mockSectorId = "PRODUCCION";
  });

  it("Producción ve Editar/Eliminar en el detalle del día seleccionado", async () => {
    mockSectorId = "PRODUCCION";
    const { WireframePlanSemanal } = await import("./plan-semanal");
    render(<WireframePlanSemanal />);
    expect(screen.getByTestId("work-item-edit-native:wi-day-1")).toBeTruthy();
    expect(screen.getByTestId("work-item-delete-native:wi-day-1")).toBeTruthy();
  });

  it("otro sector (Envasado) NO ve Editar/Eliminar en el mismo detalle de día", async () => {
    mockSectorId = "ENVASADO_MASIVO";
    const { WireframePlanSemanal } = await import("./plan-semanal");
    render(<WireframePlanSemanal />);
    expect(screen.queryByTestId("work-item-edit-native:wi-day-1")).toBeNull();
    expect(screen.queryByTestId("work-item-delete-native:wi-day-1")).toBeNull();
  });
});
