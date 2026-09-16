import { parseGrid } from "@/features/os/operational/lib/clipboard-import";
import { resolveRow } from "./row-resolver";
import type { SmartPasteMasterData, SmartPasteResult, SmartPasteRow } from "./types";

export interface SmartPasteDuplicateChecker {
  /** Devuelve una descripción si la fila resuelta es un posible duplicado, o undefined si no lo es. */
  (row: SmartPasteRow): string | undefined;
}

export interface RunSmartPasteOptions {
  checkDuplicate?: SmartPasteDuplicateChecker;
  batchIdPrefix?: string;
}

function mintBatchId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Punto de entrada del motor: PEGAR → INTERPRETAR → NORMALIZAR → VALIDAR →
 * (preview — responsabilidad de la UI) → duplicados. CONFIRMAR/PERSISTIR
 * quedan del lado de cada pantalla (ver asignacion-lotes-smart-paste.ts).
 *
 * Reutiliza parseGrid (clipboard-import.ts) SOLO para separar delimitador y
 * detectar si la primera fila es un encabezado real (para no intentar
 * clasificar "LOTE"/"VTO" como si fueran valores) — el mapeo de columnas de
 * ese módulo NO se usa acá: cada fila se resuelve por contenido, célula por
 * célula, sin importar el orden (ver row-resolver.ts).
 */
export function runSmartPaste(
  rawText: string,
  master: SmartPasteMasterData,
  options: RunSmartPasteOptions = {}
): SmartPasteResult {
  const grid = parseGrid(rawText);
  const rows: SmartPasteRow[] = grid.rows.map((cells, idx) => {
    const rowIndex = grid.hasHeaderRow ? idx + 2 : idx + 1;
    const row = resolveRow(rowIndex, cells, master);
    if (row.status !== "error" && options.checkDuplicate) {
      const duplicateOf = options.checkDuplicate(row);
      if (duplicateOf) {
        return { ...row, status: "duplicado" as const, possibleDuplicateOf: duplicateOf };
      }
    }
    return row;
  });

  const summary = {
    totalRows: rows.length,
    valid: rows.filter((r) => r.status === "valido").length,
    review: rows.filter((r) => r.status === "revisar").length,
    error: rows.filter((r) => r.status === "error").length,
    duplicate: rows.filter((r) => r.status === "duplicado").length,
  };

  return {
    rows,
    summary,
    detectedHeader: grid.hasHeaderRow ? grid.headers : null,
    batchId: mintBatchId(options.batchIdPrefix ?? "smart-paste"),
  };
}

export type { SmartPasteResult, SmartPasteRow } from "./types";
