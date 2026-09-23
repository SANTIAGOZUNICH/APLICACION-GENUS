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
  parseAnalysisDateShorthand,
  validateAsignacionLoteRow,
} from "./asignacion-lotes-import";

function mapPaste(tsv: string) {
  const grid = parseGrid(tsv);
  const mapping = autoMapColumns(grid.headers, ASIGNACION_LOTES_FIELD_ALIASES);
  const rows = grid.rows.map((row) => rowToObject(row, mapping));
  return { grid, mapping, rows };
}

describe("asignacion-lotes import — columna 'Cliente' cae en marca (sync Google Sheets)", () => {
  it("planilla con encabezado CLIENTE (sin MARCA) igual persiste el valor en marca", () => {
    const tsv = ["PRODUCTO\tCLIENTE\tLOTE\tFECHA\tCANTIDAD", "SERUM\tECODERM\tS-1\t01/08/2026\t10"].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows[0]!.cliente).toBe("ECODERM");
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.marca).toBe("ECODERM");
  });

  it("si ambas columnas MARCA y CLIENTE vienen cargadas, MARCA tiene prioridad", () => {
    const built = buildAsignacionLoteFromMappedRow(
      { producto: "SERUM", marca: "ROSEHIP-ECODERM", cliente: "ECODERM", lote: "S-1" },
      "Calidad"
    );
    expect(built.marca).toBe("ROSEHIP-ECODERM");
  });
});

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

/**
 * Carga flexible (celdas vacías permitidas) — caso obligatorio del pedido:
 * ninguna celda vacía bloquea la importación de la fila, salvo formato
 * realmente inválido en un dato SÍ presente. No se inventan valores.
 */
describe("asignacion-lotes import — celdas vacías permitidas (carga flexible)", () => {
  it("caso 13: Lote y VTO vacíos, resto presente → sin issues bloqueantes", () => {
    const row = {
      producto: "Shampoo X",
      codigo: "SH-001",
      cliente: "Cliente A",
      cantidades: "1000",
      lote: "",
      vto: "",
    };
    expect(validateAsignacionLoteRow(row, 1)).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow(row, "Calidad");
    expect(built.lote).toBe("");
    expect(built.vto).toBeNull();
    expect(built.producto).toBe("Shampoo X");
    expect(built.codigo).toBe("SH-001");
  });

  it("caso 14: fila con solamente Producto (todo lo demás vacío) → se acepta, nada se inventa", () => {
    const row = { producto: "Producto A" };
    expect(validateAsignacionLoteRow(row, 1)).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow(row, "Calidad");
    expect(built.producto).toBe("Producto A");
    expect(built.lote).toBe("");
    expect(built.fecha).toBeNull();
    expect(built.codigo).toBe("");
    expect(built.cantidades).toBe(0);
    expect(built.vto).toBeNull();
  });

  it("caso 15: filas mixtas (completa / parcial / con celdas vacías) — ninguna bloquea a las demás", () => {
    const tsv = [
      "Producto\tCódigo\tCliente\tCantidad\tLote\tVTO",
      "Shampoo X\tSH-001\tCliente A\t1000\t\t",
      "Crema Y\t\tCliente B\t500\tL-100\t",
      "Serum Z\tSZ-200\t\t\t\t12/2027",
    ].join("\n");
    const { rows } = mapPaste(tsv);
    expect(rows).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      expect(validateAsignacionLoteRow(row, index + 1)).toEqual([]);
    }
    const built = rows.map((row) => buildAsignacionLoteFromMappedRow(row, "Calidad"));
    expect(built[0]!.lote).toBe("");
    expect(built[1]!.codigo).toBe("");
    expect(built[2]!.lote).toBe("");
    expect(built[2]!.fecha).toBeNull();
    expect(built[2]!.cantidades).toBe(0);
  });

  it("fecha vacía persiste como null (no como string vacío) — nunca se inventa la fecha de hoy", () => {
    const built = buildAsignacionLoteFromMappedRow(
      { producto: "X", lote: "L-1", fecha: "" },
      "Calidad"
    );
    expect(built.fecha).toBeNull();
  });

  it("fecha presente pero con formato inválido SÍ advierte (no bloquea, severidad warning)", () => {
    const issues = validateAsignacionLoteRow({ producto: "X", fecha: "no-es-una-fecha" }, 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("fecha");
    expect(issues[0]!.severity).toBe("warning");
  });
});

