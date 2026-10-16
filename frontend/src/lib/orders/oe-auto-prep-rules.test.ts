import { describe, expect, it } from "vitest";
import { createEmptyOeContent, normalizeOrderContent } from "@/lib/orders/content";
import type { OeContent } from "@/lib/orders/types";
import type { WorkFormulaResolution } from "@/lib/formulas/work-formula-rules";
import {
  buildAutoPreparedOe,
  oeProcesoIniciado,
  workQuantityKg,
  type AutoPrepWork,
} from "./oe-auto-prep-rules";

const blank = () =>
  normalizeOrderContent(createEmptyOeContent({ productName: "Crema X", client: "Cliente A", date: "2026-10-13" })) as OeContent;

const work = (over: Partial<AutoPrepWork> = {}): AutoPrepWork => ({
  id: "w1",
  version: 1,
  product: "Crema X",
  client: "Cliente A",
  plannedQuantity: "150",
  unit: "kg",
  packagingLote: "L-2610-01",
  ...over,
});

const formulaOk = (over: Partial<Extract<WorkFormulaResolution, { ok: true }>> = {}): WorkFormulaResolution => ({
  ok: true,
  ref: {
    source: "DRIVE",
    formulaProductId: "drive:abc",
    formulaVersionId: "drive:abc:1234",
    versionHash: "h1",
    displayProduct: "Crema X",
    productCode: "PT-100",
    driveFileId: "abc",
  },
  materials: [
    { materiaPrima: "Agua", codigo: "MP-1", formulaPct: 80 },
    { materiaPrima: "Glicerina", codigo: "MP-2", formulaPct: 12.5 },
    { materiaPrima: "Perfume", codigo: "MP-3", formulaPct: 7.5 },
  ],
  procedureSteps: [{ id: "step-0", text: "Mezclar" }],
  ...over,
});

const build = (content: OeContent, extra: Partial<Parameters<typeof buildAutoPreparedOe>[0]> = {}) =>
  buildAutoPreparedOe({
    content,
    work: work(),
    formula: formulaOk(),
    actorEmail: "produccion@x",
    reason: "test",
    now: "2026-10-13T10:00:00.000Z",
    ...extra,
  });

/** Simula al elaborador escribiendo lotes en la tabla (por código). */
const withLots = (c: OeContent, lots: Record<string, string>): OeContent => ({
  ...c,
  materials: c.materials.map((m) => (lots[m.codigo] ? { ...m, lote: lots[m.codigo] } : m)),
});

