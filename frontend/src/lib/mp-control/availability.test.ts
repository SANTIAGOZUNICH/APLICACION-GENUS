import { describe, expect, it } from "vitest";
import { computeAvailability, toKg, type MpLink, type ProductionInput, type StockLot } from "./availability";

const TODAY = "2026-10-19";
let n = 0;
const lot = (p: Partial<StockLot> & Pick<StockLot, "codigo" | "descripcion" | "cantidadKg">): StockLot => ({
  id: `l${++n}`, proveedor: "Prov", lote: `L${n}`, vencimiento: "2027-12-31", estadoStock: "Stock OK", ...p,
});
const prod = (id: string, lines: Array<[string, string, number]>, extra: Partial<ProductionInput> = {}): ProductionInput => ({
  id, label: id, reliable: true, lines: lines.map(([materiaPrima, codigo, kg]) => ({ materiaPrima, codigo, kg })), ...extra,
});
const row = (res: ReturnType<typeof computeAvailability>, name: string) => res.rows.find((r) => r.materiaPrima.toLowerCase().includes(name.toLowerCase()))!;

describe("disponibilidad de MP", () => {
  it("una MP con tres proveedores suma todo bajo el mismo código y alcanza (30 ≥ 25)", () => {
    const lots = [
      lot({ codigo: "GLI", descripcion: "GLICERINA — Proveedor A", proveedor: "Proveedor A", cantidadKg: 10 }),
      lot({ codigo: "GLI", descripcion: "GLICERINA — Proveedor B", proveedor: "Proveedor B", cantidadKg: 8 }),
      lot({ codigo: "GLI", descripcion: "GLICERINA — Proveedor C", proveedor: "Proveedor C", cantidadKg: 12 }),
    ];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P1", [["Glicerina", "F-GLI", 25]])] });
    const g = row(r, "glicerina");
    expect([g.stockFisico, g.stockUtilizable, g.requerido, g.saldoProyectado, g.estado]).toEqual([30, 30, 25, 5, "SUFICIENTE"]);
    expect(g.proveedores.map((p) => p.kgUtilizable).sort()).toEqual([10, 12, 8]);
  });

  it("códigos de inventario distintos con EXACTAMENTE el mismo nombre se suman (misma MP de varios proveedores)", () => {
    const lots = [
      lot({ codigo: "GLI-A", descripcion: "Glicerina — Proveedor A", proveedor: "Proveedor A", cantidadKg: 10 }),
      lot({ codigo: "GLI-B", descripcion: "GLICERINA — Proveedor B", proveedor: "Proveedor B", cantidadKg: 8 }),
      lot({ codigo: "GLI-C", descripcion: "Glicerina - Proveedor C", proveedor: "Proveedor C", cantidadKg: 12 }),
    ];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["Glicerina", "F-GLI", 25]])] });
    expect(r.rows).toHaveLength(1);
    expect([r.rows[0]!.stockUtilizable, r.rows[0]!.saldoProyectado, r.rows[0]!.estado]).toEqual([30, 5, "SUFICIENTE"]);
    expect(r.rows[0]!.notas.join(" ")).toMatch(/3 códigos/);
  });

  it("varios códigos de proveedor con nombres DISTINTOS se unen SOLO con equivalencia aprobada; sin ella queda pendiente", () => {
    const lots = [
      lot({ codigo: "GLI-A", descripcion: "Glicerina Vegetal", cantidadKg: 20 }),
      lot({ codigo: "GLI-B", descripcion: "GLYCERIN", cantidadKg: 15 }),
    ];
    const sin = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P1", [["GLICERINA", "F-GLI", 33]])] });
    expect(sin.rows[0]!.estado).toBe("PENDIENTE DE VINCULAR");
    expect(sin.rows[0]!.candidates.map((c) => c.masterCode)).toContain("GLI-A");
    const links: MpLink[] = [
      { kind: "formula_code", key: "F-GLI", masterCode: "GLI-A" },
      { kind: "inventory_code", key: "GLI-B", masterCode: "GLI-A" },
    ];
    const con = computeAvailability({ lots, links, todayIso: TODAY, productions: [prod("P1", [["GLICERINA", "F-GLI", 33]])] });
    expect(con.rows).toHaveLength(1);
    expect([con.rows[0]!.stockUtilizable, con.rows[0]!.saldoProyectado, con.rows[0]!.estado, con.rows[0]!.match]).toEqual([35, 2, "SUFICIENTE", "aprobada"]);
  });

  it("varios lotes y nombre exacto sin tildes/mayúsculas", () => {
    const lots = [
      lot({ codigo: "ALO", descripcion: "Aloe Vera", proveedor: "A", lote: "001", cantidadKg: 10 }),
      lot({ codigo: "ALO", descripcion: "Aloe Vera", proveedor: "A", lote: "002", cantidadKg: 5 }),
    ];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["ALOE  vera", "", 12]])] });
    expect(r.rows[0]!.stockUtilizable).toBe(15);
    expect(r.rows[0]!.match).toBe("nombre");
  });

  it("stock parcial muestra el faltante real; sin stock se distingue", () => {
    const lots = [lot({ codigo: "X", descripcion: "Xantan", cantidadKg: 12 }), lot({ codigo: "Z", descripcion: "Zinc", cantidadKg: 0 })];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["Xantan", "X", 30], ["Zinc", "Z", 4]])] });
    expect(row(r, "xantan")).toMatchObject({ estado: "FALTANTE", faltante: 18, saldoProyectado: -18, stockUtilizable: 12 });
    expect(row(r, "zinc")).toMatchObject({ estado: "SIN STOCK" });
  });

  it("dos MP de nombre parecido que NO son equivalentes no se unen", () => {
    const lots = [
      lot({ codigo: "AH-1", descripcion: "Acido hialuronico alto peso", cantidadKg: 50 }),
      lot({ codigo: "AH-2", descripcion: "Acido hialuronico bajo peso", cantidadKg: 3 }),
    ];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["Ácido hialurónico", "", 10]])] });
    expect(r.rows[0]!.estado).toBe("PENDIENTE DE VINCULAR");
    expect(r.rows[0]!.stockUtilizable).toBe(0);
    expect(r.rows[0]!.candidates).toHaveLength(2);
  });

  it("varias producciones se SUMAN antes de comparar con el stock (33 kg contra 35 kg)", () => {
    const lots = [lot({ codigo: "GLI", descripcion: "Glicerina", cantidadKg: 35 })];
    const r = computeAvailability({
      lots, links: [], todayIso: TODAY,
      productions: [prod("A", [["Glicerina", "GLI", 10]]), prod("B", [["Glicerina", "GLI", 15]]), prod("C", [["Glicerina", "GLI", 8]])],
    });
    expect([r.rows[0]!.requerido, r.rows[0]!.saldoProyectado, r.rows[0]!.estado]).toEqual([33, 2, "SUFICIENTE"]);
    const mas = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("A", [["Glicerina", "GLI", 20]]), prod("B", [["Glicerina", "GLI", 20]])] });
    expect(mas.rows[0]).toMatchObject({ estado: "FALTANTE", faltante: 5 });
  });

  it("no cuenta stock bloqueado, vencido, archivado ni lotes en 0 como utilizable", () => {
    const lots = [
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 10 }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 7, estadoStockManual: "Bloqueado" }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 6, vencimiento: "2026-01-01" }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 9, archived: true }),
    ];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["Glicerina", "G", 12]])] });
    expect(r.rows[0]).toMatchObject({ stockUtilizable: 10, stockFisico: 23, estado: "FALTANTE", faltante: 2 });
    expect(r.rows[0]!.notas.join(" ")).toMatch(/13 kg físicos NO utilizables/);
  });

  it("producción sin cantidad confiable no se suma y la MP queda «sin datos confiables»", () => {
    const lots = [lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 10 })];
    const r = computeAvailability({ lots, links: [], todayIso: TODAY, productions: [prod("P", [["Glicerina", "G", 0]], { reliable: false, unreliableReason: "Unidad L" })] });
    expect(r.rows[0]!.estado).toBe("SIN DATOS CONFIABLES");
    expect(r.excluded[0]!.reason).toBe("Unidad L");
  });

  it("conversión de unidades", () => {
    expect(toKg(500, "g")).toBe(0.5);
    expect(toKg(2, "t")).toBe(2000);
    expect(toKg(10, "KG")).toBe(10);
    expect(toKg(10, "L")).toBeNull();
    expect(toKg(null, "kg")).toBeNull();
  });
});
