import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const listPublishedItems = vi.fn();
const listCompletedItems = vi.fn();

vi.mock("@/lib/planning/get-planning-service", () => ({
  getPlanningService: () => ({ listPublishedItems, listCompletedItems }),
}));

vi.mock("@/lib/planning/planning-source", () => ({
  getPlanningSource: () => "native",
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
}));

function req(query: string) {
  return new Request(`http://localhost/api/v1/work-items${query}`);
}

/**
 * AUDIT_TRAZABILIDAD_PROPAGACION — causa raíz confirmada: "CALIDAD" nunca es
 * un valor real de work_items.sector, así que listPublishedItems({sector:
 * "CALIDAD"}) caía en el fallback sin condición de sector de
 * drizzle-repository.ts (ordenado por plannedDate ASC, limit 500) — en una
 * base con más de 500 publicados históricos, un trabajo recién completado
 * podía quedar fuera de `workItems`, y CodificadoTracePanel/
 * remitoGapsFromQuality (que buscan el WorkItem completo por id en ese
 * array) mostraban Lote/VTO/packingGroups/muestras vacíos en silencio
 * aunque el dato existiera en Neon. Fix: para CALIDAD, workItems y
 * qualityItems salen de la MISMA consulta (listCompletedItems).
 */
describe("GET /api/v1/work-items — sector CALIDAD usa la fuente correcta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPublishedItems.mockResolvedValue([]);
    listCompletedItems.mockResolvedValue([]);
  });

  it("sector=CALIDAD llama listCompletedItems, NUNCA listPublishedItems (el fallback sin sector que causaba el bug)", async () => {
    const res = await GET(req("?sector=CALIDAD"));
    expect(res.status).toBe(200);
    expect(listCompletedItems).toHaveBeenCalledWith({ limit: 500 });
    expect(listPublishedItems).not.toHaveBeenCalled();
  });

  it("workItems y qualityItems salen de la MISMA fila — nunca pueden desincronizarse", async () => {
    listCompletedItems.mockResolvedValue([
      {
        id: "wi-1",
        planningWeekId: "week-1",
        plannedDate: "2026-08-03",
        plannedDateTo: null,
        client: "Cliente Test",
        product: "Producto Test",
        plannedQuantity: "1200",
        unit: "un.",
        sector: "CODIFICADO",
        line: null,
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
        packagingLote: "L-900",
        packagingVto: "2027-06-01",
        packingGroups: [{ cajas: 10, unidadesPorCaja: 100 }],
        sampleUnits: 3,
        deliverableUnits: 1000,
        completedAt: "2026-08-03T18:00:00.000Z",
        completedBy: "Codificador",
        qualityStatus: "pendiente",
      },
    ]);

    const res = await GET(req("?sector=CALIDAD"));
    const body = (await res.json()) as {
      workItems: Array<{ id: string; packagingLote: string | null; packagingVto: string | null }>;
      qualityItems: Array<{ id: string; lote: string | null; vto: string | null }>;
    };

    expect(body.workItems).toHaveLength(1);
    expect(body.qualityItems).toHaveLength(1);
    // Mismo id nativo en ambos arrays — Calidad puede cruzar uno con otro sin fallar el find().
    expect(body.workItems[0]!.id).toBe(body.qualityItems[0]!.id);
    expect(body.workItems[0]!.packagingLote).toBe("L-900");
    // El bug real: antes, qualityItems ni siquiera tenía este campo.
    expect(body.qualityItems[0]!.lote).toBe("L-900");
    expect(body.qualityItems[0]!.vto).toBe("2027-06-01");
  });

  it("otros sectores siguen usando listPublishedItems (sin cambios) y qualityItems queda vacío", async () => {
    const res = await GET(req("?sector=ENVASADO_MASIVO&weekStart=2026-08-03"));
    expect(res.status).toBe(200);
    expect(listPublishedItems).toHaveBeenCalledWith(
      expect.objectContaining({ sector: "ENVASADO_MASIVO", weekStart: "2026-08-03" })
    );
    expect(listCompletedItems).not.toHaveBeenCalled();
    const body = (await res.json()) as { qualityItems: unknown[] };
    expect(body.qualityItems).toEqual([]);
  });
});
