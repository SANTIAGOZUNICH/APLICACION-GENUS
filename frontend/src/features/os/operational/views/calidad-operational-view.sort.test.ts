import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { QualityItem } from "../types";
import { CALIDAD_DECISION_SORT_OPTIONS } from "./calidad-operational-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Aprobados/Rechazados en Calidad es un
 * archivo histórico de decisiones (crece sin límite, nunca se vacía) que
 * antes usaba sortReceivedFirst (heurística de PRIORIDAD DE COLA pensada
 * para Pendientes) sin ningún control de usuario. Ahora tiene su propio
 * set de opciones, default "más recientes" (fecha de decisión/completado).
 */
function qualityItem(overrides: Partial<QualityItem>): QualityItem {
  return {
    id: overrides.id ?? "id",
    kind: "salida",
    lote: null,
    product: "Producto",
    client: "Cliente",
    oe: null,
    oa: null,
    line: null,
    quantity: null,
    dayLabel: "Lunes",
    status: "aprobado",
    relatedWorkItemId: null,
    ...overrides,
  };
}

describe("calidad-operational-view — CALIDAD_DECISION_SORT_OPTIONS", () => {
  const rows = [
    qualityItem({ id: "a", completedAt: "2026-08-10T10:00:00.000Z", product: "Zapallo", client: "Zeta", quantity: "100" }),
    qualityItem({ id: "b", completedAt: "2026-01-01T10:00:00.000Z", product: "Acondicionador", client: "Acme", quantity: "9" }),
    qualityItem({ id: "c", completedAt: "2026-12-31T10:00:00.000Z", product: "Base", client: "Beta", quantity: "2000" }),
  ];

  it("completado_desc (default) = más recientes primero", () => {
    expect(applySort(rows, CALIDAD_DECISION_SORT_OPTIONS, "completado_desc").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("cantidad_asc ordena numéricamente (9, 100, 2000), no alfabéticamente", () => {
    expect(applySort(rows, CALIDAD_DECISION_SORT_OPTIONS, "cantidad_asc").map((r) => r.quantity)).toEqual([
      "9",
      "100",
      "2000",
    ]);
  });

  it("producto_asc y cliente_asc ordenan A-Z", () => {
    expect(applySort(rows, CALIDAD_DECISION_SORT_OPTIONS, "producto_asc").map((r) => r.product)).toEqual([
      "Acondicionador",
      "Base",
      "Zapallo",
    ]);
    expect(applySort(rows, CALIDAD_DECISION_SORT_OPTIONS, "cliente_asc").map((r) => r.client)).toEqual([
      "Acme",
      "Beta",
      "Zeta",
    ]);
  });
});
