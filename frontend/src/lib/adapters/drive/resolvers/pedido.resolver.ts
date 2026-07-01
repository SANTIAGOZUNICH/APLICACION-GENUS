import "server-only";

import { readTabularFile } from "@/lib/adapters/excel/tabular-file-reader";
import { buildPedidoEntityPageFromSheet } from "@/lib/mappers/sheet-pedido-to-entity";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { DocumentRef } from "@/lib/adapters/drive/types/document.types";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import type { PedidoSheetBundle } from "@/lib/adapters/operations-adapter";
import type { TabularReaderKind } from "@/lib/adapters/excel/excel-mime";

const TAB_CANDIDATES = [
  process.env.SHEETS_TAB_PEDIDOS?.trim(),
  "PEDIDOS",
  "Pedidos",
  "Hoja 1",
].filter(Boolean) as string[];

export interface PedidoReadMeta {
  rows: string[][];
  tabUsed?: string;
  tabsAttempted: string[];
  mimeType?: string;
  readerUsed?: TabularReaderKind;
  warning?: string;
  fileId?: string;
  fileName?: string;
}

export class PedidoResolver {
  private readCache: PedidoReadMeta | null = null;

  async listPedidos(): Promise<PedidoSummary[]> {
    const meta = await this.readPedidosWithMeta();
    return parsePedidosWithDiagnostics(meta.rows).pedidos;
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

  async readPedidosWithMeta(): Promise<PedidoReadMeta> {
    if (this.readCache) return this.readCache;

    const docRef =
      await operationsDocumentRepository.tryGetCriticalSheetRef("pedidos_2026");

    if (!docRef) {
      const meta: PedidoReadMeta = {
        rows: [],
        tabsAttempted: TAB_CANDIDATES,
        warning: "PEDIDOS 2026 no indexado en Drive. Ejecutá /api/v1/drive/refresh.",
      };
      this.readCache = meta;
      return meta;
    }

    const meta = await this.readPedidosFromDocRef(docRef);
    this.readCache = meta;
    return meta;
  }

  private async readPedidosFromDocRef(docRef: DocumentRef): Promise<PedidoReadMeta> {
    const result = await readTabularFile(docRef, TAB_CANDIDATES);

    return {
      rows: result.rows,
      tabUsed: result.tabUsed,
      tabsAttempted: result.tabsAttempted,
      mimeType: result.mimeType,
      readerUsed: result.readerUsed,
      warning: result.warning,
      fileId: docRef.fileId,
      fileName: docRef.name,
    };
  }
}

export const pedidoResolver = new PedidoResolver();
