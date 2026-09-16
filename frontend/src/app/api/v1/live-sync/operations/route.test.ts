import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/config/data-mode", () => ({
  getServerDataMode: () => "real",
}));

vi.mock("@/lib/api/bff-helpers", () => ({
  canUseDriveAdapter: () => true,
}));

const mutateMock = vi.fn();
const notifyMock = vi.fn();
const getQualityDecisionMock = vi.fn<(itemId: string) => { status: string } | undefined>(
  () => undefined
);

vi.mock("@/lib/notifications/approval-envasado-notify", () => ({
  notifyEnvasadoForApproval: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("@/lib/live-sync/server-operational-state", () => ({
  serverOperationalState: {
    getRevision: () => 1,
    cancelWork: (...args: unknown[]) => mutateMock("cancel_work", ...args),
    restoreCancelledWork: (...args: unknown[]) => mutateMock("restore_work", ...args),
    decideQuality: (...args: unknown[]) => mutateMock("quality_decision", ...args),
    getQualityDecision: (itemId: string) => getQualityDecisionMock(itemId),
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
    getQualityDecisionMock.mockReset();
    getQualityDecisionMock.mockReturnValue(undefined);
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

  describe("quality_approve_batch — aprobación masiva de Calidad", () => {
    const calidadHeaders = {
      "x-genus-actor-email": "calidad@laboratoriogenus.com.ar",
      "x-genus-actor-sector": "CALIDAD",
    };

    it("403 si el actor no es CALIDAD/PRODUCCION", async () => {
      const res = await post(
        { action: "quality_approve_batch", itemIds: ["q1", "q2"], batchId: "b1", actorSectorId: "ELABORACION" },
        { "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar", "x-genus-actor-sector": "ELABORACION" }
      );
      expect(res.status).toBe(403);
      expect(mutateMock).not.toHaveBeenCalled();
    });

    it("400 EMPTY_BATCH si no se envían ids", async () => {
      const res = await post(
        { action: "quality_approve_batch", itemIds: [], batchId: "b1" },
        calidadHeaders
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(400);
      expect(body.code).toBe("EMPTY_BATCH");
    });

    it("aprueba varios ids y devuelve un resultado individual por cada uno (nunca un conteo agregado único)", async () => {
      mutateMock.mockReturnValue({});
      const res = await post(
        { action: "quality_approve_batch", itemIds: ["q1", "q2"], batchId: "b1" },
        calidadHeaders
      );
      const body = (await res.json()) as { ok: boolean; batchId: string; results: Array<{ id: string; status: string }> };
      expect(res.status).toBe(200);
      expect(body.batchId).toBe("b1");
      expect(body.results).toEqual([
        { id: "q1", status: "ok" },
        { id: "q2", status: "ok" },
      ]);
      expect(mutateMock).toHaveBeenCalledWith("quality_decision", "q1", "aprobado", expect.any(Object));
      expect(mutateMock).toHaveBeenCalledWith("quality_decision", "q2", "aprobado", expect.any(Object));
    });

    it("idempotente: un id ya aprobado se reporta 'already' y no vuelve a decidirse", async () => {
      getQualityDecisionMock.mockImplementation((itemId) =>
        itemId === "q1" ? { status: "aprobado" } : undefined
      );
      mutateMock.mockReturnValue({});
      const res = await post(
        { action: "quality_approve_batch", itemIds: ["q1", "q2"], batchId: "b1" },
        calidadHeaders
      );
      const body = (await res.json()) as { results: Array<{ id: string; status: string; currentStatus?: string }> };
      expect(body.results).toEqual([
        { id: "q1", status: "already", currentStatus: "aprobado" },
        { id: "q2", status: "ok" },
      ]);
      expect(mutateMock).not.toHaveBeenCalledWith("quality_decision", "q1", expect.anything(), expect.anything());
      expect(mutateMock).toHaveBeenCalledWith("quality_decision", "q2", "aprobado", expect.any(Object));
    });

    it("nunca pisa una decisión distinta ya tomada (rechazado) — la reporta como error", async () => {
      getQualityDecisionMock.mockImplementation((itemId) =>
        itemId === "q1" ? { status: "rechazado" } : undefined
      );
      const res = await post(
        { action: "quality_approve_batch", itemIds: ["q1"], batchId: "b1" },
        calidadHeaders
      );
      const body = (await res.json()) as { results: Array<{ id: string; status: string; message?: string }> };
      expect(body.results).toEqual([
        { id: "q1", status: "error", message: "Ya tiene una decisión distinta (rechazado)." },
      ]);
      expect(mutateMock).not.toHaveBeenCalled();
    });

    it("resultado parcial: un id que falla al decidir no interrumpe el resto del lote", async () => {
      mutateMock.mockImplementation((action: string, itemId: string) => {
        if (itemId === "q-error") throw new Error("boom");
        return {};
      });
      const res = await post(
        { action: "quality_approve_batch", itemIds: ["q1", "q-error", "q2"], batchId: "b1" },
        calidadHeaders
      );
      const body = (await res.json()) as { results: Array<{ id: string; status: string }> };
      expect(res.status).toBe(200);
      expect(body.results).toEqual([
        { id: "q1", status: "ok" },
        { id: "q-error", status: "error", message: "boom" },
        { id: "q2", status: "ok" },
      ]);
    });

    it("no notifica Envasado para ítems del overlay en memoria (solo el camino nativo trae snapshot para notificar)", async () => {
      mutateMock.mockReturnValue({});
      await post(
        { action: "quality_approve_batch", itemIds: ["q1"], batchId: "b1" },
        calidadHeaders
      );
      expect(notifyMock).not.toHaveBeenCalled();
    });
  });
});
