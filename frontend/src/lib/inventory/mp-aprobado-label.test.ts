import { describe, expect, it } from "vitest";
import {
  formatLabelCantidad,
  formatLabelDate,
  mapMpIngresoToLabelData,
  mmToPrinterDots,
  mmToPt,
  mpAprobadoLabelFilename,
  mpLabelContentDisposition,
  MP_LABEL_HEIGHT_MM,
  MP_LABEL_HEIGHT_PT,
  MP_LABEL_MARGIN_X_MM,
  MP_LABEL_MAX_PRINTABLE_WIDTH_MM,
  MP_LABEL_PRINTER_DPI,
  MP_LABEL_SAFE_WIDTH_MM,
  MP_LABEL_WIDTH_MM,
  MP_LABEL_WIDTH_PT,
  sanitizeLabelCell,
} from "./mp-aprobado-label";
import { buildMpAprobadoLabelPdfBuffer } from "./mp-aprobado-label-pdf";
import { inspectMpLabelPdfStructure } from "./mp-aprobado-label-pdfkit";

describe("mp-aprobado-label mapping", () => {
  it("mapea los ocho campos completos", () => {
    const data = mapMpIngresoToLabelData({
      id: "abc1234567890",
      producto: "CARBOPOL 940",
      pccMeNro: "PCC-ME-00125",
      fecha: "2026-07-30",
      remitoNro: "000123",
      cantidad: 25,
      proveedor: "BASF ARGENTINA S.A.",
      bultos: 1,
      lote: "L240730",
    });
    expect(data).toEqual({
      producto: "CARBOPOL 940",
      pccMeNro: "PCC-ME-00125",
      ingreso: "30/07/2026",
      remitoNro: "000123",
      cantidad: "25",
      proveedor: "BASF ARGENTINA S.A.",
      bultos: "1",
      loteProveedor: "L240730",
      sourceId: "abc1234567890",
    });
  });

  it("deja vacíos los campos faltantes sin inventar datos", () => {
    const data = mapMpIngresoToLabelData({
      id: "x",
      producto: "LECIGEL",
      fecha: "2026-07-30",
      proveedor: "ACME",
    });
    expect(data.pccMeNro).toBe("");
    expect(data.remitoNro).toBe("");
    expect(data.cantidad).toBe("");
    expect(data.bultos).toBe("");
    expect(data.loteProveedor).toBe("");
    expect(data.ingreso).toBe("30/07/2026");
  });

  it("conserva ceros iniciales", () => {
    const data = mapMpIngresoToLabelData({
      pccMeNro: "00125",
      remitoNro: "000123",
      lote: "00099",
    });
    expect(data.pccMeNro).toBe("00125");
    expect(data.remitoNro).toBe("000123");
    expect(data.loteProveedor).toBe("00099");
  });

  it("formatea fecha DD/MM/YYYY", () => {
    expect(formatLabelDate("2026-07-30")).toBe("30/07/2026");
    expect(formatLabelDate("30/07/2026")).toBe("30/07/2026");
  });

  it("cantidad sin unidad (campo Unidades eliminado)", () => {
    expect(formatLabelCantidad(25)).toBe("25");
    expect(formatLabelCantidad(12.3456)).toBe("12.3456");
    expect(formatLabelCantidad(null)).toBe("");
  });

  it("conserva acentos y limpia saltos/tabs", () => {
    expect(sanitizeLabelCell("Ácido\nñame")).toBe("Ácido ñame");
    expect(sanitizeLabelCell("A\tB")).toBe("A B");
  });

  it("usa descripción si producto vacío", () => {
    expect(
      mapMpIngresoToLabelData({ producto: "  ", descripcion: "CARBOPOL" }).producto
    ).toBe("CARBOPOL");
  });

  it("nombre ETIQUETA-MP-{PRODUCTO}-{LOTE}.pdf con fallback a ID corto", () => {
    expect(
      mpAprobadoLabelFilename({
        producto: "CARBOPOL 940",
        loteProveedor: "L240730",
        sourceId: "abc123",
      })
    ).toBe("ETIQUETA-MP-CARBOPOL-940-L240730.pdf");

    expect(
      mpAprobadoLabelFilename({
        producto: "CARBOPOL",
        loteProveedor: "",
        sourceId: "mp-ingreso-00125-extra",
      })
    ).toBe("ETIQUETA-MP-mp-ingreso-0.pdf");

    expect(
      mpAprobadoLabelFilename({
        producto: "",
        loteProveedor: "L1",
        sourceId: "!!!",
      })
    ).toBe("ETIQUETA-MP-sin-id.pdf");
  });

  it("medidas SP320 75×50 mm con ancho seguro 71 mm", () => {
    expect(MP_LABEL_WIDTH_MM).toBe(75);
    expect(MP_LABEL_HEIGHT_MM).toBe(50);
    expect(MP_LABEL_SAFE_WIDTH_MM).toBe(71);
    expect(MP_LABEL_MARGIN_X_MM).toBe(2);
    expect(MP_LABEL_MAX_PRINTABLE_WIDTH_MM).toBe(72);
    expect(MP_LABEL_PRINTER_DPI).toBe(203);
    expect(mmToPt(25.4)).toBeCloseTo(72, 5);
    expect(MP_LABEL_WIDTH_PT).toBeCloseTo(mmToPt(75), 5);
    expect(MP_LABEL_HEIGHT_PT).toBeCloseTo(mmToPt(50), 5);
    // ~599×400 dots a 203 dpi; ~576 dots imprimibles en 72 mm
    expect(mmToPrinterDots(75)).toBeCloseTo(599.41, 0);
    expect(mmToPrinterDots(50)).toBeCloseTo(399.61, 0);
    expect(mmToPrinterDots(72)).toBeCloseTo(575.43, 0);
    expect(mmToPrinterDots(71)).toBeLessThan(mmToPrinterDots(72));
  });

  it("Content-Disposition attachment con filename* UTF-8", () => {
    const cd = mpLabelContentDisposition("ETIQUETA-MP-CARBOPOL-940-L240730.pdf");
    expect(cd).toContain("attachment;");
    expect(cd).toContain("filename*=UTF-8''ETIQUETA-MP-CARBOPOL-940-L240730.pdf");
    expect(cd).toMatch(/filename="ETIQUETA-MP-CARBOPOL-940-L240730\.pdf"/);
  });

  it("no muta el ingreso de entrada", () => {
    const ingreso = {
      id: "1",
      producto: "X",
      status: "BORRADOR",
      stockImpacted: false,
      cantidad: 10,
    };
    const before = structuredClone(ingreso);
    void mapMpIngresoToLabelData(ingreso);
    expect(ingreso).toEqual(before);
  });
});

