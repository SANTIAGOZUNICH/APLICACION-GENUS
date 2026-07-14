import { describe, expect, it } from "vitest";
import {
  blockExpectsExplicitLine,
  detectLineHeader,
  extractDayColumnsFromDateRow,
  inferDayColumnsFromLineRow,
  isDateHeaderRow,
  parseLineFromCell,
} from "@/lib/parsers/planner/planner-utils";

describe("detectLineHeader", () => {
  it("detecta línea en celda aislada con columnas vacías (sheet real)", () => {
    expect(detectLineHeader(["", "", "LÍNEA 1", "", ""])).toBe("Línea 1");
    expect(detectLineHeader(["", "", "LÍNEA 2"])).toBe("Línea 2");
    expect(detectLineHeader(["", "", "LÍNEA 3"])).toBe("Línea 3");
    expect(detectLineHeader(["", "", "LÍNEA 4"])).toBe("Línea 4");
  });

  it("detecta variantes sin acento y formato corto", () => {
    expect(detectLineHeader(["LINEA 1"])).toBe("Línea 1");
    expect(detectLineHeader(["LINEA N°1"])).toBe("Línea 1");
    expect(detectLineHeader(["L1"])).toBe("Línea 1");
    expect(detectLineHeader(["Premium A"])).toBe("Premium A");
  });

  it("no confunde filas de trabajo con encabezado de línea", () => {
    expect(detectLineHeader(["CAV", "SHAMPOO", "6400"])).toBeNull();
  });
});

describe("geometría columnar extendida", () => {
  it("parsea L1 desde celda corta", () => {
    expect(parseLineFromCell("L1")).toBe("Línea 1");
    expect(parseLineFromCell("L3")).toBe("Línea 3");
  });

  it("detecta fila de fechas y columnas C/E/G/I/K", () => {
    const row = ["", "2026-06-01", "", "2026-06-02", "", "2026-06-03", "", "2026-06-04", "", "2026-06-05"];
    expect(isDateHeaderRow(row)).toBe(true);
    const cols = extractDayColumnsFromDateRow(row);
    expect(cols.get(1)).toBe("Lunes");
    expect(cols.get(5)).toBe("Miércoles");
  });

  it("infiere columnas de día desde fila L1", () => {
    const row = ["", "L1", "", "CAV", "", "CAV", "", "IHC", "", "TYL"];
    const cols = inferDayColumnsFromLineRow(row);
    expect(cols.get(3)).toBe("Lunes");
    expect(cols.get(9)).toBe("Jueves");
  });

  it("distingue bloques con y sin líneas explícitas", () => {
    const legacy = [
      ["", "Lunes", "", "Martes"],
      ["", "ENVASADO CONSUMO MASIVO"],
      ["", "CAV", "", "BIO"],
      ["", "6400", "", "500"],
    ];
    expect(blockExpectsExplicitLine(legacy, 1, 3)).toBe(false);

    const modern = [
      ["", "ENVASADO CONSUMO MASIVO | 3 LINEAS"],
      ["", "L1", "", "CAV"],
      ["", "", "", "SHAMPOO"],
    ];
    expect(blockExpectsExplicitLine(modern, 0, 2)).toBe(true);
  });
});
