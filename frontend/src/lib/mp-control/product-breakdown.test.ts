import { describe, expect, it } from "vitest";
import { computeAvailability, type ProductionInput, type StockLot } from "./availability";
import { statusLabel, toneOfNumbers, toneOfStatus, valueClass } from "./availability-tone";
import { buildProductBreakdown, matchesProductFilter } from "./product-breakdown";
import { exclusionVerdict } from "./weekly-availability-service";

const TODAY = "2026-10-20";
const lot = (descripcion: string, kg: number, extra: Partial<StockLot> = {}): StockLot => ({ id: `${descripcion}-${kg}-${Math.random()}`, codigo: `C-${descripcion.slice(0, 3).toUpperCase()}`, descripcion, proveedor: "Prov", lote: "L1", cantidadKg: kg, vencimiento: "2030-01-01", ...extra });
const prod = (id: string, client: string, product: string, days: string, kg: number, lines: Array<[string, number]>, extra: Partial<ProductionInput> = {}): ProductionInput => ({
  id, client, product, label: `${client} — ${product}`, oeNumber: `OE-${id}`, days, weekKg: kg, source: "OE", reliable: true,
  lines: lines.map(([materiaPrima, pct]) => ({ materiaPrima, codigo: "", pct, kg: Math.round(((pct * kg) / 100) * 1000) / 1000 })), ...extra,
});
const run = (lots: StockLot[], productions: ProductionInput[]) => {
  const res = computeAvailability({ lots, productions, todayIso: TODAY });
  return { res, ...buildProductBreakdown({ rows: res.rows, productions }) };
};
const line = (s: ReturnType<typeof run>["sections"][number], name: string) => s.lines.find((l) => l.materiaPrima.toLowerCase().startsWith(name.toLowerCase()))!;

describe("semáforo", () => {
  it("verde / amarillo / rojo / gris con texto", () => {
    expect(toneOfNumbers({ need: 12.4, usable: 28.01 })).toBe("ok");
    expect(toneOfNumbers({ need: 15.5, usable: 6.35 })).toBe("partial");
    expect(toneOfNumbers({ need: 124, usable: 0 })).toBe("none");
    expect(toneOfNumbers({ need: 5, usable: null })).toBe("unknown");
    expect(toneOfNumbers({ need: 5, usable: 0, identified: false })).toBe("unknown");
    expect(toneOfStatus("MP NO IDENTIFICADA")).toBe("unknown");
    expect(statusLabel("FALTANTE")).toBe("FALTANTE PARCIAL");
    expect(statusLabel("MP NO IDENTIFICADA")).toBe("NO IDENTIFICADA");
  });
  it("un valor negativo siempre se destaca", () => {
    expect(valueClass("ok", -3)).toContain("font-bold");
    expect(valueClass("ok", 3)).not.toContain("font-bold");
  });
});

