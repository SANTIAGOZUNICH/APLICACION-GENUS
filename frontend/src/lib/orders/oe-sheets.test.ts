import { describe, expect, it } from "vitest";
import { createEmptyOeContent, emptyOeMaterial, recomputeOeDerived } from "./content";
import { buildOeConsumptionPlan } from "./oe-mp-consumption";
import { consumptionMaterials, createSheet, mergeSheets, recomputeSheet, summarizeSheets } from "./oe-sheets";
import { buildSheetsPrintHtml } from "./oe-sheets-print";
import type { OeContent } from "./types";

const LONG = "Sodium Hyaluronate Crosspolymer-2 / Complejo de ácido hialurónico de bajo y alto peso molecular con péptidos biomiméticos";
function oe(): OeContent {
  const base = createEmptyOeContent({ productName: "Crema X", code: "OE-1", client: "Cliente", quantityKg: 1000 });
  return recomputeOeDerived({
    ...base,
    materials: [
      emptyOeMaterial({ id: "r1", materiaPrima: "Agua", codigo: "A1", codigoMp: "MP-AGUA", formulaPct: 70 }),
      emptyOeMaterial({ id: "r2", materiaPrima: "Glicerina", codigo: "G1", codigoMp: "MP-GLI", formulaPct: 5 }),
      emptyOeMaterial({ id: "r3", materiaPrima: LONG, codigo: "E1", codigoMp: "MP-EMU", formulaPct: 4 }),
    ],
  });
}
const kgs = (s: { materials: { kgAPesar: number | null }[] }) => s.materials.map((m) => m.kgAPesar);