/**
 * AUDIT_EXCEL_VTO_BUG — Pegado desde Excel en Asignación de Lotes perdía
 * VTO/CJ Muestras/Muestras/Fecha análisis. Causa raíz real (investigación
 * previa): (1) los alias de encabezado para CJ Muestras/Fecha análisis no
 * toleraban plural ("CJ Muestras"/"Cajas Muestras") ni abreviatura
 * ("F. Analisis"); (2) parseFlexibleDate no reconocía año de 2 dígitos
 * (formato real más común de VTO en GENUS: "08-28", "07/29"), así que un
 * VTO real y válido se descartaba en silencio a null; (3) esa pérdida
 * silenciosa solo generaba un warning no bloqueante, dejando la fila
 * preseleccionada para importar con el dato ya perdido.
 */
describe("AUDIT_EXCEL_VTO_BUG — encabezados tolerantes (Tests 1-3, 8)", () => {
  it("Test 1: encabezado 'VTO' mapea e importa correctamente", () => {
    const tsv = ["Producto\tLote\tVTO", "Serum X\tG26043\t10/2028"].join("\n");
    const { rows } = mapPaste(tsv);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2028-10-31");
  });

  it("Test 2: encabezado 'Vencimiento' mapea a VTO", () => {
    const tsv = ["Producto\tLote\tVencimiento", "Serum X\tG26043\t10/2028"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.vto).not.toBeNull();
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2028-10-31");
  });

  it("Test 3: encabezado 'Fecha de vencimiento' mapea a VTO", () => {
    const tsv = ["Producto\tLote\tFecha de vencimiento", "Serum X\tG26043\t10/2028"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.vto).not.toBeNull();
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2028-10-31");
  });

  it("Test 8/con tildes/mayúsculas/puntos: 'CJ Muestras' (plural) mapea igual que 'CJ Muestra' (singular)", () => {
    const tsv = ["Producto\tLote\tCJ Muestras", "Serum X\tG26043\t2"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.cjMuestra).not.toBeNull();
    expect(rows[0]!.cjMuestra).toBe("2");
  });

  it("'Cajas Muestras' (plural) también mapea a cjMuestra", () => {
    const tsv = ["Producto\tLote\tCajas Muestras", "Serum X\tG26043\t3"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.cjMuestra).not.toBeNull();
    expect(rows[0]!.cjMuestra).toBe("3");
  });

  it("'F. Analisis' (abreviatura real) mapea a fechaAnalisis", () => {
    const tsv = ["Producto\tLote\tF. Analisis", "Serum X\tG26043\t14/08/2026"].join("\n");
    const { mapping, rows } = mapPaste(tsv);
    expect(mapping.fechaAnalisis).not.toBeNull();
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.fechaAnalisis).toBe("2026-08-14");
  });

  it("encabezados con tildes/mayúsculas/puntos: 'FECHA ANÁLISIS' en mayúsculas también mapea", () => {
    const tsv = ["Producto\tLote\tFECHA ANÁLISIS", "Serum X\tG26043\t14/08/2026"].join("\n");
    const { mapping } = mapPaste(tsv);
    expect(mapping.fechaAnalisis).not.toBeNull();
  });
});

