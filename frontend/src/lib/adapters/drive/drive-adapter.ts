import "server-only";

import type {
  LoteSheetBundle,
  OaSheetBundle,
  OeSheetBundle,
  LiberacionSheetBundle,
  OperationsAdapter,
  PedidoSheetBundle,
} from "@/lib/adapters/operations-adapter";
import { mockAdapter } from "@/lib/adapters/mock-adapter";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { oaResolver } from "@/lib/adapters/drive/resolvers/oa.resolver";
import { liberacionResolver } from "@/lib/adapters/drive/resolvers/liberacion.resolver";
import { operationsStateResolver } from "@/lib/adapters/drive/resolvers/operations-state.resolver";

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

  listLotes(): Promise<LoteSheetBundle[]> {
    return this.listLoteEntityPages();
  }

  getLote(loteId: string): Promise<LoteSheetBundle | null> {
    return this.getLoteEntityPage(loteId);
  }

  listPedidos() {
    return pedidoResolver.listPedidos();
  }

  getPedidoEntityPage(pedidoId: string): Promise<PedidoSheetBundle | null> {
    return pedidoResolver.getPedidoEntityPage(pedidoId);
  }

  getPedido(pedidoId: string): Promise<PedidoSheetBundle | null> {
    return this.getPedidoEntityPage(pedidoId);
  }

  listOeIndex() {
    return oeResolver.listOeIndex();
  }

  getOeEntityPage(lookupKey: string): Promise<OeSheetBundle | null> {
    return oeResolver.getOeEntityPage(lookupKey);
  }

  listOE() {
    return this.listOeIndex();
  }

  getOE(lookupKey: string): Promise<OeSheetBundle | null> {
    return this.getOeEntityPage(lookupKey);
  }

  listOaIndex() {
    return oaResolver.listOaIndex();
  }

  getOaEntityPage(lookupKey: string): Promise<OaSheetBundle | null> {
    return oaResolver.getOaEntityPage(lookupKey);
  }

  listOA() {
    return this.listOaIndex();
  }

  getOA(lookupKey: string): Promise<OaSheetBundle | null> {
    return this.getOaEntityPage(lookupKey);
  }

  listLiberaciones() {
    return liberacionResolver.listLiberaciones();
  }

  getLiberacionEntityPage(lookupKey: string): Promise<LiberacionSheetBundle | null> {
    return liberacionResolver.getLiberacionEntityPage(lookupKey);
  }

  getLiberacion(lookupKey: string): Promise<LiberacionSheetBundle | null> {
    return this.getLiberacionEntityPage(lookupKey);
  }

  buildOperationsHydration() {
    return operationsStateResolver.buildHydration();
  }
}

export const driveAdapter = new DriveAdapter();
