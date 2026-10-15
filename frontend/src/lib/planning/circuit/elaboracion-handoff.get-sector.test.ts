import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/planning/circuit/circuit-notifications", () => ({ emitCircuitNotification: vi.fn() }));

const row = { id: "00000000-0000-4000-8000-000000000001", sector: "ELABORACION", client: "C", product: "P", productionPedidoId: null };
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select() {
      const api = {
        from: () => api,
        where: () => api,
        orderBy: () => api,
        limit: () => Promise.resolve([row]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve([])),
      };
      return api;
    },
  }),
}));

import { suggestEnvasadoDestinationForItem } from "./elaboracion-handoff";

describe("GET /work-items/[id]/envasado — chequeo de sector", () => {
  it("7) un sector ajeno al trabajo no ve destino/OP/unidades (403); Producción y Elaboración sí", async () => {
    await expect(suggestEnvasadoDestinationForItem(row.id, "ENVASADO_PREMIUM")).rejects.toMatchObject({
      name: "PlanningForbiddenError",
    });
    await expect(suggestEnvasadoDestinationForItem(row.id, "CALIDAD")).rejects.toMatchObject({ name: "PlanningForbiddenError" });
    await expect(suggestEnvasadoDestinationForItem(row.id, "PRODUCCION")).resolves.toBeTruthy();
    await expect(suggestEnvasadoDestinationForItem(row.id, "ELABORACION")).resolves.toBeTruthy();
  });
});
