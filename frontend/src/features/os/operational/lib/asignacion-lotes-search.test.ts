import { describe, expect, it } from "vitest";
import type { AsignacionLote } from "../adapters/asignacion-lotes-repository";
import {
  filterAsignacionLotesBySearch,
  matchesAsignacionLoteSearch,
  normalizeAsignacionSearchText,
} from "./asignacion-lotes-search";

const base: AsignacionLote = {
  id: "al-1",
  lote: "L-CR-001",
  fecha: "2026-07-20",
  producto: "Créamy Facial Hidratante",
  codigo: "PR-120",
  marca: "Genus",
  cantidades: 1200,
  vto: "2028-07-31",
  muestras: "Sí",
  cjMuestra: "1",
  fechaAnalisis: "2026-07-21",
  observaciones: "Lote piloto",
  createdAt: "2026-07-20T10:00:00.000Z",
  createdBy: "Test",
  updatedAt: "2026-07-20T10:00:00.000Z",
  updatedBy: "Test",
};

describe("asignacion-lotes-search", () => {
  it("normaliza acentos y espacios", () => {
    expect(normalizeAsignacionSearchText("  Créamy   Facial  ")).toBe("creamy facial");
  });

  it("encuentra Creamy por coincidencia parcial sin acentos", () => {
    expect(matchesAsignacionLoteSearch(base, "Creamy")).toBe(true);
    expect(matchesAsignacionLoteSearch(base, "crea")).toBe(true);
    expect(matchesAsignacionLoteSearch(base, "PR-120")).toBe(true);
    expect(matchesAsignacionLoteSearch(base, "inexistente")).toBe(false);
  });

  it("filtra colecciones por búsqueda normalizada", () => {
    const rows = [
      base,
      {
        ...base,
        id: "al-2",
        producto: "Shampoo Neutro",
        codigo: "PR-999",
        lote: "L-SH-001",
      },
    ];
    expect(filterAsignacionLotesBySearch(rows, "creamy").map((row) => row.id)).toEqual(["al-1"]);
    expect(filterAsignacionLotesBySearch(rows, "shamp").map((row) => row.id)).toEqual(["al-2"]);
  });
});