describe("control semanal por producto", () => {
  it("1) fórmula con todas las MP suficientes → CUBIERTA, verde, +diferencia", () => {
    const { sections } = run([lot("Agua", 500), lot("Glicerina", 28.01)], [prod("1", "THELMA", "PROTECTOR SOLAR", "2026-10-19", 124, [["Agua", 90], ["Glicerina", 10]])]);
    const s = sections[0]!;
    expect(s.overall).toBe("CUBIERTA");
    expect(s.counts).toMatchObject({ ok: 2, partial: 0, none: 0, unknown: 0 });
    expect(line(s, "Glicerina").diferencia).toBeCloseTo(28.01 - 12.4, 3);
    expect(line(s, "Glicerina").tone).toBe("ok");
    expect(s.lines).toHaveLength(2); // la fórmula COMPLETA
  });
  it("2) faltante parcial: necesario 15,5 / disponible 6,35 → faltan 9,15 (amarillo)", () => {
    const { sections } = run([lot("Glicerina", 6.35)], [prod("1", "A", "P", "2026-10-19", 155, [["Glicerina", 10]])]);
    const l = line(sections[0]!, "Glicerina");
    expect(l.tone).toBe("partial");
    expect(l.diferencia).toBeCloseTo(-9.15, 3);
    expect(sections[0]!.overall).toBe("CON_FALTANTES");
  });
  it("3) sin stock: necesario 124 / disponible 0 → rojo", () => {
    const { sections } = run([lot("Agua", 0)], [prod("1", "A", "P", "2026-10-19", 124, [["Agua", 100]])]);
    const s = sections[0]!;
    expect(line(s, "Agua").tone).toBe("none");
    expect(line(s, "Agua").diferencia).toBe(-124);
    expect(s.overall).toBe("SIN_STOCK");
    expect(matchesProductFilter(s, "SIN_STOCK")).toBe(true);
    expect(matchesProductFilter(s, "SUFICIENTES")).toBe(false);
  });
  it("4) MP no identificada → gris, nunca stock cero", () => {
    const { sections, summary } = run([lot("Agua", 500)], [prod("1", "A", "P", "2026-10-19", 100, [["Agua", 60], ["Extracto raro", 40]])]);
    const l = line(sections[0]!, "Extracto");
    expect(l.tone).toBe("unknown");
    expect(l.rowEstado).toBe("MP NO IDENTIFICADA");
    expect(l.diferencia).toBeNull();
    expect(sections[0]!.overall).toBe("DATOS_INCOMPLETOS");
    expect(summary.mpUnidentified).toBe(1);
    expect(matchesProductFilter(sections[0]!, "DATOS_INCOMPLETOS")).toBe(true);
  });
  it("5) dos productos con la misma MP: el stock es compartido y se asigna por orden de fecha", () => {
    const { sections, res } = run([lot("Glicerina", 15)], [
      prod("1", "A", "PRIMERO", "2026-10-19", 100, [["Glicerina", 10]]), // necesita 10
      prod("2", "B", "SEGUNDO", "2026-10-21", 100, [["Glicerina", 10]]), // necesita 10 (solo quedan 5)
    ]);
    expect(res.rows[0]!.requerido).toBe(20);
    const [a, b] = sections;
    expect(a!.product).toBe("PRIMERO");
    expect(line(a!, "Glicerina")).toMatchObject({ tone: "ok", shared: true, allocatedKg: 10 });
    expect(line(b!, "Glicerina")).toMatchObject({ tone: "partial", shared: true, allocatedKg: 5 });
    expect(line(b!, "Glicerina").diferencia).toBe(-5);
    // No se muestran las dos «totalmente cubiertas» con los mismos kilos.
    expect([a!.overall, b!.overall]).toEqual(["CUBIERTA", "CON_FALTANTES"]);
    expect(line(a!, "Glicerina").note).toMatch(/no alcanza para todos/);
    expect(line(a!, "Glicerina").sharedWith).toEqual(["B — SEGUNDO"]);
    expect(line(a!, "Glicerina").saldoProyectado).toBe(-5);
  });
  it("6) varias OE del mismo producto con la misma fórmula → una sección con las órdenes y el total; fórmulas distintas → secciones separadas", () => {
    const f1: Array<[string, number]> = [["Agua", 80], ["Glicerina", 20]];
    const { sections } = run([lot("Agua", 900), lot("Glicerina", 100)], [
      prod("1", "A", "SHAMPOO", "2026-10-19", 100, f1),
      prod("2", "A", "SHAMPOO", "2026-10-22", 50, f1),
      prod("3", "A", "SHAMPOO", "2026-10-23", 40, [["Agua", 70], ["Glicerina", 30]]), // otra versión de la fórmula
    ]);
    expect(sections).toHaveLength(2);
    const merged = sections.find((s) => s.oes.length === 2)!;
    expect(merged.totalKg).toBe(150);
    expect(merged.oes.map((o) => o.oeNumber)).toEqual(["OE-1", "OE-2"]);
    expect(line(merged, "Agua").needKg).toBe(120);
    expect(merged.versionNote).toMatch(/DISTINTA/);
    expect(sections.find((s) => s.oes.length === 1)!.versionNote).toMatch(/no se fusionaron/);
  });
  it("7) el reparto de una OE entre semanas llega como cantidad de ESTA semana (no se duplica)", () => {
    // El servicio entrega weekKg ya repartido; la sección usa exactamente esa cantidad.
    const { sections } = run([lot("Agua", 500)], [prod("1", "A", "P", "2026-10-19 → 2026-10-26", 60, [["Agua", 100]], { note: "Orden repartida: esta semana corresponde el 60 %." })]);
    expect(sections[0]!.totalKg).toBe(60);
    expect(line(sections[0]!, "Agua").needKg).toBe(60);
    expect(sections[0]!.oes[0]!.note).toMatch(/60 %/);
  });
  it("stock reservado a otro cliente no cuenta para este producto", () => {
    const { sections } = run([lot("Glicerina", 50, { cliente: "OTRO CLIENTE" })], [prod("1", "A", "P", "2026-10-19", 100, [["Glicerina", 10]])]);
    expect(line(sections[0]!, "Glicerina").tone).toBe("none");
  });
  it("producción sin cantidad confiable → DATOS INCOMPLETOS", () => {
    const { sections } = run([lot("Agua", 50)], [prod("1", "A", "P", "2026-10-19", 0, [["Agua", 100]], { reliable: false, unreliableReason: "Cantidad no válida" })]);
    expect(sections[0]!.overall).toBe("DATOS_INCOMPLETOS");
    expect(sections[0]!.notes[0]).toMatch(/Cantidad no válida/);
  });
});

describe("exclusiones con alcance", () => {
  it("sigue oculta si nada cambió", () => {
    expect(exclusionVerdict({ knownProductionIds: ["a", "b"], requeridoAtExclusion: 10, currentProductionIds: ["a"], requeridoNow: 10 }).toReview).toBe(false);
  });
  it("una producción nueva la vuelve a mostrar", () => {
    const v = exclusionVerdict({ knownProductionIds: ["a"], requeridoAtExclusion: 10, currentProductionIds: ["a", "z"], requeridoNow: 25 });
    expect(v.toReview).toBe(true);
    expect(v.reason).toMatch(/nueva/);
  });
  it("una necesidad que creció (misma producción) la vuelve a mostrar", () => {
    const v = exclusionVerdict({ knownProductionIds: ["a"], requeridoAtExclusion: 10, currentProductionIds: ["a"], requeridoNow: 14 });
    expect(v.toReview).toBe(true);
    expect(v.reason).toMatch(/creció/);
  });
  it("una exclusión vieja sin alcance guardado nunca oculta nada", () => {
    expect(exclusionVerdict({ knownProductionIds: [], requeridoAtExclusion: null, currentProductionIds: ["a"], requeridoNow: 3 }).toReview).toBe(true);
  });
});
