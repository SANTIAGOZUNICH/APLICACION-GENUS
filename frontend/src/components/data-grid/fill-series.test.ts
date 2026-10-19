import { describe, expect, it } from "vitest";
import { canSeries, defaultFillMode, fillValues, formatSheetNumber, parseSheetNumber } from "./fill-series";

describe("relleno de series (como Excel)", () => {
  it("1 → 2, 3, 4, 5, 6 (una sola celda numérica continúa de a 1)", () => {
    expect(fillValues(["1"], 5, 1, "series", "number")).toEqual(["2", "3", "4", "5", "6"]);
  });
  it("10 y 20 → 30, 40, 50, 60", () => {
    expect(fillValues(["10", "20"], 4, 1, "series", "number")).toEqual(["30", "40", "50", "60"]);
  });
  it("hacia arriba continúa hacia atrás: 10 y 20 → 0, -10…", () => {
    expect(fillValues(["10", "20"], 2, -1, "series", "number")).toEqual(["0", "-10"]);
    expect(fillValues(["5"], 3, -1, "series", "number")).toEqual(["4", "3", "2"]);
  });
  it("decimales con coma y miles con punto", () => {
    expect(parseSheetNumber("1.234,5")).toBe(1234.5);
    expect(parseSheetNumber("12,5")).toBe(12.5);
    expect(parseSheetNumber("abc")).toBeNull();
    expect(formatSheetNumber(0.1 + 0.2)).toBe("0,3");
    expect(fillValues(["1,5", "2"], 2, 1, "series", "number")).toEqual(["2,5", "3"]);
  });
  it("copiar celdas: repite en ciclo (un valor, o varios)", () => {
    expect(fillValues(["x"], 3, 1, "copy", "text")).toEqual(["x", "x", "x"]);
    expect(fillValues(["10", "20"], 5, 1, "copy", "number")).toEqual(["10", "20", "10", "20", "10"]);
    expect(fillValues(["10", "20"], 3, -1, "copy", "number")).toEqual(["20", "10", "20"]);
  });
  it("fechas: día a día, o con el paso de las celdas origen", () => {
    expect(fillValues(["30/01/2026"], 3, 1, "series", "date")).toEqual(["31/01/2026", "01/02/2026", "02/02/2026"]);
    expect(fillValues(["01/03/2026", "08/03/2026"], 2, 1, "series", "date")).toEqual(["15/03/2026", "22/03/2026"]);
    expect(fillValues(["2026-03-02"], 2, -1, "series", "date")).toEqual(["01/03/2026", "28/02/2026"]);
  });
  it("texto con número final continúa la numeración y conserva ceros", () => {
    expect(fillValues(["Lote 1"], 2, 1, "series", "text")).toEqual(["Lote 2", "Lote 3"]);
    expect(fillValues(["MP-007"], 2, 1, "series", "text")).toEqual(["MP-008", "MP-009"]);
  });
  it("texto sin número y columnas de texto con números NO se convierten: copia", () => {
    expect(canSeries(["Proveedor"], "text")).toBe(false);
    expect(fillValues(["Proveedor"], 2, 1, "series", "text")).toEqual(["Proveedor", "Proveedor"]);
    expect(defaultFillMode(["1"], "number")).toBe("series");
    expect(defaultFillMode(["abc"], "number")).toBe("copy");
    expect(defaultFillMode(["", "2"], "number")).toBe("copy");
  });
  it("una fecha escrita en una columna de texto se copia (no se le suma un año)", () => {
    expect(canSeries(["01/03/2026"], "text")).toBe(false);
    expect(fillValues(["01/03/2026"], 2, 1, "series", "text")).toEqual(["01/03/2026", "01/03/2026"]);
    expect(canSeries(["12"], "text")).toBe(false);
  });
  it("no inventa serie si el origen mezcla tipos", () => {
    expect(fillValues(["1", "x"], 2, 1, "series", "number")).toEqual(["1", "x"]);
  });
  it("count 0 o sin origen no devuelve nada", () => {
    expect(fillValues(["1"], 0, 1, "series", "number")).toEqual([]);
    expect(fillValues([], 3, 1, "series", "number")).toEqual([]);
  });
});
