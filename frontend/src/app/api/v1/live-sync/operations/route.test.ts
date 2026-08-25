import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/data-mode", () => ({
  getServerDataMode: () => "real",
}));

vi.mock("@/lib/api/bff-helpers", () => ({
  canUseDriveAdapter: () => true,
}));

const mutateMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("@/lib/notifications/approval-envasado-notify", () => ({
  notifyEnvasadoForApproval: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("@/lib/live-sync/server-operational-state", () => ({
  serverOperationalState: {
    getRevision: () => 1,
    cancelWork: (...args: unknown[]) => mutateMock("cancel_work", ...args),
    restoreCancelledWork: (...args: unknown[]) => mutateMock("restore_work", ...args),
    decideQuality: (...args: unknown[]) => mutateMock("quality_decision", ...args),
    annulQualityDecision: (...args: unknown[]) => mutateMock("quality_annul", ...args),
    archiveDelivery: (...args: unknown[]) => mutateMock("archive_delivery", ...args),
    restoreDelivery: (...args: unknown[]) => mutateMock("restore_delivery", ...args),
    annulDelivery: (...args: unknown[]) => mutateMock("annul_delivery", ...args),
    deleteDeliveryRecord: (...args: unknown[]) => mutateMock("delete_delivery_record", ...args),
    deliverWork: (...args: unknown[]) => mutateMock("deliver_work", ...args),
    saveProgress: () => ({}),
    completeWork: () => ({ record: {} }),
  },
}));

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) {
      const { OrdersValidationError } = require("@/lib/orders/types");
      throw new OrdersValidationError("Sesión requerida (header x-genus-actor-email).");
    }
    return { email, sector, displayName: "Test" };
  },
}));

describe("POST /api/v1/live-sync/operations RBAC", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    notifyMock.mockReset();
  });

  async function post(body: Record<string, unknown>, headers: Record<string, string>) {
    const { POST } = await import("@/app/api/v1/live-sync/operations/route");
    return POST(
      new Request("http://localhost/api/v1/live-sync/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
    );
  }

  it("403 cancel_work con sector manipulado en body", async () => {
    const res = await post(
      {
        action: "cancel_work",
        itemId: "w1",
        reason: "test",
        actorSectorId: "PRODUCCION",
      },
      {
        "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "ELABORACION",
      }
    );
    expect(res.status).toBe(403);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("403 quality_decision si actor no es CALIDAD/PRODUCCION", async () => {
    const res = await post(
      {
        action: "quality_decision",
        itemId: "q1",
        status: "aprobado",
        actorSectorId: "ELABORACION",
      },
      {
        "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "ELABORACION",
      }
    );
    expect(res.status).toBe(403);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("403 archive_delivery con body sector distinto al header", async () => {
    const res = await post(
      {
        action: "archive_delivery",
        id: "d1",
        actorSectorId: "CALIDAD",
      },
      {
        "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "PRODUCCION",
      }
    );
    expect(res.status).toBe(403);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("permite cancel_work PRODUCCION con header y body alineados", async () => {
    mutateMock.mockReturnValue({ id: "w1" });
    const res = await post(
      {
        action: "cancel_work",
        itemId: "w1",
        reason: "Error de asignación",
        actorSectorId: "PRODUCCION",
      },
      {
        "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "PRODUCCION",
      }
    );
    expect(res.status).toBe(200);
    expect(mutateMock).toHaveBeenCalledWith("cancel_work", "w1", expect.any(Object));
  });

  it("9) 403 reschedule_work si el actor no es PRODUCCION (Envasado no puede replanificar)", async () => {
    const res = await post(
      {
        action: "reschedule_work",
        itemId: "native:w1",
        plannedDate: "2026-08-26",
        actorSectorId: "ENVASADO_MASIVO",
      },
      {
        "x-genus-actor-email": "envasado@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "ENVASADO_MASIVO",
      }
    );
    expect(res.status).toBe(403);
  });

  it("reschedule_work con actor PRODUCCION pasa el gate RBAC (400 NOT_NATIVE para item no-nativo, no 403)", async () => {
    const res = await post(
      {
        action: "reschedule_work",
        itemId: "w1",
        plannedDate: "2026-08-26",
        actorSectorId: "PRODUCCION",
      },
      {
        "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
        "x-genus-actor-sector": "PRODUCCION",
      }
    );
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("NOT_NATIVE");
  });

  it("notifica Envasado solo al aprobar", async () => {
    mutateMock.mockReturnValue({ id: "q1" });
    const approved = await post(
      { action: "quality_decision", itemId: "q1", status: "aprobado", actorSectorId: "PRODUCCION", product: "Producto", client: "Cliente", plannedDate: "2026-08-03" },
      { "x-genus-actor-email": "produccion@laboratoriogenus.com.ar", "x-genus-actor-sector": "PRODUCCION" }
    );
    expect(approved.status).toBe(200);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ sector: "PRODUCCION" }), expect.objectContaining({ itemId: "q1" }), "PRODUCCION");

    notifyMock.mockReset();
    await post(
      { action: "quality_decision", itemId: "q1", status: "rechazado", actorSectorId: "PRODUCCION" },
      { "x-genus-actor-email": "produccion@laboratoriogenus.com.ar", "x-genus-actor-sector": "PRODUCCION" }
    );
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
