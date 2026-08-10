import { describe, expect, it } from "vitest";
import { projectQualityItem } from "@/lib/planning/native-projector";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";

function base(over: Partial<PlanningWorkItemRecord> = {}): PlanningWorkItemRecord {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    planningWeekId: "44444444-4444-4444-4444-444444444444",
    plannedDate: "2026-08-03",
    plannedDateTo: null,
    client: "Cliente Calidad",
    product: "Shampoo X",
    plannedQuantity: "1000",
    unit: "UN",
    sector: "ENVASADO_MASIVO",
    line: "Línea 1",
    branchOwner: null,
    priority: "NORMAL",
    notes: null,
    status: "PUBLICADO",
    publishedAt: "2026-08-03T12:00:00.000Z",
    createdBy: "test@genus",
    source: "native",
    originRef: null,
    version: 1,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...over,
  };
}

describe("projectQualityItem", () => {
  it("Envasado (con OA) proyecta kind=salida y toma oa de orderNumber", () => {
    const q = projectQualityItem(
      base({ orderNumber: "OA-2026-000123", completedAt: "2026-08-03T15:00:00.000Z", completedBy: "Op" })
    );
    expect(q.kind).toBe("salida");
    expect(q.oa).toBe("OA-2026-000123");
    expect(q.oe).toBeNull();
  });

  it("Elaboración (sin OA) proyecta kind=granel y toma oe de orderNumber", () => {
    const q = projectQualityItem(
      base({ sector: "ELABORACION", line: null, branchOwner: "Cristian", orderNumber: "OE-2026-000045" })
    );
    expect(q.kind).toBe("granel");
    expect(q.oe).toBe("OE-2026-000045");
    expect(q.oa).toBeNull();
  });

  it("status por defecto es pendiente si quality_status no vino seteado", () => {
    const q = projectQualityItem(base());
    expect(q.status).toBe("pendiente");
  });

  it("respeta quality_status aprobado/rechazado desde Neon", () => {
    expect(projectQualityItem(base({ qualityStatus: "aprobado" })).status).toBe("aprobado");
    expect(projectQualityItem(base({ qualityStatus: "rechazado" })).status).toBe("rechazado");
  });

  it("observation prioriza quality_observation sobre operational_observation", () => {
    const q = projectQualityItem(
      base({
        qualityObservation: "Aprobado sin objeciones",
        operationalObservation: "Avance del sector",
      })
    );
    expect(q.observation).toBe("Aprobado sin objeciones");
  });

  it("observation cae a operational_observation si no hay decisión de Calidad aún", () => {
    const q = projectQualityItem(base({ operationalObservation: "Avance del sector" }));
    expect(q.observation).toBe("Avance del sector");
  });

  it("id y relatedWorkItemId son el mismo id nativo prefijado", () => {
    const q = projectQualityItem(base());
    expect(q.id).toBe("native:33333333-3333-3333-3333-333333333333");
    expect(q.relatedWorkItemId).toBe(q.id);
  });

  it("quantity usa finishedQty si está, si no cae a plannedQuantity", () => {
    expect(projectQualityItem(base({ finishedQty: "950" })).quantity).toBe("950");
    expect(projectQualityItem(base()).quantity).toBe("1000");
  });
});
