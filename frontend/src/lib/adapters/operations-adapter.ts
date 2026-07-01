import type { OperationsState } from "@/types/actions";
import type { EntityPageModel } from "@/types/entity-page";
import type {
  OeListItem,
  OeSheetFields,
  PedidoSummary,
} from "@/lib/adapters/drive/types/document.types";

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

  /** OE index (file metadata) and resolution by fileId/name/business OE_ID. */
  listOeIndex?(): Promise<OeListItem[]>;
  getOeEntityPage?(lookupKey: string): Promise<OeSheetBundle | null>;
}