describe("buildAutoPreparedOe", () => {
  it("fórmula completa: encabezado del trabajo, % de la fórmula, kg calculados y lotes de MP VACÍOS (los completa Elaboración)", () => {
    const r = build(blank());
    const c = r.content;
    expect(c.header).toMatchObject({ productName: "Crema X", client: "Cliente A", quantityKg: 150, lot: "L-2610-01", code: "PT-100" });
    expect(c.materials.map((m) => [m.materiaPrima, m.formulaPct, m.kgAPesar, m.lote])).toEqual([
      ["Agua", 80, 120, ""],
      ["Glicerina", 12.5, 18.75, ""],
      ["Perfume", 7.5, 11.25, ""],
    ]);
    expect(c.totals.kgSum).toBe(150);
    expect(c.procedureSteps).toEqual([{ id: "step-0", text: "Mezclar" }]);
    expect(c.autoPrep?.formula).toMatchObject({ status: "ok", source: "DRIVE", versionHash: "h1", driveFileId: "abc" });
    expect(c.autoPrep?.pendientes).toEqual([]);
    expect(r.formulaColumns).toEqual({ kind: "set", formulaProductId: "drive:abc", formulaVersionId: "drive:abc:1234", versionHash: "h1" });
    expect(r.changed).toBe(true);
  });

  it("reintento idéntico: no cambia nada (no hay que guardar ni auditar)", () => {
    const first = build(blank());
    const again = build(first.content, { now: "2026-10-13T11:00:00.000Z", actorEmail: "otro@x" });
    expect(again.changed).toBe(false);
  });

  it("reintento después de guardar en Postgres (jsonb reordena las claves): sigue sin cambios", () => {
    const first = build(blank());
    const reorder = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reorder)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder((v as Record<string, unknown>)[k])]))
          : v;
    const fromDb = reorder(JSON.parse(JSON.stringify(first.content))) as OeContent;
    expect(build(fromDb).changed).toBe(false);
  });

  it("sin fórmula: no inventa MP ni %, queda pendiente con el motivo", () => {
    const r = build(blank(), { formula: { ok: false, status: "not_found", message: "No hay fórmula para «Crema X»." } });
    expect(r.content.materials).toEqual([]);
    expect(r.content.autoPrep?.formula.status).toBe("not_found");
    expect(r.content.autoPrep?.pendientes).toContain("Fórmula: No hay fórmula para «Crema X».");
    expect(r.formulaColumns.kind).toBe("keep");
    // El encabezado igual llega listo.
    expect(r.content.header).toMatchObject({ quantityKg: 150, lot: "L-2610-01" });
  });

  it("fórmula ambigua o ilegible: no elige ninguna", () => {
    for (const status of ["ambiguous", "incomplete", "error", "conflict"] as const) {
      const r = build(blank(), { formula: { ok: false, status, message: `motivo ${status}` } });
      expect(r.content.materials).toEqual([]);
      expect(r.content.autoPrep?.formula.status).toBe(status);
      expect(r.content.autoPrep?.pendientes.some((p) => p.includes(`motivo ${status}`))).toBe(true);
    }
  });

  it("fórmula con muchas MP y la misma MP en dos fases: filas separadas, ids estables", () => {
    const f = formulaOk({
      materials: [
        { materiaPrima: "Agua", codigo: "MP-1", formulaPct: 40 },
        { materiaPrima: "Carbopol", codigo: "MP-9", formulaPct: 0.5 },
        { materiaPrima: "Agua", codigo: "MP-1", formulaPct: 40 },
        { materiaPrima: "Glicerina", codigo: "MP-2", formulaPct: 12 },
        { materiaPrima: "Perfume", codigo: "MP-3", formulaPct: 7.5 },
      ],
    });
    const r = build(blank(), { formula: f });
    expect(r.content.materials).toHaveLength(5);
    expect(r.content.materials.map((m) => m.kgAPesar)).toEqual([60, 0.75, 60, 18, 11.25]);
    const again = build(r.content, { formula: f });
    expect(again.changed).toBe(false);
    expect(again.content.materials.map((m) => m.id)).toEqual(r.content.materials.map((m) => m.id));
  });

  it("precisión: 4 decimales en kg a pesar, sin redondear el %", () => {
    const f = formulaOk({ materials: [{ materiaPrima: "A", codigo: "1", formulaPct: 33.3333 }, { materiaPrima: "B", codigo: "2", formulaPct: 66.6667 }] });
    const r = build(blank(), { formula: f, work: work({ plannedQuantity: "1,5" }) });
    expect(r.content.header.quantityKg).toBe(1.5);
    expect(r.content.materials.map((m) => [m.formulaPct, m.kgAPesar])).toEqual([[33.3333, 0.5], [66.6667, 1]]);
  });

  it("cantidad en unidades (no kg): no convierte, queda pendiente", () => {
    const r = build(blank(), { work: work({ unit: "un.", plannedQuantity: "1000" }) });
    expect(r.content.header.quantityKg).toBeNull();
    expect(r.content.materials.every((m) => m.kgAPesar == null)).toBe(true);
    expect(r.content.autoPrep?.quantity.status).toBe("pendiente");
  });

  it("sin lote de fabricación en el trabajo: lote vacío y pendiente; con lote se copia exacto", () => {
    const r = build(blank(), { work: work({ packagingLote: null }) });
    expect(r.content.header.lot).toBe("");
    expect(r.content.autoPrep?.lotFabricacion.status).toBe("pendiente");
    const exact = build(blank(), { work: work({ packagingLote: "lt 26/10-A" }) });
    expect(exact.content.header.lot).toBe("lt 26/10-A");
  });

  it("cambio de cantidad antes de empezar: recalcula kg y conserva los lotes que cargó el elaborador", () => {
    const first = withLots(build(blank()).content, { "MP-1": "A-1", "MP-3": "P-3" });
    const r = build(first, { work: work({ plannedQuantity: "200", version: 2 }) });
    expect(r.changed).toBe(true);
    expect(r.content.materials.map((m) => [m.kgAPesar, m.lote])).toEqual([[160, "A-1"], [25, ""], [15, "P-3"]]);
  });

  it("cambio de producto sin fórmula para el nuevo: quita las MP de la fórmula anterior y vacía la referencia", () => {
    const first = build(blank());
    const r = build(first.content, {
      work: work({ product: "Gel Y" }),
      formula: { ok: false, status: "not_found", message: "No hay fórmula para «Gel Y»." },
    });
    expect(r.content.materials).toEqual([]);
    expect(r.formulaColumns).toEqual({ kind: "clear" });
    expect(r.content.header.productName).toBe("Gel Y");
  });

  it("mismo producto y Drive caído: mantiene la fórmula ya cargada", () => {
    const first = build(blank());
    const r = build(first.content, { formula: { ok: false, status: "error", message: "No se pudo leer Drive." } });
    expect(r.content.materials).toHaveLength(3);
    expect(r.content.autoPrep?.formula.status).toBe("ok");
    expect(r.formulaColumns.kind).toBe("keep");
  });

  it("OE ya preparada y aparece OTRA versión de la fórmula del mismo producto: no se reemplaza sin la acción explícita", () => {
    const first = build(blank());
    const otherVersion = formulaOk({
      ref: { ...(formulaOk() as Extract<WorkFormulaResolution, { ok: true }>).ref, versionHash: "h2", formulaVersionId: "drive:abc:9999" },
      materials: [
        { materiaPrima: "Agua", codigo: "MP-1", formulaPct: 70 },
        { materiaPrima: "Aceite", codigo: "MP-9", formulaPct: 30 },
      ],
    });
    const auto = build(first.content, { formula: otherVersion, work: work({ plannedQuantity: "200", version: 2 }) });
    expect(auto.content.materials.map((m) => m.codigo)).toEqual(["MP-1", "MP-2", "MP-3"]);
    expect(auto.content.autoPrep?.formula.versionHash).toBe("h1");
    expect(auto.content.autoPrep?.formula.message).toMatch(/Se mantiene la fórmula ya cargada/);
    expect(auto.formulaColumns.kind).toBe("keep");
    const explicit = build(first.content, { formula: otherVersion, replaceManual: true });
    expect(explicit.content.materials.map((m) => m.codigo)).toEqual(["MP-1", "MP-9"]);
    expect(explicit.content.autoPrep?.formula.versionHash).toBe("h2");
  });

  it("MP cargadas a mano: no se reemplazan sin confirmación; con confirmación sí, conservando lotes escritos", () => {
    const manual = blank();
    manual.materials = [{ ...build(blank()).content.materials[0], materiaPrima: "Agua", codigo: "MP-1", formulaPct: 79, lote: "MANUAL-1" }];
    const keep = build(manual);
    expect(keep.content.materials).toHaveLength(1);
    expect(keep.content.materials[0].formulaPct).toBe(79);
    expect(keep.content.autoPrep?.formula.status).toBe("manual_content");
    expect(keep.formulaColumns.kind).toBe("keep");
    const replaced = build(manual, { replaceManual: true });
    expect(replaced.content.materials).toHaveLength(3);
    expect(replaced.content.materials[0].lote).toBe("MANUAL-1");
  });

  it("lotes del elaborador: nunca se pisan ni se agregan solos; se conservan por código al recargar la fórmula", () => {
    const first = withLots(build(blank()).content, { "MP-1": "AG-1", "MP-2": "GL-2" });
    const again = build(first);
    expect(again.changed).toBe(false);
    // Fórmula nueva con las MP reordenadas y una MP nueva: los lotes siguen a su código; la nueva queda vacía.
    const f2 = formulaOk({
      materials: [
        { materiaPrima: "Glicerina", codigo: "MP-2", formulaPct: 10 },
        { materiaPrima: "Agua", codigo: "MP-1", formulaPct: 80 },
        { materiaPrima: "Perfume", codigo: "MP-3", formulaPct: 7.5 },
        { materiaPrima: "Conservante", codigo: "MP-9", formulaPct: 2.5 },
      ],
    });
    const r = build(first, { formula: f2 });
    expect(r.content.materials.map((m) => [m.codigo, m.lote])).toEqual([["MP-2", "GL-2"], ["MP-1", "AG-1"], ["MP-3", ""], ["MP-9", ""]]);
    expect(r.lostRecords).toEqual([]);
  });

  it("si la fórmula nueva ya no tiene una MP con lote del elaborador: lo informa (no se borra sin confirmar)", () => {
    const first = withLots(build(blank()).content, { "MP-2": "GL-2" });
    const f2 = formulaOk({ materials: [{ materiaPrima: "Agua", codigo: "MP-1", formulaPct: 92.5 }, { materiaPrima: "Perfume", codigo: "MP-3", formulaPct: 7.5 }] });
    const r = build(first, { formula: f2 });
    expect(r.lostRecords).toEqual([{ materiaPrima: "Glicerina", codigo: "MP-2", lote: "GL-2", ajuste: null, kgReal: null }]);
  });

  it("cambio de producto sin fórmula: si hay lotes del elaborador, también se informan antes de quitarlos", () => {
    const first = withLots(build(blank()).content, { "MP-1": "AG-1" });
    const r = build(first, { work: work({ product: "Gel Y" }), formula: { ok: false, status: "not_found", message: "No hay." } });
    expect(r.lostRecords.map((l) => l.lote)).toEqual(["AG-1"]);
  });

  it("actualización confirmada después de empezar: conserva los KG REALES registrados y avisa si se perderían", () => {
    const first = build(blank());
    const started = structuredClone(first.content);
    started.materials[1].kgReal = 12.7;
    started.materials[1].ajusteMotivo = "Corrección de pesada";
    const kept = build(started, { replaceManual: true, work: work({ plannedQuantity: "100" }) });
    expect(kept.lostRecords).toEqual([]);
    // Los kg reales NO se recalculan con la cantidad nueva; la diferencia (ajuste) sí se deriva.
    expect(kept.content.materials[1]).toMatchObject({ kgReal: 12.7, ajusteMotivo: "Corrección de pesada", kgAPesar: 12.5 });
    expect(kept.content.materials[1].ajuste).toBeCloseTo(0.2, 6);
    const lost = build(started, {
      replaceManual: true,
      formula: formulaOk({ materials: [{ materiaPrima: "Agua", codigo: "MP-1", formulaPct: 100 }] }),
    });
    expect(lost.lostRecords).toMatchObject([{ materiaPrima: "Glicerina", codigo: "MP-2", lote: "", kgReal: 12.7 }]);
  });
});

