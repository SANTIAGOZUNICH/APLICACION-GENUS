import { describe, expect, it } from "vitest";
import {
  buildExcelTsv,
  classifyExcelPreviewIssues,
  computeExcelPreviewCounts,
  isExcelPreviewImportable,
  selectionMasterState,
  tsvEscapeCell,
} from "./excel-import-preview-utils";

describe("excel-import-preview-utils", () => {
  it("classifica valid / warning / invalid", () => {
    expect(classifyExcelPreviewIssues([])).toBe("valid");
    expect(
      classifyExcelPreviewIssues([{ rowIndex: 1, message: "dup", severity: "warning" }])
    ).toBe("warning");
    expect(classifyExcelPreviewIssues([{ rowIndex: 1, message: "err" }])).toBe("invalid");
    expect(isExcelPreviewImportable([{ rowIndex: 1, message: "dup", severity: "warning" }])).toBe(
      true
    );
    expect(isExcelPreviewImportable([{ rowIndex: 1, message: "err" }])).toBe(false);
  });

  it("cuenta selección, válidas, advertencias e inválidas", () => {
    const counts = computeExcelPreviewCounts([
      { selected: true, issues: [] },
      { selected: true, issues: [{ rowIndex: 2, message: "w", severity: "warning" }] },
      { selected: true, issues: [{ rowIndex: 3, message: "e" }] },
      { selected: false, issues: [] },
    ]);
    expect(counts).toEqual({
      total: 4,
      selected: 3,
      valid: 2,
      warnings: 1,
      invalid: 1,
      selectedImportable: 2,
    });
  });

  it("master checkbox indeterminate", () => {
    expect(selectionMasterState(0, 5)).toBe(false);
    expect(selectionMasterState(5, 5)).toBe(true);
    expect(selectionMasterState(2, 5)).toBe("indeterminate");
  });

  it("copia TSV conservando vacíos y ceros iniciales", () => {
    expect(tsvEscapeCell("000125")).toBe("000125");
    expect(tsvEscapeCell("a\tb")).toBe('"a\tb"');
    const tsv = buildExcelTsv(
      ["Producto", "Código"],
      [
        ["OLEO CALCAREO", "QSOFT"],
        ["OLEO CALCAREO", ""],
        ["CREMA", "000125"],
      ]
    );
    expect(tsv).toBe(
      ["Producto\tCódigo", "OLEO CALCAREO\tQSOFT", "OLEO CALCAREO\t", "CREMA\t000125"].join("\r\n")
    );
  });

  it("soporta más de 20 filas en build TSV", () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`P${i}`, i % 2 === 0 ? "" : `C${i}`]);
    const tsv = buildExcelTsv(["Producto", "Código"], rows);
    expect(tsv.split("\r\n")).toHaveLength(26);
  });
});
