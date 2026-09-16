import { describe, expect, it } from "vitest";
import { buildMasterData, type HistoricalRecordForMaster } from "./master-data";
import { runSmartPaste } from "./engine";
import { resolveRow } from "./row-resolver";
import type { SmartPasteMasterData, SmartPasteRow } from "./types";

/**
 * Maestro real (recortado) — mismos lotes/clientes/productos que se
 * encontraron auditando Production (ver informe final). Nunca hardcodeado
 * en el motor: se construye acá para las pruebas, y en la pantalla real se
 * construye desde los registros ya cargados (asignacion-lotes-smart-paste.ts).
 */
const HISTORICAL: HistoricalRecordForMaster[] = [
  { lote: "G26043", cliente: "NOCE CANA", producto: "SHAVING GEL" },
  { lote: "A26042", cliente: "NIZA", producto: "SERUM NIACINAMIDA" },
  { lote: "E25114", cliente: "COSMECEUTICALS", producto: "CREMA PDRN" },
  { lote: "L26069", cliente: "LUCENT", producto: "SERUM COLAGENO" },
  { lote: "130826", cliente: "BIOESENCIA", producto: "MASCARA DETOX" },
  { lote: "G26078", cliente: "JACTANS - DISNEY", producto: "SERUM DESCONGESTIVO" },
];

function master(): SmartPasteMasterData {
  return buildMasterData(HISTORICAL);
}

function fieldValue(row: SmartPasteRow, field: "producto" | "cliente" | "lote" | "vto" | "cantidad"): string | undefined {
  return row.assignments[field]?.value;
}

describe("Smart Paste — Test 1: tabla perfectamente ordenada", () => {
  it("reconstruye PRODUCTO|CLIENTE|LOTE|VTO|CANTIDAD en orden estándar", () => {
    const text = "SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200";
    const row = resolveRow(1, text.split("\t"), master());
    expect(fieldValue(row, "producto")).toBe("SHAVING GEL");
    expect(fieldValue(row, "cliente")).toBe("NOCE CANA");
    expect(fieldValue(row, "lote")).toBe("G26043");
    expect(fieldValue(row, "vto")).toBe("2028-10-31");
    expect(fieldValue(row, "cantidad")).toBe("1200");
    expect(row.status).toBe("valido");
  });
});

describe("Smart Paste — Test 2: columnas en orden distinto", () => {
  it("VTO | PRODUCTO | CANTIDAD | LOTE | CLIENTE se resuelve igual", () => {
    const row = resolveRow(1, ["10/2028", "SHAVING GEL", "1200", "G26043", "NOCE CANA"], master());
    expect(fieldValue(row, "producto")).toBe("SHAVING GEL");
    expect(fieldValue(row, "cliente")).toBe("NOCE CANA");
    expect(fieldValue(row, "lote")).toBe("G26043");
    expect(fieldValue(row, "vto")).toBe("2028-10-31");
    expect(fieldValue(row, "cantidad")).toBe("1200");
  });
});

describe("Smart Paste — Test 3: filas con orden distinto ENTRE SÍ (objetivo real corregido)", () => {
  it("cada fila se reconstruye de forma independiente, sin importar cómo vino ordenada", () => {
    const text = [
      "1200\tG26043\tNOCE CANA\tSHAVING GEL\t10/2028",
      "NIZA\tA26042\t800\tSERUM NIACINAMIDA\t11/2028",
      "E25114\t12/2027\tCREMA PDRN\t1500\tCOSMECEUTICALS",
    ].join("\n");
    const result = runSmartPaste(text, master());
    expect(result.rows).toHaveLength(3);

    expect(fieldValue(result.rows[0]!, "producto")).toBe("SHAVING GEL");
    expect(fieldValue(result.rows[0]!, "cliente")).toBe("NOCE CANA");
    expect(fieldValue(result.rows[0]!, "lote")).toBe("G26043");
    expect(fieldValue(result.rows[0]!, "vto")).toBe("2028-10-31");
    expect(fieldValue(result.rows[0]!, "cantidad")).toBe("1200");

    expect(fieldValue(result.rows[1]!, "producto")).toBe("SERUM NIACINAMIDA");
    expect(fieldValue(result.rows[1]!, "cliente")).toBe("NIZA");
    expect(fieldValue(result.rows[1]!, "lote")).toBe("A26042");
    expect(fieldValue(result.rows[1]!, "vto")).toBe("2028-11-30");
    expect(fieldValue(result.rows[1]!, "cantidad")).toBe("800");

    expect(fieldValue(result.rows[2]!, "producto")).toBe("CREMA PDRN");
    expect(fieldValue(result.rows[2]!, "cliente")).toBe("COSMECEUTICALS");
    expect(fieldValue(result.rows[2]!, "lote")).toBe("E25114");
    expect(fieldValue(result.rows[2]!, "vto")).toBe("2027-12-31");
    expect(fieldValue(result.rows[2]!, "cantidad")).toBe("1500");
  });
});

