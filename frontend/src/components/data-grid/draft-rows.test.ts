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

import { applyPastedToDrafts, mapPastedToDrafts, parseClipboardMatrix, type PasteCol } from "./draft-rows";

const cols: PasteCol[] = [
  { key: "FECHA", title: "Fecha", editable: true },
  { key: "ING", title: "Ingreso", editable: false },
  { key: "DESC", title: "Descripción", editable: true },
  { key: "PROV", title: "Proveedor", editable: true },
  { key: "TOTAL", title: "Total", editable: false },
  { key: "LOTE", title: "Lote", editable: true },
];

describe("pegar varias filas en las filas en blanco", () => {
  it("parsea el portapapeles de Excel (tabs, saltos, comillas)", () => {
    expect(parseClipboardMatrix('a\t"b c"\r\nx\ty\r\n')).toEqual([["a", "b c"], ["x", "y"]]);
  });
  it("sin encabezados: reparte en columnas EDITABLES consecutivas (saltea las calculadas)", () => {
    const m = [["21/10/2026", "Agua", "ACME", "L1"], ["22/10/2026", "Gel", "ACME", "L2"]];
    expect(mapPastedToDrafts(m, cols, 0)).toEqual([
      { FECHA: "21/10/2026", DESC: "Agua", PROV: "ACME", LOTE: "L1" },
      { FECHA: "22/10/2026", DESC: "Gel", PROV: "ACME", LOTE: "L2" },
    ]);
  });
  it("con encabezados que coinciden: mapea por nombre y no carga la fila de títulos", () => {
    const m = [["Lote", "Descripción", "columna rara"], ["L9", "Glicerina", "x"]];
    expect(mapPastedToDrafts(m, cols, 0)).toEqual([{ LOTE: "L9", DESC: "Glicerina" }]);
  });
  it("arranca desde la columna activa", () => {
    expect(mapPastedToDrafts([["Gel", "ACME"]], cols, 2)).toEqual([{ DESC: "Gel", PROV: "ACME" }]);
  });
  it("aplica sobre las filas en blanco y agrega filas libres si el pegado es más largo", () => {
    const base = [newDraft(() => "a"), newDraft(() => "b")];
    const r = applyPastedToDrafts(base, 1, [{ LOTE: "1" }, { LOTE: "2" }, {}], () => `n${Math.random()}`);
    expect(r.drafts.length).toBe(4);
    expect(r.drafts[1]!.values.LOTE).toBe("1");
    expect(r.drafts[2]!.values.LOTE).toBe("2");
    expect(r.touchedIds).toEqual([base[1]!.id, r.drafts[2]!.id]);
  });
});
