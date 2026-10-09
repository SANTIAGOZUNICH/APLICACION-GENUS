/** Tipos de dominio — Asignación de lotes (Calidad / Producción / Codificado). */

export interface AsignacionLote {
  id: string;
  lote: string;
  /** null = no informada al pegar/importar (carga flexible) — nunca se infiere. */
  fecha: string | null;
  producto: string;
  codigo: string;
  marca: string;
  cantidades: number;
  vto: string | null;
  muestras: string;
  cjMuestra: string;
  fechaAnalisis: string | null;
  observaciones: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archived?: boolean;
  /** null = carga manual o "Pegar desde Excel". Presente = vino del sync de Google Sheets. */
  sourceId?: string | null;
  /** De qué hoja/tab salió este registro (auditoría/diagnóstico) — solo informativo. */
  sourceSheetTab?: string | null;
  /** 0038 — true si el N° LOTE es real pero algún campo secundario no se pudo leer/parsear de la fuente. Nunca implica que el registro no exista. */
  datosIncompletos?: boolean;
  /** 0038 — qué campos exactos (ej. ["producto","vto"]). Null/undefined si datosIncompletos es false. */
  camposIncompletos?: string[] | null;
}

export type AsignacionLoteUpsertInput = {
  id?: string;
  /** Carga flexible (import masivo): puede venir "" — solo el alta manual exige estos 3. */
  lote: string;
  fecha: string | null;
  producto: string;
  codigo: string;
  marca?: string;
  cantidades: number;
  vto?: string | null;
  muestras?: string;
  cjMuestra?: string;
  fechaAnalisis?: string | null;
  observaciones?: string;
  createdBy?: string;
  updatedBy: string;
  /** Edición manual: `updatedAt` que el usuario tenía a la vista (si cambió en el medio → conflicto, no se pisa). */
  expectedUpdatedAt?: string;
  archived?: boolean;
  /** Solo lo setea el sync de Google Sheets — nunca viene de alta/edición manual ni de "Pegar desde Excel". */
  sourceId?: string | null;
  /** Ver AsignacionLote#sourceSheetTab. */
  sourceSheetTab?: string | null;
  /** Ver AsignacionLote#datosIncompletos. */
  datosIncompletos?: boolean;
  /** Ver AsignacionLote#camposIncompletos. */
  camposIncompletos?: string[] | null;
};

export interface AsignacionLoteImportError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface AsignacionLoteImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: AsignacionLoteImportError[];
}

export type AsignacionLotesActor = {
  email: string;
  sector: import("@/types/operational/sector").SectorId;
  displayName: string;
};
