import "server-only";

import { parsePedidoSummaries } from "@/lib/adapters/drive/mappers/pedido.mapper";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { PedidoSummary } from "@/lib/adapters/drive/types/document.types";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";

const TAB_CANDIDATES = [
  process.env.SHEETS_TAB_PEDIDOS?.trim(),
  "PEDIDOS",
  "Pedidos",
  "Hoja 1",
].filter(Boolean) as string[];

export class PedidoResolver {
  async listPedidos(): Promise<PedidoSummary[]> {
    const docRef =
      await operationsDocumentRepository.getCriticalSheetRef("pedidos_2026");

    for (const tabName of TAB_CANDIDATES) {
      try {
        const rows = await sheetsReader.readTab(docRef.fileId, tabName);
        if (rows.length > 1) {
          return parsePedidoSummaries(rows);
        }
      } catch {
        continue;
      }
    }

    const rows = await sheetsReader.readFirstTab(docRef.fileId);
    return parsePedidoSummaries(rows);
  }
}

export const pedidoResolver = new PedidoResolver();
