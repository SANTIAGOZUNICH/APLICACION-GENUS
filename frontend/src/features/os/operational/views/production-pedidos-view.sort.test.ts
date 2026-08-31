import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { ProductionPedidoRecord } from "@/lib/production-pedidos/types";
import { PEDIDOS_SORT_OPTIONS } from "./production-pedidos-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Producción/Pedidos no tenía NINGÚN
 * ordenamiento (ni control ni parámetro server) pese a ser un listado sin
 * límite de crecimiento (todo pedido histórico, sin paginación). Estos
 * tests prueban los comparadores reales que ahora usa la pantalla —
 * exportados desde production-pedidos-view.tsx — contra fixtures
 * representativas, en vez de montar el componente completo (evita
 * duplicar la complejidad de mocks de sesión/router en cada una de las
 * ~15 pantallas tocadas por esta mejora).
 */
function pedido(overrides: Partial<ProductionPedidoRecord>): ProductionPedidoRecord {
  return {
    id: overrides.id ?? "id",
    op: null,
    fecha: null,
    nroOc: null,
    cliente: null,
    producto: null,
    s: null,
    q: null,
    ml: null,
    kg: null,
    kgDisplay: "",
    estado: null,
    createdBy: null,
    createdBySector: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

describe("production-pedidos-view — PEDIDOS_SORT_OPTIONS", () => {
  const rows = [
    pedido({ id: "a", op: "OP-100", fecha: "2026-08-10", cliente: "Zeta SA", producto: "Zapallo", q: 50 }),
    pedido({ id: "b", op: "OP-9", fecha: "2026-01-01", cliente: "Acme", producto: "Acondicionador", q: 500 }),
    pedido({ id: "c", op: "OP-2", fecha: "2026-12-31", cliente: "Beta", producto: "Base", q: 10 }),
  ];

  it("op_asc ordena numéricamente (2, 9, 100), nunca alfabéticamente", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "op_asc");
    expect(sorted.map((r) => r.op)).toEqual(["OP-2", "OP-9", "OP-100"]);
  });

  it("op_desc invierte", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "op_desc");
    expect(sorted.map((r) => r.op)).toEqual(["OP-100", "OP-9", "OP-2"]);
  });

  it("fecha_desc = más recientes primero (default de la pantalla)", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "fecha_desc");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("fecha_asc = más antiguos primero", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "fecha_asc");
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("cliente_asc ordena A-Z", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "cliente_asc");
    expect(sorted.map((r) => r.cliente)).toEqual(["Acme", "Beta", "Zeta SA"]);
  });

  it("producto_asc ordena A-Z", () => {
    const sorted = applySort(rows, PEDIDOS_SORT_OPTIONS, "producto_asc");
    expect(sorted.map((r) => r.producto)).toEqual(["Acondicionador", "Base", "Zapallo"]);
  });

  it("cantidad_desc/asc ordenan por Q numéricamente", () => {
    expect(applySort(rows, PEDIDOS_SORT_OPTIONS, "cantidad_desc").map((r) => r.q)).toEqual([500, 50, 10]);
    expect(applySort(rows, PEDIDOS_SORT_OPTIONS, "cantidad_asc").map((r) => r.q)).toEqual([10, 50, 500]);
  });

  it("valores nulos (sin OP/fecha/cliente/cantidad) quedan al final, nunca rompen el sort", () => {
    const withNulls = [...rows, pedido({ id: "d" })];
    for (const opt of PEDIDOS_SORT_OPTIONS) {
      const sorted = applySort(withNulls, PEDIDOS_SORT_OPTIONS, opt.key);
      expect(sorted).toHaveLength(4);
      expect(sorted[sorted.length - 1]!.id).toBe("d");
    }
  });
});
