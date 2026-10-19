import { beforeEach, describe, expect, it, vi } from "vitest";

const scan = vi.fn();
const rebuild = vi.fn();
vi.mock("@/lib/formulas/drive-formula-source", () => ({ syncFormulaIndex: (...a: unknown[]) => scan(...a) }));
vi.mock("@/lib/formulas/drive-formulas-index", () => ({
  syncDriveFormulasIndex: (...a: unknown[]) => rebuild(...a),
  searchDriveClients: vi.fn(),
  searchDriveProducts: vi.fn(),
}));
vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (r: Request) => Promise.resolve({ email: "p@x.com", sector: r.headers.get("x-s") ?? "PRODUCCION", displayName: "P" }),
}));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/formulas/get-formula-bank", () => ({ readyFormulaBank: vi.fn() }));

import { POST } from "./route";

const req = (body: unknown, sector?: string) =>
  new Request("http://x/api/v1/formulas/options", { method: "POST", headers: sector ? { "x-s": sector } : {}, body: JSON.stringify(body) });

describe("«Actualizar fórmulas desde Drive» (POST options force)", () => {
  beforeEach(() => {
    scan.mockReset();
    rebuild.mockReset().mockResolvedValue({ ok: true, entryCount: 10, clientCount: 3, folderEnvKey: "X", builtAt: "t" });
  });
  it("vuelve a leer Drive de verdad y devuelve los archivos nuevos", async () => {
    scan.mockResolvedValue({ ok: true, runId: "r", clientCount: 3, fileCount: 10, added: 1, updated: 9, removed: 0, finishedAt: "t", newFiles: [{ client: "Pilar", fileName: "Sérum Kollaren.xlsx" }], removedFiles: 0 });
    const res = await POST(req({ force: true }));
    const body = await res.json();
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", actorEmail: "p@x.com" }));
    expect(rebuild).toHaveBeenCalledWith(true);
    expect(body).toMatchObject({ scanned: true, added: 1, newFiles: [{ client: "Pilar", fileName: "Sérum Kollaren.xlsx" }] });
  });
  it("si Drive falla (permisos/carpeta) informa el error y no finge éxito", async () => {
    scan.mockResolvedValue({ ok: false, runId: null, error: "La cuenta de servicio no ve la carpeta de fórmulas." });
    const res = await POST(req({ force: true }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/cuenta de servicio/);
  });
  it("otros sectores no pueden", async () => {
    expect((await POST(req({ force: true }, "ENVASADO_MASIVO"))).status).toBe(403);
    expect(scan).not.toHaveBeenCalled();
  });
});
