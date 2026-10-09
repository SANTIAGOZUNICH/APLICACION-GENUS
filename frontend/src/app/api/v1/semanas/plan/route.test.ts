import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSectorPlan = vi.fn();
let sessionSector = "ELABORACION";

vi.mock("@/lib/orders/actor", () => ({
  // La identidad sale de la SESIÓN; el cliente no puede elegir su sector.
  resolveOrdersActor: async () => ({ email: "u@x.com", sector: sessionSector, displayName: "U" }),
}));
vi.mock("@/lib/semanas-sheet/semanas-sheet-service", () => ({
  loadSectorPlan: (...args: unknown[]) => loadSectorPlan(...args),
}));

import { OrdersForbiddenError } from "@/lib/orders/types";
import { GET } from "./route";

describe("GET /api/v1/semanas/plan", () => {
  beforeEach(() => {
    loadSectorPlan.mockReset();
    sessionSector = "ELABORACION";
  });

  it("autoriza con el sector de la sesión y pasa el sector pedido para que el servicio lo valide", async () => {
    loadSectorPlan.mockResolvedValue({ tasks: [], sectors: ["ELABORACION"] });
    const res = await GET(new Request("http://x/api/v1/semanas/plan?sector=ELABORACION", { headers: { "x-genus-actor-sector": "PRODUCCION" } }));
    expect(res.status).toBe(200);
    expect(loadSectorPlan).toHaveBeenCalledWith("ELABORACION", "ELABORACION");
  });

  it("403 cuando el servicio rechaza otro sector", async () => {
    loadSectorPlan.mockRejectedValue(new OrdersForbiddenError("No tenés permiso para ver la planificación de ese sector."));
    const res = await GET(new Request("http://x/api/v1/semanas/plan?sector=ENVASADO_MASIVO"));
    expect(res.status).toBe(403);
  });

  it("502 con mensaje claro si la planilla no se puede leer", async () => {
    loadSectorPlan.mockRejectedValue(new Error("timeout"));
    const res = await GET(new Request("http://x/api/v1/semanas/plan"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/timeout/);
  });
});
