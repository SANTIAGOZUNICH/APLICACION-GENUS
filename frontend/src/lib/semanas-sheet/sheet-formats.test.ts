import { describe, expect, it } from "vitest";
import { dayWidths, parseWeeklyCalendar, type SheetFormats } from "./calendar-model";
import { colorToHex, formatsFromGoogleGrid } from "./sheet-formats";

describe("sheet-formats (solo lectura de formato)", () => {
  it("convierte colores de Google a hex y descarta blanco/negro por defecto", () => {
    expect(colorToHex({ red: 0, green: 1, blue: 0 })).toBe("#00FF00");
    const f = formatsFromGoogleGrid({
      columnMetadata: [{ pixelSize: 55 }, { pixelSize: 271 }, { pixelSize: 17 }],
      rowMetadata: [{ hiddenByUser: true }, { pixelSize: 21 }, { pixelSize: 40 }],
      rowData: [
        { values: [{ effectiveFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } } } }] },
        { values: [{}, { effectiveFormat: { backgroundColor: { red: 0.8, green: 0.89, blue: 0.95 }, textFormat: { bold: true } } }] },
      ],
    });
    expect(f.colWidths).toEqual([55, 271, 17]);
    expect(f.hiddenRows).toEqual([1]);
    expect(f.rowHeights).toEqual({ 3: 40 });
    expect(f.cells).toEqual({ B2: { bg: "#CCE3F2", bold: true } });
  });

  it("dayWidths suma la columna ancla y su hermana; sin datos usa un ancho por defecto", () => {
    const f: SheetFormats = { colWidths: [55, 271, 17, 279, 12, 254, 12, 250, 15, 266, 80], hiddenRows: [], cells: {} };
    expect(dayWidths(f)).toEqual([288, 291, 266, 265, 346]);
    expect(dayWidths(undefined)).toEqual([280, 280, 280, 280, 280]);
  });
});

describe("parseWeeklyCalendar con formato", () => {
  const rows: string[][] = [
    ["", "Lunes", "", "Martes", "", "Miércoles", "", "Jueves", "", "Viernes"],
    ["", "16", "", "17", "", "18", "", "19", "", "20"],
    ["", "Febrero", "", "Febrero", "", "Febrero", "", "Febrero", "", "Febrero"],
    ["", "CRISTIAN"],
    ["", "A", "", "B", "", "BLOQUE"],
    ["", "a", "", "b"],
  ];
  const merges = [
    { startRow: 4, endRow: 4, startColumn: 2, endColumn: 11 },
    { startRow: 5, endRow: 6, startColumn: 6, endColumn: 7 },
  ];
  it("expone rowSpan, span de 5 días, fondo/negrita y filas plegadas", () => {
    const formats: SheetFormats = { colWidths: [], hiddenRows: [1, 2, 3, 4, 5, 6], cells: { B4: { bg: "#CFE2F3", bold: true }, F5: { bg: "#00FF00" } } };
    const [w] = parseWeeklyCalendar(rows, merges, { year: 2026, formats });
    const band = w!.rows.find((r) => r.rowNumber === 4)!;
    expect(band.cells[0]).toMatchObject({ span: 5, rowSpan: 1, format: { bg: "#CFE2F3", bold: true } });
    expect(band.cells.slice(1).every((c) => c.covered)).toBe(true);
    const f5 = w!.rows.find((r) => r.rowNumber === 5)!.cells[2]!;
    expect(f5).toMatchObject({ rowSpan: 2, span: 1, format: { bg: "#00FF00" } });
    expect(w!.rows.find((r) => r.rowNumber === 6)!.cells[2]!.covered).toBe(true);
    expect(w!.hidden).toBe(true);
  });
});
