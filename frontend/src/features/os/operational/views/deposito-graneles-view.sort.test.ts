import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { GranelRemainderRecord } from "@/lib/graneles/types";
import { GRANELES_SORT_OPTIONS } from "./deposito-graneles-view";

/** AUDIT_ORDENAMIENTO_GLOBAL — Depósito Graneles no tenía ningún ordenamiento (fixed createdAt desc, sin control, sin paginación). */
function granel(overrides: Partial<GranelRemainderRecord>): GranelRemainderRecord {
  return {
    id: overrides.id ?? "id",
    workItemId: null,
    product: "Producto",
    client: "Cliente",
    bulkLot: "",
    kgAvailable: 0,
    intakeDate: "2026-08-03",
    originSector: null,
    status: "DISPONIBLE",
    reportedBy: "test@genus",
    observation: "",
    location: "",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    annulledAt: null,
    annulledBy: null,
    annulReason: null,
    ...overrides,
  };
}

describe("deposito-graneles-view — GRANELES_SORT_OPTIONS", () => {
  const rows = [
    granel({ id: "a", intakeDate: "2026-08-10", product: "Zapallo", kgAvailable: 5 }),
    granel({ id: "b", intakeDate: "2026-01-01", product: "Acondicionador", kgAvailable: 50 }),
    granel({ id: "c", intakeDate: "2026-12-31", product: "Base", kgAvailable: 0.5 }),
  ];

  it("ingreso_desc (default) = más recientes primero", () => {
    expect(applySort(rows, GRANELES_SORT_OPTIONS, "ingreso_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("kg_desc/asc ordenan numéricamente, incluyendo decimales", () => {
    expect(applySort(rows, GRANELES_SORT_OPTIONS, "kg_asc").map((r) => r.kgAvailable)).toEqual([0.5, 5, 50]);
  });

  it("producto_asc ordena A-Z", () => {
    expect(applySort(rows, GRANELES_SORT_OPTIONS, "producto_asc").map((r) => r.product)).toEqual([
      "Acondicionador",
      "Base",
      "Zapallo",
    ]);
  });
});
