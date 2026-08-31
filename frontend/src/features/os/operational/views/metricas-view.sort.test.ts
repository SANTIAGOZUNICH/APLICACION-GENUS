import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { PackagingMetricRecord } from "@/lib/metricas/types";
import { METRICAS_SORT_OPTIONS } from "./metricas-view";

/** AUDIT_ORDENAMIENTO_GLOBAL — Métricas (log de embalado, sin límite de crecimiento) no tenía ningún ordenamiento. */
function metric(overrides: Partial<PackagingMetricRecord>): PackagingMetricRecord {
  return {
    id: overrides.id ?? "id",
    sector: "ENVASADO_MASIVO",
    metricDate: "2026-08-03",
    product: "Producto",
    units: 0,
    responsibleDisplay: "Responsable",
    createdBy: "test@genus",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  } as PackagingMetricRecord;
}

describe("metricas-view — METRICAS_SORT_OPTIONS", () => {
  const rows = [
    metric({ id: "a", metricDate: "2026-08-10", units: 100, product: "Zapallo" }),
    metric({ id: "b", metricDate: "2026-01-01", units: 9, product: "Acondicionador" }),
    metric({ id: "c", metricDate: "2026-12-31", units: 2000, product: "Base" }),
  ];

  it("fecha_desc (default) = más recientes primero", () => {
    expect(applySort(rows, METRICAS_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("unidades_asc/desc son numéricas", () => {
    expect(applySort(rows, METRICAS_SORT_OPTIONS, "unidades_asc").map((r) => r.units)).toEqual([9, 100, 2000]);
  });

  it("producto_asc ordena A-Z", () => {
    expect(applySort(rows, METRICAS_SORT_OPTIONS, "producto_asc").map((r) => r.product)).toEqual([
      "Acondicionador",
      "Base",
      "Zapallo",
    ]);
  });
});
