import { describe, expect, it, vi, beforeEach } from "vitest";

const storeRef: {
  service: import("@/lib/formulas/formula-bank-service").FormulaBankService | null;
} = { service: null };

vi.mock("@/lib/formulas/get-formula-bank", () => ({
  readyFormulaBank: async () => {
    if (!storeRef.service) throw new Error("bank not seeded");
    return storeRef.service;
  },
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
}));

vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => {
    const email = request.headers.get("x-genus-actor-email");
    const sector = (request.headers.get("x-genus-actor-sector") || "PRODUCCION").toUpperCase();
    if (!email) throw new Error("Sesión requerida (header x-genus-actor-email).");
    return { email, sector, displayName: "Test" };
  },
}));

import {
  FormulaBankService,
  MemoryFormulaBank,
} from "@/lib/formulas/formula-bank-service";
import type {
  FormulaProductRecord,
  FormulaVersionRecord,
} from "@/lib/formulas/types";

function seed() {
  const store = new MemoryFormulaBank();
  store.products = [
    {
      id: "p1",
      displayClient: "UNICA",
      displayProduct: "SHAMPOO SOLIDO",
      normalizedClient: "unica",
      normalizedProduct: "shampoo solido",
      productCode: "",
      activeVersionId: "v1",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ] satisfies FormulaProductRecord[];
  store.versions = [
    {
      id: "v1",
      productId: "p1",
      version: 1,
      status: "VIGENTE",
      sourceFile: "UNICA/SHAMPOO SOLIDO.xlsx",
      sourceSheet: "OE",
      sourceModifiedAt: null,
      sourceHash: "h",
      semanticHash: "s",
      importedAt: "2020-01-01T00:00:00.000Z",
      percentageTotal: 100,
      validationStatus: "OK",
      warnings: [],
      previousVersionId: null,
      conflictCode: null,
      altSourcePaths: [],
      ingredients: [],
      procedureSteps: [],
      specifications: [],
      reviewRequired: false,
    },
  ] satisfies FormulaVersionRecord[];
  store.importRunHashes.add("archive");
  storeRef.service = new FormulaBankService(store);
}

describe("GET /api/v1/formulas/options regressions", () => {
  beforeEach(() => {
    seed();
  });

  it("PRODUCCION + q=uni → UNICA; contrato clients[].client", async () => {
    const { GET } = await import("@/app/api/v1/formulas/options/route");
    const req = new Request(
      "http://localhost/api/v1/formulas/options?scope=clients&q=uni",
      {
        headers: {
          "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "PRODUCCION",
        },
      }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clients: Array<{ client: string; rank?: string }>;
      totalActiveProducts: number;
      persistenceReady: boolean;
    };
    expect(body.persistenceReady).toBe(true);
    expect(body.totalActiveProducts).toBe(1);
    expect(body.clients).toEqual(
      expect.arrayContaining([expect.objectContaining({ client: "UNICA" })])
    );
  });

  it("UNICA + sham → producto con productId/versionId/productLabel", async () => {
    const { GET } = await import("@/app/api/v1/formulas/options/route");
    const req = new Request(
      "http://localhost/api/v1/formulas/options?scope=products&client=UNICA&q=sham",
      {
        headers: {
          "x-genus-actor-email": "calidad@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "CALIDAD",
        },
      }
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      products: Array<{
        productId: string;
        versionId: string;
        productLabel: string;
        aliases: string[];
      }>;
    };
    expect(body.products[0]?.productId).toBe("p1");
    expect(body.products[0]?.versionId).toBe("v1");
    expect(body.products[0]?.productLabel).toMatch(/SHAMPOO SOLIDO/i);
    expect(Array.isArray(body.products[0]?.aliases)).toBe(true);
  });

  it("ENVASADO_MASIVO → 403", async () => {
    const { GET } = await import("@/app/api/v1/formulas/options/route");
    const req = new Request(
      "http://localhost/api/v1/formulas/options?scope=clients&q=uni",
      {
        headers: {
          "x-genus-actor-email": "emasivo@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "ENVASADO_MASIVO",
        },
      }
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("coverageStats: activos + import runs", () => {
    expect(storeRef.service!.coverageStats()).toMatchObject({
      activeProducts: 1,
      vigentes: 1,
      completedImportRuns: 1,
    });
  });

  it("fallback exacto resolveLookup sigue funcionando", () => {
    const r = storeRef.service!.resolveLookup("UNICA", "SHAMPOO SOLIDO");
    expect(r.kind).toBe("found");
  });
});
