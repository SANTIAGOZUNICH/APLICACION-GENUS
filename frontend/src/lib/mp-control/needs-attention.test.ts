import { describe, expect, it } from "vitest";
import { computeAvailability, type ProductionInput, type StockLot } from "./availability";
import { buildProductBreakdown } from "./product-breakdown";
import { attentionDiff, buildNeedsAttention, filterAttention } from "./needs-attention";

const TODAY = "2026-10-20";
const lot = (descripcion: string, kg: number, extra: Partial<StockLot> = {}): StockLot => ({ id: `${descripcion}-${kg}`, codigo: `C-${descripcion.slice(0, 3).toUpperCase()}`, descripcion, proveedor: "Prov", lote: "L1", cantidadKg: kg, vencimiento: "2030-01-01", ...extra });
const prod = (id: string, client: string, product: string, days: string, kg: number, lines: Array<[string, number]>): ProductionInput => ({
  id, client, product, label: `${client} — ${product}`, oeNumber: `OE-${id}`, days, weekKg: kg, source: "OE", reliable: true,
  lines: lines.map(([materiaPrima, pct]) => ({ materiaPrima, codigo: "", pct, kg: Math.round(((pct * kg) / 100) * 1000) / 1000 })),
});
const run = (lots: StockLot[], productions: ProductionInput[], excluded: string[] = []) => {
  const res = computeAvailability({ lots, productions, todayIso: TODAY });
  const { sections } = buildProductBreakdown({ rows: res.rows, productions });
  const rows = res.rows.map((r) => ({ ...r, state: { excluded: excluded.includes(r.key), observacion: "", gestion: "" } }));
  return buildNeedsAttention(rows, sections);
};

describe("materias primas a resolver", () => {
  it("solo aparecen las que necesitan atención; las suficientes no", () => {
    const out = run([lot("Agua", 500), lot("Betaina", 6.35)], [prod("1", "AGUEDA REY", "SHAMPOO CONTROL SEBO", "2026-10-19", 155, [["Agua", 50], ["Betaina", 10], ["Etoxilado 25", 80]])]);
    expect(out.items.map((i) => i.materiaPrima.toLowerCase()).sort()).toEqual(["betaina", "etoxilado 25"]);
    expect(out.items.find((i) => /agua/i.test(i.materiaPrima))).toBeUndefined();
  });
  it("sin stock = rojo, insuficiente = amarillo, con cantidades del ejemplo", () => {
    const out = run([lot("Betaina", 6.35)], [prod("1", "AGUEDA REY", "SHAMPOO CONTROL SEBO", "2026-10-19", 155, [["Betaina", 10], ["Etoxilado 25", 80]])]);
    const be = out.items.find((i) => /betaina/i.test(i.materiaPrima))!;
    expect(be.status).toBe("INSUFICIENTE");
    expect(be.necesidadTotal).toBeCloseTo(15.5, 3);
    expect(be.stockUtilizable).toBeCloseTo(6.35, 3);
    expect(be.faltanteTotal).toBeCloseTo(9.15, 3);
    expect(be.productos[0]).toMatchObject({ client: "AGUEDA REY", product: "SHAMPOO CONTROL SEBO", oes: ["OE-1"] });
    const et = out.items.find((i) => /etoxilado/i.test(i.materiaPrima))!;
    expect(et.status).toBe("SIN_DATOS"); // no existe en el inventario: no identificada, NO stock cero
    expect(out.summary).toMatchObject({ sinStock: 0, insuficientes: 1, sinDatos: 1, total: 2 });
  });
  it("ETOXILADO 25: en el inventario con 0 kg = SIN STOCK (rojo, falta todo); sin estar en el inventario = SIN DATOS (gris), nunca mezclados", () => {
    const productions = [prod("1", "AGUEDA REY", "SHAMPOO CONTROL SEBO", "2026-10-19", 155, [["Etoxilado 25", 80], ["Agua", 5]])];
    const conCero = run([lot("Etoxilado 25", 0), lot("Agua", 10)], productions);
    const e = conCero.items.find((i) => /etoxilado/i.test(i.materiaPrima))!;
    expect(e.status).toBe("SIN_STOCK");
    expect(e.stockUtilizable).toBe(0);
    expect(e.necesidadTotal).toBe(124);
    expect(e.faltanteTotal).toBe(124);
    const sinFila = run([lot("Agua", 10)], productions);
    expect(sinFila.items.find((i) => /etoxilado/i.test(i.materiaPrima))!.status).toBe("SIN_DATOS");
    expect(sinFila.items.find((i) => /etoxilado/i.test(i.materiaPrima))!.faltanteTotal).toBeNull();
  });
  it("stock compartido: 20 kg para dos productos que necesitan 35 → faltante total 15, no se cuenta dos veces", () => {
    const out = run([lot("Glicerina", 20)], [
      prod("A", "Cliente A", "Producto A", "2026-10-19", 100, [["Glicerina", 20]]),
      prod("B", "Cliente B", "Producto B", "2026-10-20", 100, [["Glicerina", 15]]),
    ]);
    const g = out.items.find((i) => /glicerina/i.test(i.materiaPrima))!;
    expect(g.status).toBe("INSUFICIENTE");
    expect(g.stockUtilizable).toBe(20);
    expect(g.necesidadTotal).toBe(35);
    expect(g.faltanteTotal).toBe(15);
    expect(g.compartida).toBe(true);
    const sumFaltantes = g.productos.reduce((s, p) => s + (p.faltanteKg ?? 0), 0);
    expect(sumFaltantes).toBeCloseTo(15, 3); // la suma por producto = el faltante total (sin duplicar)
    expect(g.productos.filter((p) => p.afectado).map((p) => p.product)).toEqual(["Producto B"]);
    expect(g.productos.map((p) => p.product).sort()).toEqual(["Producto A", "Producto B"]); // conserva el detalle de cada producto
  });
  it("las MP quitadas del control no aparecen", () => {
    const base = run([lot("Betaina", 6.35)], [prod("1", "A", "P", "2026-10-19", 155, [["Betaina", 10]])]);
    const key = base.items[0]!.rowKey;
    expect(run([lot("Betaina", 6.35)], [prod("1", "A", "P", "2026-10-19", 155, [["Betaina", 10]])], [key]).items).toHaveLength(0);
  });
  it("filtros y comparación guardado vs actual", () => {
    const out = run([lot("Betaina", 6.35)], [prod("1", "A", "P", "2026-10-19", 155, [["Betaina", 10], ["Etoxilado 25", 80]])]);
    expect(filterAttention(out.items, "INSUFICIENTE")).toHaveLength(1);
    expect(filterAttention(out.items, "TODAS")).toHaveLength(2);
    const later = run([lot("Betaina", 40)], [prod("1", "A", "P", "2026-10-19", 155, [["Betaina", 10], ["Etoxilado 25", 80]])]);
    const d = attentionDiff(out.items, later.items);
    expect(d.resolved.length).toBe(1);
  });
});
