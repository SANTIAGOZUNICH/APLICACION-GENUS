/** Tipos de dominio — Asignación de lotes (Calidad / Producción / Codificado). */

export interface AsignacionLote {
  id: string;
  lote: string;
  fecha: string;
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
}

export type AsignacionLoteUpsertInput = {
  id?: string;
  lote: string;
  fecha: string;
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
  archived?: boolean;
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
