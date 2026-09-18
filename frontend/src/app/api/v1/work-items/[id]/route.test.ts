import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ select: selectMock }),
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/planning/planning-source", () => ({
  isNativePlanningEnabled: () => true,
}));

vi.mock("@/lib/db/schema", () => ({
  workItems: { id: { name: "id" }, deletedAt: { name: "deletedAt" } },
  productionPedidos: { id: { name: "id" }, op: { name: "op" } },
}));

function fakeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-09-17T12:00:00.000Z");
  return {
    id: "wi-1",
    planningWeekId: "week-1",
    plannedDate: "2026-09-14",
    plannedDateTo: null,
    client: "NIZA",
    product: "SERUM",
    plannedQuantity: "100",
    unit: "u",
    sector: "ENVASADO_MASIVO",
    line: "Línea 1",
    branchOwner: "Turno A",
    priority: 0,
    notes: "",
    packagingLote: "G26043",
    packagingVto: "2028-10-31",
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
    version: 3,
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
    deletedAt: null,
    ...overrides,
  };
}

function mockRows(rows: Record<string, unknown>[]) {
  selectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  });
}

describe("GET /api/v1/work-items/[id] — fresh-fetch para editar", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
  });

  it("devuelve el WorkItem fresco con version y deletedAt — nunca confía en un objeto viejo del cliente", async () => {
    mockRows([fakeRow()]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/work-items/native:wi-1"), {
      params: Promise.resolve({ id: "native:wi-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { packagingLote: string }; version: number; deletedAt: string | null };
    expect(body.item.packagingLote).toBe("G26043");
    expect(body.version).toBe(3);
    expect(body.deletedAt).toBeNull();
  });

  it("acepta también un id sin el prefijo native:", async () => {
    mockRows([fakeRow()]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/work-items/wi-1"), {
      params: Promise.resolve({ id: "wi-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("trabajo inexistente -> 404", async () => {
    mockRows([]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/work-items/native:no-existe"), {
      params: Promise.resolve({ id: "native:no-existe" }),
    });
    expect(res.status).toBe(404);
  });

  it("trabajo eliminado (soft delete) -> igual devuelve el dato, con deletedAt informado para que el caller decida", async () => {
    mockRows([fakeRow({ deletedAt: new Date("2026-09-17T15:00:00.000Z") })]);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/v1/work-items/native:wi-1"), {
      params: Promise.resolve({ id: "native:wi-1" }),
    });
    const body = (await res.json()) as { deletedAt: string | null };
    expect(body.deletedAt).toBe("2026-09-17T15:00:00.000Z");
  });
});
