import {
  buildLoteEntityPage,
  composeLoteSheetData,
  mapRecordsToLoteRow,
} from "@/lib/adapters/sheets/mappers/lote.mapper";
import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { LoteRow } from "@/lib/adapters/sheets/types/sheets-row.types";
import type { EntityPageModel } from "@/types/entity-page";

function mapAsignacionRecord(record: Record<string, string>): LoteRow {
  const base = mapRecordsToLoteRow(record);
  const nroLote = pickField(
    record,
    "nroLote",
    "nro_lote",
    "lote",
    "numero_lote",
    "asignacion"
  );

  return {
    ...base,
    loteId:
      base.loteId ||
      pickField(record, "loteId", "LOTE_ID", "id_lote", "codigo") ||
      nroLote,
    nroLote: base.nroLote || nroLote,
    tipoItem: base.tipoItem || pickField(record, "tipo", "tipo_item", "tipoItem"),
    itemId:
      base.itemId ||
      pickField(record, "itemId", "ITEM_ID", "producto", "sku", "pt"),
    estado:
      base.estado ||
      pickField(record, "estado", "status", "estado_lote", "disposicion"),
    fechaVencimiento:
      base.fechaVencimiento ||
      pickField(record, "fechaVencimiento", "vencimiento", "fecha_vencimiento"),
  };
}

export function parseAsignacionLoteRows(rows: string[][]): LoteRow[] {
  return rowsToRecords(rows)
    .map(mapAsignacionRecord)
    .filter((row) => row.loteId || row.nroLote);
}

export function buildLoteEntityPagesFromAsignacion(
  rows: string[][]
): EntityPageModel[] {
  const lotes = parseAsignacionLoteRows(rows).map((row) => ({
    ...row,
    loteId: row.loteId || row.nroLote,
  }));

  return lotes.map((lote) => {
    const sheetData = composeLoteSheetData(lote, [], []);
    const page = buildLoteEntityPage(sheetData);
    return {
      ...page,
      entityId: lote.loteId,
      sections: page.sections.map((section) =>
        section.id === "datos"
          ? {
              ...section,
              description:
                "Identificación desde ASIGNACION DE LOTES 2026 (Google Drive).",
            }
          : section.id === "analisis"
            ? {
                ...section,
                description:
                  "Análisis no incluidos en el slice E7.1 — pendiente de conexión.",
              }
            : section.id === "movimientos"
              ? {
                  ...section,
                  description:
                    "Movimientos no incluidos en ASIGNACION DE LOTES 2026.",
                  content: {
                    type: "audit-table" as const,
                    table: {
                      id: `mov-lote-${lote.loteId}`,
                      columns: section.content.type === "audit-table"
                        ? section.content.table.columns
                        : [],
                      rows: [],
                    },
                  },
                }
              : section
      ),
    };
  });
}

export function findLoteEntityPage(
  rows: string[][],
  loteId: string
): EntityPageModel | null {
  const pages = buildLoteEntityPagesFromAsignacion(rows);
  const normalized = loteId.trim().toLowerCase();
  return (
    pages.find(
      (page) =>
        page.entityId.toLowerCase() === normalized ||
        page.title.toLowerCase().includes(normalized)
    ) ?? null
  );
}
