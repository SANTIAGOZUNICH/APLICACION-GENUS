import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listCompletedItems = vi.fn();
const retire = vi.fn();
const resolveActor = vi.fn();

vi.mock("@/lib/planning/http", async (orig) => ({
  ...(await orig<typeof import("@/lib/planning/http")>()),
  ensureNativePlanningReady: () => null,
}));
vi.mock("@/lib/planning/actor", () => ({ resolvePlanningActor: (...a: unknown[]) => resolveActor(...a) }));
vi.mock("@/lib/planning/get-planning-service", () => ({ getPlanningService: () => ({ listCompletedItems }) }));
vi.mock("@/lib/planning/circuit/quality-retirement", () => ({ retireQualityCircuitDurable: () => retire() }));
vi.mock("@/lib/planning/native-projector", () => ({ projectNativeWorkItems: (rows: unknown[]) => rows }));

import { GET } from "./route";

describe("GET /api/v1/work-items/pending-definition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActor.mockResolvedValue({ email: "p@x.com", sector: "PRODUCCION", displayName: "P" });
    retire.mockResolvedValue({ candidates: 0, recorded: 0 });
    listCompletedItems.mockResolvedValue([]);
  });

  it("6) filtra por operationalStatus EN LA CONSULTA (sin tope en memoria que deje pendientes afuera)", async () => {
    const res = await GET(new Request("http://x/api/v1/work-items/pending-definition"));
    expect(res.status).toBe(200);
    expect(listCompletedItems).toHaveBeenCalledWith({ operationalStatus: "revision" });
  });

  it("6) si falla la escritura del backfill, la lectura NO se rompe", async () => {
    retire.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new Request("http://x/api/v1/work-items/pending-definition"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, retirement: { candidates: 0, recorded: 0 } });
    spy.mockRestore();
  });

  it("solo Producción/Dirección (403 para otros sectores)", async () => {
    resolveActor.mockResolvedValue({ email: "c@x.com", sector: "CALIDAD", displayName: "C" });
    const res = await GET(new Request("http://x/api/v1/work-items/pending-definition"));
    expect(res.status).toBe(403);
  });
});
