import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
vi.mock("@/lib/planning/bulk-pending-actions-service", () => ({
  runBulkPendingAction: (...a: unknown[]) => run(...a),
}));
vi.mock("@/lib/planning/planning-source", () => ({ isNativePlanningEnabled: () => true }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/planning/actor", () => ({
  resolvePlanningActor: (request: Request) => {
    const sector = request.headers.get("x-genus-actor-sector") ?? "PRODUCCION";
    return Promise.resolve({ email: "prod@x.com", sector, displayName: "Test" });
  },
}));

import { POST } from "./route";

const req = (body: unknown, sector?: string) =>
  new Request("http://localhost/api/v1/work-items/bulk-action", {
    method: "POST",
    headers: sector ? { "x-genus-actor-sector": sector } : {},
    body: JSON.stringify(body),
  });

describe("POST /api/v1/work-items/bulk-action", () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue({ action: "DELIVER", dryRun: false, succeeded: [], verdicts: [] });
  });

  it.each(["PRODUCCION", "DIRECCION"])("%s puede operar; el actor sale de la sesión", async (sector) => {
    const res = await POST(
      req({ action: "DELIVER", items: [{ id: "native:a" }], batchKey: "k-12345678", delivery: { remito: "R1", actualDeliveredAt: "2026-10-19T10:00:00Z" } }, sector)
    );
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELIVER", actor: expect.objectContaining({ email: "prod@x.com", sector }), delivery: expect.objectContaining({ remito: "R1" }) })
    );
  });

  it.each(["ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "CALIDAD", "DEPOSITO"])("%s recibe 403 y no llega al servicio", async (sector) => {
    for (const action of ["DELIVER", "SEND_CODIFICADO"]) {
      const res = await POST(req({ action, items: [{ id: "native:a" }], batchKey: "k-12345678" }, sector));
      expect(res.status).toBe(403);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("rechaza acción desconocida y lista inválida", async () => {
    expect((await POST(req({ action: "DELETE_ALL", items: [] }))).status).toBe(400);
    expect((await POST(req({ action: "DELIVER", items: "x" }))).status).toBe(400);
    expect((await POST(req({ action: "DELIVER", items: [{ nope: 1 }] }))).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("dryRun y totales de Codificado se propagan", async () => {
    await POST(req({ action: "SEND_CODIFICADO", items: [{ id: "native:a", totalUnits: 40 }], dryRun: true, observation: "obs" }));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SEND_CODIFICADO", dryRun: true, observation: "obs", items: [{ id: "native:a", totalUnits: 40 }] })
    );
  });
});
