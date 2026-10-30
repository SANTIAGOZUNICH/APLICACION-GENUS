import { describe, expect, it } from "vitest";
import type { ProductionInput, StockLot } from "./availability";
import { buildWeeklyTotal, weeklyTotalToSheets } from "./weekly-total";

const lot = (o: Partial<StockLot> & { codigo: string; descripcion: string; cantidadKg: number }): StockLot => ({ id: `${o.codigo}-${o.lote ?? "L"}`, proveedor: "", lote: "L1", ...o });
const prod = (id: string, kg: number | null, over: Partial<ProductionInput> = {}, mp = "CARBOPOL", codigoMp = "CAR-1"): ProductionInput => ({
  id, label: `P${id}`, client: "Cliente", product: `Producto ${id}`, oeNumber: `OE-${id}`, days: "2026-11-03", weekKg: 100, reliable: kg != null,
  lines: [{ materiaPrima: mp, codigoMp, kg }], ...over,
});
const TODAY = "2026-11-02";

describe("Control semanal total de MP", () => {
  const lots = [lot({ codigo: "CAR-1", descripcion: "Carbopol", cantidadKg: 12 })];

  it("cinco OE con la misma MP se consolidan en UNA fila con la suma exacta (3+5+3+6+1 = 18) y faltante = max(0, necesario − stock)", () => {
    const r = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [3, 5, 3, 6, 1].map((kg, i) => prod(String(i + 1), kg)) });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ codigo: "CAR-1", necesario: 18, teorico: 18, consumido: 0, stockDisponible: 12, faltante: 6, oeCount: 5, estado: "FALTANTE" });
    expect(r.rows[0]!.needs.map((n) => n.pendiente)).toEqual([3, 5, 3, 6, 1]);
    expect(r.summary).toMatchObject({ total: 1, conFaltante: 1, necesarioKg: 18, faltanteKg: 6, oeCount: 5 });
  });

  it("stock mayor que lo necesario: faltante 0 y SUFICIENTE", () => {
    const r = buildWeeklyTotal({ lots: [lot({ codigo: "GLI-1", descripcion: "Glicerina", cantidadKg: 30 })], todayIso: TODAY, productions: [prod("1", 25, {}, "GLICERINA", "GLI-1")] });
    expect(r.rows[0]).toMatchObject({ necesario: 25, stockDisponible: 30, faltante: 0, estado: "SUFICIENTE" });
  });

  it("no agrupa por texto: mismo nombre pero CÓDIGOS distintos quedan en filas separadas; nombres distintos con el mismo código se unen", () => {
    const stock = [lot({ codigo: "A-1", descripcion: "Glicerina", cantidadKg: 5 }), lot({ codigo: "B-2", descripcion: "Glicerina vegetal", cantidadKg: 7 })];
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [prod("1", 2, {}, "Glicerina", "A-1"), prod("2", 3, {}, "Glicerina", "B-2"), prod("3", 4, {}, "GLICERINA USP", "A-1")] });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.codigo === "A-1")).toMatchObject({ necesario: 6, stockDisponible: 5, faltante: 1 });
    expect(r.rows.find((x) => x.codigo === "B-2")).toMatchObject({ necesario: 3, stockDisponible: 7 });
  });

  it("sin código en la línea: se identifica por nombre exacto del inventario; nombre ambiguo o inexistente se marca y no inventa stock", () => {
    const stock = [lot({ codigo: "ALC-1", descripcion: "Alcohol", cantidadKg: 100 }), lot({ codigo: "X-1", descripcion: "Colorante", cantidadKg: 1 }), lot({ codigo: "X-2", descripcion: "Colorante", cantidadKg: 1 })];
    const r = buildWeeklyTotal({
      lots: stock,
      todayIso: TODAY,
      productions: [prod("1", 60, {}, "ALCOHOL", ""), prod("2", 2, {}, "Colorante", ""), prod("3", 5, {}, "Mentol raro", "")],
    });
    expect(r.rows.find((x) => x.codigo === "ALC-1")).toMatchObject({ necesario: 60, stockDisponible: 100, identificada: true });
    expect(r.rows.find((x) => x.materiaPrima === "Colorante")).toMatchObject({ estado: "MP AMBIGUA", identificada: false });
    expect(r.rows.find((x) => x.materiaPrima === "Mentol raro")).toMatchObject({ estado: "MP NO IDENTIFICADA", stockDisponible: 0, faltante: 5 });
  });

  it("consumo parcial: necesidad pendiente = teórica − consumida (sin recontar); consumo mayor al teórico no da negativos", () => {
    const parcial = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [prod("1", 10, { consumedByCode: { "CAR-1": 4 } })] });
    expect(parcial.rows[0]).toMatchObject({ teorico: 10, consumido: 4, necesario: 6, faltante: 0 });
    const exceso = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [prod("1", 10, { consumedByCode: { "CAR-1": 15 } })] });
    expect(exceso.rows[0]).toMatchObject({ teorico: 10, consumido: 10, necesario: 0 });
  });

  it("una MP repetida en dos fases de la misma OE suma en la misma fila y cuenta UNA OE", () => {
    const p = prod("1", 4, { lines: [{ materiaPrima: "Carbopol", codigoMp: "CAR-1", kg: 4 }, { materiaPrima: "Carbopol", codigoMp: "CAR-1", kg: 2 }] });
    const r = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [p] });
    expect(r.rows[0]).toMatchObject({ necesario: 6, oeCount: 1 });
  });

  it("producción sin cantidad/fórmula confiable no suma y se informa", () => {
    const r = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [prod("1", 5), prod("2", null, { unreliableReason: "Cantidad no válida" })] });
    expect(r.rows[0]!.necesario).toBe(5);
    expect(r.incompletas).toEqual([{ id: "2", label: "P2", reason: "Cantidad no válida" }]);
  });

  it("stock bloqueado o vencido no es disponible; el físico sí se informa", () => {
    const stock = [lot({ codigo: "CAR-1", descripcion: "Carbopol", cantidadKg: 10 }), lot({ codigo: "CAR-1", descripcion: "Carbopol", cantidadKg: 9, lote: "L2", vencimiento: "2026-01-01" })];
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [prod("1", 12)] });
    expect(r.rows[0]).toMatchObject({ stockDisponible: 10, stockFisico: 19, faltante: 2 });
  });

  it("el Excel sale de las mismas filas: los totales coinciden con la pantalla", () => {
    const r = buildWeeklyTotal({ lots, todayIso: TODAY, productions: [3, 5, 3, 6, 1].map((kg, i) => prod(String(i + 1), kg)) });
    const { total, detalle } = weeklyTotalToSheets(r);
    expect(total[1]!.slice(0, 9)).toEqual(["CAR-1", "Carbopol", 18, 0, 18, 12, 6, 5, "FALTANTE"]);
    expect(total[1]!.slice(9)).toEqual(["", ""]); // sin observación ni reemplazo
    expect(total[total.length - 1]![4]).toBe(18);
    const sumaDetalle = detalle.filter((d) => d[2] !== "" && typeof d[9] === "number").reduce((s, d) => s + (d[9] as number), 0);
    expect(sumaDetalle).toBe(18);
  });
});