describe("hojas de elaboración dentro de una OE", () => {
  it("crea hojas de 200 y 180 kg con la fórmula real y cantidades teóricas por porcentaje", () => {
    const c = oe();
    const a = createSheet(c, { kind: "tambor", kg: 200, by: "e@x" });
    const b = createSheet({ ...c, sheets: [a] }, { kind: "tambor", kg: 180, by: "e@x" });
    expect(kgs(a)).toEqual([140, 10, 8]);
    expect(kgs(b)).toEqual([126, 9, 7.2]);
    expect(a.number).toBe("1");
    expect(b.number).toBe("2");
    expect(a.id).not.toBe(b.id);
    // fórmula copiada; datos reales NO copiados
    expect(a.materials.map((m) => m.materiaPrima)).toEqual(["Agua", "Glicerina", LONG]);
    expect(a.materials.every((m) => m.lote === "" && m.kgReal == null && m.ajusteBy == null)).toBe(true);
    expect(a.status).toBe("pendiente");
  });

  it("no copia lotes/kg reales de la OE principal a una hoja nueva", () => {
    const c = oe();
    c.materials[0] = { ...c.materials[0]!, lote: "L-9", kgReal: 99 };
    const s = createSheet(c, { kind: "olla", kg: 100, by: "e@x" });
    expect(s.materials[0]!.lote).toBe("");
    expect(s.materials[0]!.kgReal).toBeNull();
  });

  it("recalcula los teóricos al cambiar los kg sin pisar lo real", () => {
    const c = oe();
    let s = createSheet(c, { kind: "tambor", kg: 200, by: "e@x" });
    s = { ...s, materials: s.materials.map((m, i) => (i === 0 ? { ...m, kgReal: 141, lote: "L1" } : m)) };
    s = recomputeSheet(c, { ...s, kgPlanificados: 180 });
    expect(s.materials[0]).toMatchObject({ kgAPesar: 126, kgReal: 141, lote: "L1", ajuste: 15 });
  });

  it("el servidor reconstruye la fórmula: nadie inventa ingredientes ni porcentajes; solo datos operativos", () => {
    const c = oe();
    const s = createSheet(c, { kind: "tambor", kg: 200, by: "e@x" });
    const hacked = {
      ...s,
      materials: [
        { ...s.materials[0]!, formulaPct: 99, materiaPrima: "OTRA", lote: "L-A", kgReal: 141 },
        ...s.materials.slice(1),
        emptyOeMaterial({ id: "inventada", materiaPrima: "Oro", formulaPct: 10 }),
      ],
    };
    const [out] = mergeSheets(c, [hacked], "e@x")!;
    expect(out!.materials).toHaveLength(3);
    expect(out!.materials[0]).toMatchObject({ materiaPrima: "Agua", formulaPct: 70, kgAPesar: 140, lote: "L-A", kgReal: 141 });
    expect(out!.materials.some((m) => m.materiaPrima === "Oro")).toBe(false);
  });

  it("dos lotes de la misma MP dentro de una hoja; editar una hoja no toca las otras; historial", () => {
    const c0 = oe();
    const s1 = createSheet(c0, { kind: "tambor", kg: 200, by: "e@x" });
    const s2 = createSheet({ ...c0, sheets: [s1] }, { kind: "tambor", kg: 180, by: "e@x" });
    const c = { ...c0, sheets: [s1, s2] };
    const agua = s1.materials[0]!;
    const edited = {
      ...s1,
      materials: [
        { ...agua, kgReal: 100, lote: "LOTE-A" },
        emptyOeMaterial({ id: "child1", parentRowId: agua.id, kgReal: 41, lote: "LOTE-B" }),
        ...s1.materials.slice(1),
      ],
      status: "elaborado" as const,
      kgElaborados: 200,
    };
    const out = mergeSheets(c, [edited, s2], "e@x")!;
    const w1 = out[0]!.materials;
    expect(w1.filter((m) => m.materiaPrima === "Agua").map((m) => [m.lote, m.kgReal])).toEqual([["LOTE-A", 100], ["LOTE-B", 41]]);
    expect(out[1]).toEqual(s2); // la otra hoja no cambió
    expect(out[0]!.history.at(-1)!.text).toMatch(/Estado: Pendiente → Elaborado/);
  });

  it("hojas con datos reales no se pueden quitar por un cliente", () => {
    const c0 = oe();
    const s = createSheet(c0, { kind: "tambor", kg: 100, by: "e@x" });
    const withData = { ...s, materials: s.materials.map((m, i) => (i === 0 ? { ...m, kgReal: 70, lote: "L" } : m)) };
    const out = mergeSheets({ ...c0, sheets: [withData] }, [], "e@x")!;
    expect(out).toHaveLength(1);
    expect(mergeSheets({ ...c0, sheets: [s] }, [], "e@x")).toHaveLength(0); // vacía: sí
  });

  it("resumen: planificado vs elaborado, pendiente, exceso y consolidación de MP por lote", () => {
    const c0 = oe();
    let sheets = [] as NonNullable<OeContent["sheets"]>;
    [200, 180, 200, 200, 220].forEach((kg, i) => {
      const s = createSheet({ ...c0, sheets }, { kind: "tambor", kg, by: "e@x" });
      sheets = [...sheets, i < 3 ? { ...s, status: "elaborado", kgElaborados: kg, materials: s.materials.map((m, j) => (j === 0 ? { ...m, kgReal: kg * 0.7, lote: i === 1 ? "L-B" : "L-A" } : m)) } : s];
    });
    const sm = summarizeSheets({ ...c0, sheets });
    expect(sm).toMatchObject({ requestedKg: 1000, plannedKg: 1000, elaboratedKg: 580, pendingKg: 420, exceedsKg: 0, count: 5 });
    const agua = sm.consolidated.find((e) => e.materiaPrima === "Agua")!;
    expect(agua.kgReal).toBeCloseTo(0.7 * 580, 3);
    expect(agua.lots).toEqual([{ lote: "L-A", kg: 280 }, { lote: "L-B", kg: 126 }]);
    expect(summarizeSheets({ ...c0, header: { ...c0.header, quantityKg: 900 }, sheets }).exceedsKg).toBe(100);
  });

  it("consumo: una sola fuente de verdad (hojas), sin duplicar con la hoja principal", () => {
    const c0 = oe();
    const mk = (kg: number, lote: string) => {
      const s = createSheet(c0, { kind: "tambor", kg, by: "e@x" });
      return { ...s, status: "elaborado" as const, materials: s.materials.map((m, j) => (j === 0 ? { ...m, kgReal: kg * 0.7, lote } : m)) };
    };
    const pend = createSheet(c0, { kind: "tambor", kg: 50, by: "e@x" });
    const c: OeContent = { ...c0, sheets: [mk(200, "L1"), mk(180, "L1"), pend] };
    const rows = consumptionMaterials(c);
    // las filas de la principal (sin datos) y la hoja pendiente sin datos no cuentan
    expect(rows.every((m) => !m.id.startsWith("r") || m.id.includes(":"))).toBe(true);
    const plan = buildOeConsumptionPlan(rows.filter((m) => m.kgReal != null), [{ id: "x", codigo: "MP-AGUA", descripcion: "Agua", lote: "L1", cantidadKg: 1000 }]);
    expect(plan.issues).toEqual([]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.kg).toBeCloseTo(266, 3); // (200+180)*0.7, UNA vez
    // sin hojas: comportamiento histórico idéntico
    expect(consumptionMaterials(c0)).toBe(c0.materials);
    // OE histórica con datos reales en la principal + hojas: ambos cuentan (no se pierde nada)
    const hist = { ...c, materials: c0.materials.map((m, i) => (i === 0 ? { ...m, kgReal: 5, lote: "L0" } : m)) };
    expect(consumptionMaterials(hist).some((m) => m.id === "r1")).toBe(true);
  });

  it("impresión: la descripción larga sale completa (sin cortar) y se identifica OE, hoja y totales", () => {
    const c0 = oe();
    const c = { ...c0, sheets: [createSheet(c0, { kind: "tambor", kg: 200, by: "e@x" })] };
    const html = buildSheetsPrintHtml(c, "all");
    expect(html).toContain(LONG);
    expect(html).toContain("OE OE-1");
    expect(html).toContain("Tambor 1");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).not.toContain("ellipsis");
    expect(buildSheetsPrintHtml(c, { sheetId: c.sheets![0]!.id })).not.toContain("RESUMEN GENERAL");
    expect(buildSheetsPrintHtml(c, "summary")).toContain("RESUMEN GENERAL");
  });
});
