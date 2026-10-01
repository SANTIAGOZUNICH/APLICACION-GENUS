/** Fuentes configurables de Asignación de Lotes (Google Sheets). Ver 0032. */

export type AsignacionLoteSyncStatus = "nunca_sincronizado" | "ok" | "error" | "sincronizando";

export interface AsignacionLoteSource {
  id: string;
  name: string;
  period: string;
  spreadsheetId: string;
  /**
   * UNA FUENTE = UNA HOJA (decisión de producto, hotfix post-#98) — siempre
   * obligatoria para conexiones nuevas. Puede ser `null` solo en registros
   * legacy conectados durante la breve ventana en que fue opcional (#97);
   * esas fuentes no sincronizan hasta que se les asigna una hoja específica
   * (nunca se asume ni se descubre automáticamente).
   */
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
  /** Obligatoria — una fuente = una hoja, nunca se descubre automáticamente. */
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

export interface ImportPreviewConflictSample {
  lote: string;
  codigo: string;
  producto: string;
  motivo: string;
  /** Presente solo en conflictos ENTRE hojas de un mismo spreadsheet multi-tab. */
  tabs?: [string, string];
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
  /** 0038 — filas con lote real que importarían igual (created/updated) pero con 1+ campo secundario incompleto/no parseable; nunca se descartan. */
  incompletas: number;
  /** 0039 — filas que coincidirían inequívocamente con un registro manual/Excel ya cargado y se adoptarían (vincularían) en vez de quedar en conflicto. Preview — nunca persiste nada. */
  adoptables: number;
  /** Filas sin N° LOTE pero con contenido (notas/filas auxiliares) — no son asignaciones reales, se ignoran justificadamente. */
  auxiliares: number;
  conflictSamples: ImportPreviewConflictSample[];
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

/** Fila inválida — para "VER DETALLE" (hotfix reconciliación). */
export interface SyncInvalidSample {
  tab: string;
  rowIndex: number;
  lote: string;
  producto: string;
  motivo: string;
}

/**
 * Fila CON N° LOTE real que SÍ se importó (created/updated/unchanged) pero
 * con uno o más campos secundarios incompletos/no parseables — 0038, hotfix
 * "sigue perdiendo lotes". El lote nunca se pierde por esto; queda marcado
 * ⚠ DATOS INCOMPLETOS para revisión humana en vez de desaparecer.
 */
export interface SyncIncompleteSample {
  tab: string;
  rowIndex: number;
  lote: string;
  producto: string;
  camposIncompletos: string[];
}

/**
 * Fila de Google adoptada (0039, hotfix "reconciliar datos históricos"):
 * coincidía inequívocamente con un registro manual/Excel YA cargado y se
 * vinculó/actualizó a la fuente Google en vez de quedar bloqueada como
 * conflicto para siempre.
 */
export interface SyncAdoptedSample {
  tab: string;
  rowIndex: number;
  lote: string;
  producto: string;
  motivo: string;
}

/** Fila que tiró una excepción al procesarse — aislada por fila, nunca pierde el resto de la hoja (0039). */
export interface SyncErrorSample {
  tab: string;
  rowIndex: number;
  lote: string;
  motivo: string;
}

/**
 * Reconciliación matemática obligatoria (hotfix): rowsRead debe repartirse
 * ÍNTEGRAMENTE entre estos buckets. Si no cierra, `reconciled: false` y
 * `status: "inconsistente"` — nunca se afirma éxito con filas sin destino
 * conocido.
 */
export interface SyncRunSummary {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "en_progreso" | "ok" | "error" | "parcial" | "inconsistente";
  rowsRead: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  invalidCount: number;
  archivedCount: number;
  conflictCount: number;
  /** Filas vacías (sin lote ni producto) — se ignoran intencionalmente, nunca cuentan como inválidas. */
  blankCount: number;
  /** Filas sin N° LOTE pero con contenido (notas/filas auxiliares de la planilla, ej. "AGU DEL SECTOR DE ELABORACION") — no son asignaciones reales, se ignoran justificadamente, nunca cuentan como inválidas. */
  auxiliaryCount: number;
  /** Duplicado EXACTO (mismo lote+código+producto, mismo contenido) repetido dentro de la misma hoja en esta corrida — no se re-escribe, pero cuenta en la reconciliación. */
  duplicateCount: number;
  /**
   * 0038 — subconjunto de created+updated+unchanged: filas CON lote real que
   * SÍ se importaron pero con 1+ campo secundario incompleto/no parseable
   * (nunca resta de la reconciliación — el lote está contado igual en su
   * bucket de siempre, esto es solo la marca ⚠ para revisión).
   */
  incompleteCount: number;
  /**
   * 0039 — filas de Google que coincidían inequívocamente con un registro
   * manual/Excel YA cargado (sourceId null) y se adoptaron a esta fuente
   * en vez de quedar bloqueadas como conflicto. Bucket EXCLUSIVO (suma en
   * la reconciliación).
   */
  adoptedCount: number;
  /**
   * 0039 — filas que tiraron una excepción al procesarse individualmente.
   * Aislada por fila: nunca aborta el resto de la hoja ni deja filas "sin
   * resultado conocido". Bucket EXCLUSIVO (suma en la reconciliación).
   */
  errorCount: number;
  /** false = la ecuación de reconciliación no cerró (alguna fila quedó sin bucket conocido) — nunca se afirma éxito en ese caso. */
  reconciled: boolean;
  /**
   * Fuente multi-tab (sheetTab null = descubrir todas las hojas del
   * spreadsheet): cuántas hojas tiene el spreadsheet en total y cuáles se
   * ignoraron (con motivo — estructura no reconocida o error de lectura).
   * Una hoja individual nunca aborta la sincronización de las demás.
   * `undefined`/vacío para fuentes de una sola hoja explícita (sin cambios).
   */
  sheetsTotal?: number;
  ignoredTabs?: Array<{ tab: string; reason: string }>;
  /** Detalle por hoja SÍ procesada — solo en fuentes multi-tab. */
  tabBreakdown?: Array<{
    tab: string;
    rowsRead: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    invalidCount: number;
    auxiliaryCount: number;
    duplicateCount: number;
    conflictCount: number;
    /** 0038 — filas con lote real importadas igual pero con campo(s) secundario(s) incompleto(s) (⚠, no se pierden). */
    incompleteCount: number;
    /** 0039 — filas adoptadas desde un registro manual/Excel preexistente. */
    adoptedCount: number;
    /** 0039 — filas con error aislado (nunca abortan el resto de la hoja). */
    errorCount: number;
  }>;
  /** Detalle de conflictos para "VER DETALLE" — máx. 20. */
  conflictSamples: ImportPreviewConflictSample[];
  /** Detalle de filas inválidas para "VER DETALLE" — máx. 20. */
  invalidSamples: SyncInvalidSample[];
  /** 0038 — detalle de filas incompletas (lote+campos) para "VER DETALLE" — máx. 20. */
  incompleteSamples: SyncIncompleteSample[];
  /** 0039 — detalle de adopciones (lote+motivo) para "VER DETALLE" — máx. 20. */
  adoptedSamples: SyncAdoptedSample[];
  /** 0039 — detalle de filas con error aislado (lote/fila/mensaje) para "VER DETALLE" — máx. 20. */
  errorSamples: SyncErrorSample[];
  errorMessage: string | null;
  triggeredBy: string;
  triggerKind: SyncTriggerKind;
}