describe("Smart Paste — Test 3b: encabezados equivalentes se detectan y se excluyen de los datos", () => {
  it("un encabezado real (LOTE/VTO/etc) no se cuela como fila de datos", () => {
    const text = "VTO\tPRODUCTO\tCANTIDAD\tLOTE\tCLIENTE\n10/2028\tSHAVING GEL\t1200\tG26043\tNOCE CANA";
    const result = runSmartPaste(text, master());
    expect(result.detectedHeader).toEqual(["VTO", "PRODUCTO", "CANTIDAD", "LOTE", "CLIENTE"]);
    expect(result.rows).toHaveLength(1);
    expect(fieldValue(result.rows[0]!, "lote")).toBe("G26043");
  });
});

describe("Smart Paste — Test 4: una fila corrida (columnas movidas respecto de las demás)", () => {
  it("reconstruye CREMA PDRN | 1500 | COSMEC(desconocido) | G26080(nuevo) | 12/28 igual", () => {
    const row = resolveRow(1, ["CREMA PDRN", "1500", "COSMEC", "G26080", "12/28"], master());
    expect(fieldValue(row, "producto")).toBe("CREMA PDRN");
    expect(fieldValue(row, "cantidad")).toBe("1500");
    expect(fieldValue(row, "vto")).toBe("2028-12-31");
    // G26080 no está en el histórico pero comparte la forma sintáctica real (letra+5 dígitos).
    expect(fieldValue(row, "lote")).toBe("G26080");
    expect(row.assignments.lote?.confidence).toBe("alta");
    // "COSMEC" no coincide con ningún cliente conocido -> no se inventa, queda para revisión.
    expect(row.assignments.cliente).toBeUndefined();
    expect(row.status).toBe("revisar");
  });
});

