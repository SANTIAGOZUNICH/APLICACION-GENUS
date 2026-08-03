import { describe, expect, it, vi, beforeEach } from "vitest";

const entries = [
  {
    fileId: "f1",
    folderId: "c1",
    client: "UNICA",
    fileName: "SHAMPOO SOLIDO.xlsx",
    productLabel: "SHAMPOO SOLIDO",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    aliases: ["SHAMPOO SOLIDO", "SHAMPOO SOLIDO.xlsx"],
    source: "DRIVE" as const,
  },
];

vi.mock("@/lib/formulas/drive-formulas-index", () => ({
  searchDriveClients: async (q: string) => {
    if (!q) return [];
    if ("unica".startsWith(q.toLowerCase()) || "unica".includes(q.toLowerCase())) {
      return [{ client: "UNICA", rank: "exact_prefix", source: "DRIVE" }];
    }
    return [];
  },
  searchDriveProducts: async (client: string, q: string) => {
    if (client.toUpperCase() !== "UNICA") return [];
    return entries.filter((e) =>
      e.productLabel.toLowerCase().includes(q.toLowerCase())
    ).map((e) => ({ ...e, rank: "exact_prefix" as const, score: 400 }));
  },
  syncDriveFormulasIndex: async () => ({
    ok: true,
    entryCount: 1,
    clientCount: 1,
    folderEnvKey: "GOOGLE_DRIVE_FORMULAS_FOLDER_ID",
    builtAt: new Date().toISOString(),
  }),
  resolveFormulaFromDriveFile: async () => ({ found: false, message: "n/a" }),
}));

vi.mock("@/lib/formulas/get-formula-bank", () => ({
  readyFormulaBank: async () => ({
    listActiveOptions: () => [],
    coverageStats: () => ({
      totalVersions: 0,
      vigentes: 0,
      historicas: 0,
      conflictos: 0,
      activeProducts: 0,
      distinctClients: 0,
      completedImportRuns: 0,
    }),
  }),
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) throw new Error("Sesión requerida");
    return { email, sector, displayName: "Test" };
  },
}));

describe("options Drive-first", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uni → UNICA desde Drive", async () => {
    const { GET } = await import("@/app/api/v1/formulas/options/route");
    const res = await GET(
      new Request("http://localhost/api/v1/formulas/options?scope=clients&q=uni", {
        headers: {
          "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "PRODUCCION",
        },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      clients: Array<{ client: string; source: string }>;
    };
    expect(body.source).toBe("DRIVE");
    expect(body.clients[0]?.client).toBe("UNICA");
  });

  it("ELABORACION no puede buscar en Drive options", async () => {
    const { GET } = await import("@/app/api/v1/formulas/options/route");
    const res = await GET(
      new Request("http://localhost/api/v1/formulas/options?scope=clients&q=uni", {
        headers: {
          "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "ELABORACION",
        },
      })
    );
    expect(res.status).toBe(403);
  });
});
