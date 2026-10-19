import { describe, expect, it } from "vitest";
import { computeAvailability, namesMatch, stockForLine, toKg, type ProductionInput, type StockLot } from "./availability";

const TODAY = "2026-10-19";
let n = 0;
const lot = (p: Partial<StockLot> & Pick<StockLot, "codigo" | "descripcion" | "cantidadKg">): StockLot => ({
  id: `l${++n}`, proveedor: "Prov", lote: `L${n}`, vencimiento: "2027-12-31", estadoStock: "Stock OK", ...p,
});
const prod = (id: string, lines: Array<[string, number]>, extra: Partial<ProductionInput> = {}): ProductionInput => ({
  id, label: id, reliable: true, lines: lines.map(([materiaPrima, kg]) => ({ materiaPrima, kg })), ...extra,
});
const run = (lots: StockLot[], productions: ProductionInput[]) => computeAvailability({ lots, productions, todayIso: TODAY });

describe("disponibilidad de MP por nombre (columna Descripción del Stock)", () => {
  it("suma todas las filas con el mismo nombre, sin importar proveedor, código ni lote (30 ≥ 25)", () => {
    const lots = [
      lot({ codigo: "A", descripcion: "GLICERINA", proveedor: "Proveedor A", cantidadKg: 10 }),
      lot({ codigo: "B", descripcion: "Glicerina", proveedor: "Proveedor B", cantidadKg: 8 }),
      lot({ codigo: "C", descripcion: "glicerina ", proveedor: "Proveedor C", cantidadKg: 12 }),
    ];
    const r = run(lots, [prod("P1", [["Glicerina", 25]])]);
    expect(r.rows).toHaveLength(1);
    expect([r.rows[0]!.stockFisico, r.rows[0]!.stockUtilizable, r.rows[0]!.requerido, r.rows[0]!.saldoProyectado, r.rows[0]!.estado]).toEqual([30, 30, 25, 5, "SUFICIENTE"]);
  });

  it("«GLICERINA» de la fórmula encuentra «Glicerina vegetal» o «GLICERINA USP 99%» del stock", () => {
    const lots = [lot({ codigo: "A", descripcion: "Glicerina vegetal", cantidadKg: 20 }), lot({ codigo: "B", descripcion: "GLICERINA USP 99,5%", cantidadKg: 15 })];
    const r = run(lots, [prod("P", [["GLICERINA", 33]])]);
    expect([r.rows[0]!.stockUtilizable, r.rows[0]!.saldoProyectado, r.rows[0]!.estado]).toEqual([35, 2, "SUFICIENTE"]);
    expect(r.rows[0]!.stockNames).toHaveLength(2);
  });

  it("también ignora tildes, mayúsculas y el sufijo « — Proveedor»", () => {
    expect(namesMatch("Ácido Hialurónico", "acido hialuronico")).toBe(true);
    const lots = [lot({ codigo: "A", descripcion: "Glicerina — Proveedor A", proveedor: "Proveedor A", cantidadKg: 4 })];
    expect(run(lots, [prod("P", [["glicerina", 3]])]).rows[0]!.estado).toBe("SUFICIENTE");
  });

  it("materias primas distintas no se mezclan", () => {
    const lots = [lot({ codigo: "A", descripcion: "Agua", cantidadKg: 500 }), lot({ codigo: "B", descripcion: "Alcohol cetilico", cantidadKg: 5 })];
    const r = run(lots, [prod("P", [["Agua", 10], ["Alcohol cetílico", 8]])]);
    expect(r.rows.find((x) => x.materiaPrima === "Alcohol cetílico")).toMatchObject({ stockUtilizable: 5, estado: "FALTANTE", faltante: 3 });
    expect(r.rows.find((x) => x.materiaPrima === "Agua")).toMatchObject({ stockUtilizable: 500, estado: "SUFICIENTE" });
  });

  it("sin ninguna fila en el stock con ese nombre → SIN STOCK (con el requerido)", () => {
    const r = run([lot({ codigo: "A", descripcion: "Agua", cantidadKg: 5 })], [prod("P", [["Perfume", 2]])]);
    expect(r.rows[0]).toMatchObject({ estado: "SIN STOCK", requerido: 2, stockFisico: 0 });
  });

  it("stock parcial muestra el faltante real", () => {
    const r = run([lot({ codigo: "X", descripcion: "Xantan", cantidadKg: 12 })], [prod("P", [["Xantan", 30]])]);
    expect(r.rows[0]).toMatchObject({ estado: "FALTANTE", faltante: 18, saldoProyectado: -18, stockUtilizable: 12 });
  });

  it("varias producciones se SUMAN antes de comparar con el stock (33 contra 35)", () => {
    const lots = [lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 35 })];
    const r = run(lots, [prod("A", [["Glicerina", 10]]), prod("B", [["Glicerina", 15]]), prod("C", [["Glicerina", 8]])]);
    expect([r.rows[0]!.requerido, r.rows[0]!.saldoProyectado, r.rows[0]!.estado]).toEqual([33, 2, "SUFICIENTE"]);
    const mas = run(lots, [prod("A", [["Glicerina", 20]]), prod("B", [["Glicerina", 20]])]);
    expect(mas.rows[0]).toMatchObject({ estado: "FALTANTE", faltante: 5 });
  });

  it("dos nombres de fórmula que comparten stock se calculan juntos (no se cuenta dos veces)", () => {
    const lots = [lot({ codigo: "G", descripcion: "Glicerina vegetal", cantidadKg: 30 })];
    const r = run(lots, [prod("A", [["Glicerina", 20]]), prod("B", [["Glicerina vegetal", 20]])]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ requerido: 40, stockUtilizable: 30, estado: "FALTANTE", faltante: 10 });
  });

  it("no cuenta bloqueado, vencido ni archivado como utilizable", () => {
    const lots = [
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 10 }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 7, estadoStockManual: "Bloqueado" }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 6, vencimiento: "2026-01-01" }),
      lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 9, archived: true }),
    ];
    const r = run(lots, [prod("P", [["Glicerina", 12]])]);
    expect(r.rows[0]).toMatchObject({ stockUtilizable: 10, stockFisico: 23, estado: "FALTANTE", faltante: 2 });
    expect(r.rows[0]!.notas.join(" ")).toMatch(/13 kg físicos NO utilizables/);
  });

  it("producción sin cantidad confiable no se suma y queda «sin datos confiables»", () => {
    const r = run([lot({ codigo: "G", descripcion: "Glicerina", cantidadKg: 10 })], [prod("P", [["Glicerina", 0]], { reliable: false, unreliableReason: "Unidad L" })]);
    expect(r.rows[0]!.estado).toBe("SIN DATOS CONFIABLES");
    expect(r.excluded[0]!.reason).toBe("Unidad L");
  });

  it("lo ya consumido (por código de inventario) se resta de la necesidad", () => {
    const lots = [lot({ codigo: "GLI-A", descripcion: "Glicerina", cantidadKg: 20 })];
    const r = run(lots, [{ ...prod("P", [["Glicerina", 12]]), consumedByCode: { "GLI-A": 12 } }, prod("Q", [["Glicerina", 30]])]);
    expect(r.rows[0]!.requerido).toBe(30);
    expect(run(lots, [{ ...prod("P", [["Glicerina", 12]]), consumedByCode: { "GLI-A": 5 } }]).rows[0]!.requerido).toBe(7);
  });

  it("stock de una línea de control individual", () => {
    const lots = [lot({ codigo: "A", descripcion: "Glicerina", cantidadKg: 10 }), lot({ codigo: "B", descripcion: "GLICERINA", cantidadKg: 5 })];
    expect(stockForLine(lots, { materiaPrima: "glicerina" }, TODAY)).toMatchObject({ linked: true, stockUtilizable: 15 });
    expect(stockForLine(lots, { materiaPrima: "Perfume" }, TODAY).linked).toBe(false);
  });

  it("conversión de unidades", () => {
    expect(toKg(500, "g")).toBe(0.5);
    expect(toKg(2, "t")).toBe(2000);
    expect(toKg(10, "KG")).toBe(10);
    expect(toKg(10, "L")).toBeNull();
    expect(toKg(null, "kg")).toBeNull();
  });
});
