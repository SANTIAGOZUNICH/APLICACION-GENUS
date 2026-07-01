import { Factory } from "lucide-react";
import { PRODUCTION_ORDER_FLOW } from "@/config/entity-pages";
import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";
import type { OeIndexEntry, OeSheetFields } from "@/lib/adapters/drive/types/document.types";
import { rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import {
  extractLabelValuePairs,
  inferOeStatus,
  mergeFieldSources,
  pickField,
} from "@/lib/mappers/sheet-field-resolver";

export type { OeSheetFields };

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

function titleFromFileAndFields(
  indexEntry: OeIndexEntry,
  fields: OeSheetFields
): string {
  if (fields.producto && fields.cliente) {
    return `${fields.producto} · ${fields.cliente}`;
  }
  if (fields.producto) return fields.producto;
  return stripSheetExtension(indexEntry.fileName);
}

export function buildOeEntityPageFromFields(
  indexEntry: OeIndexEntry,
  fields: OeSheetFields
): EntityPageModel {
  const status = inferOeStatus(fields.estado || "En curso");
  const entityId = fields.oeId || indexEntry.fileSlug || indexEntry.fileId;
  const title = titleFromFileAndFields(indexEntry, fields);

  const keyValueItems = [
    ...(fields.oeId
      ? [{ id: "oe-id", label: "OE ID", value: fields.oeId }]
      : []),
    { id: "archivo", label: "Archivo", value: indexEntry.fileName },
    ...(fields.producto
      ? [{ id: "producto", label: "Producto", value: fields.producto }]
      : []),
    ...(fields.cliente
      ? [{ id: "cliente", label: "Cliente", value: fields.cliente }]
      : []),
    ...(fields.lote
      ? [{ id: "lote", label: "Lote granel", value: fields.lote }]
      : []),
    ...(fields.estado
      ? [{ id: "estado", label: "Estado", value: fields.estado }]
      : []),
    ...(fields.batch
      ? [{ id: "batch", label: "Batch", value: fields.batch }]
      : []),
    ...(fields.responsable
      ? [{ id: "responsable", label: "Responsable", value: fields.responsable }]
      : []),
    ...(fields.fecha
      ? [{ id: "fecha", label: "Fecha", value: fields.fecha }]
      : []),
  ];

  return {
    kind: EntityPageKinds.OE,
    entityId,
    title,
    subtitle: fields.cliente
      ? `Cliente · ${fields.cliente}`
      : `Elaboración · ${stripSheetExtension(indexEntry.fileName)}`,
    status,
    identityIcon: Factory,
    statusFlow: PRODUCTION_ORDER_FLOW,
    currentStageId: inferStageId(status),
    sections: [
      {
        id: "datos",
        title: "Datos de la orden",
        description: `Contenido leído desde ${indexEntry.fileName}`,
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
        description: fields.oeId
          ? `OE ${fields.oeId} resuelta desde el contenido del Sheet.`
          : `Documento ${indexEntry.fileName} abierto; OE ID no encontrado en el Sheet.`,
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

/** Parse producto/cliente from real OE file names like "CREMA NIACINAMIDA - ICONO". */
export function parseOeFileNameMetadata(fileName: string): {
  producto: string;
  cliente?: string;
} {
  const base = stripSheetExtension(fileName);
  const parts = base
    .split(/\s[-–|]\s/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      producto: parts[0],
      cliente: parts.slice(1).join(" · "),
    };
  }

  return { producto: base };
}

function formatModifiedLabel(modifiedTime?: string): string {
  if (!modifiedTime) return "Sin fecha de modificación";
  const date = new Date(modifiedTime);
  if (Number.isNaN(date.getTime())) return modifiedTime;
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Lightweight summary from index metadata — no sheet read, no fictional fields. */
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
  const parsed = parseOeFileNameMetadata(entry.fileName);
  const productName = parsed.cliente
    ? `${parsed.producto} · ${parsed.cliente}`
    : parsed.producto;
  const status: Status = Status.EN_CURSO;

  return {
    lookupKey: entry.fileSlug || entry.fileId,
    oeId: entry.fileSlug || entry.fileId,
    fileName: entry.fileName,
    productName,
    cliente: parsed.cliente,
    folderPath: entry.folderPath,
    modifiedTime: entry.modifiedTime,
    status,
    loteGranel: "Sin dato en índice",
    batchSize: formatModifiedLabel(entry.modifiedTime),
    responsable: entry.folderPath?.split("/").pop() || "Sin carpeta",
    progressPercent: 50,
  };
}