describe("mp-aprobado-label PDF", () => {
  it("genera PDF 75×50 mm de una página con cajas y Rotate=0", async () => {
    const data = mapMpIngresoToLabelData({
      id: "test-label-01",
      producto: "CARBOPOL 940",
      pccMeNro: "PCC-ME-00125",
      fecha: "2026-07-30",
      remitoNro: "000123",
      cantidad: 25,
      proveedor: "BASF ARGENTINA S.A.",
      bultos: 1,
      lote: "L240730",
    });
    const buf = await buildMpAprobadoLabelPdfBuffer(data);
    expect(buf.byteLength).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    const info = inspectMpLabelPdfStructure(buf);
    expect(info.pages).toBe(1);
    expect(info.mediaBox).toMatch(/MediaBox\s*\[\s*0\s+0\s+212\.?\d*\s+141\.?\d*\s*\]/);
    expect(info.cropBox).toMatch(/CropBox\s*\[\s*0\s+0\s+212\.?\d*\s+141\.?\d*\s*\]/);
    expect(info.trimBox).toMatch(/TrimBox\s*\[\s*0\s+0\s+212\.?\d*\s+141\.?\d*\s*\]/);
    expect(info.bleedBox).toMatch(/BleedBox\s*\[\s*0\s+0\s+212\.?\d*\s+141\.?\d*\s*\]/);
    expect(info.rotate === null || /Rotate\s*0\b/.test(info.rotate)).toBe(true);
  }, 30000);

  it("genera PDF también con campos vacíos", async () => {
    const data = mapMpIngresoToLabelData({
      id: "empty-1",
      producto: "SOLO",
    });
    const buf = await buildMpAprobadoLabelPdfBuffer(data);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(inspectMpLabelPdfStructure(buf).pages).toBe(1);
  }, 30000);
});
