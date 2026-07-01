import { Factory } from "lucide-react";
import { PRODUCTION_ORDER_FLOW } from "@/config/entity-pages";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import {
  pickField,
  rowsToRecords,
} from "@/lib/adapters/sheets/parse-sheet-rows";
import type { OeIndexEntry, OeSheetFields } from "@/lib/adapters/drive/types/document.types";
import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";

/** Business fields extracted from inside an OE spreadsheet. */
export type { OeSheetFields } from "@/lib/adapters/drive/types/document.types";

function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Scan label/value pairs (column A = label, column B = value). */
function extractLabelValuePairs(rows: string[][]): Record<string, string> {
  const pairs: Record<string, string> = {};

  for (const row of rows.slice(0, 80)) {
    if (row.length < 2) continue;
    const label = row[0]?.trim();
    const value = row[1]?.trim();
    if (!label || !value) continue;
    pairs[normalizeLabel(label)] = value;
  }

  return pairs;
}

function mergeFieldSources(
  ...sources: Record<string, string>[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value.trim()) {
        merged[key] = value.trim();
      }
    }
  }
  return merged;
}

export function extractOeFieldsFromSheet(rows: string[][]): OeSheetFields {
  const labelPairs = extractLabelValuePairs(rows);
  const records = rowsToRecords(rows);
  const firstRecord = records[0] ?? {};
  const raw = mergeFieldSources(labelPairs, firstRecord);

  const oeId = pickField(
    raw,
    "oe_id",
    "oeid",
    "id_oe",
    "nro_oe",
    "numero_oe",
    "orden_elaboracion",
    "orden",
    "oe"
  );

  const producto = pickField(
    raw,
    "producto",
    "descripcion",
    "descripcion_producto",
    "granel",
    "nombre_producto",
    "nombre"
  );

  const cliente = pickField(
    raw,
    "cliente",
    "cliente_nombre",
    "marca",
    "cliente_id",
    "nombre_cliente"
  );

  const lote = pickField(
    raw,
    "lote_id",
    "lote",
    "lote_granel",
    "nro_lote",
    "numero_lote",
    "lote_granel_id"
  );

  const estado = pickField(
    raw,
    "estado",
    "estado_oe",
    "status",
    "estado_orden"
  );

  const responsable = pickField(
    raw,
    "responsable",
    "operario",
    "usuario",
    "elaborador"
  );

  const batch = pickField(
    raw,
    "batch",
    "tamano_batch",
    "cantidad",
    "kg",
    "tamano_de_batch",
    "volumen"
  );

  const fecha = pickField(
    raw,
    "fecha",
    "fecha_inicio",
    "fecha_oe",
    "inicio",
    "fecha_elaboracion"
  );

  return {
    oeId,
    lote,
    cliente,
    producto,
    estado,
    responsable,
    batch,
    fecha,
    raw,
  };
}

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

/** Build entity page using sheet content as source of truth for business fields. */
export function buildOeEntityPageFromFields(
  indexEntry: OeIndexEntry,
  fields: OeSheetFields
): EntityPageModel {
  const status = inferStatus(fields.estado || "En curso");
  const entityId = fields.oeId || indexEntry.fileId;
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
