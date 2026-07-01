import "server-only";

import {
  aggregatePedidoSummaries,
  buildPedidoEntityPageFromSheet,
} from "@/lib/mappers/sheet-pedido-to-entity";
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

export class PedidoResolver {
  private sheetRowsCache: string[][] | null = null;

  async listPedidos(): Promise<PedidoSummary[]> {
    const rows = await this.readPedidoRows();
    return aggregatePedidoSummaries(rows);
  }

  async getPedidoEntityPage(pedidoId: string): Promise<PedidoSheetBundle | null> {
    const rows = await this.readPedidoRows();
    const entityPage = buildPedidoEntityPageFromSheet(pedidoId, rows);
    if (!entityPage) return null;

    return {
      pedidoId: entityPage.entityId,
      entityPage,
    };
  }

  async readPedidoRows(): Promise<string[][]> {
    if (this.sheetRowsCache) return this.sheetRowsCache;

    const docRef =
      await operationsDocumentRepository.getCriticalSheetRef("pedidos_2026");

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

export const pedidoResolver = new PedidoResolver();
