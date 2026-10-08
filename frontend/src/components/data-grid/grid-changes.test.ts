import { describe, expect, it } from "vitest";
import { diffGridRows, type GenusGridRow } from "./grid-changes";

function row(id: string, values: Record<string, string>): GenusGridRow {
  return { __id: id, __version: "v1", __prot: {}, __st: {}, ...values };
}

describe("diffGridRows", () => {
  it("devuelve solo la celda cambiada (CANTIDAD) y no las vecinas", () => {
    const a = row("S26001", { lote: "S26001", cantidades: "6800", vto: "31/05/2028", producto: "SHAMPOO" });
    const b = { ...a, cantidades: "7000" };
    const diffs = diffGridRows([a], [b], ["lote", "cantidades", "vto", "producto"]);
    expect(diffs).toEqual([{ rowId: "S26001", columnKey: "cantidades", oldValue: "6800", newValue: "7000" }]);
  });

  it("ignora filas con la misma referencia y cambios solo de espacios", () => {
    const a = row("1", { lote: "A" });
    const b = row("2", { lote: "B" });
    const b2 = { ...b, lote: "B " };
    expect(diffGridRows([a, b], [a, b2], ["lote"])).toEqual([]);
  });

  it("detecta pegado multi-fila / multi-columna", () => {
    const rows = [row("1", { a: "1", b: "x" }), row("2", { a: "2", b: "y" }), row("3", { a: "3", b: "z" })];
    const next = [{ ...rows[0]!, a: "10", b: "xx" }, { ...rows[1]!, a: "20" }, rows[2]!];
    expect(diffGridRows(rows, next, ["a", "b"])).toHaveLength(3);
  });

  it("si cambia la cantidad de filas (alta/baja) no produce diffs: la grilla no crea ni borra filas", () => {
    const a = row("1", { a: "1" });
    expect(diffGridRows([a], [], ["a"])).toEqual([]);
  });
});
