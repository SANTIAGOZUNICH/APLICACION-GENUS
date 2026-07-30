import { describe, expect, it, vi, afterEach } from "vitest";
import {
  copyTextToClipboard,
  formatHereLabelCantidad,
  formatHereLabelDate,
  formatMpIngresoForHereLabel,
  sanitizeHereLabelCell,
} from "./format-mp-ingreso-herelabel";

describe("formatMpIngresoForHereLabel", () => {
  it("arma las ocho columnas completas con tabs reales", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "CARBOPOL",
      pccMeNro: "PCC-ME-00125",
      fecha: "2026-07-30",
      remitoNro: "000123",
      cantidad: 25,
      unidad: "KG",
      proveedor: "PROVEEDOR SA",
      bultos: 5,
      lote: "L240730",
    });

    expect(tsv).toBe(
      "CARBOPOL\tPCC-ME-00125\t30/07/2026\t000123\t25 KG\tPROVEEDOR SA\t5\tL240730"
    );
    expect(tsv.split("\t")).toHaveLength(8);
    expect(tsv).not.toContain("[TAB]");
    expect(tsv).not.toContain("{");
  });

  it("conserva ocho posiciones con campos vacíos (tabs consecutivos)", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "LECIGEL",
      pccMeNro: "",
      fecha: "2026-07-30",
      remitoNro: null,
      cantidad: null,
      unidad: null,
      proveedor: "ACME",
      bultos: undefined,
      lote: "",
    });
    const cols = tsv.split("\t");
    expect(cols).toHaveLength(8);
    expect(cols[0]).toBe("LECIGEL");
    expect(cols[1]).toBe("");
    expect(cols[2]).toBe("30/07/2026");
    expect(cols[3]).toBe("");
    expect(cols[4]).toBe("");
    expect(cols[5]).toBe("ACME");
    expect(cols[6]).toBe("");
    expect(cols[7]).toBe("");
    expect(tsv).toBe("LECIGEL\t\t30/07/2026\t\t\tACME\t\t");
  });

  it("conserva ceros iniciales en PCC, remito y lote", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "X",
      pccMeNro: "00125",
      remitoNro: "000123",
      lote: "00099",
      fecha: "2026-01-02",
    });
    const cols = tsv.split("\t");
    expect(cols[1]).toBe("00125");
    expect(cols[3]).toBe("000123");
    expect(cols[7]).toBe("00099");
  });

  it("formatea fecha a DD/MM/YYYY", () => {
    expect(formatHereLabelDate("2026-07-30")).toBe("30/07/2026");
    expect(formatHereLabelDate("2026-07-30T12:00:00.000Z")).toBe("30/07/2026");
    expect(formatHereLabelDate("30/07/2026")).toBe("30/07/2026");
    expect(formatHereLabelDate("")).toBe("");
    expect(formatHereLabelDate(null)).toBe("");
  });

  it("cantidad con unidad", () => {
    expect(formatHereLabelCantidad(25, "KG")).toBe("25 KG");
    expect(formatHereLabelCantidad("12.5", "kg")).toBe("12.5 kg");
  });

  it("cantidad sin unidad", () => {
    expect(formatHereLabelCantidad(25, "")).toBe("25");
    expect(formatHereLabelCantidad(25, null)).toBe("25");
  });

  it("no redondea decimales", () => {
    expect(formatHereLabelCantidad(12.3456, "KG")).toBe("12.3456 KG");
    const tsv = formatMpIngresoForHereLabel({
      producto: "A",
      cantidad: 12.3456,
      unidad: "KG",
    });
    expect(tsv.split("\t")[4]).toBe("12.3456 KG");
  });

  it("conserva acentos y ñ", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "Ácido ñame",
      proveedor: "Piñón SA",
      descripcion: "ignored when producto set",
    });
    expect(tsv.split("\t")[0]).toBe("Ácido ñame");
    expect(tsv.split("\t")[5]).toBe("Piñón SA");
  });

  it("usa descripción si producto está vacío", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "  ",
      descripcion: "CARBOPOL",
    });
    expect(tsv.split("\t")[0]).toBe("CARBOPOL");
  });

  it("reemplaza saltos de línea internos por espacios", () => {
    expect(sanitizeHereLabelCell("linea1\nlinea2")).toBe("linea1 linea2");
    const tsv = formatMpIngresoForHereLabel({
      producto: "A\r\nB",
      proveedor: "C\nD",
    });
    expect(tsv.split("\t")[0]).toBe("A B");
    expect(tsv.split("\t")[5]).toBe("C D");
    expect(tsv.split("\t")).toHaveLength(8);
  });

  it("elimina tabulaciones internas para no mover columnas", () => {
    const tsv = formatMpIngresoForHereLabel({
      producto: "A\tB",
      pccMeNro: "P\t1",
      remitoNro: "R\t2",
    });
    expect(tsv.split("\t")).toHaveLength(8);
    expect(tsv.split("\t")[0]).toBe("A B");
    expect(tsv.split("\t")[1]).toBe("P 1");
  });

  it("no incluye encabezados ni JSON", () => {
    const tsv = formatMpIngresoForHereLabel({ producto: "X", cantidad: 1 });
    expect(tsv.toLowerCase()).not.toContain("producto");
    expect(tsv).not.toMatch(/^\s*\{/);
  });

  it("no muta el ingreso de entrada (sin escrituras)", () => {
    const ingreso = {
      producto: "CARBOPOL",
      pccMeNro: "PCC-ME-00125",
      fecha: "2026-07-30",
      remitoNro: "000123",
      cantidad: 25,
      unidad: "KG",
      proveedor: "PROVEEDOR SA",
      bultos: 5,
      lote: "L240730",
      status: "BORRADOR",
      stockImpacted: false,
    };
    const before = structuredClone(ingreso);
    void formatMpIngresoForHereLabel(ingreso);
    expect(ingreso).toEqual(before);
    expect(ingreso.status).toBe("BORRADOR");
    expect(ingreso.stockImpacted).toBe(false);
  });
});

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("usa Clipboard API cuando está disponible", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyTextToClipboard("a\tb\tc");
    expect(writeText).toHaveBeenCalledWith("a\tb\tc");
  });

  it("usa fallback execCommand si Clipboard API falla", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const ta = {
      value: "",
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      focus: vi.fn(),
      select: vi.fn(),
    };
    const fakeDocument = {
      createElement: vi.fn(() => ta),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn(() => true),
    };
    vi.stubGlobal("document", fakeDocument);

    await copyTextToClipboard("fila\tcon\ttabs");
    expect(writeText).toHaveBeenCalled();
    expect(fakeDocument.execCommand).toHaveBeenCalledWith("copy");
    expect(ta.value).toBe("fila\tcon\ttabs");
  });
});

