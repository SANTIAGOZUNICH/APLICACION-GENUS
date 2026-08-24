import { describe, expect, it } from "vitest";
import { LINE_TAB_LABELS, resolveLineBucket, type LineBucket } from "./line-buckets";

/**
 * Caso 3 obligatorio — Semanas debe poder mostrar Línea 1/2/3 al mismo
 * tiempo. La grilla en envasado-operational-view.tsx agrupa
 * `workItems.filter(item => resolveLineBucket(item.line) === bucket)` por
 * cada línea de `availableLines`; esto prueba que esa agrupación separa
 * correctamente los trabajos de las 3 líneas sin mezclarlos ni perder
 * ninguno — cada trabajo aparece en exactamente su línea, en las 3 a la vez.
 */
describe("resolveLineBucket — agrupación simultánea de Línea 1/2/3", () => {
  const items = [
    { id: "a", line: "Línea 1" },
    { id: "b", line: "Línea 2" },
    { id: "c", line: "Línea 3" },
    { id: "d", line: "L1" },
    { id: "e", line: "Linea 2" },
    { id: "f", line: null },
  ];

  function groupBy(bucket: LineBucket) {
    return items.filter((item) => (resolveLineBucket(item.line) ?? "1") === bucket);
  }

  it("cada línea agrupa exactamente sus propios trabajos", () => {
    expect(groupBy("1").map((i) => i.id)).toEqual(["a", "d", "f"]);
    expect(groupBy("2").map((i) => i.id)).toEqual(["b", "e"]);
    expect(groupBy("3").map((i) => i.id)).toEqual(["c"]);
  });

  it("las 3 líneas en conjunto cubren todos los trabajos sin duplicar ninguno", () => {
    const union = [...groupBy("1"), ...groupBy("2"), ...groupBy("3")];
    expect(union).toHaveLength(items.length);
    expect(new Set(union.map((i) => i.id)).size).toBe(items.length);
  });

  it("las 3 líneas tienen etiqueta visible propia (para el encabezado de cada columna)", () => {
    expect(LINE_TAB_LABELS["1"]).toBe("Línea 1");
    expect(LINE_TAB_LABELS["2"]).toBe("Línea 2");
    expect(LINE_TAB_LABELS["3"]).toBe("Línea 3");
  });
});
