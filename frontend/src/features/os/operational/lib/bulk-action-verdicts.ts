/**
 * Veredictos de las acciones masivas de Pendientes de definir que reutilizan el flujo individual
 * (registrar entrega / enviar a Codificado). Módulo puro, compartido por servidor y modal.
 */

export type BulkPendingAction = "DELIVER" | "SEND_CODIFICADO";

export type BulkActionVerdictCode =
  | "ELIGIBLE"
  | "INVALID_ID"
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "ACTION_NOT_ALLOWED"
  | "REJECTED";

export interface BulkActionVerdict {
  id: string;
  code: BulkActionVerdictCode;
  /** Motivo legible; vacío si es ELIGIBLE. */
  reason: string;
  product?: string;
  client?: string;
  /** Resultado esperado/obtenido (p. ej. «Entrega completa: 120 un»). */
  outcome?: string;
  /** Solo cuando se aplicó: el servidor ya lo había hecho antes (reintento). */
  replayed?: boolean;
}

export interface BulkActionResult {
  action: BulkPendingAction;
  dryRun: boolean;
  batchKey: string | null;
  requested: number;
  /** ids que quedaron procesados (o que lo habrían quedado en dry-run). */
  succeeded: string[];
  verdicts: BulkActionVerdict[];
  replayed?: boolean;
}

export const BULK_ACTION_MAX_ITEMS = 100;

export const BULK_ACTION_LABEL: Record<BulkPendingAction, string> = {
  DELIVER: "Marcar como entregados",
  SEND_CODIFICADO: "Enviar a Codificado",
};

export const BULK_ACTION_REASON = {
  INVALID_ID: "Identificador inválido.",
  NOT_FOUND: "No existe o no es un trabajo nativo.",
  NOT_PENDING: "Ya no está pendiente de definir (cambió de estado).",
  ACTION_NOT_ALLOWED: "Esta acción no está disponible para este trabajo según su sector de origen.",
} as const;
