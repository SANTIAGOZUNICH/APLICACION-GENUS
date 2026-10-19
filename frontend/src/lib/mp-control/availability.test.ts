import { describe, expect, it } from "vitest";
import { computeAvailability, namesRelated, stockForLine, toKg, toNumber, type NameAlias, type ProductionInput, type StockLot } from "./availability";

const TODAY = "2026-10-19";
let n = 0;
const lot = (p: Partial<StockLot> & Pick<StockLot, "descripcion" | "cantidadKg">): StockLot => ({
  id: `l${++n}`, codigo: "", proveedor: "Prov", lote: `L${n}`, vencimiento: "2027-12-31", estadoStock: "Stock OK", ...p,
});
const prod = (id: string, lines: Array<[string, number]>, extra: Partial<ProductionInput> = {}): ProductionInput => ({
  id, label: id, reliable: true, lines: lines.map(([materiaPrima, kg]) => ({ materiaPrima, kg })), ...extra,
});
const run = (lots: StockLot[], productions: ProductionInput[], aliases: NameAlias[] = []) => computeAvailability({ lots, productions, todayIso: TODAY, aliases });
const first = (r: ReturnType<typeof run>) => r.rows[0]!;

describe("disponibilidad de MP — Stock MP (Descripción / Kg lote)", () => {
  it("BUG REAL: filas de stock SIN CÓDIGO cuentan (antes se descartaban y todo daba 0)", () => {
    const lots = [lot({ descripcion: "GLICERINA", cantidadKg: 1.6 }), lot({ descripcion: "Glicerina", cantidadKg: 5 }), lot({ descripcion: "GLICERINA", cantidadKg: 1 })];
    const r = run(lots, [prod("P", [["GLICERINA", 5]])]);
    expect([first(r).stockFisico, first(r).stockUtilizable, first(r).estado]).toEqual([7.6, 7.6, "SUFICIENTE"]);
  });

  it("kg guardados como texto con coma («8,8») se leen bien", () => {
    expect(toNumber("8,8")).toBe(8.8);
    expect(toNumber("1.234,5")).toBe(1234.5);
    const r = run([lot({ descripcion: "Glicerina", cantidadKg: "8,8" as unknown as number })], [prod("P", [["Glicerina", 5]])]);
    expect(first(r).stockUtilizable).toBe(8.8);
  });

  it("tres proveedores: suma todo (30 ≥ 25 → +5)", () => {
    const lots = [
      lot({ codigo: "A", descripcion: "GLICERINA", proveedor: "Proveedor A", cantidadKg: 10 }),
      lot({ codigo: "B", descripcion: "Glicerina", proveedor: "Proveedor B", cantidadKg: 8 }),
      lot({ codigo: "C", descripcion: "glicerina ", proveedor: "Proveedor C", cantidadKg: 12 }),
    ];
    const r = run(lots, [prod("P1", [["Glicerina", 25]])]);
    expect(r.rows).toHaveLength(1);
    expect([first(r).stockFisico, first(r).stockUtilizable, first(r).requerido, first(r).saldoProyectado, first(r).estado]).toEqual([30, 30, 25, 5, "SUFICIENTE"]);
    expect(first(r).proveedores.map((p) => p.kgUtilizable).sort((a, b) => a - b)).toEqual([8, 10, 12]);
  });

  it("nombres que solo comparten palabras NO se suman solos: se ofrecen como posibles (GLICERINA ≠ GLICERINA VEGETAL ≠ EXTRACTO HIDROGLICERINADO)", () => {
    const lots = [
      lot({ descripcion: "GLICERINA", cantidadKg: 6 }),
      lot({ descripcion: "GLICERINA VEGETAL", cantidadKg: 14.3 }),
      lot({ descripcion: "EXTRACTO HIDROGLICERINADO", cantidadKg: 50 }),
    ];
    const r = run(lots, [prod("P", [["GLICERINA", 10]])]);
    expect(first(r)).toMatchObject({ stockUtilizable: 6, estado: "FALTANTE", faltante: 4 });
    expect(first(r).related.map((x) => x.stockName)).toEqual(["glicerina vegetal"]);
    expect(first(r).stockNames).toEqual(["GLICERINA"]);
    expect(namesRelated("GLICERINA", "extracto hidroglicerinado")).toBe(false);
  });

  it("con la equivalencia aprobada a nivel de MP (no por lote) se suman todas las filas de la otra descripción", () => {
    const lots = [lot({ descripcion: "GLICERINA", cantidadKg: 6 }), lot({ descripcion: "GLICERINA VEGETAL", cantidadKg: 8.8 }), lot({ descripcion: "Glicerina vegetal", cantidadKg: 4 })];
    const r = run(lots, [prod("P", [["GLICERINA", 10]])], [{ formulaName: "glicerina", stockName: "glicerina vegetal" }]);
    expect([first(r).stockUtilizable, first(r).estado, first(r).saldoProyectado]).toEqual([18.8, "SUFICIENTE", 8.8]);
    expect(first(r).related).toEqual([]);
  });

  it("MP sin ninguna fila con ese nombre: «MP NO IDENTIFICADA» (no se asume cero ni se inventa stock)", () => {
    const r = run([lot({ descripcion: "Agua", cantidadKg: 5 })], [prod("P", [["Perfume", 2]])]);
    expect(first(r)).toMatchObject({ estado: "MP NO IDENTIFICADA", requerido: 2 });
  });

  it("filas del nombre pero todas en 0 → SIN STOCK; con kg pero bloqueadas/vencidas → SIN STOCK UTILIZABLE", () => {
    const sin = run([lot({ descripcion: "Zinc", cantidadKg: 0 })], [prod("P", [["Zinc", 2]])]);
    expect(first(sin).estado).toBe("SIN STOCK"); // el nombre existe en el Stock pero todo está en 0
    const bloq = run([lot({ descripcion: "Zinc", cantidadKg: 30, estadoStockManual: "Bloqueado" })], [prod("P", [["Zinc", 2]])]);
    expect(first(bloq)).toMatchObject({ estado: "SIN STOCK UTILIZABLE", stockFisico: 30, stockUtilizable: 0 });
    expect(first(bloq).notas.join(" ")).toMatch(/30 kg físicos NO utilizables/);
  });

  it("stock parcial muestra el faltante real", () => {
    const r = run([lot({ descripcion: "Xantan", cantidadKg: 12 })], [prod("P", [["Xantan", 30]])]);
    expect(first(r)).toMatchObject({ estado: "FALTANTE", faltante: 18, saldoProyectado: -18, stockUtilizable: 12 });
  });

  it("varias producciones se SUMAN antes de comparar con el stock (33 contra 35)", () => {
    const lots = [lot({ descripcion: "Glicerina", cantidadKg: 35 })];
    const r = run(lots, [prod("A", [["Glicerina", 10]]), prod("B", [["Glicerina", 15]]), prod("C", [["Glicerina", 8]])]);
    expect([first(r).requerido, first(r).saldoProyectado, first(r).estado]).toEqual([33, 2, "SUFICIENTE"]);
    expect(run(lots, [prod("A", [["Glicerina", 20]]), prod("B", [["Glicerina", 20]])]).rows[0]).toMatchObject({ estado: "FALTANTE", faltante: 5 });
  });

  it("no cuenta bloqueado, vencido ni archivado como utilizable", () => {
    const lots = [
      lot({ descripcion: "Glicerina", cantidadKg: 10 }),
      lot({ descripcion: "Glicerina", cantidadKg: 7, estadoStockManual: "Bloqueado" }),
      lot({ descripcion: "Glicerina", cantidadKg: 6, vencimiento: "2026-01-01" }),
      lot({ descripcion: "Glicerina", cantidadKg: 9, archived: true }),
    ];
    const r = run(lots, [prod("P", [["Glicerina", 12]])]);
    expect(first(r)).toMatchObject({ stockUtilizable: 10, stockFisico: 23, estado: "FALTANTE", faltante: 2 });
  });

  it("stock de un cliente solo sirve a las producciones de ese cliente; el resto queda «reservado»", () => {
    const lots = [lot({ descripcion: "Glicerina", cantidadKg: 10 }), lot({ descripcion: "Glicerina", cantidadKg: 20, cliente: "CLIENTE A" })];
    const deB = run(lots, [prod("B", [["Glicerina", 15]], { client: "CLIENTE B" })]);
    expect(first(deB)).toMatchObject({ stockFisico: 30, stockUtilizable: 10, reservado: 20, estado: "FALTANTE", faltante: 5 });
    const deA = run(lots, [prod("A", [["Glicerina", 25]], { client: "CLIENTE A" })]);
    expect(first(deA)).toMatchObject({ stockUtilizable: 30, reservado: 0, estado: "SUFICIENTE", saldoProyectado: 5 });
  });

  it("producción sin cantidad confiable no se suma y queda «datos incompletos»", () => {
    const r = run([lot({ descripcion: "Glicerina", cantidadKg: 10 })], [prod("P", [["Glicerina", 0]], { reliable: false, unreliableReason: "Unidad L" })]);
    expect(first(r).estado).toBe("DATOS INCOMPLETOS");
    expect(r.excluded[0]!.reason).toBe("Unidad L");
  });

  it("lo ya consumido (por código de inventario) se resta de la necesidad", () => {
    const lots = [lot({ codigo: "GLI-A", descripcion: "Glicerina", cantidadKg: 20 })];
    const r = run(lots, [{ ...prod("P", [["Glicerina", 12]]), consumedByCode: { "GLI-A": 12 } }, prod("Q", [["Glicerina", 30]])]);
    expect(first(r).requerido).toBe(30);
    expect(run(lots, [{ ...prod("P", [["Glicerina", 12]]), consumedByCode: { "GLI-A": 5 } }]).rows[0]!.requerido).toBe(7);
  });

  it("informa cuántas filas de stock leyó (para detectar lecturas vacías)", () => {
    const r = run([lot({ descripcion: "Agua", cantidadKg: 1 }), lot({ descripcion: "Agua", cantidadKg: 1, archived: true })], [prod("P", [["Agua", 1]])]);
    expect([r.stockRowsRead, r.stockRowsActive]).toEqual([2, 1]);
  });

  it("stock de una línea de control individual", () => {
    const lots = [lot({ descripcion: "Glicerina", cantidadKg: 10 }), lot({ descripcion: "GLICERINA", cantidadKg: 5 })];
    expect(stockForLine(lots, { materiaPrima: "glicerina" }, TODAY)).toMatchObject({ linked: true, stockUtilizable: 15 });
    expect(stockForLine(lots, { materiaPrima: "Perfume" }, TODAY).linked).toBe(false);
  });

  it("conversión de unidades", () => {
    expect(toKg(500, "g")).toBe(0.5);
    expect(toKg(2, "t")).toBe(2000);
    expect(toKg(10, "L")).toBeNull();
  });
});
