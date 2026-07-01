import "server-only";

import {
  buildPedidoEntityPageFromSheet,
} from "@/lib/mappers/sheet-pedido-to-entity";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import type { PedidoSheetBundle } from "@/lib/adapters/operations-adapter";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

const TAB_CANDIDATES = [
  process.env.SHEETS_TAB_PEDIDOS?.trim(),
  "PEDIDOS",
  "Pedidos",
  "Hoja 1",
].filter(Boolean) as string[];

export interface SheetReadMeta {
  rows: string[][];
  tabUsed?: string;
  tabsAttempted: string[];
}

export class PedidoResolver {
  private sheetRowsCache: string[][] | null = null;
  private sheetReadMetaCache: SheetReadMeta | null = null;

  async listPedidos(): Promise<PedidoSummary[]> {
    const { rows } = await this.readPedidosWithMeta();
    return parsePedidosWithDiagnostics(rows).pedidos;
  }

  async getPedidoEntityPage(pedidoId: string): Promise<PedidoSheetBundle | null> {
    const { rows } = await this.readPedidosWithMeta();
    const entityPage = buildPedidoEntityPageFromSheet(pedidoId, rows);
    if (!entityPage) return null;

    return {
      pedidoId: entityPage.entityId,
      entityPage,
    };
  }

  async readPedidoRows(): Promise<string[][]> {
    return this.readPedidosWithMeta().then((result) => result.rows);
  }

  async readPedidosWithMeta(): Promise<SheetReadMeta> {
    if (this.sheetReadMetaCache) return this.sheetReadMetaCache;

    const docRef =
      await operationsDocumentRepository.getCriticalSheetRef("pedidos_2026");

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

export const pedidoResolver = new PedidoResolver();
