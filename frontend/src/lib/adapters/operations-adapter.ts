import type { OperationsState } from "@/types/actions";
import type { EntityPageModel } from "@/types/entity-page";

/** Raw bundle for a lote entity page sourced from Sheets. */
export interface LoteSheetBundle {
  loteId: string;
  entityPage: EntityPageModel;
}

/**
 * OperationsAdapter — swappable data source for OperationsStore.
 * MockAdapter seeds the full UI; SheetsAdapter supplies real lote pages.
 */
export interface OperationsAdapter {
  readonly mode: "demo" | "real";

  /** Full initial state (mocks for everything except optional lote overrides). */
  getInitialState(): OperationsState;

  /** Fetch a single lote entity page from the real backend, if supported. */
  getLoteEntityPage?(loteId: string): Promise<LoteSheetBundle | null>;

  /** Fetch all lote entity pages available in Sheets. */
  listLoteEntityPages?(): Promise<LoteSheetBundle[]>;
}
