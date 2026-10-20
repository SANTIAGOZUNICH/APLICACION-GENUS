import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { csvCell, exportFileName, rowsToCsv, rowsToTsv, xlsxToTsv } from "./sheet-io";

describe("exportar / importar planillas", () => {
  it("CSV: escapa comillas, comas y saltos; lleva BOM para Excel", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("simple")).toBe("simple");
    const csv = rowsToCsv(["Lote", "Descripción"], [["L1", "Agua, destilada"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('L1,"Agua, destilada"');
  });
  it("TSV: sin tabulaciones ni saltos dentro de celdas", () => {
    expect(rowsToTsv([["a\tb", "c\nd"], ["x", "y"]])).toBe("a b\tc d\nx\ty");
  });
  it("nombre de archivo seguro con fecha", () => {
    expect(exportFileName("Stock MP — Ñandú", "csv", new Date("2026-10-20T10:00:00Z"))).toBe("stock-mp-nandu-2026-10-20.csv");
  });
  it("XLSX → texto tabulado de la primera hoja (con la fila de encabezados)", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["Lote", "Kg"], ["L1", 12.5], ["L2", 3]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(await xlsxToTsv(buf)).toBe("Lote\tKg\nL1\t12.5\nL2\t3");
  });
});
