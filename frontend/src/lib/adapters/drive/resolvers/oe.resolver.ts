import "server-only";

import {
  buildOeEntityPageFromFields,
  buildOeListItem,
  extractOeFieldsFromSheet,
} from "@/lib/adapters/drive/mappers/oe-sheet.mapper";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { OeListItem } from "@/lib/adapters/drive/types/document.types";
import type { OeSheetBundle } from "@/lib/adapters/operations-adapter";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

export class OeResolver {
  async listOeIndex(): Promise<OeListItem[]> {
    const index = await operationsDocumentRepository.getOeIndex();
    return index.map(buildOeListItem);
  }

  /**
   * Resolve an OE by fileId, file slug, file name, or business OE_ID (from sheet).
   * Opens the Sheet and extracts business fields from content.
   */
  async getOeEntityPage(lookupKey: string): Promise<OeSheetBundle | null> {
    const entry = await operationsDocumentRepository.resolveOeDocument(lookupKey);
    if (!entry) return null;

    const rows = await sheetsReader.readFirstTab(entry.fileId);
    const fields = extractOeFieldsFromSheet(rows);

    if (fields.oeId) {
      operationsDocumentRepository.registerOeBusinessId(
        fields.oeId,
        entry.fileId
      );
    }

    const entityPage = buildOeEntityPageFromFields(entry, fields);

    return {
      fileId: entry.fileId,
      fileName: entry.fileName,
      oeId: fields.oeId || undefined,
      fields,
      entityPage,
    };
  }
}

export const oeResolver = new OeResolver();
