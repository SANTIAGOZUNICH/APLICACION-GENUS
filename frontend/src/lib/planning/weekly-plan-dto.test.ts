import { describe, expect, it } from "vitest";
import { toWeeklyPlanItemDto } from "./weekly-plan-dto";
import type { PlanningWorkItemRecord } from "./types";
import { workItemCoversDate } from "@/lib/operational/work-item-date-range";

function sample(overrides: Partial<PlanningWorkItemRecord> = {}): PlanningWorkItemRecord {
  return {
    id: "wi-1",
    planningWeekId: "w1",
    plannedDate: "2026-08-04",
    plannedDateTo: "2026-08-07",
    client: "Cliente A",
    product: "Producto X",
    plannedQuantity: "10",
    unit: "KG",
    sector: "ENVASADO_MASIVO",
    line: "Línea 1",
    branchOwner: null,
    priority: "NORMAL",
    notes: "Obs",
    status: "EN_PROCESO",
    publishedAt: null,
    createdBy: "prod@laboratoriogenus.com.ar",
    source: "native",
    originRef: null,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("weekly-plan-dto", () => {
  it("maps status to progress without localStorage", () => {
    const dto = toWeeklyPlanItemDto(sample());
    expect(dto.workItemId).toBe("wi-1");
    expect(dto.progressLabel).toBe("En progreso");
    expect(dto.responsible).toBe("Línea 1");
    expect(dto.lote).toBeNull();
    expect(dto.deliveryDate).toBeNull();
  });

  it("estado actual para la tarjeta: avance operativo si existe, si no el de planificación; lote solo si está asignado", () => {
    expect(toWeeklyPlanItemDto(sample({ status: "PUBLICADO", operationalStatus: "pendiente" })).stateLabel).toBe("Pendiente");
    expect(toWeeklyPlanItemDto(sample({ status: "PUBLICADO", operationalStatus: "en_curso" })).stateLabel).toBe("En curso");
    expect(toWeeklyPlanItemDto(sample({ status: "PUBLICADO", operationalStatus: "completo" })).stateLabel).toBe("Completo");
    expect(toWeeklyPlanItemDto(sample({ status: "PUBLICADO", operationalStatus: "bloqueado" })).stateLabel).toBe("Bloqueado");
    expect(toWeeklyPlanItemDto(sample({ status: "PUBLICADO" })).stateLabel).toBe("Pendiente");
    expect(toWeeklyPlanItemDto(sample({ status: "CANCELADO", operationalStatus: "en_curso" })).stateLabel).toBe("Cancelado");
    expect(toWeeklyPlanItemDto(sample({ packagingLote: "  L-26099 " })).lote).toBe("L-26099");
    expect(toWeeklyPlanItemDto(sample({ packagingLote: "  " })).lote).toBeNull();
  });

  it("multiday covers Tue-Fri with one workItemId", () => {
    const dto = toWeeklyPlanItemDto(sample());
    const days = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
    const covered = days.filter((d) =>
      workItemCoversDate(
        { plannedDate: dto.plannedDate, plannedDateTo: dto.plannedDateTo },
        d
      )
    );
    expect(covered).toEqual(days);
    expect(new Set(covered.map(() => dto.workItemId)).size).toBe(1);
  });
});
