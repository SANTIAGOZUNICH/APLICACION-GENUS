import type { OperationsState } from "@/types/actions";
import type { EntityPageModel } from "@/types/entity-page";
import type {
  LiberacionListItem,
  OaListItem,
  OaSheetFields,
  OeListItem,
  OeSheetFields,
  PedidoSummary,
} from "@/lib/adapters/drive/types/document.types";
import type { OperationsHydration } from "@/lib/adapters/drive/resolvers/operations-state.resolver";

/** Raw bundle for a lote entity page sourced from Drive/Sheets. */
export interface LoteSheetBundle {
  loteId: string;
  entityPage: EntityPageModel;
}

export interface OeSheetBundle {
  fileId: string;
  fileName: string;
  /** Business OE_ID extracted from sheet content, if present. */
  oeId?: string;
  fields: OeSheetFields;
  entityPage: EntityPageModel;
}

export interface OaSheetBundle {
  fileId: string;
  fileName: string;
  oaId?: string;
  fields: OaSheetFields;
  entityPage: EntityPageModel;
}

export interface PedidoSheetBundle {
  pedidoId: string;
  entityPage: EntityPageModel;
}

export interface LiberacionSheetBundle {
  liberacionId: string;
  loteId: string;
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
  listLotes?(): Promise<LoteSheetBundle[]>;
  getLote?(loteId: string): Promise<LoteSheetBundle | null>;

  /** PEDIDOS 2026 summaries and entity pages. */
  listPedidos?(): Promise<PedidoSummary[]>;
  getPedidoEntityPage?(pedidoId: string): Promise<PedidoSheetBundle | null>;
  getPedido?(pedidoId: string): Promise<PedidoSheetBundle | null>;

  /** OE index (file metadata) and resolution by fileId/name/business OE_ID. */
  listOeIndex?(): Promise<OeListItem[]>;
  getOeEntityPage?(lookupKey: string): Promise<OeSheetBundle | null>;
  listOE?(): Promise<OeListItem[]>;
  getOE?(lookupKey: string): Promise<OeSheetBundle | null>;

  /** OA index and resolution. */
  listOaIndex?(): Promise<OaListItem[]>;
  getOaEntityPage?(lookupKey: string): Promise<OaSheetBundle | null>;
  listOA?(): Promise<OaListItem[]>;
  getOA?(lookupKey: string): Promise<OaSheetBundle | null>;

  /** Liberaciones derived from lotes en cuarentena/revisión. */
  listLiberaciones?(): Promise<LiberacionListItem[]>;
  getLiberacionEntityPage?(lookupKey: string): Promise<LiberacionSheetBundle | null>;
  getLiberacion?(lookupKey: string): Promise<LiberacionSheetBundle | null>;

  /** Bandeja + workspaces from cached operational data. */
  buildOperationsHydration?(): Promise<OperationsHydration>;
}