describe("Smart Paste — Test 5 y 6: 100 y 1000 filas pegadas", () => {
  function buildBulkText(n: number): string {
    // Evita a propósito las palabras "producto"/"cliente" en los valores:
    // looksLikeHeader (clipboard-import.ts) las usa como pista de encabezado,
    // y una fila de DATOS que las contenga se detectaría (correctamente,
    // dado el heurístico compartido) como encabezado y no como fila.
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const n5 = String(20000 + i).padStart(5, "0");
      lines.push(`SHAVING GEL ${i}\tNOCE CANA ${i}\tG${n5}\t${(i % 12) + 1}/2028\t${100 + i}`);
    }
    return lines.join("\n");
  }

  it("100 filas: todas se resuelven sin romperse, lote reconocido por forma sintáctica", () => {
    const result = runSmartPaste(buildBulkText(100), master());
    expect(result.summary.totalRows).toBe(100);
    for (const row of result.rows) {
      expect(row.assignments.lote?.confidence).toBe("alta");
      expect(row.assignments.cantidad).toBeDefined();
      expect(row.assignments.vto).toBeDefined();
    }
  });

  it("1000 filas: procesa en tiempo razonable sin bloquear (determinístico, sin IA)", () => {
    const text = buildBulkText(1000);
    const start = Date.now();
    const result = runSmartPaste(text, master());
    const elapsedMs = Date.now() - start;
    expect(result.summary.totalRows).toBe(1000);
    // Generoso a propósito (CI puede ser lento) — el objetivo real es
    // "no congela el navegador", no un benchmark estricto.
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe("Smart Paste — Test 7: VTO en formatos distintos", () => {
  it.each([
    ["10/2028", "2028-10-31"],
    ["10/28", "2028-10-31"],
    ["31/10/2028", "2028-10-31"],
    ["2028-10", "2028-10-31"],
    ["08-28", "2028-08-31"],
    ["7-29", "2029-07-31"],
  ])("%s -> %s", (raw, expectedIso) => {
    const row = resolveRow(1, [raw], master());
    expect(fieldValue(row, "vto")).toBe(expectedIso);
  });

  it("un número simple sin separador nunca se confunde con fecha", () => {
    const row = resolveRow(1, ["1200"], master());
    expect(row.assignments.vto).toBeUndefined();
  });
});

describe("Smart Paste — Test 8: cantidades con puntos/comas", () => {
  it.each([
    ["1200", "1200"],
    ["1.200", "1200"],
    ["1,200", "1200"],
    ["1200,5", "1200.5"],
  ])("%s -> %s unidades", (raw, expected) => {
    const row = resolveRow(1, [raw], master());
    expect(fieldValue(row, "cantidad")).toBe(expected);
  });
});

describe("Smart Paste — Test 9: cliente se normaliza contra el maestro existente", () => {
  it.each(["Noce Cana", "NOCE CANÁ", "noce   cana", "NOCE-CANA"])(
    "%s se resuelve al cliente canónico NOCE CANA",
    (raw) => {
      const row = resolveRow(1, [raw], master());
      expect(fieldValue(row, "cliente")).toBe("NOCE CANA");
      expect(row.assignments.cliente?.confidence).toBe("alta");
    }
  );
});

describe("Smart Paste — Test 10: producto ambiguo -> NO adivinar", () => {
  it("un texto sin coincidencia con ningún producto/cliente conocido no se asigna arbitrariamente", () => {
    const row = resolveRow(1, ["XYZQWERTY DESCONOCIDO"], master());
    expect(row.assignments.producto).toBeUndefined();
    expect(row.assignments.cliente).toBeUndefined();
    expect(row.unassignedCells).toHaveLength(1);
    expect(row.status).toBe("revisar");
  });
});

describe("Smart Paste — Test 11: duplicados", () => {
  it("detecta un posible duplicado usando el hook de dominio (lote+código, regla de Asignación de Lotes)", () => {
    const existing = new Set(["g26043::pr-01"]);
    const result = runSmartPaste("SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200", master(), {
      checkDuplicate: (row) => {
        const lote = row.assignments.lote?.value?.toLowerCase() ?? "";
        const key = `${lote}::pr-01`;
        return existing.has(key) ? `Ya existe el lote ${row.assignments.lote?.value} para el código PR-01.` : undefined;
      },
    });
    expect(result.rows[0]!.status).toBe("duplicado");
    expect(result.summary.duplicate).toBe(1);
  });
});

describe("Smart Paste — Test 12: una celda inválida no rompe las demás filas", () => {
  it("una fecha imposible en una fila no afecta la resolución de otras filas", () => {
    const text = ["SHAVING GEL\tNOCE CANA\tG26043\t32/99/2028\t1200", "SERUM COLAGENO\tLUCENT\tL26069\t10/2028\t500"].join(
      "\n"
    );
    const result = runSmartPaste(text, master());
    expect(result.rows[0]!.status).toBe("error");
    expect(result.rows[0]!.issues.some((i) => i.severity === "error")).toBe(true);
    expect(result.rows[1]!.status).toBe("valido");
    expect(fieldValue(result.rows[1]!, "lote")).toBe("L26069");
  });
});

describe("Smart Paste — Test 13: round trip GENUS OS -> Excel -> GENUS OS", () => {
  it("una fila re-pegada tal cual se copió (TSV) se resuelve igual que el original", () => {
    const original = resolveRow(1, ["SHAVING GEL", "NOCE CANA", "G26043", "10/2028", "1200"], master());
    const tsv = ["producto", "cliente", "lote", "vto", "cantidad"]
      .map((f) => original.assignments[f as keyof typeof original.assignments]?.value ?? "")
      .join("\t");
    const roundTripped = resolveRow(1, tsv.split("\t"), master());
    expect(fieldValue(roundTripped, "producto")).toBe(fieldValue(original, "producto"));
    expect(fieldValue(roundTripped, "cliente")).toBe(fieldValue(original, "cliente"));
    expect(fieldValue(roundTripped, "lote")).toBe(fieldValue(original, "lote"));
    expect(fieldValue(roundTripped, "cantidad")).toBe(fieldValue(original, "cantidad"));
  });
});

describe("Smart Paste — Test 14: pegado parcial de una sola columna (lotes)", () => {
  it("una columna de solo lotes se reconoce como LOTE fila por fila", () => {
    const text = "G26043\nA26042\nE25114\nL26069";
    const result = runSmartPaste(text, master());
    expect(result.rows.map((r) => fieldValue(r, "lote"))).toEqual(["G26043", "A26042", "E25114", "L26069"]);
    expect(result.rows.every((r) => r.status === "valido")).toBe(true);
  });
});

describe("Smart Paste — Test 15: lote y VTO pegados juntos (2 columnas)", () => {
  it("reconoce ambos campos sin las otras columnas", () => {
    const row = resolveRow(1, ["G26043", "10/2028"], master());
    expect(fieldValue(row, "lote")).toBe("G26043");
    expect(fieldValue(row, "vto")).toBe("2028-10-31");
  });

  it("funciona igual si vienen al revés (VTO, lote)", () => {
    const row = resolveRow(1, ["10/2028", "G26043"], master());
    expect(fieldValue(row, "lote")).toBe("G26043");
    expect(fieldValue(row, "vto")).toBe("2028-10-31");
  });
});

describe("Smart Paste — Test 16: datos extremadamente largos no rompen la resolución", () => {
  it("un producto con nombre larguísimo sigue siendo un candidato de texto válido", () => {
    const longProduct = "DP-50556-Perfume infantil fco Armani x50ml/Es. 1191CT ".repeat(3).trim();
    const row = resolveRow(1, [longProduct, "1200", "G26043"], master());
    expect(row.assignments.lote?.value).toBe("G26043");
    expect(row.assignments.cantidad?.value).toBe("1200");
    // Texto largo sin match de maestro: no se inventa PRODUCTO, pero tampoco rompe el resto de la fila.
    expect(row.status).toBe("revisar");
  });
});

describe("Smart Paste — Test: relación cliente-producto histórica sube la confianza (mensaje 2, punto 8)", () => {
  it("cliente+producto ya vistos juntos se resuelven con alta confianza aunque el texto sea corto/ambiguo", () => {
    const withHistory = buildMasterData([...HISTORICAL, { cliente: "NIZA", producto: "SERUM NIACINAMIDA" }]);
    const row = resolveRow(1, ["NIZA", "SERUM NIACINAMIDA"], withHistory);
    expect(row.assignments.cliente?.confidence).toBe("alta");
    expect(row.assignments.producto?.confidence).toBe("alta");
  });
});

describe("Smart Paste — no bloqueante: campos faltantes no impiden resolver el resto de la fila", () => {
  it("una fila sin cliente igual resuelve producto/lote/vto/cantidad", () => {
    const row = resolveRow(1, ["SHAVING GEL", "G26043", "10/2028", "1200"], master());
    expect(fieldValue(row, "producto")).toBe("SHAVING GEL");
    expect(fieldValue(row, "lote")).toBe("G26043");
    expect(row.assignments.cliente).toBeUndefined();
    expect(row.status).toBe("valido");
  });
});
