import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { findCalendarCell, parseWeeklyCalendar, type SheetMerge } from "./calendar-model";

const FIXTURE = path.resolve(__dirname, "../../../../SEMANAS 2026.xlsx");

function load(tab: string): { rows: string[][]; merges: SheetMerge[] } {
  const wb = XLSX.readFile(FIXTURE, { cellDates: true });
  const ws = wb.Sheets[tab]!;
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const rows: string[][] = [];
  for (let r = 0; r <= range.e.r; r += 1) {
    const row: string[] = [];
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(
        !cell
          ? ""
          : cell.v instanceof Date
            ? `${String(cell.v.getUTCDate()).padStart(2, "0")}/${String(cell.v.getUTCMonth() + 1).padStart(2, "0")}/${cell.v.getUTCFullYear()}`
            : String(cell.v ?? "")
      );
    }
    rows.push(row);
  }
  const merges = (ws["!merges"] ?? []).map((m) => ({
    startRow: m.s.r + 1, endRow: m.e.r + 1, startColumn: m.s.c + 1, endColumn: m.e.c + 1,
  }));
  return { rows, merges };
}

describe.skipIf(!existsSync(FIXTURE))("calendar-model sobre la copia local de SEMANAS 2026 (NO equivale a la versión viva)", () => {
  it("ELABORACION: detecta las 12 semanas con sus fechas Lun–Vie", () => {
    const { rows, merges } = load("ELABORACION");
    const weeks = parseWeeklyCalendar(rows, merges, { year: 2026 });
    expect(weeks).toHaveLength(12);
    expect(weeks[0]!.headerRow).toBe(1);
    expect(weeks[0]!.dates).toEqual(["2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20"]);
    expect(weeks[1]!.headerRow).toBe(24);
  });

  it("ACONDICIONAMIENTO: 15 semanas; banda combinada D4:I4 abarca 3 días", () => {
    const { rows, merges } = load("ACONDICIONAMIENTO");
    const weeks = parseWeeklyCalendar(rows, merges, { year: 2026 });
    expect(weeks).toHaveLength(15);
    const band = weeks[0]!.rows.find((r) => r.rowNumber === 4)!;
    expect(band.cells[1]!.value).toMatch(/ENVASADO/);
    expect(band.cells[1]!.span).toBe(3);
    expect(band.cells[2]!.covered).toBe(true);
    expect(band.cells[2]!.protection).toMatch(/combinada/);
  });

  it("filas de encabezado son estructurales; los renglones de planificación son editables", () => {
    const { rows, merges } = load("ELABORACION");
    const [w] = parseWeeklyCalendar(rows, merges, { year: 2026 });
    expect(w!.rows.slice(0, 3).every((r) => r.role === "structural" && r.cells.every((c) => c.protection))).toBe(true);
    const f6 = findCalendarCell([w!], "F6")!;
    expect(f6.cell.value).toBe("SERUM AH+NIA");
    expect(f6.cell.protection).toBeNull();
    expect(findCalendarCell([w!], "F2")!.cell.protection).toMatch(/Encabezado/);
  });

  it("fórmulas y producciones cerradas quedan protegidas; las semanas pasadas NO se bloquean por antigüedad", () => {
    const { rows, merges } = load("ELABORACION");
    const weeks = parseWeeklyCalendar(rows, merges, {
      year: 2026,
      formulaCells: new Set(["F6"]),
      cellLock: ({ value, date }) => (value === "NIZA" && date === "2026-02-19" ? "Producción con cierre de envasado en GENUS: no se modifica." : null),
    });
    expect(findCalendarCell(weeks, "F6")!.cell.protection).toMatch(/fórmula/);
    expect(findCalendarCell(weeks, "H5")!.cell.protection).toMatch(/cierre de envasado/); // H5 = NIZA (jueves 19/02)
    expect(findCalendarCell(weeks, "J5")!.cell.protection).toBeNull(); // semana pasada, no cerrada → editable
    expect(findCalendarCell(weeks, "J5")!.cell.date).toBe("2026-02-20");
  });

  it("cada celda editable referencia SU ancla exacta (no hay reconstrucción de calendario)", () => {
    const { rows, merges } = load("ELABORACION");
    const weeks = parseWeeklyCalendar(rows, merges, { year: 2026 });
    for (const w of weeks) for (const r of w.rows) for (const c of r.cells) expect(c.a1).toMatch(/^[BDFHJ]\d+$/);
  });
});

import { parseFlatTable, findFlatCell } from "./flat-model";

describe.skipIf(!existsSync(FIXTURE))("flat-model sobre la copia local", () => {
  it("ENTREGAS: sin protección por fecha; solo se bloquean filas con entrega/remito real (rowLock)", () => {
    const { rows, merges } = load("ENTREGAS");
    const t = parseFlatTable("ENTREGAS", rows, merges, {
      rowLock: ({ date, values }) => (date === "2026-02-19" && values[1] === "TSU" ? "Entrega confirmada en GENUS (Entregados): no se modifica." : null),
    });
    expect(t.columns.map((c) => c.title)).toEqual(["FECHA", "CLIENTE", "PRODUCTO", "CANTIDAD"]);
    const locked = t.rows.find((r) => r.date === "2026-02-19" && r.cells[1]!.value === "TSU")!;
    expect(locked.cells.every((c) => c.protection)).toBe(true);
    const oldButOpen = t.rows.find((r) => r.date === "2026-02-20")!;
    expect(oldButOpen.cells.every((c) => c.protection === null || /fórmula/.test(c.protection))).toBe(true);
  });

  it("C/DIA: títulos de mes estructurales, fecha heredada por día, sin ventana de 14 días", () => {
    const { rows, merges } = load("QACONDDIA");
    const t = parseFlatTable("CDIA", rows, merges, {});
    expect(t.rows.some((r) => r.role === "structural")).toBe(true);
    const sub = t.rows.find((r) => r.role === "data" && r.cells[0]!.value === "" && r.date === "2026-02-18");
    expect(sub).toBeTruthy(); // fila sin fecha propia hereda la del día
    expect(findFlatCell(t, sub!.cells[1]!.a1)!.protection).toBeNull(); // histórica y editable
    const locked = parseFlatTable("CDIA", rows, merges, { rowLock: ({ date }) => (date === "2026-02-18" ? "Producción con cierre de envasado en GENUS: no se modifica." : null) });
    expect(findFlatCell(locked, sub!.cells[1]!.a1)!.protection).toMatch(/cierre/);
  });
});
