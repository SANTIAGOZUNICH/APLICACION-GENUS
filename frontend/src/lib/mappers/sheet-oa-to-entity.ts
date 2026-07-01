import { Package } from "lucide-react";
import { PRODUCTION_ORDER_FLOW } from "@/config/entity-pages";
import { stripSheetExtension } from "@/lib/adapters/drive/oe-document-locator";
import type { OaIndexEntry, OaSheetFields } from "@/lib/adapters/drive/types/document.types";
import { rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";
import { EntityPageKinds, type EntityPageModel } from "@/types/entity-page";
import { Status } from "@/types/ui/status";
import {
  extractLabelValuePairs,
  inferOaStatus,
  mergeFieldSources,
  pickField,
} from "@/lib/mappers/sheet-field-resolver";

export function extractOaFieldsFromSheet(rows: string[][]): OaSheetFields {
  const labelPairs = extractLabelValuePairs(rows);
  const records = rowsToRecords(rows);
  const firstRecord = records[0] ?? {};
  const raw = mergeFieldSources(labelPairs, firstRecord);

  return {
    oaId: pickField(
      raw,
      "oa_id",
      "oaid",
      "id_oa",
      "nro_oa",
      "numero_oa",
      "orden_acondicionamiento",
      "oa"
    ),
    sku: pickField(raw, "sku", "producto", "descripcion", "pt", "nombre_producto"),
    lotePt: pickField(raw, "lote_pt", "lotept", "lote", "nro_lote", "numero_lote"),
    loteGranel: pickField(raw, "lote_granel", "granel", "lote_granel_id"),
    oeRef: pickField(raw, "oe", "oe_id", "oe_ref", "orden_elaboracion"),
    unidades: pickField(raw, "unidades", "cantidad", "qty", "total"),
    estado: pickField(raw, "estado", "estado_oa", "status"),
    responsable: pickField(raw, "responsable", "operario", "usuario"),
    avance: pickField(raw, "avance", "progress", "porcentaje"),
    raw,
  };
}

function inferStageId(status: Status): string {
  switch (status) {
    case Status.PLANIFICADA:
      return "planificada";
    case Status.CERRADA:
      return "cerrada";
    default:
      return "en-curso";
  }
}

function titleFromFields(indexEntry: OaIndexEntry, fields: OaSheetFields): string {
  if (fields.sku) return fields.sku;
  return stripSheetExtension(indexEntry.fileName);
}

export function buildOaEntityPageFromFields(
  indexEntry: OaIndexEntry,
  fields: OaSheetFields
): EntityPageModel {
  const status = inferOaStatus(fields.estado || "En curso");
  const entityId = fields.oaId || indexEntry.fileSlug || indexEntry.fileId;
  const title = titleFromFields(indexEntry, fields);

  const keyValueItems = [
    ...(fields.oaId ? [{ id: "oa-id", label: "OA ID", value: fields.oaId }] : []),
    { id: "archivo", label: "Archivo", value: indexEntry.fileName },
    ...(fields.sku ? [{ id: "sku", label: "SKU", value: fields.sku }] : []),
    ...(fields.unidades
      ? [{ id: "unidades", label: "Unidades", value: fields.unidades }]
      : []),
    ...(fields.lotePt
      ? [{ id: "lote-pt", label: "Lote PT", value: fields.lotePt }]
      : []),
    ...(fields.loteGranel
      ? [{ id: "lote-granel", label: "Lote granel", value: fields.loteGranel }]
      : []),
    ...(fields.oeRef ? [{ id: "oe", label: "OE origen", value: fields.oeRef }] : []),
    ...(fields.estado
      ? [{ id: "estado", label: "Estado", value: fields.estado }]
      : []),
    ...(fields.responsable
      ? [{ id: "responsable", label: "Responsable", value: fields.responsable }]
      : []),
    ...(fields.avance ? [{ id: "avance", label: "Avance", value: fields.avance }] : []),
  ];

  return {
    kind: EntityPageKinds.OA,
    entityId,
    title,
    subtitle: fields.unidades
      ? `${fields.unidades} unidades`
      : `Acondicionamiento · ${stripSheetExtension(indexEntry.fileName)}`,
    status,
    identityIcon: Package,
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
        id: "oa-loaded",
        timestamp: new Date().toISOString(),
        user: "Sistema",
        action: "Lectura desde Drive",
        description: fields.oaId
          ? `OA ${fields.oaId} resuelta desde el contenido del Sheet.`
          : `Documento ${indexEntry.fileName} abierto; OA ID no encontrado en el Sheet.`,
      },
    ],
    relatedObjects: [],
  };
}

