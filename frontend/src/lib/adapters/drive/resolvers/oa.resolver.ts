import "server-only";

import {
  buildOaEntityPageFromFields,
  buildOaEntityPageFromPedidoRow,
  buildOaListItem,
  extractOaFieldsFromSheet,
} from "@/lib/mappers/sheet-oa-to-entity";
import { rowsToRecords } from "@/lib/adapters/sheets/parse-sheet-rows";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { OaListItem } from "@/lib/adapters/drive/types/document.types";
import type { OaSheetBundle } from "@/lib/adapters/operations-adapter";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";

export class OaResolver {
  async listOaIndex(): Promise<OaListItem[]> {
    const index = await operationsDocumentRepository.getOaIndex();
    return index.map(buildOaListItem);
  }

  async getOaEntityPage(lookupKey: string): Promise<OaSheetBundle | null> {
    const entry = await operationsDocumentRepository.resolveOaDocument(lookupKey);

    if (entry) {
      const rows = await sheetsReader.readFirstTab(entry.fileId);
      const fields = extractOaFieldsFromSheet(rows);

      if (fields.oaId) {
        operationsDocumentRepository.registerOaBusinessId(fields.oaId, entry.fileId);
      }

      const entityPage = buildOaEntityPageFromFields(entry, fields);

      return {
        fileId: entry.fileId,
        fileName: entry.fileName,
        oaId: fields.oaId || undefined,
        fields,
        entityPage,
      };
    }

    const pedidoRows = await pedidoResolver.readPedidoRows();
    const entityPage = buildOaEntityPageFromPedidoRow(
      lookupKey,
      rowsToRecords(pedidoRows)
    );

    if (!entityPage) return null;

    return {
      fileId: lookupKey,
      fileName: lookupKey,
      oaId: lookupKey,
      fields: {
        oaId: lookupKey,
        sku: entityPage.title,
        lotePt: "",
        loteGranel: "",
        oeRef: "",
        unidades: "",
        estado: String(entityPage.status),
        responsable: "",
        avance: "",
        raw: {},
      },
      entityPage,
    };
  }
}

export const oaResolver = new OaResolver();