describe("Control semanal total — reemplazo manual, observaciones y exclusión", () => {
  const stock = [
    lot({ codigo: "MP023", descripcion: "EMULCARE EI — Proveedor Z", cantidadKg: 20 }),
    lot({ codigo: "GLI-1", descripcion: "Glicerina", cantidadKg: 100 }),
  ];
  const emul = (id: string, kg: number, extra: Partial<ProductionInput> = {}) => prod(id, kg, extra, "EMULSIONANTE X", "");

  it("sin reemplazo, «EMULSIONANTE X» queda NO IDENTIFICADA (sin stock)", () => {
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 5)] });
    expect(r.rows[0]).toMatchObject({ materiaPrima: "EMULSIONANTE X", estado: "MP NO IDENTIFICADA", stockDisponible: 0, faltante: 5 });
  });

  it("reemplazo manual: pasa a EMULCARE EI (MP023), mantiene los 5 kg y usa SU stock y faltante", () => {
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 5)], replacements: new Map([["name:emulsionante x", "MP023"]]) });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ codigo: "MP023", materiaPrima: "EMULCARE EI", necesario: 5, stockDisponible: 20, faltante: 0, identificada: true, estado: "SUFICIENTE" });
    expect(r.rows[0]!.reemplazos).toEqual([{ sourceKey: "name:emulsionante x", sourceName: "EMULSIONANTE X", kg: 5 }]);
    expect(r.rows[0]!.needs[0]!.origen).toBe("EMULSIONANTE X");
    expect(r.summary.sinIdentificar).toBe(0);
  });

  it("con faltante: el stock de la MP elegida (20 kg) contra 25 necesarios → faltante 5", () => {
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 25)], replacements: new Map([["name:emulsionante x", "MP023"]]) });
    expect(r.rows[0]).toMatchObject({ necesario: 25, stockDisponible: 20, faltante: 5, estado: "FALTANTE" });
  });

  it("dos MP distintas reemplazadas por la MISMA se consolidan (y con la que ya estaba en el control)", () => {
    const p1 = prod("1", 5, { lines: [{ materiaPrima: "EMULSIONANTE X", kg: 5 }, { materiaPrima: "EMULCARE EI", codigoMp: "MP023", kg: 2 }, { materiaPrima: "OTRO EMULSIONANTE", kg: 3 }] });
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [p1], replacements: new Map([["name:emulsionante x", "MP023"], ["name:otro emulsionante", "MP023"]]) });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ codigo: "MP023", necesario: 10, oeCount: 1 });
    expect(r.rows[0]!.reemplazos.map((x) => x.sourceName).sort()).toEqual(["EMULSIONANTE X", "OTRO EMULSIONANTE"]);
  });

  it("el consumo registrado de la MP original se descuenta de la MP elegida (sin recontar)", () => {
    const r = buildWeeklyTotal({ lots: [...stock, lot({ codigo: "OLD-9", descripcion: "Emulsionante viejo", cantidadKg: 1 })], todayIso: TODAY, productions: [prod("1", 8, { consumedByCode: { "OLD-9": 3 } }, "Emulsionante viejo", "OLD-9")], replacements: new Map([["cod:OLD-9", "MP023"]]) });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ codigo: "MP023", teorico: 8, consumido: 3, necesario: 5 });
  });

  it("un reemplazo hacia un código que ya no existe en el inventario no se aplica; cadenas A→B→C llegan al final", () => {
    const sinDestino = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 5)], replacements: new Map([["name:emulsionante x", "NO-EXISTE"]]) });
    expect(sinDestino.rows[0]).toMatchObject({ materiaPrima: "EMULSIONANTE X", identificada: false });
    const cadena = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 5)], replacements: new Map([["name:emulsionante x", "GLI-1"], ["cod:GLI-1", "MP023"]]) });
    expect(cadena.rows[0]).toMatchObject({ codigo: "MP023", necesario: 5 });
  });

  it("observación por fila y exclusión: las excluidas salen de filas y resumen y se listan para restaurar", () => {
    const productions = [emul("1", 5), prod("2", 3, {}, "GLICERINA", "GLI-1")];
    const base = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions });
    expect(base.rows).toHaveLength(2);
    const r = buildWeeklyTotal({
      lots: stock, todayIso: TODAY, productions,
      rowState: new Map([["cod:GLI-1", { observacion: "pedir 20 kg", excluded: false }], ["name:emulsionante x", { excluded: true, excludedBy: "mp@x" }]]),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ codigo: "GLI-1", observacion: "pedir 20 kg" });
    expect(r.excluidas.map((e) => e.key)).toEqual(["name:emulsionante x"]);
    expect(r.summary).toMatchObject({ total: 1, necesarioKg: 3 });
  });

  it("el Excel incluye observaciones y MP originales de los reemplazos", () => {
    const r = buildWeeklyTotal({ lots: stock, todayIso: TODAY, productions: [emul("1", 5)], replacements: new Map([["name:emulsionante x", "MP023"]]), rowState: new Map([["cod:MP023", { observacion: "ok" }]]) });
    const sheets = weeklyTotalToSheets(r);
    expect(sheets.total[0]).toContain("Observaciones");
    expect(sheets.total[1]!.slice(-2)).toEqual(["ok", "EMULSIONANTE X"]);
    expect(sheets.detalle[1]!.at(-1)).toBe("EMULSIONANTE X");
  });
});
