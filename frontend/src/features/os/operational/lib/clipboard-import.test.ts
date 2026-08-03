import { describe, expect, it } from "vitest";
import {
  autoMapColumns,
  detectDelimiter,
  parseGrid,
  parseNonNegativeNumber,
  rowToObject,
} from "./clipboard-import";

describe("clipboard-import", () => {
  it("detecta delimitadores TSV y CSV", () => {
    expect(detectDelimiter("Código\tProducto\tCantidad")).toBe("\t");
    expect(detectDelimiter("Código;Producto;Cantidad")).toBe(";");
    expect(detectDelimiter("Código,Producto,Cantidad")).toBe(",");
  });

  it("parsea encabezados y filas CSV con comillas", () => {
    const grid = parseGrid('Código,Producto,Cantidad\nMP-1,"Glicerina, vegetal","1.234,5"');
    expect(grid.hasHeaderRow).toBe(true);
    expect(grid.headers).toEqual(["Código", "Producto", "Cantidad"]);
    expect(grid.rows[0]).toEqual(["MP-1", "Glicerina, vegetal", "1.234,5"]);
  });

  it("auto mapea encabezados por alias y convierte fila a objeto", () => {
    const mapping = autoMapColumns(["Cód. MP", "Materia prima", "Stock"], {
      codigo: ["codigo", "cod mp"],
      nombre: ["materia prima"],
      cantidad: ["cantidad", "stock"],
    });
    expect(mapping.codigo).toBe(0);
    expect(mapping.nombre).toBe(1);
    expect(mapping.cantidad).toBe(2);
    expect(rowToObject(["MP-1", "Agua", "10"], mapping)).toEqual({
      codigo: "MP-1",
      nombre: "Agua",
      cantidad: "10",
    });
  });

  it("parsea números no negativos con formatos locales", () => {
    expect(parseNonNegativeNumber("1.234,5")).toBe(1234.5);
    expect(parseNonNegativeNumber("12,5")).toBe(12.5);
    expect(parseNonNegativeNumber("0")).toBe(0);
    expect(parseNonNegativeNumber("-1")).toBeNull();
    expect(parseNonNegativeNumber("abc")).toBeNull();
  });
});
