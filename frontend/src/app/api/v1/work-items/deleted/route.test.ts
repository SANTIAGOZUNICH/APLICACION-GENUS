import { beforeEach, describe, expect, it, vi } from "vitest";

const listDeletedWorkItemsDurable = vi.fn();

vi.mock("@/lib/planning/work-item-progress-repository", () => ({
  listDeletedWorkItemsDurable: (...args: unknown[]) => listDeletedWorkItemsDurable(...args),
}));

vi.mock("@/lib/planning/planning-source", () => ({
  isNativePlanningEnabled: () => true,
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/planning/actor", () => ({
  resolvePlanningActor: (request: Request) => {
    const sector = request.headers.get("x-genus-actor-sector") ?? "PRODUCCION";
    return Promise.resolve({ email: "test@x.com", sector, displayName: "Test" });
  },
}));

function fakeDeletedRow() {
  const now = new Date("2026-09-18T10:00:00.000Z");
  return {
    id: "wi-del",
    planningWeekId: "week-1",
    plannedDate: "2026-09-14",
    plannedDateTo: null,
    client: "NIZA",
    product: "SERUM",
    plannedQuantity: "100",
    unit: "u",
    sector: "ENVASADO_MASIVO",
    line: null,
    branchOwner: null,
    priority: 0,
    notes: "",
    packagingLote: null,
    packagingVto: null,
    packagingTotalUnits: null,
    packingGroups: null,
    orderId: null,
    orderNumber: null,
    deliveryDate: null,
    status: "published",
    publishedAt: now,
    createdBy: "produccion@x.com",
    source: "semanas_2026",
    originRef: "op-1",
    version: 2,
    createdAt: now,
    updatedAt: now,
    viaCodificado: false,
    sentToCodificadoAt: null,
    sentToCodificadoBy: null,
    codificadoOriginSector: null,
    deliveredFromCodificadoAt: null,
    deliveredFromCodificadoBy: null,
    codificadoObservation: null,
    bulkRemainderKg: null,
    bulkRemainderObservation: null,
    bulkRemainderId: null,
    homeLine: null,
    homeBranchOwner: null,
    codificadoRevision: 0,
    codificadoCancelledAt: null,
    productionPedidoId: null,
    operationalStatus: "pendiente",
    finishedQty: null,
    operationalObservation: null,
    packingMismatchObservation: null,
    progressUpdatedAt: null,
    progressUpdatedBy: null,
    completedAt: null,
    completedBy: null,
    operationalCancelledAt: null,
    operationalCancelledBy: null,
    operationalCancelReason: null,
    qualityStatus: "pendiente",
    qualityDecidedAt: null,
    qualityDecidedBy: null,
    qualityDecidedBySector: null,
    qualityObservation: null,
    qualityChangeReason: null,
    sampleUnits: null,
    deliverableUnits: null,
    packagingClosedAt: null,
    packagingClosedBy: null,
    reworkRequestedAt: null,
    reworkRequestedBy: null,
    reworkRequestedBySector: null,
    reworkReason: null,
    deletedAt: new Date("2026-09-18T09:00:00.000Z"),
    deletedBy: "produccion@x.com",
    deleteReason: "Pedido duplicado",
  };
}

describe("GET /api/v1/work-items/deleted — Ver eliminados", () => {
  beforeEach(() => {
    listDeletedWorkItemsDurable.mockReset();
  });

  it("Producción ve la lista con motivo/usuario/fecha de borrado", async () => {
    listDeletedWorkItemsDurable.mockResolvedValue([fakeDeletedRow()]);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/v1/work-items/deleted", {
        headers: { "x-genus-actor-sector": "PRODUCCION" },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ deleteReason: string; deletedBy: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.deleteReason).toBe("Pedido duplicado");
    expect(body.items[0]!.deletedBy).toBe("produccion@x.com");
  });

  it("sector no autorizado (ej. Envasado) -> 403", async () => {
    listDeletedWorkItemsDurable.mockResolvedValue([]);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/v1/work-items/deleted", {
        headers: { "x-genus-actor-sector": "ENVASADO_MASIVO" },
      })
    );
    expect(res.status).toBe(403);
  });
});
