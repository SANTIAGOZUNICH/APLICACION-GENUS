import "server-only";

import {
  buildLoteEntityPagesFromAsignacion,
  findLoteEntityPage,
} from "@/lib/adapters/drive/mappers/lote-asignacion.mapper";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import type { LoteSheetBundle } from "@/lib/adapters/operations-adapter";

const TAB_CANDIDATES = [
  process.env.SHEETS_TAB_ASIGNACION_LOTES?.trim(),
  "ASIGNACION",
  "LOTES",
  "Hoja 1",
].filter(Boolean) as string[];

export class LoteResolver {
  private sheetRowsCache: string[][] | null = null;

  async listLoteEntityPages(): Promise<LoteSheetBundle[]> {
    const rows = await this.readAsignacionRows();
    return buildLoteEntityPagesFromAsignacion(rows).map((entityPage) => ({
      loteId: entityPage.entityId,
      entityPage,
    }));
  }

  async getLoteEntityPage(loteId: string): Promise<LoteSheetBundle | null> {
    const rows = await this.readAsignacionRows();
    const entityPage = findLoteEntityPage(rows, loteId);
    if (!entityPage) return null;
    return { loteId: entityPage.entityId, entityPage };
  }

  async readAsignacionRows(): Promise<string[][]> {
    return this.readAsignacionRowsInternal();
  }

  private async readAsignacionRowsInternal(): Promise<string[][]> {
    if (this.sheetRowsCache) return this.sheetRowsCache;

    const docRef =
      await operationsDocumentRepository.getCriticalSheetRef(
        "asignacion_lotes_2026"
      );

    for (const tabName of TAB_CANDIDATES) {
      try {
        const rows = await sheetsReader.readTab(docRef.fileId, tabName);
        if (rows.length > 1) {
          this.sheetRowsCache = rows;
          return rows;
        }
      } catch {
        continue;
      }
    }

    const rows = await sheetsReader.readFirstTab(docRef.fileId);
    this.sheetRowsCache = rows;
    return rows;
  }
}

export const loteResolver = new LoteResolver();