describe("AUDIT_EXCEL_VTO_BUG — VTO con año de 2 dígitos (formato real más común)", () => {
  it("VTO '08-28' (mes-año de 2 dígitos) se importa como 2028-08-31, no se pierde", () => {
    const tsv = ["Producto\tLote\tVTO", "Serum X\tG26043\t08-28"].join("\n");
    const { rows } = mapPaste(tsv);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2028-08-31");
  });

  it("VTO '07/29' (con barra) también se reconoce", () => {
    const tsv = ["Producto\tLote\tVTO", "Serum X\tG26043\t07/29"].join("\n");
    const { rows } = mapPaste(tsv);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2029-07-31");
  });

  it("VTO 10/2028 (Test 4) persiste igual que antes tras el fix", () => {
    const tsv = ["Producto\tLote\tVTO", "Serum X\tG26043\t10/2028"].join("\n");
    const { rows } = mapPaste(tsv);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.vto).toBe("2028-10-31");
  });
});

describe("AUDIT_EXCEL_VTO_BUG — Muestras se importa (Test 6)", () => {
  it("columna 'Muestras' se importa tal cual", () => {
    const tsv = ["Producto\tLote\tMuestras", "Serum X\tG26043\t5"].join("\n");
    const { rows } = mapPaste(tsv);
    const built = buildAsignacionLoteFromMappedRow(rows[0]!, "Calidad");
    expect(built.muestras).toBe("5");
  });
});

