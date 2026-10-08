import { describe, expect, it } from "vitest";
import type { CalendarCell, CalendarWeek } from "./calendar-model";
import { anchorInRect, buildLayout, cellAt, copyRange, expandRect, makeRect, moveFrom, parseClipboard, planPaste } from "./calendar-grid-model";

const cell = (a1: string, value = "", extra: Partial<CalendarCell> = {}): CalendarCell => ({
  a1, value, covered: false, span: 1, rowSpan: 1, protection: null, date: "2026-02-16", ...extra,
});
const cov = (a1: string): CalendarCell => cell(a1, "", { covered: true, protection: "Celda combinada: se edita en la celda ancla." });

/** Semana sintética: banda de 3 días (D4 abarca D,F,H) + celda 2x2 en F5 + normales. */
function week(): CalendarWeek {
  return {
    id: "1", headerRow: 1, lastRow: 6, dates: [null, null, null, null, null], label: "x",
    rows: [
      { rowNumber: 4, role: "planning", cells: [cell("B4", "CRISTIAN", { span: 5 }), cov("D4"), cov("F4"), cov("H4"), cov("J4")] },
      { rowNumber: 5, role: "planning", cells: [cell("B5", "A"), cell("D5", "B"), cell("F5", "BLOQUE", { span: 2, rowSpan: 2 }), cov("H5"), cell("J5", "E", { protection: "Cerrado" })] },
      { rowNumber: 6, role: "planning", cells: [cell("B6", "a"), cell("D6", "b"), cov("F6"), cov("H6"), cell("J6", "e")] },
    ],
  };
}

describe("calendar-grid-model (celdas combinadas)", () => {
  const L = buildLayout(week());

  it("cada coordenada pertenece al ancla de su combinación", () => {
    expect(L.owner[0]![3]).toEqual({ ri: 0, d: 0 }); // banda de la semana
    expect(L.owner[1]![3]).toEqual({ ri: 1, d: 2 }); // bloque 2x2
    expect(L.owner[2]![2]).toEqual({ ri: 1, d: 2 });
    expect(cellAt(L, { ri: 2, d: 3 })!.value).toBe("BLOQUE");
  });

  it("expandRect incluye combinaciones completas", () => {
    const r = expandRect(L, makeRect({ ri: 2, d: 3 }, { ri: 2, d: 3 }));
    expect(r).toEqual({ r0: 1, r1: 2, d0: 2, d1: 3 });
  });

  it("copyRange: el valor de una combinación va solo en su esquina (como Excel)", () => {
    expect(copyRange(L, { r0: 1, r1: 2, d0: 0, d1: 4 })).toBe("A\tB\tBLOQUE\t\tE\na\tb\t\t\te");
    expect(copyRange(L, { r0: 0, r1: 0, d0: 0, d1: 4 })).toBe("CRISTIAN\t\t\t\t");
    // rango que corta la combinación: la esquina visible del rango lleva el valor
    expect(copyRange(L, { r0: 2, r1: 2, d0: 3, d1: 4 })).toBe("BLOQUE\te");
  });

  it("anchorInRect detecta combinaciones tocadas por el rango", () => {
    expect(anchorInRect(L, { ri: 1, d: 2 }, { r0: 2, r1: 2, d0: 3, d1: 3 })).toBe(true);
    expect(anchorInRect(L, { ri: 1, d: 1 }, { r0: 2, r1: 2, d0: 3, d1: 3 })).toBe(false);
  });

  it("planPaste: respeta protegidas y cubiertas, no duplica anclas, ignora sin cambios", () => {
    const p = planPaste(L, { ri: 1, d: 0 }, [["X", "Y", "Z", "W", "Q"]], true);
    expect(p.changes.map((c) => [c.a1, c.newValue])).toEqual([["B5", "X"], ["D5", "Y"], ["F5", "Z"]]);
    expect(p.skipped).toEqual([{ a1: "J5", reason: "Cerrado" }]);
    const same = planPaste(L, { ri: 1, d: 0 }, [["A", "B"]], true);
    expect(same.changes).toHaveLength(0);
    const f = planPaste(L, { ri: 1, d: 0 }, [["=SUM(A1)"]], true);
    expect(f.invalid[0]!.message).toMatch(/fórmulas/);
    const ro = planPaste(L, { ri: 1, d: 0 }, [["X"]], false);
    expect(ro.skipped).toHaveLength(1);
  });

  it("moveFrom salta bloques combinados", () => {
    expect(moveFrom(L, { ri: 1, d: 1 }, "ArrowRight")).toEqual({ ri: 1, d: 2 });
    expect(moveFrom(L, { ri: 1, d: 2 }, "ArrowRight")).toEqual({ ri: 1, d: 4 });
    expect(moveFrom(L, { ri: 1, d: 2 }, "ArrowDown")).toEqual({ ri: 1, d: 2 }); // borde inferior: se queda en el bloque
    expect(moveFrom(L, { ri: 0, d: 0 }, "ArrowDown")).toEqual({ ri: 1, d: 0 });
    expect(moveFrom(L, { ri: 1, d: 0 }, "ArrowUp")).toEqual({ ri: 0, d: 0 });
  });

  it("parseClipboard", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});
