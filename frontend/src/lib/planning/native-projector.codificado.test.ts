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

  /**
   * Caso 9 obligatorio — handoff Envasado→Codificado→Calidad conserva
   * lote/VTO/OA/packingGroups/muestras/sobrante/observaciones. La escritura
   * (codificado-handoff-service.ts) ya se auditó y no se tocó en este
   * bloque; esto prueba la proyección Neon→WorkItem que Calidad y
   * Producción efectivamente leen (native-projector.ts, mismo camino para
   * ambos sectores) — que ningún campo se recorta al pasar por acá.
   */
  it("entrega desde Codificado preserva TODA la trazabilidad para Calidad y Producción", () => {
    const wi = projectNativeWorkItem(
      base({
        sector: "CODIFICADO",
        line: null,
        viaCodificado: true,
        codificadoOriginSector: "ENVASADO_MASIVO",
        sentToCodificadoAt: "2026-08-03T15:00:00.000Z",
        sentToCodificadoBy: "Operario Masivo",
        deliveredFromCodificadoAt: "2026-08-03T18:00:00.000Z",
        deliveredFromCodificadoBy: "Codificador",
        codificadoObservation: "Cerrado sin novedades",
        packagingLote: "L-900",
        packagingVto: "2027-06-01",
        orderNumber: "OA-2026-000145",
        packingGroups: [
          { cajas: 10, unidadesPorCaja: 100 },
          { cajas: 2, unidadesPorCaja: 50 },
        ],
        sampleUnits: 3,
        deliverableUnits: 1100,
        bulkRemainderKg: 3.2,
        bulkRemainderObservation: "Sobrante guardado en tambor 4",
      })
    );
    expect(wi.packagingLote).toBe("L-900");
    expect(wi.packagingVto).toBe("2027-06-01");
    expect(wi.oaRef).toBe("OA-2026-000145");
    expect(wi.packingGroups).toEqual([
      { cajas: 10, unidadesPorCaja: 100 },
      { cajas: 2, unidadesPorCaja: 50 },
    ]);
    expect(wi.sampleUnits).toBe(3);
    expect(wi.deliverableUnits).toBe(1100);
    expect(wi.bulkRemainderKg).toBe(3.2);
    expect(wi.bulkRemainderObservation).toBe("Sobrante guardado en tambor 4");
    expect(wi.operationalObservation).toBe("Cerrado sin novedades");
  });
});
