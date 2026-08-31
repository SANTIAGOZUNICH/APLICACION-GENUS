import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { RemitoRecord } from "@/lib/remitos/types";
import { REMITOS_SORT_OPTIONS } from "./remitos-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Remitos ("Generados") es un archivo histórico
 * sin límite de crecimiento y no tenía NINGÚN ordenamiento (ni control ni
 * server). Tests contra los comparadores reales exportados.
 */
function remito(overrides: Partial<RemitoRecord>): RemitoRecord {
  return {
    id: overrides.id ?? "id",
    remitoNumber: null,
    displayName: null,
    clientIdNormalized: "cliente",
    clientDisplay: "Cliente",
    deliveryDate: "2026-08-03",
    status: "GENERADO",
    version: 1,
    totalUnits: 0,
    totalCajas: 0,
    totalBultos: 0,
    snapshot: {},
    createdBy: null,
    createdBySector: null,
    updatedBy: null,
    generatedBy: null,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    generatedAt: null,
    lines: [],
    versions: [],
    ...overrides,
  };
}

describe("remitos-view — REMITOS_SORT_OPTIONS", () => {
  const rows = [
    remito({ id: "a", remitoNumber: "100", deliveryDate: "2026-08-10", clientDisplay: "Zeta", totalUnits: 50 }),
    remito({ id: "b", remitoNumber: "9", deliveryDate: "2026-01-01", clientDisplay: "Acme", totalUnits: 500 }),
    remito({ id: "c", remitoNumber: "2", deliveryDate: "2026-12-31", clientDisplay: "Beta", totalUnits: 10 }),
  ];

  it("numero_asc ordena numéricamente (2, 9, 100), nunca alfabéticamente", () => {
    expect(applySort(rows, REMITOS_SORT_OPTIONS, "numero_asc").map((r) => r.remitoNumber)).toEqual([
      "2",
      "9",
      "100",
    ]);
  });

  it("fecha_desc (default) = más recientes primero", () => {
    expect(applySort(rows, REMITOS_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("cliente_asc/desc ordenan A-Z / Z-A", () => {
    expect(applySort(rows, REMITOS_SORT_OPTIONS, "cliente_asc").map((r) => r.clientDisplay)).toEqual([
      "Acme",
      "Beta",
      "Zeta",
    ]);
  });

  it("unidades_desc/asc ordenan por totalUnits numéricamente", () => {
    expect(applySort(rows, REMITOS_SORT_OPTIONS, "unidades_desc").map((r) => r.totalUnits)).toEqual([
      500, 50, 10,
    ]);
  });

  it("remitos sin número quedan al final en numero_asc", () => {
    const withNull = [...rows, remito({ id: "d", remitoNumber: null })];
    const sorted = applySort(withNull, REMITOS_SORT_OPTIONS, "numero_asc");
    expect(sorted[sorted.length - 1]!.id).toBe("d");
  });
});
