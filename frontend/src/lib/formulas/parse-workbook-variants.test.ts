import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import { fillCalculatedCells, parseWorkbookBuffer, type SheetDiagnostic } from "./parse-workbook";
import { FORMULA_UNREADABLE, parseDriveFormulaBuffer } from "./drive-formulas-index";
import { buildAutoPreparedOe } from "@/lib/orders/oe-auto-prep-rules";
import { createEmptyOeContent } from "@/lib/orders/content";

type Cell = string | number | null | { f: string };

/** Planillas SINTÉTICAS (no son fórmulas reales de clientes). */
function book(sheets: Record<string, { rows: Cell[][]; merges?: string[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, def] of Object.entries(sheets)) {
    const plain = def.rows.map((r) => r.map((c) => (c && typeof c === "object" ? null : c)));
    const ws = XLSX.utils.aoa_to_sheet(plain);
    def.rows.forEach((r, ri) =>
      r.forEach((c, ci) => {
        if (c && typeof c === "object") ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: "n", f: c.f };
      })
    );
    if (def.merges) ws["!merges"] = def.merges.map((m) => XLSX.utils.decode_range(m));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEAD = ["MATERIA PRIMA", "CÓDIGO", "Fórmula %", "kg a pesar", "AJUSTE", "LOTE Nº"];
const STD: Cell[][] = [
  ["OE", "", "", "", "", ""],
  ["Cliente: PILAR", "", "", "", "", ""],
  HEAD,
  ["AGUA DESIONIZADA", "", 80, 32, "", ""],
  ["GLICERINA", "", 15, 6, "", ""],
  ["CONSERVANTE", "", 5, 2, "", ""],
  ["Total expresado en kg", "", 100, 40, "", ""],
  ["PROCEDIMIENTO DE ELABORACIÓN", "", "", "", "", ""],
  ["1- Pesar y mezclar", "", "", "", "", ""],
];
const META = { sourceFile: "PILAR - SERUM TEST.xlsx", sourceModifiedAt: null, folderClient: "PILAR", knownClients: ["PILAR"] };
const parse = (buf: Buffer) => {
  const diag: SheetDiagnostic[] = [];
  const drafts = parseWorkbookBuffer(buf, { ...META,  });
  return { drafts, diag };
};
const names = (d: { ingredients: Array<{ materialName: string }> }) => d.ingredients.map((i) => i.materialName);

describe("parser de fórmulas: estructuras distintas", () => {
  it("1) estándar", () => {
    const { drafts } = parse(book({ Hoja1: { rows: STD } }));
    expect(drafts).toHaveLength(1);
    expect(names(drafts[0]!)).toEqual(["AGUA DESIONIZADA", "GLICERINA", "CONSERVANTE"]);
    expect(drafts[0]!.ingredients.map((i) => i.percentage)).toEqual([80, 15, 5]);
    expect(drafts[0]!.reviewRequired).toBe(false);
  });

  it("2) encabezados desplazados (filas de título arriba, columnas vacías a la izquierda, encabezado partido en dos filas)", () => {
    const rows: Cell[][] = [
      ["", "", "", "", "", "", ""],
      ["", "ORDEN DE ELABORACIÓN", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["", "", "", "% Fórmula", "", "", ""],
      ["", "Materia prima", "Cód.", "", "", "", ""],
      ["", "AGUA", "", 70, "", "", ""],
      ["", "ACTIVO KOLLAREN", "K-1", 25, "", "", ""],
      ["", "ADITIVO", "", 5, "", "", ""],
      ["", "Total", "", 100, "", "", ""],
    ];
    const { drafts } = parse(book({ Hoja1: { rows } }));
    expect(drafts).toHaveLength(1);
    expect(names(drafts[0]!)).toEqual(["AGUA", "ACTIVO KOLLAREN", "ADITIVO"]);
    expect(drafts[0]!.ingredients[1]!.materialCodeOrPhase).toBe("K-1");
    expect(drafts[0]!.ingredients.map((i) => i.percentage)).toEqual([70, 25, 5]);
  });

  it("3) celdas combinadas (nombre en 2 columnas, encabezado de % combinado)", () => {
    const rows: Cell[][] = [
      ["MATERIA PRIMA", "", "Fórmula %", "", ""],
      ["AGUA", "", "", 90, ""],
      ["ACTIVO", "", "", 10, ""],
      ["Total", "", "", 100, ""],
      ["PROCEDIMIENTO", "", "", "", ""],
    ];
    const { drafts } = parse(
      book({ Hoja1: { rows, merges: ["A1:B1", "C1:D1", "A2:B2", "A3:B3"] } })
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.ingredients.map((i) => [i.materialName, i.percentage])).toEqual([["AGUA", 90], ["ACTIVO", 10]]);
  });

  it("4) varias hojas: usa la hoja con fórmula válida; si hay dos distintas y ninguna coincide, no elige", () => {
    const other: Cell[][] = [["Notas", ""], ["sin tabla", ""]];
    const only = book({ Notas: { rows: other }, Formula: { rows: STD } });
    const r1 = parseDriveFormulaBuffer({ buffer: only, checksum: "x", fileId: "f1", fileName: "PILAR - SERUM TEST.xlsx", modifiedTime: null, client: "PILAR", productHint: "SERUM TEST", knownClients: ["PILAR"] });
    expect(r1.found).toBe(true);

    const B: Cell[][] = STD.map((r) => [...r]);
    B[3] = ["AGUA", "", 60, 24, "", ""];
    B[4] = ["OTRA", "", 35, 14, "", ""];
    const two = book({ Alfa: { rows: STD }, Beta: { rows: B } });
    const r2 = parseDriveFormulaBuffer({ buffer: two, checksum: "x", fileId: "f2", fileName: "otro.xlsx", modifiedTime: null, client: "PILAR", productHint: "Producto Z", knownClients: ["PILAR"] });
    expect(r2.found).toBe(false);
    expect((r2 as { message: string }).message).toContain(FORMULA_UNREADABLE);
    expect((r2 as { message: string }).message).toContain("varias hojas");
  });

  it("5) porcentajes calculados con fórmulas de Excel SIN valor guardado (los calcula; si no puede, no inventa)", () => {
    // El escritor de SheetJS descarta fórmulas sin valor: se arma la hoja como la deja un script (celda con `f` y sin `v`).
    const ws: Record<string, unknown> = {
      E2: { t: "n", v: 32 }, E3: { t: "n", v: 6 }, E4: { t: "n", v: 2 },
      E5: { t: "n", f: "SUM(E2:E4)" },
      C2: { t: "n", f: "E2/E$5*100" }, C3: { t: "n", f: "E3/E$5*100" }, C4: { t: "n", f: "E4/E$5*100" },
      C6: { t: "n", f: "OTRAHOJA!A1*2" }, C7: { t: "e", v: 7 },
    };
    const { unresolved } = fillCalculatedCells(ws);
    expect([2, 3, 4].map((r) => (ws[`C${r}`] as { v: number }).v)).toEqual([80, 15, 5]);
    expect((ws.E5 as { v: number }).v).toBe(40);
    expect(unresolved).toBe(1); // la referencia a otra hoja no se resuelve: queda vacía
    expect((ws.C6 as { v?: number }).v).toBeUndefined();
    expect((ws.C7 as { t: string }).t).toBe("z"); // #DIV/0! → vacía
  });

  it("6) porcentajes como texto («80 %», «15,0», «5%»)", () => {
    const rows = STD.map((r) => [...r]);
    rows[3]![2] = "80 %";
    rows[4]![2] = "15,0";
    rows[5]![2] = "5%";
    const { drafts } = parse(book({ Hoja1: { rows } }));
    expect(drafts[0]!.ingredients.map((i) => i.percentage)).toEqual([80, 15, 5]);
    expect(drafts[0]!.reviewRequired).toBe(false);
  });

  it("7) fórmula sin ingredientes → causa clara, no tabla vacía", () => {
    const rows: Cell[][] = [HEAD, ["Total expresado en kg", "", 0, 0, "", ""], ["PROCEDIMIENTO", "", "", "", "", ""]];
    const res = parseDriveFormulaBuffer({ buffer: book({ Hoja1: { rows } }), checksum: "x", fileId: "f", fileName: "vacia.xlsx", modifiedTime: null, client: "PILAR", knownClients: ["PILAR"] });
    expect(res.found).toBe(false);
    expect((res as { message: string }).message).toMatch(/No se pudieron cargar las materias primas de esta fórmula\..*vacía/);
    const nohead = parseDriveFormulaBuffer({ buffer: book({ Hoja1: { rows: [["a", "b"], ["c", "d"]] } }), checksum: "x", fileId: "f", fileName: "x.xlsx", modifiedTime: null, client: "PILAR", knownClients: [] });
    expect((nohead as { message: string }).message).toMatch(/No se encontró la tabla de materias primas/);
  });

  it("títulos de fase y subtotales no son ingredientes; un ingrediente sin % no se inventa", () => {
    const rows: Cell[][] = [
      HEAD,
      ["FASE A:", "", "", "", "", ""],
      ["AGUA", "", 50, 20, "", ""],
      ["Subtotal fase A", "", 50, 20, "", ""],
      ["Fase B", "", "", "", "", ""],
      ["ACTIVO", "", 50, 20, "", ""],
      ["Total expresado en kg", "", 100, 40, "", ""],
      ["PROCEDIMIENTO", "", "", "", "", ""],
    ];
    const { drafts } = parse(book({ Hoja1: { rows } }));
    expect(names(drafts[0]!)).toEqual(["AGUA", "ACTIVO"]);
    expect(drafts[0]!.warnings.join(" ")).toMatch(/omitidas/);

    const missing = STD.map((r) => [...r]);
    missing[4]![2] = "";
    missing[4]![3] = "";
    const d2 = parse(book({ Hoja1: { rows: missing } })).drafts[0]!;
    expect(d2.ingredients.find((i) => i.materialName === "GLICERINA")?.percentage).toBeNull();
    expect(d2.reviewRequired).toBe(true);
    const res = parseDriveFormulaBuffer({ buffer: book({ Hoja1: { rows: missing } }), checksum: "x", fileId: "f", fileName: "PILAR - SERUM TEST.xlsx", modifiedTime: null, client: "PILAR", productHint: "SERUM TEST", knownClients: ["PILAR"] });
    expect((res as { message: string }).message).toMatch(/sin porcentaje \(GLICERINA\)/);
  });
});

describe("cantidades de la OE (orden de 40 kg)", () => {
  it("5 % → 2 kg y 1 % → 0,4 kg", () => {
    const rows: Cell[][] = [HEAD, ["AGUA", "", 94, "", "", ""], ["ACTIVO", "", 5, "", "", ""], ["PERFUME", "", 1, "", "", ""], ["PROCEDIMIENTO", "", "", "", "", ""]];
    const res = parseDriveFormulaBuffer({ buffer: book({ Hoja1: { rows } }), checksum: "abc", fileId: "f", fileName: "PILAR - SERUM KOLLAREN.xlsx", modifiedTime: null, client: "PILAR", productHint: "SERUM KOLLAREN", knownClients: ["PILAR"] });
    expect(res.found).toBe(true);
    if (!res.found) return;
    const built = buildAutoPreparedOe({
      content: createEmptyOeContent(),
      work: { id: "w", version: 1, product: "SERUM KOLLAREN", client: "PILAR", plannedQuantity: "40", unit: "kg", packagingLote: "L1" },
      formula: { ok: true, ref: { source: "DRIVE", formulaProductId: "drive:f", formulaVersionId: "drive:f:1", versionHash: "abc" }, materials: res.materials, procedureSteps: res.procedureSteps },
      actorEmail: "p@x", reason: "t", now: new Date().toISOString(),
    });
    const kg = Object.fromEntries(built.content.materials.map((m) => [m.materiaPrima, m.kgAPesar]));
    expect(kg).toEqual({ AGUA: 37.6, ACTIVO: 2, PERFUME: 0.4 });
    expect(built.content.totals.kgSum).toBe(40);
  });
});
