import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { DeliveryRecord } from "../adapters/delivery-repository";
import { ENTREGADOS_SORT_OPTIONS } from "./entregados-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Entregados ya tenía un sort funcional, pero
 * con dos problemas reales: (1) "planned_asc" usaba `(a.plannedDeliveryDate
 * ?? "").localeCompare(...)`, así que un registro SIN fecha planificada
 * ordenaba como si fuera "la fecha más temprana posible" (string vacío
 * gana en localeCompare ascendente) en vez de ir al final; (2) faltaban
 * las opciones inversas (planned_desc/product_desc/client_desc). Ambos
 * corregidos migrando a los comparadores compartidos.
 */
function delivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: overrides.id ?? "id",
    workItemId: "wi-1",
    product: "Producto",
    codigo: null,
    client: null,
    lote: null,
    sourceSector: "ENVASADO_MASIVO",
    quantity: null,
    unit: null,
    plannedDeliveryDate: null,
    actualDeliveredAt: "2026-08-03T12:00:00.000Z",
    remito: null,
    receivedBy: null,
    observations: null,
    status: "ENTREGADO",
    deliveredBy: "test@genus",
    deliveredBySector: "ENVASADO_MASIVO",
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("entregados-view — ENTREGADOS_SORT_OPTIONS", () => {
  const rows = [
    delivery({ id: "a", actualDeliveredAt: "2026-08-10T10:00:00.000Z", plannedDeliveryDate: "2026-08-20", product: "Zapallo", client: "Zeta" }),
    delivery({ id: "b", actualDeliveredAt: "2026-01-01T10:00:00.000Z", plannedDeliveryDate: null, product: "Acondicionador", client: "Acme" }),
    delivery({ id: "c", actualDeliveredAt: "2026-12-31T10:00:00.000Z", plannedDeliveryDate: "2026-08-15", product: "Base", client: "Beta" }),
  ];

  it("planned_asc: un registro SIN fecha planificada va al FINAL, nunca primero", () => {
    const sorted = applySort(rows, ENTREGADOS_SORT_OPTIONS, "planned_asc");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sorted[sorted.length - 1]!.id).toBe("b");
  });

  it("planned_desc invierte, sin fecha sigue al final", () => {
    const sorted = applySort(rows, ENTREGADOS_SORT_OPTIONS, "planned_desc");
    expect(sorted.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("actual_desc (default) = más recientes primero", () => {
    expect(applySort(rows, ENTREGADOS_SORT_OPTIONS, "actual_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("actual_asc = más antiguas primero", () => {
    expect(applySort(rows, ENTREGADOS_SORT_OPTIONS, "actual_asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("product_asc/desc y client_asc/desc ordenan A-Z / Z-A", () => {
    expect(applySort(rows, ENTREGADOS_SORT_OPTIONS, "product_asc").map((r) => r.product)).toEqual([
      "Acondicionador",
      "Base",
      "Zapallo",
    ]);
    expect(applySort(rows, ENTREGADOS_SORT_OPTIONS, "product_desc").map((r) => r.product)).toEqual([
      "Zapallo",
      "Base",
      "Acondicionador",
    ]);
    expect(applySort(rows, ENTREGADOS_SORT_OPTIONS, "client_asc").map((r) => r.client)).toEqual([
      "Acme",
      "Beta",
      "Zeta",
    ]);
  });
});
