import { describe, expect, it } from "vitest";
import {
  extractColumnDatesFromHeaderRow,
  parseHumanDateHeader,
  parseNativeDateCell,
  resolveSplitColumnDate,
} from "@/lib/parsers/planner/date-header-resolver";
import { isDateHeaderRow } from "@/lib/parsers/planner/planner-utils";

describe("date-header-resolver", () => {
  it("resuelve Martes 14 de julio → 2026-07-14", () => {
    const r = parseHumanDateHeader("Martes 14 de julio", 2026);
    expect(r?.plannedDate).toBe("2026-07-14");
    expect(r?.dayOfWeek).toBe("Martes");
    expect(r?.method).toBe("full_human_header");
    expect(r?.weekdayMismatch).toBe(false);
  });

  it("resuelve formato vivo Sheets: martes 14 julio", () => {
    const r = parseHumanDateHeader("martes 14 julio", 2026);
    expect(r?.plannedDate).toBe("2026-07-14");
    expect(r?.method).toBe("full_human_header");
  });

  it("resuelve mayúsculas, tildes y abreviaturas", () => {
    expect(parseHumanDateHeader("MARTES 14 DE JULIO", 2026)?.plannedDate).toBe(
      "2026-07-14"
    );
    expect(parseHumanDateHeader("Miércoles 15 de julio", 2026)?.plannedDate).toBe(
      "2026-07-15"
    );
    expect(parseHumanDateHeader("MAR 14 JULIO", 2026)?.plannedDate).toBe(
      "2026-07-14"
    );
    expect(parseHumanDateHeader("Martes / 14 de julio", 2026)?.plannedDate).toBe(
      "2026-07-14"
    );
  });

  it("resuelve fecha nativa Sheets ISO y dd/mm", () => {
    expect(parseNativeDateCell("2026-07-14")?.plannedDate).toBe("2026-07-14");
    expect(parseNativeDateCell("2026-07-14")?.method).toBe("native_date");
    expect(parseNativeDateCell("14/07/2026")?.plannedDate).toBe("2026-07-14");
  });

  it("resuelve split header día+mes", () => {
    const r = resolveSplitColumnDate("14", "Julio", 2026, "Martes");
    expect(r?.plannedDate).toBe("2026-07-14");
    expect(r?.method).toBe("split_header");
    expect(r?.weekdayMismatch).toBe(false);
  });

  it("semana que cruza de mes en encabezados humanos", () => {
    const row = [
      "",
      "lunes 29 junio",
      "",
      "martes 30 junio",
      "",
      "miércoles 1 julio",
      "",
      "jueves 2 julio",
      "",
      "viernes 3 julio",
    ];
    expect(isDateHeaderRow(row)).toBe(true);
    const extracted = extractColumnDatesFromHeaderRow(row, 2026);
    expect(extracted.columnDates.get(1)?.plannedDate).toBe("2026-06-29");
    expect(extracted.columnDates.get(5)?.plannedDate).toBe("2026-07-01");
    expect(extracted.columnDates.get(9)?.plannedDate).toBe("2026-07-03");
  });

  it("columnas legacy B/D/F/H/J con humanos", () => {
    const row = [
      "",
      "lunes 13 julio",
      "",
      "martes 14 julio",
      "",
      "miércoles 15 julio",
      "",
      "jueves 16 julio",
      "",
      "viernes 17 julio",
    ];
    const extracted = extractColumnDatesFromHeaderRow(row, 2026);
    expect(extracted.dayColumns.get(1)).toBe("Lunes");
    expect(extracted.dayColumns.get(3)).toBe("Martes");
    expect(extracted.columnDates.get(3)?.plannedDate).toBe("2026-07-14");
  });

  it("columnas modernas C/E/G/I/K", () => {
    const row = [
      "",
      "",
      "lunes 6 julio",
      "",
      "martes 7 julio",
      "",
      "miércoles 8 julio",
      "",
      "jueves 9 julio",
      "",
      "viernes 10 julio",
    ];
    const extracted = extractColumnDatesFromHeaderRow(row, 2026);
    expect(extracted.columnDates.get(2)?.plannedDate).toBe("2026-07-06");
    expect(extracted.columnDates.get(4)?.plannedDate).toBe("2026-07-07");
    expect(extracted.columnDates.get(10)?.plannedDate).toBe("2026-07-10");
  });

  it("emite warning si el día de semana no coincide", () => {
    const r = parseHumanDateHeader("Lunes 14 de julio", 2026);
    // 14/07/2026 es martes
    expect(r?.plannedDate).toBe("2026-07-14");
    expect(r?.weekdayMismatch).toBe(true);
    expect(r?.warning).toMatch(/incompatible/i);
  });
});
