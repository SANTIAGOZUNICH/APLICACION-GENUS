import { describe, expect, it } from "vitest";
import { buildTableRows, filterTableRows, fmtFecha, fmtQty, summarizeTable } from "./weekly-table";
import type { ProductLine, ProductSection } from "./product-breakdown";

const line = (over: Partial<ProductLine> & Pick<ProductLine, "rowKey" | "materiaPrima">): ProductLine => ({
  codigo: "", pct: null, needKg: 2, stockFisico: 10, stockUtilizable: 10, reservado: 0, availableForThis: 10, diferencia: 8, saldoProyectado: 8,
  rowEstado: "SUFICIENTE", tone: "ok", saldoTone: "ok", shared: false, sharedWith: [], allocatedKg: 2, excluded: false, ...over,
});
const section = (over: Partial<ProductSection> & Pick<ProductSection, "id" | "lines">): ProductSection => ({
  client: "CLI", product: "CREMA", oes: [{ workId: "w1", oeNumber: "OE-1", kg: 10, days: "2026-10-26", source: "OE", reliable: true }], totalKg: 10, days: "2026-10-26", startDate: "2026-10-26",
  counts: { ok: 0, partial: 0, none: 0, unknown: 0, total: 0 }, overall: "CUBIERTA", versionNote: null, notes: [], ...over,
});
const data = (products: ProductSection[]) => ({ products, rows: [{ key: "gli", state: { observacion: "Comprar" } }] as never, excludedRows: [] });

describe("Control semanal como planilla", () => {
  it("2 kg de glicerina con stock suficiente → HAY, falta 0, fecha de la elaboración", () => {
    const rows = buildTableRows(data([section({ id: "a", lines: [line({ rowKey: "gli", materiaPrima: "GLICERINA" })] })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ producto: "CLI — CREMA", materiaPrima: "GLICERINA", necesaria: 2, enInventario: 10, falta: 0, estado: "HAY", fecha: "2026-10-26", observacion: "Comprar" });
    expect(fmtQty(rows[0]!.necesaria)).toBe("2,000 kg");
    expect(fmtFecha(rows[0]!.fecha)).toBe("26/10/2026");
  });

  it("acumulado: 10 kg de stock, trabajo A usa 6 y B necesita 7 → B muestra 4 en inventario y FALTA 3", () => {
    const a = section({ id: "a", startDate: "2026-10-26", lines: [line({ rowKey: "gli", materiaPrima: "GLICERINA", needKg: 6, availableForThis: 10, stockUtilizable: 10, shared: true })] });
    const b = section({ id: "b", product: "SERUM", startDate: "2026-10-27", overall: "CON_FALTANTES", counts: { ok: 0, partial: 1, none: 0, unknown: 0, total: 1 }, lines: [line({ rowKey: "gli", materiaPrima: "GLICERINA", needKg: 7, availableForThis: 4, stockUtilizable: 10, tone: "partial", rowEstado: "FALTANTE", shared: true })] });
    const rows = buildTableRows(data([a, b]));
    expect(rows.map((r) => [r.estado, r.enInventario, r.falta])).toEqual([["HAY", 10, 0], ["FALTA", 4, 3]]);
    const s = summarizeTable(data([a, b]), rows);
    expect(s).toMatchObject({ programadas: 2, suficientes: 1, mpConFaltante: 1 });
  });

  it("sin stock → FALTA con todo lo necesario; MP no identificada o fórmula incompleta → SIN DATOS (nunca HAY)", () => {
    const rows = buildTableRows(data([section({ id: "a", overall: "DATOS_INCOMPLETOS", lines: [
      line({ rowKey: "x", materiaPrima: "SIN STOCK MP", needKg: 5, availableForThis: 0, stockUtilizable: 0, tone: "none", rowEstado: "SIN STOCK" }),
      line({ rowKey: "y", materiaPrima: "NO VINCULADA", needKg: 3, tone: "unknown", rowEstado: "MP NO IDENTIFICADA", availableForThis: 0 }),
    ] })]));
    expect(rows[0]).toMatchObject({ estado: "FALTA", falta: 5, enInventario: 0 });
    expect(rows[1]).toMatchObject({ estado: "SIN DATOS", falta: null, enInventario: null });
    expect(fmtQty(rows[1]!.enInventario)).toBe("—");
  });

  it("OE sin ingredientes: una fila «Fórmula pendiente», SIN DATOS", () => {
    const rows = buildTableRows(data([section({ id: "a", lines: [], notes: [], overall: "DATOS_INCOMPLETOS" })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ estado: "SIN DATOS", materiaPrima: "—", nota: "Fórmula pendiente" });
  });

  it("varias elaboraciones del mismo producto quedan identificadas; las MP quitadas no aparecen", () => {
    const s = section({ id: "a", oes: [{ workId: "w1", oeNumber: "OE-1", kg: 10, days: "2026-10-26", source: "OE", reliable: true }, { workId: "w2", oeNumber: "OE-2", kg: 20, days: "2026-10-28", source: "OE", reliable: true }], lines: [line({ rowKey: "gli", materiaPrima: "GLICERINA" }), line({ rowKey: "z", materiaPrima: "OCULTA", excluded: true })] });
    const rows = buildTableRows(data([s]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detalle).toContain("OE OE-1");
    expect(rows[0]!.detalle).toContain("OE OE-2");
    expect(summarizeTable(data([s]), rows).programadas).toBe(2);
  });

  it("filtros por estado y buscador (producto o materia prima)", () => {
    const rows = buildTableRows(data([
      section({ id: "a", lines: [line({ rowKey: "gli", materiaPrima: "GLICERINA" }), line({ rowKey: "agua", materiaPrima: "AGUA", tone: "partial", availableForThis: 1, rowEstado: "FALTANTE" })] }),
      section({ id: "b", product: "SERUM", lines: [line({ rowKey: "per", materiaPrima: "PERFUME" })] }),
    ]));
    expect(filterTableRows(rows, { estado: "FALTA", q: "" }).map((r) => r.materiaPrima)).toEqual(["AGUA"]);
    expect(filterTableRows(rows, { estado: "TODOS", q: "glicérina" }).map((r) => r.materiaPrima)).toEqual(["GLICERINA"]);
    expect(filterTableRows(rows, { estado: "TODOS", q: "serum" }).map((r) => r.materiaPrima)).toEqual(["PERFUME"]);
    expect(filterTableRows(rows, { estado: "HAY", q: "" }).filter((r) => r.firstOfGroup)).toHaveLength(2);
  });
});
