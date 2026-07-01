import type { OperationsState } from "@/types/actions";
import type { EntityPageModel } from "@/types/entity-page";
import type {
  OeListItem,
  PedidoSummary,
} from "@/lib/adapters/drive/types/document.types";

/** Raw bundle for a lote entity page sourced from Drive/Sheets. */
export interface LoteSheetBundle {
  loteId: string;
  entityPage: EntityPageModel;
}

export interface OeSheetBundle {
  oeId: string;
  entityPage: EntityPageModel;
}

/**
 * OperationsAdapter — swappable data source for OperationsStore.
 * MockAdapter seeds the full UI; DriveAdapter supplies real document-backed data.
 */
export interface OperationsAdapter {
  readonly mode: "demo" | "real";

  /** Full initial state (mocks for everything except optional overrides). */
  getInitialState(): OperationsState;

  /** Fetch lote entity pages from ASIGNACION DE LOTES 2026. */
  listLoteEntityPages?(): Promise<LoteSheetBundle[]>;
  getLoteEntityPage?(loteId: string): Promise<LoteSheetBundle | null>;

  /** PEDIDOS 2026 summaries. */
  listPedidos?(): Promise<PedidoSummary[]>;

  /** OE index (metadata only) and single OE resolution via index. */
  listOeIndex?(): Promise<OeListItem[]>;
  getOeEntityPage?(oeId: string): Promise<OeSheetBundle | null>;
}
