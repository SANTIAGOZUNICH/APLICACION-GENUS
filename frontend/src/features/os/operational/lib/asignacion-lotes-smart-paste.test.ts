import { describe, expect, it } from "vitest";
import { runSmartPaste } from "@/lib/smart-paste/engine";
import {
  buildAsignacionLotesMasterData,
  makeAsignacionLotesDuplicateChecker,
  smartPasteRowToAsignacionLoteInput,
} from "./asignacion-lotes-smart-paste";
import type { AsignacionLote } from "@/lib/asignacion-lotes/types";

function lote(overrides: Partial<AsignacionLote> = {}): AsignacionLote {
  return {
    id: "id",
    lote: "G26043",
    fecha: "2028-01-01",
    producto: "SHAVING GEL",
    codigo: "PR-01",
    marca: "NOCE CANA",
    cantidades: 100,
    vto: null,
    muestras: "",
    cjMuestra: "",
    fechaAnalisis: null,
    observaciones: "",
    createdAt: "2028-01-01T00:00:00.000Z",
    createdBy: "test",
    updatedAt: "2028-01-01T00:00:00.000Z",
    updatedBy: "test",
    ...overrides,
  };
}

describe("Asignación de lotes — Smart Paste (piloto)", () => {
  it("el master data se construye desde los registros ya cargados, sin requests nuevos", () => {
    const master = buildAsignacionLotesMasterData([lote()]);
    expect(master.lotes.has("G26043")).toBe(true);
    expect(master.clientesByNormalized.get("NOCE CANA")).toBe("NOCE CANA");
    expect(master.productosByNormalized.get("SHAVING GEL")).toBe("SHAVING GEL");
  });

  it("Test 11 (dominio real): detecta duplicado por lote+código contra lo ya guardado", () => {
    const existing = [lote({ lote: "G26043", codigo: "PR-01" })];
    const checker = makeAsignacionLotesDuplicateChecker(existing);
    const master = buildAsignacionLotesMasterData(existing);
    const result = runSmartPaste("SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200\tPR-01", master, {
      checkDuplicate: checker,
    });
    expect(result.rows[0]!.status).toBe("duplicado");
  });

  it("no marca duplicado si el código es distinto (misma clave real: lote+código, no solo lote)", () => {
    const existing = [lote({ lote: "G26043", codigo: "PR-01" })];
    const checker = makeAsignacionLotesDuplicateChecker(existing);
    const master = buildAsignacionLotesMasterData(existing);
    const result = runSmartPaste("SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200\tPR-02", master, {
      checkDuplicate: checker,
    });
    expect(result.rows[0]!.status).not.toBe("duplicado");
  });

  it("detecta duplicado interno dentro del mismo pegado (dos filas con el mismo lote+código)", () => {
    const checker = makeAsignacionLotesDuplicateChecker([]);
    const master = buildAsignacionLotesMasterData([]);
    const text = ["SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200\tPR-01", "SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200\tPR-01"].join(
      "\n"
    );
    const result = runSmartPaste(text, master, { checkDuplicate: checker });
    expect(result.rows[0]!.status).not.toBe("duplicado");
    expect(result.rows[1]!.status).toBe("duplicado");
  });

  it("mapea una fila resuelta al AsignacionLoteUpsertInput real de la API existente", () => {
    const master = buildAsignacionLotesMasterData([lote()]);
    const result = runSmartPaste("SHAVING GEL\tNOCE CANA\tG26043\t10/2028\t1200", master);
    const input = smartPasteRowToAsignacionLoteInput(result.rows[0]!, "operario@laboratoriogenus.com.ar", "2028-05-01");
    expect(input).toMatchObject({
      lote: "G26043",
      producto: "SHAVING GEL",
      marca: "NOCE CANA",
      cantidades: 1200,
      vto: "2028-10-31",
      fecha: "2028-05-01",
      createdBy: "operario@laboratoriogenus.com.ar",
      updatedBy: "operario@laboratoriogenus.com.ar",
    });
  });
});
