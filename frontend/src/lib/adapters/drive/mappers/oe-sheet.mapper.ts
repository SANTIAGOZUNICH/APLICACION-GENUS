import { Factory } from "lucide-react";
import { PRODUCTION_ORDER_FLOW } from "@/config/entity-pages";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import { rowsToRecords, pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { OeIndexEntry } from "@/lib/adapters/drive/types/document.types";

function inferStatus(value: string): Status {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("cerr")) return Status.CERRADA;
  if (normalized.includes("curso")) return Status.EN_CURSO;
  if (normalized.includes("planif")) return Status.PLANIFICADA;
  if (normalized.includes("liber")) return Status.LIBERADO;
  return Status.EN_CURSO;
}

function inferStageId(status: Status): string {
  switch (status) {
    case Status.PLANIFICADA:
      return "planificada";
    case Status.CERRADA:
      return "cerrada";
    case Status.LIBERADO:
      return "liberada";
    default:
      return "en-curso";
  }
}

/** Minimal OE entity page from a single OE spreadsheet (v1 heuristic). */
export function buildOeEntityPageFromSheet(
  indexEntry: OeIndexEntry,
  rows: string[][]
): EntityPageModel {
  const records = rowsToRecords(rows);
  const firstRecord = records[0] ?? {};

  const producto = pickField(
    firstRecord,
    "producto",
    "PRODUCTO",
    "descripcion",
    "granel",
    "nombre"
  );
  const estadoRaw = pickField(firstRecord, "estado", "status", "estado_oe");
  const status = inferStatus(estadoRaw || "En curso");
  const batch = pickField(firstRecord, "batch", "cantidad", "kg", "tamano_batch");
  const responsable = pickField(firstRecord, "responsable", "operario", "usuario");
  const lote = pickField(firstRecord, "lote", "lote_granel", "LOTE_ID");

  const keyValueItems = Object.entries(firstRecord)
    .filter(([, value]) => value.trim())
    .slice(0, 12)
    .map(([key, value]) => ({
      id: key,
      label: key.replace(/_/g, " "),
      value,
    }));

  return {
    kind: EntityPageKinds.OE,
    entityId: indexEntry.oeId,
    title: producto || indexEntry.fileName,
    subtitle: `Elaboración · ${indexEntry.fileName}`,
    status,
    identityIcon: Factory,
    statusFlow: PRODUCTION_ORDER_FLOW,
    currentStageId: inferStageId(status),
    sections: [
      {
        id: "datos",
        title: "Datos de la orden",
        description: `Leído desde Drive · ${indexEntry.fileName}`,
        content: {
          type: "key-values",
          items:
            keyValueItems.length > 0
              ? keyValueItems
              : [
                  { id: "archivo", label: "Archivo", value: indexEntry.fileName },
                  { id: "oe", label: "OE", value: indexEntry.oeId },
                  ...(batch
                    ? [{ id: "batch", label: "Batch", value: batch }]
                    : []),
                  ...(lote
                    ? [{ id: "lote", label: "Lote granel", value: lote }]
                    : []),
                  ...(responsable
                    ? [{ id: "resp", label: "Responsable", value: responsable }]
                    : []),
                ],
        },
      },
    ],
    activityLog: [
      {
        id: "oe-loaded",
        timestamp: new Date().toISOString(),
        user: "Sistema",
        action: "Lectura desde Drive",
        description: `Sheet ${indexEntry.fileId} indexado como ${indexEntry.oeId}.`,
      },
    ],
    relatedObjects: [],
  };
}

export function buildOeListItem(entry: OeIndexEntry) {
  return {
    oeId: entry.oeId,
    fileId: entry.fileId,
    fileName: entry.fileName,
    modifiedTime: entry.modifiedTime,
  };
}
