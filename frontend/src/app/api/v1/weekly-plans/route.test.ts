import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTOR_EMAIL_HEADER } from "@/lib/auth/constants";
import { GET } from "./route";

const listPublishedItems = vi.fn();

vi.mock("@/lib/planning/get-planning-service", () => ({
  getPlanningService: () => ({ listPublishedItems }),
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
}));

function req(email: string, query = "") {
  return new Request(`http://localhost/api/v1/weekly-plans${query}`, {
    headers: { [ACTOR_EMAIL_HEADER]: email },
  });
}

describe("GET /api/v1/weekly-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPublishedItems.mockResolvedValue([]);
  });

  it("returns 403 for Elaboracion actor", async () => {
    const res = await GET(req("elaboracion@laboratoriogenus.com.ar"));
    expect(res.status).toBe(403);
  });

  it("allows Codificado Masivo+Premium and rejects Elaboracion filter", async () => {
    const ok = await GET(
      req("codificado@laboratoriogenus.com.ar", "?weekStart=2026-08-03&planSector=ENVASADO_MASIVO")
    );
    expect(ok.status).toBe(200);
    expect(listPublishedItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sectors: ["ENVASADO_MASIVO"],
        weekStart: "2026-08-03",
      })
    );

    const forbidden = await GET(
      req("codificado@laboratoriogenus.com.ar", "?weekStart=2026-08-03&planSector=ELABORACION")
    );
    expect(forbidden.status).toBe(403);
  });

  it("allows Materia Prima only Elaboracion", async () => {
    const ok = await GET(req("mp@laboratoriogenus.com.ar", "?weekStart=2026-08-03"));
    expect(ok.status).toBe(200);
    expect(listPublishedItems).toHaveBeenCalledWith(
      expect.objectContaining({ sectors: ["ELABORACION"] })
    );

    const forbidden = await GET(
      req("mp@laboratoriogenus.com.ar", "?weekStart=2026-08-03&planSector=ENVASADO_PREMIUM")
    );
    expect(forbidden.status).toBe(403);
  });

  it("allows Deposito combined plans", async () => {
    const res = await GET(req("deposito@laboratoriogenus.com.ar", "?weekStart=2026-08-03"));
    expect(res.status).toBe(200);
    expect(listPublishedItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sectors: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
      })
    );
  });
});
