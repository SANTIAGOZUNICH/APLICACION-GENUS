/**
 * Tests sintéticos del parser de fórmulas (sin datos privados reales).
 * Cubren resolución de cliente/producto, fuente de producto y clasificación
 * porcentaje / proporción / cantidad con REVIEW_REQUIRED.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbookBuffer } from "@/lib/formulas/parse-workbook";
import {
  FormulaBankService,
  MemoryFormulaBank,
} from "@/lib/formulas/formula-bank-service";
import {
  deriveProductFromFilename,
  isGenericSheetName,
  matchesKnownClient,
  normalizeSearchKey,
  resolveClientFromFilename,
} from "@/lib/formulas/types";

function xlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const meta = (sourceFile: string, folderClient = "") => ({
  sourceFile,
  sourceModifiedAt: "2026-01-01T00:00:00.000Z",
  folderClient,
});

describe("normalizeSearchKey acepta ':' y ';'", () => {
  it("limpia dos puntos y punto y coma", () => {
    expect(normalizeSearchKey("PRODUCTO:")).toBe("producto");
    expect(normalizeSearchKey("Nombre;")).toBe("nombre");
  });
});

describe("isGenericSheetName", () => {
  it("detecta pestañas de plantilla", () => {
    for (const n of ["OE", "OE ", "OE 2", "Hoja1", "Hoja 1", "Sheet1", "Copia de OE"]) {
      expect(isGenericSheetName(n)).toBe(true);
    }
  });
  it("marca hojas puramente numéricas como genéricas", () => {
    for (const n of ["56", "57", "64", "1"]) {
      expect(isGenericSheetName(n)).toBe(true);
    }
  });
  it("marca hojas 'OE (2)' / 'Copia de OE (2)' como genéricas", () => {
    for (const n of ["OE (2)", "OE (3)", "Copia de OE (2)"]) {
      expect(isGenericSheetName(n)).toBe(true);
    }
  });
  it("no marca nombres reales de producto", () => {
    for (const n of ["Serum", "Mascara Capilar", "Amarillo"]) {
      expect(isGenericSheetName(n)).toBe(false);
    }
  });
});

describe("resolveClientFromFilename", () => {
  const known = ["JACTANS", "DIST EDEN", "AGUEDA REY"];
  it("resuelve cuando todos los tokens del cliente están en el filename", () => {
    expect(resolveClientFromFilename("OE- CREMA - JACTANS.xlsx", known)).toBe("JACTANS");
  });
  it("no resuelve si no hay coincidencia", () => {
    expect(resolveClientFromFilename("ACONDICIONADOR SOLIDO.xlsx", known)).toBe("");
  });
});

describe("deriveProductFromFilename", () => {
  it("quita código inicial", () => {
    expect(deriveProductFromFilename("240055 - CONTORNO DE OJOS DOREM.xlsx")).toBe(
      "CONTORNO DE OJOS DOREM"
    );
  });
  it("quita prefijo Copia de + código y cliente final coincidente", () => {
    expect(
      deriveProductFromFilename(
        "ROOT/CLIENTE X/Copia de 240231-3 - MASCARA CAPILAR CLIENTE X.xlsx",
        "CLIENTE X"
      )
    ).toBe("MASCARA CAPILAR");
  });
  it("quita prefijo OE-", () => {
    expect(deriveProductFromFilename("ROOT/CLI/OE- SHAMPOO SOLIDO.xlsx", "CLI")).toBe(
      "SHAMPOO SOLIDO"
    );
  });
  it("NO quita el final si el cliente no coincide claramente", () => {
    // 'AGUADA' vs 'AGUEDA' → no coincide, se conserva
    expect(
      deriveProductFromFilename("ROOT/AGUEDA REY/OE- SHAMPOO NEUTRO - AGUADA REY.xlsx", "AGUEDA REY")
    ).toBe("SHAMPOO NEUTRO - AGUADA REY");
  });
  it("sin cliente confiable conserva todo el nombre", () => {
    expect(deriveProductFromFilename("ACONDICIONADOR SOLIDO.xlsx")).toBe("ACONDICIONADOR SOLIDO");
  });
});

describe("resolución de cliente", () => {
  it("usa carpeta (2º segmento) cuando no hay celda Cliente", () => {
    const buf = xlsx({
      OE: [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 60],
        ["B", 40],
        ["PROCEDIMIENTO DE ELABORACIÓN"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLIENTE Z/x.xlsx", "CLIENTE Z"));
    expect(d!.displayClient).toBe("CLIENTE Z");
  });
  it("CLIENTE_PENDIENTE si no hay celda ni carpeta", () => {
    const buf = xlsx({
      OE: [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/x.xlsx", ""));
    expect(d!.displayClient).toBe("CLIENTE_PENDIENTE");
  });
});

describe("resolución de producto y sourceConfidence", () => {
  it("CELL: etiqueta con dos puntos, valor a la derecha", () => {
    const buf = xlsx({
      Hoja1: [
        ["PRODUCTO:", "Producto Celda"],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.displayProduct).toBe("Producto Celda");
    expect(d!.sourceConfidence).toBe("CELL");
  });
  it("CELL: valor debajo de la etiqueta", () => {
    const buf = xlsx({
      Hoja1: [
        ["Nombre"],
        ["Producto Debajo"],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.displayProduct).toBe("Producto Debajo");
    expect(d!.sourceConfidence).toBe("CELL");
  });
  it("SHEET: nombre de hoja válido", () => {
    const buf = xlsx({
      Serum: [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.displayProduct).toBe("Serum");
    expect(d!.sourceConfidence).toBe("SHEET");
  });
  it("FILENAME: hoja genérica y sin etiqueta → nombre de archivo", () => {
    const buf = xlsx({
      OE: [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 60],
        ["B", 40],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/240099 - CREMA FILE CLI.xlsx", "CLI"));
    expect(d!.displayProduct).toBe("CREMA FILE");
    expect(d!.sourceConfidence).toBe("FILENAME");
  });

  it("FILENAME: hoja numérica no se usa como producto", () => {
    const buf = xlsx({
      "56": [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/SHAMPOO NEEM.xlsx", "CLI"));
    expect(d!.displayProduct).toBe("SHAMPOO NEEM");
    expect(d!.sourceConfidence).toBe("FILENAME");
  });
});

describe("robustez de etiquetas y exclusiones", () => {
  it("no toma una etiqueta hermana con ':' como cliente; cae a carpeta", () => {
    const buf = xlsx({
      OE: [
        ["Cliente:", "", "Equipo calefactor N°:", ""],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLIENTE REAL/f.xlsx", "CLIENTE REAL"));
    expect(d!.displayClient).toBe("CLIENTE REAL");
  });

  it("no toma 'Fecha' como código de producto", () => {
    const buf = xlsx({
      OE: [
        ["Código:", "Fecha"],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.productCode).toBe("");
  });

  it("excluye hojas sin ingredientes (solo procedimiento, no es fórmula)", () => {
    const buf = xlsx({
      CASTELLI: [
        ["MATERIA PRIMA"],
        ["PROCEDIMIENTO DE ELABORACIÓN"],
        ["Paso 1"],
        ["Paso 2"],
      ],
    });
    const drafts = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(drafts.length).toBe(0);
  });

  it("cliente por filename cuando coincide con conocido y no hay carpeta", () => {
    const buf = xlsx({
      OE: [
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, {
      sourceFile: "ROOT/OE- CREMA - JACTANS.xlsx",
      sourceModifiedAt: "2026-01-01T00:00:00.000Z",
      folderClient: "",
      knownClients: ["JACTANS", "DIST EDEN"],
    });
    expect(d!.displayClient).toBe("JACTANS");
  });

  it("ignora celda Cliente ruidosa no conocida y usa la carpeta", () => {
    const buf = xlsx({
      OE: [
        ["Cliente:", "Envase cubica: 50ml"],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, {
      sourceFile: "ROOT/ANDRE LATOUR/x.xlsx",
      sourceModifiedAt: "2026-01-01T00:00:00.000Z",
      folderClient: "ANDRE LATOUR",
      knownClients: ["ANDRE LATOUR"],
    });
    expect(d!.displayClient).toBe("ANDRE LATOUR");
  });

  it("acepta celda Cliente cuando coincide con cliente conocido", () => {
    expect(matchesKnownClient("BL COSMETICS", ["BL COSMETICS", "JACTANS"])).toBe(true);
    const buf = xlsx({
      OE: [
        ["Cliente:", "BL COSMETICS"],
        ["MATERIA PRIMA", "Fórmula %"],
        ["A", 100],
        ["PROCEDIMIENTO"],
        ["Paso"],
      ],
    });
    const [d] = parseWorkbookBuffer(buf, {
      sourceFile: "ROOT/BL COSMETICS/x.xlsx",
      sourceModifiedAt: "2026-01-01T00:00:00.000Z",
      folderClient: "BL COSMETICS",
      knownClients: ["BL COSMETICS"],
    });
    expect(d!.displayClient).toBe("BL COSMETICS");
  });
});

describe("desempate por hoja copia (sin conflicto arbitrario)", () => {
  function draft(sheet: string, semanticHash: string, sourceFile = "ROOT/CLI/archivo.xlsx") {
    return {
      displayClient: "CLI",
      displayProduct: "PROD",
      productCode: "",
      sourceFile,
      sourceSheet: sheet,
      sourceModifiedAt: "2026-01-01T00:00:00.000Z",
      sourceHash: `h-${sheet}`,
      semanticHash,
      ingredients: [
        { position: 1, materialName: "A", materialCodeOrPhase: "", percentage: 100, notes: "" },
      ],
      procedureSteps: [{ position: 1, instruction: "Paso" }],
      specifications: [],
      percentageTotal: 100,
      warnings: [],
      altSourcePaths: [],
    };
  }

  it("'OE' vs 'Copia de OE' con misma fecha → OE vigente, copia histórica, sin conflicto", () => {
    const bank = new FormulaBankService(new MemoryFormulaBank());
    const res = bank.ingestDrafts([draft("OE", "sem-oe"), draft("Copia de OE", "sem-copia")]);
    expect(res.conflicts).toBe(0);
    const snap = bank.resolveVigente("CLI", "PROD");
    expect(snap).not.toBeNull();
  });

  it("'OE' vs 'OE (2)' con misma fecha → OE vigente, sin conflicto", () => {
    const bank = new FormulaBankService(new MemoryFormulaBank());
    const res = bank.ingestDrafts([draft("OE", "sem-oe2"), draft("OE (2)", "sem-oe2b")]);
    expect(res.conflicts).toBe(0);
    expect(bank.resolveVigente("CLI", "PROD")).not.toBeNull();
  });

  it("archivo 'Copia de …' con hojas OE y OE (2) → OE vigente por hoja secundaria", () => {
    const file = "ROOT/CAV/Copia de 250030 - X CAV.xlsx";
    const bank = new FormulaBankService(new MemoryFormulaBank());
    const res = bank.ingestDrafts([
      draft("OE (2)", "sem-a", file),
      draft("OE", "sem-b", file),
    ]);
    expect(res.conflicts).toBe(0);
    expect(bank.resolveVigente("CLI", "PROD")).not.toBeNull();
  });

  it("dos hojas numéricas distintas con misma fecha → CONFLICTO", () => {
    const bank = new FormulaBankService(new MemoryFormulaBank());
    const res = bank.ingestDrafts([draft("56", "sem-56"), draft("57", "sem-57")]);
    expect(res.conflicts).toBeGreaterThanOrEqual(1);
    expect(bank.resolveVigente("CLI", "PROD")).toBeNull();
  });
});

describe("clasificación de expresión", () => {
  const oe = (rows: (string | number)[][]) =>
    xlsx({ Serum: [["Producto", "P"], ...rows, ["PROCEDIMIENTO"], ["Paso"]] });

  it("PERCENTAGE ORIGINAL: suma ~100", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %"],
      ["A", 70],
      ["B", 30],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.expressionType).toBe("PERCENTAGE");
    expect(d!.percentageSource).toBe("ORIGINAL");
    expect(d!.percentageTotal).toBe(100);
    expect(d!.reviewRequired).toBe(false);
  });

  it("PROPORTION_SCALED: suma ~1 → ×100", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %"],
      ["A", 0.7],
      ["B", 0.3],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.percentageSource).toBe("PROPORTION_SCALED");
    expect(d!.ingredients.map((i) => i.percentage)).toEqual([70, 30]);
    expect(d!.originalPercentageTotal).toBe(1);
    expect(d!.percentageTotal).toBe(100);
    expect(d!.reviewRequired).toBe(false);
  });

  it("QUANTITY: % vacío y kg válido → derivar porcentaje", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["A", "", 30],
      ["B", "", 70],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.expressionType).toBe("QUANTITY");
    expect(d!.percentageSource).toBe("DERIVED_FROM_QUANTITY");
    expect(d!.ingredients.map((i) => i.percentage)).toEqual([30, 70]);
    expect(d!.ingredients.map((i) => i.sourceQuantity)).toEqual([30, 70]);
    expect(d!.percentageTotal).toBe(100);
    expect(d!.reviewRequired).toBe(false);
  });

  it("REVIEW: porcentaje fuera de tolerancia", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %"],
      ["A", 40],
      ["B", 40],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.reviewRequired).toBe(true);
    expect(d!.reviewReasons).toContain("PCT_TOTAL_OUT_OF_TOLERANCE");
    expect(d!.originalPercentageTotal).toBe(80);
  });

  it("REVIEW: suma de cantidades cero", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["A", "", 0],
      ["B", "", 0],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.reviewRequired).toBe(true);
    expect(d!.reviewReasons).toContain("QUANTITY_SUM_ZERO");
  });

  it("REVIEW: cantidad negativa", () => {
    const buf = oe([
      ["MATERIA PRIMA", "Fórmula %", "Kg a pesar"],
      ["A", "", -5],
      ["B", "", 10],
    ]);
    const [d] = parseWorkbookBuffer(buf, meta("ROOT/CLI/f.xlsx", "CLI"));
    expect(d!.reviewRequired).toBe(true);
    expect(d!.reviewReasons).toContain("QUANTITY_NEGATIVE");
  });
});