describe("oeProcesoIniciado", () => {
  it("BORRADOR/PENDIENTE sin registros: no empezó", () => {
    expect(oeProcesoIniciado("BORRADOR", blank()).started).toBe(false);
    expect(oeProcesoIniciado("PENDIENTE", blank()).started).toBe(false);
  });
  it("EN_PROCESO, entregada o con registros del proceso: empezó", () => {
    expect(oeProcesoIniciado("EN_PROCESO", blank()).started).toBe(true);
    expect(oeProcesoIniciado("COMPLETA", blank()).started).toBe(true);
    const withAjuste = build(blank()).content;
    withAjuste.materials[0].ajusteMotivo = "x";
    expect(oeProcesoIniciado("BORRADOR", withAjuste).started).toBe(true);
    const withPc = blank();
    withPc.processControl.ph = "5,5";
    expect(oeProcesoIniciado("BORRADOR", withPc).started).toBe(true);
    const withQc = blank();
    withQc.qualityControl.resultado = "OK";
    expect(oeProcesoIniciado("PENDIENTE", withQc).started).toBe(true);
  });
  it("los valores de especificación precargados no cuentan como inicio", () => {
    const c = blank();
    expect(c.processControl.aspectoSpec).not.toBe("");
    expect(oeProcesoIniciado("BORRADOR", c).started).toBe(false);
  });
});

describe("workQuantityKg", () => {
  it("acepta coma decimal y solo kg", () => {
    expect(workQuantityKg("1.234,5", "kg").kg).toBe(1234.5);
    expect(workQuantityKg("150", "KG").kg).toBe(150);
    expect(workQuantityKg("150", "un.").kg).toBeNull();
    expect(workQuantityKg("", "kg").kg).toBeNull();
    expect(workQuantityKg("abc", "kg").kg).toBeNull();
  });
});
