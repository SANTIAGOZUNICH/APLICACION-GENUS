import { Factory } from "lucide-react";
import { PRODUCTION_ORDER_FLOW } from "@/config/entity-pages";
import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";
import type { OeIndexEntry, OeSheetFields } from "@/lib/adapters/drive/types/document.types";
import { rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";
import {
  buildOeIndexCardData,
  formatOeModifiedTime,
} from "@/lib/mappers/oe-index-display";
import { parseOeFileNameMetadata } from "@/lib/mappers/oe-file-name";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import {
  extractLabelValuePairs,
  inferOeStatus,
  mergeFieldSources,
  pickField,
} from "@/lib/mappers/sheet-field-resolver";

export type { OeSheetFields };
export { parseOeFileNameMetadata } from "@/lib/mappers/oe-file-name";

export function extractOeFieldsFromSheet(rows: string[][]): OeSheetFields {
  const labelPairs = extractLabelValuePairs(rows);
  const records = rowsToRecords(rows);
  const firstRecord = records[0] ?? {};
  const raw = mergeFieldSources(labelPairs, firstRecord);

  return {
    oeId: pickField(
      raw,
      "oe_id",
      "oeid",
      "id_oe",
      "nro_oe",
      "numero_oe",
      "orden_elaboracion",
      "orden",
      "oe"
    ),
    lote: pickField(
      raw,
      "lote_id",
      "lote",
      "lote_granel",
      "nro_lote",
      "numero_lote",
      "lote_granel_id"
    ),
    cliente: pickField(
      raw,
      "cliente",
      "cliente_nombre",
      "marca",
      "cliente_id",
      "nombre_cliente"
    ),
    producto: pickField(
      raw,
      "producto",
      "descripcion",
      "descripcion_producto",
      "granel",
      "nombre_producto",
      "nombre"
    ),
    estado: pickField(raw, "estado", "estado_oe", "status", "estado_orden"),
    responsable: pickField(raw, "responsable", "operario", "usuario", "elaborador"),
    batch: pickField(
      raw,
      "batch",
      "tamano_batch",
      "cantidad",
      "kg",
      "tamano_de_batch",
      "volumen"
    ),
    fecha: pickField(raw, "fecha", "fecha_inicio", "fecha_oe", "inicio", "fecha_elaboracion"),
    raw,
  };
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

function displayField(value?: string): string {
  return value?.trim() ? value.trim() : "No detectado";
}

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function buildOeEntityPageFromFields(
  indexEntry: OeIndexEntry,
  fields: OeSheetFields
): EntityPageModel {
  const parsed = parseOeFileNameMetadata(indexEntry.fileName);
  const producto = displayField(fields.producto || parsed.producto);
  const cliente = fields.cliente?.trim()
    ? fields.cliente.trim()
    : parsed.cliente ?? "No detectado";
  const entityId = fields.oeId?.trim() || indexEntry.fileSlug || indexEntry.fileId;
  const title =
    producto !== "No detectado" && cliente !== "No detectado"
      ? `${producto} · ${cliente}`
      : producto !== "No detectado"
        ? producto
        : stripSheetExtension(indexEntry.fileName);

  const estadoSheet = displayField(fields.estado);
  const status = fields.estado?.trim()
    ? inferOeStatus(fields.estado)
    : Status.PENDIENTE;

  const keyValueItems = [
    { id: "archivo", label: "Archivo", value: indexEntry.fileName },
    { id: "producto", label: "Producto", value: producto },
    { id: "cliente", label: "Cliente", value: cliente },
    {
      id: "carpeta",
      label: "Carpeta",
      value: indexEntry.folderPath?.trim() || "No detectado",
    },
    {
      id: "modificacion",
      label: "Última modificación",
      value: formatOeModifiedTime(indexEntry.modifiedTime),
    },
    {
      id: "drive",
      label: "Origen Drive",
      value: driveFileUrl(indexEntry.fileId),
    },
    { id: "oe-id", label: "OE ID (Sheet)", value: displayField(fields.oeId) },
    { id: "lote", label: "Lote granel", value: displayField(fields.lote) },
    { id: "estado-sheet", label: "Estado (Sheet)", value: estadoSheet },
    { id: "batch", label: "Batch", value: displayField(fields.batch) },
    { id: "responsable", label: "Responsable", value: displayField(fields.responsable) },
    { id: "fecha", label: "Fecha", value: displayField(fields.fecha) },
  ];

  return {
    kind: EntityPageKinds.OE,
    entityId,
    title,
    subtitle: indexEntry.folderPath
      ? `ELABORACION · ${indexEntry.folderPath}`
      : "ELABORACION · Google Drive",
    status,
    identityIcon: Factory,
    statusFlow: PRODUCTION_ORDER_FLOW,
    currentStageId: fields.estado?.trim() ? inferStageId(status) : "indexada",
    sections: [
      {
        id: "datos",
        title: "Datos de la orden",
        description: `Lectura desde ${indexEntry.fileName}. Campos ausentes se muestran como «No detectado».`,
        content: {
          type: "key-values",
          items: keyValueItems,
        },
      },
    ],
    activityLog: [
      {
        id: "oe-loaded",
        timestamp: new Date().toISOString(),
        user: "Sistema",
        action: "Lectura desde Drive",
        description: fields.oeId?.trim()
          ? `Sheet abierto — OE ID ${fields.oeId} detectado.`
          : `Sheet abierto — OE ID no detectado en el contenido.`,
      },
    ],
    relatedObjects: [],
  };
}

export function buildOeEntityPageFromSheet(
  indexEntry: OeIndexEntry,
  rows: string[][]
): EntityPageModel {
  return buildOeEntityPageFromFields(indexEntry, extractOeFieldsFromSheet(rows));
}

export function buildOeListItem(entry: OeIndexEntry) {
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    fileSlug: entry.fileSlug,
    folderPath: entry.folderPath,
    modifiedTime: entry.modifiedTime,
  };
}

/** @deprecated E7.2 — use buildOeIndexCardData for index-only views. */
export function buildOeSummaryFromIndex(entry: OeIndexEntry): {
  lookupKey: string;
  oeId: string;
  fileName: string;
  productName: string;
  cliente?: string;
  folderPath?: string;
  modifiedTime?: string;
  status: Status;
  loteGranel: string;
  batchSize: string;
  responsable: string;
  progressPercent: number;
} {
  const card = buildOeIndexCardData(entry);
  return {
    lookupKey: card.lookupKey,
    oeId: card.oeId,
    fileName: card.fileName,
    productName: card.title,
    cliente: card.cliente,
    folderPath: card.folderPath,
    modifiedTime: card.modifiedTime,
    status: card.status,
    loteGranel: "No detectado",
    batchSize: "No detectado",
    responsable: "No detectado",
    progressPercent: 0,
  };
}
