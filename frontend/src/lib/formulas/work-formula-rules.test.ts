import { describe, expect, it } from "vitest";
import { formulaIncompleteReason, pickExactDriveHit } from "./work-formula-rules";

describe("pickExactDriveHit — nunca por parecido", () => {
  const hits = [
    { productLabel: "Crema Corporal Aloe" },
    { productLabel: "Crema Corporal Aloe 500" },
    { productLabel: "Shampoo Neutro", aliases: ["Shampoo N"] },
  ];
  it("una sola coincidencia exacta (sin tildes/mayúsculas/puntuación)", () => {
    expect(pickExactDriveHit(hits, "crema corporal aloe")).toMatchObject({ kind: "one", hit: { productLabel: "Crema Corporal Aloe" } });
    expect(pickExactDriveHit(hits, "SHAMPOO N")).toMatchObject({ kind: "one" });
  });
  it("parecido pero no igual: ninguna", () => {
    expect(pickExactDriveHit(hits, "Crema Corporal")).toEqual({ kind: "none" });
    expect(pickExactDriveHit(hits, "")).toEqual({ kind: "none" });
  });
  it("dos archivos con el mismo producto: ambiguo", () => {
    expect(pickExactDriveHit([...hits, { productLabel: "crema corporal aloe" }], "Crema Corporal Aloe")).toMatchObject({ kind: "many", count: 2 });
  });
});

describe("formulaIncompleteReason", () => {
  it("completa (100 % ± 2)", () => {
    expect(formulaIncompleteReason([{ materiaPrima: "A", codigo: "1", formulaPct: 60 }, { materiaPrima: "B", codigo: "2", formulaPct: 40 }])).toBeNull();
    expect(formulaIncompleteReason([{ materiaPrima: "A", codigo: "1", formulaPct: 99.5 }])).toBeNull();
  });
  it("sin MP, con % vacío o total fuera de rango: incompleta", () => {
    expect(formulaIncompleteReason([])).toMatch(/no tiene materias primas/);
    expect(formulaIncompleteReason([{ materiaPrima: "A", codigo: "1", formulaPct: null }])).toMatch(/sin porcentaje \(A\)/);
    expect(formulaIncompleteReason([{ materiaPrima: "A", codigo: "1", formulaPct: 80 }])).toMatch(/suman 80 %/);
  });
});

import { resolveCrossSourceDuplicates } from "./work-formula-rules";

describe("resolveCrossSourceDuplicates — mismo cliente+producto en dos carpetas", () => {
  const a = { fileId: "a", sourceFolderId: "PRINCIPAL", primarySource: true };
  const b = { fileId: "b", sourceFolderId: "NUEVA", primarySource: false };
  it("contenido idéntico: no es conflicto, se usa la carpeta principal", () => {
    expect(resolveCrossSourceDuplicates([b, a], ["x", "x"])).toEqual({ kind: "identical", hit: a });
  });
  it("versiones distintas: conflicto, no se elige ninguna", () => {
    expect(resolveCrossSourceDuplicates([a, b], ["x", "y"])).toEqual({ kind: "conflict" });
  });
  it("todos en la misma carpeta: es la ambigüedad de siempre", () => {
    expect(resolveCrossSourceDuplicates([a, { ...a, fileId: "c" }], ["x", "x"])).toEqual({ kind: "same_folder" });
  });
});
