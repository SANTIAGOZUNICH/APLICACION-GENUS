import { rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import type { MapperSheetDiagnostic } from "@/lib/mappers/mapper-diagnostics.types";
import {
  extractLoteIdFromRecord,
  mapAsignacionRecord,
} from "@/lib/mappers/sheet-lote-to-entity";

export function parseAsignacionLoteRowsWithDiagnostics(rows: string[][]): {
  lotes: LoteRow[];
  diagnostic: MapperSheetDiagnostic;
} {
  const headersDetected = rows[0]?.map((cell) => cell.trim()).filter(Boolean) ?? [];
  const records = rowsToRecords(rows);
  const discardReasons: string[] = [];
  const lotes: LoteRow[] = [];

  for (const record of records) {
    const mapped = mapAsignacionRecord(record);
    const loteId = extractLoteIdFromRecord(record) || mapped.loteId || mapped.nroLote;

    if (!loteId) {
      const preview = Object.values(record).filter(Boolean).slice(0, 3).join(" | ");
      discardReasons.push(
        preview
          ? `Fila sin loteId/nroLote reconocible (${preview})`
          : "Fila vacía o sin identificador de lote"
      );
      continue;
    }

    lotes.push({ ...mapped, loteId });
  }

  return {
    lotes,
    diagnostic: {
      entity: "lote",
      tabsAttempted: [],
      headersDetected,
      rowsRead: records.length,
      rowsMapped: lotes.length,
      rowsDiscarded: Math.max(records.length - lotes.length, 0),
      discardReasons: discardReasons.slice(0, 5),
      sampleRow: records[0],
    },
  };
}
