/**
 * Veredictos del borrado masivo de trabajos (Producción). Módulo puro, compartido por el servidor
 * (decide) y la interfaz (explica el motivo en el modal de confirmación).
 */

export type BulkDeleteVerdictCode =
  | "ELIGIBLE"
  | "ALREADY_DELETED"
  | "NOT_FOUND"
  | "INVALID_ID"
  | "BLOCKED_DELIVERED"
  | "BLOCKED_HAS_DELIVERIES"
  | "BLOCKED_IN_REMITO"
  | "BLOCKED_HAS_SCHEDULES"
  | "VERSION_CONFLICT";

export interface BulkDeleteVerdict {
  id: string;
  code: BulkDeleteVerdictCode;
  /** Motivo legible; vacío si es ELIGIBLE. */
  reason: string;
  /** Datos para mostrar en el modal. */
  product?: string;
  client?: string;
}

export const BULK_DELETE_VERDICT_REASON: Record<Exclude<BulkDeleteVerdictCode, "ELIGIBLE">, string> = {
  ALREADY_DELETED: "Ya estaba eliminado.",
  NOT_FOUND: "No existe o no es un trabajo nativo.",
  INVALID_ID: "Identificador inválido.",
  BLOCKED_DELIVERED: "Ya figura como entregado: se conserva por historial.",
  BLOCKED_HAS_DELIVERIES: "Tiene entregas registradas: se conserva por historial.",
  BLOCKED_IN_REMITO: "Está incluido en un remito: se conserva por historial.",
  BLOCKED_HAS_SCHEDULES: "Es la programación original de una orden con otras programaciones: quitá primero las demás.",
  VERSION_CONFLICT: "Fue modificado mientras lo seleccionabas: actualizá y revisá.",
};

export const BULK_DELETE_MAX_ITEMS = 200;

export interface BulkDeleteFacts {
  deletedAt: Date | string | null;
  operationalStatus: string;
  version: number;
  activeDeliveries: number;
  remitoLinks: number;
  /** Programaciones vigentes de la misma orden que dependen de este trabajo (fuera de la selección). */
  liveSchedules?: number;
}

/** Regla única de elegibilidad — mismas piezas que protegen el historial en el borrado individual. */
export function classifyBulkDelete(facts: BulkDeleteFacts, expectedVersion?: number): BulkDeleteVerdictCode {
  if (facts.deletedAt) return "ALREADY_DELETED";
  if (expectedVersion !== undefined && expectedVersion !== facts.version) return "VERSION_CONFLICT";
  if (facts.operationalStatus === "entregado") return "BLOCKED_DELIVERED";
  if (facts.activeDeliveries > 0) return "BLOCKED_HAS_DELIVERIES";
  if (facts.remitoLinks > 0) return "BLOCKED_IN_REMITO";
  if ((facts.liveSchedules ?? 0) > 0) return "BLOCKED_HAS_SCHEDULES";
  return "ELIGIBLE";
}

export interface BulkDeleteResult {
  dryRun: boolean;
  batchKey: string | null;
  requested: number;
  deleted: string[];
  verdicts: BulkDeleteVerdict[];
  /** true si el resultado vino de un reintento de la misma operación (idempotente). */
  replayed?: boolean;
}

export function summarizeVerdicts(verdicts: BulkDeleteVerdict[]) {
  const eligible = verdicts.filter((v) => v.code === "ELIGIBLE").length;
  const alreadyDeleted = verdicts.filter((v) => v.code === "ALREADY_DELETED").length;
  return { eligible, alreadyDeleted, blocked: verdicts.length - eligible - alreadyDeleted };
}
