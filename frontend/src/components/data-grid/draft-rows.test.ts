import { describe, expect, it } from "vitest";
import { isDraftComplete, isDraftRowId, missingRequired, newDraft, parseDrafts, serializeDrafts, topUpDrafts, type DraftRow } from "./draft-rows";

let n = 0;
const mk = () => `id-${++n}`;

describe("filas en blanco de la planilla", () => {
  it("una fila incompleta indica qué falta y no se considera completa", () => {
    const d: DraftRow = { id: "a", values: { lote: "L1", cantidad: "  " }, status: "editing" };
    expect(missingRequired(d, ["descripcion", "lote", "cantidad"])).toEqual(["descripcion", "cantidad"]);
    expect(isDraftComplete(d, ["descripcion", "lote", "cantidad"])).toBe(false);
    expect(isDraftComplete({ ...d, values: { descripcion: "X", lote: "L1", cantidad: "5" } }, ["descripcion", "lote", "cantidad"])).toBe(true);
  });

  it("siempre quedan N filas totalmente vacías al final, las usadas arriba", () => {
    const used = { ...newDraft(mk), values: { lote: "L1" } };
    const out = topUpDrafts([newDraft(mk), used, newDraft(mk)], 3, mk);
    expect(out.map((d) => Object.keys(d.values).length)).toEqual([1, 0, 0, 0]);
    expect(out[0]!.id).toBe(used.id);
    // idempotente
    expect(topUpDrafts(out, 3, mk).length).toBe(4);
  });

  it("una fila en error o guardando no se descarta aunque quede vacía", () => {
    const err: DraftRow = { id: "e", values: {}, status: "error", error: "x" };
    expect(topUpDrafts([err], 2, mk).some((d) => d.id === "e")).toBe(true);
  });

  it("solo se conservan en el navegador las filas con contenido, y se recuperan igual", () => {
    const a: DraftRow = { id: "a", values: { lote: "L1" }, status: "editing" };
    const raw = serializeDrafts([a, newDraft(mk)]);
    expect(parseDrafts(raw)).toEqual([a]);
    expect(parseDrafts("basura")).toEqual([]);
    expect(parseDrafts(null)).toEqual([]);
  });

  it("los ids de fila en blanco se distinguen de los registros reales", () => {
    expect(isDraftRowId("__draft:abc")).toBe(true);
    expect(isDraftRowId("0b7e")).toBe(false);
  });
});
