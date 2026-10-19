import { beforeEach, describe, expect, it, vi } from "vitest";

const bulkDelete = vi.fn();

vi.mock("@/lib/planning/bulk-delete-works-service", () => ({
  bulkDeleteWorkItemsDurable: (...args: unknown[]) => bulkDelete(...args),
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

function req(body: unknown, sector?: string) {
  return new Request("http://localhost/api/v1/work-items/bulk-delete", {
    method: "POST",
    headers: sector ? { "x-genus-actor-sector": sector, "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/work-items/bulk-delete", () => {
  beforeEach(() => {
    bulkDelete.mockReset();
    bulkDelete.mockResolvedValue({ dryRun: false, batchKey: null, requested: 1, deleted: ["native:a"], verdicts: [] });
  });

  it("Producción elimina: usa el email de la sesión, no el del cuerpo", async () => {
    const res = await POST(req({ ids: ["native:a"], reason: "Duplicado", batchKey: "k1", actorEmail: "otro@x.com" }, "PRODUCCION"));
    expect(res.status).toBe(200);
    expect(bulkDelete).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ["native:a"], reason: "Duplicado", actorEmail: "prod@x.com", batchKey: "k1", dryRun: false })
    );
  });

  it.each(["ELABORACION", "ENVASADO_MASIVO", "CALIDAD", "DIRECCION", "DEPOSITO"])("%s no puede eliminar en masa (403) y no llega al servicio", async (sector) => {
    const res = await POST(req({ ids: ["native:a"], reason: "x" }, sector));
    expect(res.status).toBe(403);
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it("rechaza cuerpos inválidos", async () => {
    const res = await POST(req({ ids: "native:a" }));
    expect(res.status).toBe(400);
    expect(bulkDelete).not.toHaveBeenCalled();
  });

  it("dryRun se propaga (no escribe)", async () => {
    await POST(req({ ids: ["native:a"], dryRun: true }));
    expect(bulkDelete).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});
