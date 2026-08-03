import { describe, expect, it, vi, beforeEach } from "vitest";

const storeRef: {
  service: import("@/lib/formulas/formula-bank-service").FormulaBankService | null;
} = { service: null };

vi.mock("@/lib/formulas/get-formula-bank", () => ({
  readyFormulaBank: async () => {
    if (!storeRef.service) throw new Error("bank not seeded");
    return storeRef.service;
  },
  persistFormulaBankIfConfigured: async () => {},
}));

vi.mock("@/lib/formulas/formula-usage", () => ({
  findFormulaUsageRefs: async () => [],
}));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => false,
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
import type { FormulaProductRecord, FormulaVersionRecord } from "@/lib/formulas/types";

function seedBank() {
  const store = new MemoryFormulaBank();
  store.products = [
    {
      id: "p-admin",
      displayClient: "UNICA",
      displayProduct: "SHAMPOO",
      normalizedClient: "unica",
      normalizedProduct: "shampoo",
      productCode: "",
      activeVersionId: "v-admin",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ] satisfies FormulaProductRecord[];
  store.versions = [
    {
      id: "v-admin",
      productId: "p-admin",
      version: 1,
      status: "VIGENTE",
      sourceFile: "f.xlsx",
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
    },
  ] satisfies FormulaVersionRecord[];
  storeRef.service = new FormulaBankService(store);
  return store;
}

describe("formulas/admin API", () => {
  beforeEach(() => {
    storeRef.service = null;
  });

  it("GET lista metadata sin ingredientes", async () => {
    seedBank();
    const { GET } = await import("@/app/api/v1/formulas/admin/route");
    const res = await GET(
      new Request("http://localhost/api/v1/formulas/admin", {
        headers: {
          "x-genus-actor-email": "calidad@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "CALIDAD",
        },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ productId: string; productLabel: string; ingredients?: unknown }>;
    };
    expect(body.entries.some((e) => e.productId === "p-admin")).toBe(true);
    expect(body.entries[0]).not.toHaveProperty("ingredients");
  });

  it("403 sector no autorizado", async () => {
    seedBank();
    const { GET } = await import("@/app/api/v1/formulas/admin/route");
    const res = await GET(
      new Request("http://localhost/api/v1/formulas/admin", {
        headers: {
          "x-genus-actor-email": "elaboracion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "ELABORACION",
        },
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST archive acepta motivo vacío (Sin motivo informado)", async () => {
    seedBank();
    const { POST } = await import("@/app/api/v1/formulas/admin/route");
    const res = await POST(
      new Request("http://localhost/api/v1/formulas/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "PRODUCCION",
        },
        body: JSON.stringify({ action: "archive", productId: "p-admin", reason: "" }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; entry?: { archived?: boolean } };
    expect(body.ok).toBe(true);
    expect(body.entry?.archived).toBe(true);
  });

  it("403 cuando body.actorSectorId no coincide con header", async () => {
    seedBank();
    const { POST } = await import("@/app/api/v1/formulas/admin/route");
    const res = await POST(
      new Request("http://localhost/api/v1/formulas/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-genus-actor-email": "produccion@laboratoriogenus.com.ar",
          "x-genus-actor-sector": "PRODUCCION",
        },
        body: JSON.stringify({
          action: "archive",
          productId: "p-admin",
          reason: "Test",
          actorSectorId: "CALIDAD",
        }),
      })
    );
    expect(res.status).toBe(403);
  });
});
