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

  it("Vista mensual: Codificado, Elaboración y MP consultan Premium, Masivo y Elaboración (solo lectura)", async () => {
    for (const email of ["codificado", "elaboracion", "mp", "deposito"]) {
      for (const sector of ["ENVASADO_PREMIUM", "ENVASADO_MASIVO", "ELABORACION"]) {
        listPublishedItems.mockClear();
        const ok = await GET(req(`${email}@laboratoriogenus.com.ar`, `?weekStart=2026-08-03&monthStart=2026-08-01&planSector=${sector}`));
        expect(ok.status).toBe(200);
        expect(listPublishedItems).toHaveBeenCalledWith(expect.objectContaining({ sectors: [sector] }));
        expect((await ok.json()).readOnly).toBe(true);
      }
    }
  });

  it("un sector que no es de piso se rechaza (403) aunque el actor pueda consultar", async () => {
    const forbidden = await GET(req("codificado@laboratoriogenus.com.ar", "?weekStart=2026-08-03&planSector=CODIFICADO"));
    expect(forbidden.status).toBe(403);
  });

  it("sin sector pedido conserva el comportamiento histórico de cada vista compartida (MP: Elaboración)", async () => {
    const ok = await GET(req("mp@laboratoriogenus.com.ar", "?weekStart=2026-08-03"));
    expect(ok.status).toBe(200);
    expect(listPublishedItems).toHaveBeenCalledWith(expect.objectContaining({ sectors: ["ELABORACION"] }));
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

  it("es de SOLO LECTURA: la ruta solo expone GET (sin POST/PUT/PATCH/DELETE) y Producción puede consultar", async () => {
    const mod = await import("./route");
    expect(Object.keys(mod).filter((k) => ["POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
    expect((await GET(req("mp@laboratoriogenus.com.ar", "?weekStart=2026-08-03&planSector=ELABORACION"))).status).toBe(200);
  });

  it("informa el permiso REAL de ME del usuario autenticado: solo Depósito y Dirección pueden modificar", async () => {
    const can = async (email: string) => (await (await GET(req(`${email}@laboratoriogenus.com.ar`, "?weekStart=2026-08-03"))).json()).canEditMe;
    expect(await can("deposito")).toBe(true);
    for (const e of ["mp", "codificado", "elaboracion"]) expect(await can(e)).toBe(false);
  });
});
