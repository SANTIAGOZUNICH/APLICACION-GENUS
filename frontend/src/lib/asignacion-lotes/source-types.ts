/** Fuentes configurables de Asignación de Lotes (Google Sheets). Ver 0032. */

export type AsignacionLoteSyncStatus = "nunca_sincronizado" | "ok" | "error" | "sincronizando";

export interface AsignacionLoteSource {
  id: string;
  name: string;
  period: string;
  spreadsheetId: string;
  sheetTab: string;
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
  sheetTab: string;
  enabled?: boolean;
  priority?: number;
}

export interface AsignacionLoteSourceUpdateInput {
  name?: string;
  period?: string;
  sheetTab?: string;
  enabled?: boolean;
  priority?: number;
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
