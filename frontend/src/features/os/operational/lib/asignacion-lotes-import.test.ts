import { describe, expect, it } from "vitest";
import {
  autoMapColumns,
  parseGrid,
  rowToObject,
} from "./clipboard-import";
import {
  ASIGNACION_LOTES_FIELD_ALIASES,
  buildAsignacionLoteFromMappedRow,
  formatAsignacionCodigoPreview,
  normalizeImportedCodigo,
  validateAsignacionLoteRow,
} from "./asignacion-lotes-import";

function mapPaste(tsv: string) {
  const grid = parseGrid(tsv);
  const mapping = autoMapColumns(grid.headers, ASIGNACION_LOTES_FIELD_ALIASES);
  const rows = grid.rows.map((row) => rowToObject(row, mapping));
  return { grid, mapping, rows };
}

describe("asignacion-lotes import Excel paste", () => {
  it("ejemplo real: PRODUCTO OLEO CALCAREO + CÓDIGO QSOFT no intercambia columnas", () => {
    const tsv = [
      "PRODUCTO\tCÓDIGO\tLOTE\tFECHA\tCANTIDAD",
      "OLEO CALCAREO\tQSOFT\tL-1\t01/08/2026\t10",
    ].join("\n");
    const { rows, mapping } = mapPaste(tsv);
    expect(mapping.producto).not.toBe(mapping.codigo);
    expect(rows[0]!.producto).toBe("OLEO CALCAREO");
    expect(rows[0]!.codigo).toBe("QSOFT");
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.producto).toBe("OLEO CALCAREO");
    expect(built.codigo).toBe("QSOFT");
  });

  it("ejemplo real: CÓDIGO vacío queda vacío y preview muestra Sin código", () => {
    const tsv = [
      "PRODUCTO\tCÓDIGO\tLOTE\tFECHA\tCANTIDAD",
      "OLEO CALCAREO\t\tL-1\t01/08/2026\t10",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows[0]!.producto).toBe("OLEO CALCAREO");
    expect(rows[0]!.codigo).toBe("");
    expect(normalizeImportedCodigo(rows[0]!.codigo)).toBe("");
    expect(formatAsignacionCodigoPreview(rows[0]!.codigo)).toBe("Sin código");
    expect(validateAsignacionLoteRow(rows[0]!, 2)).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.producto).toBe("OLEO CALCAREO");
    expect(built.codigo).toBe("");
  });

  it("1) CREMA FACIAL con código vacío", () => {
    const tsv = [
      "Lote\tFecha\tProducto\tCódigo\tCantidad",
      "L-CF\t2026-08-01\tCREMA FACIAL\t\t5",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows[0]!.producto).toBe("CREMA FACIAL");
    expect(rows[0]!.codigo).toBe("");
    expect(buildAsignacionLoteFromMappedRow(rows[0]!, "x").codigo).toBe("");
  });

  it("2) conserva exactamente 000125-A", () => {
    const tsv = [
      "Lote\tFecha\tProducto\tCódigo\tCantidad",
      "L-CF\t2026-08-01\tCREMA FACIAL\t000125-A\t5",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows[0]!.codigo).toBe("000125-A");
    expect(buildAsignacionLoteFromMappedRow(rows[0]!, "x").codigo).toBe("000125-A");
  });

  it("3) columnas desordenadas se asocian por encabezado", () => {
    const tsv = [
      "CANTIDAD\tCÓDIGO\tFECHA\tPRODUCTO\tLOTE\tMARCA\tVTO\tCLIENTE\tMUESTRAS\tCJ MUESTRA",
      "12\tSKU-9\t02/08/2026\tSerum\tL-90\tGenus\t31/12/2027\tCliente SA\t2\t1",
    ].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.cantidad ?? mapping.cantidades).toBe(0);
    expect(mapping.codigo).toBe(1);
    expect(mapping.fecha).toBe(2);
    expect(mapping.producto).toBe(3);
    expect(mapping.lote).toBe(4);
    expect(rows[0]).toMatchObject({
      cantidades: "12",
      codigo: "SKU-9",
      fecha: "02/08/2026",
      producto: "Serum",
      lote: "L-90",
      marca: "Genus",
      vto: "31/12/2027",
      cliente: "Cliente SA",
      muestras: "2",
      cjMuestra: "1",
    });
  });

  it("4) ceros iniciales en código no se convierten a número", () => {
    const tsv = [
      "Producto\tCódigo\tLote\tFecha\tCantidad",
      "Item\t000125\tL-Z\t2026-08-01\t1",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows[0]!.codigo).toBe("000125");
    expect(typeof rows[0]!.codigo).toBe("string");
  });

  it("5) código vacío no se autocompleta al construir/persistir payload", () => {
    const mapped = {
      lote: "L-1",
      fecha: "2026-08-01",
      producto: "CREMA FACIAL",
      codigo: "",
      cantidades: "3",
    };
    const first = buildAsignacionLoteFromMappedRow(mapped, "A");
    expect(first.codigo).toBe("");
    // Rehidratar/construir de nuevo no inventa código desde producto.
    const again = buildAsignacionLoteFromMappedRow(
      { ...mapped, codigo: first.codigo },
      "A"
    );
    expect(again.codigo).toBe("");
    expect(again.producto).toBe("CREMA FACIAL");
  });

  it("6) editar otros campos en el mapped row no genera ni modifica CÓDIGO", () => {
    const base = {
      lote: "L-1",
      fecha: "2026-08-01",
      producto: "CREMA FACIAL",
      codigo: "",
      cantidades: "3",
      marca: "",
    };
    const edited = { ...base, marca: "Genus", cantidades: "9", producto: "CREMA FACIAL PLUS" };
    expect(normalizeImportedCodigo(edited.codigo)).toBe("");
    expect(buildAsignacionLoteFromMappedRow(edited, "A").codigo).toBe("");
  });

  it("7) varias filas mezclan códigos completos y vacíos sin fallback", () => {
    const tsv = [
      "Producto\tCódigo\tLote\tFecha\tCantidad",
      "OLEO CALCAREO\tQSOFT\tL-1\t2026-08-01\t1",
      "OLEO CALCAREO\t\tL-2\t2026-08-01\t2",
      "CREMA FACIAL\t000125-A\tL-3\t2026-08-01\t3",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows.map((r) => r.codigo)).toEqual(["QSOFT", "", "000125-A"]);
    expect(rows.map((r) => r.producto)).toEqual([
      "OLEO CALCAREO",
      "OLEO CALCAREO",
      "CREMA FACIAL",
    ]);
    expect(rows.every((r) => r.codigo !== r.producto || r.codigo === "")).toBe(true);
    expect(rows[1]!.codigo).not.toBe(rows[1]!.producto);
  });

  it("no usa Producto como fallback aunque exista solo columna Producto (código sin mapear)", () => {
    const tsv = ["Producto\tLote\tFecha\tCantidad", "SOLO PRODUCTO\tL-1\t2026-08-01\t1"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.codigo).toBeNull();
    expect(rows[0]!.codigo).toBe("");
    expect(rows[0]!.producto).toBe("SOLO PRODUCTO");
    expect(buildAsignacionLoteFromMappedRow(rows[0]!, "x").codigo).toBe("");
  });
});
