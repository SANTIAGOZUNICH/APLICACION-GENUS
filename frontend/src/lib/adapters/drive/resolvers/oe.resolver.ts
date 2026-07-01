import "server-only";

import {
  buildOeEntityPageFromSheet,
  buildOeListItem,
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

  async getOeEntityPage(oeId: string): Promise<OeSheetBundle | null> {
    const entry = await operationsDocumentRepository.resolveOeById(oeId);
    if (!entry) return null;

    const rows = await sheetsReader.readFirstTab(entry.fileId);
    const entityPage = buildOeEntityPageFromSheet(entry, rows);

    return {
      oeId: entry.oeId,
      entityPage,
    };
  }
}

export const oeResolver = new OeResolver();