describe("AUDIT_EXCEL_VTO_BUG — VTO ilegible es un error, nunca un warning silencioso (Test de preview)", () => {
  it("un VTO presente pero genuinamente ilegible se marca severity 'error' (fila queda fuera de la selección por defecto)", () => {
    const issues = validateAsignacionLoteRow({ producto: "X", vto: "no-es-una-fecha" }, 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("vto");
    expect(issues[0]!.severity).toBe("error");
  });

  it("una Fecha análisis ilegible también es error", () => {
    const issues = validateAsignacionLoteRow({ producto: "X", fechaAnalisis: "no-es-una-fecha" }, 1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("si la preview mostraría '—' para un VTO que sí venía en el Excel (G26043 | 10/2028), eso ya no ocurre: el valor se resuelve", () => {
    const built = buildAsignacionLoteFromMappedRow({ producto: "X", lote: "G26043", vto: "10/2028" }, "Calidad");
    expect(built.vto).not.toBeNull();
    expect(built.vto).toBe("2028-10-31");
  });
});

/**
 * Hotfix (reproducción real, hoja SEPTIEMBRE 2026): "N/A" en Fecha análisis
 * es un marcador explícito de "no aplica", NO un intento de fecha mal
 * escrito — antes disparaba el mismo error bloqueante que un dato
 * realmente ilegible, tirando abajo filas enteras (lote/producto/VTO
 * correctos) solo por este campo secundario. Whitelist exacta y acotada
 * (nunca fuzzy) para no confundir esto con AUDIT_EXCEL_VTO_BUG.
 */
describe("Hotfix — tokens explícitos de 'sin dato' (N/A, S/D, -) no bloquean la fila", () => {
  it("Fecha análisis 'N/A' no genera error — persiste como null, no bloquea la fila", () => {
    const issues = validateAsignacionLoteRow({ producto: "X", lote: "L-1", fechaAnalisis: "N/A" }, 1);
    expect(issues).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow({ producto: "X", lote: "L-1", fechaAnalisis: "N/A" }, "Calidad");
    expect(built.fechaAnalisis).toBeNull();
  });

  it("variantes de 'sin dato' (n/a, S/D, -, minúsculas/mayúsculas/espacios) tampoco bloquean", () => {
    for (const token of ["n/a", "N/A", " N/A ", "s/d", "S/D", "-", "NA", "n.a."]) {
      const issues = validateAsignacionLoteRow({ producto: "X", lote: "L-1", fechaAnalisis: token }, 1);
      expect(issues).toEqual([]);
    }
  });

  it("un valor realmente ilegible (no está en la whitelist) SIGUE siendo error — no se relaja la validación en general", () => {
    // "2-9" (día-mes sin año) YA NO es un buen ejemplo de "ilegible": es un
    // formato real confirmado en la hoja SEPTIEMBRE 2026 en vivo (~31% de
    // las filas activas), reconocido por parseAnalysisDateShorthand — ver
    // el describe "FECHA ANALISIS día-mes sin año" más abajo. Este test
    // sigue cubriendo el caso genuinamente ilegible con texto sin forma de
    // fecha alguna.
    const issues = validateAsignacionLoteRow({ producto: "X", lote: "L-1", fechaAnalisis: "asdf" }, 1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
  });

  it("VTO 'N/A' también se tolera igual que Fecha análisis (misma clase de problema)", () => {
    const issues = validateAsignacionLoteRow({ producto: "X", lote: "L-1", vto: "N/A" }, 1);
    expect(issues).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow({ producto: "X", lote: "L-1", vto: "N/A" }, "Calidad");
    expect(built.vto).toBeNull();
  });
});

/**
 * FECHA ANALISIS día-mes sin año (validación contra la hoja SEPTIEMBRE 2026
 * REAL — no un ejemplo inventado): "2-9", "16/9", "envían" son formatos
 * reales confirmados que antes de este fix bloqueaban ~31% de las filas
 * activas de la hoja (30 de 97) como "inválidas", así que nunca llegaban a
 * sincronizarse. parseFlexibleDate no los reconoce (solo tiene mm/yy con
 * año, no día/mes sin año) — se agrega un parser específico para este campo,
 * que infiere el año de la propia FECHA de la fila (nunca del reloj real,
 * que rompería fuentes de años anteriores como "Asignación de Lotes 2025").
 */
describe("parseAnalysisDateShorthand — FECHA ANALISIS día-mes sin año (hoja SEPTIEMBRE 2026 real)", () => {
  it("día-mes con '-' o '/' se resuelve usando el año de la FECHA de la fila", () => {
    expect(parseAnalysisDateShorthand("2-9", "2026-09-01")).toBe("2026-09-02");
    expect(parseAnalysisDateShorthand("16/9", "2026-09-01")).toBe("2026-09-16");
  });

  it("sin FECHA de referencia disponible, usa el año actual (nunca inventa otro)", () => {
    const now = new Date("2027-03-15T00:00:00Z");
    expect(parseAnalysisDateShorthand("2-9", null, now)).toBe("2027-09-02");
  });

  it("una fuente de un año anterior (ej. Asignación de Lotes 2025) resuelve al año de ESA fila, no al año calendario actual", () => {
    const now = new Date("2026-09-23T00:00:00Z");
    expect(parseAnalysisDateShorthand("10-3", "2025-03-05", now)).toBe("2025-03-10");
  });

  it("mes fuera de rango -> null (nunca inventa una fecha)", () => {
    expect(parseAnalysisDateShorthand("5-13", "2026-09-01")).toBeNull();
  });

  it("no es día-mes (formato completamente distinto) -> null", () => {
    expect(parseAnalysisDateShorthand("asdf", "2026-09-01")).toBeNull();
  });

  it("validateAsignacionLoteRow: '2-9' en FECHA ANALISIS ya no es error (era el bug real de Production)", () => {
    const issues = validateAsignacionLoteRow(
      { producto: "X", lote: "L-1", fecha: "1/9/2026", fechaAnalisis: "2-9" },
      1
    );
    expect(issues).toEqual([]);
  });

  it("buildAsignacionLoteFromMappedRow: '16-9' persiste como fecha real, no como null", () => {
    const built = buildAsignacionLoteFromMappedRow(
      { producto: "X", lote: "L-1", fecha: "1/9/2026", fechaAnalisis: "16-9" },
      "sync"
    );
    expect(built.fechaAnalisis).toBe("2026-09-16");
  });

  it("'envían'/'envian' (sin fecha aún) se tolera igual que N/A — no bloquea, persiste null", () => {
    for (const token of ["envian", "envían", "ENVIAN", " Envían "]) {
      const issues = validateAsignacionLoteRow({ producto: "X", lote: "L-1", fechaAnalisis: token }, 1);
      expect(issues).toEqual([]);
      const built = buildAsignacionLoteFromMappedRow({ producto: "X", lote: "L-1", fechaAnalisis: token }, "sync");
      expect(built.fechaAnalisis).toBeNull();
    }
  });
});

/**
 * Hotfix (reproducción real, hoja SEPTIEMBRE 2026 — reporte de Production):
 * "91 filas leídas, 0 nuevas, 90 inválidas" con motivo "Falta lote o
 * producto" para S26001/S26002/S26003, aunque el lote SÍ se leía
 * correctamente. Reproducción exacta con los encabezados y filas reales
 * de la hoja para demostrar la causa raíz real (VTO dd/mm/aa + Fecha
 * análisis "N/A", NUNCA un problema de mapeo de encabezados — PRODUCTO y
 * N° LOTE ya mapeaban correctamente).
 */
describe("Hotfix — reproducción real hoja SEPTIEMBRE 2026 (headers + filas reales)", () => {
  const header = [
    "N° LOTE", "FECHA", "PRODUCTO", "CODIGO", "MARCA", "CANTIDAD", "VTO",
    "MM", "FECHA ANALISIS", "N° ANALISIS", "OE", "OA", "RL", "OBSERVACION",
  ];

  function mapSeptiembreRow(row: string[]) {
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    return rowToObject(row, mapping);
  }

  it("el mapper YA reconoce N° LOTE y PRODUCTO correctamente (la causa raíz NO es el header mapping)", () => {
    const mapping = autoMapColumns(header, ASIGNACION_LOTES_FIELD_ALIASES);
    expect(mapping.lote).toBe(0);
    expect(mapping.producto).toBe(2);
    expect(mapping.codigo).toBe(3);
    expect(mapping.marca).toBe(4);
    expect(mapping.cantidades).toBe(5);
    expect(mapping.vto).toBe(6);
    expect(mapping.fechaAnalisis).toBe(8);
  });

  it("S26001 (VTO '1/9/28' + Fecha análisis 'N/A') pasa validación limpio tras el fix — antes era bloqueado", () => {
    const mapped = mapSeptiembreRow([
      "S26001", "1/9/2026", "AFTER SHAVE", "VERDE", "ORIGINAL BLACK", "6800", "1/9/28",
      "", "N/A", "", "", "", "", "",
    ]);
    expect(validateAsignacionLoteRow(mapped, 3)).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow(mapped, "sync");
    expect(built.lote).toBe("S26001");
    expect(built.producto).toBe("AFTER SHAVE");
    expect(built.codigo).toBe("VERDE");
    expect(built.marca).toBe("ORIGINAL BLACK");
    expect(built.cantidades).toBe(6800);
    expect(built.vto).toBe("2028-09-01"); // VTO nunca se pierde
    expect(built.fechaAnalisis).toBeNull(); // "N/A" -> null, sin bloquear
  });

  it("S26017 (CÓDIGO vacío) también se importa correctamente — código vacío nunca bloquea", () => {
    const mapped = mapSeptiembreRow([
      "S26017", "1/9/2026", "CREMA FACIAL CON ACIDO HIALURONICO", "", "ROSEHIP-ECODERM", "240", "1/9/28",
      "", "N/A", "", "", "", "", "",
    ]);
    expect(validateAsignacionLoteRow(mapped, 19)).toEqual([]);
    const built = buildAsignacionLoteFromMappedRow(mapped, "sync");
    expect(built.lote).toBe("S26017");
    expect(built.codigo).toBe("");
    expect(built.marca).toBe("ROSEHIP-ECODERM");
    expect(built.vto).toBe("2028-09-01");
  });

  it("la fila auxiliar ('AGU DEL SECTOR DE ELABORACION', sin N° LOTE) no tiene lote — el sync la clasifica aparte, nunca como asignación", () => {
    const mapped = mapSeptiembreRow([
      "", "", "AGU DEL SECTOR DE ELABORACION", "", "", "", "", "", "2-9", "", "", "", "", "",
    ]);
    expect(mapped.lote?.trim()).toBe("");
    expect(mapped.producto?.trim()).toBe("AGU DEL SECTOR DE ELABORACION");
  });
});
