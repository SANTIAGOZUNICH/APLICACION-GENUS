import { describe, expect, it } from "vitest";
import {
  formatLabelCantidad,
  formatLabelDate,
  mapMpIngresoToLabelData,
  mmToPt,
  mpAprobadoLabelFilename,
  MP_LABEL_HEIGHT_MM,
  MP_LABEL_WIDTH_MM,
  sanitizeLabelCell,
} from "./mp-aprobado-label";
import { buildMpAprobadoLabelPdfBuffer } from "./mp-aprobado-label-pdf";

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

  it("nombre de archivo ETIQUETA-MP-{id-corto}.pdf", () => {
    expect(mpAprobadoLabelFilename("mp-ingreso-00125-extra")).toBe(
      "ETIQUETA-MP-mp-ingreso-0.pdf"
    );
    expect(mpAprobadoLabelFilename("!!!")).toBe("ETIQUETA-MP-sin-id.pdf");
  });

  it("medidas centralizadas en mm", () => {
    expect(MP_LABEL_WIDTH_MM).toBe(100);
    expect(MP_LABEL_HEIGHT_MM).toBe(67);
    expect(mmToPt(25.4)).toBeCloseTo(72, 5);
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
  it("genera PDF de una página sin escribir al ingreso", async () => {
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
  }, 30000);

  it("genera PDF también con campos vacíos", async () => {
    const data = mapMpIngresoToLabelData({
      id: "empty-1",
      producto: "SOLO",
    });
    const buf = await buildMpAprobadoLabelPdfBuffer(data);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  }, 30000);
});
