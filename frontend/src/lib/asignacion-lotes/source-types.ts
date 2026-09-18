/** Fuentes configurables de Asignación de Lotes (Google Sheets). Ver 0032. */

export type AsignacionLoteSyncStatus = "nunca_sincronizado" | "ok" | "error" | "sincronizando";

export interface AsignacionLoteSource {
  id: string;
  name: string;
  period: string;
  spreadsheetId: string;
  /** null = descubrir e importar TODAS las hojas compatibles del spreadsheet. */
  sheetTab: string | null;
  enabled: boolean;
  priority: number;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  syncStatus: AsignacionLoteSyncStatus;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AsignacionLoteSourceInput {
  name: string;
  period: string;
  /** URL completa pegada por el usuario, o el spreadsheetId puro — se extrae automáticamente. */
  spreadsheetUrlOrId: string;
  /** Opcional — vacío/omitido = descubrir e importar TODAS las hojas compatibles. */
  sheetTab?: string | null;
  enabled?: boolean;
  priority?: number;
}

export interface AsignacionLoteSourceUpdateInput {
  name?: string;
  period?: string;
  sheetTab?: string | null;
  enabled?: boolean;
  priority?: number;
}

export interface ImportPreviewConflictSample {
  lote: string;
  codigo: string;
  producto: string;
  motivo: string;
  /** Presente solo en conflictos ENTRE hojas de la misma fuente. */
  tabs?: string[];
}

/** Desglose por hoja — presente solo cuando la fuente no fija una hoja específica. */
export interface ImportPreviewSheetBreakdown {
  tab: string;
  compatible: boolean;
  ignoredReason?: string;
  rowsFound: number;
  nuevas: number;
  existentes: number;
  conflictos: number;
  invalidas: number;
}

/**
 * Vista previa de importación (antes de conectar una fuente definitivamente,
 * o antes de una sincronización manual) — nunca persiste nada. "Existentes"
 * = mismo lote+código y mismos datos que un registro ya presente en GENUS OS
 * (manual/Excel/otra fuente) — informativo, se ignora igual que siempre.
 * "Conflictos" = mismo lote+código pero ALGÚN dato difiere — requiere
 * revisión humana, nunca se fusiona ni se sobreescribe en silencio.
 */
export interface ImportPreviewResult {
  ok: boolean;
  rowsFound: number;
  nuevas: number;
  existentes: number;
  conflictos: number;
  invalidas: number;
  conflictSamples: ImportPreviewConflictSample[];
  /** Presente solo en modo multi-hoja (sheetTab vacío). */
  sheets?: ImportPreviewSheetBreakdown[];
  error?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  spreadsheetAccessible: boolean;
  sheetFound: boolean;
  availableTabs: string[];
  headersRecognized: string[];
  headersUnrecognized: string[];
  rowCount: number;
  error?: string;
}

export type SyncTriggerKind = "manual" | "opportunistic" | "cron";

export interface SyncRunSummary {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "en_progreso" | "ok" | "error" | "parcial";
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  invalidCount: number;
  archivedCount: number;
  conflictCount: number;
  errorMessage: string | null;
  triggeredBy: string;
  triggerKind: SyncTriggerKind;
}
