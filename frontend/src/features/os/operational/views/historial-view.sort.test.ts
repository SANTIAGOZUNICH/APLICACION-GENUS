import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { CancelledOrDeletedRow } from "../adapters/manual-work-items-repository";
import { HISTORIAL_CANCELADOS_SORT_OPTIONS, HISTORIAL_FINALIZADOS_SORT_OPTIONS } from "./historial-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Historial (Finalizados/Cancelados) tenía un
 * orden fijo (fecha desc para Finalizados, ninguno para Cancelados), sin
 * control de usuario. Se agregan opciones seleccionables preservando el
 * default previo (más recientes primero) para Finalizados.
 */
type FinalizadosRow = Parameters<(typeof HISTORIAL_FINALIZADOS_SORT_OPTIONS)[number]["compare"]>[0];

function finalizadoRow(overrides: Partial<FinalizadosRow>): FinalizadosRow {
  return {
    id: overrides.id ?? "id",
    fecha: "2026-08-03T12:00:00.000Z",
    sector: "ENVASADO_MASIVO",
    cliente: "Cliente",
    producto: "Producto",
    cantidad: "",
    estado: "pendiente",
    observacionSector: "",
    observacionCalidad: "",
    decididoPor: "",
    ...overrides,
  };
}

function canceladoRow(overrides: Partial<CancelledOrDeletedRow>): CancelledOrDeletedRow {
  return {
    item: { id: "wi-1", product: "Producto", client: "Cliente", sector: "ENVASADO_MASIVO" } as never,
    kind: "cancelado",
    previousStatus: "en_curso",
    at: "2026-08-03T12:00:00.000Z",
    actor: "test@genus",
    reason: "",
    ...overrides,
  };
}

describe("historial-view — HISTORIAL_FINALIZADOS_SORT_OPTIONS", () => {
  it("fecha_desc (default, comportamiento previo) = más recientes primero", () => {
    const rows = [
      finalizadoRow({ id: "a", fecha: "2026-08-10T00:00:00.000Z" }),
      finalizadoRow({ id: "b", fecha: "2026-01-01T00:00:00.000Z" }),
      finalizadoRow({ id: "c", fecha: "2026-12-31T00:00:00.000Z" }),
    ];
    expect(applySort(rows, HISTORIAL_FINALIZADOS_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("producto_asc/cliente_asc ordenan A-Z (nuevo — antes no existían)", () => {
    const rows = [
      finalizadoRow({ id: "a", producto: "Zapallo", cliente: "Zeta" }),
      finalizadoRow({ id: "b", producto: "Acondicionador", cliente: "Acme" }),
    ];
    expect(applySort(rows, HISTORIAL_FINALIZADOS_SORT_OPTIONS, "producto_asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("historial-view — HISTORIAL_CANCELADOS_SORT_OPTIONS", () => {
  it("fecha_desc = más recientes primero (nuevo — antes no tenía ningún orden)", () => {
    const rows = [
      canceladoRow({ at: "2026-08-10T00:00:00.000Z", item: { product: "A" } as never }),
      canceladoRow({ at: "2026-01-01T00:00:00.000Z", item: { product: "B" } as never }),
    ];
    const sorted = applySort(rows, HISTORIAL_CANCELADOS_SORT_OPTIONS, "fecha_desc");
    expect(sorted[0]!.at).toBe("2026-08-10T00:00:00.000Z");
  });
});
