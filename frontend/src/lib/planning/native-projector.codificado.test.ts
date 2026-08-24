import { describe, expect, it } from "vitest";
import { projectNativeWorkItem } from "@/lib/planning/native-projector";
import type { PlanningWorkItemRecord } from "@/lib/planning/types";

function base(over: Partial<PlanningWorkItemRecord> = {}): PlanningWorkItemRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    planningWeekId: "22222222-2222-2222-2222-222222222222",
    plannedDate: "2026-08-03",
    plannedDateTo: null,
    client: "Cliente Test",
    product: "Producto Test",
    plannedQuantity: "100",
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

describe("projectNativeWorkItem · Codificado handoff", () => {
  it("proyecta asignación directa a Codificado como pendiente", () => {
    const wi = projectNativeWorkItem(
      base({ sector: "CODIFICADO", line: null, viaCodificado: false })
    );
    expect(wi.sector).toBe("CODIFICADO");
    expect(wi.status).toBe("pendiente");
    expect(wi.codificadoOriginLabel).toBe("Producción");
    expect(wi.id).toBe("native:11111111-1111-1111-1111-111111111111");
  });

  it("proyecta handoff Envasado→Codificado con status en_codificado y ownerSector origen", () => {
    const wi = projectNativeWorkItem(
      base({
        sector: "CODIFICADO",
        line: null,
        viaCodificado: true,
        codificadoOriginSector: "ENVASADO_MASIVO",
        sentToCodificadoAt: "2026-08-03T15:00:00.000Z",
        sentToCodificadoBy: "Operario Masivo",
        packagingTotalUnits: 240,
        codificadoRevision: 2,
        homeLine: "Línea 1",
      })
    );
    expect(wi.status).toBe("en_codificado");
    expect(wi.ownerSector).toBe("ENVASADO_MASIVO");
    expect(wi.codificadoOriginLabel).toBe("Envasado Masivo");
    expect(wi.packagingTotalUnits).toBe(240);
    expect(wi.codificadoRevision).toBe(2);
    expect(wi.sentToCodificadoBy).toBe("Operario Masivo");
  });

  it("proyecta entrega desde Codificado", () => {
    const wi = projectNativeWorkItem(
      base({
        sector: "CODIFICADO",
        line: null,
        viaCodificado: true,
        codificadoOriginSector: "ENVASADO_PREMIUM",
        sentToCodificadoAt: "2026-08-03T15:00:00.000Z",
        deliveredFromCodificadoAt: "2026-08-03T18:00:00.000Z",
        deliveredFromCodificadoBy: "Codificador",
      })
    );
    expect(wi.status).toBe("codificado_completo");
    expect(wi.codificadoOriginLabel).toBe("Envasado Premium");
  });

  it("proyecta pedidoOp (N° de Pedido legible) cuando el work item tiene Pedido vinculado", () => {
    const wi = projectNativeWorkItem(
      base({
        productionPedidoId: "33333333-3333-3333-3333-333333333333",
        pedidoOp: "OP-4521",
      })
    );
    expect(wi.pedidoRef).toBe("33333333-3333-3333-3333-333333333333");
    expect(wi.pedidoOp).toBe("OP-4521");
  });

  it("pedidoOp es null cuando no hay Pedido vinculado — nunca se inventa", () => {
    const wi = projectNativeWorkItem(base({}));
    expect(wi.pedidoOp).toBeNull();
  });
});