export function buildOaEntityPageFromSheet(
  indexEntry: OaIndexEntry,
  rows: string[][]
): EntityPageModel {
  return buildOaEntityPageFromFields(indexEntry, extractOaFieldsFromSheet(rows));
}

export function buildOaListItem(entry: OaIndexEntry) {
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    fileSlug: entry.fileSlug,
    folderPath: entry.folderPath,
    modifiedTime: entry.modifiedTime,
  };
}

export function buildOaSummaryFromIndex(entry: OaIndexEntry): {
  lookupKey: string;
  oaId: string;
  skuName: string;
  status: Status;
  lotePt: string;
  unidades: string;
  responsable: string;
  progressPercent: number;
} {
  const status: Status = Status.EN_CURSO;
  return {
    lookupKey: entry.fileSlug || entry.fileId,
    oaId: entry.fileSlug,
    skuName: stripSheetExtension(entry.fileName),
    status,
    lotePt: "—",
    unidades: "—",
    responsable: "—",
    progressPercent: 50,
  };
}

/** Build minimal OA entity page from PEDIDOS row when no dedicated Sheet exists. */
export function buildOaEntityPageFromPedidoRow(
  oaId: string,
  records: Record<string, string>[]
): EntityPageModel | null {
  const matching = records.filter((record) => {
    const rowOa = pickField(record, "oa", "oa_id", "OA_ID", "orden_acondicionamiento");
    return rowOa.trim().toLowerCase() === oaId.trim().toLowerCase();
  });

  if (matching.length === 0) return null;

  const first = matching[0];
  const sku = pickField(first, "producto", "PRODUCTO_ID", "sku", "pt", "descripcion");
  const estado = pickField(first, "estado", "estado_oa", "status");
  const status = inferOaStatus(estado || "En curso");

  return {
    kind: EntityPageKinds.OA,
    entityId: oaId,
    title: sku || oaId,
    subtitle: `Derivado de PEDIDOS 2026`,
    status,
    identityIcon: Package,
    statusFlow: PRODUCTION_ORDER_FLOW,
    currentStageId: status === Status.CERRADA ? "cerrada" : "en-curso",
    sections: [
      {
        id: "datos",
        title: "Datos de la orden",
        description: "Resumen construido desde renglones de PEDIDOS 2026.",
        content: {
          type: "key-values",
          items: [
            { id: "oa-id", label: "OA ID", value: oaId },
            ...(sku ? [{ id: "sku", label: "SKU", value: sku }] : []),
            ...(estado ? [{ id: "estado", label: "Estado", value: estado }] : []),
          ],
        },
      },
      {
        id: "renglones",
        title: "Renglones vinculados",
        content: {
          type: "audit-table",
          table: {
            id: `oa-pedidos-${oaId}`,
            columns: [
              { id: "pedido", label: "Pedido" },
              { id: "producto", label: "Producto" },
              { id: "cantidad", label: "Cantidad" },
              { id: "estado", label: "Estado" },
            ],
            rows: matching.map((record, index) => ({
              id: `row-${index}`,
              cells: {
                pedido: pickField(record, "pedidoId", "PEDIDO_ID", "pedido"),
                producto: pickField(record, "producto", "PRODUCTO_ID", "sku", "pt"),
                cantidad: pickField(record, "cantidad", "cantidad_pedida", "qty"),
                estado: pickField(record, "estado", "estado_pedido", "status"),
              },
            })),
          },
        },
      },
    ],
    activityLog: [],
    relatedObjects: [],
  };
}
