import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import { MP_LEDGER_SORT_OPTIONS } from "./mp-stock-ledger-panel";

/** AUDIT_ORDENAMIENTO_GLOBAL — ledger de stock MP (auditoría, sin límite de crecimiento) no tenía ningún ordenamiento. */
type Movement = Parameters<(typeof MP_LEDGER_SORT_OPTIONS)[number]["compare"]>[0];

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: overrides.id ?? "id",
    codigo: "COD-1",
    kind: "INGRESO",
    quantity: 0,
    balanceAfter: 0,
    reason: "",
    refType: null,
    refId: null,
    createdAt: "2026-08-03T12:00:00.000Z",
    actorEmail: "test@genus",
    ...overrides,
  };
}

describe("mp-stock-ledger-panel — MP_LEDGER_SORT_OPTIONS", () => {
  const rows = [
    movement({ id: "a", createdAt: "2026-08-10T10:00:00.000Z", quantity: 50, balanceAfter: 200 }),
    movement({ id: "b", createdAt: "2026-01-01T10:00:00.000Z", quantity: 500, balanceAfter: 9 }),
    movement({ id: "c", createdAt: "2026-12-31T10:00:00.000Z", quantity: 10, balanceAfter: 2000 }),
  ];

  it("fecha_desc (default) = más recientes primero", () => {
    expect(applySort(rows, MP_LEDGER_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("cantidad_asc y saldo_asc ordenan numéricamente", () => {
    expect(applySort(rows, MP_LEDGER_SORT_OPTIONS, "cantidad_asc").map((r) => r.quantity)).toEqual([
      10, 50, 500,
    ]);
    expect(applySort(rows, MP_LEDGER_SORT_OPTIONS, "saldo_asc").map((r) => r.balanceAfter)).toEqual([
      9, 200, 2000,
    ]);
  });
});
