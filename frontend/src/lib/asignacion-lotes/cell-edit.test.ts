import { describe, expect, it } from "vitest";
import {
  canEditAsignacionCellField,
  cellProtectionReason,
  validateCellValue,
} from "./cell-edit";

describe("validateCellValue", () => {
  it("cantidades: acepta formato es-AR y plano, rechaza negativos y texto", () => {
    expect(validateCellValue("cantidades", "7000")).toEqual({ ok: true, value: 7000 });
    expect(validateCellValue("cantidades", "7.000")).toEqual({ ok: true, value: 7000 });
    expect(validateCellValue("cantidades", "1.234,5")).toEqual({ ok: true, value: 1234.5 });
    expect(validateCellValue("cantidades", "-5").ok).toBe(false);
    expect(validateCellValue("cantidades", "abc").ok).toBe(false);
    expect(validateCellValue("cantidades", "").ok).toBe(false);
  });

  it("fechas: normaliza a ISO, vacío = null, rechaza fechas imposibles", () => {
    expect(validateCellValue("vto", "31/12/2027")).toEqual({ ok: true, value: "2027-12-31" });
    expect(validateCellValue("vto", "2027-01-05")).toEqual({ ok: true, value: "2027-01-05" });
    expect(validateCellValue("vto", "")).toEqual({ ok: true, value: null });
    expect(validateCellValue("vto", "31/02/2027").ok).toBe(false);
    expect(validateCellValue("fecha", "ayer").ok).toBe(false);
  });

  it("texto: lote/producto obligatorios; resto puede vaciarse", () => {
    expect(validateCellValue("lote", "  ").ok).toBe(false);
    expect(validateCellValue("producto", "").ok).toBe(false);
    expect(validateCellValue("marca", "")).toEqual({ ok: true, value: "" });
    expect(validateCellValue("lote", " S26001 ")).toEqual({ ok: true, value: "S26001" });
    expect(validateCellValue("observaciones", "x".repeat(2001)).ok).toBe(false);
  });
});

describe("permisos por sector y protección", () => {
  it("Calidad edita muestras; Producción no; Codificado solo observaciones", () => {
    expect(canEditAsignacionCellField("CALIDAD", "muestras")).toBe(true);
    expect(canEditAsignacionCellField("PRODUCCION", "muestras")).toBe(false);
    expect(canEditAsignacionCellField("CODIFICADO", "cantidades")).toBe(false);
    expect(canEditAsignacionCellField("CODIFICADO", "observaciones")).toBe(true);
    expect(canEditAsignacionCellField("DEPOSITO", "observaciones")).toBe(false);
  });

  it("registros sincronizados desde Google Sheets se editan en GENUS con la misma matriz de sectores (0043)", () => {
    expect(cellProtectionReason({ sourceId: "src-1" }, "cantidades", "CALIDAD")).toBeNull();
    expect(cellProtectionReason({ sourceId: "src-1" }, "cantidades", "CODIFICADO")).toMatch(/Tu sector/);
    expect(cellProtectionReason({ sourceId: "src-1", archived: true }, "cantidades", "PRODUCCION")).toMatch(/archivado/);
    expect(cellProtectionReason({ sourceId: null }, "cantidades", "CALIDAD")).toBeNull();
    expect(cellProtectionReason({ sourceId: null, archived: true }, "cantidades", "CALIDAD")).toMatch(/archivado/);
  });
});
