import { describe, expect, it } from "vitest";
import { applySort } from "@/lib/sorting/sort-contract";
import type { AsignacionLote } from "@/lib/asignacion-lotes/types";
import { ASIGNACION_LOTES_SORT_OPTIONS } from "./asignacion-lotes-view";

/**
 * AUDIT_ORDENAMIENTO_GLOBAL — Asignación de lotes ya tenía un sort
 * funcional (migrado acá al contrato compartido, sin cambiar el
 * comportamiento existente) pero le faltaba "VTO más próximo" pese a
 * mostrar VTO como columna — se agrega, además de las opciones inversas
 * de producto (Z-A) que faltaban.
 */
function lote(overrides: Partial<AsignacionLote>): AsignacionLote {
  return {
    id: overrides.id ?? "id",
    lote: "L-1",
    fecha: "2026-08-03",
    producto: "Producto",
    codigo: "C1",
    marca: "",
    cantidades: 0,
    vto: null,
    muestras: "",
    cjMuestra: "",
    fechaAnalisis: null,
    observaciones: "",
    createdAt: "2026-08-03T12:00:00.000Z",
    createdBy: "test@genus",
    updatedAt: "2026-08-03T12:00:00.000Z",
    updatedBy: "test@genus",
    ...overrides,
  };
}

describe("asignacion-lotes-view — ASIGNACION_LOTES_SORT_OPTIONS", () => {
  // Fechas deliberadamente muy lejanas en el futuro (no vencidas hoy ni en
  // ningún "hoy" real durante la vida de este test) — el caso "vencido vs
  // no vencido" ya está cubierto a fondo en sort-contract.test.ts; acá solo
  // se confirma que la opción "vto_asc" existe y delega correctamente.
  it("vto_asc: el vencimiento más próximo va primero, sin VTO al final (nuevo — no existía)", () => {
    const rows = [
      lote({ id: "a", vto: "2099-01-01" }),
      lote({ id: "b", vto: null }),
      lote({ id: "c", vto: "2098-09-01" }),
    ];
    const sorted = applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "vto_asc");
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("fecha_desc/asc conservan el comportamiento previo (más reciente/antigua primero)", () => {
    const rows = [
      lote({ id: "a", fecha: "2026-08-10" }),
      lote({ id: "b", fecha: "2026-01-01" }),
      lote({ id: "c", fecha: "2026-12-31" }),
    ];
    expect(applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "fecha_desc").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "fecha_asc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("cantidad_desc/asc son numéricas (nuevo)", () => {
    const rows = [
      lote({ id: "a", cantidades: 100 }),
      lote({ id: "b", cantidades: 9 }),
      lote({ id: "c", cantidades: 2000 }),
    ];
    expect(applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "cantidad_asc").map((r) => r.cantidades)).toEqual([
      9, 100, 2000,
    ]);
  });

  it("producto_asc/desc y lote_asc/código_asc ordenan A-Z", () => {
    const rows = [lote({ id: "a", producto: "Zapallo" }), lote({ id: "b", producto: "Acondicionador" })];
    expect(applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "producto_asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(applySort(rows, ASIGNACION_LOTES_SORT_OPTIONS, "producto_desc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
