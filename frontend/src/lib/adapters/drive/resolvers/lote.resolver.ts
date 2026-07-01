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

export interface SheetReadMeta {
  rows: string[][];
  tabUsed?: string;
  tabsAttempted: string[];
}

export class LoteResolver {
  private sheetRowsCache: string[][] | null = null;
  private sheetReadMetaCache: SheetReadMeta | null = null;

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
    return this.readAsignacionWithMeta().then((result) => result.rows);
  }

  async readAsignacionWithMeta(): Promise<SheetReadMeta> {
    if (this.sheetReadMetaCache) return this.sheetReadMetaCache;

    const docRef =
      await operationsDocumentRepository.getCriticalSheetRef(
        "asignacion_lotes_2026"
      );

    for (const tabName of TAB_CANDIDATES) {
      try {
        const rows = await sheetsReader.readTab(docRef.fileId, tabName);
        if (rows.length > 1) {
          const meta = {
            rows,
            tabUsed: tabName,
            tabsAttempted: [...TAB_CANDIDATES],
          };
          this.sheetRowsCache = rows;
          this.sheetReadMetaCache = meta;
          return meta;
        }
      } catch {
        continue;
      }
    }

    const rows = await sheetsReader.readFirstTab(docRef.fileId);
    const meta = {
      rows,
      tabUsed: rows.length > 1 ? "first-tab" : undefined,
      tabsAttempted: [...TAB_CANDIDATES, "first-tab"],
    };
    this.sheetRowsCache = rows;
    this.sheetReadMetaCache = meta;
    return meta;
  }
}

export const loteResolver = new LoteResolver();
