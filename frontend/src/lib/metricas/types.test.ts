import { describe, expect, it } from "vitest";
import {
  computeRanking,
  normalizeResponsibleKey,
  canAccessMetricas,
} from "./types";

describe("metricas ranking", () => {
  it("normaliza responsable", () => {
    expect(normalizeResponsibleKey("  Juan  Pérez  ")).toBe("juan pérez");
  });

  it("agrupa por responsible_key", () => {
    const ranking = computeRanking([
      {
        id: "1",
        sector: "ENVASADO_MASIVO",
        metricDate: "2026-01-01",
        product: null,
        units: 100,
        responsibleDisplay: "Ana López",
        responsibleKey: "ana lópez",
        workItemId: null,
        createdBy: "x",
        createdBySector: "ENVASADO_MASIVO",
        updatedBy: "x",
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      },
      {
        id: "2",
        sector: "ENVASADO_MASIVO",
        metricDate: "2026-01-02",
        product: null,
        units: 50,
        responsibleDisplay: "Ana López",
        responsibleKey: "ana lópez",
        workItemId: null,
        createdBy: "x",
        createdBySector: "ENVASADO_MASIVO",
        updatedBy: "x",
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      },
      {
        id: "3",
        sector: "ENVASADO_MASIVO",
        metricDate: "2026-01-02",
        product: null,
        units: 200,
        responsibleDisplay: "Bob",
        responsibleKey: "bob",
        workItemId: null,
        createdBy: "x",
        createdBySector: "ENVASADO_MASIVO",
        updatedBy: "x",
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      },
    ]);
    expect(ranking[0].responsibleKey).toBe("bob");
    expect(ranking[0].totalUnits).toBe(200);
    expect(ranking[1].totalUnits).toBe(150);
    expect(ranking[1].recordCount).toBe(2);
  });

  it("solo envasado accede", () => {
    expect(canAccessMetricas("ENVASADO_MASIVO")).toBe(true);
    expect(canAccessMetricas("ENVASADO_PREMIUM")).toBe(true);
    expect(canAccessMetricas("PRODUCCION")).toBe(false);
  });
});
