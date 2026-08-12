/** Copy y helpers — transferencia Envasado ↔ Codificado ↔ Calidad. */

export const WORK_TRANSFER = {
  /** Acción del operario al cerrar su parte y transferir a Calidad. */
  markFinishedAction: "Entregar a Calidad",
  /** Avance parcial — el operario sigue trabajando. */
  saveProgressAction: "Guardar avance",
  /** Enviar a cola Codificado (sin Calidad todavía). */
  sendToCodificadoAction: "Enviar a Codificado",
  /** Codificado cierra y notifica Calidad + Producción. */
  deliverFromCodificadoAction: "Entregar a Calidad y Producción",
  /** Estado visible en la fila/card del operario tras entregar. */
  deliveredToQuality: "Entregado a Calidad",
  inCodificado: "En Codificado",
  nextResponsibleQuality: "Próximo responsable: Calidad",
  nextResponsibleCodificado: "Próximo responsable: Codificado",
  /** Estado del trabajo en bandeja del sector origen. */
  pendingReview: "Pendiente de revisión",
  /** Estado en bandeja de Calidad. */
  awaitingApproval: "Esperando aprobación",
  /** Banner bandeja Calidad. */
  inboxBannerTitle: "Bandeja de transferencias",
  /** Feed Producción. */
  recentFlowTitle: "Flujo de planta",
  /** KPI Producción. */
  kpiDeliveredToQuality: "Entregados a Calidad",
  alreadyInCodificado: "Este trabajo ya está en Codificado.",
  alreadyDeliveredFromCodificado: "Este trabajo ya fue entregado desde Codificado.",
} as const;

/** Estado persistido al transferir trabajo a Calidad (directo o vía Codificado). */
export const WORK_TRANSFER_STATUS = "revision" as const;
export const WORK_CODIFICADO_STATUS = "en_codificado" as const;
export const WORK_CODIFICADO_DONE_STATUS = "codificado_completo" as const;

/** Bloquea edición en Envasado (enviado a Codificado o a Calidad). */
export function isWorkTransferredStatus(status: string): boolean {
  return (
    status === WORK_TRANSFER_STATUS ||
    status === "completo" ||
    status === WORK_CODIFICADO_STATUS ||
    status === WORK_CODIFICADO_DONE_STATUS
  );
}

/** Pendiente en bandeja de Codificado — solo cubre el flujo vía handoff desde Envasado. */
export function isInCodificadoStatus(status: string): boolean {
  return status === WORK_CODIFICADO_STATUS;
}

/** Ya llegó a Calidad (directo o vía Codificado). */
export function isPendingQualityStatus(status: string): boolean {
  return status === WORK_TRANSFER_STATUS || status === WORK_CODIFICADO_DONE_STATUS;
}

/**
 * Editable en Codificado — cubre las DOS formas en que un trabajo llega ahí
 * (Producción → Codificado directo, y Producción → Envasado → Codificado).
 * `isInCodificadoStatus` sola solo reconoce el segundo caso (status
 * "en_codificado", que solo existe tras un handoff); un trabajo asignado
 * directo nunca pasa por ese status — se queda en "pendiente"/"en_curso" con
 * `sector: "CODIFICADO"` — así que gatear la edición únicamente con
 * `isInCodificadoStatus` bloqueaba guardar/completar en ese caso (bug: la
 * lista de "Pendientes" ya usaba este mismo criterio ampliado, pero el
 * diálogo de detalle no). Debe reflejar exactamente los mismos criterios que
 * `canDeliverFromCodificado` (codificado-flow.ts) usa para permitir entregar.
 */
/**
 * Etiqueta de procedencia legible para un trabajo en Codificado — cubre las
 * dos formas en que llega (asignación directa de Producción, o handoff
 * desde Envasado Masivo/Premium). Mismo criterio para la lista y el
 * detalle en codificado-operational-view.tsx.
 */
export function codificadoOriginLabel(item: {
  codificadoOriginLabel?: string | null;
  codificadoOriginSector?: string | null;
  viaCodificado?: boolean;
}): string {
  if (item.codificadoOriginLabel) return item.codificadoOriginLabel;
  if (item.codificadoOriginSector === "ENVASADO_PREMIUM") return "Envasado Premium";
  if (item.codificadoOriginSector === "ENVASADO_MASIVO") return "Envasado Masivo";
  if (item.viaCodificado) return "Envasado";
  return "Asignación directa de Producción";
}

export function canEditInCodificado(item: {
  status: string;
  sector: string;
  viaCodificado?: boolean;
  deliveredFromCodificadoAt?: string | null;
}): boolean {
  if (item.deliveredFromCodificadoAt) return false;
  if (isInCodificadoStatus(item.status)) return true;
  return (
    item.sector === "CODIFICADO" &&
    !item.viaCodificado &&
    item.status !== "cancelado" &&
    item.status !== "completo" &&
    item.status !== WORK_CODIFICADO_DONE_STATUS &&
    item.status !== WORK_TRANSFER_STATUS &&
    item.status !== "entregado"
  );
}
