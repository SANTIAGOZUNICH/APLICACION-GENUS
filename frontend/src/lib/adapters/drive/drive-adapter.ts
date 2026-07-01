import "server-only";

import type {
  LoteSheetBundle,
  OeSheetBundle,
  OperationsAdapter,
} from "@/lib/adapters/operations-adapter";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";

/** Real-data adapter — resolves documents via OperationsDocumentRepository. */
export class DriveAdapter implements OperationsAdapter {
  readonly mode = "real" as const;

  getInitialState() {
    return mockAdapter.getInitialState();
  }

  listLoteEntityPages(): Promise<LoteSheetBundle[]> {
    return loteResolver.listLoteEntityPages();
  }

  getLoteEntityPage(loteId: string): Promise<LoteSheetBundle | null> {
    return loteResolver.getLoteEntityPage(loteId);
  }

  listPedidos() {
    return pedidoResolver.listPedidos();
  }

  listOeIndex() {
    return oeResolver.listOeIndex();
  }

  getOeEntityPage(lookupKey: string): Promise<OeSheetBundle | null> {
    return oeResolver.getOeEntityPage(lookupKey);
  }
}

export const driveAdapter = new DriveAdapter();
