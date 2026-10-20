import { describe, expect, it } from "vitest";
import { EMPTY_PREFS, applySheetView, parsePrefs, toggleHidden, withWidth } from "./sheet-view-prefs";

type R = { a: string; b: string };
const rows: R[] = [
  { a: "Zinc", b: "10" },
  { a: "ácido cítrico", b: "2" },
  { a: "Agua", b: "1.500" },
  { a: "", b: "" },
];
const text = (k: string, r: R) => (k === "a" ? r.a : r.b);

describe("vista de planilla (filtros, orden, columnas)", () => {
  it("filtra por columna sin importar tildes ni mayúsculas", () => {
    const out = applySheetView(rows, text, { ...EMPTY_PREFS, filters: { a: "ACIDO" } });
    expect(out.map((r) => r.a)).toEqual(["ácido cítrico"]);
  });
  it("ordena texto y números por valor, con vacíos al final", () => {
    expect(applySheetView(rows, text, { ...EMPTY_PREFS, sortKey: "b", sortDir: "asc" }).map((r) => r.b)).toEqual(["2", "10", "1.500", ""]);
    expect(applySheetView(rows, text, { ...EMPTY_PREFS, sortKey: "b", sortDir: "desc" }).map((r) => r.b)).toEqual(["1.500", "10", "2", ""]);
    expect(applySheetView(rows, text, { ...EMPTY_PREFS, sortKey: "a" }).map((r) => r.a)).toEqual(["ácido cítrico", "Agua", "Zinc", ""]);
  });
  it("no altera las filas originales ni el orden sin preferencias", () => {
    const copy = [...rows];
    expect(applySheetView(rows, text, EMPTY_PREFS)).toBe(rows);
    applySheetView(rows, text, { ...EMPTY_PREFS, sortKey: "a" });
    expect(rows).toEqual(copy);
  });
  it("las columnas obligatorias no se pueden ocultar y los anchos tienen límites", () => {
    expect(toggleHidden(EMPTY_PREFS, "LOTE", ["LOTE"]).hidden).toEqual([]);
    expect(toggleHidden(EMPTY_PREFS, "CLIENTE", ["LOTE"]).hidden).toEqual(["CLIENTE"]);
    expect(withWidth(EMPTY_PREFS, "a", 5).widths.a).toBe(60);
    expect(withWidth(EMPTY_PREFS, "a", 9999).widths.a).toBe(600);
  });
  it("recupera preferencias guardadas y descarta basura", () => {
    expect(parsePrefs(JSON.stringify({ hidden: ["x"], widths: { a: 200, b: 5 }, sortKey: "a", sortDir: "desc", filters: { a: "q", b: " " } }))).toEqual({ hidden: ["x"], widths: { a: 200 }, sortKey: "a", sortDir: "desc", filters: { a: "q" } });
    expect(parsePrefs("no-json")).toEqual(EMPTY_PREFS);
  });
});
