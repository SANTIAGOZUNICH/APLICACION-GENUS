/** Tipos del pegado masivo de Métricas (compartidos entre servidor y navegador). */

export type MetricImportStatus = "new" | "identical" | "conflict" | "duplicate_in_batch" | "invalid";

export interface MetricImportPreviewRow {
  index: number;
  status: MetricImportStatus;
  message?: string;
  /** Registro existente con la misma clave (fecha + sector + producto + responsable). */
  existing?: { id: string; units: number; updatedAt: string };
}

export interface MetricImportCommitResult {
  batchId: string;
  created: number;
  updated: number;
  skipped: number;
  results: Array<{ index: number; outcome: "created" | "updated" | "identical" | "conflict_not_confirmed" | "duplicate_in_batch" | "invalid"; id?: string; message?: string }>;
  idempotentReplay?: boolean;
}

